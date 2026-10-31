// Meshes for the 3D view and STL files for printing.
import { bounds } from "./case.js";

/** Binary STL of a part, moved so it sits on the bed at the origin. */
export function partSTL(solid, tolerance = 0.05) {
  const b = bounds(solid);
  const moved = solid.clone().translate([-b.min[0], -b.min[1], -b.min[2]]);
  const blob = moved.blobSTL({ tolerance, angularTolerance: 0.1, binary: true });
  moved.delete?.();
  return blob;
}

/** Triangle mesh of a solid in place, for the 3D view. */
export function partMesh(solid, tolerance = 0.1) {
  const m = solid.mesh({ tolerance, angularTolerance: 0.3 });
  return { vertices: Float32Array.from(m.vertices), normals: Float32Array.from(m.normals), triangles: Uint32Array.from(m.triangles) };
}
