// The app: set the box size, lay out the inside with dividers you can drag,
// add lift-out trays that stack inside, pick a lid, and download each part
// as an STL ready to print.
import { cad } from "./cad/client.js";
import { createView } from "./view.js";
import { DEFAULT_DESIGN, LIMITS, LIDS, TEMPLATES, IN, MAX_TRAYS, TRAY_HEIGHT, normalize, gridDividers, moveDivider, addDivider, dividerRange,
  inner, summary, partOf, withPart, addTray, ledgeTop } from "./design.js";

const $ = id => document.getElementById(id);
const STORE = "storage-case-v1";

// ---- state, kept in this browser -----------------------------------------------
// A first visit starts with a 3 × 2 grid so there is something to drag.
// `editing` is "box" or the id of the tray whose dividers you are laying out.
let state = { design: { ...DEFAULT_DESIGN, dividers: gridDividers(DEFAULT_DESIGN, 3, 2) }, units: "mm", template: "3x2", open: null, editing: "box" };
try { state = { ...state, ...JSON.parse(localStorage.getItem(STORE) || "{}") }; } catch (e) { /* start fresh */ }
state.design = normalize(state.design);
const tray = () => state.design.trays.find(t => t.id === state.editing);
if (!tray()) state.editing = "box";
const part = () => partOf(state.design, state.editing);
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private window */ } };
let selected = null;

// ---- units ------------------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shown = mm => state.units === "in" ? +(mm / IN).toFixed(2) : Math.round(mm * 10) / 10;
const fromShown = v => state.units === "in" ? v * IN : v;
const text = mm => state.units === "in" ? `${(mm / IN).toFixed(2)} in` : `${+mm.toFixed(2)} mm`;

for (const b of document.querySelectorAll("[data-units]")) b.onclick = () => {
  state.units = b.dataset.units; save(); render();
};

// ---- the 3D view ------------------------------------------------------------------
const view = createView($("view"), {
  onDivider(id, at, done) {
    if (!done) { state.design = withPart(state.design, state.editing, moveDivider(part(), id, at)); view.setDesign(part()); renderSelected(); return; }
    state.template = null; save(); renderTemplates(); renderSummary();
  },
  onResize(change, done) {
    if (!done) {
      // A tray's only handle is its height.
      const next = state.editing === "box" ? { ...state.design, ...change } : withPart(state.design, state.editing, { ...part(), ...change });
      setDesign(next, { quiet: true });
      return;
    }
    save(); render(); scheduleBuild(0);
  },
  onSelect(id) { selected = id; renderSelected(); },
});
$("reframe").onclick = () => view.frame();

// Every change to the design goes through here so the print rules always hold.
function setDesign(next, { quiet = false } = {}) {
  const before = state.design;
  state.design = normalize(next, before);
  if (!tray()) state.editing = "box";
  if (selected && !part().dividers.some(x => x.id === selected)) { selected = null; view.select(null); }
  view.setMode(state.editing === "box" ? "box" : "tray");
  view.setDesign(part());
  if (quiet) { renderDims(); renderSummary(); renderTrays(); return; }
  save(); render();
  if (shapeKey() !== builtKey) scheduleBuild();
}

// What the engine's meshes depend on: moving a divider needs no rebuild,
// since the view draws dividers itself, but the trays shown beside the box do.
const SHELL = ["width", "depth", "height", "wall", "floor", "divider", "radius", "lid", "clearance", "lidLip"];
function shapeKey() {
  const d = state.design;
  return JSON.stringify([state.editing, SHELL.map(k => d[k]), d.trays.map(t => [t.id, t.height, state.editing === "box" ? t.dividers : 0])]);
}
let builtKey = null;

// ---- building with the exact engine -------------------------------------------------
let timer = null, building = false, again = false, framed = null;
function setStatus(t, kind = "") { $("status").textContent = t; $("status").className = "chip " + kind; }
function scheduleBuild(delay = 250) { clearTimeout(timer); timer = setTimeout(build, delay); }
async function build() {
  if (building) { again = true; return; }
  building = true; again = false;
  setStatus("Building…", "busy");
  const d = state.design, target = state.editing, key = shapeKey(), p = part();
  try {
    const { meshes } = await cad("view", { design: d, target });
    view.setMeshes(meshes, p);
    builtKey = key;
    // Fit the view when the parts on show change (a lid or tray added, or
    // switching between the box and a tray), not on every rebuild.
    const layout = target + ":" + meshes.map(m => m.id).join(",");
    if (layout !== framed) { framed = layout; view.frame(); }
    setStatus("Ready");
    $("dl-stl").disabled = false;
    window.__built = (window.__built || 0) + 1;
  } catch (err) {
    setStatus("Couldn't build: " + err.message, "error");
  } finally {
    building = false;
    if (again) build();
  }
}

