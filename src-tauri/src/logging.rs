//! Diagnostics. Initialised before anything that can fail, so a startup
//! failure still leaves a trail.
//!
//! One directory per launch rather than one file per day. Rotation by date
//! interleaves several runs into one file, and "which run was this?" is the
//! first question every bug report has to answer. A session directory also
//! gives panics somewhere obvious to land.
//!
//! File paths are logged; file *contents* never are. Redaction happens at
//! export (Plan 11), not here, so the on-disk log keeps real paths the user
//! can grep on their own machine.

use std::path::{Path, PathBuf};

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Layer, SubscriberExt};
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{reload, EnvFilter, Registry};

/// How many launches to keep. Ten is enough to cover "it broke sometime this
/// week" without letting a debug-level session fill a home directory.
pub const RETAIN_SESSIONS: usize = 10;

type FilteredRegistry =
    tracing_subscriber::layer::Layered<reload::Layer<EnvFilter, Registry>, Registry>;
type BoxedFmtLayer = Box<dyn Layer<FilteredRegistry> + Send + Sync>;

/// The global subscriber can only be installed once per process. A real
/// launch calls `start_session` exactly once, so this only matters for the
/// test binary, which starts several sessions in-process: without a way to
/// redirect the already-installed writer, every session after the first
/// would keep writing into the first session's log file.
static WRITER_RELOAD: std::sync::OnceLock<reload::Handle<BoxedFmtLayer, FilteredRegistry>> =
    std::sync::OnceLock::new();

pub struct Session {
    pub dir: PathBuf,
    /// MUST be held for the process lifetime; dropping it flushes the
    /// non-blocking writer. Losing it early silently truncates the log.
    #[allow(dead_code, reason = "held for its Drop side effect, never read")]
    guard: WorkerGuard,
    level: reload::Handle<EnvFilter, Registry>,
}

impl Session {
    /// Changes the level of the running process, so "reproduce it with debug
    /// logging" is a toggle rather than a terminal instruction.
    pub fn set_level(&self, level: &str) -> bool {
        let Ok(filter) = EnvFilter::try_new(level) else {
            return false;
        };
        self.level.reload(filter).is_ok()
    }
}

pub fn session_dir(log_dir: &Path, stamp: &str, pid: u32) -> PathBuf {
    log_dir.join(format!("{stamp}-{pid}"))
}

pub fn now_stamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_owned())
        .replace(':', "-")
}

#[must_use]
pub fn start_session(paths: &crate::paths::AppPaths, default_level: &str) -> Session {
    let dir = session_dir(&paths.log_dir, &now_stamp(), std::process::id());
    let _ = std::fs::create_dir_all(&dir);

    // `latest` is what makes `tail -f ~/.local/state/riff/logs/latest/riff.log`
    // work without looking anything up first.
    let latest = paths.log_dir.join("latest");
    let _ = std::fs::remove_file(&latest);
    let _ = std::os::unix::fs::symlink(&dir, &latest);

    let appender = tracing_appender::rolling::never(&dir, "riff.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);

    // RIFF_LOG wins over the persisted setting, which wins over the default.
    let base = EnvFilter::try_from_env("RIFF_LOG")
        .or_else(|_| EnvFilter::try_new(default_level))
        .unwrap_or_else(|_| EnvFilter::default().add_directive(LevelFilter::INFO.into()));
    let (filter, level) = reload::Layer::new(base);

    let fmt_layer: BoxedFmtLayer = Box::new(
        tracing_subscriber::fmt::layer::<FilteredRegistry>()
            .with_writer(writer)
            .with_ansi(false)
            .with_target(true)
            .with_thread_ids(true)
            .with_line_number(true),
    );

    if let Some(handle) = WRITER_RELOAD.get() {
        let _ = handle.reload(fmt_layer);
    } else {
        let (writer_layer, writer_handle) = reload::Layer::new(fmt_layer);
        let _ = WRITER_RELOAD.set(writer_handle);
        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(writer_layer)
            .try_init();
    }

    prune_sessions(&paths.log_dir, RETAIN_SESSIONS);

    Session { dir, guard, level }
}

/// Keeps the newest `keep` session directories. Names are RFC 3339 stamps, so
/// lexical order is chronological order — no mtime, no clock skew.
pub fn prune_sessions(log_dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n != "latest"))
        .collect();
    dirs.sort();
    if dirs.len() <= keep {
        return;
    }
    for old in &dirs[..dirs.len() - keep] {
        let _ = std::fs::remove_dir_all(old);
    }
}

