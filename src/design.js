// A storage case design as plain data, and the print rules that keep it
// printable. Everything is in millimetres. The 3D view, the solid builder
// and saved designs all read this one description.
//
// Frame: X across the width, Y front to back, Z up. The box sits on Z = 0,
// centred on X = Y = 0. Divider positions are measured from the inside
// left wall (dividers across X) or the inside front wall (dividers across Y).

export const IN = 25.4;

// Print rules: [smallest, largest] in mm.
export const LIMITS = {
  width: [20, 300], depth: [20, 300], height: [10, 250],
  wall: [0.8, 5], floor: [0.6, 5], divider: [0.8, 3],
  radius: [0, 30], clearance: [0.1, 0.6], lidLip: [2, 15],
};

export const MIN_POCKET = 5; // the narrowest pocket the app will make, mm

export const DEFAULT_DESIGN = {
  width: 120, depth: 80, height: 40,
  wall: 1.6, floor: 1.2, divider: 1.2, radius: 4,
  lid: "none", clearance: 0.25, lidLip: 5,
  dividers: [],
};

export const LIDS = [
  { id: "none", name: "No lid" },
  { id: "lift", name: "Lift-off lid", desc: "A flat lid with a lip that sits inside the walls." },
];

// Starting layouts. cols × rows of even pockets.
export const TEMPLATES = [
  { id: "open", name: "One pocket", cols: 1, rows: 1 },
  { id: "2x1", name: "2 pockets", cols: 2, rows: 1 },
  { id: "2x2", name: "2 × 2 grid", cols: 2, rows: 2 },
  { id: "3x2", name: "3 × 2 grid", cols: 3, rows: 2 },
  { id: "4x3", name: "4 × 3 grid", cols: 4, rows: 3 },
];

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const round = (v, step = 0.1) => +(Math.round(v / step) * step).toFixed(2);

/** Inside size of the box, mm. */
export function inner(d) {
  return { w: d.width - 2 * d.wall, d: d.depth - 2 * d.wall, h: d.height - d.floor };
}

// How far along a divider can sit: the inside span it lies across.
const span = (d, axis) => axis === "x" ? inner(d).w : inner(d).d;

let nextId = 1;
export const newId = () => "d" + (nextId++).toString(36) + Math.random().toString(36).slice(2, 6);

/** Even dividers for a cols × rows grid. "x" dividers stand across the width. */
export function gridDividers(d, cols, rows) {
  const out = [], iw = span(d, "x"), id = span(d, "y");
  for (let i = 1; i < cols; i++) out.push({ id: newId(), axis: "x", at: round(iw * i / cols) });
  for (let j = 1; j < rows; j++) out.push({ id: newId(), axis: "y", at: round(id * j / rows) });
  return out;
}

/** The smallest and largest place a divider can move to without squashing a pocket. */
export function dividerRange(d, div) {
  const s = span(d, div.axis), gap = MIN_POCKET + d.divider / 2;
  let lo = gap, hi = s - gap;
  for (const o of d.dividers) {
    if (o.id === div.id || o.axis !== div.axis) continue;
    if (o.at <= div.at) lo = Math.max(lo, o.at + d.divider + MIN_POCKET);
    else hi = Math.min(hi, o.at - d.divider - MIN_POCKET);
  }
  return [lo, hi];
}

/** Move a divider, snapped to 1 mm and kept between its neighbours. */
export function moveDivider(d, id, at) {
  const div = d.dividers.find(x => x.id === id);
  if (!div) return d;
  const [lo, hi] = dividerRange(d, div);
  const next = lo > hi ? div.at : clamp(Math.round(at), [Math.ceil(lo), Math.floor(hi)]);
  return { ...d, dividers: d.dividers.map(x => x.id === id ? { ...x, at: next } : x) };
}

