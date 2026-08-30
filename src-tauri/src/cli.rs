//! Riff's terminal surface.
//!
//! Dispatched from `run()` BEFORE `tauri::Builder` is constructed *and*
//! before `instance::acquire`, for two reasons. First, a second launch of an
//! already-running Riff raises the running window and exits — so `riff --help`
//! typed while Riff is open would print nothing at all. Second, nothing here
//! needs GTK, a webview or a display, which means `riff doctor` works over SSH
//! on a machine whose window will not open. That is exactly when somebody runs
//! it.
//!
//! Running ahead of the gate does not reopen the hole ADR 0002 closed: given
//! no subcommand `dispatch` returns having touched nothing, and the writes it
//! does make — `riff repair` — are the ones the user asked for by name.
//!
//! Accepting `--output <path>` here does not contradict the rule that no
//! caller-supplied path crosses IPC. That rule constrains a *compromised
//! webview*. This is the user's own shell, already able to write any file
//! they can write.

use crate::diagnostics::health::Severity;
use crate::paths::AppPaths;

// `Cli`, `Command`, `LogsAction` and the `EXIT_*` constants: kept in their
// own file, with no dependency on the rest of this crate, so `build.rs` can
// `include!` the identical definitions to generate the man page and shell
// completions from the same source `clap::Parser` derives here.
include!("cli_defs.rs");

/// `Some(code)` means the invocation was handled and the process should exit.
/// `None` means no subcommand was given and the window should open.
pub fn dispatch(cli: &Cli, paths: &AppPaths) -> Option<i32> {
    let Some(command) = &cli.command else {
        return None;
    };

    let code = match command {
        Command::Doctor => doctor(paths, cli.json),
        Command::Repair { yes } => repair(paths, *yes),
        Command::Paths => {
            print_paths(paths, cli.json);
            EXIT_OK
        }
        Command::Config {
            path,
            show,
            validate,
        } => config(paths, *path, *show, *validate),
        Command::Logs {
            path,
            list,
            tail,
            action,
        } => logs(paths, *path, *list, *tail, action.as_ref()),
        Command::History { path, count } => history(paths, *path, *count),
    };
    Some(code)
}

fn doctor(paths: &AppPaths, json: bool) -> i32 {
    let checks = crate::diagnostics::health::run_checks(paths);
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&checks).unwrap_or_default()
        );
    } else {
        for check in &checks {
            let mark = match check.severity {
                Severity::Ok => "ok  ",
                Severity::Warn => "warn",
                Severity::Error => "FAIL",
            };
            println!("[{mark}] {:<22} {}", check.title, check.detail);
        }
        let repairable = checks.iter().any(|c| c.repairable);
        if repairable {
            println!("\nRun `riff repair` to fix what can be fixed automatically.");
        }
    }
    if checks.iter().any(|c| c.severity == Severity::Error) {
        EXIT_UNHEALTHY
    } else {
        EXIT_OK
    }
}

/// A launched GUI session writes its pid here so `riff repair` can warn if
/// it looks like Riff is already running. `pub(crate)` so `run()` can write
/// and remove it around the process lifetime; this module only ever reads it.
pub(crate) fn pid_file(paths: &AppPaths) -> std::path::PathBuf {
    paths.state_dir.join("riff.pid")
}

/// Best-effort: a stale or unreadable pid file is silently ignored, because a
/// diagnostic that can fail is a diagnostic that fails on the one machine you
/// needed it for. `/proc/<pid>` is Linux-specific, matching every other probe
/// in this module — Riff does not ship elsewhere.
fn warn_if_running(paths: &AppPaths) {
    let Ok(contents) = std::fs::read_to_string(pid_file(paths)) else {
        return;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        return;
    };
    if std::path::Path::new(&format!("/proc/{pid}")).exists() {
        println!(
            "warning: riff (pid {pid}) appears to already be running; \
             repairing now may race with it"
        );
    }
}

/// Keeps the newest `keep` quarantine files, so a long-lived install does not
/// accumulate one `.corrupt-*` file per crash forever.
fn prune_quarantine(paths: &AppPaths, keep: usize) -> usize {
    let mut files: Vec<_> = std::fs::read_dir(&paths.config_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
                .map(|e| e.path())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    // `.corrupt-<rfc3339>` sorts chronologically, same trick as session dirs.
    files.sort();
    if files.len() <= keep {
        return 0;
    }
    files[..files.len() - keep]
        .iter()
        .filter(|f| std::fs::remove_file(f).is_ok())
        .count()
}

fn repair(paths: &AppPaths, yes: bool) -> i32 {
    warn_if_running(paths);

    if !yes {
        use std::io::Write;
        print!(
            "This creates missing directories, quarantines an unparseable settings.json, \
             and prunes old quarantine files. Continue? [y/N] "
        );
        let _ = std::io::stdout().flush();
        let mut input = String::new();
        if std::io::stdin().read_line(&mut input).is_err()
            || !input.trim().eq_ignore_ascii_case("y")
        {
            println!("aborted");
            return EXIT_OK;
        }
    }

    if let Err(err) = crate::paths::ensure_dirs(paths) {
        println!("could not create directories: {err}");
        return EXIT_FAILED;
    }
    println!("directories present");

    // `SettingsStore::load` already quarantines an unparseable file and falls
    // back to defaults in memory — the same code path a real launch takes.
    // Flushing is what turns those in-memory defaults into a written file.
    let (store, outcome) = crate::settings::store::SettingsStore::load(paths.clone());
    if let crate::settings::store::LoadOutcome::Recovered {
        quarantined: Some(quarantined),
    } = &outcome
    {
        println!(
            "quarantined unreadable settings.json to {}",
            quarantined.display()
        );
    }
    if let Err(err) = store.flush_if_dirty() {
        println!("could not write settings.json: {err}");
        return EXIT_FAILED;
    }

    let pruned = prune_quarantine(paths, 3);
    if pruned > 0 {
        println!("removed {pruned} old quarantine file(s)");
    }

    println!("repair complete");
    EXIT_OK
}

fn print_paths(paths: &AppPaths, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(paths).unwrap_or_default()
        );
        return;
    }
    println!("config  {}", paths.config_dir.display());
    println!("data    {}", paths.data_dir.display());
    println!("state   {}", paths.state_dir.display());
    println!("cache   {}", paths.cache_dir.display());
    println!("logs    {}", paths.log_dir.display());
}

