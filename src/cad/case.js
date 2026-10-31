// Exact solid model of a storage case, built with replicad (OpenCascade).
// Takes a design from src/design.js (millimetres) and returns each printable
// part as a solid, already the right way up to print.
//
// CAD frame: millimetres, Z up, X across the width, front faces -Y. The box
// is centred on X = Y = 0 with its floor on Z = 0.
import { inner } from "../design.js";

// A rounded rectangle centred on the origin, extruded up from z0.
function slab(R, w, d, r, z0, h) {
  const sketch = r > 0.05 ? R.drawRoundedRectangle(w, d, r) : R.drawRectangle(w, d);
  return sketch.sketchOnPlane("XY", z0).extrude(h);
}

// The box's walls and floor with no dividers: what the 3D view shows, since
// the view draws the dividers itself so they can be dragged.
export function buildShell(R, d) {
  const i = inner(d);
  return slab(R, d.width, d.depth, d.radius, 0, d.height)
    .cut(slab(R, i.w, i.d, Math.max(0, d.radius - d.wall), d.floor, d.height));
}

// Divider boxes in the CAD frame, for the solid and for the 3D view.
export function dividerBoxes(d) {
  const i = inner(d), t = d.divider;
  return d.dividers.map(x => {
    const top = x.height != null ? d.floor + x.height : d.height;
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
  const i = inner(d);
  let cavity = slab(R, i.w, i.d, Math.max(0, d.radius - d.wall), d.floor, d.height);
  for (const b of dividerBoxes(d)) {
    // Dividers run slightly into the walls so nothing is left floating.
    const grow = b.max[0] - b.min[0] > b.max[1] - b.min[1] ? [[-0.5, 0, 0], [0.5, 0, 0]] : [[0, -0.5, 0], [0, 0.5, 0]];
    cavity = cavity.cut(boxSolid(R, { min: b.min.map((v, k) => v + grow[0][k]), max: b.max.map((v, k) => v + grow[1][k]) }));
  }
  return slab(R, d.width, d.depth, d.radius, 0, d.height).cut(cavity);
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
  const parts = [{ id: "box", name: "Box", solid: buildBox(R, d) }];
  if (d.lid === "lift") parts.push({ id: "lid", name: "Lid", solid: buildLid(R, d) });
  return parts;
}

/** Axis-aligned bounds of a solid: { min: [x, y, z], max: [x, y, z] }. */
export function bounds(solid) {
  const b = solid.boundingBox.bounds;
  return { min: b[0], max: b[1] };
}
