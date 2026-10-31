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

export const MAX_TRAYS = 12;
export const TRAY_HEIGHT = [8, 200];
export const TRAY_MIN = 20; // the narrowest tray, mm

export const MIN_POCKET = 5; // the narrowest pocket the app will make, mm

export const DEFAULT_DESIGN = {
  width: 120, depth: 80, height: 40,
  wall: 1.6, floor: 1.2, divider: 1.2, radius: 4,
  lid: "none", clearance: 0.25, lidLip: 5,
  // "slot": dividers print as separate pieces that slot into channels in the
  // floor and walls. "fixed": they print as part of the box.
  dividerStyle: "slot",
  dividers: [],
  // Lift-out trays inside the box: [{ id, x, y, w, d, height, dividers }], x and y
  // being the front-left corner from the inside front-left corner.
  trays: [],
};

export const DIVIDER_STYLES = [
  { id: "slot", name: "Slot-in dividers", desc: "Printed flat as separate pieces; they slide into channels in the floor and walls." },
  { id: "fixed", name: "Printed in", desc: "Printed as part of the box or tray." },
];

export const LIDS = [
  { id: "none", name: "No lid" },
  { id: "lift", name: "Lift-off lid", desc: "A flat lid with a lip that sits inside the walls." },
];

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const round = (v, step = 0.1) => +(Math.round(v / step) * step).toFixed(2);
const fine = v => +v.toFixed(2); // trays sit a clearance (0.1 mm steps) from walls, so keep hundredths

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
  const lines = [P / 2, ...d.dividers.filter(o => o.id !== div.id && o.axis === div.axis).map(o => o.at), ...(d.snapLines?.[div.axis] || [])];
  const line = nearest(at, lines);
  at = Math.abs(line - at) <= SNAP ? round(line) : Math.round(at);
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
  if (!DIVIDER_STYLES.some(x => x.id === d.dividerStyle)) d.dividerStyle = "slot";
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

// Trays keep their size and place where they can; one too big for the box
// shrinks to fit, and any with no room left below the lid's lip is dropped.
function normalizeTrays(d, input, previous) {
  const i = inner(d), c = d.clearance, minH = Math.max(TRAY_HEIGHT[0], d.floor + 5);
  const pi = previous && inner(previous);
  const list = (Array.isArray(input) ? input : []).filter(Boolean).slice(0, MAX_TRAYS);
  let out = [];
  for (const t of list) {
    const was = previous?.trays?.find(x => x.id === t.id);
    // Trays saved before they had a size filled the whole inside.
    let w = Number(t.w) || i.w - 2 * c, dep = Number(t.d) || i.d - 2 * c;
    let x = t.x != null ? Number(t.x) : c, y = t.y != null ? Number(t.y) : c;
    if (pi && was && (pi.w !== i.w || pi.d !== i.d)) {
      // The box changed size: a tray keeps its share of the inside.
      const kx = (i.w - 2 * c) / (pi.w - 2 * c), ky = (i.d - 2 * c) / (pi.d - 2 * c);
      x = c + (x - c) * kx; w *= kx; y = c + (y - c) * ky; dep *= ky;
    }
    w = fine(clamp(w, [TRAY_MIN, i.w - 2 * c])); dep = fine(clamp(dep, [TRAY_MIN, i.d - 2 * c]));
    x = fine(clamp(x, [c, i.w - c - w])); y = fine(clamp(y, [c, i.d - c - dep]));
    const tray = { id: String(t.id || newId()), x, y, w, d: dep, height: round(clamp(Number(t.height) || 20, TRAY_HEIGHT), 1), dividers: [] };
    tray.dividers = normalizeDividers(trayPart(d, tray), t.dividers, was && trayPart(previous, was));
    out.push(tray);
  }
  // Each tray sits on the floor or on the trays below it, and must end below the lid's lip.
  const kept = [];
  for (const t of out) {
    const z = trayZ({ ...d, trays: kept }, t);
    const height = Math.min(t.height, Math.floor(stackTop(d) - z));
    if (height < minH) continue;
    kept.push({ ...t, height });
  }
  return previous ? kept.map(t => ({ ...t, ...lockTray({ ...d, trays: kept }, t, t.x, t.y) })) : kept;
}

