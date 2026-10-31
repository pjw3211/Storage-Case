// The exact solids: the box and lid come out the size asked for, dividers
// join the walls and floor, and the lid's lip fits inside the box.
import { describe, it, expect, beforeAll } from "vitest";
import { DEFAULT_DESIGN, TEMPLATES, LEDGE, normalize, gridDividers, inner, trayPart, boxPart, withPart, ledgeTop, stackTop } from "../src/design.js";
import { buildCase, buildShell, bounds, dividerBoxes } from "../src/cad/case.js";
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

describe("trays", () => {
  const withTrays = () => {
    let d = design({ height: 60, lid: "lift" }, 3, 2);
    d = normalize({ ...d, trays: [{ id: "a", height: 15 }, { id: "b", height: 12 }] });
    const t = trayPart(d, d.trays[0]);
    return normalize(withPart(d, "a", { ...t, dividers: gridDividers(t, 2, 1) }));
  };

  it("each tray is its own part, sized to slide inside the walls", () => {
    const d = withTrays(), parts = buildCase(R, d), i = inner(d);
    expect(parts.map(p => p.id)).toEqual(["box", "lid", "tray-1", "tray-2"]);
    for (const [k, h] of [[2, 15], [3, 12]]) {
      const b = bounds(parts[k].solid);
      close(b.max, [i.w / 2 - d.clearance, i.d / 2 - d.clearance, h]);
    }
    // Tray 1 has its divider, tray 2 is one open pocket.
    expect(R.measureVolume(parts[2].solid)).toBeGreaterThan(R.measureVolume(buildShell(R, trayPart(d, d.trays[0]))) + 100);
  });

  it("the box has a ledge for the trays, and its dividers stop below it", () => {
    const d = withTrays(), box = buildCase(R, d)[0].solid, top = ledgeTop(d), i = inner(d);
    expect(top).toBeCloseTo(60 - 5 - 0.5 - 27);
    // A thin slice just below the ledge top holds the ledge; one just above it, only the walls.
    const slice = z => R.measureVolume(box.intersect(R.makeBaseBox(200, 200, 0.5).translate([0, 0, z])));
    const walls = slice(top + 1);
    expect(slice(top - 1)).toBeGreaterThan(walls * 1.5);
    // Above the ledge nothing crosses the inside: the trays have the space to themselves.
    const middle = R.makeBaseBox(i.w - 2 * LEDGE - 1, i.d - 2 * LEDGE - 1, stackTop(d) - top - 0.2).translate([0, 0, top + 0.1]);
    expect(R.measureVolume(box.intersect(middle))).toBeCloseTo(0, 1);
  });

  it("dividers stop below the lid's lip", () => {
    const d = design({ lid: "lift" }, 2, 1), box = buildCase(R, d)[0].solid;
    expect(dividerBoxes(boxPart(d))[0].max[2]).toBeCloseTo(stackTop(d));
    const i = inner(d);
    // The space the lip drops into, kept clear of the rounded inside corners.
    const lipZone = R.makeBaseBox(i.w - 6, i.d - 6, d.lidLip).translate([0, 0, d.height - d.lidLip]);
    expect(R.measureVolume(box.intersect(lipZone))).toBeCloseTo(0, 1);
  });
});
