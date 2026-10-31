// The app: every part of the case (the box, its lid, trays and dividers) is
// its own model you can pick and drag, like an assembly in a CAD program.
// The parts list on the left picks them too; the Box, Trays and Dividers
// tabs on the right set their sizes and add or remove them. Each part
// downloads as an STL ready to print, and a design can be shared as a link
// or a file.
import { cad } from "./cad/client.js";
import { createView } from "./view.js";
import { DEFAULT_DESIGN, LIMITS, LIDS, IN, MAX_TRAYS, TRAY_HEIGHT, TRAY_MIN, normalize, moveDivider, placeDivider, setDividerEnd,
  turnDivider, fullLength, addDivider, dividerRange, inner, summary, partOf, withPart, addTray, placeTray, resizeTray, fillTray,
  trayZ, stackTop, problems, softStop, STOPS, sizeTrayEdge, copyTray, copyDivider } from "./design.js";

const $ = id => document.getElementById(id);
const STORE = "storage-case-v1";

// ---- state, kept in this browser -----------------------------------------------
// A first visit starts with one divider so there is something to drag.
const START = { ...DEFAULT_DESIGN, dividers: [{ id: "d0", axis: "x", at: 58.4 }] };
let state = { design: START, units: "mm", tab: "box", parent: "box" };
try { state = { ...state, ...JSON.parse(localStorage.getItem(STORE) || "{}") }; } catch (e) { /* start fresh */ }
let opened = openShared();
state.design = normalize(state.design);
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...state, sel: undefined })); } catch (e) { /* private window */ } };
let sel = null; // what is picked: { kind: "box" | "lid" | "tray" | "divider", id, parent }

// ---- units ------------------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shown = mm => state.units === "in" ? +(mm / IN).toFixed(2) : Math.round(mm * 10) / 10;
const fromShown = v => state.units === "in" ? v * IN : v;
const text = mm => state.units === "in" ? `${(mm / IN).toFixed(2)} in` : `${+mm.toFixed(2)} mm`;
for (const b of document.querySelectorAll("[data-units]")) b.onclick = () => { state.units = b.dataset.units; save(); render(); };

// ---- names ----------------------------------------------------------------------------
const trayName = id => `Tray ${state.design.trays.findIndex(t => t.id === id) + 1}`;
const parentName = parent => parent === "box" ? "Box" : trayName(parent);
const dividerName = (parent, id) => `Divider ${partOf(state.design, parent).dividers.findIndex(x => x.id === id) + 1}`;
function pickName(p) {
  if (!p) return "";
  if (p.kind === "box") return "Box";
  if (p.kind === "lid") return "Lid";
  if (p.kind === "tray") return trayName(p.id);
  return `${dividerName(p.parent, p.id)} in ${parentName(p.parent).toLowerCase()}`;
}

// ---- the 3D view ------------------------------------------------------------------
const view = createView($("view"), {
  onSelect(p) { pick(p, { fromView: true }); },
  onDivider(parent, id, to, done) {
    if (!done) { state.design = withPart(state.design, parent, placeDivider(partOf(state.design, parent), id, to.at, to.mid)); view.setDesign(state.design); return; }
    afterDrag();
  },
  onDividerEnd(parent, id, which, value, done) {
    if (!done) { state.design = withPart(state.design, parent, setDividerEnd(partOf(state.design, parent), id, which, value)); view.setDesign(state.design); return; }
    afterDrag();
  },
  onTray(id, to, done) {
    if (!done) { state.design = placeTray(state.design, id, to.x, to.y); view.setDesign(state.design); return; }
    // Let go: lock it against at least two sides.
    const t = state.design.trays.find(x => x.id === id);
    setDesign(placeTray(state.design, id, t.x, t.y, true));
  },
  onTraySize(id, edge, value, done) {
    if (!done) { state.design = sizeTrayEdge(state.design, id, edge, value); view.setDesign(state.design); renderTrays(); return; }
    // Let go: make sure it still touches two sides, and rebuild it.
    const t = state.design.trays.find(x => x.id === id);
    if (t) setDesign(placeTray(normalize(state.design, state.design), id, t.x, t.y, true));
  },
  onResize(change, done) {
    if (!done) {
      // Soft stops: the box sticks to every 10 mm across and every 5 mm up.
      for (const k of Object.keys(change)) change[k] = softStop(change[k], k === "height" ? STOPS.height : STOPS.size);
      setDesign({ ...state.design, ...change }, { quiet: true });
      return;
    }
    save(); render(); scheduleBuild(0);
  },
});
function afterDrag() { state.design = normalize(state.design); view.setDesign(state.design); save(); render(); }
$("reframe").onclick = () => view.frame();

