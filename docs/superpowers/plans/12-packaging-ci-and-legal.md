# 12 — Packaging, CI and Legal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riff installable as deb, rpm and AppImage, with the licensing, documentation and automation an MIT project owes the people who download it.

**Architecture:** One build job on `ubuntu-24.04` produces all three bundles. Fedora and Debian appear only as **verification** containers, and a `glibc-floor` job turns "these binaries are portable" from an assumption into an assertion. Third-party licence data is generated from `pnpm` and `cargo metadata`, committed, and shipped as a bundled resource so About renders it with no network.

**Tech Stack:** GitHub Actions, `tauri-action@v1`, `git-cliff`, Dependabot.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§17, §19)

## Global Constraints

- **Everything builds on `ubuntu-24.04`.** Tauri v2 needs webkit2gtk **4.1**, whose earliest Ubuntu series is 24.04 — `libwebkit2gtk-4.1-dev` does not exist in 22.04. So 24.04 is both the oldest image that can build Riff and roughly the oldest system that can run it. Building on 26.04 would raise the glibc floor and lock out 24.04 users for nothing.
- **glibc floor is 2.39.** Asserted, not assumed.
- **Zero network at runtime.** Nothing in the shipped application may perform an HTTP request.
- **No external code contributions.** Bug reports are welcome; pull requests are declined. No `CONTRIBUTING.md`, no `CODE_OF_CONDUCT.md` — both advertise a collaboration model this project is not offering.
- **Licence:** MIT, `Copyright (c) 2026 valasme`. Repository `https://github.com/valasme/riff`.
- **The `.desktop` entry claims no video or audio MIME types.** Quietly becoming someone's default media player is hostile.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/icons/*` | Generated from the repository's `icon.png` |
| `src-tauri/riff.desktop` | Desktop entry template, including `StartupWMClass` |
| `src-tauri/io.github.valasme.riff.metainfo.xml` | AppStream metadata |
| `scripts/generate-licenses.mjs` | Produces the licence data from pnpm and cargo |
| `third-party-licenses.json`, `THIRD-PARTY-LICENSES.md` | Committed licence data |
| `src-tauri/src/commands/licenses.rs` | `licenses_get` |
| `.github/workflows/{ci,release}.yml` | Automation |
| `.github/{dependabot.yml,PULL_REQUEST_TEMPLATE.md,ISSUE_TEMPLATE/*}` | Repository policy |
| `LICENSE`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `cliff.toml` | Project documents |

---

### Task 1: Icons and desktop integration

