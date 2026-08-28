# Security Policy

## Supported versions

The most recent release only. Riff has no auto-update; please upgrade before reporting.

## Reporting a vulnerability

Report privately through [GitHub's security advisories](https://github.com/valasme/riff/security/advisories/new). Please do not open a public issue for a vulnerability.

Expect an acknowledgement within seven days.

## Threat model

Riff is a local desktop application with no network access whatsoever and no HTTP client compiled into it. Its webview holds exactly one capability, `core:default`, and no filesystem permission at all — every file operation goes through a Rust command that takes an enum rather than a path.

The interesting attack surface is therefore malformed local files: a hand-edited or corrupted `settings.json`, and eventually media files opened for playback.