// ---- trays and the lid -----------------------------------------------------------------

/** How high up the inside the trays (or the dividers) can reach, leaving room for the lid's lip. */
export function stackTop(d) {
  return d.lid === "lift" ? d.height - d.lidLip - 2 * d.clearance : d.height;
}

const footprintsOverlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.d - 0.5 && b.y < a.y + a.d - 0.5;

/** How high a tray's bottom sits: on the floor, or on top of the trays listed before it that it overlaps. */
export function trayZ(d, tray) {
  let z = d.floor;
  for (const o of d.trays || []) {
    if (o.id === tray.id) break;
    if (footprintsOverlap(o, tray)) z = Math.max(z, trayZ(d, o) + o.height);
  }
  return z;
}

// ---- slot-in dividers -------------------------------------------------------------------

/**
 * How far the rounded inside corner reaches in from a wall, for something
 * from `lo` to `hi` across that wall (`S` long inside): 0 away from the
 * corners, up to the inside radius right at a corner.
 */
export function cornerInset(d, lo, hi, S) {
  const r = Math.max(0, d.radius - d.wall);
  const u = Math.min(lo, S - hi);
  if (u >= r) return 0;
  return r - Math.sqrt(Math.max(0, r * r - (r - Math.max(0, u)) ** 2));
}

export const RAIL = { width: 1.2, height: 2, wall: 1.5 }; // the ribs that make a channel, mm

/**
 * How a part's (the box's or a tray's) dividers become separate pieces and
 * the channels they slot into. All in the part's frame: centred on X = Y = 0,
 * its bottom on Z = 0, like `dividerBoxes`.
 *
 * pieces: [{ id, axis, at, a, b, z0, z1, notches: [{ at, z0, z1, w }] }], each
 * piece running from `a` to `b` along its length (from the inside front or left
 * wall). Where two dividers cross, each gets a notch halfway (front-to-back
 * ones from the top, side-to-side ones from the bottom) so they slide together.
 * Ends at a wall stop a gap short of it; ends at another divider stop a gap
 * short of its face.
 *
 * rails: [{ min, max }] boxes to add to the part: a pair of low ribs along the
 * floor either side of each divider, and a pair of upright ribs on each wall
 * it meets.
 */