**Files:**
- Create: `src-tauri/riff.desktop`, `src-tauri/io.github.valasme.riff.metainfo.xml`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/icons/*`

- [ ] **Step 0: Fix the package identity the scaffold left behind**

In `src-tauri/Cargo.toml`:

```toml
authors = ["valasme"]
description = "A local-first practice workspace for musicians"
license = "MIT"
repository = "https://github.com/valasme/riff"
```

and in `tauri.conf.json`, inside `bundle`:

```json
    "publisher": "valasme",
```

`publisher` is not cosmetic. Tauri defaults it to **the second element of the identifier**, so `io.github.valasme.riff` would ship a deb whose `Maintainer` field reads `github`. `authors = ["you"]` and `description = "A Tauri App"` are the template's, and both reach the package metadata.

- [ ] **Step 1: Generate the icon set from the supplied artwork**

```bash
pnpm tauri icon icon.png
```

This replaces the template placeholders in `src-tauri/icons/`. The generated set is committed so a clean checkout builds without running the generator.

- [ ] **Step 2: Write the desktop entry template**

Create `src-tauri/riff.desktop`:

```desktop
[Desktop Entry]
Type=Application
Name=Riff
Comment={{comment}}
Exec={{exec}} %U
Icon={{icon}}
Terminal=false
Categories={{categories}}
Keywords=music;practice;score;sheet;metronome;
StartupNotify=true
StartupWMClass=riff
```

`Name` is capitalised while the binary and `productName` stay lowercase `riff`.

`StartupWMClass` is the load-bearing line. Without it, Wayland compositors — Hyprland included — cannot associate the running window with this entry, and Riff shows a generic placeholder icon in docks and switchers. It looks exactly like a broken icon install and is one line to prevent.

There is deliberately no `MimeType=` key. Riff does not want to be anyone's default video player.

- [ ] **Step 3: Write the AppStream metadata**

Create `src-tauri/io.github.valasme.riff.metainfo.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>io.github.valasme.riff</id>
  <name>Riff</name>
  <summary>Practise with sheet music, video and audio in one place</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>
  <developer id="io.github.valasme">
    <name>valasme</name>
  </developer>
  <description>
    <p>
      Riff is a local-first practice workspace for musicians. It keeps a PDF score,
      a video lesson and an audio track side by side on one page, so you stop
      juggling three windows and start playing.
    </p>
    <p>
      Riff has no accounts and no telemetry, and makes no network connections at all.
      Everything it stores lives in your own XDG directories as plain, editable files.
    </p>
  </description>
  <launchable type="desktop-id">riff.desktop</launchable>
  <url type="homepage">https://github.com/valasme/riff</url>
  <url type="bugtracker">https://github.com/valasme/riff/issues</url>
  <content_rating type="oars-1.1" />
  <!-- Software centres will not show a version without this, which is the
       whole reason the file exists. git-cliff fills it on release. -->
  <releases>
    <release version="0.1.0" date="2026-08-28">
      <description><p>First release: onboarding, theming, navigation, the keyboard palette and fully working settings. Practice and History are visual placeholders.</p></description>
    </release>
  </releases>
  <screenshots>
    <screenshot type="default">
      <caption>The Practice workspace</caption>
      <image>https://raw.githubusercontent.com/valasme/riff/main/docs/design/practice-route.png</image>
    </screenshot>
  </screenshots>
  <categories>
    <category>Audio</category>
    <category>Music</category>
  </categories>
</component>
```

- [ ] **Step 4: Reference both from the bundle**

In `src-tauri/tauri.conf.json`, extend `bundle.linux`:

```json
    "linux": {
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"],
        "desktopTemplate": "riff.desktop",
        "files": {
          "/usr/share/metainfo/io.github.valasme.riff.metainfo.xml": "io.github.valasme.riff.metainfo.xml"
        }
      },
      "rpm": {
        "depends": ["webkit2gtk4.1", "gtk3"],
        "desktopTemplate": "riff.desktop",
        "files": {
          "/usr/share/metainfo/io.github.valasme.riff.metainfo.xml": "io.github.valasme.riff.metainfo.xml"
        }
      },
      "appimage": { "bundleMediaFramework": false }
    }
```

- [ ] **Step 5: Verify**

```bash
pnpm tauri build --bundles deb
dpkg-deb -c src-tauri/target/release/bundle/deb/*.deb | grep -E 'desktop|metainfo|icons'
```
Expected: the desktop entry, the metainfo file and the hicolor icons all appear.

```bash
dpkg-deb --fsys-tarfile src-tauri/target/release/bundle/deb/*.deb | tar xO ./usr/share/applications/riff.desktop | grep StartupWMClass
```
Expected: `StartupWMClass=riff`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: add icons, desktop entry and appstream metadata"
```

---

### Task 2: Third-party licences

**Interfaces:**
- Produces: `scripts/generate-licenses.mjs`, `third-party-licenses.json` (array of `{ name, version, license, ecosystem }`), and the `licenses_get` command.

**Files:**
- Create: `scripts/generate-licenses.mjs`, `src-tauri/src/commands/licenses.rs`
- Modify: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/src/commands/mod.rs`, `src/lib/ipc/*`, `AboutSection.tsx`

- [ ] **Step 1: Write the generator**

Create `scripts/generate-licenses.mjs`:

```js
#!/usr/bin/env node
// Produces the licence data shipped with Riff.
//
// Both outputs are COMMITTED, not generated at build time: they are declared
// in `bundle.resources`, so a build that generated them on the fly would fail
// on a clean checkout, and release artifacts would depend on network access to
// resolve licence metadata. CI regenerates and fails if the committed copies
// are stale — the same freshness pattern used for the route tree.
//
// Rust data comes from `cargo metadata`, which is built in. No extra tool.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function npmPackages() {
  const raw = JSON.parse(run("pnpm", ["licenses", "list", "--json", "--prod"]));
  const entries = [];
  for (const [license, packages] of Object.entries(raw)) {
    for (const pkg of packages) {
      entries.push({
        name: pkg.name,
        version: Array.isArray(pkg.versions) ? pkg.versions.join(", ") : String(pkg.versions ?? ""),
        license,
        ecosystem: "npm",
        text: licenseText(Array.isArray(pkg.paths) ? pkg.paths[0] : pkg.path),
      });
    }
  }
  return entries;
}

/** Reads the licence text a package ships, so the notices satisfy the
 *  licences rather than merely naming them. MIT, BSD and Apache-2.0 all
 *  require the notice to travel with every copy; a table of SPDX identifiers
 *  does not do that. */
