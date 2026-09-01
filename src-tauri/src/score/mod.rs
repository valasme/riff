//! Score file coordination and bounded PDF inspection.

use std::ffi::OsStr;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use crate::error::{RiffError, RiffResult};

#[derive(Default)]
pub struct ScoreCoordinator(Mutex<CoordinatorState>);

#[derive(Default)]
struct CoordinatorState {
    next_ticket: u64,
    latest_ticket: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpenTicket(u64);

#[derive(Debug, PartialEq, Eq)]
pub struct ScoreFile {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
}

impl ScoreCoordinator {
    pub fn begin(&self) -> OpenTicket {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        state.next_ticket += 1;
        state.latest_ticket = state.next_ticket;
        OpenTicket(state.latest_ticket)
    }

    pub fn commit<T>(
        &self,
        ticket: OpenTicket,
        operation: impl FnOnce() -> RiffResult<T>,
    ) -> RiffResult<T> {
        let state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.latest_ticket != ticket.0 {
            return Err(RiffError::ScoreStale);
        }
        operation()
    }
}

pub(crate) fn inspect<R: Read + Seek>(reader: &mut R, size: u64) -> RiffResult<()> {
    let header_size = size.min(1_024) as usize;
    let mut header = vec![0; header_size];
    reader
        .read_exact(&mut header)
        .map_err(|error| RiffError::ScoreUnreadable {
            reason: error.to_string(),
        })?;
    if !header.windows(5).any(|window| window == b"%PDF-") {
        return Err(RiffError::ScoreUnreadable {
            reason: "no PDF header in the first 1024 bytes".to_owned(),
        });
    }
    let tail_size = size.min(2_048);
    reader
        .seek(SeekFrom::End(-(tail_size as i64)))
        .map_err(|error| RiffError::ScoreUnreadable {
            reason: error.to_string(),
        })?;
    let mut tail = vec![0; tail_size as usize];
    reader
        .read_exact(&mut tail)
        .map_err(|error| RiffError::ScoreUnreadable {
            reason: error.to_string(),
        })?;
    if !tail.windows(5).any(|window| window == b"%%EOF") {
        return Err(RiffError::ScoreUnreadable {
            reason: "no PDF end marker in the final 2048 bytes".to_owned(),
        });
    }
    Ok(())
}

fn score_io(name: &str, error: &io::Error) -> RiffError {
    match error.kind() {
        io::ErrorKind::NotFound => RiffError::ScoreMissing {
            name: name.to_owned(),
        },
        io::ErrorKind::PermissionDenied => RiffError::Denied {
            what: "reading the selected score".to_owned(),
        },
        _ => RiffError::ScoreUnreadable {
            reason: error.to_string(),
        },
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("Score.pdf")
        .to_owned()
}

pub async fn preflight(path: PathBuf) -> RiffResult<ScoreFile> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = display_name(&path);
        let mut file = File::open(&path).map_err(|error| score_io(&name, &error))?;
        let size = file
            .metadata()
            .map_err(|error| score_io(&name, &error))?
            .len();
        inspect(&mut file, size)?;
        Ok(ScoreFile { path, name, size })
    })
    .await
    .map_err(|_| RiffError::ScoreUnreadable {
        reason: "score I/O task did not complete".to_owned(),
    })?
}

pub async fn read_bytes(path: PathBuf) -> RiffResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = display_name(&path);
        std::fs::read(&path).map_err(|error| score_io(&name, &error))
    })
    .await
    .map_err(|_| RiffError::ScoreUnreadable {
        reason: "score I/O task did not complete".to_owned(),
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::Cursor;
    use std::rc::Rc;

    struct Counted {
        inner: Cursor<Vec<u8>>,
        reads: Rc<Cell<usize>>,
    }
    impl Read for Counted {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let count = self.inner.read(buffer)?;
            self.reads.set(self.reads.get() + count);
            Ok(count)
        }
    }
    impl Seek for Counted {
        fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
            self.inner.seek(position)
        }
    }

    #[test]
    fn coordinator_commits_only_the_latest_open_ticket() {
        let coordinator = ScoreCoordinator::default();
        let first = coordinator.begin();
        let second = coordinator.begin();
        let mut committed = Vec::new();
        assert_eq!(
            coordinator.commit(first, || {
                committed.push("first");
                Ok(())
            }),
            Err(RiffError::ScoreStale)
        );
        coordinator
            .commit(second, || {
                committed.push("second");
                Ok(())
            })
            .expect("latest ticket");
        assert_eq!(committed, ["second"]);
    }

    #[test]
    fn inspect_reads_only_the_header_and_tail_of_a_large_pdf() {
        let mut bytes = b"junk\n%PDF-1.7\n".to_vec();
        bytes.resize(2 * 1024 * 1024, b'0');
        bytes.extend_from_slice(b"\nstartxref\n12\n%%EOF\n");
        let reads = Rc::new(Cell::new(0));
        let mut reader = Counted {
            inner: Cursor::new(bytes.clone()),
            reads: Rc::clone(&reads),
        };
        inspect(&mut reader, bytes.len() as u64).expect("valid markers");
        assert!(reads.get() <= 3_072, "read {} bytes", reads.get());
    }

    #[test]
    fn inspect_accepts_a_header_within_the_first_kibibyte() {
        let mut bytes = vec![b' '; 700];
        bytes.extend_from_slice(b"%PDF-1.4\n%%EOF\n");
        inspect(&mut Cursor::new(bytes.clone()), bytes.len() as u64).expect("valid markers");
    }

    #[test]
    fn inspect_does_not_treat_an_unrelated_encrypt_literal_as_encryption() {
        let bytes = b"%PDF-1.7\n1 0 obj << /Note (/Encrypt) >> endobj\n%%EOF\n".to_vec();
        inspect(&mut Cursor::new(bytes.clone()), bytes.len() as u64).expect("valid markers");
    }

    #[test]
    fn both_filesystem_entry_points_use_the_blocking_pool() {
        let source = include_str!("mod.rs");
        assert_eq!(
            source
                .matches("spawn_blocking(move || {\n        let name")
                .count(),
            2
        );
    }
}