// Every change to the design goes through here so the print rules always hold.
function setDesign(next, { quiet = false } = {}) {
  state.design = normalize(next, state.design);
  if (sel && !exists(sel)) pick(null);
  view.setDesign(state.design);
  if (quiet) { renderDims(); renderSummary(); return; }
  save(); render();
  if (shapeKey() !== builtKey) scheduleBuild();
}
function exists(p) {
  const d = state.design;
  if (p.kind === "box") return true;
  if (p.kind === "lid") return d.lid === "lift";
  if (p.kind === "tray") return d.trays.some(t => t.id === p.id);
  return (p.parent === "box" || d.trays.some(t => t.id === p.parent)) && partOf(d, p.parent).dividers.some(x => x.id === p.id);
}

// Pick a part from the view, the parts list or a tab, and show its tab.
function pick(p, { fromView = false } = {}) {
  sel = p;
  if (!fromView) view.select(p);
  if (p) {
    state.tab = p.kind === "tray" ? "trays" : p.kind === "divider" ? "dividers" : "box";
    if (p.kind === "divider") state.parent = p.parent;
    if (p.kind === "tray" && state.tab === "dividers") state.parent = p.id;
  }
  $("parts").classList.remove("open");
  render();
}

// ---- building with the exact engine -------------------------------------------------
// What the engine's meshes depend on. Moving a tray or divider needs no
// rebuild: the view places the parts and draws the dividers itself.
const SHELL = ["width", "depth", "height", "wall", "floor", "divider", "radius", "lid", "clearance", "lidLip"];
const shapeKey = () => JSON.stringify([SHELL.map(k => state.design[k]), state.design.trays.map(t => [t.id, t.w, t.d, t.height])]);
let timer = null, building = false, again = false, framed = false, builtKey = null;
function setStatus(t, kind = "") { $("status").textContent = t; $("status").className = "chip " + kind; }
function scheduleBuild(delay = 250) { clearTimeout(timer); timer = setTimeout(build, delay); }
async function build() {
  if (building) { again = true; return; }
  building = true; again = false;
  setStatus("Building…", "busy");
  const d = state.design, key = shapeKey();
  try {
    const { meshes } = await cad("view", { design: d });
    view.setMeshes(meshes);
    builtKey = key;
    if (!framed) { framed = true; view.frame(); }
    setStatus(opened ? opened : "Ready");
    opened = null;
    $("dl-stl").disabled = false;
    window.__built = (window.__built || 0) + 1;
  } catch (err) {
    setStatus("Couldn't build: " + err.message, "error");
  } finally {
    building = false;
    if (again) build();
  }
}

// ---- left: the parts list -------------------------------------------------------------
function renderParts() {
  const d = state.design, out = [];
  const row = (p, name, cls, swatch) => {
    const on = sel && sel.kind === p.kind && sel.id === p.id;
    out.push(`<button type="button" class="part ${cls}" data-pick='${esc(JSON.stringify(p))}' aria-current="${on}"><span class="swatch ${swatch}"></span>${esc(name)}</button>`);
  };
  const dividers = parent => partOf(d, parent).dividers.forEach((x, k) =>
    row({ kind: "divider", id: x.id, parent }, `Divider ${k + 1}`, "child", `div ${parent === "box" ? "" : "tray"}`));
  row({ kind: "box", id: "box" }, "Box", "", "");
  dividers("box");
  if (d.lid === "lift") row({ kind: "lid", id: "lid" }, "Lid", "", "");
  d.trays.forEach((t, k) => { row({ kind: "tray", id: t.id }, `Tray ${k + 1}`, "", "tray"); dividers(t.id); });
  $("part-list").innerHTML = out.join("");
  for (const b of $("part-list").querySelectorAll("[data-pick]")) b.onclick = () => pick(JSON.parse(b.dataset.pick));
}
$("open-parts").onclick = () => $("parts").classList.toggle("open");

// ---- right: the tabs ---------------------------------------------------------------------
for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => { state.tab = b.dataset.tab; save(); render(); };

function renderSummary() { $("summary").textContent = summary(state.design, state.units); }

function renderDims() {
  const d = state.design, u = state.units, step = u === "in" ? 0.05 : 1;
  const box = (k, label) => `<div><label for="d-${k}">${label} (${u})</label><input type="number" inputmode="decimal" id="d-${k}" data-dim="${k}"
    min="${shown(LIMITS[k][0])}" max="${shown(LIMITS[k][1])}" step="${step}" value="${shown(d[k])}"></div>`;
  $("dims").innerHTML = box("width", "Width") + box("depth", "Depth") + box("height", "Height");
  for (const inp of $("dims").querySelectorAll("input")) inp.onchange = () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) setDesign({ ...state.design, [inp.dataset.dim]: fromShown(v) });
    else renderDims();
  };
}

