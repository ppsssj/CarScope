// Opt-in rectangular section loft. World coordinates are cm, +X front, +Y left, +Z up.
import { checkMesh, vec } from "./mesh.mjs";

const { add, sub, cross, unit } = vec;
const interp = (p0, p1, p2, p3, t) => {
  // Catmull–Rom tangents, clamped to the two section values: no exterior overshoot.
  const m1 = (p2 - p0) / 2, m2 = (p3 - p1) / 2;
  const t2=t*t,t3=t2*t;
  const raw=(2*t3-3*t2+1)*p1+(t3-2*t2+t)*m1+(-2*t3+3*t2)*p2+(t3-t2)*m2;
  return Math.max(Math.min(p1,p2),Math.min(Math.max(p1,p2),raw));
};

export function loftMesh({ sections, resolution = 2 }) {
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > 8) throw new Error("loft resolution must be an integer 1..8");
  if (!Array.isArray(sections) || sections.length < 2) throw new Error("loft requires at least two sections");
  const n=sections[0]?.points?.length;
  if (!Number.isInteger(n) || n < 2) throw new Error("loft section needs at least two aligned points");
  sections.forEach((s,i)=>{
    if (!Number.isFinite(s.x) || (i && !(s.x>sections[i-1].x)) || !Array.isArray(s.points) || s.points.length!==n) throw new Error("loft sections must have increasing X and matching point count");
    s.points.forEach((p,j)=>{
      if (!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)||!(p[1]>p[2]) ||
          (j && !(p[0]>s.points[j-1][0])) || (i && p[0]!==sections[0].points[j][0]))
        throw new Error("loft points require aligned increasing Y, finite top Z > bottom Z");
    });
  });
  const xs=[],ys=[];
  for(let i=0;i<sections.length-1;i++) for(let k=0;k<resolution;k++) xs.push([i,k/resolution]);
  xs.push([sections.length-2,1]);
  for(let j=0;j<n-1;j++) for(let k=0;k<resolution;k++) ys.push([j,k/resolution]);
  ys.push([n-2,1]);
  const at=(ix,iy,level)=>{
    const [i,tx]=xs[ix],[j,ty]=ys[iy];
    const x=sections[i].x+(sections[i+1].x-sections[i].x)*tx;
    const y=sections[0].points[j][0]+(sections[0].points[j+1][0]-sections[0].points[j][0])*ty;
    const across=(col)=>{
      const a=sections[Math.max(0,i-1)].points[col][level],b=sections[i].points[col][level];
      const c=sections[i+1].points[col][level],d=sections[Math.min(sections.length-1,i+2)].points[col][level];
      return interp(a,b,c,d,tx);
    };
    return [x,y,interp(across(Math.max(0,j-1)),across(j),across(j+1),across(Math.min(n-1,j+2)),ty)];
  };
  const top=xs.map((_,i)=>ys.map((_,j)=>at(i,j,1))),bottom=xs.map((_,i)=>ys.map((_,j)=>at(i,j,2)));
  if(top.some((row,i)=>row.some((p,j)=>!(p[2]>bottom[i][j][2])))) throw new Error("loft interpolated top crosses bottom");
  const nx=xs.length,ny=ys.length,m={positions:[],normals:[],indices:[]},topTriangles=[];
  const normal=(i,j)=>unit(cross(sub(top[Math.min(nx-1,i+1)][j],top[Math.max(0,i-1)][j]),
    sub(top[i][Math.min(ny-1,j+1)],top[i][Math.max(0,j-1)])));
  const gridIndex=(i,j)=>i*ny+j;
  for(let i=0;i<nx;i++) for(let j=0;j<ny;j++) {m.positions.push(top[i][j]);m.normals.push(normal(i,j));}
  const bottomOffset=m.positions.length;
  for(let i=0;i<nx;i++) for(let j=0;j<ny;j++) {m.positions.push(bottom[i][j]);m.normals.push([0,0,-1]);}
  for(let i=0;i<nx-1;i++) for(let j=0;j<ny-1;j++) {
    const a=top[i][j],b=top[i+1][j],c=top[i+1][j+1],d=top[i][j+1];
    const ia=gridIndex(i,j),ib=gridIndex(i+1,j),ic=gridIndex(i+1,j+1),id=gridIndex(i,j+1);
    m.indices.push(ia,ib,ic,ia,ic,id);
    topTriangles.push([a,b,c],[a,c,d]);
    m.indices.push(bottomOffset+ia,bottomOffset+ic,bottomOffset+ib,bottomOffset+ia,bottomOffset+id,bottomOffset+ic);
  }
  const side=(a,b,c,d,want)=>{
    const n=unit(cross(sub(b,a),sub(c,a))),nn=vec.dot(n,want)>0?n:vec.mul(n,-1),base=m.positions.length;
    m.positions.push(a,b,c,d);m.normals.push(nn,nn,nn,nn);
    if(vec.dot(n,want)>0) m.indices.push(base,base+1,base+2,base,base+2,base+3);
    else m.indices.push(base,base+2,base+1,base,base+3,base+2);
  };
  for(let i=0;i<nx-1;i++) {
    side(top[i][0],bottom[i][0],bottom[i+1][0],top[i+1][0],[0,-1,0]);
    side(top[i+1][ny-1],bottom[i+1][ny-1],bottom[i][ny-1],top[i][ny-1],[0,1,0]);
  }
  for(let j=0;j<ny-1;j++) {
    side(top[0][j+1],bottom[0][j+1],bottom[0][j],top[0][j],[-1,0,0]);
    side(top[nx-1][j],bottom[nx-1][j],bottom[nx-1][j+1],top[nx-1][j+1],[1,0,0]);
  }
  const check=checkMesh(m,{closed:true});
  if(check.degenerate||check.flippedNormals||check.boundaryEdges||check.nonManifoldEdges||!check.outward)
    throw new Error("loft generated invalid closed mesh");
  return {mesh:m,top,topTriangles,bottom};
}
