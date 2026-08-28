# 01 — Project Setup and Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `create-tauri-app` template into a disciplined project skeleton — demo code gone, toolchain pinned, and every quality gate that later plans rely on already failing loudly when it should.

**Architecture:** No application code is written here. Every task installs one gate and proves it works by making it fail first, then pass. Later plans assume `pnpm lint`, `pnpm typecheck`, `pnpm test` and `cargo clippy --all-targets -- -D warnings` all exist and are green.

**Tech Stack:** pnpm 11, Node 26, Rust 1.98, Vite 7, TypeScript 5.8, Tailwind CSS 4.3, Biome 2.5, Vitest 4, axe-core 4.13, lefthook 2.1, cargo-deny.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md`

## Global Constraints

Copied from the spec. Every task inherits these.

- **Platform:** Linux only. Requires webkit2gtk **4.1** (libsoup3) and **glibc ≥ 2.39**. Build and CI target is `ubuntu-24.04`.
- **Versions:** Tauri 2.11, React 19.1, Vite 7, TypeScript 5.8, Tailwind 4.3, pnpm 11, Node 26, Rust 1.98.
- **Zero network at runtime.** No HTTP client in either language. If a task appears to need one, the task is wrong.
- **Rust owns the filesystem.** The webview's only capability is `core:default`.
- **No caller-supplied paths across IPC.** Commands take enums; native pickers open in Rust.
- **Rust lints:** `clippy::unwrap_used` denied outside tests, `expect_used` allowed with a message. `cargo clippy --all-targets -- -D warnings` must pass.
- **Every user-visible string** goes through `t()`, including `aria-label`, tooltips, toasts and errors. English only.
- **Colour tokens** (dark / light): surface `#242424` / `#fafafa`; card `#323232` / `#f2f2f2`; raised `#3c3c3c` / `#eaeaea`; border `#4d4d4d` / `#d4d4d4`; separator `#313131` / `#e6e6e6`; foreground `#e4e4e4` / `#1c1c1c`; muted-foreground `#9a9a9a` / `#5f5f5f`. High contrast: border → `#6d6d6d` / `#8a8a8a`, muted-foreground → `#b0b0b0` / `#4a4a4a`. **There is no accent hue.**
- **Type:** Outfit Variable (UI), Playfair Display Italic 700 (wordmark only), JetBrains Mono Variable (paths, versions). Self-hosted; no runtime font fetch.
- **Icons:** `lucide-react` only.
- **Never install:** `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-resizable-panels`, `pdfjs-dist`, `eslint`, `prettier`, `vitest-axe`, `tauri-specta`, `specta`, or any HTTP client.
- **Commits:** Conventional Commits, one at the end of every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Scripts, dependencies, `packageManager` pin |
| `.nvmrc`, `rust-toolchain.toml` | Toolchain pins so CI and laptops agree |
| `.editorconfig` | Whitespace rules for editors Biome does not drive |
| `biome.json` | Lint + format for TS/TSX/JSON, a11y rules on |
| `tsconfig.json` | Strict TypeScript, `@/*` path alias |
| `vite.config.ts` | React Compiler, Tailwind, build target, Vitest config |
| `src/test/setup.ts` | Testing Library cleanup and jest-dom matchers |
| `src/test/axe.ts` | `toHaveNoAxeViolations` matcher over axe-core |
| `lefthook.yml` | pre-commit and commit-msg hooks |
| `commitlint.config.mjs` | Conventional Commits enforcement |
| `src-tauri/deny.toml` | Licence allow-list protecting the MIT distribution |
| `src-tauri/Cargo.toml` | Clippy lint levels |
| `docs/design/` | The three mockups, moved out of the repository root |

---

### Task 1: Ignore build output

The `create-tauri-app` scaffold is **already committed** — it landed alongside the docs, so there is no baseline commit to make. What is missing is the ignore rules for output the scaffold does not produce until you first build.

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Confirm the scaffold is tracked and the tree is clean**

Run: `git status --short && git ls-files src-tauri/Cargo.toml`
Expected: no output from the first command, and `src-tauri/Cargo.toml` from the second. If `git status` shows `??` entries for `src/` or `src-tauri/`, the scaffold is untracked after all — commit it unchanged first so later diffs are not buried in template noise.

