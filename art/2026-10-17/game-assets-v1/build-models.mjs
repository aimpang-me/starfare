// Original Starfare model source. Node built-ins only; no installed packages required.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const TAU=Math.PI*2;
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const lin=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const rgb=h=>[1,3,5].map(i=>lin(parseInt(h.slice(i,i+2),16)/255));
const palette=[
 ['Hull navy','#24364d',.58,.42],['Ceramic panels','#152236',.32,.6],
 ['Satin alloy','#a2b3c8',.75,.34],['Graphite recess','#080e19',.18,.72],
 ['Cabin glass','#203f54',.5,.2],['Warm cabin material','#eeb36a',.08,.55],
 ['Cyan painted trim','#56a7bc',.35,.5],['Navigation fixtures OFF','#163644',.25,.4],
 ['Dark alloy','#506177',.68,.42]
];
const materials=palette.map(([name,h,metal,rough])=>({name,pbrMetallicRoughness:{baseColorFactor:[...rgb(h),1],metallicFactor:metal,roughnessFactor:rough},emissiveFactor:[0,0,0],doubleSided:false}));
let parts=[],sockets=[];
function mesh(name,mat,p,idx,smooth=true){
 if(!smooth){const pp=[],ii=[];for(const v of idx){pp.push(...p.slice(v*3,v*3+3));ii.push(ii.length);}p=pp;idx=ii;}
 const n=new Array(p.length).fill(0);
 for(let k=0;k<idx.length;k+=3){const [a,b,c]=idx.slice(k,k+3).map(i=>p.slice(i*3,i*3+3));const normal=cross(sub(b,a),sub(c,a));for(const v of idx.slice(k,k+3))for(let j=0;j<3;j++)n[v*3+j]+=normal[j];}
 for(let k=0;k<n.length;k+=3)n.splice(k,3,...unit(n.slice(k,k+3)));
 parts.push({name,mat,p,n,idx});
}
function box(name,mat,c,s,transform=p=>p){
 const p=[],idx=[];const corners=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
 for(const v of corners)p.push(...transform(add(c,v.map((x,i)=>x*s[i]/2))));
 for(const f of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])idx.push(f[0],f[1],f[2],f[0],f[2],f[3]);
 mesh(name,mat,p,idx,false);
}
function loft(name,mat,c,profile,N=24,transform=p=>p,cap=true){
 const p=[],idx=[];
 for(const [z,rx,ry] of profile)for(let j=0;j<N;j++){const a=j/N*TAU;p.push(...transform(add(c,[Math.cos(a)*rx,Math.sin(a)*ry,z])));}
 for(let k=0;k<profile.length-1;k++)for(let j=0;j<N;j++){const a=k*N+j,b=k*N+(j+1)%N,d=(k+1)*N+(j+1)%N,e=(k+1)*N+j;idx.push(a,b,e,b,d,e);}
 if(cap){for(const k of [0,profile.length-1]){const center=p.length/3;p.push(...transform(add(c,[0,0,profile[k][0]])));for(let j=0;j<N;j++){const a=k*N+j,b=k*N+(j+1)%N;idx.push(...(k===0?[center,b,a]:[center,a,b]));}}}
 mesh(name,mat,p,idx);
}
function beam(name,mat,a,b,w,h=w){
 const z=unit(sub(b,a));const seed=Math.abs(z[1])>.9?[1,0,0]:[0,1,0];const x=unit(cross(seed,z)),y=cross(z,x),c=mul(add(a,b),.5);
 box(name,mat,[0,0,0],[w,h,Math.hypot(...sub(b,a))],v=>add(c,add(mul(x,v[0]),add(mul(y,v[1]),mul(z,v[2])))));
}
function tube(name,mat,c,r,inner,depth,axis='z'){
 const N=32,p=[],idx=[];const tr=v=>axis==='x'?[v[2],v[1],-v[0]]:axis==='aft'?[v[0],v[1],-v[2]]:v;
 const rings=[[-depth/2,r],[depth/2,r],[depth/2,inner],[-depth/2,inner]];
 for(const [z,rad] of rings)for(let j=0;j<N;j++){const a=j/N*TAU;p.push(...add(c,tr([rad*Math.cos(a),rad*Math.sin(a),z])));}
 for(let k=0;k<4;k++)for(let j=0;j<N;j++){const a=k*N+j,b=k*N+(j+1)%N,d=((k+1)%4)*N+(j+1)%N,e=((k+1)%4)*N+j;idx.push(a,b,e,b,d,e);}
 mesh(name,mat,p,idx,false);
}
function nozzle(name,c,r,axis='aft'){
 tube(name+' rim',2,c,r,r*.82,.24,axis);
 tube(name+' cavity',3,add(c,axis==='x'?[-.27,0,0]:[0,0,.27]),r*.83,r*.62,.7,axis);
 const cc=add(c,axis==='x'?[-.6,0,0]:[0,0,.6]);
 loft(name+' dark back',3,[0,0,0],[[-.015,r*.63,r*.63],[.015,r*.63,r*.63]],24,v=>add(cc,axis==='x'?[v[2],v[1],-v[0]]:v));
 sockets.push({name:name.replaceAll(' ','_'),translation:c,axis:axis==='x'?[-1,0,0]:[0,0,-1],kind:'propulsion',enabled:false});
}
function pod(name,c,length,rx,ry){
 const h=length/2;
 const profile=[[-h,rx*.65,ry*.65],[-h+.2,rx*.92,ry*.9],[-h+.55,rx,ry],[h*.4,rx,ry],[h*.75,rx*.85,ry*.86],[h*.96,rx*.45,ry*.5],[h,rx*.13,ry*.18]];
 loft(name,0,c,profile,24);
 for(const z of [-h+.3,0,h*.5]){const [xx,yy]=radiusAt(profile,z);loft(name+' rib',8,add(c,[0,0,z]),[[-.025,xx*1.004,yy*1.004],[.025,xx*1.004,yy*1.004]],24);}
 for(const side of [-1,1])for(let z=-h+.75;z<h*.55;z+=.3){
  box(name+' window',5,add(c,[side*rx*.975,.03,z]),[.035,.12,.16]);
  box(name+' window frame',3,add(c,[side*rx*.95,.03,z]),[.035,.19,.22]);
 }
}
function radiusAt(profile,z){for(let i=1;i<profile.length;i++)if(z<=profile[i][0]){const a=profile[i-1],b=profile[i],t=(z-a[0])/(b[0]-a[0]);return [a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}return profile.at(-1).slice(1);}
function fixture(name,c){box(name,7,c,[.08,.065,.13]);sockets.push({name,translation:c,kind:'navigation',enabled:false});}
function kestrel(){
 loft('Delta hull',0,[0,0,0],[[-4,1.2,.35],[-3.7,2.25,.45],[-2.8,3.9,.48],[-2.1,4.15,.5],[-.8,3.2,.57],[1.1,2.1,.57],[2.8,1.15,.42],[4.2,.48,.23],[4.8,.15,.14]],32);
 loft('Lower keel',1,[0,-.22,.1],[[-3.8,.7,.25],[-2.5,2.4,.35],[0,1.6,.35],[2.7,.7,.2],[4.4,.18,.1]],24);
 loft('Lounge plinth',2,[0,.51,1.05],[[-2,.48,.1],[-1.7,.69,.12],[1.5,.52,.12],[2,.2,.07]],24);
 loft('Glazed passenger lounge',4,[0,.57,1.05],[[-1.9,.38,.05],[-1.55,.59,.26],[-.9,.63,.35],[.6,.56,.32],[1.5,.4,.19],[1.95,.13,.02]],24);
 for(let z=-.2;z<2.7;z+=.42){const [rx,ry]=radiusAt([[-1.9,.38,.05],[-1.55,.59,.26],[-.9,.63,.35],[.6,.56,.32],[1.5,.4,.19],[1.95,.13,.02]],z-1.05);loft('Canopy frame',2,[0,.57,z],[[-.018,rx*1.006,ry*1.006],[.018,rx*1.006,ry*1.006]],24);}
 for(const side of [-1,1]){
  loft('Aft integrated nacelle',1,[side*2.15,.43,-2.45],[[-1.45,.52,.54],[-1.1,.65,.64],[.3,.55,.48],[1.2,.14,.16]],24);
  nozzle('main_nozzle_'+(side<0?'port':'starboard'),[side*2.15,.43,-3.92],.47);
  beam('Wing shoulder rib',2,[side*.5,.18,4],[side*3.9,.18,-2.2],.08,.1);
  beam('Painted wing trim',6,[side*1.25,-.05,2.5],[side*4.02,-.05,-2.2],.045,.055);
  fixture('nav_'+(side<0?'port':'starboard'),[side*4.03,.04,-2.2]);
  for(let z=-1;z<3;z+=.32){const w=1.15+(2.8-z)*.43;box('Cabin side window',5,[side*w,-.05,z],[.06,.09,.16]);}
  for(let z=-2.4;z<1;z+=.6)box('Deck inset panel',1,[side*1.1,.55,z],[.25,.018,.33]);
 }
 fixture('nav_aft',[0,.33,-4]);sockets.push({name:'dock_collar',translation:[0,-.55,.3],axis:[0,-1,0],kind:'docking',enabled:false});
}
function tandem(){
 for(const side of [-1,1]){
  pod('Passenger hull '+side,[side*1.85,0,0],9.4,.76,.64);
  nozzle('main_nozzle_'+(side<0?'port':'starboard'),[side*1.85,0,-4.75],.7);
  for(let z=-3.8;z<2.8;z+=.48)box('Dorsal panel',1,[side*1.85,.643,z],[.76,.018,.34]);
  for(let z of [-1.3,1.1]){tube('Dock collar',2,[side*2.63,-.02,z],.29,.2,.11,'x');box('Dock recess',3,[side*2.64,-.02,z],[.03,.42,.42]);sockets.push({name:'dock_'+(side<0?'port':'starboard')+'_'+z,translation:[side*2.7,0,z],axis:[side,0,0],kind:'docking',enabled:false});}
  fixture('nav_'+(side<0?'port':'starboard'),[side*2.45,.33,3.1]);
 }
 box('Forward passenger bridge',0,[0,.12,1.25],[3.7,.55,1.03]);box('Forward bridge roof',2,[0,.42,1.25],[3.7,.06,1.07]);
 box('Aft bridge',0,[0,.05,-3.25],[3.7,.42,.47]);box('Aft bridge roof',2,[0,.28,-3.25],[3.7,.05,.49]);
 for(let x=-1.2;x<=1.2;x+=.25){box('Bridge cabin window',5,[x,.13,1.78],[.14,.18,.02]);box('Rear bridge cabin window',5,[x,.08,-3.5],[.12,.14,.02]);}
 loft('Observation lounge base',2,[-1.85,.61,2.05],[[-1.3,.48,.04],[-.9,.73,.1],[.7,.59,.09],[1.15,.21,.03]],24);
 loft('Observation lounge glass',4,[-1.85,.67,2.05],[[-1.25,.34,.02],[-.8,.67,.3],[.4,.6,.34],[.95,.32,.15],[1.14,.1,.02]],24);
 for(let z=1.1;z<2.9;z+=.31){const [rx,ry]=radiusAt([[-1.25,.34,.02],[-.8,.67,.3],[.4,.6,.34],[.95,.32,.15],[1.14,.1,.02]],z-2.05);loft('Observation ribs',2,[-1.85,.67,z],[[-.014,rx*1.006,ry*1.006],[.014,rx*1.006,ry*1.006]],24);}
 fixture('nav_aft',[0,.3,-3.5]);
}
function lantern(){
 loft('Central structural spine',8,[0,0,-.5],[[-4,.34,.34],[2.6,.34,.34]],16);
 pod('Forward observation cabin',[0,0,3.05],3.2,.8,.7);
 loft('Bow observation glass',4,[0,0,4.02],[[-.28,.75,.65],[.25,.58,.52],[.57,.2,.21]],24);
 for(const z of [3.95,4.23]){const [rx,ry]=radiusAt([[-.28,.75,.65],[.25,.58,.52],[.57,.2,.21]],z-4.02);loft('Bow glazing rib',2,[0,0,z],[[-.018,rx*1.006,ry*1.006],[.018,rx*1.006,ry*1.006]],24);}
 for(let j=0;j<3;j++){
  const a=Math.PI/2+j*TAU/3;const c=[Math.cos(a)*1.47,Math.sin(a)*1.47,-.15];
  pod('Passenger petal '+(j+1),c,3.5,.67,.63);
  for(const z of [-1.1,.7])beam('Pod connector',2,[0,0,z],[c[0],c[1],z],.22,.27);
  fixture('nav_pod_'+(j+1),add(c,[0,.65,0]));
 }
 const tri=[[0,1.85,-4.2],[-1.6,-.93,-4.2],[1.6,-.93,-4.2]];
 for(let i=0;i<3;i++){beam('Triangular tail frame',2,tri[i],tri[(i+1)%3],.16,.2);beam('Tail support',8,[0,0,-2.6],tri[i],.14,.16);}
 nozzle('main_nozzle',[0,0,-4.24],.78);tube('Engine support ring',8,[0,0,-3.6],.86,.74,.5);
 beam('Spine painted seam',6,[.35,.05,-2.7],[.35,.05,1.7],.035,.04);
 sockets.push({name:'dock_collar',translation:[0,-.72,3.05],axis:[0,-1,0],kind:'docking',enabled:false});
}
function ringSegment(name,mat,start,end,r,thick,height,y=0){
 const steps=Math.max(2,Math.ceil((end-start)*10)),p=[],idx=[];
 const section=[[-thick*.5,-height*.35],[-thick*.35,-height*.5],[thick*.35,-height*.5],[thick*.5,-height*.35],[thick*.5,height*.35],[thick*.35,height*.5],[-thick*.35,height*.5],[-thick*.5,height*.35]];
 for(let k=0;k<=steps;k++){const a=start+(end-start)*k/steps;for(const [dr,dy]of section)p.push((r+dr)*Math.sin(a),dy+y,(r+dr)*Math.cos(a));}
 for(let k=0;k<steps;k++)for(let j=0;j<8;j++){const a=k*8+j,b=k*8+(j+1)%8,d=(k+1)*8+(j+1)%8,e=(k+1)*8+j;idx.push(a,e,b,b,e,d);}
 for(const k of [0,steps])for(let j=1;j<7;j++)idx.push(...(k===0?[k*8,k*8+j,k*8+j+1]:[k*8,k*8+j+1,k*8+j]));
 mesh(name,mat,p,idx);
}
function wayfarer(){
 const begin=Math.PI/4,end=TAU-Math.PI/4,count=14;
 for(let k=0;k<count;k++){
  const a=begin+(end-begin)*k/count,b=begin+(end-begin)*(k+1)/count;
  ringSegment('Concourse module '+k,0,a+.012,b-.012,3.8,1.05,1.02);
  ringSegment('Structural seam '+k,2,a-.015,a+.015,3.8,1.1,1.08);
  ringSegment('Dorsal panel '+k,1,a+.03,b-.03,3.8,.7,.035,.525);
  for(const rr of [3.278,4.322])for(let w=0;w<4;w++){
   const aa=a+.045+(b-a-.09)*w/4,bb=aa+(b-a-.09)/4*.68;
   ringSegment('Concourse window',5,aa,bb,rr,.015,.19,.12);
   ringSegment('Lower window',5,aa,bb,rr,.015,.13,-.19);
  }
  if(k%3===0){const mid=(a+b)/2;fixture('nav_ring_'+k,[3.8*Math.sin(mid),.55,3.8*Math.cos(mid)]);}
 }
 ringSegment('Final structural seam',2,end-.015,end+.015,3.8,1.1,1.08);
 box('Service spine',0,[-4.6,0,-.7],[2.5,.65,2.6]);box('Service roof',2,[-4.6,.34,-.7],[2.5,.035,2.6]);
 for(let j=0;j<3;j++){
  const z=-1.65+j*.95;tube('Dock collar '+j,2,[-5.9,0,z],.43,.32,.27,'x');tube('Dock throat '+j,3,[-5.58,0,z],.35,.28,.45,'x');box('Dock dark back',3,[-5.3,0,z],[.02,.57,.57]);
  sockets.push({name:'dock_collar_'+(j+1),translation:[-6.05,0,z],axis:[-1,0,0],kind:'docking',enabled:false});
 }
 loft('Operations cupola',4,[-3.65,.65,-1.6],[[-.6,.35,.2],[0,.6,.35],[.6,.35,.2]],24);
 for(const a of [begin,end]){const c=[3.8*Math.sin(a),0,3.8*Math.cos(a)];beam('Open end window',5,add(c,[-.22,-.2,0]),add(c,[.22,.2,0]),.05,.14);}
}
function exportModel(id,label,fn){
 parts=[];sockets=[];fn();
 const all=parts.flatMap(p=>p.p),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<all.length;i++) {const a=i%3;min[a]=Math.min(min[a],all[i]);max[a]=Math.max(max[a],all[i]);}
 const center=mul(add(min,max),.5);
 for(const p of parts)for(let i=0;i<p.p.length;i++)p.p[i]-=center[i%3];
 sockets=sockets.map(s=>({...s,translation:sub(s.translation,center)}));
 const buffers=[],views=[],accessors=[];let offset=0;
 const accessor=(arr,type,componentType,target)=>{
  const bytes=Buffer.from(arr.buffer,arr.byteOffset,arr.byteLength);const aligned=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(aligned);buffers.push(aligned);
  const vi=views.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});offset+=aligned.length;
  const dim=type==='VEC3'?3:1;const ac={bufferView:vi,componentType,count:arr.length/dim,type};
  if(type==='VEC3'){ac.min=[Infinity,Infinity,Infinity];ac.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<arr.length;i++){ac.min[i%3]=Math.min(ac.min[i%3],arr[i]);ac.max[i%3]=Math.max(ac.max[i%3],arr[i]);}}
  accessors.push(ac);return accessors.length-1;
 };
 const meshes=[],nodes=[];let triangleCount=0,vertexCount=0;
 // Merge static components per material to keep the draw-call budget small.
 for(let mat=0;mat<materials.length;mat++){
  const group=parts.filter(p=>p.mat===mat);if(!group.length)continue;
  const p=[],n=[],idx=[];for(const part of group){const base=p.length/3;p.push(...part.p);n.push(...part.n);idx.push(...part.idx.map(i=>i+base));}
  const primitive={attributes:{POSITION:accessor(new Float32Array(p),'VEC3',5126,34962),NORMAL:accessor(new Float32Array(n),'VEC3',5126,34962)},indices:accessor(new Uint32Array(idx),'SCALAR',5125,34963),material:mat,mode:4};
  meshes.push({name:materials[mat].name,primitives:[primitive]});nodes.push({name:materials[mat].name,mesh:meshes.length-1});triangleCount+=idx.length/3;vertexCount+=p.length/3;
 }
 const renderNodeCount=nodes.length;
 for(const s of sockets)nodes.push({name:s.name,translation:s.translation,extras:{kind:s.kind,localDirection:s.axis??null,effectEnabled:false,requiresRecordedState:true}});
 const bounds={min:sub(min,center),max:sub(max,center)};
 const doc={asset:{version:'2.0',generator:'Starfare original procedural mesh source v1',copyright:'Original Starfare art study; no third-party mesh inputs'},scene:0,scenes:[{name:label,nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength:offset}],extras:{assetId:id,provenance:'fictional',stage:'game-art first modeling pass',units:'arbitrary art units; not physical scale',forward:'+Z',up:'+Y',pivot:'visual bounds center',effects:'off',geometrySource:'build-models.mjs',reference:'../'+(id==='wayfarer'?'wayfarer-station':id==='kestrel'?'starseeker-01-kestrel':id==='tandem'?'starseeker-02-tandem':'starseeker-03-lantern')+'.png'}};
 const json0=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(json0.length/4)*4,32);json0.copy(json);const bin=Buffer.concat(buffers);
 const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);
 const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
 fs.mkdirSync(path.join(ROOT,'models'),{recursive:true});const out=path.join(ROOT,'models',id+'.glb');fs.writeFileSync(out,Buffer.concat([head,json,bh,bin]));
 return {id,name:label,file:'models/'+id+'.glb',triangles:triangleCount,vertices:vertexCount,renderNodes:renderNodeCount,materialCount:meshes.length,bytes:fs.statSync(out).size,bounds,sockets,provenance:'fictional',effectsEnabled:false};
}
const records=[exportModel('kestrel','Starseeker Kestrel',kestrel),exportModel('tandem','Starseeker Tandem',tandem),exportModel('lantern','Starseeker Lantern',lantern),exportModel('wayfarer','Wayfarer Station',wayfarer)];
fs.writeFileSync(path.join(ROOT,'manifest.json'),JSON.stringify({version:1,format:'glTF 2.0 binary',stage:'first modeling pass',units:'arbitrary art units; rescale explicitly',axes:{up:'+Y',forward:'+Z'},pivot:'bounds center',models:records},null,2)+'\n');
console.log(JSON.stringify(records.map(({id,triangles,vertices,renderNodes,bytes})=>({id,triangles,vertices,renderNodes,bytes})),null,2));