function sliders(host, list) {
  const d = state.design;
  host.innerHTML = list.map(([k, label]) => `<div class="sl"><label for="s-${k}">${label}</label><output id="o-${k}">${text(d[k])}</output>
    <input type="range" id="s-${k}" data-key="${k}" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" step="${k === "clearance" ? 0.05 : k === "radius" || k === "lidLip" ? 0.5 : 0.1}" value="${d[k]}"></div>`).join("");
  for (const inp of host.querySelectorAll("input")) {
    inp.oninput = () => { $("o-" + inp.dataset.key).textContent = text(+inp.value); };
    inp.onchange = () => setDesign({ ...state.design, [inp.dataset.key]: +inp.value });
  }
}

function renderBox() {
  const d = state.design;
  renderDims();
  sliders($("walls"), [["wall", "Wall thickness"], ["floor", "Floor thickness"], ["divider", "Divider thickness"], ["radius", "Corner radius"]]);
  $("lids").innerHTML = LIDS.map(l => `<button type="button" class="tile" role="radio" data-lid="${l.id}" aria-checked="${d.lid === l.id}">${esc(l.name)}</button>`).join("");
  for (const b of $("lids").querySelectorAll(".tile")) b.onclick = () => setDesign({ ...state.design, lid: b.dataset.lid });
  $("lid-sliders").hidden = d.lid !== "lift";
  if (d.lid === "lift") sliders($("lid-sliders"), [["lidLip", "Lip depth"], ["clearance", "Gap round the lip and trays"]]);
}

function renderTrays() {
  const d = state.design;
  $("tray-list").innerHTML = d.trays.length
    ? d.trays.map((t, k) => `<button type="button" class="part" data-tray="${t.id}" aria-current="${!!sel && sel.kind === "tray" && sel.id === t.id}">
        <span class="swatch tray"></span>Tray ${k + 1} <span class="empty">· ${text(t.w)} × ${text(t.d)} × ${text(t.height)}</span></button>`).join("")
    : `<p class="empty">No trays yet. Add one, then drag it where you want it.</p>`;
  for (const b of $("tray-list").querySelectorAll("[data-tray]")) b.onclick = () => pick({ kind: "tray", id: b.dataset.tray });
  $("add-tray").disabled = d.trays.length >= MAX_TRAYS;
  $("add-tray").onclick = () => {
    const r = addTray(state.design);
    if (!r) { setStatus("No room for another tray. Make the box taller or a tray shorter.", "error"); return; }
    setDesign(r.design);
    pick({ kind: "tray", id: r.id });
  };
  const t = sel && sel.kind === "tray" && d.trays.find(x => x.id === sel.id);
  $("tray-editor").hidden = !t;
  if (!t) return;
  const i = inner(d), c = d.clearance, u = state.units, step = u === "in" ? 0.05 : 1;
  const maxH = Math.floor(stackTop(d) - trayZ(d, t));
  const num = (k, label, lo, hi) => `<div><label for="t-${k}">${label} (${u})</label><input type="number" inputmode="decimal" id="t-${k}" data-k="${k}"
    min="${shown(lo)}" max="${shown(hi)}" step="${step}" value="${shown(t[k])}"></div>`;
  $("tray-editor").innerHTML = `<h4>${trayName(t.id)}</h4>
    <div class="dims">${num("w", "Width", TRAY_MIN, i.w - 2 * c)}${num("d", "Depth", TRAY_MIN, i.d - 2 * c)}${num("height", "Height", TRAY_HEIGHT[0], maxH)}</div>
    <div class="row">
      <button class="btn" id="t-fill-x" type="button">Full width</button>
      <button class="btn" id="t-fill-y" type="button">Full depth</button>
      <button class="btn" id="t-copy" type="button">Copy tray</button>
      <button class="btn" id="t-dividers" type="button">Its dividers</button>
      <button class="btn danger" id="t-delete" type="button">Delete</button>
    </div>`;
  for (const inp of $("tray-editor").querySelectorAll("input")) inp.onchange = () => {
    const v = parseFloat(inp.value);
    if (!Number.isFinite(v)) return renderTrays();
    const next = resizeTray(state.design, t.id, { [inp.dataset.k]: fromShown(v) });
    const moved = next.trays.find(x => x.id === t.id);
    setDesign(placeTray(normalize(next, state.design), t.id, moved.x, moved.y, true));
  };
  const relock = next => { const m = next.trays.find(x => x.id === t.id); setDesign(placeTray(normalize(next, state.design), t.id, m.x, m.y, true)); };
  $("t-fill-x").onclick = () => relock(fillTray(state.design, t.id, "x"));
  $("t-fill-y").onclick = () => relock(fillTray(state.design, t.id, "y"));
  $("t-copy").onclick = () => {
    const r = copyTray(state.design, t.id);
    if (!r) { setStatus(d.trays.length >= MAX_TRAYS ? `${MAX_TRAYS} trays is the most` : "No room for a copy. Make the box taller or the tray shorter.", "error"); return; }
    setDesign(r.design);
    pick({ kind: "tray", id: r.id });
  };
  $("t-dividers").onclick = () => { state.parent = t.id; state.tab = "dividers"; save(); render(); };
  $("t-delete").onclick = () => remove({ kind: "tray", id: t.id });
}

