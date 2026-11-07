import { test, expect } from "@playwright/test";
const BASE = process.env.TEST_BASE_URL || "http://localhost:5173";
test("desktop scene, keyboard flight, settings and phone pairing", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await expect(
    page.getByRole("heading", { name: "Prepara el despegue." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png" });
  await page.locator('[data-mode="demo"]').click();
  await page.locator("#fly").click();
  await expect
    .poll(async () =>
      Number((await page.locator("#speed").innerText()).split(" ")[0]),
    )
    .toBeGreaterThan(5);
  const altitude = Number(
    (await page.locator("#altitude").innerText()).split(" ")[0],
  );
  await page.keyboard.down("w");
  await page.waitForTimeout(600);
  await page.keyboard.up("w");
  await expect
    .poll(async () =>
      Number((await page.locator("#altitude").innerText()).split(" ")[0]),
    )
    .toBeGreaterThan(altitude);
  await page.locator("#settings-button").click();
  await page.locator("#set-seed").fill("1234");
  await page.locator("#set-seed").dispatchEvent("input");
  await page.locator("#close-settings").click();
  await page.reload();
  await expect(page.locator("#set-seed")).toHaveValue("1234");
  await page.locator('[data-mode="phone"]').click();
  await expect(page.locator("#remote-link")).toHaveAttribute(
    "href",
    /controller\?room=/,
  );
  const href = await page.locator("#remote-link").getAttribute("href");
  await context.grantPermissions(["accelerometer", "gyroscope"]);
  const remote = await context.newPage();
  await remote.goto(href!);
  await expect(remote.locator("#remote-state")).toContainText("conectado");
  await expect(page.locator("#status")).toContainText("conectado");
  await expect(page.locator("#latency")).toContainText("directo", {
    timeout: 15000,
  });
  await remote.locator("#sensors").click();
  await expect(remote.locator("#remote-state")).toContainText("Mueve un poco");
  await remote.evaluate(() =>
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 0 }),
    ),
  );
  await expect(remote.locator("#remote-state")).toContainText(
    "Giroscopio activo",
  );
  await remote.evaluate(() =>
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta: 50, gamma: 18 }),
    ),
  );
  await expect(remote.locator("#tilt-values")).toContainText("18° / 20°");
  await page.locator("#fly").click();
  await expect
    .poll(async () =>
      Number((await page.locator("#speed").innerText()).split(" ")[0]),
    )
    .toBeGreaterThan(5);
  const intruder = await context.newPage();
  await intruder.goto(href!);
  await expect(intruder.locator("#remote-state")).toContainText(
    "ya tiene un mando",
  );
  await intruder.close();
  await remote.screenshot({ path: "test-results/controller.png" });
  await remote.close();
  await expect(page.locator("#status")).toContainText("Esperando");
  expect(errors).toEqual([]);
});
test("camera worker loads local models and preview can be hidden", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["camera"],
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.locator("#camera-toggle").click();
  await expect(page.locator("#camera-preview")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Buscando persona", {
    timeout: 60000,
  });
  await page.screenshot({ path: "test-results/camera.png" });
  await page.locator("#hide-preview").click();
  await expect(page.locator("#camera-preview")).toBeHidden();
  await page.locator("#gesture").selectOption("C");
  await expect(page.locator("#status")).toContainText("Buscando persona", {
    timeout: 60000,
  });
  await page.locator("#gesture").selectOption("A");
  await expect(page.locator("#status")).toContainText("Buscando persona", {
    timeout: 30000,
  });
  await page.locator("#camera-toggle").click();
  await expect(page.locator("#status")).toContainText("Cámara apagada");
  expect(errors).toEqual([]);
  await context.close();
});
test("mobile controller fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/controller?room=invalid`);
  await expect(page.locator("#sensors")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("diagnostics export real metrics and adaptive preference persists", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.locator("#settings-button").click();
  await page.locator("#diagnostics-option").check();
  await page.locator("#adaptive-option").uncheck();
  await page.locator("#close-settings").click();
  await expect(page.locator("#performance-values")).toContainText("FPS reales");
  await expect(page.locator("#performance-values")).toContainText("P95");
  const download = page.waitForEvent("download");
  await page.locator("#export-performance").click();
  expect((await download).suggestedFilename()).toMatch(
    /orbita-diagnostico.*json/,
  );
  await page.reload();
  await expect(page.locator("#performance-panel")).toBeVisible();
  await expect(page.locator("#adaptive-option")).not.toBeChecked();
});
test("phone uses server fallback when WebRTC is unavailable", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(window, "RTCPeerConnection", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto(BASE);
  await page.locator('[data-mode="phone"]').click();
  await expect(page.locator("#remote-link")).toHaveAttribute("href", /room=/);
  const remote = await context.newPage();
  await remote.goto((await page.locator("#remote-link").getAttribute("href"))!);
  await expect(page.locator("#status")).toContainText("conectado");
  await expect(page.locator("#latency")).toContainText("servidor");
  await expect
    .poll(async () =>
      Number((await page.locator("#latency").innerText()).match(/[\d.]+/)?.[0]),
    )
    .toBeGreaterThan(0);
  await remote.close();
});
test("compiled app reloads offline with prepared body and hand models", async ({
  browser,
}) => {
  test.skip(
    !process.env.TEST_BASE_URL,
    "Offline cache is enabled only in the production build",
  );
  test.setTimeout(120000);
  const context = await browser.newContext({ permissions: ["camera"] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.locator("#gesture").selectOption("C");
  await page.locator("#camera-toggle").click();
  await expect(page.locator("#status")).toContainText("Buscando persona", {
    timeout: 60000,
  });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator("#camera-toggle").click();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Prepara el despegue." }),
  ).toBeVisible();
  await page.locator("#gesture").selectOption("C");
  await page.locator("#camera-toggle").click();
  await expect(page.locator("#status")).toContainText("Buscando persona", {
    timeout: 60000,
  });
  expect(errors).toEqual([]);
  await context.close();
});
