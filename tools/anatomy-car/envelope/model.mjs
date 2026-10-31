// A new crossover construction, not a transform of the Generic Sedan. Units here are cm.
// True prisms (including sampled curved profiles) feed BOTH the SVG and GLB paths.
import { loadAnatomy } from "../automotive/anatomy.mjs";
import { geometry, region, polyline, withGeo } from "../automotive/geometry.mjs";
import { scene, yFrame, xFrame } from "../automotive/scene.mjs";
import { VIEW } from "../automotive/camera.mjs";
import { ENVELOPE_SUV, envelopeParameters } from "../profiles/vehicle-profile.mjs";

export async function buildEnvelopeModel({ profile = ENVELOPE_SUV } = {}) {
  const anatomy = await loadAnatomy();
  const { k, G, A } = anatomy;
  const d = envelopeParameters(profile), half = d.width / 2;
  const doorDefs = {};
  for (const side of [1, -1]) for (const which of ["front", "rear"]) {
    const spec = profile.design.doorApertures[which], id = `door-${which}-${side === 1 ? "left" : "right"}`;
    doorDefs[id] = { ...spec, id, open: spec.openDegrees, side, openSign: -side, pivot: [spec.hinge, side * (half - 0.35), 0] };
  }
  // Fit all four open door envelopes, not the Sedan's narrower body/cabin assumptions.
  const reach = Object.values(doorDefs).flatMap((def) => {
    const r = def.hinge - def.rear;
    return [[def.hinge - r, def.pivot[1], d.height], [def.hinge, def.pivot[1] + def.side * (r + 20), 0]];
  });
  const P = k.fitProjection([...k.boxCorners({ x: d.xRear, y: -d.widthWithMirrors / 2, w: d.length, d: d.widthWithMirrors, r: 0 }, 0, d.height), ...reach],
    VIEW.width, VIEW.height, { pad: VIEW.pad, azimuth: VIEW.azimuth, elevation: VIEW.elevation });
  const ctx = { ...anatomy, P, ...geometry(anatomy, P) }, sc = scene(ctx);
  const Y = yFrame(G), X = xFrame(G);
  const top = polyline([[d.xRear, 95], [-233, 110], [-217, d.beltHeight], [d.windshieldBaseX, d.beltHeight], [140, 113], [208, 107], [237, 101], [d.xFront, 94]]);
  const arch = (radius, x) => d.wheelRadius + Math.sqrt(Math.max(0, radius ** 2 - (x - d.axleRear) ** 2));
  const bottom = (x) => {
    let z = d.groundClearance;
    for (const axle of [d.axleFront, d.axleRear]) if (Math.abs(x - axle) < d.archRadius) z = Math.max(z, d.wheelRadius + Math.sqrt(d.archRadius ** 2 - (x - axle) ** 2));
    return z;
  };
  const stations = [d.xRear, -233, -217, d.windshieldBaseX, 140, 208, 237, d.xFront,
    ...[d.axleFront, d.axleRear].flatMap((x) => [
      ...Array.from({ length: 65 }, (_, i) => x - d.archRadius + 2 * d.archRadius * i / 64),
      ...Array.from({ length: 49 }, (_,i)=>x+d.flareRadius*Math.cos(Math.PI*i/48))])];
  const addPrism = (name, F, poly, s0, s1, palette = "paint", opts = {}) => sc.prism(name, F, poly, s0, s1,
    { palette, tone: "hi", crease: "none" }, { meta: { owner: "body", ...opts.meta }, ...opts });
  const slab = (name, x0, x1, y0, y1, z0, z1, palette = "paint") => addPrism(name, Y, [[x0,z0],[x1,z0],[x1,z1],[x0,z1]], y0, y1, palette);

  // A shallow central floor/core, recessed behind the tyres and door cavities. No invented engine,
  // battery, seats or other internal layout. Everything is original reference geometry.
  addPrism("suv.body-core", Y, region(d.xRear + 3, d.xFront - 3, () => d.groundClearance, (x) => top(x) - 3, stations), -65, 65, "recess");
  for (const side of [1, -1]) {
    const F = yFrame(G); F.a = [0, side, 0];
    const out = half - 0.005, inner = half - d.panelThickness;
    for (const [name, x0, x1] of [["tail-quarter", d.xRear, -112.5], ["b-pillar-lower", -34, -23], ["front-quarter", 85.5, d.xFront]]) {
      const cuts=[Math.max(x0,d.xRear+1.8),Math.min(x1,d.xFront-1.8),
        ...[d.axleFront-d.archRadius,d.axleFront+d.archRadius,d.axleRear-d.archRadius,d.axleRear+d.archRadius].filter(x=>x>x0&&x<x1)].sort((a,b)=>a-b);
      for(let i=1;i<cuts.length;i++) {
        const a=cuts[i-1],b=cuts[i],mid=(a+b)/2;
        const brow=[d.axleFront,d.axleRear].some(x=>Math.abs(mid-x)<d.archRadius);
        addPrism(`suv.${name}.band-${i}.${side}`,F,region(a,b,brow?()=>d.wheelRadius+d.flareRadius+1:bottom,name==="front-quarter"?(x)=>top(x)-3:top,stations,4),65,inner);
      }
      // Flush arch trim is an explicitly planar inlay on the integral skin, not a second
      // intersecting fender solid. The wheel opening itself is the true sampled prism boundary.
      const axle=name==="front-quarter"?d.axleFront:name==="tail-quarter"?d.axleRear:null;
      const arc=(r,reverse=false)=>Array.from({length:49},(_,i)=>{
        const t=Math.PI*(reverse?1-i/48:i/48);return [axle+r*Math.cos(t),side*half,d.wheelRadius+r*Math.sin(t)];
      });
      const extra=axle===null?[]:[sc.poly([...arc(d.flareRadius),...arc(d.archRadius,true)],"trim",{tone:"none"})];
      addPrism(`suv.${name}.${side}`, F, region(x0, x1, bottom, top, stations, 4), inner, out,"paint",{extra});
    }
    // Real apertures: the rocker stays below the door, following the same wheel-arch cut.
    for (const [name, x0, x1] of [["front", -22.5, 85], ["rear", -112, -34.5]]) {
      const end = name === "rear" ? -112 : x0;
      const low = (x) => Math.max(bottom(x), d.groundClearance);
      const high = (x) => Math.max(low(x) + 0.5, d.doorSill - 0.5);
      addPrism(`suv.rocker.${name}.${side}`, F, region(end, x1, low, high, stations, 3), inner, out, "trim");
      addPrism(`suv.rocker.${name}.band.${side}`, F, region(end,x1,low,high,stations,3),65,inner,"trim");
    }
    // Greenhouse: a tall, long roof with a steep hatch, independent of the Sedan's three-box cabin.
    const lean = (half - 3 - d.roofHalfWidth) / (d.roofEdgeHeight - d.beltHeight);
    const f = { o: [0, side * (half - 3), d.beltHeight], u: [1,0,0],
      v: G.unit3([0, -side * lean, 1]), a: G.unit3([0, side, lean]) };
    const t = (z) => (z - d.beltHeight) * Math.sqrt(1 + lean ** 2);
    const aLine = (z) => d.windshieldBaseX + (d.roofFrontX - d.windshieldBaseX) * (z - d.beltHeight) / (d.roofEdgeHeight - d.beltHeight);
    const cLine = (z) => d.rearGlassBaseX + (d.roofRearX - d.rearGlassBaseX) * (z - d.beltHeight) / (d.roofEdgeHeight - d.beltHeight);
    const shape = (p) => p.map(([x,z]) => [x,t(z)]);
    const belt=d.beltHeight, edge=d.roofEdgeHeight;
    addPrism(`suv.a-pillar.${side}`, f, shape([[d.windshieldBaseX,belt],[d.windshieldBaseX-4.5,belt],[d.roofFrontX-4,edge],[d.roofFrontX,edge]]), 0, 1.2, "paint");
    addPrism(`suv.b-pillar.${side}`, f, shape([[-34,belt],[-23,belt],[-23,edge],[-34,edge]]), 0, 1, "trim");
    addPrism(`suv.d-pillar.${side}`, f, shape([[cLine(belt),belt],[cLine(belt)+12,belt],[cLine(edge)+9,edge],[cLine(edge),edge]]), 0, 1.2);
    addPrism(`suv.quarter-frame.${side}`, f, shape([[d.rearGlassBaseX+13,belt+1.5],[-113,belt+1.5],[-113,edge-1.6],[d.roofRearX+9,edge-1.6]]), 0, 0.8, "trim");
    addPrism(`suv.quarter-glass.${side}`, f, shape([[d.rearGlassBaseX+19,belt+5],[-117,belt+5],[-117,edge-5.6],[d.roofRearX+8,edge-5.6]]), 0.8, 1, "glass");

    for (const def of Object.values(doorDefs).filter((x) => x.side === side)) for (const variant of ["closed", "open"]) {
      const angle = variant === "open" ? def.openSign * def.open * Math.PI / 180 : 0;
      const rotate = (p, origin = def.pivot) => {
        const [x,y,z] = p, [cx,cy] = origin, c = Math.cos(angle), s = Math.sin(angle);
        return [cx+(x-cx)*c-(y-cy)*s, cy+(x-cx)*s+(y-cy)*c, z];
      };
      const frame = (F) => ({ o: rotate(F.o), a: rotate(F.a,[0,0,0]), u: rotate(F.u,[0,0,0]), v: rotate(F.v,[0,0,0]) });
      const collected = [], prims = [];
      const piece = (suffix, F, polygon, s0, s1, palette) => {
        const posed = frame(F);
        const paths = ctx.prismPaths(posed, polygon, s0, s1);
        const solid = sc.record(A.prism(posed, polygon, s0, s1, { name: `${def.id}.${suffix}`, owner: def.id }));
        collected.push(solid); prims.push(sc.solid(paths, { palette, tone: "hi", crease: "none", measurementRole: suffix.startsWith("mirror") ? "mirror" : "body" }));
      };
      const x0 = def.rear + 0.6, x1 = def.hinge - 0.7;
      const low = def.id.includes("rear") ? (x) => Math.max(d.doorSill + 0.5, arch(d.doorNotchRadius, x)) : () => d.doorSill + 0.5;
      piece("skin", F, region(x0, x1, low, () => d.beltHeight, stations, 2), half - d.doorThickness - 0.6, half - 0.6, "paint");
      // Window frame/glass have the same rigid hinge transform as the lower skin.
      const roofZ = edge-2.2, glassZ=edge-6.1;
      const winFront = Math.min(x1, aLine(roofZ) - 8);
      const window = [[x0,belt],[x1,belt],[winFront,roofZ],[x0,roofZ]];
      piece("window-frame", f, shape(window), 0.1, 1.1, "trim");
      const glass = [[x0+3,belt+4],[x1-4,belt+4],[Math.min(x1-4,aLine(glassZ)-10),glassZ],[x0+3,glassZ]];
      piece("window-glass", f, shape(glass), 1.1, 1.4, "glass");
      piece("handle", F, [[x0+8,108],[x0+20,108],[x0+20,110],[x0+8,110]], half-0.6, half, "trim");
      if (def.id.includes("front")) {
        piece("mirror-arm", F, [[61,120],[68,120],[68,122],[61,122]], half-4, half+2, "trim");
        piece("mirror", F, [[58,122],[72,122],[72,127],[58,127]], half+2, d.widthWithMirrors/2, "trim");
      }
      // Reference hinge bearing: a hollow moving knuckle, actual fixed pin and separate leaves.
      // These are functional design estimates, not a claim about OEM construction.
      const Z={o:[0,0,0],u:[1,0,0],v:[0,1,0],a:[0,0,1]};
      const [hx,hy]=def.pivot, lo=Math.min(hy-side*1.45,hy+side*0.15), hi=Math.max(hy-side*1.45,hy+side*0.15);
      piece("hinge-leaf",Z,[[hx-0.8,lo],[hx-0.25,lo],[hx-0.25,hi],[hx-0.8,hi]],43,44,"trim");
      const H=frame({...Z,o:def.pivot});
      const meridian=[[43,0.18],[43,0.32],[44,0.32],[44,0.18]];
      prims.push(sc.solid(withGeo(G.lathe(meridian,H,P,{steps:24}),{kind:"lathe",F:H,meridian,steps:24}),{palette:"trim",tone:"hi",crease:"none"}));
      collected.push(sc.record(A.ring(H,43,44,0.18,0.32,{name:`${def.id}.knuckle`,owner:def.id})));
      const item = sc.item(`${def.id}.${variant}`, rotate([def.hinge-30,side*(half-1),100]), prims, collected, { section: { door: def.id, variant } });
      item.accent = prims.map((p) => p.paths.outline).join("");
    }
  }
  for(const def of Object.values(doorDefs)) {
    const F={o:def.pivot,u:[1,0,0],v:[0,1,0],a:[0,0,1]},meridian=[[42,0],[42,0.14],[45,0.14],[45,0]];
    sc.item(`suv.hinge-pin.${def.id}`,def.pivot,[sc.solid(withGeo(G.lathe(meridian,F,P,{steps:24}),{kind:"lathe",F,meridian,steps:24}),{palette:"trim",tone:"hi",crease:"none"})],
      [sc.record(A.disc(F,42,45,0.14,{name:`suv.hinge-pin.${def.id}`,owner:"body"}))]);
    const [x,y]=def.pivot;
    slab(`suv.hinge-mount.${def.id}`,x+0.1,def.hinge+(def.id.includes("front")?1.5:1),y-0.2,y+0.2,42,42.8,"trim");
  }
  // Quadratic transverse roof crown sampled into a closed thin-shell prism. The same polygon is
  // exported; no SVG-only Bezier smoothing and no inverse reconstruction of geometry.
  const crown = Array.from({ length: 33 }, (_, i) => {
    const y = -d.roofHalfWidth + 2*d.roofHalfWidth*i/32;
    return [y, d.height - (d.height-d.roofEdgeHeight)*(y/d.roofHalfWidth)**2];
  });
  addPrism("suv.crowned-roof", X, [...crown, ...crown.map(([y,z]) => [y,z-1.4]).reverse()], d.roofRearX, d.roofFrontX);
  // The hood is an independent, gently curved longitudinal profile with a shorter rear deck.
  addPrism("suv.hood", Y, region(d.windshieldBaseX+1, d.xFront-2, (x) => top(x)-3, top, stations, 3), -half+2, half-2);
  const glassEnd = (name, xb, xt, zt, rear = false) => {
    const v = G.unit3([xt-xb,0,zt-d.beltHeight]), a = G.unit3([rear ? -(zt-d.beltHeight) : zt-d.beltHeight,0,rear ? xt-xb : xb-xt]);
    const F = { o: [xb,0,d.beltHeight], u:[0,1,0], v, a };
    const h = Math.hypot(xt-xb,zt-d.beltHeight);
    addPrism(`suv.${name}`, F, [[-half+5,0],[half-5,0],[d.roofHalfWidth-2,h],[-d.roofHalfWidth+2,h]], 0, 0.25, "glass");
  };
  glassEnd("windshield",d.windshieldBaseX,d.roofFrontX,d.roofEdgeHeight);
  glassEnd("rear-glass",d.rearGlassBaseX,d.roofRearX,d.roofEdgeHeight,true);
  // Front/rear fascia close the shell. Lens faces stay inside the measured overall length.
  for (const [end, x] of [["front", d.xFront], ["rear", d.xRear]]) {
    const s0 = end === "front" ? x-1.8 : x, s1 = s0+1.8;
    // Partition the fascia around real grille/lamp apertures. No coplanar painted face behind
    // an inlay can win an ambiguous painter tie or cause GLB z-fighting.
    const edge=half-d.panelThickness, lampEdge=half-4;
    const panels=[[-edge,edge,30,42],[-edge,-48,42,67],[48,edge,42,67],[-edge,edge,67,84],
      [-edge,-lampEdge,84,89],[-53,53,84,89],[lampEdge,edge,84,89],[-edge,edge,89,94]];
    panels.forEach(([y0,y1,z0,z1],i)=>addPrism(`suv.${end}-fascia-${i}`,X,[[y0,z0],[y1,z0],[y1,z1],[y0,z1]],s0,s1,"paint"));
    for (const side of [1,-1]) {
      const y0 = side === 1 ? 53 : -half+4, y1 = side === 1 ? half-4 : -53;
      addPrism(`suv.${end}-lamp.${side}`, X, [[y0,84],[y1,84],[y1,89],[y0,89]], end === "front" ? x-0.4 : x, end === "front" ? x : x+0.4, end === "front" ? "lamp" : "lampSmoke");
    }
    addPrism(`suv.${end}-lower-grille`, X, [[-48,42],[48,42],[48,67],[-48,67]], end === "front" ? x-0.3 : x, end === "front" ? x : x+0.3, "trim");
  }
  // Four road wheels at the actual observed axle/track distances. Radius/section are estimates.
  const wheels = [];
  for (const [axleName, x, track] of [["front",d.axleFront,d.frontTrack],["rear",d.axleRear,d.rearTrack]]) for (const side of [1,-1]) {
    const name = `suv.wheel.${axleName}-${side===1?"left":"right"}`, center = [x,side*track/2,d.wheelRadius];
    const F = G.frameOf(center,[0,side,0],[1,0,0],[0,0,1]);
    const w = d.tyreWidth/2, r = d.wheelRadius, bead = 24;
    const section = [[-w,bead],[-w,32],[-w+1.5,r-2],[-w+4,r],[w-4,r],[w-1.5,r-2],[w,32],[w,bead]];
    const parts = [], shapes = [], labels=[];
    const turn = (suffix, meridian, palette) => {
      const paths = withGeo(G.lathe(meridian,F,P,{steps:48}),{kind:"lathe",F,meridian,steps:48});
      parts.push(sc.solid(paths,{palette,tone:"hi",crease:"none"}));
      shapes.push(sc.record(A.lathe(F,meridian,{name:`${name}.${suffix}`,owner:name,ground:suffix==="tyre"})));
      labels.push(suffix);
    };
    turn("tyre",section,"tyre");
    turn("rim",[[w-2,0],[w-2,bead],[w-1.5,bead],[w-1.5,0]],"rimShadow");
    turn("lip",[[w-1,22],[w-1,24.1],[w,24.1],[w,22]],"rim");
    turn("hub",[[w-2,0],[w-2,6],[w,6],[w,0]],"rim");
    const carrier=[[65-track/2,0],[65-track/2,5],[w-2,5],[w-2,0]];
    turn("reference-hub-support",carrier,"trim");
    for(let i=0;i<5;i++) {
      const a=i*2*Math.PI/5+0.15, c=Math.cos(a), s=Math.sin(a);
      const q=(r,t)=>[c*r-s*t,s*r+c*t];
      const polygon=[q(5,-2.2),q(22,-1.5),q(22,1.5),q(5,2.2)];
      parts.push(sc.solid(ctx.prismPaths(F,polygon,w-1.4,w-0.2),{palette:"rim",tone:"hi",crease:"none"}));
      shapes.push(sc.record(A.prism(F,polygon,w-1.4,w-0.2,{name:`${name}.spoke-${i}`,owner:name})));
      labels.push(`spoke-${i}`);
    }
    // One wheel is a compound assembly, as in the original kit wheel. Paint the recessed
    // backing before the tyre/lip, then spokes and the outboard hub cap. All true solids remain
    // in the recorder/export/collision sets; no painter bias or audit exclusions are used.
    const order=[labels.indexOf("reference-hub-support"),labels.indexOf("rim"),0,labels.indexOf("lip"),
      ...labels.map((s,i)=>s.startsWith("spoke-")?i:-1).filter(i=>i>=0),labels.indexOf("hub")];
    sc.item(name,center,order.map(i=>parts[i]),shapes);
    const tyreIndex=order.indexOf(0);
    wheels.push({ name, axle:axleName, side, center, tyrePart:`${name}/${tyreIndex}` });
  }
  // Both body and door records retain exact prisms. No audit proxy for the curved roof/arches.
  sc.settle();
  const halo=[{kind:"halo",d:k.haloOf({x:d.xRear+5,y:-half+5,w:d.length-10,d:d.width-10,r:35},0,4,P)}];
  return { anatomy,P,ctx,sc,halo,doorDefs,profile,parameters:d,wheels,isFixedOpenPart:()=>false };
}
