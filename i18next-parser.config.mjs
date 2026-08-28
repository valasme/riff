export default {
  locales: ["en"],
  // Test files are excluded: i18n.test.ts deliberately calls
  // `t("common:doesNotExist")` to assert the missing-key fallback, and the
  // parser cannot tell that apart from a real usage.
  input: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
  output: "src/locales/$LOCALE/$NAMESPACE.json",
  defaultNamespace: "common",
  keySeparator: ".",
  namespaceSeparator: ":",
  sort: true,
  // Never blank out an existing translation and never silently drop a key a
  // human wrote. CI compares the result against what is committed.
  keepRemoved: true,
  createOldCatalogs: false,
};
