// The exact solids: the box and lid come out the size asked for, dividers
// join the walls and floor, and the lid's lip fits inside the box.
import { describe, it, expect, beforeAll } from "vitest";
import { DEFAULT_DESIGN, normalize, gridDividers, inner, trayPart, boxPart, withPart, stackTop, slotLayout, RAIL } from "../src/design.js";

const LAYOUTS = [[1, 1], [2, 1], [2, 2], [3, 2], [4, 3]];
import { buildCase, buildShell, buildPieces, bounds, dividerBoxes } from "../src/cad/case.js";
import { partSTL } from "../src/cad/exports.js";
import { loadReplicad } from "./oc-node.js";

let R;
beforeAll(async () => { R = await loadReplicad(); }, 60000);

// Most tests here are for dividers printed in; slot-in ones have their own block.
const design = (extra = {}, cols = 1, rows = 1) => {
  const d = normalize({ ...DEFAULT_DESIGN, dividerStyle: "fixed", ...extra });
  return normalize({ ...d, dividers: gridDividers(d, cols, rows) });
};
const close = (a, b) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 1));

describe("the box", () => {
  for (const [cols, rows] of LAYOUTS)
    it(`a ${cols} × ${rows} grid is one solid of the right size`, () => {
      const d = design({}, cols, rows);
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
    let d = design({ height: 60, lid: "lift" });
    d = normalize({ ...d, trays: [{ id: "a", x: 0.25, y: 0.25, w: 58, d: 76.3, height: 15 }, { id: "b", x: 58.55, y: 0.25, w: 40, d: 40, height: 12 }] });
    const t = trayPart(d, d.trays[0]);
    return normalize(withPart(d, "a", { ...t, dividers: gridDividers(t, 2, 1) }));
  };

  it("each tray is its own part, the size asked for", () => {
    const d = withTrays(), parts = buildCase(R, d);
    expect(parts.map(p => p.id)).toEqual(["box", "lid", "tray-1", "tray-2"]);
    close(bounds(parts[2].solid).max, [29, 38.15, 15]);
    close(bounds(parts[3].solid).max, [20, 20, 12]);
    // Tray 1 has its divider, tray 2 is one open pocket.
    expect(R.measureVolume(parts[2].solid)).toBeGreaterThan(R.measureVolume(buildShell(R, trayPart(d, d.trays[0]))) + 100);
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

describe("free dividers", () => {
  it("a short divider is only as long as asked, and joins the wall it touches", () => {
    let d = design();
    d = normalize({ ...d, dividers: [{ id: "a", axis: "x", at: 50, from: 0, to: 30 }] });
    const box = buildCase(R, d)[0].solid, i = inner(d);
    const shell = R.measureVolume(buildShell(R, d));
    expect(R.measureVolume(box) - shell).toBeCloseTo(d.divider * 30 * i.h, -1);
    // One solid: the divider is joined to the front wall, not floating.
    expect(box.faces.length).toBeGreaterThan(10);
    const b = dividerBoxes(boxPart(d))[0];
    expect(b.min[1]).toBeCloseTo(-i.d / 2);
    expect(b.max[1]).toBeCloseTo(-i.d / 2 + 30);
  });
});

describe("slot-in dividers", () => {
  const slot = (dividers, extra = {}) => normalize({ ...DEFAULT_DESIGN, height: 30, ...extra, dividers });

  it("adds a channel in the box for each divider and prints the dividers flat as their own part", () => {
    const d = slot([{ id: "a", axis: "x", at: 58.4 }]), parts = buildCase(R, d);
    expect(parts.map(p => p.id)).toEqual(["box", "box-dividers"]);
    const i = inner(d), c = d.clearance, top = d.height;
    // The box is the shell plus two floor ribs and four wall ribs.
    const ribs = 2 * RAIL.width * RAIL.height * (i.d + 1) + 4 * RAIL.width * (RAIL.wall + 0.5) * (top - d.floor);
    const shell = R.measureVolume(buildShell(R, d));
    expect(R.measureVolume(parts[0].solid) - shell).toBeGreaterThan(ribs * 0.6);
    expect(R.measureVolume(parts[0].solid) - shell).toBeLessThan(ribs);
    close(bounds(parts[0].solid).max, [d.width / 2, d.depth / 2, d.height]);
    // The piece lies flat: as long as the inside less a gap each end, as tall as the inside, one divider thick.
    const b = bounds(parts[1].solid);
    close(b.min, [0, 0, 0]);
    close(b.max, [i.d - 2 * c, top - d.floor, d.divider]);
  });

  it("the channel is wide enough for the divider with a gap each side", () => {
    const d = slot([{ id: "a", axis: "x", at: 58.4 }]), i = inner(d);
    const rails = slotLayout(d).rails.filter(r => r.max[2] < d.floor + RAIL.height + 0.1);
    expect(rails).toHaveLength(2);
    const gap = rails[1].min[0] - rails[0].max[0];
    expect(gap).toBeCloseTo(d.divider + 2 * d.clearance, 3);
    expect((rails[0].max[0] + rails[1].min[0]) / 2).toBeCloseTo(-i.w / 2 + 58.4, 3);
  });

  it("crossing dividers get halving notches, and their channels leave room for each other", () => {
    const d = slot([{ id: "a", axis: "x", at: 58.4 }, { id: "b", axis: "y", at: 38.4 }]);
    const { pieces, rails } = slotLayout(d);
    const [a, b] = pieces, mid = d.floor + (d.height - d.floor) / 2;
    expect(a.notches).toEqual([{ at: 38.4, z0: mid, z1: d.height, w: d.divider + 2 * d.clearance }]);
    expect(b.notches).toEqual([{ at: 58.4, z0: d.floor, z1: mid, w: d.divider + 2 * d.clearance }]);
    // No rib runs through where the other divider stands.
    const i = inner(d), xs = -i.w / 2 + 58.4, ys = -i.d / 2 + 38.4;
    for (const r of rails) expect(r.min[0] < xs && r.max[0] > xs && r.min[1] < ys && r.max[1] > ys).toBe(false);
    // Both pieces print in one flat part.
    const flat = buildPieces(R, d), fb = bounds(flat);
    expect(fb.max[2]).toBeCloseTo(d.divider, 2);
    expect(R.measureVolume(flat)).toBeLessThan((a.b - a.a + b.b - b.a) * (d.height - d.floor) * d.divider);
  });

  it("a divider that ends at another stops a gap short of its face", () => {
    const d = slot([{ id: "a", axis: "x", at: 58.4 }, { id: "b", axis: "y", at: 38.4, from: 0, to: 58.4 }]);
    const b = slotLayout(d).pieces[1];
    expect(b.a).toBeCloseTo(d.clearance);
    expect(b.b).toBeCloseTo(58.4 - d.divider / 2 - d.clearance);
    expect(b.notches).toEqual([]);
  });

  it("tray dividers slot in too, and each tray's dividers are their own part", () => {
    let d = slot([], { height: 60 });
    d = normalize({ ...d, trays: [{ id: "a", x: 0.25, y: 0.25, w: 58, d: 76.3, height: 15 }] });
    const t = trayPart(d, d.trays[0]);
    d = normalize(withPart(d, "a", { ...t, dividers: gridDividers(t, 2, 1) }));
    expect(buildCase(R, d).map(p => p.id)).toEqual(["box", "tray-1", "tray-1-dividers"]);
  });
});

describe("rounded corners", () => {
  // A big corner radius, and a slot-in divider close to the left wall, inside the curve.
  const d = normalize({ ...DEFAULT_DESIGN, height: 30, radius: 20, dividers: [{ id: "a", axis: "x", at: 8 }] });
  const i = inner(d);

  it("a slot-in divider near a corner stops short of the curved wall, and its ribs start on it", () => {
    const { pieces, rails } = slotLayout(d), p = pieces[0];
    expect(p.a).toBeGreaterThan(d.clearance + 2);
    expect(p.b).toBeCloseTo(i.d - p.a, 3);
    // The piece, stood in place, doesn't touch the box anywhere.
    const box = buildCase(R, d)[0].solid;
    const t = d.divider, x0 = -i.w / 2 + p.at;
    const piece = R.makeBaseBox(t, p.b - p.a, p.z1 - p.z0).translate([x0, -i.d / 2 + (p.a + p.b) / 2, p.z0]);
    expect(R.measureVolume(box.intersect(piece))).toBeCloseTo(0, 2);
    // Every rib overlaps the box's walls or floor, so none float.
    const shell = buildShell(R, d);
    for (const r of rails) {
      const rib = R.makeBaseBox(r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2])
        .translate([(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, r.min[2]]);
      expect(R.measureVolume(shell.intersect(rib))).toBeGreaterThan(0.01);
    }
  }, 60000);

  it("away from the corners nothing changes", () => {
    const mid = normalize({ ...d, dividers: [{ id: "a", axis: "x", at: 58.4 }] });
    expect(slotLayout(mid).pieces[0].a).toBeCloseTo(d.clearance, 5);
  });
});