- [ ] **Step 2: Ignore Tauri build output**

Append to `.gitignore`:

```gitignore

# Tauri
src-tauri/target/
src-tauri/gen/schemas/

# Test output
coverage/
```

- [ ] **Step 3: Verify the ignore rules took effect**

Run: `git status --short | grep -c 'src-tauri/target'`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: ignore tauri build output and coverage"
```

---

### Task 2: Remove the template demo code

**Interfaces:**
- Produces: `src/main.tsx` renders a single `<div id="app-root">` placeholder that Plan 06 replaces with the real shell.

**Files:**
- Delete: `src/App.tsx`, `src/App.css`, `src/assets/react.svg`, `public/tauri.svg`, `public/vite.svg`
- Modify: `src/main.tsx`, `index.html`, `src-tauri/src/lib.rs`
- Move: `Riff *.png` → `docs/design/`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/no_template_code.rs`:

```rust
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src-tauri && cargo test --test no_template_code`
Expected: FAIL — `src-tauri/src/lib.rs still contains the template greet command`

- [ ] **Step 3: Strip the demo command**

Replace the whole of `src-tauri/src/lib.rs` with:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}
```

- [ ] **Step 4: Delete the template's frontend assets**

```bash
rm src/App.tsx src/App.css src/assets/react.svg public/tauri.svg public/vite.svg
rmdir src/assets 2>/dev/null || true
pnpm remove @tauri-apps/plugin-opener
```

The opener plugin stays as a **Rust** dependency — `open_path` and
`open_external` use it — but its JavaScript package has no consumer and never
will: the webview holds one capability and calls the plugin through none of
them. Shipping it would be a dependency in the bundle for an API nothing
imports.

- [ ] **Step 5: Replace the entry point**

Overwrite `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <div id="app-root" />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Fix the document head**

Overwrite `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Riff</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Move the mockups out of the repository root**

```bash
mkdir -p docs/design
git mv "Riff Practice Route.png" docs/design/practice-route.png
git mv "Riff History Route.png"  docs/design/history-route.png
git mv "Riff Settings Route.png" docs/design/settings-route.png
```

- [ ] **Step 8: Run the test and the builds**

Run: `cd src-tauri && cargo test --test no_template_code && cargo build`
Expected: test PASS, build succeeds

Run: `pnpm build`
Expected: succeeds, `dist/` produced

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: remove create-tauri-app demo code and relocate mockups"
```

---

### Task 3: Pin the toolchain

**Files:**
- Create: `.nvmrc`, `rust-toolchain.toml`, `.editorconfig`
- Modify: `package.json`

- [ ] **Step 1: Pin Node**

Create `.nvmrc`:

```
26
```

- [ ] **Step 2: Pin Rust**

Create `rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.98.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

- [ ] **Step 3: Pin pnpm**

In `package.json`, add the `packageManager` field immediately after `"version"`:

```json
  "packageManager": "pnpm@11.3.0",
```

- [ ] **Step 4: Add editor defaults**

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.rs]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 5: Verify the pins resolve**

Run: `cd src-tauri && cargo fmt --version && rustc --version`
Expected: rustc reports `1.98.0`

Run: `pnpm -v`
Expected: `11.3.0`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: pin node, rust and pnpm toolchain versions"
```

---

### Task 4: Biome for linting and formatting

Biome replaces ESLint and Prettier entirely. Generate the config with `biome init` rather than pasting one, so the schema always matches the installed version.

**Files:**
- Create: `biome.json`
- Modify: `package.json`

- [ ] **Step 1: Install Biome and generate a baseline config**

```bash
pnpm add -D @biomejs/biome@2.5.11
pnpm exec biome init
```

- [ ] **Step 2: Configure it**

Overwrite `biome.json`, keeping the `$schema` line that `biome init` generated — it encodes the installed version:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.11/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": [
      "**",
      "!dist/**",
      "!src-tauri/target/**",
      "!coverage/**",
      "!src/routeTree.gen.ts"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "a11y": { "recommended": true },
      "suspicious": { "noExplicitAny": "error" },
      "style": { "noNonNullAssertion": "error" }
    }
  },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always" }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

