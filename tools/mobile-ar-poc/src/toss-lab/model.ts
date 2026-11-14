// P19 design lab: pure, framework-free state for ONE camera inspection screen.
// Everything here is MOCK. No CameraSession, detector, AI, storage or sync is
// imported; the product reducers in src/domain.ts are not touched.

export type CameraState =
  | "idle"
  | "requesting"
  | "live"
  | "marked"
  | "denied"
  | "unsupported";

export const CAMERA_STATES: readonly CameraState[] = Object.freeze([
  "idle",
  "requesting",
  "live",
  "marked",
  "denied",
  "unsupported",
]);

export type Point = { x: number; y: number };

export type LabState = {
  camera: CameraState;
  /** User-placed marker in normalized viewfinder coordinates (0..1). */
  mark: Point | null;
};

export type LabEvent =
  | { type: "START" }
  | { type: "GRANTED" }
  | { type: "DENIED" }
  | { type: "UNSUPPORTED" }
  | { type: "MARK"; point: Point }
  | { type: "CLEAR_MARK" }
  | { type: "STOP" }
  | { type: "JUMP"; state: CameraState };

export const INITIAL: LabState = Object.freeze({ camera: "idle", mark: null });

/** Mock marker used when a state is opened directly (e.g. `#marked`). */
export const MOCK_MARK: Point = Object.freeze({ x: 0.645, y: 0.44 });

function clampPoint(p: Point): Point | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  return { x: p.x, y: p.y };
}

export function reduce(state: LabState, event: LabEvent): LabState {
  switch (event.type) {
    case "START":
      return state.camera === "idle" || state.camera === "denied"
        ? { camera: "requesting", mark: null }
        : state;
    case "GRANTED":
      return state.camera === "requesting"
        ? { camera: "live", mark: null }
        : state;
    case "DENIED":
      return state.camera === "requesting"
        ? { camera: "denied", mark: null }
        : state;
    case "UNSUPPORTED":
      return { camera: "unsupported", mark: null };
    case "MARK": {
      // A marker exists only on a live picture; never on a stopped/denied one.
      if (state.camera !== "live" && state.camera !== "marked") return state;
      const point = clampPoint(event.point);
      return point ? { camera: "marked", mark: point } : state;
    }
    case "CLEAR_MARK":
      return state.camera === "marked" ? { camera: "live", mark: null } : state;
    case "STOP":
      return { camera: "idle", mark: null };
    case "JUMP":
      return {
        camera: event.state,
        mark: event.state === "marked" ? { ...MOCK_MARK } : null,
      };
  }
}

/** `#live` → "live"; anything unknown falls back to the initial state. */
export function stateFromHash(hash: string): CameraState {
  const name = hash.replace(/^#/, "");
  return (CAMERA_STATES as readonly string[]).includes(name)
    ? (name as CameraState)
    : "idle";
}

/** One primary action per state (TDS BottomCTA single, Astryx single primary). */
export function primaryAction(camera: CameraState): {
  label: string;
  intent: "start" | "proceed" | "manual";
  loading: boolean;
} {
  switch (camera) {
    case "idle":
      return { label: "카메라 켜기", intent: "start", loading: false };
    case "requesting":
      return { label: "카메라 켜기", intent: "start", loading: true };
    case "live":
    case "marked":
      return { label: "위치 확인 후 관찰하기", intent: "proceed", loading: false };
    case "denied":
    case "unsupported":
      return { label: "카메라 없이 계속하기", intent: "manual", loading: false };
  }
}

export const COPY: Record<CameraState, { title: string; body: string }> = {
  idle: {
    title: "카메라로 워셔액 주입구를 찾아볼게요",
    body: "보닛 안쪽, 오른쪽 바깥 뒤를 비춰 주세요. 실제 자리는 차마다 달라요.",
  },
  requesting: {
    title: "카메라 사용을 허용해 주세요",
    body: "브라우저 권한 창에서 ‘허용’을 누르면 화면이 켜져요.",
  },
  live: {
    title: "주입구를 찾으면 화면을 눌러 표시해 주세요",
    body: "캡에 앞유리와 물줄기 모양 표시가 있는지 직접 봐 주세요.",
  },
  marked: {
    title: "표시한 곳이 주입구가 맞는지 확인해 주세요",
    body: "표시는 직접 지정한 위치예요. 다시 누르면 옮길 수 있어요.",
  },
  denied: {
    title: "카메라 없이도 점검할 수 있어요",
    body: "카메라 권한이 꺼져 있어요. 눈으로 직접 보고 다음 단계로 가면 돼요.",
  },
  unsupported: {
    title: "카메라 없이 계속 점검할 수 있어요",
    body: "이 브라우저에서는 카메라를 쓸 수 없어요. 눈으로 직접 보고 답하면 돼요.",
  },
};

export const STATUS: Record<CameraState, string> = {
  idle: "카메라는 직접 켤 때만 시작해요.",
  requesting: "권한을 기다리고 있어요.",
  live: "색 후보 1곳 · 색만 본 표시라 정확하지 않아요.",
  marked: "직접 표시 1곳 · 자동 인식 결과가 아니에요.",
  denied: "카메라 권한이 꺼져 있어요.",
  unsupported: "카메라를 지원하지 않는 환경이에요.",
};

/** MOCK inputs; mirrors the existing washer guide copy, not live data. */
export const MOCK = Object.freeze({
  source: "MOCK" as const,
  taskLabel: "워셔액",
  step: { index: 2, total: 4, name: "위치 찾기" },
  area: "보닛 안쪽 · 오른쪽 바깥 뒤",
  /** Color-only candidate box (normalized). Deliberately labelled unverified. */
  candidate: Object.freeze({ x: 0.52, y: 0.255, width: 0.25, height: 0.36 }),
  looks: Object.freeze([
    {
      title: "앞유리와 물줄기 모양 표시",
      body: "캡 윗면에서 이 표시를 직접 찾아 주세요.",
    },
    {
      title: "색만 보고 고르지 않기",
      body: "파란 캡이라고 모두 워셔액은 아니에요.",
    },
    {
      title: "표시가 없으면 단정하지 않기",
      body: "냉각수·브레이크액 주입구와 헷갈릴 수 있어요.",
    },
  ]),
  safety: Object.freeze([
    "안전한 곳에 세우고 전원을 끈 뒤 보닛을 열어 주세요.",
    "움직이는 부품, 뜨거운 부품, 주황색 고전압 케이블은 만지지 마세요.",
    "위치가 확실하지 않으면 캡을 열거나 액체를 넣지 마세요.",
  ]),
});
