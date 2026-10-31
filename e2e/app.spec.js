import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";

// A phone-sized screen with touch, like the people this is for.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.errors = errors;
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

const built = page => page.evaluate(() => window.__built || 0);
async function waitForBuild(page, after) {
  await expect.poll(() => built(page), { timeout: 90000 }).toBeGreaterThan(after);
  await expect(page.locator("#status")).toHaveText("Ready");
}
const design = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.design)));

// Screen point of the top middle of a divider.
async function dividerPoint(page, id) {
  return page.evaluate(id => {
    const d = window.__app.design, div = d.dividers.find(x => x.id === id);
    const iw = d.width - 2 * d.wall, id_ = d.depth - 2 * d.wall;
    const p = div.axis === "x" ? [-iw / 2 + div.at, 0, d.height] : [0, -id_ / 2 + div.at, d.height];
    return window.__app.view.screenPoint(p);
  }, id);
}

test("starts with a 3 × 2 grid, drag a divider, change the size, download the STL", async ({ page }) => {
  await waitForBuild(page, 0);
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 40 mm, 6 pockets");

  // Drag the first front-to-back divider 20 mm to the right.
  let d = await design(page);
  const div = d.dividers.find(x => x.axis === "x");
  const from = await dividerPoint(page, div.id);
  const later = await page.evaluate(([id, at]) => {
    const d = window.__app.design, div = d.dividers.find(x => x.id === id);
    return window.__app.view.screenPoint([-(d.width - 2 * d.wall) / 2 + at, 0, d.height]);
  }, [div.id, div.at + 20]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(from.x + (later.x - from.x) * k / 8, from.y + (later.y - from.y) * k / 8);
  await page.mouse.up();
  d = await design(page);
  const moved = d.dividers.find(x => x.id === div.id).at;
  expect(Math.abs(moved - (div.at + 20))).toBeLessThan(2);
  // The divider is selected, with its own controls.
  await expect(page.locator("#selected")).toBeVisible();
  await expect(page.locator("#selected h4")).toHaveText("Front-to-back divider");

  // Delete it: a 3 × 2 grid less one divider leaves 2 × 2.
  await page.locator("#sel-delete").click();
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 40 mm, 4 pockets");

  // Type a new size; the box rebuilds.
  let n = await built(page);
  await page.locator("#d-width").fill("150");
  await page.locator("#d-width").press("Enter");
  await waitForBuild(page, n);
  await expect(page.locator("#summary")).toHaveText("150 × 80 × 40 mm, 4 pockets");

  // Add a lid and download: one STL for the box and one for the lid.
  await page.locator("details[data-group=lid] summary").click();
  n = await built(page);
  await page.locator('.tile[data-lid="lift"]').click();
  await waitForBuild(page, n);
  const downloads = [];
  page.on("download", dl => downloads.push(dl));
  await page.locator("#dl-stl").click();
  await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(2);
  const names = downloads.map(x => x.suggestedFilename()).sort();
  expect(names).toEqual(["storage-case-150x80x40-box.stl", "storage-case-150x80x40-lid.stl"]);
  const bytes = readFileSync(await downloads[0].path());
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
});

test("pick a layout and switch to inches", async ({ page }) => {
  await waitForBuild(page, 0);
  await page.locator('.tile[data-template="4x3"]').click();
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 40 mm, 12 pockets");
  await page.locator('[data-units="in"]').click();
  await expect(page.locator("#summary")).toHaveText("4.72 × 3.15 × 1.57 in, 12 pockets");
  await expect(page.locator("#d-width")).toHaveValue("4.72");
  // The choice is remembered.
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator("#summary")).toHaveText("4.72 × 3.15 × 1.57 in, 12 pockets");
});

test("drag the width handle to make the box wider", async ({ page }) => {
  await waitForBuild(page, 0);
  const pt = x => page.evaluate(x => window.__app.view.screenPoint([x, 0, window.__app.design.height / 2]), x);
  const from = await pt(60 + 10), to = await pt(90 + 10);
  const n = await built(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(from.x + (to.x - from.x) * k / 8, from.y + (to.y - from.y) * k / 8);
  await page.mouse.up();
  await waitForBuild(page, n);
  const d = await design(page);
  expect(Math.abs(d.width - 180)).toBeLessThan(4);
  // The grid stays even as the box grows.
  const xs = d.dividers.filter(x => x.axis === "x").map(x => x.at);
  expect(Math.abs(xs[1] - 2 * xs[0])).toBeLessThan(1);
});

test("the height handle stays on the back corner as the view turns", async ({ page }) => {
  await waitForBuild(page, 0);
  // From the default view (camera in front, to the right) it sits back left.
  const handle = await page.evaluate(() => window.__app.view.heightCorner);
  expect(handle).toEqual([-1, 1]);
  // Drag the view round to look from the back: the handle moves to the front.
  const box = await page.locator("#view canvas").boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + 30 + k * 35, box.y + box.height / 2);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__app.view.heightCorner[1])).toBe(-1);
});

test("add two trays, lay out the first, and download every part", async ({ page }) => {
  await waitForBuild(page, 0);
  await page.locator("#d-height").fill("60");
  await page.locator("#d-height").press("Enter");
  let n = await built(page);
  await page.locator("#add-tray").click();
  await waitForBuild(page, n);
  await expect(page.locator('[data-edit="box"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#tray-controls")).toBeVisible();
  // Tray 1 starts as one pocket; give it a 2 × 2 grid.
  await page.locator('.tile[data-template="2x2"]').click();
  let d = await design(page);
  expect(d.trays).toHaveLength(1);
  expect(d.trays[0].dividers).toHaveLength(2);
  expect(d.dividers).toHaveLength(3); // the box keeps its 3 × 2 grid

  n = await built(page);
  await page.locator("#add-tray").click();
  await waitForBuild(page, n);
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 60 mm, 6 pockets, 2 trays");

  // Back to the box: its dividers now stop below the trays.
  n = await built(page);
  await page.locator('[data-edit="box"]').click();
  await waitForBuild(page, n);
  d = await design(page);
  const top = await page.evaluate(() => window.__app.part.dividerTop);
  expect(top).toBeCloseTo(60 - d.trays[0].height - d.trays[1].height, 1);

  const downloads = [];
  page.on("download", dl => downloads.push(dl));
  await page.locator("#dl-stl").click();
  await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(3);
  expect(downloads.map(x => x.suggestedFilename()).sort()).toEqual([
    "storage-case-120x80x60-box.stl", "storage-case-120x80x60-tray-1.stl", "storage-case-120x80x60-tray-2.stl"]);
});