export function slotLayout(d) {
  const i = inner(d), t = d.divider, c = d.clearance, cap = d.dividerTop ?? d.height;
  const R = RAIL.width, off = t / 2 + c + R / 2;
  const top = x => Math.min(cap, x.height != null ? d.floor + x.height : d.height);
  const pieces = [], rails = [];
  for (const x of d.dividers) {
    const [f, e] = ends(d, x), S = span(d, other(x.axis)), P = span(d, x.axis);
    const across = d.dividers.filter(o => o.axis !== x.axis && o.id !== x.id);
    const meets = o => { const [o0, o1] = ends(d, o); return x.at >= o0 - 0.05 && x.at <= o1 + 0.05 && o.at >= f - 0.05 && o.at <= e + 0.05; };
    const endAt = v => {
      if (v < 0.05 || v > S - 0.05) return "wall";
      return across.some(o => meets(o) && Math.abs(o.at - v) < 0.05) ? "divider" : "free";
    };
    const kinds = [endAt(f), endAt(e)];
    // Near a corner the rounded wall comes further in, so the piece stops short of that too.
    const inset = cornerInset(d, x.at - t / 2, x.at + t / 2, P);
    const a = kinds[0] === "wall" ? c + inset : kinds[0] === "divider" ? f + t / 2 + c : f;
    const b = kinds[1] === "wall" ? S - c - inset : kinds[1] === "divider" ? e - t / 2 - c : e;
    const z1 = top(x), notches = [];
    for (const o of across) {
      const [o0, o1] = ends(d, o);
      // A crossing: each passes right through the other.
      if (!(o.at > f + 0.05 && o.at < e - 0.05 && x.at > o0 + 0.05 && x.at < o1 - 0.05)) continue;
      const mid = d.floor + (Math.min(z1, top(o)) - d.floor) / 2;
      notches.push(x.axis === "x" ? { at: o.at, z0: mid, z1, w: t + 2 * c } : { at: o.at, z0: d.floor, z1: mid, w: t + 2 * c });
    }
    pieces.push({ id: x.id, axis: x.axis, at: x.at, a, b, z0: d.floor, z1, notches });

    // Floor ribs, broken where another divider crosses or meets this one.
    const cuts = across.filter(meets).map(o => [o.at - t / 2 - c - R - 0.1, o.at + t / 2 + c + R + 0.1]).sort((p, q) => p[0] - q[0]);
    const box = (u0, u1, v0, v1, z0, zz) => x.axis === "x"
      ? { min: [-i.w / 2 + u0, -i.d / 2 + v0, z0], max: [-i.w / 2 + u1, -i.d / 2 + v1, zz] }
      : { min: [-i.w / 2 + v0, -i.d / 2 + u0, z0], max: [-i.w / 2 + v1, -i.d / 2 + u1, zz] };
    for (const side of [-1, 1]) {
      const u = x.at + side * off, u0 = u - R / 2, u1 = u + R / 2;
      if (u0 < 0 || u1 > P) continue;
      // Start each rib where the wall is, which is further in at a rounded corner.
      const k = cornerInset(d, u0, u1, P);
      const runs = [];
      let from = kinds[0] === "wall" ? k - 0.5 : a;
      const to = kinds[1] === "wall" ? S - k + 0.5 : b;
      for (const [c0, c1] of cuts) { if (c0 > from) runs.push([from, Math.min(c0, to)]); from = Math.max(from, c1); }
      if (to > from) runs.push([from, to]);
      for (const [v0, v1] of runs) if (v1 - v0 > 0.5) rails.push(box(u0, u1, v0, v1, d.floor - 0.01, d.floor + RAIL.height));
      // Upright ribs on the walls it meets.
      if (kinds[0] === "wall") rails.push(box(u0, u1, k - 0.5, k + RAIL.wall, d.floor - 0.01, z1));
      if (kinds[1] === "wall") rails.push(box(u0, u1, S - k - RAIL.wall, S - k + 0.5, d.floor - 0.01, z1));
    }
  }
  return { pieces, rails };
}

/** A tray as a box of its own, so the same divider tools work on it. */
export function trayPart(d, tray) {
  return {
    width: tray.w, depth: tray.d, height: tray.height,
    wall: d.wall, floor: d.floor, divider: d.divider,
    radius: Math.max(0, Math.min(d.radius - d.wall - d.clearance, Math.min(tray.w, tray.d) / 2 - 0.5)),
    lid: "none", dividers: tray.dividers || [], dividerTop: tray.height, dividerStyle: d.dividerStyle, clearance: d.clearance,
  };
}

/** The box itself, with how high its dividers may go below the lid's lip. */
export function boxPart(d) {
  return { ...d, dividerTop: stackTop(d), snapLines: traySides(d) };
}

// Where a box divider stands just clear of a tray's side, for each axis: a
// front-to-back ("x") divider beside a tray's left or right side, a
// side-to-side ("y") one beside its front or back.
function traySides(d) {
  const c = d.clearance, t = d.divider / 2, out = { x: [], y: [] };
  for (const tr of d.trays || []) {
    out.x.push(tr.x - c - t, tr.x + tr.w + c + t);
    out.y.push(tr.y - c - t, tr.y + tr.d + c + t);
  }
  return out;
}

/** A part to lay dividers out in: "box" or a tray's id. */
export function partOf(d, target) {
  const tray = target !== "box" && (d.trays || []).find(t => t.id === target);
  return tray ? trayPart(d, tray) : boxPart(d);
}