function renderDividers() {
  const d = state.design;
  if (state.parent !== "box" && !d.trays.some(t => t.id === state.parent)) state.parent = "box";
  const parents = [["box", "Box"], ...d.trays.map((t, k) => [t.id, `Tray ${k + 1}`])];
  $("div-parent").innerHTML = parents.map(([id, name]) => `<option value="${id}"${id === state.parent ? " selected" : ""}>${name}</option>`).join("");
  $("div-parent").onchange = () => { state.parent = $("div-parent").value; save(); pick(null); };
  const part = partOf(d, state.parent);
  $("div-list").innerHTML = part.dividers.length
    ? part.dividers.map((x, k) => `<button type="button" class="part" data-div="${x.id}" aria-current="${!!sel && sel.id === x.id}">
        <span class="swatch div ${state.parent === "box" ? "" : "tray"}"></span>Divider ${k + 1} <span class="empty">· ${x.axis === "x" ? "front to back" : "side to side"}</span></button>`).join("")
    : `<p class="empty">No dividers in this part yet.</p>`;
  for (const b of $("div-list").querySelectorAll("[data-div]")) b.onclick = () => pick({ kind: "divider", id: b.dataset.div, parent: state.parent });
  const add = axis => {
    const r = addDivider(partOf(state.design, state.parent), axis);
    if (!r) { setStatus("No room for another divider that way", "error"); return; }
    setDesign(withPart(state.design, state.parent, r.design));
    pick({ kind: "divider", id: r.id, parent: state.parent });
  };
  $("add-x").onclick = () => add("x");
  $("add-y").onclick = () => add("y");

  const div = sel && sel.kind === "divider" && sel.parent === state.parent && part.dividers.find(x => x.id === sel.id);
  $("div-editor").hidden = !div;
  if (!div) return;
  const full = Math.min(inner(part).h, part.dividerTop - part.floor), h = Math.min(div.height ?? full, full);
  const [lo, hi] = dividerRange(part, div);
  const from = div.axis === "x" ? "from the left wall" : "from the front wall";
  $("div-editor").innerHTML = `<h4>${dividerName(state.parent, div.id)}, ${div.axis === "x" ? "front to back" : "side to side"}</h4>
    <div class="sliders">
      <div class="sl"><label for="sel-at">Position</label><output id="o-sel-at">${text(div.at)} ${from}</output>
        <input type="range" id="sel-at" min="${Math.ceil(lo)}" max="${Math.floor(hi)}" step="1" value="${div.at}"></div>
      <div class="sl"><label for="sel-h">Height</label><output id="o-sel-h">${h >= full ? "Full height" : text(h)}</output>
        <input type="range" id="sel-h" min="3" max="${Math.floor(full)}" step="1" value="${Math.min(h, Math.floor(full))}"></div>
    </div>
    <div class="row">
      <button class="btn" id="sel-turn" type="button">Turn 90°</button>
      <button class="btn" id="sel-full" type="button">Wall to wall</button>
      <button class="btn" id="sel-copy" type="button">Copy divider</button>
      <button class="btn danger" id="sel-delete" type="button">Delete</button>
    </div>`;
  const parent = state.parent;
  $("sel-at").oninput = () => {
    state.design = withPart(state.design, parent, moveDivider(partOf(state.design, parent), div.id, +$("sel-at").value));
    view.setDesign(state.design);
    $("o-sel-at").textContent = `${text(+$("sel-at").value)} ${from}`;
  };
  $("sel-at").onchange = () => { save(); };
  $("sel-h").oninput = () => { const v = +$("sel-h").value; $("o-sel-h").textContent = v >= Math.floor(full) ? "Full height" : text(v); };
  $("sel-h").onchange = () => {
    const v = +$("sel-h").value, p = partOf(state.design, parent);
    setDesign(withPart(state.design, parent, { ...p, dividers: p.dividers.map(x => x.id === div.id ? (v >= Math.floor(full) ? (({ height, ...rest }) => rest)(x) : { ...x, height: v }) : x) }));
  };
  $("sel-turn").onclick = () => setDesign(withPart(state.design, parent, turnDivider(partOf(state.design, parent), div.id)));
  $("sel-full").onclick = () => setDesign(withPart(state.design, parent, fullLength(partOf(state.design, parent), div.id)));
  $("sel-copy").onclick = () => {
    const r = copyDivider(partOf(state.design, parent), div.id);
    if (!r) { setStatus("No room for a copy beside it", "error"); return; }
    setDesign(withPart(state.design, parent, r.design));
    pick({ kind: "divider", id: r.id, parent });
  };
  $("sel-delete").onclick = () => remove(sel);
}

