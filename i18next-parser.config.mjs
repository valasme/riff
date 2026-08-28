export default {
  locales: ["en"],
  input: ["src/**/*.{ts,tsx}"],
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
