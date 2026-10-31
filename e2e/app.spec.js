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
  await expect(page.locator("#status")).not.toHaveText("Building…");
}
const design = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.design)));

// Screen point of a point in the box's inside frame (from the inside front-left corner) at height z.
const inside = (page, u, v, z) => page.evaluate(([u, v, z]) => {
  const d = window.__app.design, iw = d.width - 2 * d.wall, id = d.depth - 2 * d.wall;
  return window.__app.view.screenPoint([-iw / 2 + u, -id / 2 + v, z ?? d.height]);
}, [u, v, z]);

async function dragFromTo(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) await page.mouse.move(from.x + (to.x - from.x) * k / steps, from.y + (to.y - from.y) * k / steps);
  await page.mouse.up();
}

test("starts with one divider; drag it, resize the box and download the STL", async ({ page }) => {
  await waitForBuild(page, 0);
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 40 mm, 2 pockets");
  await expect(page.locator(".tile[data-template]")).toHaveCount(0); // no layout tiles

  // Drag the divider 20 mm to the right: tapping it picks it and shows the quick Delete.
  const div = (await design(page)).dividers[0];
  await dragFromTo(page, await inside(page, div.at, 38.4), await inside(page, div.at + 20, 38.4));
  const moved = (await design(page)).dividers[0].at;
  expect(Math.abs(moved - (div.at + 20))).toBeLessThan(2);
  await expect(page.locator("#quick")).toBeVisible();
  await expect(page.locator("#quick-name")).toHaveText("Divider 1 in box");
  await expect(page.locator('[data-tab="dividers"]')).toHaveAttribute("aria-selected", "true");

  // Type a new size in the Box tab; the box rebuilds.
  await page.locator('[data-tab="box"]').click();
  let n = await built(page);
  await page.locator("#d-width").fill("150");
  await page.locator("#d-width").press("Enter");
  await waitForBuild(page, n);
  await expect(page.locator("#summary")).toHaveText("150 × 80 × 40 mm, 2 pockets");

  // Add a lid and download: one STL for the box and one for the lid.
  n = await built(page);
  await page.locator('.tile[data-lid="lift"]').click();
  await waitForBuild(page, n);
  const downloads = [];
  page.on("download", dl => downloads.push(dl));
  await page.locator("#dl-stl").click();
  await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(2);
  expect(downloads.map(x => x.suggestedFilename()).sort()).toEqual(["storage-case-150x80x40-box.stl", "storage-case-150x80x40-lid.stl"]);
  const bytes = readFileSync(await downloads[0].path());
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
});

test("switch to inches, and the design is remembered", async ({ page }) => {
  await waitForBuild(page, 0);
  await page.locator('[data-units="in"]').click();
  await expect(page.locator("#summary")).toHaveText("4.72 × 3.15 × 1.57 in, 2 pockets");
  await expect(page.locator("#d-width")).toHaveValue("4.72");
  await page.reload();
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator("#summary")).toHaveText("4.72 × 3.15 × 1.57 in, 2 pockets");
});

test("drag the width handle to make the box wider", async ({ page }) => {
  await waitForBuild(page, 0);
  const pt = x => page.evaluate(x => window.__app.view.screenPoint([x, 0, window.__app.design.height / 2]), x);
  const n = await built(page);
  await dragFromTo(page, await pt(60 + 10), await pt(90 + 10), 8);
  await waitForBuild(page, n);
  const d = await design(page);
  expect(Math.abs(d.width - 180)).toBeLessThan(4);
  // The divider keeps its place as a share of the inside.
  expect(d.dividers[0].at).toBeCloseTo((d.width - 2 * d.wall) / 2, 0);
});

test("the height handle stays on the back corner as the view turns", async ({ page }) => {
  await waitForBuild(page, 0);
  expect(await page.evaluate(() => window.__app.view.heightCorner)).toEqual([-1, 1]);
  const box = await page.locator("#view canvas").boundingBox();
  // Start outside the box so the drag turns the view.
  await dragFromTo(page, { x: box.x + 15, y: box.y + box.height - 30 }, { x: box.x + 15 + 350, y: box.y + box.height - 30 });
  await expect.poll(() => page.evaluate(() => window.__app.view.heightCorner[1])).toBe(-1);
});

