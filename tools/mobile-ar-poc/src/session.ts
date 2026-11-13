import { takeMobileHandoff } from "../../inspection-sync-poc/public/mobile-handoff.mjs";
import { MobileSync } from "../../inspection-sync-poc/public/mobile-sync.mjs";
import { SyncClient } from "../../inspection-sync-poc/public/sync-client.mjs";
import { parseInspectionHandoff } from "../public/inspection-tasks.mjs";
import { infoGuides } from "../public/part-guides.mjs";
import type { RecordDTO } from "./domain";
export interface SyncSnapshot {
  connection: string;
  display: string;
  message: string;
  connectionMessage?: string;
  received: boolean;
  canClaim: boolean;
  canSend: boolean;
  canRefresh: boolean;
  needsNewQr: boolean;
}
export type Transport = {
  snapshot: SyncSnapshot;
  claim: () => Promise<void>;
  send: () => Promise<void>;
  refresh: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  close: () => void;
  setResult: (r: RecordDTO) => void;
  detectPart: (
    id: string,
    blob: Blob,
    options: object,
  ) => Promise<{
    ok: boolean;
    candidates?: Candidate[];
    code?: string;
    detection?: { provider?: string };
  }>;
  analyzePart: (
    id: string,
    blob: Blob,
    options: object,
  ) => Promise<{
    ok: boolean;
    result?: unknown;
    code?: string;
    analysis?: { provider?: string };
  }>;
};
export interface Candidate {
  box: number[];
  score: number;
}
// Consumed once before React renders. Tokens never enter props, state, storage or a debug hook.
const originalHash = location.hash;
export const informational = location.pathname.endsWith("/part-info.html");
if (informational && originalHash) {
  let id = "";
  try {
    id = decodeURIComponent(originalHash.slice(1));
  } catch {
    /* Refuse malformed IDs. */
  }
  if (!infoGuides().some((g) => g.partId === id))
    history.replaceState(null, "", location.pathname + location.search);
}
const entry = informational
  ? { handoff: { valid: true, source: "info" }, version: 1, invite: null }
  : document.body.dataset.syncHost === "enabled"
    ? takeMobileHandoff(location, history)
    : {
        handoff: parseInspectionHandoff(originalHash),
        version: 1,
        invite: null,
      };
if (!entry.handoff.valid && location.hash)
  history.replaceState(null, "", location.pathname + location.search);
export const handoff = {
  ...entry.handoff,
  task:
    ("task" in entry.handoff ? entry.handoff.task : undefined) ??
    "washer-fluid",
};
export const showCatalog = handoff.valid && !originalHash;
let listener: (s: SyncSnapshot) => void = () => {};
export const transport: Transport | null =
  entry.version === 2
    ? (new MobileSync({
        invite: entry.invite,
        taskId: handoff.task,
        client: new SyncClient({
          baseUrl: location.origin,
          taskId: handoff.task,
        }),
        onChange: ((s: SyncSnapshot) => listener(s)) as unknown as () => void,
      }) as unknown as Transport)
    : null;
entry.invite = null;
export function subscribeSync(next: (s: SyncSnapshot) => void) {
  listener = next;
  if (transport) next(transport.snapshot);
  return () => {
    listener = () => {};
  };
}
if (transport) {
  const connect = () => {
    if (!document.hidden) void transport.claim();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) transport.pause();
    else {
      transport.resume();
      connect();
    }
  });
  addEventListener("pagehide", () => transport.close());
  addEventListener("pageshow", (e) => {
    if (e.persisted) transport.close();
  });
  connect();
}
