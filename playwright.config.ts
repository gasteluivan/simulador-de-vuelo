import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "browser.spec.ts",
  workers: 1,
  timeout: 90000,
  use: {
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--enable-webgl",
        "--use-angle=swiftshader",
      ],
    },
  },
});
