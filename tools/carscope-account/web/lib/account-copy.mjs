// P15: every sentence the account pages show, in one place. Plain words; no verdicts about the car.

export const SIGNIN_MESSAGES = Object.freeze({
  CANCELLED: '로그인을 취소했습니다. 체험 기능은 그대로 쓸 수 있습니다.',
  PROVIDER_ERROR: 'Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  IMPLICIT_FLOW_REFUSED: '안전하지 않은 로그인 응답이라 처리하지 않았습니다. 다시 시도해 주세요.',
  MISSING_CODE: '로그인 응답이 올바르지 않습니다. 다시 시도해 주세요.',
  NO_PENDING_LOGIN: '이 브라우저 탭에서 시작한 로그인이 아니거나 이미 처리된 로그인입니다. 다시 시도해 주세요.',
  LOGIN_EXPIRED: '로그인 시간이 지났습니다. 다시 시도해 주세요.',
  STATE_MISMATCH: '로그인 요청이 일치하지 않아 중단했습니다. 다시 시도해 주세요.',
  CALLBACK_NOT_FOR_THIS_BROWSER: '이 브라우저에서 시작한 로그인이 아니거나 이미 처리된 로그인입니다. 다시 시도해 주세요.',
  CODE_REJECTED: '로그인 확인이 거부되었습니다(만료되었거나 이미 사용됨). 다시 시도해 주세요.',
  AUTH_UNAVAILABLE: '인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  SESSION_INVALID: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  IDENTITY_MISMATCH: '로그인한 계정을 확인하지 못해 로그아웃했습니다. 다시 시도해 주세요.',
  START_FAILED: '로그인을 시작하지 못했습니다. 다시 시도해 주세요.',
  EMBEDDED_WEBVIEW: '앱 안의 화면에서는 Google 로그인을 열 수 없습니다. 휴대폰이나 PC의 브라우저에서 이 주소를 열어 주세요.',
  PROVIDER_NOT_ENABLED: '이 환경에는 Google 로그인이 아직 켜져 있지 않습니다. 체험 기능은 그대로 쓸 수 있습니다.',
  NOT_CONFIGURED: '이 환경에는 로그인이 설정되어 있지 않습니다. 체험 기능은 그대로 쓸 수 있습니다.',
  SECRET_KEY_REFUSED: '로그인 설정이 안전하지 않아 사용하지 않았습니다(비밀 키). 운영자에게 알려 주세요.',
  KEY_REFUSED: '로그인 설정을 확인할 수 없습니다. 운영자에게 알려 주세요.',
  SUPABASE_URL_INVALID: '로그인 설정을 확인할 수 없습니다. 운영자에게 알려 주세요.',
  SESSION_ENDED: '로그아웃되었습니다.',
  USER_SIGNED_OUT: '로그아웃했습니다. 이 화면의 차량 정보도 지웠습니다.',
  ACCOUNT_SWITCHED: '다른 계정으로 바뀌어 이전 계정의 차량 정보를 지웠습니다.',
});

export const DATA_MESSAGES = Object.freeze({
  INVALID_INPUT: '입력한 내용을 확인해 주세요.',
  NOT_FOUND: '차량을 찾을 수 없습니다. 이미 삭제되었거나 이 계정의 차량이 아닙니다.',
  FORBIDDEN: '이 작업은 허용되지 않습니다.',
  SESSION_EXPIRED: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  LIMIT_REACHED: '차량은 계정당 20대까지 등록할 수 있습니다.',
  NETWORK: '네트워크에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  SERVER: '차량 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  STALE_IDENTITY: '계정이 바뀌어 이전 요청 결과를 버렸습니다.',
});

export const FIELD_LABELS = Object.freeze({ manufacturer: '제조사', model: '모델명', model_year: '연식', nickname: '별칭' });

export const VERIFICATION_LABEL = Object.freeze({
  SELF_REPORTED_UNVERIFIED: '직접 등록 · 소유 확인 안 됨',
  OEM_VERIFIED: '제조사 확인됨',
});

export const CONNECTION_COPY = Object.freeze({
  vehicleData: '차량 데이터 연결: 연결 안 됨',
  vehicleDataNote: '현대자동차 계정 연결은 아직 사용할 수 없습니다(준비 중). Google 로그인만으로는 차량 데이터를 받을 수 없고, 별도의 현대자동차 계정 동의와 소유 확인이 필요합니다.',
  inspection: '점검 기록 연결: 없음',
  inspectionNote: '체험 모드의 점검, 스마트폰 QR 점검, 시뮬레이터(AVD) 기록은 이 차량의 기록으로 옮겨지지 않습니다.',
});

export const PRIVACY_POINTS = Object.freeze([
  'Google 계정에서 이름, 이메일, 프로필 사진만 받습니다.',
  '이메일은 로그인 확인에만 쓰고 차량 정보와 함께 따로 저장하지 않습니다.',
  '차량 번호, 차대번호(VIN), 위치는 묻지 않습니다.',
  'Google 로그인은 본인 확인일 뿐 자동차 소유를 증명하지 않습니다. 등록한 차량은 "소유 확인 안 됨"으로 표시됩니다.',
  'Google 계정과 현대자동차 계정은 서로 별개이며, 이 화면은 현대자동차 계정에 연결하지 않습니다.',
]);

export function signinMessage(reason) {
  return SIGNIN_MESSAGES[reason] ?? null;
}
