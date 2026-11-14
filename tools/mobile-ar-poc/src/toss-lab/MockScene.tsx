// Hand-drawn, generic illustration standing in for a camera picture.
// It is NOT a photo, NOT a specific vehicle and NOT derived from any 3D model.
// Drawn on a 400×500 canvas; the visible window (viewBox 0 60 400 333, 6:5)
// matches the viewfinder so normalized marker/candidate coordinates line up.

export function WasherSymbol({ size = 24, color = "currentColor" }) {
  // Generic windshield + spray symbol drawn for CarScope.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 17.5c2.4-1.6 5-2.4 8-2.4s5.6.8 8 2.4l-1.6 3.2c-2-1.1-4.2-1.7-6.4-1.7s-4.4.6-6.4 1.7z"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 13V9M8.2 13.6 6.4 10M15.8 13.6l1.8-3.6"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="6.4" r="1.3" fill={color} />
      <circle cx="5.6" cy="8.2" r="1.1" fill={color} />
      <circle cx="18.4" cy="8.2" r="1.1" fill={color} />
    </svg>
  );
}

export function MockScene() {
  return (
    <svg
      className="tl-scene"
      viewBox="0 60 400 333.333"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="tl-bay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b3138" />
          <stop offset="1" stopColor="#14181d" />
        </linearGradient>
        <radialGradient id="tl-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <linearGradient id="tl-tank" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9cfd6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8d96a0" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill="url(#tl-bay)" />
      {/* bonnet edge and struts */}
      <path d="M-10 46 Q200 8 410 46 L410 0 L-10 0z" fill="#4a525b" />
      <path d="M-10 46 Q200 8 410 46" stroke="#6b747e" strokeWidth="3" fill="none" />
      {/* central cover */}
      <rect x="92" y="250" width="216" height="170" rx="22" fill="#3a4149" />
      <rect x="112" y="272" width="176" height="126" rx="14" fill="#323940" />
      <path d="M130 300h140M130 326h140M130 352h140M130 378h140" stroke="#2a3036" strokeWidth="6" strokeLinecap="round" />
      {/* coolant reservoir (left) */}
      <rect x="36" y="120" width="92" height="118" rx="16" fill="url(#tl-tank)" />
      <path d="M48 156h18M48 204h18" stroke="#e5e8eb" strokeOpacity="0.7" strokeWidth="3" />
      <circle cx="82" cy="124" r="22" fill="#e0b84a" />
      <circle cx="82" cy="124" r="14" fill="#c99d2e" />
      {/* brake reservoir (left front) */}
      <rect x="150" y="96" width="58" height="62" rx="10" fill="url(#tl-tank)" />
      <circle cx="179" cy="98" r="14" fill="#d8ae3a" />
      {/* hoses */}
      <path d="M128 222 C170 236 200 238 236 262" stroke="#1c2126" strokeWidth="12" fill="none" strokeLinecap="round" />
      <path d="M330 280 C352 330 352 380 330 440" stroke="#1c2126" strokeWidth="10" fill="none" strokeLinecap="round" />
      {/* washer cap (right rear) — the object the user is looking for */}
      <rect x="226" y="176" width="66" height="74" rx="12" fill="#2a3138" />
      <circle cx="258" cy="205" r="34" fill="#2f6ccc" />
      <circle cx="258" cy="205" r="26" fill="#3a7ad8" />
      <g transform="translate(240 187) scale(1.5)">
        <WasherSymbol size={24} color="#eef4ff" />
      </g>
      {/* 12V box (right front) */}
      <rect x="300" y="96" width="82" height="66" rx="8" fill="#22282e" />
      <rect x="312" y="106" width="22" height="12" rx="3" fill="#a5adb6" />
      <rect x="348" y="106" width="22" height="12" rx="3" fill="#a5adb6" />
      <rect width="400" height="500" fill="url(#tl-vignette)" />
    </svg>
  );
}
