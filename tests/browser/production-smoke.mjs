// Run after `npm run build` and `npm run preview`; no application instrumentation.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = process.env.ARTIFACT_DIR || "/tmp/kigumi-production-smoke";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [],
  expectedResourceErrors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      // The app has no favicon; keep this existing request separate from app/GL errors.
      const detail = `${m.text()} (${m.location().url})`;
      if (m.location().url.endsWith("/favicon.ico"))
        expectedResourceErrors.push(detail);
      else errors.push(detail);
    }
  });
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:4173");
  await page.locator("#pop").filter({ hasText: "10" }).waitFor();
  await page.locator("#pause").click();
  assert.equal(
    await page.locator("#pause").getAttribute("aria-label"),
    "Resume",
  );
  await page.locator("#population").click();
  assert.ok((await page.locator("#inspector").innerText()).includes("Village"));
  await page.locator("#grid").click();
  assert.equal(
    await page.locator("#grid").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-build="house"]').click();
  await page.locator("#rotate-building").click();
  assert.ok((await page.locator("#build-facing").innerText()).includes("East"));
  await page.keyboard.press("Escape");
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(780, 475, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.press("Home");
  await page.locator("#save").click();
  assert.ok((await page.locator("#toast").innerText()).includes("saved"));
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.ok(keys.some((k) => k.includes("manual")));
  await page.locator("#settings").click();
  await page.locator("#manual-load").click();
  await page.keyboard.press("Escape");
  await page.locator("#chrome-toggle").click();
  assert.equal(
    await page.locator("#chrome-toggle").getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: `${out}/production.png` });
  await page.locator("#chrome-toggle").click();
  assert.deepEqual(errors, []);
  const result = {
    errors,
    expectedResourceErrors,
    checks: [
      "WebGL startup",
      "pause",
      "overview",
      "grid",
      "rotation/cancel",
      "wheel zoom",
      "middle-button orbit",
      "home",
      "manual save/load",
      "interface toggle",
    ],
  };
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