function licenseText(dir) {
  if (!dir) return "";
  for (const name of readdirSync(dir)) {
    if (/^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(name)) {
      try {
        return readFileSync(`${dir}/${name}`, "utf8");
      } catch {
        /* keep going */
      }
    }
  }
  return "";
}

function cargoPackages() {
  const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1"], "src-tauri"));
  return meta.packages
    .filter((p) => p.name !== "riff")
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? "see repository",
      ecosystem: "cargo",
      text: licenseText(p.manifest_path?.replace(/\/Cargo\.toml$/, "")),
    }));
}

const all = [...npmPackages(), ...cargoPackages()].sort(
  (a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name),
);

writeFileSync("third-party-licenses.json", `${JSON.stringify(all, null, 2)}\n`);

const markdown = [
  "# Third-Party Licences",
  "",
  "Riff is MIT licensed. It builds on the following open-source packages.",
  "Regenerate with `pnpm licenses:generate`.",
  "",
  ...["npm", "cargo"].flatMap((ecosystem) => [
    `## ${ecosystem}`,
    "",
    "| Package | Version | Licence |",
    "| --- | --- | --- |",
    ...all
      .filter((e) => e.ecosystem === ecosystem)
      .map((e) => `| ${e.name} | ${e.version} | ${e.license} |`),
    "",
  ]),
  "## Licence texts",
  "",
  ...all
    .filter((e) => e.text)
    .flatMap((e) => [`### ${e.name} ${e.version}`, "", "```", e.text.trim(), "```", ""]),
].join("\n");

writeFileSync("THIRD-PARTY-LICENSES.md", markdown);
console.log(`wrote ${all.length} entries`);
```

Add to `package.json` scripts:

```json
    "licenses:generate": "node scripts/generate-licenses.mjs",
```

- [ ] **Step 2: Generate and inspect**

```bash
pnpm licenses:generate
head -20 third-party-licenses.json
```
Expected: a sorted array with `name`, `version`, `license`, `ecosystem`.

- [ ] **Step 3: Ship it as a resource**

In `src-tauri/tauri.conf.json`, add to `bundle`:

```json
    "resources": { "../third-party-licenses.json": "third-party-licenses.json" },
```

The **object form is required**, not stylistic. In array notation Tauri rewrites `..` to `_up_`, so the file would ship as `$RESOURCE/_up_/third-party-licenses.json` while `licenses_get` resolves `third-party-licenses.json` — the licence list would be empty in every packaged build and fine in development.

- [ ] **Step 4: Write the command**

Create `src-tauri/src/commands/licenses.rs`:

```rust
//! Third-party notices, read from a bundled resource so About works offline —
//! which, given Riff makes no network requests at all, is the only way it
//! could work.

use tauri::path::BaseDirectory;
use tauri::Manager;

use crate::error::{RiffError, RiffResult};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEntry {
    pub name: String,
    pub version: String,
    pub license: String,
    pub ecosystem: String,
}

#[tauri::command]
pub fn licenses_get(app: tauri::AppHandle) -> RiffResult<Vec<LicenseEntry>> {
    let path = app
        .path()
        .resolve("third-party-licenses.json", BaseDirectory::Resource)
        .map_err(|e| RiffError::NotFound { what: e.to_string() })?;

    let bytes = std::fs::read(&path).map_err(|e| RiffError::io(&path, &e))?;
    serde_json::from_slice(&bytes).map_err(|e| RiffError::parse(&path, &e))
}
```

Declare it in `src-tauri/src/commands/mod.rs` and add `$crate::commands::licenses::licenses_get,` to `riff_handlers!`.

- [ ] **Step 5: Render it**

Add to `src/lib/ipc/types.ts`:

```ts
export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  ecosystem: string;
}
```

Add to the `ipc` object in `src/lib/ipc/index.ts`:

```ts
  licensesGet: () => invoke<LicenseEntry[]>("licenses_get"),