// Delete a part: a tray (with its dividers), a divider, or the lid.
function remove(p) {
  if (!p) return;
  const d = state.design;
  pick(null);
  if (p.kind === "tray") setDesign({ ...d, trays: d.trays.filter(t => t.id !== p.id) });
  else if (p.kind === "lid") setDesign({ ...d, lid: "none" });
  else if (p.kind === "divider") {
    const part = partOf(d, p.parent);
    setDesign(withPart(d, p.parent, { ...part, dividers: part.dividers.filter(x => x.id !== p.id) }));
  }
}
$("quick-delete").onclick = () => remove(sel);

function renderQuick() {
  const can = sel && sel.kind !== "box";
  $("quick").hidden = !can;
  if (can) $("quick-name").textContent = pickName(sel);
}

function renderProblems() {
  const list = problems(state.design);
  $("problems").hidden = !list.length;
  $("problems").textContent = list[0] || "";
}

function render() {
  for (const x of document.querySelectorAll("[data-units]")) x.setAttribute("aria-pressed", String(x.dataset.units === state.units));
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  for (const s of document.querySelectorAll("[data-panel]")) s.hidden = s.dataset.panel !== state.tab;
  renderSummary(); renderParts(); renderBox(); renderTrays(); renderDividers(); renderQuick(); renderProblems();
}

// ---- download -------------------------------------------------------------------------
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const tag = d => `${Math.round(d.width)}x${Math.round(d.depth)}x${Math.round(d.height)}`;
$("dl-stl").onclick = async () => {
  $("dl-stl").disabled = true;
  setStatus("Making STL…", "busy");
  try {
    const d = state.design, { files } = await cad("stl", { design: d });
    for (const f of files) download(`storage-case-${tag(d)}-${f.id}.stl`, f.blob);
    setStatus(files.length > 1 ? `Downloaded ${files.length} STL files` : "Downloaded STL");
  } catch (err) {
    setStatus("Couldn't make the STL: " + err.message, "error");
  } finally {
    $("dl-stl").disabled = false;
  }
};

// ---- share as a link or a file ------------------------------------------------------------
// The design travels in the link after "#design=", so nothing is stored anywhere else.
function encode(d) { return btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode(s) { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); }
function shareLink() { return location.origin + location.pathname + "#design=" + encode(state.design); }
function openShared() {
  const m = location.hash.match(/^#design=(.+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  try { state.design = decode(m[1]); return "Opened a shared design"; } catch (e) { return "That share link didn't work"; }
}
$("share").onclick = async () => {
  const url = shareLink();
  $("share-link").hidden = false;
  $("share-link").value = url;
  $("share-link").select();
  try {
    if (navigator.share) { await navigator.share({ title: "Storage case design", url }); return; }
    await navigator.clipboard.writeText(url);
    setStatus("Link copied");
  } catch (e) { setStatus("Copy the link below"); }
};
$("save-file").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "storage-case", version: 1, design: state.design }, null, 2)], { type: "application/json" });
  download(`storage-case-${tag(state.design)}.json`, blob);
};
$("open-file").onclick = () => $("file-input").click();
$("file-input").onchange = async () => {
  const f = $("file-input").files[0];
  $("file-input").value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    pick(null);
    state.design = DEFAULT_DESIGN;
    setDesign(data.design || data);
    framed = false; scheduleBuild(0);
    setStatus("Opened " + f.name);
  } catch (e) { setStatus("That file isn't a storage case design", "error"); }
};

// ---- start --------------------------------------------------------------------------
view.setDesign(state.design);
render();
build();
window.__app = { get design() { return state.design; }, get selected() { return sel; }, view, shareLink };
window.__ready = true;
