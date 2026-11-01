#!/usr/bin/env node
// AR-02A vehicle-side receiver simulator (stands in for the future Android receiver). Creates a pairing session,
// shows the QR v2 fragment, waits for the phone's result, shows it and asks for an explicit accept.
//
//   node tools/inspection-sync-poc/bin/receiver.mjs [--server=http://127.0.0.1:4180] [--mobile-base=https://<page>/]
//        [--auto-accept] [--wait=600]
// The receiver token stays in this process's memory; it is never printed. The invite is printed once because it is
// the QR content the phone must receive.
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { buildInviteFragment } from '../src/protocol.mjs';
import { STATUS_TEXT } from '../../mobile-ar-poc/public/inspection-result.mjs';

export class ReceiverClient {
  #token = null;
  constructor({ baseUrl, fetchImpl = globalThis.fetch }) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.fetch = (...a) => fetchImpl(...a); this.sessionId = null; }

  async #call(method, path, body, auth = true) {
    const res = await this.fetch(this.baseUrl + path, {
      method, headers: { ...(auth ? { Authorization: `Bearer ${this.#token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error(json?.error?.code ?? `HTTP ${res.status}`); e.status = res.status; e.code = json?.error?.code; throw e; }
    return json;
  }

  /** Returns { sessionId, fragment, inviteExpiresAt, expiresAt }; keeps the receiver token private. */
  async create(taskId = 'washer-fluid') {
    const r = await this.#call('POST', '/v1/sessions', { taskId }, false);
    this.#token = r.receiverToken; this.sessionId = r.sessionId;
    return { sessionId: r.sessionId, fragment: buildInviteFragment(r.taskId, r.inviteToken), inviteExpiresAt: r.inviteExpiresAt, expiresAt: r.expiresAt };
  }
  view() { return this.#call('GET', `/v1/sessions/${this.sessionId}`); }
  accept(resultDigest) { return this.#call('POST', `/v1/sessions/${this.sessionId}/accept`, { resultDigest }); }
  cancel() { return this.#call('POST', `/v1/sessions/${this.sessionId}/cancel`); }

  /** Poll until a result arrives or the session ends. */
  async waitForResult({ intervalMs = 1000, timeoutMs = 600_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await this.view();
      if (v.sessionState !== 'CREATED' && v.sessionState !== 'CLAIMED') return v;
      if (Date.now() > end) throw new Error('timeout waiting for the phone');
      await sleep(intervalMs);
    }
  }
}

/** What the vehicle side shows for a received result. */
export function describeReceived(view) {
  const r = view.result;
  return [
    '항목: 워셔액 셀프 점검',
    `사용자 보고 결과: ${r ? STATUS_TEXT[r.status]?.label ?? r.status : '없음'} (${r?.confirmation ?? '-'})`,
    `완료 시각: ${r ? new Date(r.completedAt).toLocaleString('ko-KR') : '-'}`,
    `전송 상태: ${view.sessionState === 'ACCEPTED' ? '수락됨' : view.sessionState === 'RESULT_SUBMITTED' ? '서버 수신 확인됨 · 수락 대기' : view.sessionState}`,
    '주의: 사용자가 직접 확인해 보고한 결과이며 실제 차량 센서 진단이 아닙니다.',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
  const receiver = new ReceiverClient({ baseUrl: args.server ?? 'http://127.0.0.1:4180' });
  const s = await receiver.create();
  console.log(`세션 생성 · 초대 만료 ${new Date(s.inviteExpiresAt).toLocaleTimeString('ko-KR')} · 세션 만료 ${new Date(s.expiresAt).toLocaleTimeString('ko-KR')}`);
  console.log('QR 내용(한 번만 표시, 공유하지 마세요):');
  console.log(args['mobile-base'] ? new URL(s.fragment, args['mobile-base']).href : s.fragment);
  const v = await receiver.waitForResult({ timeoutMs: Number(args.wait ?? 600) * 1000 });
  if (v.sessionState !== 'RESULT_SUBMITTED') { console.log(`세션 종료: ${v.sessionState}`); process.exit(1); }
  console.log(describeReceived(v));
  let ok = Boolean(args['auto-accept']);
  if (!ok) { const rl = createInterface({ input: process.stdin, output: process.stdout }); ok = /^y(es)?$/i.test((await rl.question('이 결과를 수락할까요? (y/N) ')).trim()); rl.close(); }
  if (!ok) { await receiver.cancel(); console.log('수락하지 않았습니다. 세션을 취소하고 결과를 삭제했습니다.'); process.exit(0); }
  const done = await receiver.accept(v.resultDigest);
  console.log(describeReceived(done));
}