```

In `AboutSection.tsx`, add a collapsed list. Several hundred entries mounted at once would be the only place in this application capable of janking, so rows render collapsed and expand one at a time:

```tsx
const [licenses, setLicenses] = useState<LicenseEntry[] | null>(null);

<details onToggle={(e) => {
  if (e.currentTarget.open && licenses === null) void ipc.licensesGet().then(setLicenses);
}}>
  <summary className="cursor-pointer py-4 text-[0.9375rem] font-medium">
    {t("settings:about.thirdParty")}
  </summary>
  <ul className="max-h-80 overflow-auto">
    {licenses?.map((entry) => (
      <li key={`${entry.ecosystem}-${entry.name}`} className="flex justify-between gap-4 py-1">
        <span className="font-mono text-xs">{entry.name}@{entry.version}</span>
        <span className="text-xs text-muted-foreground">{entry.license}</span>
      </li>
    ))}
  </ul>
</details>
```

Add `"thirdParty": "Third-party licences"` to `settings.about` in the locale file.

- [ ] **Step 6: Verify**

Run: `cd src-tauri && RIFF_UPDATE_FIXTURES=1 cargo test --test ipc_shapes && cargo test`
Then `pnpm app`, open Settings → About, expand the list.
Expected: packages listed with their licences.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(about): generate and ship third-party licence notices"
```

---

### Task 3: Repository documents

**Files:**
- Create: `LICENSE`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `cliff.toml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug_report.yml,config.yml}`, `.github/dependabot.yml`

- [ ] **Step 1: Licence**

Create `LICENSE` with the standard MIT text and the line:

```
Copyright (c) 2026 valasme
```

- [ ] **Step 2: README**

Overwrite `README.md`:

````markdown
# Riff

A local-first practice workspace for musicians. Riff keeps a PDF score, a video lesson and an audio track side by side on one page, so you stop juggling three windows and start playing.

Linux only.

![Practice](docs/design/practice-route.png)

## Status

The application foundation is complete: onboarding, theming, navigation, the keyboard palette and fully working settings. **Practice and History are visual placeholders** — PDF, video and audio playback are not implemented yet.

## Privacy

Riff makes **no network connections at all**. There is no HTTP client compiled into it, and its Content Security Policy blocks outbound requests. No accounts, no telemetry, no update check. Everything it stores lives in your own directories as plain, editable files:

| Path | Contents |
| --- | --- |
| `~/.config/riff/settings.json` | Your settings, with a JSON Schema beside it for editor completion |
| `~/.local/share/riff/` | Application data |
| `~/.local/state/riff/logs/` | Logs, rotated daily, seven kept |
| `~/.cache/riff/` | Regenerable cache |

You can edit `settings.json` in a text editor while Riff is running; it reloads live.

## Requirements

- **webkit2gtk 4.1** (libsoup3) and **glibc 2.39 or newer**

This is Tauri v2's own floor, not a packaging choice, and it is what excludes Ubuntu 22.04 and Debian 12 regardless of how Riff is built.

## Install

