// P12-E: files of the part detection experiment. Separate from MOBILE_MODULES: a host serves them, and marks its page, only when given a provider.
export const PART_DETECTION_FILES = Object.freeze(['part-detection.mjs', 'part-detection-ui.mjs']);
const BODY = '<body data-step="intro"';
/** The page learns about the experiment only from its own host. No URL, storage or client switch can turn it on. */
export function markPartDetectionPage(html) {
  if (!html.includes(BODY)) throw new Error('PART_DETECTION_PAGE_MARKER_MISSING');
  return html.replace(BODY, `${BODY} data-part-detection="enabled"`);
}
