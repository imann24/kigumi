// Run against `npm run dev`. Playwright is an external browser-test prerequisite.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = process.env.ARTIFACT_DIR || "/tmp/kigumi-occlusion";
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
const results = [],
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${m.text()} (${m.location().url})`);
  });
  await page.goto(
    `${process.env.BASE_URL || "http://127.0.0.1:1420"}/tests/browser/occlusion.html`,
  );
  await page.waitForFunction(() => window.fixture);
  async function check(name, options, expected) {
    const result = await page.evaluate((options) => {
      fixture.setup(options);
      return fixture.compare();
    }, options);
    assert.ok(expected(result), `${name}: ${JSON.stringify(result)}`);
    results.push({ name, ...result });
    await page.screenshot({ path: `${out}/${name}.png` });
    return result;
  }
  const hidden = await check("hidden-and-visible", {}, (r) => r.changed > 100);
  // The fourth, visible villager is well outside every altered pixel.
  const visibleX = await page.evaluate(() => fixture.project(24, 0.4, 20)[0]);
  assert.ok(hidden.bounds[2] < visibleX - 10);
  await page.evaluate(() => fixture.plain());
  await page.screenshot({ path: `${out}/hidden-before.png` });
  // Disjoint silhouettes must all contribute, rather than just the last villager.
  const singles = [];
  for (const position of [
    [19, 17],
    [19.7, 17],
    [20.4, 17],
  ]) {
    singles.push(
      await page.evaluate((position) => {
        fixture.setup({ positions: [position] });
        return fixture.compare().changed;
      }, position),
    );
  }
  assert.equal(
    singles.reduce((a, b) => a + b, 0),
    hidden.changed,
  );
  const moved = await page.evaluate(() => {
    fixture.setup();
    fixture.scene.camera.position.set(20, 12, 2);
    fixture.scene.controls.update();
    fixture.scene.frame(200, 1, 0);
    return fixture.compare();
  });
  assert.equal(
    moved.changed,
    0,
    "orbiting the live scene must clear old outlines",
  );
  results.push({ name: "live-orbit-revealed", ...moved });
  const selected = await check(
    "selected",
    { selected: true },
    (r) => r.changed > 100,
  );
  assert.equal(
    selected.changed,
    hidden.changed,
    "selection must not change hidden silhouettes",
  );
  await check(
    "visible",
    {
      positions: [
        [19, 24],
        [20, 24],
        [21, 24],
      ],
    },
    (r) => r.changed === 0,
  );
  await check(
    "visible-selected",
    {
      positions: [
        [19, 24],
        [20, 24],
      ],
      selected: true,
    },
    (r) => r.changed === 0,
  );
  await check("no-buildings", { buildings: false }, (r) => r.changed === 0);
  await check("partial", { positions: [[22, 18.5]] }, (r) => r.changed > 5);
  for (let rotation = 0; rotation < 4; rotation++)
    await check(`rotation-${rotation}`, { rotation }, (r) => r.changed > 100);
  await check(
    "construction",
    { progress: 0.5, positions: [[19.5, 17.8]] },
    (r) => r.changed > 5,
  );
  await check("orbit-revealed", { orbit: Math.PI }, (r) => r.changed === 0);
  await check("zoom-out", { zoom: 0.65 }, (r) => r.changed > 5);
  for (const work of ["chop", "mine", "pick", "tend", "craft"]) {
    await check(`gather-${work}`, { work }, (r) => r.changed > 50);
    assert.ok((await page.evaluate(() => fixture.pose())) > 0);
    await page.evaluate(() => fixture.advance());
    assert.ok((await page.evaluate(() => fixture.compare())).changed > 50);
  }
  for (const kind of ["terrain", "resource"]) {
    await page.evaluate((kind) => {
      fixture.setup();
      fixture.blocker(kind);
    }, kind);
    const result = await page.evaluate(() => fixture.compare());
    assert.equal(result.changed, 0, `${kind} in front must suppress x-ray`);
    results.push({ name: `${kind}-blocks`, ...result });
  }
  // Resources alone cannot trigger the effect, nor can unplaced preview geometry.
  await page.evaluate(() => {
    fixture.setup({ buildings: false });
    fixture.blocker("resource");
  });
  assert.equal((await page.evaluate(() => fixture.compare())).changed, 0);
  await page.evaluate(() => {
    fixture.setup({ buildings: false });
    fixture.scene.preview("hall", { x: 18, z: 18 });
  });
  assert.equal((await page.evaluate(() => fixture.compare())).changed, 0);
  // Replacing a save with reused IDs must also remove the old silhouette pixels.
  await check(
    "replacement-visible",
    { positions: [[24, 24]] },
    (r) => r.changed === 0,
  );
  const memories = [];
  for (let i = 0; i < 6; i++)
    memories.push(
      (
        await page.evaluate(() => {
          fixture.setup();
          return fixture.compare();
        })
      ).memory,
    );
  assert.deepEqual(
    memories[5],
    memories[1],
    "world replacement must not grow GPU allocations",
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await check("resize", {}, (r) => r.changed > 100);
  results.push({
    name: "200-villagers",
    ...(await page.evaluate(() => fixture.benchmark(200))),
  });
  await page.evaluate(() => fixture.dispose());
  // A high-DPI canvas uses the same CSS-pixel width and resizes its own targets.
  const retina = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
  });
  retina.on("pageerror", (e) => errors.push(e.message));
  await retina.goto(
    `${process.env.BASE_URL || "http://127.0.0.1:1420"}/tests/browser/occlusion.html`,
  );
  await retina.waitForFunction(() => window.fixture);
  const dpi = await retina.evaluate(() => {
    fixture.setup();
    return fixture.compare();
  });
  assert.ok(dpi.changed > 100);
  results.push({ name: "high-dpi", ...dpi });
  await retina.screenshot({ path: `${out}/high-dpi.png` });
  await retina.evaluate(() => fixture.dispose());
  await retina.close();
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
