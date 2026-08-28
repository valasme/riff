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
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

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
