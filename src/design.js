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

export const MAX_TRAYS = 3;
export const TRAY_HEIGHT = [8, 200];
export const LEDGE = 2.5; // how far the ledge the trays sit on sticks out from the walls, mm

export const MIN_POCKET = 5; // the narrowest pocket the app will make, mm

export const DEFAULT_DESIGN = {
  width: 120, depth: 80, height: 40,
  wall: 1.6, floor: 1.2, divider: 1.2, radius: 4,
  lid: "none", clearance: 0.25, lidLip: 5,
  dividers: [],
  trays: [], // lift-out trays, bottom first: [{ id, height, dividers }]
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

const other = axis => axis === "x" ? "y" : "x";
export const SNAP = 4; // mm: how close an end or edge must come before it snaps
const MIN_LENGTH = 5;  // the shortest divider, mm

/**
 * Dividers are separate pieces. Each stands across one axis: an "x" divider
 * sits at x = `at` (from the inside left wall) and runs front to back from
 * `from` to `to` (measured from the inside front wall); a "y" divider sits at
 * y = `at` and runs left to right. Without `from`/`to` it runs wall to wall.
 */
export function ends(d, div) {
  return [div.from ?? 0, div.to ?? span(d, other(div.axis))];
}
const overlap = (d, a, b) => { const [a0, a1] = ends(d, a), [b0, b1] = ends(d, b); return a0 < b1 - 0.01 && b0 < a1 - 0.01; };

/** Even dividers for a cols × rows grid, each running wall to wall. */
export function gridDividers(d, cols, rows) {
  const out = [], iw = span(d, "x"), id = span(d, "y");
  for (let i = 1; i < cols; i++) out.push({ id: newId(), axis: "x", at: round(iw * i / cols), from: 0, to: id });
  for (let j = 1; j < rows; j++) out.push({ id: newId(), axis: "y", at: round(id * j / rows), from: 0, to: iw });
  return out;
}

/** The smallest and largest place a divider can slide to without squashing a pocket beside it. */
export function dividerRange(d, div) {
  const s = span(d, div.axis), gap = MIN_POCKET + d.divider / 2;
  let lo = gap, hi = s - gap;
  for (const o of d.dividers) {
    if (o.id === div.id || o.axis !== div.axis || !overlap(d, o, div)) continue;
    if (o.at <= div.at) lo = Math.max(lo, o.at + d.divider + MIN_POCKET);
    else hi = Math.min(hi, o.at - d.divider - MIN_POCKET);
  }
  return [lo, hi];
}

const update = (d, id, change) => ({ ...d, dividers: d.dividers.map(x => x.id === id ? { ...x, ...change } : x) });

/** Slide a divider sideways, snapped to 1 mm and kept between its neighbours (the position slider). */
export function moveDivider(d, id, at) {
  const div = d.dividers.find(x => x.id === id);
  if (!div) return d;
  const [lo, hi] = dividerRange(d, div);
  return update(d, id, { at: lo > hi ? div.at : clamp(Math.round(at), [Math.ceil(lo), Math.floor(hi)]) });
}

// The places a divider's end can snap to: the walls, and the middle of any
// divider standing across its path.
function endTargets(d, div, at) {
  const out = [0, span(d, other(div.axis))];
  for (const o of d.dividers) {
    if (o.id === div.id || o.axis === div.axis) continue;
    const [o0, o1] = ends(d, o);
    if (at >= o0 - d.divider && at <= o1 + d.divider) out.push(o.at);
  }
  return out;
}
const nearest = (v, targets) => targets.reduce((best, t) => Math.abs(t - v) < Math.abs(best - v) ? t : best, Infinity);

/**
 * Drag a divider anywhere: `at` across it, `mid` the middle of its length.
 * It snaps in line with other dividers, to the middle of the box, and its
 * ends snap to the walls and to dividers they reach.
 */
export function placeDivider(d, id, at, mid) {
  const div = d.dividers.find(x => x.id === id);
  if (!div) return d;
  const P = span(d, div.axis), S = span(d, other(div.axis)), t = d.divider;
  const [f, e] = ends(d, div), len = e - f;
  const lines = [P / 2, ...d.dividers.filter(o => o.id !== div.id && o.axis === div.axis).map(o => o.at)];
  const line = nearest(at, lines);
  at = Math.abs(line - at) <= SNAP ? line : Math.round(at);
  at = clamp(at, [MIN_POCKET + t / 2, P - MIN_POCKET - t / 2]);
  let from = mid - len / 2;
  const targets = endTargets(d, div, at);
  const a = nearest(from, targets), b = nearest(from + len, targets);
  if (Math.abs(a - from) <= SNAP && Math.abs(a - from) <= Math.abs(b - from - len)) from = a;
  else if (Math.abs(b - from - len) <= SNAP) from = b - len;
  else from = Math.round(from);
  from = clamp(from, [0, S - len]);
  return update(d, id, { at, from: round(from), to: round(from + len) });
}

/** Drag one end of a divider ("from" or "to") to make it longer or shorter; it snaps to walls and dividers. */
export function setDividerEnd(d, id, which, value) {
  const div = d.dividers.find(x => x.id === id);
  if (!div) return d;
  const S = span(d, other(div.axis)), [f, e] = ends(d, div);
  const n = nearest(value, endTargets(d, div, div.at));
  let v = Math.abs(n - value) <= SNAP ? n : Math.round(value);
  v = which === "from" ? clamp(v, [0, e - MIN_LENGTH]) : clamp(v, [f + MIN_LENGTH, S]);
  return update(d, id, { [which]: round(v) });
}

/** Turn a divider a quarter turn about its middle. */
export function turnDivider(d, id) {
  const div = d.dividers.find(x => x.id === id);
  if (!div) return d;
  const axis = other(div.axis), [f, e] = ends(d, div);
  const P = span(d, axis), S = span(d, div.axis), t = d.divider;
  const len = Math.min(e - f, S);
  const at = clamp((f + e) / 2, [MIN_POCKET + t / 2, P - MIN_POCKET - t / 2]);
  const from = clamp(div.at - len / 2, [0, S - len]);
  return update(d, id, { axis, at: round(at), from: round(from), to: round(from + len) });
}

/** Stretch a divider from wall to wall. */
export function fullLength(d, id) {
  const div = d.dividers.find(x => x.id === id);
  return div ? update(d, id, { from: 0, to: span(d, other(div.axis)) }) : d;
}

/** Add a wall-to-wall divider in the middle of the widest gap along that axis, or null if there is no room. */
export function addDivider(d, axis) {
  const s = span(d, axis), ats = d.dividers.filter(x => x.axis === axis).map(x => x.at).sort((a, b) => a - b);
  const edges = [-d.divider / 2, ...ats, s + d.divider / 2];
  let best = null;
  for (let i = 0; i + 1 < edges.length; i++) {
    const room = edges[i + 1] - edges[i] - d.divider;
    if (!best || room > best.room) best = { room, at: (edges[i] + edges[i + 1]) / 2 };
  }
  if (!best || best.room < 2 * MIN_POCKET + d.divider) return null;
  const div = { id: newId(), axis, at: Math.round(best.at), from: 0, to: span(d, other(axis)) };
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

  d.dividers = normalizeDividers(d, d.dividers, previous);
  d.trays = normalizeTrays(d, d.trays, previous);
  return d;
}

// Keep dividers in order, with room for a pocket either side, and drop any
// that no longer fit. `part` is the box or a tray (see trayPart).
function normalizeDividers(part, input, previous) {
  let divs = Array.isArray(input) ? input.filter(x => x && (x.axis === "x" || x.axis === "y")) : [];
  const was = previous && { x: span(previous, "x"), y: span(previous, "y") }, now = { x: span(part, "x"), y: span(part, "y") };
  divs = divs.map(x => {
    const along = other(x.axis), S = now[along], t = part.divider;
    // Resizing keeps each divider in the same place as a share of the inside.
    const k = was ? now[x.axis] / was[x.axis] : 1, kl = was ? S / was[along] : 1;
    const at = (Number(x.at) || 0) * k;
    let from = x.from != null ? Number(x.from) * kl : 0, to = x.to != null ? Number(x.to) * kl : S;
    // A divider that ran wall to wall still does.
    if (was && x.to != null && Math.abs(Number(x.to) - was[along]) < 0.05) to = S;
    from = clamp(from, [0, Math.max(0, S - MIN_LENGTH)]);
    to = clamp(to, [Math.min(S, from + MIN_LENGTH), S]);
    return {
      id: String(x.id || newId()), axis: x.axis, at: round(at), from: round(from), to: round(to),
      ...(x.height != null ? { height: clamp(Number(x.height), [3, inner(part).h]) } : {}),
      fits: at >= MIN_POCKET + t / 2 - 0.05 && at <= now[x.axis] - MIN_POCKET - t / 2 + 0.05,
    };
  });
  // Drop dividers that no longer fit, and any sitting on top of another.
  const kept = [];
  for (const x of divs) {
    if (!x.fits) continue;
    delete x.fits;
    if (kept.some(o => o.axis === x.axis && Math.abs(o.at - x.at) < part.divider + MIN_POCKET && overlap(part, o, x))) continue;
    kept.push(x);
  }
  return kept;
}

// Trays fit in the space between the floor and the lid's lip; any that
// don't fit are made shorter, then dropped.
function normalizeTrays(d, input, previous) {
  const list = (Array.isArray(input) ? input : []).filter(Boolean).slice(0, MAX_TRAYS);
  const min = Math.max(TRAY_HEIGHT[0], d.floor + 5);
  let room = stackTop(d) - d.floor;
  const out = [];
  for (const t of list) {
    const height = Math.min(round(clamp(Number(t.height) || 15, TRAY_HEIGHT), 1), Math.floor(room));
    if (height < min) break;
    room -= height;
    const tray = { id: String(t.id || newId()), height, dividers: [] };
    const was = previous?.trays?.find(x => x.id === tray.id);
    tray.dividers = normalizeDividers(trayPart(d, tray), t.dividers, was && trayPart(previous, was));
    out.push(tray);
  }
  return out;
}

// ---- trays and the lid -----------------------------------------------------------------

/** How high up the inside the trays (or the dividers) can reach, leaving room for the lid's lip. */
export function stackTop(d) {
  return d.lid === "lift" ? d.height - d.lidLip - 2 * d.clearance : d.height;
}

/** Where the bottom tray sits: the top of the ledge round the inside walls. */
export function ledgeTop(d) {
  return stackTop(d) - (d.trays || []).reduce((a, t) => a + t.height, 0);
}

/** A tray as a box of its own, so the same divider tools work on it. */
export function trayPart(d, tray) {
  const i = inner(d), c = d.clearance;
  return {
    width: i.w - 2 * c, depth: i.d - 2 * c, height: tray.height,
    wall: d.wall, floor: d.floor, divider: d.divider, radius: Math.max(0, d.radius - d.wall - c),
    lid: "none", dividers: tray.dividers || [], dividerTop: tray.height,
  };
}

/** The box itself, with how high its dividers may go below the trays and the lid. */
export function boxPart(d) {
  return { ...d, dividerTop: (d.trays || []).length ? ledgeTop(d) : stackTop(d) };
}

/** The part being edited: "box" or a tray's id. */
export function partOf(d, target) {
  const tray = target !== "box" && (d.trays || []).find(t => t.id === target);
  return tray ? trayPart(d, tray) : boxPart(d);
}

/** Write an edited part's dividers (and a tray's height) back into the design. */
export function withPart(d, target, part) {
  if (target === "box") return { ...d, dividers: part.dividers };
  return { ...d, trays: d.trays.map(t => t.id === target ? { ...t, dividers: part.dividers, height: part.height } : t) };
}

/** Add a tray on top of the stack, or null if there is no room. */
export function addTray(d) {
  if ((d.trays || []).length >= MAX_TRAYS) return null;
  const room = ledgeTop(d) - d.floor, min = Math.max(TRAY_HEIGHT[0], d.floor + 5);
  if (room < min) return null;
  const tray = { id: newId(), height: Math.max(min, Math.min(20, Math.floor(room / 2))), dividers: [] };
  return { design: { ...d, trays: [...(d.trays || []), tray] }, id: tray.id };
}

/**
 * The pockets: the separate spaces the dividers make, found on a 1 mm grid.
 * Each comes back with its size, for labels and fit checks.
 */
export function pockets(d) {
  const { w, d: dep } = inner(d), t = d.divider;
  const nx = Math.max(1, Math.round(w)), ny = Math.max(1, Math.round(dep)), sx = w / nx, sy = dep / ny;
  const blocked = new Uint8Array(nx * ny);
  for (const x of d.dividers) {
    const [f, e] = ends(d, x);
    // At least one cell thick, so a thin divider still splits the grid.
    const hu = Math.max(t, sx) / 2, hv = Math.max(t, sy) / 2;
    const [u0, u1, v0, v1] = x.axis === "x" ? [x.at - hu, x.at + hu, f, e] : [f, e, x.at - hv, x.at + hv];
    for (let j = 0; j < ny; j++) {
      const cy = (j + 0.5) * sy;
      if (cy < v0 || cy > v1) continue;
      for (let i = 0; i < nx; i++) { const cx = (i + 0.5) * sx; if (cx >= u0 && cx <= u1) blocked[j * nx + i] = 1; }
    }
  }
  const seen = new Uint8Array(nx * ny), out = [];
  for (let s0 = 0; s0 < nx * ny; s0++) {
    if (blocked[s0] || seen[s0]) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, area = 0;
    const stack = [s0]; seen[s0] = 1;
    while (stack.length) {
      const c = stack.pop(), i = c % nx, j = (c - i) / nx;
      area++; x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, n = b * nx + a;
        if (a < 0 || b < 0 || a >= nx || b >= ny || blocked[n] || seen[n]) continue;
        seen[n] = 1; stack.push(n);
      }
    }
    if (area < 4) continue; // a sliver, not a pocket
    out.push({ x0: x0 * sx, x1: (x1 + 1) * sx, y0: y0 * sy, y1: (y1 + 1) * sy, w: (x1 - x0 + 1) * sx, d: (y1 - y0 + 1) * sy, area: area * sx * sy });
  }
  return out;
}

/** One-line description, e.g. "120 × 80 × 40 mm, 6 pockets, lift-off lid". */
export function summary(d, units = "mm") {
  const f = v => units === "in" ? (v / IN).toFixed(2) : String(Math.round(v));
  const n = pockets(d).length, t = (d.trays || []).length;
  return `${f(d.width)} × ${f(d.depth)} × ${f(d.height)} ${units}, ${n} pocket${n === 1 ? "" : "s"}`
    + (t ? `, ${t} tray${t === 1 ? "" : "s"}` : "") + (d.lid === "lift" ? ", lift-off lid" : "");
}
