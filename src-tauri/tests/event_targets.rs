//! `emit` broadcasts to every webview; `emit_to` does not. With pop-outs open
//! that is the difference between one dialog and three — and two of the three
//! in windows that can do nothing about it.
//!
//! Not expressible as a unit test: telling the two apart needs a running Tauri
//! application with three real windows. Reading the source is what
//! `no_template_code.rs` already does for a guarantee of the same shape.

/// Whitespace collapsed, so `cargo fmt` deciding to wrap a call across three
/// lines does not turn a guarantee into a formatting question.
fn squashed(source: &str) -> String {
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn lib() -> String {
    squashed(include_str!("../src/lib.rs"))
}

fn practice() -> String {
    squashed(include_str!("../src/practice/mod.rs"))
}

#[test]
fn a_failed_write_raises_one_toast_no_matter_how_many_windows_are_open() {
    assert!(
        lib().contains(r#"emit_to(practice::MAIN, "settings://write-failed""#),
        "settings://write-failed must go to main alone: a pop-out is one pane \
         with no settings interface to explain the failure in"
    );
}

#[test]
fn an_invalid_hand_edit_is_reported_to_the_window_that_can_explain_it() {
    assert!(
        lib().contains(r#"emit_to(practice::MAIN, "settings://edit-invalid""#),
        "settings://edit-invalid must go to main alone"
    );
}

#[test]
fn the_quit_confirmation_is_asked_only_in_the_window_that_asked_to_quit() {
    assert!(
        lib().contains(r#"emit_to(window.label(), "app://confirm-quit""#),
        "one quit must not raise three modals"
    );
}

#[test]
fn a_settings_change_is_still_broadcast_because_every_window_must_adopt_it() {
    // The other half of the rule. Targeting this one would leave a pop-out
    // rendering a theme the user has just changed away from.
    assert!(
        lib().contains(r#"emit("settings://changed""#),
        "settings://changed must reach every window"
    );
}

#[test]
fn the_popped_out_set_is_still_broadcast_because_every_window_mirrors_it() {
    assert!(
        practice().contains("app.emit(PANES_CHANGED, panes)"),
        "practice://panes-changed must reach every window"
    );
}