`src/routeTree.gen.ts` is excluded deliberately. It is generated and committed, and CI regenerates it and diffs. If Biome reformats it on commit while the plugin writes its own style, that diff can never come back clean — the two formatters would fight forever over a file no human reads.

If `biome check` rejects a key, the installed schema differs — run `pnpm exec biome check --write` and consult the error, which names the offending path exactly. Do not silence rules to make it pass.

- [ ] **Step 3: Add the scripts**

In `package.json`, replace the `scripts` block:

```json
  "scripts": {
    "dev": "vite",
    "app": "tauri dev",
    "app:build": "tauri build",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "tauri": "tauri"
  },
```

`dev` stays `vite` on purpose: `tauri.conf.json` sets `beforeDevCommand` to `pnpm dev`, so renaming it to `tauri dev` would make the two invoke each other forever.

- [ ] **Step 4: Prove the linter actually rejects bad code**

Create `src/lint-probe.ts`:

```ts
export const probe: any = 1;
```

Run: `pnpm lint`
Expected: FAIL, reporting `noExplicitAny` in `src/lint-probe.ts`

- [ ] **Step 5: Remove the probe and confirm green**

```bash
rm src/lint-probe.ts
pnpm lint:fix
pnpm lint
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: add biome for linting and formatting"
```

---

### Task 5: Strict TypeScript with a path alias

**Interfaces:**
- Produces: the `@/*` alias, resolving to `src/*`. Every later plan imports with it.

**Files:**
- Modify: `tsconfig.json`, `vite.config.ts`

- [ ] **Step 1: Tighten the compiler options**

In `tsconfig.json`, add these inside `compilerOptions`:

```json
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["vite/client"],
```

Also add `"types": ["node"]` to `tsconfig.node.json`, which is the project that owns `vite.config.ts`: it imports `node:url` and reads `process.env`, and without `@types/node` those are errors nobody sees because `tsc --noEmit` does not build referenced projects. They surface the moment anyone runs `tsc -b` or opens the file in an editor.

`exactOptionalPropertyTypes` is deliberately **not** enabled: it fights third-party React prop types constantly and buys little in an application this size.

- [ ] **Step 2: Teach Vite the same alias**

Overwrite `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
```

- [ ] **Step 3: Prove the alias resolves**

Create `src/alias-probe.ts`:

```ts
export const aliasWorks = true;
```

Append to `src/main.tsx` (temporarily, as the last line):

```tsx
import { aliasWorks } from "@/alias-probe";
console.log(aliasWorks);
```

Run: `pnpm typecheck && pnpm build`
Expected: both succeed

- [ ] **Step 4: Remove the probe**

```bash
rm src/alias-probe.ts
```
Then delete the two lines you appended to `src/main.tsx`.

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: enable strict typescript options and the @/ path alias"
```

---

### Task 6: Tailwind CSS v4 and the React Compiler

**Files:**
- Create: `src/styles/globals.css`
- Modify: `vite.config.ts`, `src/main.tsx`, `package.json`

- [ ] **Step 1: Install**

```bash
pnpm add -D tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 babel-plugin-react-compiler@1.0.0
```

- [ ] **Step 2: Wire both plugins into Vite**

In `vite.config.ts`, add the import and replace the `plugins` array:

```ts
import tailwindcss from "@tailwindcss/vite";
```

```ts
  plugins: [
    react({
      babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] },
    }),
    tailwindcss(),
  ],
```

Also add the build target — WebKitGTK is the only engine this ever runs in:

```ts
  build: { target: "safari16" },
```

- [ ] **Step 3: Create the stylesheet**

Create `src/styles/globals.css`:

```css
@import "tailwindcss";
```

Plan 05 replaces this file with the full token system. For now it only has to prove the pipeline works.

- [ ] **Step 4: Import it and use one utility**

In `src/main.tsx`, add as the first import:

```tsx
import "@/styles/globals.css";
```

and change the placeholder element to:

```tsx
  <div id="app-root" className="flex" />
