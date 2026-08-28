//! The template's demo command must never reach a shipped binary. A live
//! `greet` command is IPC surface nobody meant to expose.

#[test]
fn greet_command_is_gone() {
    let lib = include_str!("../src/lib.rs");
    assert!(
        !lib.contains("greet"),
        "src-tauri/src/lib.rs still contains the template `greet` command"
    );
}
