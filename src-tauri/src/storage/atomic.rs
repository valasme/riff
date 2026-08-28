//! Durable file replacement.
//!
//! Three details carry the durability, and all three are easy to omit:
//!   1. the temporary file must live in the SAME directory as the target,
//!      because `rename` is only atomic within one filesystem;
//!   2. the data must be fsynced before the rename, or the rename can land
//!      while the content has not;
//!   3. the PARENT DIRECTORY must be fsynced after the rename, or the rename
//!      itself can be lost on power failure. This is the step everyone skips.

use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path has no parent directory",
        )
    })?;
    std::fs::create_dir_all(dir)?;

    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.flush()?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;

    // Durability of the rename itself.
    std::fs::File::open(dir)?.sync_all()?;
    Ok(())
}

/// Writes only when the content differs. Used for `settings.schema.json`,
/// which is regenerated every launch: rewriting it unconditionally would
/// touch its mtime and wake the config-directory watcher on every start.
pub fn write_if_changed(path: &Path, bytes: &[u8]) -> std::io::Result<bool> {
    if let Ok(existing) = std::fs::read(path) {
        if existing == bytes {
            return Ok(false);
        }
    }
    write_atomic(path, bytes)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_new_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.json");
        write_atomic(&target, b"{\"a\":1}").expect("write");
        assert_eq!(std::fs::read(&target).expect("read"), b"{\"a\":1}");
    }

    #[test]
    fn replaces_an_existing_file_wholesale_leaving_no_partial_content() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.json");
        write_atomic(&target, b"a-much-longer-original-payload").expect("first");
        write_atomic(&target, b"short").expect("second");
        assert_eq!(std::fs::read(&target).expect("read"), b"short");
    }

    #[test]
    fn leaves_no_temporary_files_behind() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.json");
        write_atomic(&target, b"{}").expect("write");
        let count = std::fs::read_dir(tmp.path()).expect("readdir").count();
        assert_eq!(count, 1, "only the target file should remain");
    }

    #[test]
    fn creates_missing_parent_directories() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("nested/deeper/settings.json");
        write_atomic(&target, b"{}").expect("write");
        assert!(target.is_file());
    }

    #[test]
    fn write_if_changed_skips_identical_content() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let target = tmp.path().join("settings.schema.json");
        assert!(
            write_if_changed(&target, b"same").expect("first"),
            "first write happens"
        );
        assert!(
            !write_if_changed(&target, b"same").expect("second"),
            "identical write is skipped"
        );
        assert!(
            write_if_changed(&target, b"different").expect("third"),
            "changed write happens"
        );
    }

    #[test]
    fn reports_the_error_when_the_target_directory_is_read_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("locked");
        std::fs::create_dir(&dir).expect("mkdir");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");

        let result = write_atomic(&dir.join("settings.json"), b"{}");

        // Restore permissions so the tempdir can be cleaned up.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("chmod");
        assert!(
            result.is_err(),
            "a read-only directory must surface an error"
        );
    }
}
