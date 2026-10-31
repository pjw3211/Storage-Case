// Page-side helper for talking to the exact solid engine worker (src/cad/worker.js).
let worker = null, seq = 0;
const pending = new Map();

function start() {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = e => {
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id);
    e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
  };
  worker.onerror = e => { for (const p of pending.values()) p.reject(new Error(e.message || "Engine failed to start")); pending.clear(); };
}

export function cad(cmd, data = {}) {
  if (!worker) start();
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, cmd, ...data }); });
}
