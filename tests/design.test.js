// The design rules: sizes stay printable, dividers stay in order with room
// for a pocket either side, and resizing keeps a grid even.
import { describe, it, expect } from "vitest";
import { DEFAULT_DESIGN, LIMITS, MIN_POCKET, normalize, gridDividers, moveDivider, addDivider, pockets, inner, summary,
  stackTop, boxPart, trayPart, partOf, withPart, addTray, placeTray, resizeTray, fillTray, trayZ, trayTouches, problems, ends, placeDivider, setDividerEnd, turnDivider, fullLength } from "../src/design.js";

const base = (extra = {}) => normalize({ ...DEFAULT_DESIGN, ...extra });

describe("print rules", () => {
  it("keeps every size inside its limits", () => {
    const d = normalize({ width: 5, depth: 9999, height: -3, wall: 0.1, floor: 99, radius: 500, clearance: 2 });
    expect(d.width).toBe(LIMITS.width[0]);
    expect(d.depth).toBe(LIMITS.depth[1]);
    expect(d.height).toBe(LIMITS.height[0]);
    expect(d.wall).toBeGreaterThanOrEqual(LIMITS.wall[0]);
    expect(d.floor).toBeLessThan(d.height);
    expect(d.radius).toBeLessThan(Math.min(d.width, d.depth) / 2);
    expect(d.clearance).toBe(LIMITS.clearance[1]);
  });
  it("falls back to no lid for an unknown lid", () => {
    expect(base({ lid: "hinged" }).lid).toBe("none");
  });
});

describe("dividers", () => {
  it("makes an even grid", () => {
    const d = base();
    const divs = gridDividers(d, 3, 2);
    expect(divs.filter(x => x.axis === "x").map(x => x.at)).toEqual([38.9, 77.9]); // 116.8 mm inside, in thirds
    expect(divs.filter(x => x.axis === "y").map(x => x.at)).toEqual([38.4]);
    expect(pockets({ ...d, dividers: divs })).toHaveLength(6);
  });

  it("snaps a dragged divider to 1 mm and stops it short of its neighbours", () => {
    let d = base(); d = { ...d, dividers: gridDividers(d, 3, 1) };
    const [a, b] = d.dividers;
    expect(moveDivider(d, a.id, 50.4).dividers[0].at).toBe(50);
    const squashed = moveDivider(d, a.id, b.at + 10).dividers[0].at;
    expect(squashed).toBeLessThanOrEqual(b.at - d.divider - MIN_POCKET);
    expect(moveDivider(d, a.id, -40).dividers[0].at).toBeGreaterThanOrEqual(MIN_POCKET);
  });

  it("adds a divider in the widest pocket, and refuses when there is no room", () => {
    let d = base();
    const r = addDivider(d, "x");
    expect(r.design.dividers[0].at).toBe(Math.round(inner(d).w / 2));
    // 20 mm wide leaves 16.8 mm inside: room for one divider, not two.
    const once = addDivider(base({ width: 20 }), "x");
    expect(once).not.toBeNull();
    expect(addDivider(once.design, "x")).toBeNull();
  });

  it("keeps a grid even when the box is resized", () => {
    let d = base(); d = { ...d, dividers: gridDividers(d, 2, 1) };
    const bigger = normalize({ ...d, width: 200 }, d);
    expect(bigger.dividers[0].at).toBeCloseTo(inner(bigger).w / 2, 0);
  });

  it("drops dividers that no longer fit after shrinking", () => {
    let d = base(); d = { ...d, dividers: gridDividers(d, 4, 1) };
    const small = normalize({ ...d, width: 30 }, d);
    for (const p of pockets(small)) expect(p.w).toBeGreaterThanOrEqual(MIN_POCKET - 0.01);
  });

  it("describes the design in one line", () => {
    let d = base({ lid: "lift" }); d = { ...d, dividers: gridDividers(d, 3, 2) };
    expect(summary(d)).toBe("120 × 80 × 40 mm, 6 pockets, lift-off lid");
    expect(summary(d, "in")).toMatch(/^4\.72 × 3\.15 × 1\.57 in/);
  });
});

describe("the lid", () => {
  it("leaves room for the lid's lip above the dividers", () => {
    const d = base({ lid: "lift", lidLip: 6, clearance: 0.25 });
    expect(stackTop(d)).toBeCloseTo(40 - 6 - 0.5);
    expect(boxPart(d).dividerTop).toBeCloseTo(stackTop(d));
    expect(boxPart(base()).dividerTop).toBe(40);
  });
});

