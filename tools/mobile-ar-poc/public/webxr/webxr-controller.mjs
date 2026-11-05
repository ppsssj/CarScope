// P9-XR-B/C: owns the XRSession, hit-test source and anchor lifetimes. Rendering stays behind the injected view.
// createAnchor needs an active frame and select events arrive outside one, so a tap only sets a request
// that the next animation frame fulfils from that frame's own hit-test result.
import { reduce, initialState, canPlace, inSession } from './webxr-state.mjs';
import { sessionInit, startErrorReason } from './webxr-capability.mjs';

const copyMatrix = matrix => Float32Array.from(matrix);
const deleteAnchor = anchor => { try { anchor?.delete(); } catch { /* already invalid with its session */ } };

export function createWebXrController({ xr, createView, overlayRoot = null, onState = () => {} }) {
  let state = initialState();
  let session = null, view = null, refSpace = null, viewerSpace = null, hitSource = null;
  let marker = null; // {mode:'ANCHOR',anchor} or {mode:'HIT_POSE',matrix}
  let placeRequested = false, placeSeq = 0, startSeq = 0, disposed = false;

  const dispatch = event => {
    const next = reduce(state, event);
    if (next !== state) { state = next; onState(state); }
  };
  const dropMarker = () => {
    if (marker?.mode === 'ANCHOR') deleteAnchor(marker.anchor);
    marker = null;
  };
  const onReferenceReset = () => {
    // An anchor is re-resolved by the tracker. A stored pose has lost its meaning in the new origin.
    if (marker?.mode === 'HIT_POSE') { dropMarker(); dispatch({ type: 'MARKER_LOST', reason: 'REFERENCE_RESET' }); }
  };
  const onSelect = () => {
    if (!state.overlay && state.phase === 'PLACED') { dispatch({ type: 'REPOSITION' }); return; } // No buttons exist without the overlay.
    requestPlace();
  };
  const onVisibility = () => {
    const value = session?.visibilityState ?? 'hidden';
    dispatch({ type: 'VISIBILITY', value });
    if (value === 'hidden') void stop(); // Nobody is looking: release the camera and anchors. visible-blurred only pauses.
  };
  const onEnd = () => teardown(null);

  function teardown(reason, { silent = false } = {}) {
    if (!session) return;
    const ended = session;
    session = null;
    ended.removeEventListener('end', onEnd);
    ended.removeEventListener('select', onSelect);
    ended.removeEventListener('visibilitychange', onVisibility);
    refSpace?.removeEventListener?.('reset', onReferenceReset);
    placeSeq++;
    placeRequested = false;
    try { hitSource?.cancel(); } catch { /* invalid once the session has ended */ }
    dropMarker();
    view?.dispose();
    view = null; refSpace = null; viewerSpace = null; hitSource = null;
    if (!silent) dispatch({ type: 'SESSION_ENDED', reason });
  }

  function requestPlace() {
    if (!canPlace(state)) return false;
    dispatch({ type: 'PLACE' });
    placeRequested = true;
    return true;
  }

  function adopt(next) {
    dropMarker();
    marker = next;
    dispatch({ type: 'MARKER_PLACED', mode: next.mode });
  }

  function placeFromFrame(frame, hit, hitPose) {
    const seq = ++placeSeq;
    if (!hit || !hitPose) { dispatch({ type: 'PLACE_FAILED', reason: 'NO_SURFACE' }); return; }
    if (!state.anchors) { adopt({ mode: 'HIT_POSE', matrix: copyMatrix(hitPose.transform.matrix) }); return; }
    const failed = error => {
      if (seq !== placeSeq) return;
      dispatch({ type: 'PLACE_FAILED', reason: 'ANCHOR_FAILED', anchors: error?.name === 'NotSupportedError' ? false : undefined });
    };
    let pending;
    try {
      pending = hit.createAnchor ? hit.createAnchor() : frame.createAnchor(hitPose.transform, refSpace);
    } catch (error) { failed(error); return; }
    pending.then(anchor => {
      // Removed, re-placed or ended while waiting: this anchor has no owner, so release it.
      if (seq !== placeSeq || !session) { deleteAnchor(anchor); return; }
      adopt({ mode: 'ANCHOR', anchor });
    }, failed);
  }

  function markerMatrix(frame) {
    if (marker?.mode === 'HIT_POSE') return marker.matrix;
    if (marker?.mode !== 'ANCHOR') return null;
    if (frame.trackedAnchors && !frame.trackedAnchors.has(marker.anchor)) return null;
    return frame.getPose(marker.anchor.anchorSpace, refSpace)?.transform.matrix ?? null;
  }

  function onFrame(_time, frame) {
    if (!session || !frame) return;
    try {
      const pose = frame.getViewerPose(refSpace);
      const tracking = !pose ? 'LOST' : pose.emulatedPosition ? 'LIMITED' : 'TRACKING';
      const usable = tracking === 'TRACKING';
      const hit = usable ? frame.getHitTestResults(hitSource)[0] ?? null : null;
      const hitPose = hit?.getPose(refSpace) ?? null;
      if (placeRequested) {
        placeRequested = false;
        placeFromFrame(frame, hit, hitPose);
      }
      // A marker is only drawn with a trustworthy viewer pose: otherwise it would appear fixed to the screen.
      const matrix = usable ? markerMatrix(frame) : null;
      const aiming = state.phase === 'AIMING' || state.phase === 'REPOSITIONING';
      view.setReticle(aiming && hitPose ? hitPose.transform.matrix : null);
      view.setMarker(matrix, { dim: state.phase === 'REPOSITIONING' });
      dispatch({ type: 'FRAME', tracking, surface: Boolean(hitPose), markerVisible: Boolean(matrix) });
      view.render();
    } catch {
      const ended = session;
      teardown('FRAME_ERROR');
      ended?.end().catch(() => {});
    }
  }

  async function requestSurfaceSource(activeSession) {
    // "point" helps where no plane exists, as in an engine bay. Plain plane hit-testing is the spec default.
    try {
      return await activeSession.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane', 'point'] });
    } catch {
      return activeSession.requestHitTestSource({ space: viewerSpace });
    }
  }

  async function start() {
    const before = state;
    dispatch({ type: 'START' });
    if (state === before) return false;
    const attempt = ++startSeq;
    let opened;
    try {
      opened = await xr.requestSession('immersive-ar', sessionInit(overlayRoot)); // First await: stays inside the user gesture.
    } catch (error) {
      if (attempt === startSeq) dispatch({ type: 'START_FAILED', reason: startErrorReason(error) });
      return false;
    }
    if (disposed || attempt !== startSeq) { opened.end().catch(() => {}); return false; }
    session = opened;
    session.addEventListener('end', onEnd);
    session.addEventListener('select', onSelect);
    session.addEventListener('visibilitychange', onVisibility);
    try {
      view = createView();
      refSpace = await view.attach(opened);
      if (session !== opened) return false;
      refSpace.addEventListener?.('reset', onReferenceReset);
      viewerSpace = await opened.requestReferenceSpace('viewer');
      if (session !== opened) return false;
      hitSource = await requestSurfaceSource(opened);
      if (session !== opened) { try { hitSource.cancel(); } catch { /* ended */ } return false; }
    } catch {
      if (session === opened) {
        teardown(null, { silent: true });
        dispatch({ type: 'START_FAILED', reason: 'SESSION_SETUP_FAILED' });
        opened.end().catch(() => {});
      }
      return false;
    }
    const granted = opened.enabledFeatures;
    const anchors = state.capability.anchors && (Array.isArray(granted) ? granted.includes('anchors') : true);
    dispatch({ type: 'SESSION_STARTED', overlay: Boolean(opened.domOverlayState), anchors });
    view.startLoop(onFrame);
    return true;
  }

  async function stop() {
    if (!session) return;
    const ending = session;
    try {
      await ending.end();
    } catch {
      if (session === ending) teardown(null); // The browser may have ended it first. Never keep stale state.
    }
  }

  return {
    get state() { return state; },
    probed(capability) { dispatch({ type: 'PROBED', capability }); },
    start,
    stop,
    requestPlace,
    reposition() { dispatch({ type: 'REPOSITION' }); },
    cancelReposition() {
      if (state.phase !== 'REPOSITIONING') return;
      placeSeq++;
      placeRequested = false;
      dispatch({ type: 'CANCEL_REPOSITION' });
    },
    remove() {
      if (state.phase !== 'PLACED' && state.phase !== 'REPOSITIONING') return;
      placeSeq++;
      placeRequested = false;
      dropMarker();
      view?.setMarker(null);
      dispatch({ type: 'REMOVE' });
    },
    dispose() {
      disposed = true;
      startSeq++;
      return inSession(state) || session ? stop() : Promise.resolve();
    },
  };
}