Download the deb, rpm or AppImage from the [releases page](https://github.com/valasme/riff/releases), then:

```bash
sudo apt install ./riff_*_amd64.deb     # Debian, Ubuntu
sudo dnf install ./riff-*.x86_64.rpm    # Fedora
chmod +x riff_*.AppImage && ./riff_*.AppImage
```

Verify a download against `sha256sums.txt`:

```bash
sha256sum -c sha256sums.txt --ignore-missing
```

Updates are manual: download a newer release when you want one. Your settings are untouched by reinstalling.

## Build from source

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
pnpm install
pnpm app          # development
pnpm app:build    # produces deb, rpm and AppImage
```

Node 26, Rust 1.98 and pnpm 11 — all pinned in `.nvmrc`, `rust-toolchain.toml` and `package.json`.

## Contributing

Riff is a personal project and **does not accept pull requests**. Bug reports and questions are genuinely welcome through [issues](https://github.com/valasme/riff/issues).

It is MIT licensed, so forking it and taking it wherever you like is explicitly fine.

## Licence

MIT — see [LICENSE](LICENSE). Third-party notices are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) and inside the application under Settings → About.
````

- [ ] **Step 3: Security policy**

Create `SECURITY.md`:

```markdown
# Security Policy

## Supported versions

The most recent release only. Riff has no auto-update; please upgrade before reporting.

## Reporting a vulnerability

Report privately through [GitHub's security advisories](https://github.com/valasme/riff/security/advisories/new). Please do not open a public issue for a vulnerability.

Expect an acknowledgement within seven days.

## Threat model

Riff is a local desktop application with no network access whatsoever and no HTTP client compiled into it. Its webview holds exactly one capability, `core:default`, and no filesystem permission at all — every file operation goes through a Rust command that takes an enum rather than a path.

The interesting attack surface is therefore malformed local files: a hand-edited or corrupted `settings.json`, and eventually media files opened for playback.
```

- [ ] **Step 4: Repository policy files**

`.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
Thank you for the interest, and sorry for the friction — **Riff does not accept pull requests.**

It is a personal project, and reviewing and maintaining outside contributions is not something I can commit to. This is not a judgement on your change.

Two things that genuinely help:

- **Bug reports and ideas** through [issues](https://github.com/valasme/riff/issues).
- **Forking.** Riff is MIT licensed; take it wherever you like.
```

`.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Something in Riff does not work
labels: [bug]
body:
  - type: textarea
    id: what
    attributes:
      label: What happened?
      description: What you expected, and what happened instead.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Open Settings → Appearance
        2. ...
    validations:
      required: true
  - type: textarea
    id: diagnostics
    attributes:
      label: Diagnostics
      description: >
        Settings → About → Copy diagnostics. Your home directory is replaced
        with $HOME automatically, so this is safe to paste publicly.
      render: text
    validations:
      required: true
  - type: input
    id: distro
    attributes:
      label: Distribution and desktop
      placeholder: Fedora 43, Hyprland
    validations:
      required: true
```

`.github/ISSUE_TEMPLATE/question.yml`:

```yaml
name: Question
description: Ask how something works
labels: [question]
body:
  - type: textarea
    id: question
    attributes:
      label: What would you like to know?
    validations:
      required: true
```

Without this, `blank_issues_enabled: false` leaves the bug form as the only
way to open an issue — while the README invites questions.

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
```

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: monthly }
    groups:
      npm: { patterns: ["*"] }
  - package-ecosystem: cargo
    directory: /src-tauri
    schedule: { interval: monthly }
    groups:
      cargo: { patterns: ["*"] }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: monthly }
```

- [ ] **Step 5: Changelog generation**

```bash
cargo install git-cliff --locked
git cliff --init
```

Then in `cliff.toml`, set the repository URL to `https://github.com/valasme/riff` and keep the conventional-commit parsers.

Run: `git cliff --unreleased --output CHANGELOG.md`

- [ ] **Step 6: Write `CLAUDE.md`**

Named in spec §19 and built nowhere. It is the map a future session — human or
agent — gets instead of reading twelve plans: what Riff is, the four
invariants from Plan 03, the no-caller-supplied-paths rule, the single
capability, the zero-network constraint, where the spec lives, and the gate
commands. Short. It is a pointer, not a duplicate.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: add licence, readme, security policy and repository templates"
```

---

### Task 4: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  CARGO_TERM_COLOR: always

permissions:
  contents: read

jobs:
  # ubuntu-24.04, not 26.04: Tauri v2 needs webkit2gtk 4.1, whose earliest
  # Ubuntu series is 24.04, and building on a newer image would raise the
  # glibc floor of the release artifacts for no benefit.
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Route tree is current
        run: |
          pnpm exec vite build >/dev/null
          git diff --exit-code src/routeTree.gen.ts

      - name: Licence data is current
        run: |
          pnpm licenses:generate
          git diff --exit-code third-party-licenses.json THIRD-PARTY-LICENSES.md

      # Deliberately NOT `git diff --exit-code src/locales`. The catalogues are
      # hand-written, i18next-parser reformats and reorders them, and it cannot
      # see composed keys like t(`settings:appearance.themeOptions.${v}`) — so
      # a byte-identical gate fails on its first run for reasons nobody can
      # act on. What matters is that no key a component asks for is missing.
      - name: Translations cover every extracted key
        run: |
          pnpm i18n:extract --output "/tmp/extracted/\$LOCALE/\$NAMESPACE.json"
          node -e '
            const fs = require("node:fs");
            const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
              v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]);
            let missing = 0;
            for (const file of fs.readdirSync("/tmp/extracted/en")) {
              const want = flat(JSON.parse(fs.readFileSync(`/tmp/extracted/en/${file}`)));
              const have = new Set(flat(JSON.parse(fs.readFileSync(`src/locales/en/${file}`))));
              for (const key of want) if (!have.has(key)) { console.error(`missing ${file}:${key}`); missing++; }
            }
            process.exit(missing ? 1 : 0);
          '"

      - name: No untranslated keys
        run: |
          node -e '
            const fs = require("node:fs");
            let missing = 0;
            for (const file of fs.readdirSync("src/locales/en")) {
              const walk = (o, path) => {
                for (const [k, v] of Object.entries(o)) {
                  if (typeof v === "object" && v !== null) walk(v, path + "." + k);
                  else if (v === "") { console.error("empty: " + path + "." + k); missing++; }
                }
              };
              walk(JSON.parse(fs.readFileSync("src/locales/en/" + file)), file);
            }
            process.exit(missing ? 1 : 0);
          '

      - name: Frontend tests
        run: pnpm test:coverage

      - name: Rust format
        run: cargo fmt --check --manifest-path src-tauri/Cargo.toml

      - name: Clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

      - name: Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml

      - name: Dependency review
        if: github.event_name == 'pull_request'
        uses: actions/dependency-review-action@v4
        with:
          deny-licenses: GPL-2.0, GPL-3.0, AGPL-3.0

      - name: Licence compliance
        uses: EmbarkStudios/cargo-deny-action@v2
        with:
          manifest-path: src-tauri/Cargo.toml
          command: check

      - name: Build
        run: pnpm tauri build --no-bundle

      - name: Bundle size budget
        run: |
          # The ENTRY chunk, not every chunk concatenated. With
          # autoCodeSplitting the route chunks are lazy, so summing them
          # measures a number no user ever downloads at once.
          ENTRY=$(node -e "const m=require('fs').readdirSync('dist/assets').filter(f=>/^index-.*\.js$/.test(f));if(!m.length){console.error('no entry chunk');process.exit(1)}console.log('dist/assets/'+m[0])")
          BYTES=$(gzip -c "$ENTRY" | wc -c)
          echo "entry chunk ${ENTRY}: ${BYTES} bytes gzipped"
          test "$BYTES" -lt 256000 || { echo "::error::bundle exceeds the 250 KB gzipped budget"; exit 1; }
```

There is deliberately **no newer-runner canary job.** The development machine runs Arch, with glibc and WebKitGTK newer than any Ubuntu image, so it already exercises the newest toolchain daily. A CI job asserting the same thing would be a permanently-ignorable check, and ignorable checks train you to ignore checks.

- [ ] **Step 2: Verify locally with `act` or by pushing a branch**

Run every step by hand first:

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm tauri build --no-bundle
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: add lint, typecheck, test and build workflow"
```

---

### Task 5: Release

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write
  # Lets the build attest its own artifacts. Updates are manual, so a release
  # page is the whole trust story: sha256sums proves a download was not
  # corrupted, and proves nothing about who produced it, because whoever can
  # replace the artifact can replace the sums beside it.
  id-token: write
  attestations: write

jobs:
  bundle:
    runs-on: ubuntu-24.04
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: src-tauri }

      - run: pnpm install --frozen-lockfile

      - id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      # Spec §16 says CI asserts these agree. Without it, tagging v0.2.0 while
      # package.json still reads 0.1.0 builds artifacts named 0.1.0 and
      # publishes them under a release titled 0.2.0.
      - name: Tag matches the manifests
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG=$(node -p "require('./package.json').version")
          CARGO=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
          echo "tag=$TAG package.json=$PKG Cargo.toml=$CARGO"
          test "$TAG" = "$PKG" && test "$PKG" = "$CARGO"

      # build.rs must declare these, or Swatinem/rust-cache restores a build
      # that was compiled with a different SHA and the binary reports a stale
      # commit. option_env! alone registers no rerun-if-env-changed.
      - name: Stamp the build
        run: |
          echo "RIFF_BUILD_DATE=$(date -u +%Y-%m-%d)" >> "$GITHUB_ENV"
          echo "RIFF_GIT_SHA=$(git rev-parse --short HEAD)" >> "$GITHUB_ENV"

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: Riff ${{ steps.version.outputs.version }}
          releaseDraft: true
          args: --bundles deb,rpm,appimage

      # Turns "these binaries are portable" from an assumption into an
      # assertion. A future runner-image bump cannot silently narrow the
      # audience; that regression is otherwise only found from a bug report.
      - name: Assert the glibc floor
        run: |
          BIN=src-tauri/target/release/riff
          MAX=$(objdump -T "$BIN" | grep -oP 'GLIBC_\K[0-9.]+' | sort -V | tail -1)
          echo "highest required glibc symbol: $MAX"
          test "$(printf '%s\n2.39\n' "$MAX" | sort -V | tail -1)" = "2.39" \
            || { echo "::error::binary requires glibc $MAX, above the 2.39 floor"; exit 1; }

      - uses: actions/attest-build-provenance@v2
        with:
          subject-path: |
            src-tauri/target/release/bundle/**/*.deb
            src-tauri/target/release/bundle/**/*.rpm
            src-tauri/target/release/bundle/**/*.AppImage

      - uses: actions/upload-artifact@v4
        with:
          name: bundles
          path: |
            src-tauri/target/release/bundle/**/*.deb
            src-tauri/target/release/bundle/**/*.rpm
            src-tauri/target/release/bundle/**/*.AppImage

  # Fedora and Debian are verification environments, never build hosts.
  # "The package built" and "the package installs and its libraries resolve"
  # are different claims, and only the second matters to someone downloading it.
  verify:
    needs: bundle
    runs-on: ubuntu-24.04
    strategy:
      fail-fast: false
      matrix:
        include:
          - image: fedora:latest
            install: dnf install -y ./*.rpm
            pattern: "*.rpm"
            deps: dnf install -y binutils findutils
          - image: debian:trixie
            install: apt-get install -y ./*.deb
            pattern: "*.deb"
            deps: apt-get update && apt-get install -y binutils findutils
    container: ${{ matrix.image }}
    steps:
      - uses: actions/download-artifact@v4
        with: { name: bundles, path: bundles }

      - name: Install and check that every library resolves
        run: |
          ${{ matrix.deps }}
          find bundles -name '${{ matrix.pattern }}' -exec cp {} . \;
          ${{ matrix.install }}
          MISSING=$(ldd "$(command -v riff)" | grep 'not found' || true)
          test -z "$MISSING" || { echo "::error::unresolved libraries:"; echo "$MISSING"; exit 1; }

  notes:
    needs: [bundle, verify]
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: actions/download-artifact@v4
        with: { name: bundles, path: bundles }

      - name: Checksums
        run: |
          find bundles -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
            -exec sha256sum {} + | sed 's|bundles/.*/||' > sha256sums.txt
          cat sha256sums.txt

      - uses: orhun/git-cliff-action@v4
        with: { args: --latest --strip header }
        env: { OUTPUT: RELEASE_NOTES.md }

      - uses: softprops/action-gh-release@v2
        with:
          draft: true
          body_path: RELEASE_NOTES.md
          files: sha256sums.txt
```

- [ ] **Step 2: Dry run**

```bash
git tag v0.1.0-rc.1 && git push origin v0.1.0-rc.1
```
Expected: `bundle` produces all three artifacts, `glibc-floor` passes, `verify` installs cleanly in both containers, and a draft release appears. Delete the tag and the draft afterwards.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: add the release workflow with glibc and install verification"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run every gate**

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check
```
Expected: all exit 0.

- [ ] **Step 2: Walk the definition of done from the spec, §22**

Check each by hand and record the result in the commit message:

```bash
rm -rf ~/.config/riff ~/.local/share/riff ~/.local/state/riff
pnpm app
```

- Onboarding appears; completing it never shows it again
- Every Settings control persists across a restart
- Editing `settings.json` externally updates the running application
- `printf 'broken' > ~/.config/riff/settings.json`, relaunch: defaults load, the original is kept as `settings.json.corrupt-*`, and a toast explains it
- Theme, density, scale and contrast apply instantly, with the correct theme on the first painted frame
- Alt+K and the title bar button both open the palette
- Practice and History match the mockups and are inert
- The whole application is operable by keyboard alone
- `ss -tup | grep -i riff` prints nothing

- [ ] **Step 3: Confirm the version is consistent across all three manifests**

```bash
node -p "require('./package.json').version"
grep '^version' src-tauri/Cargo.toml
grep '"version"' src-tauri/tauri.conf.json
```
Expected: `package.json` and `Cargo.toml` agree; `tauri.conf.json` reads `"../package.json"`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify the foundation against the definition of done"
```
