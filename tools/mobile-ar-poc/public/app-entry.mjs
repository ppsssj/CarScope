// Static/deployed entry: AR-01 only. No sync client or development config is imported.
import { startInspectionPage } from './app.mjs';
import { parseHandoff } from './handoff.mjs';
const handoff = parseHandoff(location.hash);
// Unsupported pairing fragments must not linger even on the static, local-only page.
if (!handoff.valid && location.hash) history.replaceState(null, '', location.pathname + location.search);
await startInspectionPage({ handoff });
