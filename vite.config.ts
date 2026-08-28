/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
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
      // `src/routes/**` is included because __root.tsx accumulates the
      // route announcer, lastRoute writing, sidebar state, the keymap, the
      // palette and the onboarding guard across four plans. Excluding the
      // densest file in the frontend from the gate that measures it is how
      // it ends up with no tests at all.
      include: ["src/features/**", "src/lib/**", "src/stores/**", "src/routes/**"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
