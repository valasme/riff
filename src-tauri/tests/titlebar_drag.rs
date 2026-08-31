//! Window movement crosses Riff's typed IPC seam. Granting Tauri's webview
//! command would make movement work by breaking the invariant that the
//! webview holds only `core:default`.

#[test]
fn the_webview_keeps_only_the_default_core_capability() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("the default capability is valid JSON");
    let permissions = capability["permissions"]
        .as_array()
        .expect("the default capability has a permissions array");

    assert_eq!(permissions, &["core:default"]);
}
