// P9-XR-B: feature probe and session options. Everything is injected so it can run in Node tests.
// isSessionSupported only answers for the session mode, so hit-test and anchors are also checked on the API surface.
// The result is what the browser exposes; the device can still refuse a feature when the session starts.
export const sessionInit = root => ({
  requiredFeatures: ['local', 'hit-test'],
  optionalFeatures: ['anchors', 'dom-overlay'],
  ...(root ? { domOverlay: { root } } : {}),
});

const hasMethod = (type, name) => typeof type?.prototype?.[name] === 'function';

export async function probeWebXr({ xr, secureContext, XRSession, XRFrame, XRHitTestResult }) {
  const result = {
    secureContext: Boolean(secureContext), xrApi: Boolean(xr), immersiveAr: false,
    hitTest: hasMethod(XRSession, 'requestHitTestSource'),
    anchors: hasMethod(XRFrame, 'createAnchor') || hasMethod(XRHitTestResult, 'createAnchor'),
    canStart: false, reason: null,
  };
  if (!result.secureContext) return { ...result, reason: 'INSECURE_CONTEXT' };
  if (!xr || typeof xr.isSessionSupported !== 'function') return { ...result, xrApi: false, reason: 'NO_WEBXR_API' };
  try {
    result.immersiveAr = (await xr.isSessionSupported('immersive-ar')) === true;
  } catch (error) {
    return { ...result, reason: error?.name === 'SecurityError' ? 'POLICY_BLOCKED' : 'PROBE_FAILED' };
  }
  if (!result.immersiveAr) return { ...result, reason: 'AR_NOT_SUPPORTED' };
  if (!result.hitTest) return { ...result, reason: 'HIT_TEST_NOT_SUPPORTED' };
  return { ...result, canStart: true };
}

export function startErrorReason(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return 'PERMISSION_DENIED';
    case 'NotSupportedError': return 'SESSION_NOT_SUPPORTED';
    case 'InvalidStateError': return 'SESSION_BUSY';
    default: return 'SESSION_ERROR';
  }
}