fn config(paths: &AppPaths, path: bool, show: bool, validate: bool) -> i32 {
    let file = paths.settings_file();
    if path {
        println!("{}", file.display());
        return EXIT_OK;
    }

    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(err) => {
            println!("{}: {err}", file.display());
            return if validate {
                EXIT_UNHEALTHY
            } else {
                EXIT_FAILED
            };
        }
    };
    let parsed = serde_json::from_slice::<serde_json::Value>(&bytes);

    if validate {
        match &parsed {
            Ok(_) => println!("{} is valid JSON", file.display()),
            Err(err) => {
                println!("{} does not parse: {err}", file.display());
                return EXIT_UNHEALTHY;
            }
        }
    }

    if show {
        match parsed {
            Ok(value) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&value).unwrap_or_default()
                );
            }
            Err(err) => {
                println!("could not parse {}: {err}", file.display());
                return EXIT_FAILED;
            }
        }
    }

    EXIT_OK
}

fn list_sessions(paths: &AppPaths) -> i32 {
    let sessions = crate::diagnostics::bundle::sessions_newest_first(&paths.log_dir);
    if sessions.is_empty() {
        println!("no sessions recorded yet");
        return EXIT_OK;
    }
    for dir in sessions {
        println!("{}", dir.file_name().unwrap_or_default().to_string_lossy());
    }
    EXIT_OK
}

fn tail_log(paths: &AppPaths, n: usize) -> i32 {
    let file = paths.log_dir.join("latest").join("riff.log");
    match std::fs::read_to_string(&file) {
        Ok(text) => {
            let lines: Vec<&str> = text.lines().collect();
            let start = lines.len().saturating_sub(n);
            for line in &lines[start..] {
                println!("{line}");
            }
            EXIT_OK
        }
        Err(err) => {
            println!("could not read {}: {err}", file.display());
            EXIT_FAILED
        }
    }
}

fn export_logs(paths: &AppPaths, output: Option<&std::path::Path>) -> i32 {
    let default_name = format!("riff-diagnostics-{}.txt", crate::logging::now_stamp());
    let target = output
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from(default_name));

    let text = crate::diagnostics::current_bundle(paths);
    match std::fs::write(&target, text) {
        Ok(()) => {
            println!("wrote {}", target.display());
            EXIT_OK
        }
        Err(err) => {
            println!("could not write {}: {err}", target.display());
            EXIT_FAILED
        }
    }
}

fn logs(
    paths: &AppPaths,
    path: bool,
    _list: bool,
    tail: Option<usize>,
    action: Option<&LogsAction>,
) -> i32 {
    if let Some(LogsAction::Export { output }) = action {
        return export_logs(paths, output.as_deref());
    }
    if path {
        println!("{}", paths.log_dir.display());
        return EXIT_OK;
    }
    if let Some(n) = tail {
        return tail_log(paths, n);
    }
    // `--list` and no flags at all do the same thing: listing sessions is
    // the most useful default for a bare `riff logs`.
    list_sessions(paths)
}

fn history(paths: &AppPaths, path: bool, count: bool) -> i32 {
    let file = paths.history_file();
    if path {
        println!("{}", file.display());
        return EXIT_OK;
    }
    if count {
        let n = std::fs::read_to_string(&file)
            .map(|text| text.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0);
        println!("{n}");
        return EXIT_OK;
    }
    println!("{}", file.display());
    EXIT_OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn no_arguments_means_launch_the_window() {
        let cli = Cli::parse_from(["riff"]);
        assert!(
            cli.command.is_none(),
            "bare `riff` must still start the application"
        );
    }

    #[test]
    fn the_definition_is_internally_consistent() {
        // clap's own assertions catch duplicate flags, bad defaults and
        // conflicting short options at test time rather than at first run.
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }

    #[test]
    fn every_documented_subcommand_parses() {
        for args in [
            vec!["riff", "doctor"],
            vec!["riff", "doctor", "--json"],
            vec!["riff", "repair", "--yes"],
            vec!["riff", "logs", "--list"],
            vec!["riff", "logs", "--path"],
            vec!["riff", "logs", "export", "--output", "/tmp/r.txt"],
            vec!["riff", "config", "--show"],
            vec!["riff", "config", "--validate"],
            vec!["riff", "paths"],
            vec!["riff", "history", "--count"],
        ] {
            Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?} failed: {e}"));
        }
    }

    #[test]
    fn an_unknown_subcommand_is_a_usage_error_not_a_silent_launch() {
        assert!(Cli::try_parse_from(["riff", "nonsense"]).is_err());
    }

    #[test]
    fn the_log_level_override_is_available_on_every_invocation() {
        let cli = Cli::parse_from(["riff", "--log-level", "debug"]);
        assert_eq!(cli.log_level.as_deref(), Some("debug"));
    }
}