```

- [ ] **Step 5: Verify Tailwind emitted the utility**

Run: `pnpm build && grep -l 'display:flex' dist/assets/*.css`
Expected: prints a CSS filename. If it prints nothing, Tailwind is not scanning `src/` — check that `globals.css` is imported.

- [ ] **Step 6: Verify the React Compiler ran**

Run: `pnpm build 2>&1 | grep -i 'react-compiler\|babel' || echo "no compiler errors"`
Expected: no errors. The compiler is silent on success; a misconfiguration fails the build loudly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build: add tailwind v4 and the react compiler"
```

---

### Task 7: Vitest, Testing Library and the axe matcher

**Interfaces:**
- Produces: `expect(container).toHaveNoAxeViolations()`, imported by every UI test from Plan 05 onward via `src/test/setup.ts`.

**Files:**
- Create: `src/test/setup.ts`, `src/test/axe.ts`, `src/test/axe.test.tsx`
- Modify: `vite.config.ts`, `package.json`

- [ ] **Step 1: Install**

```bash
pnpm add -D @types/node vitest@4.1.11 @vitest/coverage-v8@4.1.11 jsdom \
  @testing-library/react@16.3.3 @testing-library/user-event @testing-library/jest-dom \
  axe-core@4.13.0
```

- [ ] **Step 2: Configure the test runner**

In `vite.config.ts`, add a `test` block after `build`:

```ts
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // `src/routes/**` is included because __root.tsx accumulates the
      // route announcer, lastRoute writing, sidebar state, the keymap, the
      // palette and the onboarding guard across four plans. Excluding the
      // densest file in the frontend from the gate that measures it is how
      // it ends up with no tests at all.
      include: ["src/features/**", "src/lib/**", "src/stores/**", "src/routes/**"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
```

- [ ] **Step 3: Write the axe matcher**

Create `src/test/axe.ts`:

```ts
import axe, { type RunOptions } from "axe-core";
import { expect } from "vitest";

/**
 * Colour contrast is disabled because jsdom does not compute layout or
 * resolved colours, so axe cannot evaluate it and would report false
 * negatives. Contrast is audited by hand in the spec, §7.3.
 */
export async function runAxe(container: Element, options: RunOptions = {}) {
  return axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
    ...options,
  });
}

expect.extend({
  async toHaveNoAxeViolations(received: Element) {
    const { violations } = await runAxe(received);
    if (violations.length === 0) {
      return { pass: true, message: () => "expected accessibility violations, found none" };
    }
    const detail = violations
      .map((v) => `  [${v.id}] ${v.help}\n    ${v.nodes.map((n) => n.html).join("\n    ")}`)
      .join("\n");
    return {
      pass: false,
      message: () => `expected no accessibility violations, found ${violations.length}:\n${detail}`,
    };
  },
});

declare module "vitest" {
  interface Matchers<T = unknown> {
    toHaveNoAxeViolations(): Promise<T>;
  }
}

