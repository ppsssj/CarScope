// Acceptance policy, in car centimetres unless a field explicitly says metres.
export const POLICY = Object.freeze({
  rigidityCm: 1e-8,
  glbPositionMetres: 1e-6, // Float32 at this model's scale; no IR rounding in this comparison.
  glbNormal: 1e-6,
  penetrationCm: 0.3, // Existing PoC contact envelope; never increased to hide a failure.
  surfaceEpsilonCm: 1e-7,
  sweepStepDegrees: 1,
  fineFromDegrees: 4,
  fineToDegrees: 7,
  fineStepDegrees: 0.1,
});

export function meshFailures(report) {
  const failures = [];
  if (!Array.isArray(report.checks) || report.checks.length === 0) return ["missing mesh checks"];
  for (const c of report.checks) {
    for (const key of ["degenerate", "flippedNormals", "windingConflicts", "nonManifoldEdges"]) {
      if (c[key] !== 0) failures.push(`${c.partId}: ${key}=${c[key]}`);
    }
    if (c.closed !== true && c.cls !== "plane") failures.push(`${c.partId}: only planar inlays may be open`);
    if (c.closed && (c.boundaryEdges !== 0 || c.watertight !== true || c.outward !== true || !(c.signedVolume > 0))) {
      failures.push(`${c.partId}: closed mesh must be watertight and outward`);
    }
  }
  for (const id of ["door-front-left", "door-rear-left"]) {
    const r = report.doorRigidity?.[id];
    if (!r || !(r.comparedParts > 0) || !Number.isFinite(r.maxDeviation) || r.maxDeviation > POLICY.rigidityCm) {
      failures.push(`${id}: invalid rigidity or deviation > ${POLICY.rigidityCm} cm`);
    }
  }
  return failures;
}

export function requireValid(failures) {
  if (failures.length) throw new Error(`Geometry validation failed:\n${failures.join("\n")}`);
}
