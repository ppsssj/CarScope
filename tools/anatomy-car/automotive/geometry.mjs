// Geometry helpers the Anatomy kit does not provide for car bodies: prisms of concave polygons along
// any axis, convex polyhedra (a greenhouse with tumblehome), x-monotone side regions and tilted frames.

/**
 * Attach the 3D definition a path set was projected from, as a non-enumerable property: the SVG
 * emitters never see it, the geometry exporter reads it. It is the input, never a reconstruction.
 */
export function withGeo(paths, geo) {
  Object.defineProperty(paths, "geo", { value: geo, enumerable: false });
  return paths;
}

/** Polygon signed area (positive = counter-clockwise). */
export const signed = (poly) => poly.reduce((a, [x, y], i) => {
  const [x2, y2] = poly[(i + 1) % poly.length];
  return a + x * y2 - x2 * y;
}, 0);
const screenOriented = (pts) => (signed(pts) < 0 ? [...pts].reverse() : pts);
function runsOf(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

export function geometry({ k, G }, P) {
  const V = G.viewOf(P);
  const at = (p) => k.iso(p, P);
  const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
  const W3 = (F, s, [x, y]) => G.add3(G.add3(G.add3(F.o, G.mul3(F.a, s)), G.mul3(F.u, x)), G.mul3(F.v, y));

  // Render exactly the tessellated loft mesh. No SVG-only curve or inverse path reconstruction.
  function loftPaths(loft, geo) {
    const { mesh } = loft, projected = mesh.positions.map(at), hull = G.hullOf(projected);
    const faces=[];
    for(let t=0;t<mesh.indices.length;t+=3) {
      const ids=mesh.indices.slice(t,t+3), p=ids.map(i=>mesh.positions[i]);
      const n=G.unit3(G.cross3(G.sub3(p[1],p[0]),G.sub3(p[2],p[0])));
      if(G.dot3(n,V)<=1e-9) continue;
      const ring=ids.map(i=>projected[i]), oriented=signed(ring)>0?ring:ring.reverse();
      const light=Math.max(0,Math.min(1,G.dot3(n,G.lightOf(P))));
      const value=geo.kind==="fender"?Math.round(225+15*light):Math.round(216+37*light);
      const color=`rgb(${value},${Math.min(255,value+2)},${Math.min(255,value+5)})`;
      faces.push({d:k.pathOf(oriented,true),color});
    }
    // The fender's projected hull would close the wheel opening; its entire visible-edge
    // outline also draws hidden far-side seams over the hood. Draw only the true arch lip.
    const ground=Math.min(...(geo.bottomZ??[]));
    const outline=geo.kind==="fender"?loft.rings.slice(0,-1).flatMap((ring,i)=>
      Math.max(geo.bottomZ[i],geo.bottomZ[i+1])>ground+1?[path3([ring[1],loft.rings[i+1][1]])]:[]).join(""):k.pathOf(hull,true);
    const fill=geo.kind==="fender"?faces.map(f=>f.d).join(""):outline;
    return withGeo({fill,outline,crease:"",top:"",shades:["","","",""],loftFaces:faces},geo);
  }

  // prismPaths is adapted from Anatomy's examples/arcade-cabinet/build.mjs (MIT, (c) 2026 Ryan; see
  // ../ANATOMY-LICENSE): a concave polygon in a frame's (u, v) plane extruded along F.a, shaded like k.extrude.
  function prismPaths(F, poly, s0, s1) {
    const ring = signed(poly) > 0 ? poly : [...poly].reverse();
    const n = ring.length;
    const capNear = G.dot3(F.a, V) > 0;
    const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
    const near = ring.map((p) => at(W3(F, nearS, p)));
    const far = ring.map((p) => at(W3(F, farS, p)));
    const normals = ring.map(([x0, y0], i) => {
      const [x1, y1] = ring[(i + 1) % n];
      return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
    });
    const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
    const outline = [];
    const crease = [];
    for (const run of runsOf(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
    for (const run of runsOf(facing, true)) {
      crease.push(k.pathOf(run.map((i) => near[i])));
      outline.push(k.pathOf(run.map((i) => far[i])));
    }
    for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
    const parts = [k.pathOf(screenOriented(near), true), k.pathOf(screenOriented(far), true)];
    const buckets = [[], [], [], [], []];
    for (let i = 0; i < n; i++) {
      if (!facing[i]) continue;
      const quad = screenOriented([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
      parts.push(k.pathOf(quad, true));
      buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
    }
    buckets[G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P)].push(k.pathOf(screenOriented(near), true));
    return withGeo({ fill: parts.join(""), outline: outline.join(""), crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) }, { kind: "prism", F, poly, s0, s1 });
  }

  /**
   * A convex polyhedron from world vertices and faces (index loops, counter-clockwise seen from
   * outside). Faces are shaded by the kit's own tone rule; creases are drawn only between visible
   * faces that really turn (more than `fold` degrees), so a gently crowned roof reads as one surface.
   */
  function convexPaths(vertices, faces, { fold = 4 } = {}) {
    const centre = vertices.reduce((a, p) => G.add3(a, p), [0, 0, 0]).map((c) => c / vertices.length);
    const normalOf = (face) => {
      const [a, b, c] = face.map((i) => vertices[i]);
      let n = G.unit3(G.cross3(G.sub3(b, a), G.sub3(c, a)));
      if (G.dot3(n, G.sub3(a, centre)) < 0) n = G.mul3(n, -1);
      return n;
    };
    const normals = faces.map(normalOf);
    const visible = normals.map((n) => G.dot3(n, V) > 1e-9);
    const buckets = [[], [], [], [], []];
    faces.forEach((face, i) => {
      if (visible[i]) buckets[G.toneOf(normals[i], P)].push(k.pathOf(screenOriented(face.map((j) => at(vertices[j]))), true));
    });
    const projected = vertices.map(at);
    const hull = G.hullOf(projected);
    const edges = new Map();
    faces.forEach((face, f) => face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      (edges.get(key) ?? edges.set(key, []).get(key)).push(f);
    }));
    const crease = [];
    for (const [key, list] of edges) {
      if (list.length !== 2 || !visible[list[0]] || !visible[list[1]]) continue;
      const turn = Math.acos(Math.min(1, G.dot3(normals[list[0]], normals[list[1]]))) * (180 / Math.PI);
      if (turn < fold) continue;
      const [a, b] = key.split(",").map(Number);
      crease.push(k.pathOf([projected[a], projected[b]]));
    }
    const hullPath = k.pathOf(hull, true);
    return withGeo({ fill: hullPath, outline: hullPath, crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) }, { kind: "convex", vertices, faces });
  }

  /** A frame tilted from F about F.u by `lean` radians: v leans toward -a (inboard). */
  function tilted(F, origin, lean) {
    const c = Math.cos(lean);
    const s = Math.sin(lean);
    return { o: origin, u: F.u, v: G.unit3(G.sub3(G.mul3(F.v, c), G.mul3(F.a, s))), a: G.unit3(G.add3(G.mul3(F.a, c), G.mul3(F.v, s))) };
  }

  return { V, at, path3, W3, prismPaths, convexPaths, loftPaths, tilted };
}

