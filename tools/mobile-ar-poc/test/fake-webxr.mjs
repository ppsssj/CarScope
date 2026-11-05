// P9-XR-B test double for the WebXR objects the PoC uses. Frames advance only through step().
// It is loaded in Node and also injected as page source, so it must stay dependency free.
// It models API rules (active frames, deleted anchors, feature grants). It says nothing about real device tracking.
export const translation = (x, y, z) => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

export function createFakeXr(options = {}) {
  const domError = (name, message = name) => new DOMException(message, name);
  const env = {
    supported: true, probeError: null, requestError: null, holdRequest: false,
    grant: { anchors: true, 'dom-overlay': true }, enabledFeaturesVisible: true,
    anchorMode: 'resolve', hitSourceError: false, pointHitError: false, spaceError: false,
    viewer: translation(0, 0, 0), tracking: 'TRACKING', hit: translation(0, -0.2, -0.6), anchorTracked: true, anchorOffset: [0, 0, 0],
    sessions: [], anchors: [], hitSources: [], heldAnchors: [], requests: [], heldRequest: null,
    ...options,
  };

  class FakeSpace extends EventTarget {}
  const localSpace = new FakeSpace(), viewerSpace = new FakeSpace();
  const pose = matrix => ({ transform: { matrix, position: { x: matrix[12], y: matrix[13], z: matrix[14] }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });

  class FakeAnchor {
    constructor(matrix) { this.matrix = Float32Array.from(matrix); this.deleted = false; this.space = new FakeSpace(); env.anchors.push(this); }
    get anchorSpace() { if (this.deleted) throw domError('InvalidStateError'); return this.space; }
    delete() { this.deleted = true; }
  }

  function makeAnchor(frame, matrix) {
    if (!frame.active) return Promise.reject(domError('InvalidStateError', 'frame is not active'));
    if (!env.currentSession.granted.includes('anchors')) return Promise.reject(domError('NotSupportedError'));
    if (env.anchorMode === 'reject') return Promise.reject(domError('OperationError'));
    if (env.anchorMode === 'throw') throw domError('InvalidStateError');
    if (env.anchorMode === 'hold') {
      return new Promise((resolve, reject) => env.heldAnchors.push({ resolve: () => resolve(new FakeAnchor(matrix)), reject }));
    }
    return Promise.resolve(new FakeAnchor(matrix));
  }

  class XRFrame {
    constructor(session) { this.session = session; this.active = false; }
    get trackedAnchors() { return new Set(env.anchorTracked ? env.anchors.filter(a => !a.deleted) : []); }
    getViewerPose(space) {
      if (space !== localSpace) throw Error('viewer pose must use the render reference space');
      if (env.tracking === 'LOST') return null;
      const eye = env.eyeProjection ?? Float32Array.from([1.5 * (844 / 390), 0, 0, 0, 0, 1.5, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0]);
      return { ...pose(env.viewer), emulatedPosition: env.tracking === 'LIMITED', views: [{ eye: 'none', projectionMatrix: eye, ...pose(env.viewer) }] };
    }
    getHitTestResults(source) {
      if (source.cancelled) throw domError('InvalidStateError');
      const frame = this;
      return env.hit ? [{
        getPose: () => pose(env.hit),
        createAnchor: () => makeAnchor(frame, env.hit),
      }] : [];
    }
    createAnchor(init) { return makeAnchor(this, init.matrix); }
    getPose(space) {
      const anchor = env.anchors.find(a => a.space === space);
      if (!anchor) return null;
      const m = Float32Array.from(anchor.matrix);
      m[12] += env.anchorOffset[0]; m[13] += env.anchorOffset[1]; m[14] += env.anchorOffset[2];
      return pose(m);
    }
  }
  class XRSession extends EventTarget {
    constructor(init) {
      super();
      this.init = init;
      this.granted = (init.optionalFeatures ?? []).filter(name => env.grant[name]);
      if (env.enabledFeaturesVisible) this.enabledFeatures = [...init.requiredFeatures, ...this.granted];
      this.domOverlayState = this.granted.includes('dom-overlay') && init.domOverlay ? { type: 'screen' } : null;
      this.environmentBlendMode = 'alpha-blend';
      this.visibilityState = 'visible';
      this.renderState = {};
      this.inputSources = [];
      this.ended = false;
      this.callbacks = new Map();
      this.nextHandle = 1;
    }
    async requestReferenceSpace(type) {
      if (this.ended) throw domError('InvalidStateError');
      if (env.spaceError && type === 'viewer') throw domError('NotSupportedError');
      return type === 'viewer' ? viewerSpace : localSpace;
    }
    async requestHitTestSource(init) {
      if (env.hitSourceError) throw domError('NotSupportedError');
      if (env.pointHitError && init.entityTypes) throw new TypeError('entityTypes');
      const source = { init, cancelled: false, cancel() { this.cancelled = true; } };
      env.hitSources.push(source);
      return source;
    }
    updateRenderState(state) { Object.assign(this.renderState, state); }
    requestAnimationFrame(callback) { const id = this.nextHandle++; this.callbacks.set(id, callback); return id; }
    cancelAnimationFrame(id) { this.callbacks.delete(id); }
    async end() {
      if (this.ended) throw domError('InvalidStateError');
      this.ended = true;
      this.dispatchEvent(new Event('end'));
    }
  }

  env.step = (time = 16) => {
    const session = env.currentSession;
    if (!session || session.ended) return false;
    const frame = new XRFrame(session), callbacks = [...session.callbacks.values()];
    session.callbacks.clear();
    frame.active = true;
    for (const callback of callbacks) callback(time, frame);
    frame.active = false;
    return callbacks.length > 0;
  };
  env.select = () => {
    const event = new Event('select');
    event.frame = new XRFrame(env.currentSession); // Inactive, as a real select event's frame is by the next animation frame.
    env.currentSession.dispatchEvent(event);
  };
  env.setVisibility = value => {
    env.currentSession.visibilityState = value;
    env.currentSession.dispatchEvent(new Event('visibilitychange'));
  };
  env.resetSpace = () => localSpace.dispatchEvent(new Event('reset'));
  env.localSpace = localSpace;
  env.XRSession = XRSession;
  env.XRFrame = XRFrame;
  env.XRHitTestResult = class XRHitTestResult { createAnchor() {} };
  env.xr = {
    async isSessionSupported(mode) {
      if (env.probeError) throw domError(env.probeError);
      return mode === 'immersive-ar' && env.supported;
    },
    async requestSession(mode, init) {
      env.requests.push({ mode, requiredFeatures: init.requiredFeatures, optionalFeatures: init.optionalFeatures, hasOverlayRoot: Boolean(init.domOverlay?.root) });
      if (env.holdRequest) await new Promise((resolve, reject) => { env.heldRequest = { resolve, reject }; });
      if (env.requestError) throw domError(env.requestError);
      const session = new XRSession(init);
      env.sessions.push(session);
      env.currentSession = session;
      return session;
    },
  };
  return env;
}

/** Browser only: replaces the page's XR globals and supplies a framebuffer the test can read back. */
export function installFakeXr(env, global = globalThis) {
  Object.defineProperty(global.navigator, 'xr', { configurable: true, value: env.xr });
  global.XRSession = env.XRSession;
  global.XRFrame = env.XRFrame;
  global.XRHitTestResult = env.XRHitTestResult;
  global.WebGL2RenderingContext.prototype.makeXRCompatible = async () => {};
  global.XRWebGLLayer = class XRWebGLLayer {
    constructor(session, gl) {
      this.framebufferWidth = 390;
      this.framebufferHeight = 844;
      this.gl = gl;
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 390, 844);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 390, 844);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      env.layer = this;
    }
    getViewport() { return { x: 0, y: 0, width: 390, height: 844 }; }
  };
  // Reads the last rendered frame while the context is current, classified by color. Origin is top-left.
  env.readMarks = () => {
    const { gl, framebuffer } = env.layer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const pixels = new Uint8Array(390 * 844 * 4);
    gl.readPixels(0, 0, 390, 844, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const collect = () => ({ count: 0, sx: 0, sy: 0 });
    const blue = collect(), white = collect();
    for (let y = 0; y < 844; y++) for (let x = 0; x < 390; x++) {
      const i = (y * 390 + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 40) continue;
      const bucket = r > 230 && g > 230 && b > 230 ? white : b > 150 && r < 90 ? blue : null;
      if (bucket) { bucket.count++; bucket.sx += x; bucket.sy += 843 - y; }
    }
    const summary = s => (s.count ? { count: s.count, x: s.sx / s.count, y: s.sy / s.count } : { count: 0 });
    return { blue: summary(blue), white: summary(white) };
  };
  env.framePng = () => {
    const { gl, framebuffer } = env.layer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const pixels = new Uint8Array(390 * 844 * 4);
    gl.readPixels(0, 0, 390, 844, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const canvas = global.document.createElement('canvas');
    canvas.width = 390; canvas.height = 844;
    const context = canvas.getContext('2d'), image = context.createImageData(390, 844);
    for (let y = 0; y < 844; y++) for (let x = 0; x < 390; x++) {
      const from = ((843 - y) * 390 + x) * 4, to = (y * 390 + x) * 4, alpha = pixels[from + 3] / 255;
      // A flat gray stands in for the camera image, which this test cannot provide.
      for (let c = 0; c < 3; c++) image.data[to + c] = pixels[from + c] * alpha + 110 * (1 - alpha);
      image.data[to + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  };
  // Mirrors the DOM-overlay rule: a tap fires beforexrselect first, and preventDefault stops the select.
  env.tap = (x, y) => {
    const target = global.document.elementFromPoint(x, y) ?? global.document.getElementById('xr-overlay');
    const event = new Event('beforexrselect', { bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(event);
    if (!event.defaultPrevented) env.select();
    return !event.defaultPrevented;
  };
  return env;
}
