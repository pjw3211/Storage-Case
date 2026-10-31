import { defineConfig } from "vite";

// Relative base so the built site works on GitHub Pages (served from /storage-case/)
// and when index.html is opened from any folder.
export default defineConfig({
  base: "./",
  test: { include: ["tests/**/*.test.js"] },
});