/** Add a divider in the middle of the widest pocket along that axis, or null if there is no room. */
export function addDivider(d, axis) {
  const s = span(d, axis), ats = d.dividers.filter(x => x.axis === axis).map(x => x.at).sort((a, b) => a - b);
  const edges = [-d.divider / 2, ...ats, s + d.divider / 2];
  let best = null;
  for (let i = 0; i + 1 < edges.length; i++) {
    const room = edges[i + 1] - edges[i] - d.divider;
    if (!best || room > best.room) best = { room, at: (edges[i] + edges[i + 1]) / 2 };
  }
  if (!best || best.room < 2 * MIN_POCKET + d.divider) return null;
  const div = { id: newId(), axis, at: Math.round(best.at) };
  return { design: { ...d, dividers: [...d.dividers, div] }, id: div.id };
}

/**
 * Bring any design (saved, typed in, or half-finished) inside the print rules.
 * When the box changes size, the dividers keep their place as a share of the
 * inside so a 2 × 2 grid stays even.
 */
export function normalize(input, previous) {
  const d = { ...DEFAULT_DESIGN, ...(input || {}) };
  for (const k of Object.keys(LIMITS)) d[k] = round(clamp(Number(d[k]) || DEFAULT_DESIGN[k], LIMITS[k]), k === "width" || k === "depth" || k === "height" ? 1 : 0.05);
  // Walls and floor can't take up the whole box.
  d.wall = Math.min(d.wall, (Math.min(d.width, d.depth) - MIN_POCKET) / 2);
  d.floor = Math.min(d.floor, d.height - 5);
  d.radius = Math.min(d.radius, Math.min(d.width, d.depth) / 2 - 0.5);
  if (!LIDS.some(l => l.id === d.lid)) d.lid = "none";
  d.lidLip = Math.min(d.lidLip, inner(d).h);

  let divs = Array.isArray(d.dividers) ? d.dividers.filter(x => x && (x.axis === "x" || x.axis === "y")) : [];
  if (previous) {
    const was = { x: span(previous, "x"), y: span(previous, "y") }, now = { x: span(d, "x"), y: span(d, "y") };
    divs = divs.map(x => was[x.axis] !== now[x.axis] ? { ...x, at: x.at * now[x.axis] / was[x.axis] } : x);
  }
  divs = divs.map(x => ({
    id: String(x.id || newId()), axis: x.axis, at: Number(x.at) || 0,
    ...(x.height != null ? { height: clamp(Number(x.height), [3, inner(d).h]) } : {}),
  }));
  // Keep dividers in order and drop any that no longer fit.
  const kept = [];
  for (const axis of ["x", "y"]) {
    const s = span(d, axis);
    let last = -Infinity;
    for (const x of divs.filter(x => x.axis === axis).sort((a, b) => a.at - b.at)) {
      const at = Math.max(x.at, MIN_POCKET + d.divider / 2, last + d.divider + MIN_POCKET);
      if (at > s - MIN_POCKET - d.divider / 2) continue;
      kept.push({ ...x, at: Math.round(at * 10) / 10 });
      last = at;
    }
  }
  d.dividers = kept;
  return d;
}

/** The pockets as rectangles inside the box, for labels and fit checks. */
export function pockets(d) {
  const { w, d: dep } = inner(d), t = d.divider;
  const cuts = (axis, s) => {
    const ats = d.dividers.filter(x => x.axis === axis).map(x => x.at).sort((a, b) => a - b);
    const edges = [0, ...ats.flatMap(a => [a - t / 2, a + t / 2]), s];
    const out = [];
    for (let i = 0; i < edges.length; i += 2) out.push([edges[i], edges[i + 1]]);
    return out;
  };
  const out = [];
  for (const [x0, x1] of cuts("x", w)) for (const [y0, y1] of cuts("y", dep)) out.push({ x0, x1, y0, y1, w: x1 - x0, d: y1 - y0 });
  return out;
}

/** One-line description, e.g. "120 × 80 × 40 mm, 6 pockets, lift-off lid". */
export function summary(d, units = "mm") {
  const f = v => units === "in" ? (v / IN).toFixed(2) : String(Math.round(v));
  const n = pockets(d).length;
  return `${f(d.width)} × ${f(d.depth)} × ${f(d.height)} ${units}, ${n} pocket${n === 1 ? "" : "s"}${d.lid === "lift" ? ", lift-off lid" : ""}`;
}
