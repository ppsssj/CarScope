// P12-E: files of the part detection experiment. Separate from MOBILE_MODULES: a host serves them, and marks its page, only when given a provider.
export const PART_DETECTION_FILES = Object.freeze(['part-detection.mjs', 'part-detection-ui.mjs']);
const BODY = '<body data-step="intro"';
/** The page learns about the experiment only from its own host. No URL, storage or client switch can turn it on. */
export function markPartDetectionPage(html) {
  if (!html.includes(BODY)) throw new Error('PART_DETECTION_PAGE_MARKER_MISSING');
  return html.replace(BODY, `${BODY} data-part-detection="enabled"`);
}
import { ANALYSIS_SERVICES } from './public/part-analysis.mjs';
// P13-A: files of the part analysis experiment. Served, and the page marked, only by a host given a detector and a vision provider.
export const PART_ANALYSIS_FILES = Object.freeze(['part-analysis.mjs', 'part-analysis-ui.mjs', 'context-crop.mjs']);
/** draft (P13-G): the host's operator approved DRAFT profiles. Only a host sets it; the server route enforces the same flag itself. */
export function markPartAnalysisPage(html, providerId, { draft = false } = {}) {
  if (!html.includes(BODY)) throw new Error('PART_DETECTION_PAGE_MARKER_MISSING');
  if (!Object.hasOwn(ANALYSIS_SERVICES, providerId)) throw new Error('PART_ANALYSIS_PROVIDER_UNKNOWN');
  return html.replace(BODY, `${BODY} data-part-analysis="enabled" data-part-analysis-service="${providerId}"${draft === true ? ' data-part-analysis-draft="enabled"' : ''}`);
}
