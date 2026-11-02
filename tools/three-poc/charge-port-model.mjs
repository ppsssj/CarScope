// Read the complete original GLB before adding synthetic parts or reparenting the hood.
import { Vector3 } from 'three';
export function sourceWorldParts(root) {
  root.updateMatrixWorld(true); const parts = [], point = new Vector3();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh || mesh.morphTargetInfluences?.some(x => x !== 0)) throw Error('UNVERIFIED_SOURCE_POSE');
    const position = mesh.geometry?.attributes.position, index = mesh.geometry?.index;
    if (!position || position.itemSize !== 3) throw Error('INVALID_SOURCE_MESH');
    const count = index ? index.count : position.count;
    if (count % 3) throw Error('INVALID_SOURCE_TRIANGLES');
    const triangles = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const vertex = index ? index.getX(i) : i;
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) throw Error('INVALID_SOURCE_INDEX');
      point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
      triangles[i * 3] = point.x * 100; triangles[i * 3 + 1] = -point.z * 100; triangles[i * 3 + 2] = point.y * 100;
    }
    parts.push({ name: mesh.name, triangles });
  });
  if (!parts.length) throw Error('MISSING_SOURCE_MESHES');
  return parts;
}
