//! "Am I the only Riff?", answered before anything touches disk.
//!
//! An abstract Unix socket, not a lock file and not DBus. Binding is atomic,
//! writes nothing, and the abstract namespace has no filesystem entry — the
//! kernel releases the name when the process dies, so there is no stale lock
//! to break after a `kill -9` and no repair path to write for one.
//!
//! It doubles as the channel: connecting to it *is* the message "another
//! launch happened, raise your window". Riff never used the arguments
//! `tauri-plugin-single-instance` forwarded, so a connection carries no body.
//!
//! See `docs/adr/0002-single-instance-runs-before-anything-touches-disk.md`.

use std::os::linux::net::SocketAddrExt;
use std::os::unix::net::{SocketAddr, UnixListener, UnixStream};

use crate::paths::AppPaths;

/// The name is held by the kernel for as long as this lives, so it must be
/// held for the whole process. Dropping it hands the instance to the next
/// launch while this one is still on screen.
pub struct Instance(UnixListener);

#[derive(Debug)]
pub struct AlreadyRunning;

/// Derived from `config_dir`, not from the bundle identifier: the abstract
/// namespace is per network namespace rather than per user, so a machine with
/// two logged-in users needs two names — and `RIFF_CONFIG_HOME=/tmp/scratch`
/// has to be a *different Riff*, which is what CLAUDE.md promises a scratch
/// run. Hashed because abstract names are capped at 107 bytes and a config
/// path is not.
fn name_for(paths: &AppPaths) -> String {
    // FNV-1a, written out rather than DefaultHasher: an upgrade that changed
    // the standard library's hash mid-session would make the running Riff and
    // the newly installed one two different instances.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in paths.config_dir.as_os_str().as_encoded_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("riff-{hash:016x}")
}

/// `Err` means, and only means, that another Riff already holds the name.
/// Every other failure yields `Ok`: refusing to start because a socket could
/// not be created would turn a single-instance nicety into an outage, and the
/// worst case is the behaviour Riff had before this existed.
pub fn acquire(paths: &AppPaths) -> Result<Instance, AlreadyRunning> {
    let addr = match SocketAddr::from_abstract_name(name_for(paths)) {
        Ok(addr) => addr,
        Err(err) => {
            tracing::warn!(%err, "cannot name the single-instance socket; running unguarded");
            return Ok(Instance(unguarded()));
        }
    };
    match UnixListener::bind_addr(&addr) {
        Ok(listener) => Ok(Instance(listener)),
        Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => Err(AlreadyRunning),
        Err(err) => {
            tracing::warn!(%err, "cannot bind the single-instance socket; running unguarded");
            Ok(Instance(unguarded()))
        }
    }
}

/// A listener nothing can reach, so `Instance` stays one type rather than
/// growing an optional half every caller has to remember. An unnamed abstract
/// socket has no name to connect to, so `serve` simply never fires.
///
/// The bind cannot fail for a reason a fallback would fix — it would mean
/// AF_UNIX is unavailable, and Tauri could not run either — but it must not
/// take the application down with it, so a failure yields a listener-shaped
/// nothing by way of the only remaining route: trying again and giving up on
/// the single-instance guarantee for this launch.
fn unguarded() -> UnixListener {
    #[expect(
        clippy::expect_used,
        reason = "AF_UNIX is unavailable; nothing can run"
    )]
    UnixListener::bind_addr(
        &SocketAddr::from_abstract_name([]).expect("an empty abstract name is always valid"),
    )
    .expect("the kernel refused an unnamed abstract socket")
}

/// Tells the Riff that owns the instance to raise its window. `false` means
/// nobody answered, which is the caller's cue that it is the only Riff after
/// all.
pub fn request_focus(paths: &AppPaths) -> bool {
    let Ok(addr) = SocketAddr::from_abstract_name(name_for(paths)) else {
        return false;
    };
    UnixStream::connect_addr(&addr).is_ok()
}

impl Instance {
    /// Runs `on_launch` once per launch that found this instance already
    /// running. Connections that arrive before this is called wait in the
    /// kernel's backlog rather than being lost, which matters: the socket is
    /// bound in step 2 of the boot sequence and this is called from `setup`.
    pub fn serve<F: Fn() + Send + 'static>(&self, on_launch: F) {
        let Ok(listener) = self.0.try_clone() else {
            tracing::warn!("cannot listen for further launches; they will not raise the window");
            return;
        };
        std::thread::Builder::new()
            .name("riff-instance".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    // The connection is the whole message; nothing is read.
                    if stream.is_ok() {
                        on_launch();
                    }
                }
            })
            .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn scratch() -> (AppPaths, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let paths = crate::paths::resolve(
            &crate::paths::XdgRoots::default(),
            &crate::paths::PathOverrides {
                config: Some(tmp.path().join("config")),
                data: Some(tmp.path().join("data")),
            },
        )
        .expect("overrides supply both roots");
        crate::paths::ensure_dirs(&paths).expect("dirs");
        (paths, tmp)
    }

    #[test]
    fn the_second_launch_is_refused_before_it_can_touch_anything() {
        let (paths, _tmp) = scratch();
        let _live = acquire(&paths).expect("the first launch owns the instance");
        assert!(
            acquire(&paths).is_err(),
            "a second launch must learn it is doomed before it writes a single byte"
        );
    }

    #[test]
    fn releasing_the_instance_lets_the_next_launch_have_it() {
        let (paths, _tmp) = scratch();
        drop(acquire(&paths).expect("first"));
        acquire(&paths).expect("the name must not outlive the process that held it");
    }

    #[test]
    fn two_scratch_configs_are_two_different_riffs() {
        // CLAUDE.md promises RIFF_CONFIG_HOME runs against a scratch config
        // "instead of your real one". A single-instance name derived from the
        // bundle identifier would make the scratch run focus the real window
        // and exit instead of starting at all.
        let (mine, _a) = scratch();
        let (theirs, _b) = scratch();
        let _live = acquire(&mine).expect("first");
        acquire(&theirs).expect("a different config directory is a different instance");
    }

    #[test]
    fn a_second_launch_focuses_the_window_the_first_one_owns() {
        let (paths, _tmp) = scratch();
        let live = acquire(&paths).expect("first");
        let (tx, rx) = mpsc::channel();
        live.serve(move || {
            let _ = tx.send(());
        });

        assert!(
            request_focus(&paths),
            "the running instance must be reachable"
        );
        rx.recv_timeout(Duration::from_secs(2))
            .expect("a forwarded launch still raises the window that is already open");
    }

    #[test]
    fn asking_a_riff_that_is_not_running_to_focus_fails_rather_than_hanging() {
        let (paths, _tmp) = scratch();
        assert!(!request_focus(&paths));
    }
}
