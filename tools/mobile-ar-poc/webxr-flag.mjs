// P9-XR-C: the experiment switch, read only by development and experiment entry points. Off unless set exactly.
// Keep this out of the Render import closure: its ENV_CANNOT_ENABLE_AUTH gate fails on this variable by design.
export function webxrGuideEnabled(env, argv = []) {
  const value = env.CARSCOPE_WEBXR_GUIDE;
  if (value === undefined || value === '') return argv.includes('--webxr-guide');
  if (value !== 'EXPERIMENT') throw new Error('INVALID_CARSCOPE_WEBXR_GUIDE');
  return true;
}