/// The subscriber `start_session` installs is process-global, and cargo runs
/// tests on parallel threads. A second call reloads the writer layer, so an
/// event emitted by the first test after that point lands in the second test's
/// file and the first one reads back an empty log — which failed roughly three
/// runs in a hundred, and forty in a hundred once the window between starting a
/// session and logging was widened. Every test that starts a session takes this
/// first, including `lib.rs`'s boot-order tests.
#[cfg(test)]
static SESSION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn session_lock() -> std::sync::MutexGuard<'static, ()> {
    // A panic inside one of these tests must surface as that test's own
    // assertion, not as a poisoning error in whichever runs next.
    SESSION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn write_panic_file(session_dir: &Path, body: &str) {
    let _ = std::fs::write(session_dir.join("panic.txt"), body);
}

/// Optional notifier, installed by Plan 04 once a window exists. Behind a
/// `OnceLock` so this module needs no dependency on Tauri.
static PANIC_NOTIFIER: std::sync::OnceLock<fn(&str)> = std::sync::OnceLock::new();
static PANIC_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Registers a best-effort, NON-BLOCKING way to tell the user about a panic.
/// A blocking dialog raised from a panic on the GTK main thread can deadlock,
/// turning a crash report into a hang.
pub fn set_panic_notifier(notifier: fn(&str)) {
    let _ = PANIC_NOTIFIER.set(notifier);
}

/// Logs panics with a backtrace, writes `panic.txt` into the session
/// directory, then runs the previous hook. Logging always succeeds;
/// notifying is a courtesy that may not be available yet.
pub fn install_panic_hook(session_dir: &Path) {
    let _ = PANIC_DIR.set(session_dir.to_path_buf());
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        tracing::error!(panic = %info, backtrace = %backtrace, "panic");
        if let Some(dir) = PANIC_DIR.get() {
            write_panic_file(dir, &format!("{info}\n\n{backtrace}"));
        }
        if let Some(notify) = PANIC_NOTIFIER.get() {
            notify(&info.to_string());
        }
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::session_lock;

    fn paths(tmp: &std::path::Path) -> crate::paths::AppPaths {
        let p = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.join("config")),
                data: Some(tmp.join("data")),
            },
        )
        .expect("overrides supply both roots");
        crate::paths::ensure_dirs(&p).expect("dirs");
        p
    }

    #[test]
    fn each_launch_gets_its_own_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());

        let first = session_dir(&p.log_dir, "2026-08-28T10-00-00Z", 111);
        let second = session_dir(&p.log_dir, "2026-08-28T10-00-00Z", 222);
        assert_ne!(
            first, second,
            "two launches in the same second must not collide"
        );
        assert!(first.starts_with(&p.log_dir));
    }

    #[test]
    fn session_directories_sort_chronologically_by_name() {
        // Lexical order is chronological order, so listing them needs no
        // mtime and survives clock skew and file copying.
        let dir = std::path::Path::new("/logs");
        let older = session_dir(dir, "2026-08-28T09-00-00Z", 1);
        let newer = session_dir(dir, "2026-08-28T10-00-00Z", 1);
        assert!(older < newer);
    }

    #[test]
    fn writes_the_log_inside_the_session_directory() {
        let _lock = session_lock();
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        let dir = {
            let session = start_session(&p, "info");
            tracing::error!("probe line");
            let dir = session.dir.clone();
            drop(session); // flushes the non-blocking writer
            dir
        };
        let body = std::fs::read_to_string(dir.join("riff.log")).expect("log readable");
        assert!(
            body.contains("probe line"),
            "log did not capture the event: {body}"
        );
    }

    #[test]
    fn latest_points_at_the_current_session() {
        let _lock = session_lock();
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        let session = start_session(&p, "info");
        let latest = p.log_dir.join("latest");
        assert!(latest.exists(), "`latest` is what makes `tail -f` usable");
        assert_eq!(
            std::fs::canonicalize(&latest).expect("resolves"),
            std::fs::canonicalize(&session.dir).expect("resolves"),
        );
    }

    #[test]
    fn pruning_keeps_the_newest_sessions_and_removes_the_rest() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let p = paths(tmp.path());
        for hour in 0..8 {
            std::fs::create_dir_all(p.log_dir.join(format!("2026-08-28T0{hour}-00-00Z-1")))
                .expect("seed");
        }
        prune_sessions(&p.log_dir, 3);

        let mut remaining: Vec<_> = std::fs::read_dir(&p.log_dir)
            .expect("readdir")
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n != "latest")
            .collect();
        remaining.sort();
        assert_eq!(remaining.len(), 3, "retention must bound growth");
        assert!(
            remaining[0].starts_with("2026-08-28T05"),
            "the newest must survive: {remaining:?}"
        );
    }

    #[test]
    fn pruning_a_missing_directory_is_not_an_error() {
        prune_sessions(std::path::Path::new("/nonexistent/logs"), 3);
    }

    #[test]
    fn a_panic_is_written_beside_the_log_so_it_is_findable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write_panic_file(tmp.path(), "thread panicked at 'boom'");
        let body = std::fs::read_to_string(tmp.path().join("panic.txt")).expect("panic file");
        assert!(body.contains("boom"));
    }
}
