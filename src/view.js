// The 3D view: every part of the case as its own model, like an assembly in
// a CAD program. Tap a part to pick it. Drag a tray to move it around inside
// the box, drag a divider to move it, drag a picked divider's end dots to
// make it longer or shorter, and drag the round handles to resize the box.
// Dragging anywhere else turns the view; pinching or the mouse wheel zooms.
//
// Inside the case group everything is in the CAD frame (millimetres, Z up,
// the box centred with its floor on Z = 0). The scene is in metres, Y up.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { inner, ends, boxPart, trayPart, trayZ } from "./design.js";
import { dividerBoxes } from "./cad/case.js";

const PLASTIC = 0x4f86c6, TRAY = 0x7fb069, PICKED = 0xe8743b, HANDLE = 0xe8743b;
const HANDLE_GAP = 10; // mm between a wall and its handle
const GAP = 20; // mm between the box and the lid laid beside it

export function createView(host, { onSelect, onDivider, onDividerEnd, onTray, onTraySize, onResize }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f4);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 20);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.6, 1.2, 0.5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6 });
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xc9d2dc, 0.6));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);

  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  group.scale.setScalar(0.001);
  scene.add(group);
  const boxHolder = new THREE.Group(), boxDividers = new THREE.Group(), handleHolder = new THREE.Group(), lidHolder = new THREE.Group(), trayHolder = new THREE.Group();
  group.add(boxHolder, boxDividers, handleHolder, lidHolder, trayHolder);

  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const plastic = mat(PLASTIC), trayMat = mat(TRAY), picked = mat(PICKED);
  const pickedPart = new THREE.MeshStandardMaterial({ color: PICKED, roughness: 0.55, transparent: true, opacity: 0.92 });
  // Handles draw on top of everything, so one behind a wall can still be seen and grabbed.
  const handleMat = new THREE.MeshStandardMaterial({ color: HANDLE, roughness: 0.4, depthTest: false });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  // `selected` is { kind: "box" | "lid" | "tray" | "divider", id, parent }, a
  // divider's parent being "box" or its tray's id.
  let design = null, selected = null, drag = null;
  const shells = new Map(); // "box", "lid", "tray:<id>" → { geometry, size } from the engine
  let corner = [1, -1], heightHandle = [], handleFrame = null;

  // ---- the parts the engine built ---------------------------------------------
  function geometryFrom(m) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
    geo.computeBoundingBox();
    return geo;
  }
  const clear = g => { for (const o of [...g.children]) { g.remove(o); o.traverse(x => { if (!x.userData.keep) x.geometry?.dispose(); }); } };

  /** Show the meshes the engine built. */
  function setMeshes(meshes) {
    for (const s of shells.values()) s.geometry.dispose();
    shells.clear();
    for (const m of meshes) {
      const geometry = geometryFrom(m), b = geometry.boundingBox;
      shells.set(m.id, { geometry, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] });
    }
    if (design) draw();
  }

  // A shell from the engine, stretched to the size asked for while the
  // engine catches up with a resize.
  function shellMesh(key, size, material, userData) {
    const s = shells.get(key);
    let mesh;
    if (s) {
      mesh = new THREE.Mesh(s.geometry, material);
      mesh.userData.keep = true; // the geometry belongs to `shells`
      mesh.scale.set(size[0] / s.size[0], size[1] / s.size[1], size[2] / s.size[2]);
    } else {
      // Not built yet: a plain block where it will go.
      mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.z = size[2] / 2;
    }
    mesh.castShadow = mesh.receiveShadow = true;
    Object.assign(mesh.userData, userData);
    return mesh;
  }

  const isPicked = (kind, id) => !!selected && selected.kind === kind && selected.id === id;

  // Dividers of one part (the box or a tray), in that part's own frame.
  function drawDividers(holder, part, parent, r) {
    for (const b of dividerBoxes(part)) {
      const axis = part.dividers.find(x => x.id === b.id).axis;
      const size = b.max.map((v, k) => v - b.min[k]);
      const z0 = part.floor - 0.01, h = b.max[2] - z0;
      const on = isPicked("divider", b.id);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], h), on ? picked : parent === "box" ? plastic : trayMat);
      mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, z0 + h / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      // A wider invisible box makes thin dividers easy to grab with a finger.
      const grab = Math.max(8, Math.min(part.width, part.depth) * 0.08);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(axis === "x" ? Math.max(size[0], grab) : size[0], axis === "y" ? Math.max(size[1], grab) : size[1], h + 4), hitMat);
      hit.position.copy(mesh.position);
      hit.userData = { pick: { kind: "divider", id: b.id, parent } };
      holder.add(mesh, hit);
      // The picked divider gets a handle on each end to make it longer or shorter.
      if (on) {
        const k = axis === "x" ? 1 : 0;
        for (const [which, v] of [["from", b.min[k]], ["to", b.max[k]]]) {
          const p = [mesh.position.x, mesh.position.y, b.max[2] + r * 0.6];
          p[k] = v;
          const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 20, 12), picked);
          ball.position.set(...p);
          const grabEnd = new THREE.Mesh(new THREE.SphereGeometry(r * 2, 12, 8), hitMat);
          grabEnd.position.set(...p);
          grabEnd.userData = { end: which, pick: { kind: "divider", id: b.id, parent } };
          holder.add(ball, grabEnd);
        }
      }
    }
  }

  /** Where a tray sits: its middle in the case frame, and the height of its bottom. */
  function trayPlace(d, t) {
    const i = inner(d);
    return [-i.w / 2 + t.x + t.w / 2, -i.d / 2 + t.y + t.d / 2, trayZ(d, t)];
  }

  function draw() {
    const d = design;
    for (const g of [boxHolder, boxDividers, handleHolder, lidHolder, trayHolder]) clear(g);
    const r = Math.max(3.5, Math.max(d.width, d.depth, d.height) * 0.035);

    boxHolder.add(shellMesh("box", [d.width, d.depth, d.height], isPicked("box", "box") ? pickedPart : plastic, { pick: { kind: "box", id: "box" } }));
    drawDividers(boxDividers, boxPart(d), "box", r);

    if (d.lid === "lift") {
      // The lid sits beside the box, the way up it prints.
      lidHolder.add(shellMesh("lid", [d.width, d.depth, d.floor + d.lidLip], isPicked("lid", "lid") ? pickedPart : plastic, { pick: { kind: "lid", id: "lid" } }));
      lidHolder.position.set(d.width + GAP, 0, 0);
    }

    for (const t of d.trays) {
      const g = new THREE.Group();
      g.position.set(...trayPlace(d, t));
      g.add(shellMesh("tray:" + t.id, [t.w, t.d, t.height], isPicked("tray", t.id) ? pickedPart : trayMat, { pick: { kind: "tray", id: t.id } }));
      drawDividers(g, trayPart(d, t), t.id, r * 0.8);
      trayHolder.add(g);
    }

    // Resize handles go on what is picked: the box (or nothing picked), or a tray.
    handleFrame = handlesFor(d);
    if (handleFrame) {
      const f = handleFrame, hr = f.part === "box" ? r : r * 0.8;
      const handle = (kind, x, y, z) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(hr, 24, 16), handleMat);
        ball.position.set(x, y, z);
        ball.renderOrder = 10;
        const hit = new THREE.Mesh(new THREE.SphereGeometry(hr * 2.4, 12, 8), hitMat);
        hit.position.copy(ball.position);
        hit.userData = { handle: kind, part: f.part };
        handleHolder.add(ball, hit);
      };
      handle("width", f.cx + f.sx * (f.w / 2 + f.gap), f.cy, f.hz);
      handle("depth", f.cx, f.cy + f.sy * (f.d / 2 + f.gap), f.hz);
      handle("height", 0, 0, 0);
      heightHandle = handleHolder.children.slice(-2);
    } else heightHandle = [];
    placeCorner();
  }

  function setDesign(d) { design = d; draw(); }
  function select(sel) { selected = sel; if (design) draw(); }

  // The height handle sits on the back corner, away from the camera, so it
  // never covers the inside.
  function placeCorner() {
    if (!design || !heightHandle.length) return;
    if (!(drag && drag.handle === "height")) {
      group.updateMatrixWorld();
      const cam = group.worldToLocal(camera.position.clone());
      corner = [cam.x > 0 ? -1 : 1, cam.y > 0 ? -1 : 1];
    }
    const f = handleFrame;
    for (const o of heightHandle) o.position.set(f.cx + corner[0] * f.w / 2, f.cy + corner[1] * f.d / 2, f.z0 + f.h + f.gap);
  }

  // Where the picked part's handles go: its middle (cx, cy), bottom z0, size,
  // and which way the width (sx) and depth (sy) handles sit. A tray's handles
  // sit on the sides away from the walls it is against.
  function handlesFor(d) {
    if (!selected || selected.kind === "box")
      return { part: "box", cx: 0, cy: 0, z0: 0, w: d.width, d: d.depth, h: d.height, hz: d.height / 2, sx: 1, sy: -1, gap: HANDLE_GAP };
    if (selected.kind !== "tray") return null;
    const t = d.trays.find(x => x.id === selected.id);
    if (!t) return null;
    const i = inner(d), c = d.clearance, [cx, cy, z0] = trayPlace(d, t);
    const right = Math.abs(t.x + t.w - (i.w - c)) < 0.05 && Math.abs(t.x - c) > 0.05;
    const back = Math.abs(t.y + t.d - (i.d - c)) < 0.05 && Math.abs(t.y - c) > 0.05;
    return { part: t.id, cx, cy, z0, w: t.w, d: t.d, h: t.height, hz: z0 + t.height, sx: right ? -1 : 1, sy: back ? -1 : 1, gap: HANDLE_GAP * 0.6 };
  }

  // ---- framing ------------------------------------------------------------------
  function frame() {
    if (!design) return;
    // Fit a sphere round the box (and the lid beside it) into the view.
    const lidW = design.lid === "lift" ? design.width + GAP : 0;
    const x0 = -design.width / 2, x1 = design.width / 2 + lidW;
    const w = (x1 - x0) * 0.001, dep = design.depth * 0.001, h = design.height * 0.001;
    const radius = Math.hypot(w, dep, h) / 2;
    const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const fit = Math.min(Math.tan(fov), Math.tan(fov) * camera.aspect);
    const dist = radius / Math.sin(Math.atan(fit)) * 1.05;
    controls.target.set((x0 + x1) / 2 * 0.001, h / 2, 0);
    const dir = new THREE.Vector3(0.35, 0.8, 1).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  // ---- pointer: pick and drag parts, otherwise turn the view -------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const canvas = renderer.domElement;
  function hitAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  // Where the pointer ray crosses a plane given in the case frame.
  function onPlane(normal, point) {
    group.updateMatrixWorld();
    const n = normal.clone().transformDirection(group.matrixWorld);
    const p = point.clone().applyMatrix4(group.matrixWorld);
    const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, p), new THREE.Vector3());
    return hit && group.worldToLocal(hit);
  }
  const UP = new THREE.Vector3(0, 0, 1);

  // A part's inside front-left corner and top, in the case frame: the frame
  // its dividers are laid out in.
  function partFrame(parent) {
    const i = inner(design);
    if (parent === "box") return { x: -i.w / 2, y: -i.d / 2, top: design.height, part: boxPart(design) };
    const t = design.trays.find(x => x.id === parent);
    if (!t) return null;
    const [cx, cy, z] = trayPlace(design, t), part = trayPart(design, t), pi = inner(part);
    return { x: cx - pi.w / 2, y: cy - pi.d / 2, top: z + t.height, part };
  }

  // Everything you can grab; handles and end dots win over what they sit on.
  function grabbable() {
    const out = [];
    group.traverse(o => { if (o.userData.pick || o.userData.handle) out.push(o); });
    return out;
  }
  function pickAt(e) {
    hitAt(e);
    const hits = ray.intersectObjects(grabbable(), false);
    // Handles and end dots first, then what sits inside the box (trays and
    // dividers), so a part behind the box's wall can still be grabbed.
    const inside = h => ["tray", "divider"].includes(h.object.userData.pick?.kind);
    return (hits.find(h => h.object.userData.end || h.object.userData.handle) || hits.find(inside) || hits[0])?.object || null;
  }

  let down = null, touches = 0;
  // Registered before OrbitControls so a grab can switch the controls off
  // before they start turning the view.
  canvas.addEventListener("pointerdown", e => {
    touches++;
    if (touches > 1) { if (drag) endDrag(false); return; }
    down = { x: e.clientX, y: e.clientY };
    if (!design) return;
    const hit = pickAt(e);
    if (!hit) return;
    if (hit.userData.handle) {
      drag = { handle: hit.userData.handle, frame: handleFrame };
    } else if (hit.userData.end) {
      drag = { end: hit.userData.end, divider: hit.userData.pick };
    } else {
      const pick = hit.userData.pick;
      if (pick.kind === "divider") {
        const f = partFrame(pick.parent), div = f.part.dividers.find(x => x.id === pick.id);
        const p = onPlane(UP, new THREE.Vector3(0, 0, f.top));
        const [a, b] = ends(f.part, div);
        const u = p ? p.x - f.x : 0, v = p ? p.y - f.y : 0;
        const [across, along] = div.axis === "x" ? [u, v] : [v, u];
        drag = { divider: pick, offset: p ? [div.at - across, (a + b) / 2 - along] : [0, 0] };
      } else if (pick.kind === "tray") {
        const t = design.trays.find(x => x.id === pick.id), [, , z] = trayPlace(design, t), i = inner(design);
        const p = onPlane(UP, new THREE.Vector3(0, 0, z + t.height));
        drag = { tray: t.id, offset: p ? [t.x - (p.x + i.w / 2), t.y - (p.y + i.d / 2)] : [0, 0], z: z + t.height };
      } else {
        // The box and lid are picked with a tap but not moved: a drag turns the view.
        return;
      }
      if (!isPicked(pick.kind, pick.id)) { selected = pick; onSelect(pick); draw(); }
    }
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", e => {
    if (!drag || !design) return;
    hitAt(e);
    if (drag.divider) {
      const pick = drag.divider, f = partFrame(pick.parent);
      const div = f && f.part.dividers.find(x => x.id === pick.id);
      const p = div && onPlane(UP, new THREE.Vector3(0, 0, f.top));
      if (!p) return;
      const u = p.x - f.x, v = p.y - f.y, [across, along] = div.axis === "x" ? [u, v] : [v, u];
      if (drag.end) onDividerEnd(pick.parent, pick.id, drag.end, along, false);
      else onDivider(pick.parent, pick.id, { at: across + drag.offset[0], mid: along + drag.offset[1] }, false);
    } else if (drag.tray) {
      const p = onPlane(UP, new THREE.Vector3(0, 0, drag.z)), i = inner(design);
      if (p) onTray(drag.tray, { x: p.x + i.w / 2 + drag.offset[0], y: p.y + i.d / 2 + drag.offset[1] }, false);
    } else if (drag.handle) {
      const f = drag.frame, i = inner(design), box = f.part === "box";
      if (drag.handle === "height") {
        // A vertical plane facing the camera, through the handle.
        const at = new THREE.Vector3(f.cx + corner[0] * f.w / 2, f.cy + corner[1] * f.d / 2, 0);
        const toCam = group.worldToLocal(camera.position.clone()).sub(at);
        toCam.z = 0;
        if (toCam.lengthSq() < 1e-6) return;
        const local = onPlane(toCam.normalize(), at);
        if (!local) return;
        if (box) onResize({ height: local.z - f.gap }, false);
        else onTraySize(f.part, "top", local.z - f.gap - f.z0, false);
        return;
      }
      const local = onPlane(UP, new THREE.Vector3(0, 0, f.hz));
      if (!local) return;
      if (drag.handle === "width") {
        if (box) onResize({ width: 2 * (local.x - f.gap) }, false);
        else onTraySize(f.part, f.sx > 0 ? "right" : "left", local.x + i.w / 2 - f.sx * f.gap, false);
      } else {
        if (box) onResize({ depth: 2 * (-local.y - f.gap) }, false);
        else onTraySize(f.part, f.sy > 0 ? "back" : "front", local.y + i.d / 2 - f.sy * f.gap, false);
      }
    }
  });

  function endDrag(commit = true) {
    const was = drag;
    drag = null;
    controls.enabled = true;
    if (!was || !commit) return;
    if (was.end) onDividerEnd(was.divider.parent, was.divider.id, was.end, null, true);
    else if (was.divider) onDivider(was.divider.parent, was.divider.id, null, true);
    else if (was.tray) onTray(was.tray, null, true);
    else if (was.frame.part !== "box") onTraySize(was.frame.part, null, null, true);
    else onResize(null, true);
  }
  const up = e => {
    touches = Math.max(0, touches - 1);
    if (drag) { endDrag(true); down = null; return; }
    // A tap (not a turn of the view) picks what is under it, or clears the pick.
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
      const pick = pickAt(e)?.userData.pick || null;
      if (pick ? !isPicked(pick.kind, pick.id) : selected) { selected = pick; onSelect(pick); draw(); }
    }
    down = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", () => { touches = Math.max(0, touches - 1); if (drag) endDrag(true); });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); placeCorner(); renderer.render(scene, camera); });

  /** Screen position (CSS pixels) of a point in the case frame, for tests. */
  function screenPoint([x, y, z]) {
    group.updateMatrixWorld();
    const p = new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }

  return {
    setMeshes, setDesign, select, frame, screenPoint,
    get heightCorner() { return corner; },
    /** Where each resize handle is, in the case frame, for tests: { part, width, depth, height }. */
    get handles() {
      const out = { part: handleFrame?.part ?? null };
      for (const o of handleHolder.children) if (o.userData.handle) out[o.userData.handle] = o.position.toArray();
      return out;
    },
    get dragging() { return !!drag; },
  };
}