describe("trays", () => {
  // 120 × 80 box: 116.8 × 76.8 inside; trays keep 0.25 mm from the walls and each other.
  const c = 0.25;
  const withTrays = (trays, extra = {}) => normalize({ ...base({ height: 60, ...extra }), trays });

  it("a new tray fills half the width, in the first free corner", () => {
    let d = base({ height: 60 });
    const a = addTray(d); d = normalize(a.design);
    expect(d.trays[0]).toMatchObject({ x: c, y: c, w: 58.02, d: 76.3, height: 20 });
    const b = addTray(d); d = normalize(b.design);
    expect(d.trays[1].x).toBeCloseTo(116.8 - c - 58.02);
    expect(trayTouches(d, d.trays[0])).toBeGreaterThanOrEqual(2);
    // The third has no free corner, so it stacks on top.
    d = normalize(addTray(d).design);
    expect(trayZ(d, d.trays[2])).toBeCloseTo(d.floor + 20);
  });

  it("while dragging it snaps to walls and other trays nearby", () => {
    let d = withTrays([{ id: "a", x: c, y: c, w: 40, d: 30 }, { id: "b", x: 70, y: 40, w: 30, d: 30 }]);
    d = placeTray(d, "b", 43, 20); // its left side comes near tray a's right side (40.5)
    expect(d.trays[1].x).toBeCloseTo(40.5);
    expect(d.trays[1].y).toBe(20);
  });

  it("when dropped it locks where it touches at least two sides", () => {
    let d = withTrays([{ id: "a", x: 30, y: 20, w: 40, d: 30 }]);
    d = placeTray(d, "a", 30, 20, true);
    expect(trayTouches(d, d.trays[0])).toBeGreaterThanOrEqual(2);
    expect(d.trays[0]).toMatchObject({ x: c, y: c }); // the nearest corner
    // Between two walls counts too: a full-width tray only needs its depth placed.
    d = withTrays([{ id: "a", x: c, y: 20, w: 116.3, d: 30 }]);
    d = placeTray(d, "a", c, 20, true);
    expect(d.trays[0].y).toBe(20);
  });

  it("dropped onto another tray it stacks on top", () => {
    let d = withTrays([{ id: "a", x: c, y: c, w: 50, d: 50, height: 15 }, { id: "b", x: 66, y: c, w: 40, d: 40, height: 15 }]);
    d = placeTray(d, "b", c, c, true);
    expect(d.trays.map(t => t.id)).toEqual(["a", "b"]);
    expect(trayZ(d, d.trays[1])).toBeCloseTo(d.floor + 15);
  });

  it("trays stay below the lid's lip, and are dropped when there's no room", () => {
    let d = withTrays([{ id: "a", height: 40 }, { id: "b", height: 40 }], { lid: "lift" });
    // Both fill the inside, so b sits on a: 60 tall less the lip and gaps leaves 54.5 - 1.2 - 40.
    expect(d.trays.map(t => t.height)).toEqual([40, 13]);
    d = normalize({ ...d, height: 45 }, d);
    expect(d.trays.map(t => t.id)).toEqual(["a"]);
  });

  it("a tray keeps its place and size as a share of the inside when the box grows", () => {
    let d = withTrays([{ id: "a", x: c, y: c, w: 58, d: 76.3 }]);
    const big = normalize({ ...d, width: 220 }, d);
    expect(big.trays[0].w).toBeCloseTo((216.8 - 2 * c) * 58 / 116.3, 0);
    expect(big.trays[0].x).toBeCloseTo(c);
  });

  it("resizing keeps a tray against the far wall it was touching", () => {
    let d = withTrays([{ id: "a", x: 116.8 - c - 40, y: c, w: 40, d: 30 }]);
    d = resizeTray(d, "a", { w: 30 });
    expect(d.trays[0].x + d.trays[0].w).toBeCloseTo(116.8 - c);
    expect(fillTray(d, "a", "y").trays[0]).toMatchObject({ y: c, d: 76.3 });
  });

  it("a tray is a box of its own with its own dividers", () => {
    let d = withTrays([{ id: "a", x: c, y: c, w: 58, d: 76.3 }]);
    const t = trayPart(d, d.trays[0]);
    expect([t.width, t.depth]).toEqual([58, 76.3]);
    d = normalize(withPart(d, "a", { ...t, dividers: gridDividers(t, 2, 2) }));
    expect(pockets(partOf(d, "a"))).toHaveLength(4);
    expect(d.dividers).toHaveLength(0);
    expect(summary(d)).toBe("120 × 80 × 60 mm, 1 pocket, 1 tray");
  });

  it("warns when a tray on the floor sits on a box divider", () => {
    const d = normalize({ ...withTrays([{ id: "a", x: c, y: c, w: 58, d: 76.3 }]), dividers: [{ id: "x", axis: "x", at: 30 }] });
    expect(problems(d)).toEqual(["Tray 1 sits on a box divider. Move one of them."]);
    expect(problems(normalize({ ...d, dividers: [{ id: "x", axis: "x", at: 80 }] }))).toEqual([]);
  });
});

