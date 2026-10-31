// Load OpenCascade (WASM) for tests running in Node.
import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
import { createRequire } from "module";

let ready = null;
export function loadReplicad() {
  if (!ready) {
    const wasm = createRequire(import.meta.url).resolve("replicad-opencascadejs/wasm");
    ready = opencascade({ locateFile: () => wasm }).then(OC => { R.setOC(OC); return R; });
  }
  return ready;
}