test("add trays, drag one around and it locks against two sides, give it dividers, download every part", async ({ page }) => {
  await waitForBuild(page, 0);
  await page.locator("#d-height").fill("60");
  await page.locator("#d-height").press("Enter");
  // Clear the box's divider so the trays sit on the floor.
  await page.locator('.part[data-pick*="divider"]').first().evaluate(b => b.click());
  await page.locator("#quick-delete").click();
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 60 mm, 1 pocket");

  await page.locator('[data-tab="trays"]').click();
  let n = await built(page);
  await page.locator("#add-tray").click();
  await waitForBuild(page, n);
  let d = await design(page);
  const t = d.trays[0];
  expect(t).toMatchObject({ x: 0.25, y: 0.25 });
  await expect(page.locator("#tray-editor")).toBeVisible();

  // Make it narrower and shallower so there is room to move it.
  n = await built(page);
  await page.locator("#t-w").fill("40"); await page.locator("#t-w").press("Enter");
  await page.locator("#t-d").fill("30"); await page.locator("#t-d").press("Enter");
  await waitForBuild(page, n);
  d = await design(page);
  expect(d.trays[0]).toMatchObject({ w: 40, d: 30 });

  // Drag it to the middle of the box: when let go it locks against two sides.
  const top = d.floor + d.trays[0].height;
  const from = await inside(page, d.trays[0].x + 20, d.trays[0].y + 15, top);
  const to = await inside(page, 95, 60, top); // near the back-right corner
  await dragFromTo(page, from, to);
  d = await design(page);
  const [tx, ty] = [d.trays[0].x, d.trays[0].y];
  const iw = d.width - 2 * d.wall, id = d.depth - 2 * d.wall, c = d.clearance;
  const sides = [Math.abs(tx - c) < 0.05, Math.abs(tx + 40 - (iw - c)) < 0.05, Math.abs(ty - c) < 0.05, Math.abs(ty + 30 - (id - c)) < 0.05].filter(Boolean).length;
  expect(sides).toBeGreaterThanOrEqual(2);
  expect(d.trays[0]).toMatchObject({ x: 76.55, y: 46.55 }); // locked into the back-right corner

  // A second tray, then dividers in the first.
  n = await built(page);
  await page.locator("#add-tray").click();
  await waitForBuild(page, n);
  await page.locator('.part[data-tray]').first().click();
  await page.locator("#t-dividers").click();
  await expect(page.locator("#div-parent")).toHaveValue(d.trays[0].id);
  await page.locator("#add-x").click();
  d = await design(page);
  expect(d.trays[0].dividers).toHaveLength(1);
  expect(d.dividers).toHaveLength(0);
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 60 mm, 1 pocket, 2 trays");

  const downloads = [];
  page.on("download", dl => downloads.push(dl));
  await page.locator("#dl-stl").click();
  await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(3);
  expect(downloads.map(x => x.suggestedFilename()).sort()).toEqual([
    "storage-case-120x80x60-box.stl", "storage-case-120x80x60-tray-1.stl", "storage-case-120x80x60-tray-2.stl"]);
});

test("shorten a divider by dragging its end, and it snaps to the divider it meets", async ({ page }) => {
  await waitForBuild(page, 0);
  await page.locator('[data-tab="dividers"]').click();
  await page.locator("#add-y").click(); // a side-to-side divider across the middle
  let d = await design(page);
  const div = d.dividers.find(x => x.axis === "x"), across = d.dividers.find(x => x.axis === "y");
  // Pick the front-to-back divider from the list, which shows its end dots.
  await page.locator(`[data-div="${div.id}"]`).click();
  await expect(page.locator("#sel-turn")).toBeVisible();
  await dragFromTo(page, await inside(page, div.at, div.to + 1), await inside(page, div.at, across.at + 2), 8);
  const after = (await design(page)).dividers.find(x => x.id === div.id);
  expect(after.to).toBeCloseTo(across.at, 1);
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 40 mm, 3 pockets");
  await page.locator("#sel-turn").click();
  expect((await design(page)).dividers.find(x => x.id === div.id).axis).toBe("y");
  await page.locator("#quick-delete").click();
  await expect(page.locator("#summary")).toHaveText("120 × 80 × 40 mm, 2 pockets");
});

test("a share link opens the same design", async ({ page, context }) => {
  await waitForBuild(page, 0);
  await page.locator('[data-tab="trays"]').click();
  await page.locator("#add-tray").click();
  const d = await design(page);
  const link = await page.evaluate(() => window.__app.shareLink());
  const other = await context.newPage();
  await other.goto(link);
  await other.waitForFunction(() => window.__ready === true);
  expect(await other.evaluate(() => JSON.parse(JSON.stringify(window.__app.design)))).toEqual(d);
  await expect(other.locator("#status")).toHaveText("Opened a shared design", { timeout: 60000 });
});

test("a picked tray gets its own handles: drag them to resize with soft stops, then copy it and a divider", async ({ page }) => {
  await waitForBuild(page, 0);
  await page.locator("#d-height").fill("60");
  await page.locator("#d-height").press("Enter");
  await page.locator('[data-tab="trays"]').click();
  await page.locator("#add-tray").click();
  await page.locator("#t-w").fill("40"); await page.locator("#t-w").press("Enter");
  await page.locator("#t-d").fill("30"); await page.locator("#t-d").press("Enter");
  const id = (await design(page)).trays[0].id;
  // The handles moved off the box onto the tray.
  const h = await page.evaluate(() => window.__app.view.handles);
  expect(h.part).toBe(id);

  // Drag the width handle out by about 19 mm: it sticks at 60 mm.
  const at = p => page.evaluate(p => window.__app.view.screenPoint(p), p);
  await dragFromTo(page, await at(h.width), await at([h.width[0] + 19, h.width[1], h.width[2]]), 8);
  let t = (await design(page)).trays[0];
  expect(t).toMatchObject({ x: 0.25, w: 60 });
  // The height handle: drag up about 15 mm to 35 mm.
  const hh = await page.evaluate(() => window.__app.view.handles.height);
  await dragFromTo(page, await at(hh), await at([hh[0], hh[1], hh[2] + 15]), 8);
  t = (await design(page)).trays[0];
  expect(t.height).toBe(35);
  await expect(page.locator("#t-w")).toHaveValue("60");

  // Copy the tray: the copy is picked, the same size, on the floor beside it.
  await page.locator("#t-copy").click();
  let d = await design(page);
  expect(d.trays).toHaveLength(2);
  expect(d.trays[1]).toMatchObject({ w: 60, d: 30, height: 35 });
  await expect(page.locator("#quick-name")).toHaveText("Tray 2");

  // Back on the box, its handles come back.
  await page.locator("#part-list .part").first().evaluate(b => b.click());
  expect((await page.evaluate(() => window.__app.view.handles)).part).toBe("box");

  // Copy a box divider.
  await page.locator('.part[data-pick*="divider"]').first().evaluate(b => b.click());
  await page.locator("#sel-copy").click();
  d = await design(page);
  expect(d.dividers).toHaveLength(2);
  await expect(page.locator("#quick-name")).toHaveText("Divider 2 in box");
});