// ---- the panel ------------------------------------------------------------------------
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

// A little drawing of each layout: the box from above with its pockets.
function layoutPicture(cols, rows) {
  const W = 60, H = 40, p = 4, lines = [];
  for (let i = 1; i < cols; i++) { const x = p + (W - 2 * p) * i / cols; lines.push(`<line x1="${x}" y1="${p}" x2="${x}" y2="${H - p}"/>`); }
  for (let j = 1; j < rows; j++) { const y = p + (H - 2 * p) * j / rows; lines.push(`<line x1="${p}" y1="${y}" x2="${W - p}" y2="${y}"/>`); }
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect x="${p}" y="${p}" width="${W - 2 * p}" height="${H - 2 * p}" rx="4" fill="#dbe7f5" stroke="#4f86c6" stroke-width="2.5"/>
    <g stroke="#4f86c6" stroke-width="2">${lines.join("")}</g></svg>`;
}

function renderTemplates() {
  $("templates").innerHTML = TEMPLATES.map(t => `<button type="button" class="tile" role="radio" data-template="${t.id}" aria-checked="${state.template === t.id}">
    ${layoutPicture(t.cols, t.rows)}<b>${esc(t.name)}</b></button>`).join("");
  for (const b of $("templates").querySelectorAll(".tile")) b.onclick = () => {
    const t = TEMPLATES.find(x => x.id === b.dataset.template);
    state.template = t.id;
    selected = null; view.select(null);
    setDesign(withPart(state.design, state.editing, { ...part(), dividers: gridDividers(part(), t.cols, t.rows) }));
  };
  $("add-x").onclick = () => add("x");
  $("add-y").onclick = () => add("y");
}

function add(axis) {
  const r = addDivider(part(), axis);
  if (!r) { setStatus("No room for another divider that way", "error"); return; }
  state.template = null;
  selected = r.id;
  setDesign(withPart(state.design, state.editing, r.design));
  view.select(r.id);
}

function renderSelected() {
  const d = part(), div = selected && d.dividers.find(x => x.id === selected);
  $("selected").hidden = !div;
  if (!div) return;
  // Box dividers stop below the trays and the lid's lip.
  const full = Math.min(inner(d).h, d.dividerTop - d.floor), h = Math.min(div.height ?? full, full);
  const [lo, hi] = dividerRange(d, div);
  const dirName = div.axis === "x" ? "Front-to-back divider" : "Side-to-side divider";
  const from = div.axis === "x" ? "from the left wall" : "from the front wall";
  // Keep the controls in place while dragging so the slider isn't rebuilt under a finger.
  if ($("selected").dataset.id === div.id && $("sel-at")) {
    $("o-sel-at").textContent = `${text(div.at)} ${from}`;
    $("sel-at").value = div.at;
    return;
  }
  $("selected").dataset.id = div.id;
  $("selected").innerHTML = `<h4>${dirName}</h4>
    <div class="sliders">
      <div class="sl"><label for="sel-at">Position</label><output id="o-sel-at">${text(div.at)} ${from}</output>
        <input type="range" id="sel-at" min="${Math.ceil(lo)}" max="${Math.floor(hi)}" step="1" value="${div.at}"></div>
      <div class="sl"><label for="sel-h">Height</label><output id="o-sel-h">${h >= full ? "Full height" : text(h)}</output>
        <input type="range" id="sel-h" min="3" max="${Math.floor(full)}" step="1" value="${Math.min(h, Math.floor(full))}"></div>
    </div>
    <div class="row"><button class="btn danger" id="sel-delete" type="button">Delete divider</button></div>`;
  $("sel-at").oninput = () => { state.design = withPart(state.design, state.editing, moveDivider(part(), div.id, +$("sel-at").value)); view.setDesign(part()); renderSelected(); };
  $("sel-at").onchange = () => { state.template = null; save(); renderTemplates(); };
  $("sel-h").oninput = () => { const v = +$("sel-h").value; $("o-sel-h").textContent = v >= Math.floor(full) ? "Full height" : text(v); };
  $("sel-h").onchange = () => {
    const v = +$("sel-h").value;
    const p = part();
    setDesign(withPart(state.design, state.editing, { ...p, dividers: p.dividers.map(x => x.id === div.id ? (v >= Math.floor(full) ? { id: x.id, axis: x.axis, at: x.at } : { ...x, height: v }) : x) }));
  };
  $("sel-delete").onclick = () => {
    selected = null; view.select(null);
    state.template = null;
    const p = part();
    setDesign(withPart(state.design, state.editing, { ...p, dividers: p.dividers.filter(x => x.id !== div.id) }));
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

function renderWalls() {
  sliders($("walls"), [["wall", "Wall thickness"], ["floor", "Floor thickness"], ["divider", "Divider thickness"], ["radius", "Corner radius"]]);
}

function renderLid() {
  const d = state.design;
  $("lids").innerHTML = LIDS.map(l => `<button type="button" class="tile" role="radio" data-lid="${l.id}" aria-checked="${d.lid === l.id}"><b>${esc(l.name)}</b></button>`).join("");
  for (const b of $("lids").querySelectorAll(".tile")) b.onclick = () => setDesign({ ...state.design, lid: b.dataset.lid });
  $("lid-sliders").hidden = d.lid !== "lift";
  if (d.lid === "lift") sliders($("lid-sliders"), [["lidLip", "Lip depth"], ["clearance", "Gap around the lip"]]);
}

// Which part you are laying out (the box or a tray), adding and removing
// trays, and the height of the tray being edited.
function edit(target) {
  if (state.editing === target) return;
  state.editing = target; state.template = null;
  selected = null; view.select(null);
  setDesign(state.design);
}

function renderTrays() {
  const d = state.design, t = tray();
  const tabs = [["box", "Box"], ...d.trays.map((x, k) => [x.id, `Tray ${k + 1}`])];
  $("targets").innerHTML = tabs.map(([id, name]) => `<button type="button" data-edit="${id}" aria-pressed="${state.editing === id}">${name}</button>`).join("")
    + (d.trays.length < MAX_TRAYS ? `<button type="button" id="add-tray">+ Tray</button>` : "");
  for (const b of $("targets").querySelectorAll("[data-edit]")) b.onclick = () => edit(b.dataset.edit);
  if ($("add-tray")) $("add-tray").onclick = () => {
    const r = addTray(state.design);
    if (!r) { setStatus("No room for another tray. Make the box taller or a tray shorter.", "error"); return; }
    state.editing = r.id; state.template = null; selected = null; view.select(null);
    setDesign(r.design);
  };
  $("tray-controls").hidden = !t;
  if (!t) return;
  const k = d.trays.indexOf(t);
  const max = Math.max(t.height, Math.min(TRAY_HEIGHT[1], Math.floor(t.height + ledgeTop(d) - d.floor)));
  $("tray-controls").innerHTML = `<div class="sliders"><div class="sl"><label for="tray-h">Tray ${k + 1} height</label><output id="o-tray-h">${text(t.height)}</output>
      <input type="range" id="tray-h" min="${Math.max(TRAY_HEIGHT[0], d.floor + 5)}" max="${max}" step="1" value="${t.height}"></div></div>
    <p class="hint">Trays stack from the top of the box down and sit on a ledge round the inside walls. The box's own dividers stop below them.</p>
    <div class="row"><button class="btn danger" id="tray-remove" type="button">Remove tray ${k + 1}</button></div>`;
  $("tray-h").oninput = () => { $("o-tray-h").textContent = text(+$("tray-h").value); };
  $("tray-h").onchange = () => setDesign(withPart(state.design, t.id, { ...part(), height: +$("tray-h").value }));
  $("tray-remove").onclick = () => {
    state.editing = "box"; selected = null; view.select(null);
    setDesign({ ...state.design, trays: state.design.trays.filter(x => x.id !== t.id) });
  };
}

function render() {
  for (const x of document.querySelectorAll("[data-units]")) x.setAttribute("aria-pressed", String(x.dataset.units === state.units));
  renderSummary(); renderDims(); renderTrays(); renderTemplates(); renderWalls(); renderLid();
  $("selected").dataset.id = ""; renderSelected();
}

for (const det of document.querySelectorAll("details[data-group]")) {
  if (state.open && det.dataset.group in state.open) det.open = state.open[det.dataset.group];
  det.ontoggle = () => { state.open = { ...(state.open || {}), [det.dataset.group]: det.open }; save(); };
}

// ---- download -------------------------------------------------------------------------
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("dl-stl").onclick = async () => {
  $("dl-stl").disabled = true;
  setStatus("Making STL…", "busy");
  try {
    const d = state.design, { files } = await cad("stl", { design: d });
    const tag = `${Math.round(d.width)}x${Math.round(d.depth)}x${Math.round(d.height)}`;
    for (const f of files) download(`storage-case-${tag}-${f.id}.stl`, f.blob);
    setStatus(files.length > 1 ? `Downloaded ${files.length} STL files` : "Downloaded STL");
  } catch (err) {
    setStatus("Couldn't make the STL: " + err.message, "error");
  } finally {
    $("dl-stl").disabled = false;
  }
};

// ---- start --------------------------------------------------------------------------
view.setMode(state.editing === "box" ? "box" : "tray");
view.setDesign(part());
render();
build();
window.__app = { get design() { return state.design; }, get part() { return part(); }, view };
window.__ready = true;
