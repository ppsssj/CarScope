// Closed front-fender sweep. Unlike the rectangular hood loft, each Y/Z section
// follows the sampled wheel opening. All dimensions are car-world centimetres.
import { earClip, checkMesh, vec } from "./mesh.mjs";

const { sub, cross, mul, unit, dot } = vec;

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
