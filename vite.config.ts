/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react({
      babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { target: "safari16" },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // `__root.tsx` is included by name, not through `src/routes/**`,
      // because it accumulates the route announcer, lastRoute writing,
      // sidebar state, the keymap, the palette and the onboarding guard
      // across four plans — excluding the densest file in the frontend from
      // the gate that measures it is how it ends up with no tests at all.
      // The other files in `src/routes/` are one-line `createFileRoute(...)`
      // wiring with zero conditional logic; the component or redirect
      // helper each one wires up is tested directly in `src/features/**` or
      // `src/lib/**` instead.
      include: ["src/features/**", "src/lib/**", "src/stores/**", "src/routes/__root.tsx"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