/** Write a part's dividers back into the design. */
export function withPart(d, target, part) {
  if (target === "box") return { ...d, dividers: part.dividers };
  return { ...d, trays: d.trays.map(t => t.id === target ? { ...t, dividers: part.dividers } : t) };
}

// Where a tray's near edge can go along one axis: against a wall or against
// another tray (both touch), or lined up with another tray's edge (no touch).
function trayStops(d, tray, axis) {
  const i = inner(d), c = d.clearance, S = axis === "x" ? i.w : i.d;
  const pos = axis === "x" ? "x" : "y", size = axis === "x" ? "w" : "d";
  const out = [{ v: c, touch: 1 }, { v: S - c - tray[size], touch: 1 }];
  for (const o of d.trays || []) {
    if (o.id === tray.id) continue;
    out.push({ v: o[pos] + o[size] + c, touch: 1, tray: o }, { v: o[pos] - c - tray[size], touch: 1, tray: o },
      { v: o[pos], touch: 0 }, { v: o[pos] + o[size] - tray[size], touch: 0 });
  }
  return out.filter(s => s.v >= c - 0.01 && s.v <= S - c - tray[size] + 0.01);
}

// How many sides a tray at (x, y) touches: walls, and trays beside it that
// it really meets (their sides overlap).
export function trayTouches(d, tray, x = tray.x, y = tray.y) {
  const at = { ...tray, x, y };
  let n = 0;
  for (const axis of ["x", "y"]) for (const s of trayStops(d, at, axis)) {
    if (!s.touch || Math.abs(s.v - at[axis]) > 0.05) continue;
    if (s.tray) {
      const [p, q] = axis === "x" ? ["y", "d"] : ["x", "w"];
      if (!(at[p] < s.tray[p] + s.tray[q] - 0.5 && s.tray[p] < at[p] + at[q] - 0.5)) continue;
    }
    n++;
  }
  return n;
}

// The nearest place to (x, y) where the tray touches at least two sides.
function lockTray(d, tray, x, y) {
  const xs = [{ v: x, touch: 0 }, ...trayStops(d, tray, "x")], ys = [{ v: y, touch: 0 }, ...trayStops(d, tray, "y")];
  let best = null;
  for (const a of xs) for (const b of ys) {
    const touches = trayTouches(d, tray, a.v, b.v);
    if (touches < 2) continue;
    const dist = Math.hypot(a.v - x, b.v - y);
    if (!best || dist < best.dist - 1e-6) best = { dist, x: fine(a.v), y: fine(b.v) };
  }
  return best ? { x: best.x, y: best.y } : { x: d.clearance, y: d.clearance };
}

/**
 * Drag a tray to (x, y), its front-left corner measured from the inside
 * front-left corner. While dragging it snaps to walls and trays it comes
 * near; when dropped (`lock`) it moves to the nearest place where it touches
 * at least two sides. Dropped onto another tray, it stacks on top.
 */
export function placeTray(d, id, x, y, lock = false) {
  const tray = d.trays.find(t => t.id === id);
  if (!tray) return d;
  const i = inner(d), c = d.clearance;
  x = clamp(x, [c, i.w - c - tray.w]); y = clamp(y, [c, i.d - c - tray.d]);
  let place;
  if (lock) place = lockTray(d, tray, x, y);
  else {
    const snap = (v, axis) => { const n = trayStops(d, tray, axis).reduce((b, s) => Math.abs(s.v - v) < Math.abs(b - v) ? s.v : b, Infinity); return Math.abs(n - v) <= 2 * SNAP ? n : Math.round(v); };
    place = { x: fine(snap(x, "x")), y: fine(snap(y, "y")) };
  }
  const moved = { ...tray, ...place };
  // A tray dropped over another goes to the top of that stack.
  const rest = d.trays.filter(t => t.id !== id);
  const trays = lock && rest.some(o => footprintsOverlap(o, moved)) ? [...rest, moved] : d.trays.map(t => t.id === id ? moved : t);
  return { ...d, trays };
}

