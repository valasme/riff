## [unreleased]

### 🚀 Features

- *(paths)* Resolve xdg directories with riff_* overrides
- *(error)* Add the adjacently tagged RiffError type
- *(logging)* One log directory per launch, with retention and live level
- *(storage)* Add atomic file replacement with parent fsync
- *(settings)* Add the settings model with lenient deserialisation
- *(settings)* Apply typed changes as a merge patch
- *(settings)* Add a forward-only schema migration runner
- *(settings)* Generate the json schema beside settings.json
- *(settings)* Add the store with quarantine, coalescing and reset
- *(settings)* Reload hand edits without echoing our own writes
- *(settings)* Coalesce writes so a slider drag is one fsync
- *(ipc)* Add application info and enum-scoped open commands
- *(ipc)* Add settings commands with rust-side file pickers
- *(ipc)* Add window control commands that report real decoration state
- *(bootstrap)* Inject settings and theme before the first page script
- *(app)* Wire the store, bootstrap, watcher and reveal watchdog
- *(ipc)* Add the hand-written typed command facade
- *(design)* Self-host outfit, playfair display and jetbrains mono
- *(design)* Add the token layer with theme, contrast and density axes
- *(design)* Apply appearance settings as html attributes
- *(design)* Add shadcn primitives retinted to the riff tokens
- *(i18n)* Initialise i18next with the english namespaces
- *(router)* Add tanstack router on hash history with file routes
- *(app)* Add providers, toasts and per-route error containment
- *(window)* Add the custom title bar and window controls
- *(shell)* Add the primary sidebar with a collapsible rail
- *(settings)* Add the zustand store with optimistic patching
- *(settings)* Add the settings layout and sub-navigation
- *(settings)* Add the appearance section
- *(settings)* Add the general section
- *(settings)* Add the about section with redacted diagnostics
- *(settings)* Honour the configured startup route
- *(settings)* Honour confirm before quitting
- *(onboarding)* Add the gate and theme suggestion
- *(onboarding)* Add the three-step first run
- *(keys)* Add deterministic chord resolution
- *(keys)* Add the keybinding registry and listener
- *(palette)* Add the alt+k navigation palette
- *(practice)* Add the static three-pane placeholder
- *(history)* Add the static table placeholder
- *(diagnostics)* Probe the host without dumping the environment
- *(diagnostics)* Write a full session banner to every log
- *(diagnostics)* Add health checks shared by doctor and repair
- *(diagnostics)* Assemble a redacted, size-capped export bundle
- *(cli)* Add doctor, repair, logs, config, paths and history
- *(about)* Export a redacted diagnostics bundle from settings
- *(logging)* Forward frontend errors into the session log
- *(about)* Generate and ship third-party licence notices

### 💼 Other

- Add biome for linting and formatting
- Enable strict typescript options and the @/ path alias
- Add tailwind v4 and the react compiler
- Add lefthook hooks and commitlint
- Deny unwrap in rust and add a cargo-deny licence allow-list
- *(tauri)* Strict csp, hidden themed window, three bundle targets
- Ship a man page, shell completions and troubleshooting docs
- Add icons, desktop entry and appstream metadata

### 📚 Documentation

- Add Riff foundation design spec
- Revise foundation spec after self-review
- Correct build-target reasoning in foundation spec
- Third review pass on foundation spec
- Add sequential implementation plans 01-11
- Add per-launch session logging, diagnostics export and a CLI
- Fix six defects that would fail at build or run
- Close fourteen gaps between the spec's promises and the plans
- Work through the remaining review findings
- Remove the unused opener JS package from the scaffold cleanup
- Mark plan 01 tasks complete
- Mark plan 02 tasks complete
- Mark plan 03 tasks complete
- Mark plan 04 tasks complete
- Mark plan 05 tasks complete
- Mark plan 06 tasks complete
- Mark plan 07 tasks complete
- Mark plan 08 tasks complete
- Mark plan 09 tasks complete
- Mark plan 10 tasks complete
- Mark plan 11 tasks complete

### 🧪 Testing

- Add vitest, testing library and an axe-core matcher
- *(ipc)* Pin payload shapes with a committed fixture
- *(shell)* Cover the root layout, keymap suppression and title bar

### ⚙️ Miscellaneous Tasks

- Ignore tauri build output and coverage
- Remove create-tauri-app demo code and relocate mockups
- Pin node, rust and pnpm toolchain versions
- Verify toolchain gates
- Verify rust core gates
- Verify settings store gates
- Verify ipc and window lifecycle gates
- Verify design system gates
- Verify app shell gates
- Verify settings frontend gates
- Verify onboarding gates
- Verify keybinding gates
- Verify placeholder gates
- Verify diagnostics and cli gates
