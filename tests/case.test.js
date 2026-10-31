// The exact solids: the box and lid come out the size asked for, dividers
// join the walls and floor, and the lid's lip fits inside the box.
import { describe, it, expect, beforeAll } from "vitest";
import { DEFAULT_DESIGN, TEMPLATES, normalize, gridDividers, inner } from "../src/design.js";
import { buildCase, buildShell, bounds } from "../src/cad/case.js";
import { partSTL } from "../src/cad/exports.js";
import { loadReplicad } from "./oc-node.js";

let R;
beforeAll(async () => { R = await loadReplicad(); }, 60000);

const design = (extra = {}, cols = 1, rows = 1) => {
  const d = normalize({ ...DEFAULT_DESIGN, ...extra });
  return normalize({ ...d, dividers: gridDividers(d, cols, rows) });
};
const close = (a, b) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 1));

describe("the box", () => {
  for (const t of TEMPLATES)
    it(`${t.name} is one solid of the right size`, () => {
      const d = design({}, t.cols, t.rows);
      const [box] = buildCase(R, d);
      const b = bounds(box.solid);
      close(b.min, [-d.width / 2, -d.depth / 2, 0]);
      close(b.max, [d.width / 2, d.depth / 2, d.height]);
      expect(box.solid.faces.length).toBeGreaterThan(5);
      // Each divider adds its own volume to the walls and floor.
      const shell = R.measureVolume(buildShell(R, d));
      const i = inner(d), perX = d.divider * i.d * i.h, perY = d.divider * i.w * i.h;
      const nx = d.dividers.filter(x => x.axis === "x").length, ny = d.dividers.length - nx;
      const crossings = nx * ny * d.divider * d.divider * i.h;
      expect(R.measureVolume(box.solid) - shell).toBeCloseTo(nx * perX + ny * perY - crossings, -1);
      box.solid.delete();
    }, 60000);

  it("a lowered divider stops at its own height", () => {
    let d = design({}, 2, 1);
    d = normalize({ ...d, dividers: d.dividers.map(x => ({ ...x, height: 10 })) });
    const full = R.measureVolume(buildCase(R, design({}, 2, 1))[0].solid);
    const low = R.measureVolume(buildCase(R, d)[0].solid);
    const i = inner(d);
    expect(full - low).toBeCloseTo(d.divider * i.d * (i.h - 10), -1);
  });

  it("square corners work as well as rounded ones", () => {
    const [box] = buildCase(R, design({ radius: 0 }, 2, 2));
    close(bounds(box.solid).max, [60, 40, 40]);
  });
});

describe("the lid", () => {
  it("is only made when asked for", () => {
    expect(buildCase(R, design()).map(p => p.id)).toEqual(["box"]);
    expect(buildCase(R, design({ lid: "lift" })).map(p => p.id)).toEqual(["box", "lid"]);
  });

  it("covers the box and its lip fits inside the walls with the gap asked for", () => {
    const d = design({ lid: "lift", clearance: 0.3, lidLip: 6 });
    const lid = buildCase(R, d)[1].solid;
    const b = bounds(lid);
    close(b.min, [-d.width / 2, -d.depth / 2, 0]);
    close(b.max, [d.width / 2, d.depth / 2, d.floor + 6]);
    // A slice through the lip is the inside of the box less the gap all round.
    const i = inner(d);
    const slice = R.makeBaseBox(d.width + 10, d.depth + 10, 1).translate([0, 0, d.floor + 3]);
    const lb = bounds(lid.intersect(slice));
    close(lb.max.slice(0, 2), [i.w / 2 - 0.3, i.d / 2 - 0.3]);
  });
});

describe("STL", () => {
  it("writes a binary STL sitting on the bed", async () => {
    const [box] = buildCase(R, design({}, 3, 2));
    const blob = partSTL(box.solid);
    const buf = new DataView(await blob.arrayBuffer());
    const tris = buf.getUint32(80, true);
    expect(blob.size).toBe(84 + tris * 50);
    let minZ = Infinity;
    for (let t = 0; t < tris; t++) for (let v = 0; v < 3; v++) minZ = Math.min(minZ, buf.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true));
    expect(minZ).toBeCloseTo(0, 3);
  });
});