/**
 * An x-monotone region of the side profile: the polygon between bottom(x) and top(x) for x in
 * [x0, x1], sampled at the given x stations (plus both ends). Car side panels are all of this kind.
 */
export function region(x0, x1, bottom, top, stations = [], step = 8) {
  // stations catch every knot and curve; the even step guards against a curve with no stations
  const even = Array.from({ length: Math.floor((x1 - x0) / step) }, (_, i) => x0 + step * (i + 1));
  const xs = [...new Set([x0, x1, ...[...stations, ...even].filter((x) => x > x0 + 1e-6 && x < x1 - 1e-6)])].sort((a, b) => a - b);
  const upper = xs.map((x) => [x, top(x)]);
  const lower = xs.map((x) => [x, bottom(x)]).reverse();
  const ring = [...upper, ...lower].filter((p, i, list) => {
    const q = list[(i + 1) % list.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
  // drop points that lie on the straight line through their neighbours (the even samples on flat runs)
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length];
    const b = ring[(i + 1) % ring.length];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    return Math.abs(cross) / Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1])) > 0.01;
  });
}

/** Piecewise-linear function through [x, z] knots (knots sorted by x). */
export function polyline(knots) {
  return (x) => {
    if (x <= knots[0][0]) return knots[0][1];
    for (let i = 0; i < knots.length - 1; i++) {
      const [xa, za] = knots[i];
      const [xb, zb] = knots[i + 1];
      if (x <= xb) return za + ((zb - za) * (x - xa)) / (xb - xa);
    }
    return knots[knots.length - 1][1];
  };
}
