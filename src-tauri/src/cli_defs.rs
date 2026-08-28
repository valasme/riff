// The pure clap definitions, `include!`d from both `src/cli.rs` (the real
// dispatcher, linked into the app) and `build.rs` (which generates the man
// page and shell completions). A build script compiles in total isolation
// from the rest of the crate — it cannot `use crate::...` — so the one way
// to keep the CLI's shape a single source of truth is to keep this half of
// it free of every crate-internal dependency and share the file itself.

use clap::{Parser, Subcommand};

pub const EXIT_OK: i32 = 0;
pub const EXIT_FAILED: i32 = 1;
pub const EXIT_UNHEALTHY: i32 = 3;

#[derive(Parser, Debug)]
#[command(
    name = "riff",
    version,
    about = "A local-first practice workspace for musicians",
    long_about = "Run with no arguments to open Riff.\n\nThe subcommands below \
                  work without a display, so they can be used to diagnose and \
                  repair an installation whose window will not open."
)]
pub struct Cli {
    /// Log level for this run: error, warn, info, debug, trace.
    #[arg(long, global = true)]
    pub log_level: Option<String>,

    /// Machine-readable output.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Check this installation and report anything wrong.
    Doctor,

    /// Fix what `doctor` found. Never destroys data without quarantining it.
    Repair {
        /// Apply fixes without asking.
        #[arg(long, short)]
        yes: bool,
    },

    /// Inspect and export session logs.
    Logs {
        /// Print the log directory and exit.
        #[arg(long)]
        path: bool,
        /// List retained sessions with their dates and versions.
        #[arg(long)]
        list: bool,
        /// Print the last N lines of the current session.
        #[arg(long, value_name = "N")]
        tail: Option<usize>,
        #[command(subcommand)]
        action: Option<LogsAction>,
    },

    /// Inspect settings.json.
    Config {
        /// Print the settings file path.
        #[arg(long)]
        path: bool,
        /// Print the current settings.
        #[arg(long)]
        show: bool,
        /// Parse the file and report whether it is valid.
        #[arg(long)]
        validate: bool,
    },

    /// Print every directory Riff uses.
    Paths,

    /// Inspect the practice history file.
    History {
        /// Print the history file path.
        #[arg(long)]
        path: bool,
        /// Print how many sessions are recorded.
        #[arg(long)]
        count: bool,
    },
}

#[derive(Subcommand, Debug)]
pub enum LogsAction {
    /// Write a redacted diagnostics bundle for a bug report.
    Export {
        /// Where to write it. Defaults to the current directory.
        #[arg(long, short)]
        output: Option<std::path::PathBuf>,
    },
}
