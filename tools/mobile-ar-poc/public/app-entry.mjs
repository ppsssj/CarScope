// Static/deployed washer/tire entry: local-only. No sync client or development config is imported.
import { startInspectionPage } from './app.mjs';
import { parseInspectionHandoff } from './inspection-tasks.mjs';
const handoff = parseInspectionHandoff(location.hash);
// Unsupported pairing fragments must not linger even on the static, local-only page.
if (!handoff.valid && location.hash) history.replaceState(null, '', location.pathname + location.search);
await startInspectionPage({ handoff });
