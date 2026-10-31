// Exact solid model of a storage case, built with replicad (OpenCascade).
// Takes a design from src/design.js (millimetres) and returns each printable
// part as a solid, already the right way up to print.
//
// CAD frame: millimetres, Z up, X across the width, front faces -Y. The box
// is centred on X = Y = 0 with its floor on Z = 0.
import { inner, boxPart, trayPart, ledgeTop, LEDGE } from "../design.js";

// A rounded rectangle centred on the origin, extruded up from z0.
function slab(R, w, d, r, z0, h) {
  const sketch = r > 0.05 ? R.drawRoundedRectangle(w, d, r) : R.drawRectangle(w, d);
  return sketch.sketchOnPlane("XY", z0).extrude(h);
}

// The step round the inside walls that the bottom tray sits on.
function ledge(R, d) {
  const i = inner(d), top = ledgeTop(d), r = Math.max(0, d.radius - d.wall);
  if (!(d.trays || []).length || top - d.floor < 0.1) return null;
  return slab(R, i.w + 1, i.d + 1, r > 0 ? r + 0.5 : 0, d.floor - 0.01, top - d.floor + 0.01)
    .cut(slab(R, i.w - 2 * LEDGE, i.d - 2 * LEDGE, Math.max(0, r - LEDGE), d.floor - 1, top - d.floor + 2));
}

// The cavity inside the walls, less the tray ledge.
function cavity(R, d) {
  const i = inner(d);
  let c = slab(R, i.w, i.d, Math.max(0, d.radius - d.wall), d.floor, d.height);
  const l = ledge(R, d);
  return l ? c.cut(l) : c;
}

// The box's (or a tray's) walls and floor with no dividers: what the 3D
// view shows, since the view draws the dividers itself so they can be dragged.
export function buildShell(R, d) {
  return slab(R, d.width, d.depth, d.radius, 0, d.height).cut(cavity(R, d));
}

// Divider boxes in the CAD frame, for the solid and for the 3D view. `d` is
// the box (boxPart) or a tray (trayPart): box dividers stop below the trays
// and the lid's lip.
export function dividerBoxes(d) {
  const i = inner(d), t = d.divider, cap = d.dividerTop ?? d.height;
  return d.dividers.map(x => {
    const top = Math.min(cap, x.height != null ? d.floor + x.height : d.height);
    return x.axis === "x"
      ? { id: x.id, min: [-i.w / 2 + x.at - t / 2, -i.d / 2, 0], max: [-i.w / 2 + x.at + t / 2, i.d / 2, top] }
      : { id: x.id, min: [-i.w / 2, -i.d / 2 + x.at - t / 2, 0], max: [i.w / 2, -i.d / 2 + x.at + t / 2, top] };
  });
}

const boxSolid = (R, b) => R.makeBaseBox(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  .translate([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]]);

// The finished box as one solid: the cavity is the inside minus the
// dividers, so each divider joins the walls and floor cleanly.
export function buildBox(R, d) {
  let space = cavity(R, d);
  for (const b of dividerBoxes(d)) {
    // Dividers run slightly into the walls so nothing is left floating.
    const grow = b.max[0] - b.min[0] > b.max[1] - b.min[1] ? [[-0.5, 0, 0], [0.5, 0, 0]] : [[0, -0.5, 0], [0, 0.5, 0]];
    space = space.cut(boxSolid(R, { min: b.min.map((v, k) => v + grow[0][k]), max: b.max.map((v, k) => v + grow[1][k]) }));
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

/** Every part to print: [{ id, name, solid }]. */
export function buildCase(R, d) {
  const parts = [{ id: "box", name: "Box", solid: buildBox(R, boxPart(d)) }];
  if (d.lid === "lift") parts.push({ id: "lid", name: "Lid", solid: buildLid(R, d) });
  (d.trays || []).forEach((t, k) => parts.push({ id: "tray-" + (k + 1), name: `Tray ${k + 1}`, solid: buildBox(R, trayPart(d, t)) }));
  return parts;
}

/** Axis-aligned bounds of a solid: { min: [x, y, z], max: [x, y, z] }. */
export function bounds(solid) {
  const b = solid.boundingBox.bounds;
  return { min: b[0], max: b[1] };
}
