// A task hint, never a vehicle identity, authorization token or live SDK reading.
export const HANDOFF = '#v=1&task=washer-fluid';

export function parseHandoff(hash) {
  if (!hash) return { valid: true, source: 'direct' };
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const entries = [...params];
  if (entries.length !== 2 || params.getAll('v').length !== 1 ||
      params.getAll('task').length !== 1 || params.get('v') !== '1' ||
      params.get('task') !== 'washer-fluid') {
    return { valid: false, source: 'invalid' };
  }
  return { valid: true, source: 'qr-task' };
}

// Loopback is not reachable from a phone. Used where a QR target is published (staging, inspection UI);
// the local direct-TLS server keeps accepting any HTTPS root.
export function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

export function handoffURL(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('스마트폰에서 신뢰하는 HTTPS 루트 주소만 입력하세요. 계정·쿼리·fragment는 허용하지 않습니다.');
  }
  url.hash = HANDOFF;
  return url.href;
}
