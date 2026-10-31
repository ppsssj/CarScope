// Closed front-fender sweep. Unlike the rectangular hood loft, each Y/Z section
// follows the sampled wheel opening. All dimensions are car-world centimetres.
import { earClip, checkMesh, vec } from "./mesh.mjs";

const { add, sub, cross, mul, unit, dot } = vec;

export function fenderMesh({ side, xs, innerY, halfWidth, bottomZ, topZ, shoulderDrop }) {
  if (![1,-1].includes(side) || !Array.isArray(xs) || xs.length < 2 ||
      xs.some((x,i)=>!Number.isFinite(x) || (i && x<=xs[i-1])) ||
      ![innerY,halfWidth,shoulderDrop].every(Number.isFinite) ||
      !(innerY < halfWidth-1.8) || shoulderDrop <= 0 || shoulderDrop >= 4 ||
      !Array.isArray(bottomZ) || !Array.isArray(topZ) ||
      bottomZ.length !== xs.length || topZ.length !== xs.length ||
      bottomZ.some((z,i)=>!Number.isFinite(z) || !Number.isFinite(topZ[i]) || topZ[i]-z < 5))
    throw new Error("fender requires ordered sections, matching finite bounds and positive thickness");
  // A controlled ten-point cross-section: inner backing, wheel-opening lip,
  // convex side, shoulder, hood seam. The 2 mm seam is inherited from the hood.
  const ringAt=(i)=>{
    const x=xs[i],lo=bottomZ[i],hi=topZ[i],span=hi-lo;
    const yz=[
      [innerY,lo], [halfWidth-1.25,lo],
      [halfWidth-0.45,lo+span*0.24],
      [halfWidth-0.005,lo+span*0.55],
      [halfWidth-0.12,lo+span*0.78],
      [halfWidth-0.60,hi-shoulderDrop],
      [halfWidth-1.25,hi-0.08],
      [halfWidth-1.80,hi], [halfWidth-1.80,hi-3.2], [innerY,hi-3.2],
    ];
    return yz.map(([y,z])=>[x,side*y,z]);
  };
  const rings=xs.map((_,i)=>ringAt(i)),n=rings[0].length;
  const mesh={positions:[],normals:[],indices:[]},surfaceTriangles=[];
  const pushTri=(a,b,c,na,nb,nc)=>{
    const g=cross(sub(b,a),sub(c,a));
    if(dot(g,na)<=0 || dot(g,nb)<=0 || dot(g,nc)<=0) [na,nb,nc]=[unit(g),unit(g),unit(g)];
    const base=mesh.positions.length;
    mesh.positions.push(a,b,c);mesh.normals.push(na,nb,nc);
    mesh.indices.push(base,base+1,base+2);
  };
  const normalAt=(i,j)=>{
    const prev=rings[i][(j+n-1)%n],next=rings[i][(j+1)%n];
    const di=sub(rings[Math.min(xs.length-1,i+1)][j],rings[Math.max(0,i-1)][j]);
    return unit(mul(cross(sub(next,prev),di),side));
  };
  for(let i=0;i<xs.length-1;i++) for(let j=0;j<n;j++) {
    const k=(j+1)%n,a=rings[i][j],b=rings[i][k],c=rings[i+1][k],d=rings[i+1][j];
    const na=normalAt(i,j),nb=normalAt(i,k),nc=normalAt(i+1,k),nd=normalAt(i+1,j);
    // Mirroring Y reverses winding, while the physical normals still point outward.
    if(side===1) {pushTri(a,b,c,na,nb,nc);pushTri(a,c,d,na,nc,nd);}
    else {pushTri(a,c,b,na,nc,nb);pushTri(a,d,c,na,nd,nc);}
    // Include the inner backing in Anatomy records so the outer skin has a
    // physical support path to the existing front-quarter band.
    if(j>=1) surfaceTriangles.push(side===1?[a,b,c]:[a,c,b],side===1?[a,c,d]:[a,d,c]);
  }
  for(const [i,want] of [[0,[-1,0,0]],[xs.length-1,[1,0,0]]]) {
    const ring=rings[i],triangles=earClip(ring.map(p=>[p[1]*side,p[2]]));
    for(const [a,b,c] of triangles) {
      const ids=side===want[0]?[a,b,c]:[a,c,b];
      pushTri(ring[ids[0]],ring[ids[1]],ring[ids[2]],want,want,want);
    }
  }
  const check=checkMesh(mesh,{closed:true});
  if(check.degenerate || check.flippedNormals || check.boundaryEdges || check.nonManifoldEdges || !check.outward)
    throw new Error(`fender invalid closed mesh: ${JSON.stringify(check)}`);
  return {mesh,rings,surfaceTriangles};
}

