// P12-C: engine-bay-parts/1 repeats its labels under numbered class names. This asks what happens if a numbered class is treated as the same part.
// A sensitivity analysis. It does not change SOURCE_TO_TARGET, and its numbers are never the reported result.
import { iou } from './evaluate.mjs';

// Two names for one part yield two boxes on one cap. Without merging, the second would count as a false positive.
export function mergeDuplicates(candidates, overlap = 0.5) {
  const kept = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) if (!kept.some(k => iou(k.box, candidate.box) >= overlap)) kept.push(candidate);
  return kept;
}

export function withAliasCandidates(results, alias) {
  return Object.fromEntries(Object.entries(results).map(([id, entry]) => {
    const extra = (entry.others ?? []).filter(o => o.className === alias).map(({ box, score }) => ({ box, score }));
    return [id, { ...entry, candidates: mergeDuplicates([...entry.candidates, ...extra]), others: (entry.others ?? []).filter(o => o.className !== alias) }];
  }));
}
