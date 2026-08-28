include!("src/cli_defs.rs");

/// Packagers expect a man page; its absence is a lint failure in both Debian
/// and Fedora review. Generated at build time from the same `clap::Parser`
/// derive the binary itself uses, so the two can never drift apart.
fn generate_cli_extras() {
    use clap::CommandFactory;
    use clap_complete::Shell;

    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("set by cargo"));
    let dest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("dist-extra");
    let _ = std::fs::create_dir_all(&dest);

    let mut command = Cli::command();

    let man = clap_mangen::Man::new(command.clone());
    let mut buffer = Vec::new();
    if man.render(&mut buffer).is_ok() {
        let _ = std::fs::write(out_dir.join("riff.1"), &buffer);
        let _ = std::fs::write(dest.join("riff.1"), &buffer);
    }

    for (shell, file_name) in [
        (Shell::Bash, "riff.bash"),
        (Shell::Zsh, "_riff"),
        (Shell::Fish, "riff.fish"),
    ] {
        let mut buffer = Vec::new();
        clap_complete::generate(shell, &mut command, "riff", &mut buffer);
        let _ = std::fs::write(out_dir.join(file_name), &buffer);
        let _ = std::fs::write(dest.join(file_name), &buffer);
    }
}

fn main() {
    generate_cli_extras();
    tauri_build::build()
}