// Wheel-arch trim that follows the fender's real skin instead of the old Y-constant inlay.
// The annulus innerR..outerR about the axle (feet cut at the axle height, as on the rear arch) is
// overlaid exactly on the fender: every outward skin triangle is clipped to it strip by strip and
// offset along Y by gap (inner face) and gap+thickness (outer face). The inner face is therefore
// parallel to the skin everywhere: a closed thin shell with exact clearance, no lift and no sag.
// Fender sections at axle±innerR make the inner boundary the true lip chord, never over the opening.
export function archTrim(fender,{side,axle,centerZ,innerR,outerR,gap=0.05,thickness=0.15}) {
  if(![1,-1].includes(side) || ![axle,centerZ,innerR,outerR,gap,thickness].every(Number.isFinite) ||
      !(innerR>0 && outerR>innerR && gap>0 && thickness>0))
    throw new Error("arch trim requires a side, a centre and 0 < innerR < outerR with positive gap and thickness");
  const xs=fender.rings.map(r=>r[0][0]);
  if(![axle-innerR,axle+innerR].every(x=>xs.some(s=>Math.abs(s-x)<1e-6)) || !(xs[0]<axle-outerR && xs.at(-1)>axle+outerR))
    throw new Error("arch trim requires fender sections at both arch ends and around the flare");
  const {positions:P,normals:N,indices:I}=fender.mesh;
  const arc=(R,x)=>centerZ+Math.sqrt(Math.max(0,R*R-(x-axle)**2));
  const lerp=(a,b,t)=>({p:add(a.p,mul(sub(b.p,a.p),t)),n:add(a.n,mul(sub(b.n,a.n),t))});
  const clip=(poly,f)=>{
    const out=[];
    poly.forEach((a,i)=>{
      const b=poly[(i+1)%poly.length],da=f(a.p),db=f(b.p);
      if(da>=0) out.push(a);
      if((da>=0)!==(db>=0)) out.push(lerp(a,b,da/(da-db)));
    });
    return out;
  };
  // Per fender strip the region is convex: x limits, z >= axle height, above the inner chord, below the outer.
  const region=(x0,x1)=>{
    const a=Math.max(x0,axle-outerR),b=Math.min(x1,axle+outerR);
    if(!(b-a>1e-9)) return null;
    const line=(R)=>(p)=>arc(R,a)+(arc(R,b)-arc(R,a))*(p[0]-a)/(b-a);
    return [(p)=>p[0]-a,(p)=>b-p[0],(p)=>p[2]-centerZ,(p)=>p[2]-line(innerR)(p),(p)=>line(outerR)(p)-p[2]];
  };
  const area=(poly)=>Math.abs(poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a.p[0]*b.p[2]-b.p[0]*a.p[2];},0))/2;
  let expected=0,covered=0;
  for(let i=0;i<xs.length-1;i++) {
    const fs=region(xs[i],xs[i+1]);if(!fs) continue;
    const box=[[xs[i],centerZ-1],[xs[i+1],centerZ-1],[xs[i+1],centerZ+outerR+1],[xs[i],centerZ+outerR+1]].map(([x,z])=>({p:[x,0,z],n:[0,0,0]}));
    expected+=area(fs.reduce(clip,box));
  }
  const pieces=[];
  for(let t=0;t<I.length;t+=3) {
    const tri=[0,1,2].map(j=>({p:P[I[t+j]],n:N[I[t+j]]})),g=cross(sub(tri[1].p,tri[0].p),sub(tri[2].p,tri[0].p));
    if(side*g[1]<=1e-9*Math.hypot(...g)) continue;
    const xsOf=tri.map(v=>v.p[0]),fs=region(Math.min(...xsOf),Math.max(...xsOf));if(!fs) continue;
    const poly=fs.reduce(clip,tri).filter((v,i,all)=>Math.hypot(v.p[0]-all.at(i-1).p[0],v.p[2]-all.at(i-1).p[2])>1e-4);
    if(poly.length<3) continue;
    covered+=area(poly);pieces.push(poly);
  }
  if(!(Math.abs(covered-expected)<=1e-6*expected))
    throw new Error(`arch trim must cover its region exactly once: ${covered} of ${expected} cm²`);
  const mesh={positions:[],normals:[],indices:[]};
  const lifted=(v,d)=>[v.p[0],v.p[1]+side*d,v.p[2]];
  const push=(ps,ns)=>{const b=mesh.positions.length;mesh.positions.push(...ps);mesh.normals.push(...ns);mesh.indices.push(b,b+1,b+2);};
  const key=(p)=>`${Math.round(p[0]*1e4)},${Math.round(p[2]*1e4)}`;
  const directed=new Map();
  for(const poly of pieces) {
    // A centroid fan never makes a zero-area triangle out of collinear boundary points.
    const c={p:mul(poly.reduce((s,v)=>add(s,v.p),[0,0,0]),1/poly.length),n:poly.reduce((s,v)=>add(s,v.n),[0,0,0])};
    poly.forEach((a,i)=>{
      let [u,v]=[a,poly[(i+1)%poly.length]];
      if(side*cross(sub(u.p,c.p),sub(v.p,c.p))[1]<0) [u,v]=[v,u];
      // Outer face faces away from the skin; the inner face is the same triangle reversed.
      const outer=[c,u,v].map(q=>lifted(q,gap+thickness)),g=cross(sub(outer[1],outer[0]),sub(outer[2],outer[0]));
      const smooth=[c,u,v].map(q=>unit(q.n)),ns=smooth.every(n=>dot(n,g)>0)?smooth:Array(3).fill(unit(g));
      push(outer,ns);
      push([c,v,u].map(q=>lifted(q,gap)),[ns[0],ns[2],ns[1]].map(n=>mul(n,-1)));
      for(const [s,e] of [[c,v],[v,u],[u,c]]) directed.set(`${key(s.p)}>${key(e.p)}`,[s,e]);
    });
  }
  // Inner-face edges without a reverse are the trim's boundary; each becomes a thin wall.
  const next=new Map();
  for(const [k,[s,e]] of directed) {
    const [a,b]=k.split(">");
    if(directed.has(`${b}>${a}`)) continue;
    next.set(a,[s,e,b]);
    const q=[lifted(e,gap),lifted(s,gap),lifted(s,gap+thickness),lifted(e,gap+thickness)];
    const n=unit(cross(sub(q[1],q[0]),sub(q[2],q[0])));
    push([q[0],q[1],q[2]],[n,n,n]);push([q[0],q[2],q[3]],[n,n,n]);
  }
  const outline=[],start=next.keys().next().value;
  for(let k=start;outline.length<=next.size;) {const [s,,b]=next.get(k);outline.push(lifted(s,gap+thickness));k=b;if(k===start) break;}
  if(outline.length!==next.size) throw new Error("arch trim boundary must be one closed loop");
  const check=checkMesh(mesh,{closed:true});
  if(check.degenerate || check.flippedNormals || check.boundaryEdges || check.nonManifoldEdges || check.windingConflicts || !check.outward)
    throw new Error(`arch trim invalid closed mesh: ${JSON.stringify(check)}`);
  return {mesh,clearance:gap,area:covered,points:outline};
}
