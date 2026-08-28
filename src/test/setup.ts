import "@testing-library/jest-dom/vitest";
import "@/test/axe";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
