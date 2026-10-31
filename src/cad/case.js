// Exact solid model of a storage case, built with replicad (OpenCascade).
// Takes a design from src/design.js (millimetres) and returns each printable
// part as a solid, already the right way up to print.
//
// CAD frame: millimetres, Z up, X across the width, front faces -Y. The box
// is centred on X = Y = 0 with its floor on Z = 0.
import { inner, ends, boxPart, trayPart, slotLayout } from "../design.js";

// A rounded rectangle centred on the origin, extruded up from z0.
function slab(R, w, d, r, z0, h) {
  const sketch = r > 0.05 ? R.drawRoundedRectangle(w, d, r) : R.drawRectangle(w, d);
  return sketch.sketchOnPlane("XY", z0).extrude(h);
}

// The cavity inside the walls.
function cavity(R, d) {
  const i = inner(d);
  return slab(R, i.w, i.d, Math.max(0, d.radius - d.wall), d.floor, d.height);
}

// The box's (or a tray's) walls and floor with no dividers: what the 3D
// view shows, since the view draws the dividers itself so they can be dragged.
export function buildShell(R, d) {
  return slab(R, d.width, d.depth, d.radius, 0, d.height).cut(cavity(R, d));
}

// Divider boxes in the CAD frame, for the solid and for the 3D view. `d` is
// the box (boxPart) or a tray (trayPart): box dividers stop below the lid's lip.
export function dividerBoxes(d) {
  const i = inner(d), t = d.divider, cap = d.dividerTop ?? d.height;
  return d.dividers.map(x => {
    const top = Math.min(cap, x.height != null ? d.floor + x.height : d.height);
    const [f, e] = ends(d, x), S = x.axis === "x" ? i.d : i.w;
    // Ends at a wall run slightly into it so nothing is left floating.
    const a = f < 0.05 ? -0.5 : 0, b = e > S - 0.05 ? 0.5 : 0;
    return x.axis === "x"
      ? { id: x.id, min: [-i.w / 2 + x.at - t / 2, -i.d / 2 + f, 0], max: [-i.w / 2 + x.at + t / 2, -i.d / 2 + e, top], grow: [a, b] }
      : { id: x.id, min: [-i.w / 2 + f, -i.d / 2 + x.at - t / 2, 0], max: [-i.w / 2 + e, -i.d / 2 + x.at + t / 2, top], grow: [a, b] };
  });
}

const boxSolid = (R, b) => R.makeBaseBox(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  .translate([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]]);

// The finished box as one solid: the cavity is the inside minus the
// dividers, so each divider joins the walls and floor cleanly.
export function buildBox(R, d) {
  let space = cavity(R, d);
  for (const x of d.dividers) {
    const b = dividerBoxes({ ...d, dividers: [x] })[0], k = x.axis === "x" ? 1 : 0;
    const min = [...b.min], max = [...b.max];
    min[k] += b.grow[0]; max[k] += b.grow[1];
    space = space.cut(boxSolid(R, { min, max }));
  }
  return slab(R, d.width, d.depth, d.radius, 0, d.height).cut(space);
}

// A lift-off lid, printed top-down: the flat top on the bed, the lip on top
// of it. The lip fits inside the walls with the design's clearance all round.
export function buildLid(R, d) {
  const i = inner(d), c = d.clearance, lw = 1.2;
  const lipW = i.w - 2 * c, lipD = i.d - 2 * c, lipR = Math.max(0, d.radius - d.wall - c);
  const plate = slab(R, d.width, d.depth, d.radius, 0, d.floor);
  const lip = slab(R, lipW, lipD, lipR, d.floor - 0.01, d.lidLip + 0.01)
    .cut(slab(R, lipW - 2 * lw, lipD - 2 * lw, Math.max(0, lipR - lw), d.floor - 0.5, d.lidLip + 1));
  return plate.fuse(lip);
}

// The box (or a tray) with slot-in dividers: its walls and floor plus the
// ribs that make a channel for each divider.
export function buildSlotted(R, d) {
  let solid = buildShell(R, d);
  for (const b of slotLayout(d).rails) solid = solid.fuse(boxSolid(R, b));
  return solid;
}

// Every slot-in divider of a part, laid flat side by side to print, or null
// if there are none. Each lies on its face: length along X, height along Y.
export function buildPieces(R, d) {
  const { pieces } = slotLayout(d);
  if (!pieces.length) return null;
  const t = d.divider, GAP = 4;
  let all = null, y = 0;
  for (const p of pieces) {
    const L = p.b - p.a, H = p.z1 - p.z0;
    let s = boxSolid(R, { min: [0, y, 0], max: [L, y + H, t] });
    for (const n of p.notches) {
      const u = n.at - p.a;
      const lo = n.z0 - p.z0 <= 0.01 ? -0.5 : n.z0 - p.z0, hi = n.z1 - p.z0 >= H - 0.01 ? H + 0.5 : n.z1 - p.z0;
      s = s.cut(boxSolid(R, { min: [u - n.w / 2, y + lo, -0.5], max: [u + n.w / 2, y + hi, t + 0.5] }));
    }
    all = all ? all.fuse(s) : s;
    y += H + GAP;
  }
  return all;
}

/** Every part to print: [{ id, name, solid }]. */
export function buildCase(R, d) {
  const slot = d.dividerStyle !== "fixed";
  const parts = [];
  const add = (id, name, part) => {
    parts.push({ id, name, solid: slot ? buildSlotted(R, part) : buildBox(R, part) });
    const pieces = slot && buildPieces(R, part);
    if (pieces) parts.push({ id: id + "-dividers", name: name + " dividers", solid: pieces });
  };
  add("box", "Box", boxPart(d));
  if (d.lid === "lift") parts.push({ id: "lid", name: "Lid", solid: buildLid(R, d) });
  (d.trays || []).forEach((t, k) => add("tray-" + (k + 1), `Tray ${k + 1}`, trayPart(d, t)));
  return parts;
}

/** Axis-aligned bounds of a solid: { min: [x, y, z], max: [x, y, z] }. */
export function bounds(solid) {
  const b = solid.boundingBox.bounds;
  return { min: b[0], max: b[1] };
}
