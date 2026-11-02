import { parseInviteFragment } from '../src/protocol.mjs';
import { parseInspectionHandoff } from '../../mobile-ar-poc/public/inspection-tasks.mjs';

// Only the explicit v2 service entry calls this. No token is included in the public handoff descriptor.
export function takeMobileHandoff(loc, history) {
  const v1 = parseInspectionHandoff(loc.hash);
  if (v1.valid) return { handoff: v1, version: 1, invite: null };
  const v2 = parseInviteFragment(loc.hash);
  if (loc.hash) history.replaceState(null, '', loc.pathname + loc.search);
  return v2.valid
    ? { handoff: { valid: true, source: 'qr-sync',task:v2.task }, version: 2, invite: v2.invite }
    : { handoff: { valid: false, source: 'invalid' }, version: null, invite: null };
}
