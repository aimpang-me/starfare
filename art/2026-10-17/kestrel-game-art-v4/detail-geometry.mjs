// Geometry belongs to the GLBs: no renderer-only decorative overlays.
export function installDetail(api){
 const {mesh,materials,parts,add,sub,mul,cross,unit,box,beam,tube,loft,ringSegment,bevelBox,radiusAt}=api;
 const TAU=Math.PI*2;
 for(const [name,color,metal,rough] of [
  ['Navy armor - satin',[.28,.36,.5,1],.62,.56],
  ['Navy armor - blue ceramic',[.20,.28,.43,1],.42,.69],
  ['Navy armor - graphite',[.17,.24,.32,1],.68,.49],
  ['Navy armor - replaced panel',[.34,.4,.5,1],.55,.6],
 ])materials.push({name,pbrMetallicRoughness:{baseColorFactor:color,baseColorTexture:{index:0},metallicRoughnessTexture:{index:2},metallicFactor:metal,roughnessFactor:rough},normalTexture:{index:1,scale:.16},occlusionTexture:{index:4,strength:.85},emissiveFactor:[0,0,0]});
 materials.push({name:'Machined titanium hardware',pbrMetallicRoughness:{baseColorFactor:[.29,.32,.35,1],baseColorTexture:{index:3},metallicFactor:.88,roughnessFactor:.3},emissiveFactor:[0,0,0]});
 materials.push({name:'Deep mechanical recess',pbrMetallicRoughness:{baseColorFactor:[.004,.006,.009,1],metallicFactor:.25,roughnessFactor:.82},emissiveFactor:[0,0,0]});
 materials.push({name:'Heat-treated drive alloy',pbrMetallicRoughness:{baseColorFactor:[.10,.075,.052,1],metallicFactor:.86,roughnessFactor:.45},emissiveFactor:[0,0,0]});
 materials.push({name:'Warm window interior detail',pbrMetallicRoughness:{baseColorFactor:[.09,.045,.012,1],metallicFactor:.15,roughnessFactor:.55},emissiveFactor:[.16,.065,.015]});
 materials.push({name:'Warm concourse glazing',pbrMetallicRoughness:{baseColorFactor:[.10,.055,.02,.15],metallicFactor:.04,roughnessFactor:.12},alphaMode:'BLEND',doubleSided:true,emissiveFactor:[.035,.014,.002]});
 let counters={panels:0,fasteners:0,vents:0,pipes:0},reduced=false;
 const noise=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
 function normal(map,u,v){const e=.00005;return unit(cross(sub(map(u+e,v),map(u-e,v)),sub(map(u,v+e),map(u,v-e))));}
 function point(map,u,v,h=0){return add(map(u,v),mul(normal(map,u,v),h));}
 function patch(name,mat,map,u0,u1,v0,v1,h=.018){
  const outline=[[0,.1],[.1,0],[.9,0],[1,.1],[1,.9],[.9,1],[.1,1],[0,.9]],ring=[];
  for(let j=0;j<8;j++){const a=outline[j],b=outline[(j+1)%8];ring.push(a);if(!reduced)ring.push([(a[0]+b[0])/2,(a[1]+b[1])/2]);}
  const p=[],uv=[],idx=[],N=ring.length,scales=reduced?[1,.94,.4]:[1,.96,.72,.45,.2];
  // Concentric tessellation keeps the plates on curved hulls; a single fan cuts through the shell.
  for(let k=0;k<scales.length;k++)for(const [x0,y0]of ring){const sc=scales[k],x=.5+(x0-.5)*sc,y=.5+(y0-.5)*sc,u=u0+(u1-u0)*x,v=v0+(v1-v0)*y;p.push(...point(map,u,v,k?h:Math.max(.001,h-.004)));uv.push(u*.4+.27,v*.4+.31);}
  const center=p.length/3;p.push(...point(map,(u0+u1)/2,(v0+v1)/2,h));uv.push((u0+u1)*.2+.27,(v0+v1)*.2+.31);
  for(let j=0;j<N;j++){const b=(j+1)%N;for(let k=0;k<scales.length-1;k++){const a=k*N+j,bb=k*N+b,c=a+N,d=bb+N;idx.push(a,bb,c,bb,d,c);}idx.push(center,(scales.length-1)*N+j,(scales.length-1)*N+b);}
  mesh(name,mat,p,idx,true,uv);counters.panels++;
 }
 function cylinder(name,mat,a,b,r,N=8,r2=r){
  const axis=unit(sub(b,a)),x=unit(cross(Math.abs(axis[1])>.9?[1,0,0]:[0,1,0],axis)),y=cross(axis,x),p=[],idx=[];
  for(const [c,rad]of [[a,r],[b,r2]])for(let j=0;j<N;j++){const t=j/N*TAU;p.push(...add(c,add(mul(x,Math.cos(t)*rad),mul(y,Math.sin(t)*rad))));}
  p.push(...a,...b);for(let j=0;j<N;j++){const k=(j+1)%N;idx.push(j,k,N+j,k,N+k,N+j,2*N,k,j,2*N+1,N+j,N+k);}mesh(name,mat,p,idx);
 }
 function bolt(map,u,v,r=.009){if(reduced)return;const c=point(map,u,v,.007),n=normal(map,u,v);cylinder('Flush hex fastener',16,c,add(c,mul(n,.003)),r,6);cylinder('Fastener dark socket',17,add(c,mul(n,.0031)),add(c,mul(n,.0035)),r*.39,6);counters.fasteners++;}
 function vent(map,u0,u1,v0,v1){
  patch('Recessed maintenance well',17,map,u0,u1,v0,v1,.004);
  for(let i=0;i<7;i++){const t=(i+.5)/7,v=v0+(v1-v0)*t;beam('Inset titanium cooling louver',16,point(map,u0+(u1-u0)*.1,v,.012),point(map,u1-(u1-u0)*.1,v,.012),.014,.018);}counters.vents++;
 }
 function grid(map,u0,u1,v0,v1,cols,rows,seed=1,filter=()=>true){
  for(let j=0;j<rows;j++)for(let i=0;i<cols+1;i++){
   const n=seed+i*37+j*113,du=(u1-u0)/cols,dv=(v1-v0)/rows,shift=j%2?.22:0,a=Math.max(u0,u0+(i-shift)*du),b=Math.min(u1,u0+(i+1-shift)*du),c=v0+j*dv,d=c+dv;
   if(b-a<du*.3||!filter((a+b)/2,(c+d)/2))continue;
   const gapU=Math.min((b-a)*.018,.006),gapV=Math.min(dv*.023,.007),uu=a+gapU,vv=c+gapV,ww=b-gapU,zz=d-gapV;
   const pick=noise(n),mat=pick<.53?12:pick<.81?13:pick<.98?14:15;
   if(!reduced&&noise(n+2)>.985)vent(map,uu,ww,vv,zz);else patch('Fitted hull armor panel',mat,map,uu,ww,vv,zz,.004+noise(n+7)*.0015);
   if(noise(n+8)>.35){bolt(map,a+(b-a)*.16,c+dv*.15);bolt(map,b-(b-a)*.16,d-dv*.15);}
   if(noise(n+29)>.88){const u=a+(b-a)*.5;beam('Flush service latch',16,point(map,u,c+dv*.3,.019),point(map,u,c+dv*.48,.019),.014,.012);}
  }
 }
 function hullMap(c,profile,power=.65){return (a,z)=>{const [rx,ry]=radiusAt(profile,z),co=Math.cos(a),si=Math.sin(a);return add(c,[Math.sign(co)*Math.abs(co)**power*rx,Math.sign(si)*Math.abs(si)**power*ry,z]);};}
 function hull(c,profile,length,seed=1,filter=()=>true,power=.65){
  const map=hullMap(c,profile,power),z0=profile[0][0]+.075,z1=profile.at(-1)[0]-.08;
  // Avoid parameter singularities at the superellipse cardinal axes.
  for(let q=0;q<4;q++)grid(map,q*Math.PI/2+.016,(q+1)*Math.PI/2-.016,z0,z1,4,Math.ceil(length/.52),seed+q*51,filter);
  return map;
 }
 function pipe(points,r=.018,mat=16){for(let i=1;i<points.length;i++){cylinder('Exposed routed conduit',mat,points[i-1],points[i],r,8);if(i<points.length-1)cylinder('Conduit union',18,points[i-1].map((v,k)=>v*.08+points[i][k]*.92),points[i],r*1.45,8);}counters.pipes++;}
 function drive(c,r,axis='aft'){
  const tr=v=>add(c,axis==='x'?[v[2],v[1],-v[0]]:[v[0],v[1],-v[2]]);
  for(let k=0;k<5;k++)tube('Stepped drive throat ring',k%2?18:16,tr([0,0,k*.07]),r*(1-k*.04),r*(.88-k*.04),.035,axis);
  for(let j=0;j<24;j++){const a=j/24*TAU,co=Math.cos(a),si=Math.sin(a);cylinder('Radial drive rib',16,tr([co*r*.84,si*r*.84,-.24]),tr([co*r*.84,si*r*.84,.18]),.016,6);cylinder('Drive flange captive bolt',16,tr([co*r*.96,si*r*.96,-.02]),tr([co*r*.96,si*r*.96,.012]),.018,6);
   if(j%2===0)beam('Deep internal guide vane',18,tr([co*r*.4,si*r*.4,.18]),tr([co*r*.72,si*r*.72,.25]),.017,.065);
  }
 }
 function flatTop(c,w,l,y,seed){const map=(u,v)=>[c[0]+v,y,c[2]+u];grid(map,-l/2,l/2,-w/2,w/2,Math.ceil(l/.36),Math.ceil(w/.36),seed);}
 function shoulder(c,profile,z,width){const map=hullMap(c,profile);for(const a of [.18,Math.PI-.18]){vent(map,a-.1,a+.1,z-width/2,z+width/2);for(const zz of [z-width*.38,z+width*.38])bolt(map,a,zz,.014);}}
 function docking(c,side=1){for(let j=0;j<12;j++){const a=j/12*TAU,off=[0,Math.sin(a)*.19,Math.cos(a)*.19];const p=add(c,off);cylinder('Dock clamp captive screw',16,p,add(p,[side*.02,0,0]),.012,6);}for(const yy of [-.22,.22])beam('Dock latch grip',16,add(c,[side*.015,yy,-.1]),add(c,[side*.015,yy,.1]),.025,.035);}
 function stats(){return {...counters};}function reset(){counters={panels:0,fasteners:0,vents:0,pipes:0};}
 return {patch,bolt,vent,grid,hullMap,hull,cylinder,drive,pipe,flatTop,shoulder,docking,point,normal,stats,reset,quality:value=>reduced=value};
}