// If `pnpm typecheck` reports that `toHaveNoAxeViolations` does not exist on
// the assertion, the installed Vitest names or parameterises this interface
// differently. Check `node_modules/vitest/dist/index.d.ts` for the interface
// `expect.extend` augments and match it — do not cast the expectation.
```

- [ ] **Step 4: Write the setup file**

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import "@/test/axe";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Write the failing test that proves the matcher detects real violations**

Create `src/test/axe.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("axe matcher", () => {
  it("passes on accessible markup", async () => {
    const { container } = render(
      <main>
        <img src="/x.png" alt="a description" />
      </main>,
    );
    await expect(container).toHaveNoAxeViolations();
  });

  it("fails on an image with no alt text", async () => {
    const { container } = render(
      <main>
        {/* biome-ignore lint/a11y/useAltText: deliberately broken, proving the matcher works */}
        <img src="/x.png" />
      </main>,
    );
    await expect(
      expect(container).toHaveNoAxeViolations(),
    ).rejects.toThrow(/image-alt/);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm test`
Expected: FAIL — `toHaveNoAxeViolations is not a function` or a module-resolution error, because the setup file is not yet picked up.

- [ ] **Step 7: Make it pass**

If Step 6 failed on config rather than the matcher, confirm `setupFiles` in `vite.config.ts` points at `./src/test/setup.ts` and that `@/` resolves inside tests (it does, via `resolve.alias`).

Run: `pnpm test`
Expected: PASS, 2 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: add vitest, testing library and an axe-core matcher"
```

---

### Task 8: Git hooks

**Files:**
- Create: `lefthook.yml`, `commitlint.config.mjs`
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
pnpm add -D lefthook@2.1.10 @commitlint/cli @commitlint/config-conventional
pnpm exec lefthook install
```

- [ ] **Step 2: Configure the hooks**

Create `lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  jobs:
    - name: biome
      glob: "*.{ts,tsx,js,jsx,json,css}"
      run: pnpm exec biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true
    - name: typecheck
      glob: "*.{ts,tsx}"
      run: pnpm typecheck
    - name: rustfmt
      glob: "*.rs"
      run: cd src-tauri && cargo fmt --check

commit-msg:
  jobs:
    - name: commitlint
      run: pnpm exec commitlint --edit {1}

pre-push:
  jobs:
    - name: tests
      run: pnpm test
    - name: cargo-test
      run: cd src-tauri && cargo test
```

- [ ] **Step 3: Configure commit message rules**

Create `commitlint.config.mjs`:

```js
export default { extends: ["@commitlint/config-conventional"] };
```

- [ ] **Step 4: Prove commitlint rejects a bad message**

Run: `echo "broken message" | pnpm exec commitlint`
Expected: FAIL — `subject may not be empty` / `type may not be empty`

- [ ] **Step 5: Prove it accepts a good one**

Run: `echo "feat: add a thing" | pnpm exec commitlint`
Expected: exit code 0, no output

- [ ] **Step 6: Run the pre-commit hook end to end**

Run: `pnpm exec lefthook run pre-commit`
Expected: all jobs pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build: add lefthook hooks and commitlint"
```

---

### Task 9: Rust lint gates and licence compliance

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/deny.toml`

- [ ] **Step 1: Set the lint levels**

Append to `src-tauri/Cargo.toml`:

```toml
[lints.clippy]
unwrap_used = "deny"
expect_used = "allow"
panic = "allow"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"

[lints.rust]
# `deny`, not `forbid`: forbid cannot be lifted by an #[allow], which is a
# known way to break proc-macro-generated code. Same protection, no trap.
unsafe_code = "deny"
```

`expect_used` stays allowed on purpose: a genuine invariant should be stated with a message explaining why it holds, and banning that only pushes people back to `unwrap`.

- [ ] **Step 2: Prove the gate bites**

Temporarily add to `src-tauri/src/lib.rs`:

```rust
pub fn probe() -> i32 {
    let v: Option<i32> = Some(1);
    v.unwrap()
}
```

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: FAIL — `used `unwrap()` on an `Option` value`

- [ ] **Step 3: Remove the probe and confirm green**

Delete the `probe` function.

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: PASS

`--all-targets` on purpose, and it is the form every later plan and CI use. Without it clippy checks only the lib target, so `unwrap_used` — the lint this gate exists for — never looks at a single test.

- [ ] **Step 4: Add the licence allow-list**

```bash
cargo install cargo-deny --locked
cd src-tauri && cargo deny init
```

Then edit `src-tauri/deny.toml` so the `[licenses]` section allows exactly:

```toml
allow = [
  "MIT",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "Unicode-3.0",
  "Zlib",
  "CC0-1.0",
]
```

GPL and AGPL are absent deliberately: a copyleft transitive dependency must not be able to enter an MIT binary unnoticed. If `cargo deny` later flags a genuinely needed crate, the decision to add its licence is a deliberate one, not a config tweak.

- [ ] **Step 5: Run the check**

Then set the other two sections CI runs, so `cargo deny check` means the same thing locally and in CI:

```toml
[bans]
multiple-versions = "warn"

[advisories]
yanked = "deny"
unmaintained = "workspace"
```

`unmaintained = "workspace"` limits the check to crates Riff depends on directly. The alternative, `all`, turns CI red on a transitive crate nobody can act on, and a check you cannot act on is a check you learn to ignore.

- [ ] **Step 5b: Run the check**

Run: `cd src-tauri && cargo deny check`
Expected: PASS. If a crate is rejected, read its licence before adding anything.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: deny unwrap in rust and add a cargo-deny licence allow-list"
```

---

### Task 10: Verify every gate together

- [ ] **Step 1: Run the whole suite the way CI will**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check
```

Expected: every command exits 0.

- [ ] **Step 2: Commit any lockfile drift**

```bash
git add -A
git commit -m "chore: verify toolchain gates" --allow-empty
```
