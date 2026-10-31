// Web worker that owns the exact solid engine (OpenCascade via replicad).
// The page sends it the case design; it answers with meshes to show, and
// with STL files of each part on request.
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import * as R from "replicad";
import { buildShell, buildCase } from "./case.js";
import { partOf } from "../design.js";
import { partMesh, partSTL } from "./exports.js";

const ready = opencascade({ locateFile: () => wasmUrl }).then(OC => R.setOC(OC));

async function handle(msg) {
  await ready;
  if (msg.cmd === "view") {
    // The part being edited without its dividers (the page draws those so
    // they can be dragged). Editing the box, the lid and the trays show
    // beside it, finished.
    const d = msg.design, target = msg.target || "box";
    const solids = [{ id: "shell", solid: buildShell(R, partOf(d, target)) }];
    if (target === "box")
      for (const p of buildCase(R, { ...d, dividers: [] }).slice(1)) solids.push({ id: p.id, solid: p.solid });
    const transfer = [];
    const meshes = solids.map(p => {
      const m = partMesh(p.solid);
      p.solid.delete?.();
      transfer.push(m.vertices.buffer, m.normals.buffer, m.triangles.buffer);
      return { id: p.id, ...m };
    });
    return { result: { meshes }, transfer };
  }
  if (msg.cmd === "stl") {
    const files = buildCase(R, msg.design).map(p => {
      const blob = partSTL(p.solid);
      p.solid.delete?.();
      return { id: p.id, name: p.name, blob };
    });
    return { result: { files } };
  }
  throw new Error("Unknown command " + msg.cmd);
}

self.onmessage = async e => {
  const { id } = e.data;
  try {
    const { result, transfer = [] } = await handle(e.data);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