/** Change a tray's width, depth or height; it stays against the walls it was touching. */
export function resizeTray(d, id, change) {
  const tray = d.trays.find(t => t.id === id);
  if (!tray) return d;
  const i = inner(d), c = d.clearance;
  const next = { ...tray, ...change };
  // Against the right or back wall (and not the left or front), grow towards the middle.
  if (change.w != null && Math.abs(tray.x + tray.w - (i.w - c)) < 0.05 && Math.abs(tray.x - c) > 0.05) next.x = i.w - c - next.w;
  if (change.d != null && Math.abs(tray.y + tray.d - (i.d - c)) < 0.05 && Math.abs(tray.y - c) > 0.05) next.y = i.d - c - next.d;
  return { ...d, trays: d.trays.map(t => t.id === id ? next : t) };
}

/** Make a tray fill the inside from wall to wall across one axis ("x" or "y"). */
export function fillTray(d, id, axis) {
  const i = inner(d), c = d.clearance;
  return resizeTray(d, id, axis === "x" ? { x: c, w: i.w - 2 * c } : { y: c, d: i.d - 2 * c });
}

// Soft stops: a size dragged with a handle sticks to round numbers (every
// 10 mm across, every 5 mm up) when it comes close; typed sizes stay exact.
export const STOPS = { size: 10, height: 5 };
export function softStop(v, step) {
  const n = Math.round(v / step) * step;
  return Math.abs(n - v) <= step * 0.2 ? n : v;
}

// True when every tray still ends below the lid's lip.
const traysFit = d => d.trays.every(t => trayZ(d, t) + t.height <= stackTop(d) + 0.01);

/**
 * Drag one side of a tray with its handle. `edge` is "left", "right",
 * "front", "back" (`value` is where that side is, from the inside front-left
 * corner) or "top" (`value` is the tray's height). The other side stays put.
 * Sides stop at the walls and at trays beside it, and snap to them.
 */
export function sizeTrayEdge(d, id, edge, value) {
  const tray = d.trays.find(t => t.id === id);
  if (!tray) return d;
  const set = change => ({ ...d, trays: d.trays.map(t => t.id === id ? { ...t, ...change } : t) });
  if (edge === "top") {
    const lo = Math.max(TRAY_HEIGHT[0], d.floor + 5);
    let h = Math.round(clamp(softStop(value, STOPS.height), [lo, TRAY_HEIGHT[1]]));
    while (h > lo && !traysFit(set({ height: h }))) h--;
    return set({ height: h });
  }
  const i = inner(d), c = d.clearance, ax = edge === "left" || edge === "right" ? "x" : "y";
  const [pos, size, S] = ax === "x" ? ["x", "w", i.w] : ["y", "d", i.d];
  const [p, q] = ax === "x" ? ["y", "d"] : ["x", "w"];
  const lo = tray[pos], hi = tray[pos] + tray[size], z = trayZ(d, tray);
  // Trays on the same level that sit beside this one.
  const beside = d.trays.filter(o => o.id !== id && Math.abs(trayZ(d, o) - z) < 0.01 && o[p] < tray[p] + tray[q] - 0.5 && tray[p] < o[p] + o[q] - 0.5);
  let next;
  if (edge === "right" || edge === "back") {
    const stop = Math.min(S - c, ...beside.filter(o => o[pos] >= hi - 0.5).map(o => o[pos] - c));
    const v = Math.abs(value - stop) <= SNAP ? stop : lo + softStop(value - lo, STOPS.size);
    next = { [size]: fine(clamp(v, [lo + TRAY_MIN, stop]) - lo) };
  } else {
    const stop = Math.max(c, ...beside.filter(o => o[pos] + o[size] <= lo + 0.5).map(o => o[pos] + o[size] + c));
    const v = Math.abs(value - stop) <= SNAP ? stop : hi - softStop(hi - value, STOPS.size);
    const at = clamp(v, [stop, hi - TRAY_MIN]);
    next = { [pos]: fine(at), [size]: fine(hi - at) };
  }
  return set(next);
}

