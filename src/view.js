// The 3D view: the case as the engine built it, dividers you can drag, and
// round handles that resize the box. Touch and mouse both work: dragging a
// divider or handle moves it, dragging anywhere else turns the view, and
// pinching or the mouse wheel zooms.
//
// Inside the case group everything is in the CAD frame (millimetres, Z up,
// the box centred with its floor on Z = 0). The scene is in metres, Y up.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { inner } from "./design.js";
import { dividerBoxes } from "./cad/case.js";

const PLASTIC = 0x4f86c6, PICKED = 0xe8743b, HANDLE = 0xe8743b;
const HANDLE_GAP = 10; // mm between a wall and its handle
const GAP = 20; // mm between the parts laid out side by side

export function createView(host, { onDivider, onResize, onSelect }) {
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
  const shellHolder = new THREE.Group(), dividerHolder = new THREE.Group(), handleHolder = new THREE.Group(), besideHolder = new THREE.Group();
  group.add(shellHolder, dividerHolder, handleHolder, besideHolder);

  const plastic = new THREE.MeshStandardMaterial({ color: PLASTIC, roughness: 0.55 });
  const picked = new THREE.MeshStandardMaterial({ color: PICKED, roughness: 0.5 });
  const handleMat = new THREE.MeshStandardMaterial({ color: HANDLE, roughness: 0.4 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  // `design` is the part being edited: the box, or a tray as a box of its own
  // (see partOf in design.js). `mode` is "box" or "tray": a tray only has a
  // height handle.
  let design = null, built = null, selected = null, drag = null, mode = "box";
  let corner = [1, -1], heightHandle = [];

  // ---- the parts the engine built -------------------------------------------
  function meshFrom(m) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
    const mesh = new THREE.Mesh(geo, plastic);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  const clear = g => { for (const o of [...g.children]) { g.remove(o); o.traverse(x => x.geometry?.dispose()); } };

  /** Show the meshes the engine built for the part `forPart`: its shell, then the other parts to lay out beside it. */
  function setMeshes(meshes, forPart) {
    clear(shellHolder); clear(besideHolder);
    built = forPart;
    for (const m of meshes) {
      const mesh = meshFrom(m);
      if (m.id === "shell") { shellHolder.add(mesh); continue; }
      mesh.geometry.computeBoundingBox();
      mesh.userData.width = mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x;
      besideHolder.add(mesh);
    }
    placeShell();
  }

  // While a handle is being dragged the old shell stretches to the new size
  // until the engine rebuilds it.
  function placeShell() {
    if (!built || !design) return;
    shellHolder.scale.set(design.width / built.width, design.depth / built.depth, design.height / built.height);
    // The lid and trays sit beside and behind the box, two to a row, the
    // way up they print.
    besideHolder.children.forEach((m, k) => {
      const cell = k + 1;
      m.position.set((cell % 2) * (design.width + GAP), Math.floor(cell / 2) * (design.depth + GAP), 0);
    });
  }
  // The floor space everything on show takes up: [x0, x1, y0, y1] in mm.
  function extent() {
    const n = besideHolder.children.length + 1, cols = Math.min(2, n), rows = Math.ceil(n / 2);
    return [-design.width / 2, -design.width / 2 + cols * (design.width + GAP) - GAP, -design.depth / 2, -design.depth / 2 + rows * (design.depth + GAP) - GAP];
  }

  // ---- dividers and handles, drawn from the design ----------------------------
  function setDesign(d) {
    design = d;
    clear(dividerHolder); clear(handleHolder);
    for (const b of dividerBoxes(d)) {
      const size = b.max.map((v, k) => v - b.min[k]);
      const z0 = d.floor - 0.01, h = b.max[2] - z0;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], h), b.id === selected ? picked : plastic);
      mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, z0 + h / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      // A wider invisible box makes thin dividers easy to grab with a finger.
      const grab = Math.max(8, Math.min(d.width, d.depth) * 0.08);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size[0], size[0] < size[1] ? grab : 0), Math.max(size[1], size[1] < size[0] ? grab : 0), h + 4), hitMat);
      hit.position.copy(mesh.position);
      hit.userData = { divider: b.id };
      dividerHolder.add(mesh, hit);
    }
    const r = Math.max(3.5, Math.max(d.width, d.depth, d.height) * 0.035);
    const handle = (kind, x, y, z) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), handleMat);
      ball.position.set(x, y, z);
      ball.castShadow = true;
      const hit = new THREE.Mesh(new THREE.SphereGeometry(r * 2.4, 12, 8), hitMat);
      hit.position.copy(ball.position);
      hit.userData = { handle: kind };
      handleHolder.add(ball, hit);
    };
    if (mode === "box") {
      handle("width", d.width / 2 + HANDLE_GAP, 0, d.height / 2);
      handle("depth", 0, -d.depth / 2 - HANDLE_GAP, d.height / 2);
    }
    handle("height", 0, 0, d.height + HANDLE_GAP);
    heightHandle = handleHolder.children.slice(-2);
    placeCorner();
    placeShell();
  }

  // The height handle sits on the back corner, away from the camera, so it
  // never covers the pockets.
  function placeCorner() {
    if (!design || !heightHandle.length) return;
    if (!(drag && drag.handle === "height")) {
      group.updateMatrixWorld();
      const cam = group.worldToLocal(camera.position.clone());
      corner = [cam.x > 0 ? -1 : 1, cam.y > 0 ? -1 : 1];
    }
    for (const o of heightHandle) o.position.set(corner[0] * design.width / 2, corner[1] * design.depth / 2, design.height + HANDLE_GAP);
  }

  function select(id) { selected = id; if (design) setDesign(design); }
  function setMode(m) { mode = m; }

  // ---- framing ------------------------------------------------------------------
  function frame() {
    if (!design) return;
    // Fit a sphere round the box (and the parts beside it) into the view.
    const [x0, x1, y0, y1] = extent();
    const w = (x1 - x0) * 0.001, dep = (y1 - y0) * 0.001, h = design.height * 0.001;
    const radius = Math.hypot(w, dep, h) / 2;
    const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const fit = Math.min(Math.tan(fov), Math.tan(fov) * camera.aspect);
    const dist = radius / Math.sin(Math.atan(fit)) * 1.05;
    // The case frame's +Y (behind the box) is the scene's -Z.
    controls.target.set((x0 + x1) / 2 * 0.001, h / 2, -(y0 + y1) / 2 * 0.001);
    const dir = new THREE.Vector3(0.35, 0.8, 1).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  // ---- pointer: drag dividers and handles, otherwise turn the view ----------------
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

  let down = null, touches = 0;
  // Registered before OrbitControls so a grab can switch the controls off
  // before they start turning the view.
  canvas.addEventListener("pointerdown", e => {
    touches++;
    if (touches > 1) { if (drag) endDrag(false); return; }
    down = { x: e.clientX, y: e.clientY };
    if (!design) return;
    hitAt(e);
    const hits = ray.intersectObjects([...handleHolder.children, ...dividerHolder.children].filter(o => o.userData.handle || o.userData.divider));
    const hit = hits[0]?.object;
    if (!hit) return;
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    if (hit.userData.divider) {
      const div = design.dividers.find(x => x.id === hit.userData.divider);
      const local = onPlane(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, design.height));
      const i = inner(design);
      const pos = local ? (div.axis === "x" ? local.x + i.w / 2 : local.y + i.d / 2) : div.at;
      drag = { divider: div.id, offset: div.at - pos };
      if (selected !== div.id) { selected = div.id; onSelect(div.id); setDesign(design); }
    } else {
      drag = { handle: hit.userData.handle };
    }
  });

  canvas.addEventListener("pointermove", e => {
    if (!drag || !design) return;
    hitAt(e);
    if (drag.divider) {
      const div = design.dividers.find(x => x.id === drag.divider);
      if (!div) return;
      const local = onPlane(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, design.height));
      if (!local) return;
      const i = inner(design);
      onDivider(div.id, (div.axis === "x" ? local.x + i.w / 2 : local.y + i.d / 2) + drag.offset, false);
    } else if (drag.handle === "width") {
      const local = onPlane(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, design.height / 2));
      if (local) onResize({ width: 2 * (local.x - HANDLE_GAP) }, false);
    } else if (drag.handle === "depth") {
      const local = onPlane(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, design.height / 2));
      if (local) onResize({ depth: 2 * (-local.y - HANDLE_GAP) }, false);
    } else if (drag.handle === "height") {
      // A vertical plane facing the camera, through the handle.
      const at = new THREE.Vector3(corner[0] * design.width / 2, corner[1] * design.depth / 2, 0);
      const toCam = group.worldToLocal(camera.position.clone()).sub(at);
      toCam.z = 0;
      if (toCam.lengthSq() < 1e-6) return;
      const local = onPlane(toCam.normalize(), at);
      if (local) onResize({ height: local.z - HANDLE_GAP }, false);
    }
  });

  function endDrag(commit = true) {
    const was = drag;
    drag = null;
    controls.enabled = true;
    if (!was || !commit) return;
    if (was.divider) onDivider(was.divider, null, true);
    else onResize(null, true);
  }
  const up = e => {
    touches = Math.max(0, touches - 1);
    if (drag) { endDrag(true); return; }
    // A tap on empty space (not a turn of the view) clears the selection.
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && selected) {
      hitAt(e);
      const onDiv = ray.intersectObjects(dividerHolder.children.filter(o => o.userData.divider)).length;
      if (!onDiv) { selected = null; onSelect(null); setDesign(design); }
    }
    down = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", e => { touches = Math.max(0, touches - 1); if (drag) endDrag(true); });

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

  /** Screen position (CSS pixels in the canvas) of a point in the case frame, for tests. */
  function screenPoint([x, y, z]) {
    group.updateMatrixWorld();
    const p = new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }

  return { setMeshes, setDesign, setMode, select, frame, get heightCorner() { return corner; }, screenPoint, get dragging() { return !!drag; } };
}
