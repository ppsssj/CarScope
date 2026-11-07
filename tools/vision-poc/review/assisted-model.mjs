// Separate, provisional observations. Never feeds the P12-G evaluator.
import { emptyPart, PART_KEYS, REVIEW_PARTS, isBox, iou } from './review-model.mjs';

export const ASSISTED_SCHEMA = 'carscope-assisted-labels-v1';
export const ASSISTED_STATES = ['EVIDENCE_SUPPORTED', 'VISUAL_CANDIDATE', 'UNKNOWN', 'NEEDS_REFERENCE', 'NOT_APPLICABLE'];
export const safeSource = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
export function assistedProblems(data, images) {
  const problems = [], known = new Map(images.map(i => [i.id, i.sha256])), ids = new Set();
  if (data?.schema !== ASSISTED_SCHEMA || data?.evaluationType !== 'PROVISIONAL_AI_ASSISTED' || data?.humanReviewed !== false || !Array.isArray(data?.images)) return ['ASSISTED_SCHEMA_INVALID'];
  for (const row of data.images) {
    if (!/^[a-z0-9-]{1,40}$/.test(row.id) || ids.has(row.id)) problems.push('invalid or duplicate id');
    ids.add(row.id);
    if (row.analysis !== 'PIXELS_INSPECTED' || !/^[a-f0-9]{64}$/.test(row.sha256)) problems.push(`${row.id}: pixel provenance missing`);
    if (row.dataset === 'P12F' ? known.get(row.id) !== row.sha256 : row.dataset !== 'IONIQ5_REFERENCE' || known.has(row.id)) problems.push(`${row.id}: dataset or image hash mismatch`);
    for (const key of PART_KEYS) {
      const part = row.parts?.[key];
      if (!part || !ASSISTED_STATES.includes(part.status) || !Array.isArray(part.boxes) || !Array.isArray(part.caps) || ![...part.boxes, ...part.caps].every(isBox) || !part.evidence?.trim() || typeof part.uncertainty !== 'string' || typeof part.additionalReferenceNeeded !== 'boolean' || !Array.isArray(part.references)) { problems.push(`${row.id}/${key}: invalid observation`); continue; }
      if (['UNKNOWN', 'NOT_APPLICABLE'].includes(part.status) && part.boxes.length + part.caps.length) problems.push(`${row.id}/${key}: cannot locate an unknown/absent part`);
      if (['EVIDENCE_SUPPORTED', 'VISUAL_CANDIDATE'].includes(part.status) && !part.boxes.length && !part.caps.length) problems.push(`${row.id}/${key}: candidate needs geometry`);
      if (['EVIDENCE_SUPPORTED', 'NOT_APPLICABLE'].includes(part.status) && !part.references.length) problems.push(`${row.id}/${key}: independent evidence required`);
      if (part.references.some(r => !safeSource(r.url) || !r.title || !r.locator || typeof r.official !== 'boolean' || !r.applicability)) problems.push(`${row.id}/${key}: invalid reference`);
      if (part.status === 'NOT_APPLICABLE' && !part.absenceEvidence?.trim()) problems.push(`${row.id}/${key}: absence needs explicit evidence`);
    }
  }
  return problems;
}

// Import makes an undecided, editable draft even when replacing a previous decision.
export function importAssisted(key, candidate) {
  const part = emptyPart(key);
  part.boxes = candidate.boxes.map(b => [...b]); part.caps = candidate.caps.map(b => [...b]);
  part.note = `[PROVISIONAL_AI_ASSISTED ${candidate.status}] ${candidate.evidence}\n${candidate.uncertainty}`.slice(0, 2000);
  part.reference = candidate.references.map(r => `${r.title} ${r.locator} ${r.url}`).join('\n').slice(0, 500);
  return part;
}

/** One-to-one matching across classes; unmatched predictions are not proven false positives. */
export function compareAssisted(row, predictions, threshold = 0.4) {
  const candidates = REVIEW_PARTS.flatMap(p => [...row.parts[p.key].boxes, ...row.parts[p.key].caps].map((box, index) => ({ key: p.key, modelClass: p.modelClass, box, index })));
  const active = predictions.filter(p => p.score >= threshold), pairs = [];
  for (let c = 0; c < candidates.length; c++) for (let p = 0; p < active.length; p++) {
    if (!candidates[c].modelClass) continue;
    // Numeric classes have no verified semantic mapping in the saved model contract.
    if (/^\d+$/.test(active[p].className)) continue;
    const overlap = iou(candidates[c].box, active[p].box);
    if (overlap >= 0.5) pairs.push({ c, p, overlap, same: candidates[c].modelClass === active[p].className });
  }
  pairs.sort((a, b) => Number(b.same) - Number(a.same) || b.overlap - a.overlap);
  const usedC = new Set(), usedP = new Set(), results = [];
  for (const pair of pairs) {
    if (usedC.has(pair.c) || usedP.has(pair.p)) continue;
    usedC.add(pair.c); usedP.add(pair.p);
    results.push({ category: pair.same ? 'DETECTION_SUCCESS_CANDIDATE' : 'PART_CONFUSION_CANDIDATE', key: candidates[pair.c].key, candidateBox: candidates[pair.c].box, prediction: active[pair.p], iou: pair.overlap });
  }
  candidates.forEach((c, index) => {
    if (usedC.has(index)) return;
    const opaque = active.some(p => /^\d+$/.test(p.className) && iou(c.box, p.box) >= 0.5);
    results.push({ category: c.modelClass && !opaque ? 'MISSED_CANDIDATE' : 'UNDETERMINED', key: c.key, candidateBox: c.box, reason: !c.modelClass ? 'NO_MODEL_CLASS' : opaque ? 'OPAQUE_MODEL_CLASS_OVERLAP' : `No semantic match at IoU >= 0.5, confidence >= ${threshold}; candidate is not ground truth` });
  });
  active.forEach((p, index) => {
    if (usedP.has(index)) return;
    const owner = REVIEW_PARTS.find(meta => meta.modelClass === p.className);
    const absent = owner && row.parts[owner.key].status === 'NOT_APPLICABLE';
    results.push({ category: absent ? 'FALSE_POSITIVE_CANDIDATE' : 'UNDETERMINED', key: owner?.key ?? null, prediction: p, reason: absent ? 'Evidence of non-applicability; still requires human review' : 'Unmatched prediction is not evidence of absence' });
  });
  return { status: 'PROVISIONAL_AI_ASSISTED', threshold, iou: 0.5, results };
}