/** Copy a tray, dividers and all, into the nearest free spot (or on top of it), or null if there is no room. */
export function copyTray(d, id) {
  const src = d.trays.find(t => t.id === id);
  if (!src || d.trays.length >= MAX_TRAYS) return null;
  const copy = { ...src, id: newId(), dividers: src.dividers.map(x => ({ ...x, id: newId() })) };
  let best = null;
  for (const a of trayStops(d, copy, "x")) for (const b of trayStops(d, copy, "y")) {
    const at = { ...copy, x: a.v, y: b.v };
    if (d.trays.some(o => footprintsOverlap(o, at)) || trayTouches(d, copy, a.v, b.v) < 2) continue;
    const dist = Math.hypot(a.v - src.x, b.v - src.y);
    if (!best || dist < best.dist - 1e-6) best = { dist, x: fine(a.v), y: fine(b.v) };
  }
  if (best) [copy.x, copy.y] = [best.x, best.y]; // otherwise it stacks on top of the original
  const next = { ...d, trays: [...d.trays, copy] };
  return traysFit(next) ? { design: next, id: copy.id } : null;
}

/** Copy a divider beside itself, halfway to the next divider or wall, or null if there is no room either side. */
export function copyDivider(d, id) {
  const div = d.dividers.find(x => x.id === id);
  if (!div) return null;
  const S = span(d, div.axis);
  const ats = [-d.divider / 2, S + d.divider / 2, ...d.dividers.filter(x => x.id !== id && x.axis === div.axis && overlap(d, x, div)).map(x => x.at)];
  const above = Math.min(...ats.filter(v => v > div.at)), below = Math.max(...ats.filter(v => v < div.at));
  for (const [a, b] of [[div.at, above], [below, div.at]]) {
    if (b - a < 2 * MIN_POCKET + 2 * d.divider) continue;
    const copy = { ...div, id: newId(), at: round((a + b) / 2) };
    return { design: { ...d, dividers: [...d.dividers, copy] }, id: copy.id };
  }
  return null;
}

/** Add a tray half the inside's width, in the first free corner (or on top of the others), or null if there is no room. */
export function addTray(d) {
  if ((d.trays || []).length >= MAX_TRAYS) return null;
  const i = inner(d), c = d.clearance;
  const tray = { id: newId(), x: c, y: c, w: fine(Math.max(TRAY_MIN, (i.w - 3 * c) / 2)), d: fine(i.d - 2 * c), height: 20, dividers: [] };
  const spots = [[c, c], [i.w - c - tray.w, c], [c, i.d - c - tray.d], [i.w - c - tray.w, i.d - c - tray.d]];
  const free = spots.find(([x, y]) => !(d.trays || []).some(o => footprintsOverlap(o, { ...tray, x, y })));
  if (free) [tray.x, tray.y] = free.map(fine);
  const z = trayZ({ ...d, trays: [...(d.trays || []), tray] }, tray);
  tray.height = Math.min(20, Math.floor(stackTop(d) - z));
  if (tray.height < Math.max(TRAY_HEIGHT[0], d.floor + 5)) return null;
  return { design: { ...d, trays: [...(d.trays || []), tray] }, id: tray.id };
}

/** Things that will clash when printed and put together, in plain words. */
export function problems(d) {
  const out = [], t = d.divider, i = inner(d);
  d.trays.forEach((tray, k) => {
    const z = trayZ(d, tray);
    if (z > d.floor + 0.01) return;
    for (const x of d.dividers) {
      const [f, e] = ends(d, x), top = x.height != null ? d.floor + x.height : d.height;
      const r = x.axis === "x" ? { x: x.at - t / 2, w: t, y: f, d: e - f } : { x: f, w: e - f, y: x.at - t / 2, d: t };
      if (top > z && footprintsOverlap(tray, { ...r, x: r.x - 0.5, y: r.y - 0.5, w: r.w + 1, d: r.d + 1 })) {
        out.push(`Tray ${k + 1} sits on a box divider. Move one of them.`);
        break;
      }
    }
  });
  return out;
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
