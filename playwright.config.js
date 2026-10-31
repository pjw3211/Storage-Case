import { defineConfig } from "@playwright/test";

// CHROMIUM_PATH lets a machine with its own Chromium skip the browser download.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  // CI runners draw WebGL in software, so switching pieces and loading the
  // exact engine take far longer than on a real machine.
  timeout: 120000,
  use: {
    baseURL: "http://localhost:4173",
    launchOptions: { executablePath, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: { command: "npm run build && npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: !process.env.CI },
});