describe("free dividers", () => {
  // 120 × 80 box, 1.6 mm walls: 116.8 × 76.8 inside.
  const one = (div) => normalize({ ...base(), dividers: [{ id: "a", ...div }] });

  it("grid dividers run wall to wall", () => {
    const d = base(), [x] = gridDividers(d, 2, 1);
    expect(ends(d, x)).toEqual([0, 76.8]);
  });

  it("drags anywhere, and an end snaps to a wall when it comes close", () => {
    let d = one({ axis: "x", at: 30, from: 20, to: 50 });
    d = placeDivider(d, "a", 70.4, 17.5); // 30 long, so its front end would be at 2.5 mm
    expect(d.dividers[0]).toMatchObject({ at: 70, from: 0, to: 30 });
    d = placeDivider(d, "a", 70, 40);      // nothing near: whole millimetres
    expect(d.dividers[0]).toMatchObject({ from: 25, to: 55 });
  });

  it("an end snaps to a divider it reaches, and lines up with parallel ones", () => {
    let d = normalize({ ...base(), dividers: [
      { id: "wall", axis: "y", at: 40, from: 0, to: 116.8 },
      { id: "a", axis: "x", at: 20, from: 0, to: 30 },
      { id: "b", axis: "x", at: 80, from: 50, to: 76.8 },
    ] });
    d = placeDivider(d, "a", 21, 23); // its back end comes to 38, near the side-to-side divider at 40
    expect(d.dividers.find(x => x.id === "a")).toMatchObject({ from: 10, to: 40 });
    expect(d.dividers.find(x => x.id === "a").at).toBe(21);
    d = placeDivider(d, "b", 23.5, 63.4); // within the snap distance of "a": it lines up
    expect(d.dividers.find(x => x.id === "b").at).toBe(21);
  });

  it("an end handle makes it longer or shorter and snaps too", () => {
    let d = one({ axis: "y", at: 40, from: 10, to: 60 });
    expect(setDividerEnd(d, "a", "to", 114).dividers[0].to).toBe(116.8);
    expect(setDividerEnd(d, "a", "from", 58).dividers[0].from).toBe(55); // never shorter than 5 mm
  });

  it("turns a quarter turn about its middle, and stretches wall to wall", () => {
    let d = one({ axis: "x", at: 50, from: 20, to: 40 });
    d = turnDivider(d, "a");
    expect(d.dividers[0]).toMatchObject({ axis: "y", at: 30, from: 40, to: 60 });
    expect(fullLength(d, "a").dividers[0]).toMatchObject({ from: 0, to: 116.8 });
  });

  it("counts the pockets the pieces actually make", () => {
    // A short divider leaves one pocket; joined to both walls it makes two.
    expect(pockets(one({ axis: "x", at: 50, from: 20, to: 40 }))).toHaveLength(1);
    expect(pockets(one({ axis: "x", at: 50 }))).toHaveLength(2);
    // A T: one wall-to-wall divider, and a short one from the front wall up to it.
    const d = normalize({ ...base(), dividers: [{ id: "a", axis: "y", at: 40 }, { id: "b", axis: "x", at: 50, from: 0, to: 40 }] });
    expect(pockets(d)).toHaveLength(3);
  });

  it("keeps a short divider's place as the box grows", () => {
    const d = one({ axis: "x", at: 50, from: 20, to: 40 });
    const big = normalize({ ...d, depth: 160 }, d);
    expect(big.dividers[0].from).toBeCloseTo(20 * 156.8 / 76.8, 0);
    const full = one({ axis: "x", at: 50 }), deep = normalize({ ...full, depth: 160 }, full);
    expect(ends(deep, deep.dividers[0])).toEqual([0, 156.8]);
  });
});
