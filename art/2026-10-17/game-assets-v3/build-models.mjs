// Original Starfare model source. Node built-ins only; no installed packages required.
import fs from 'node:fs';
import {installDetail} from './detail-geometry.mjs';
import {detailedModels} from './detail-models.mjs';
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
for(const i of [0,1]){materials[i].pbrMetallicRoughness={baseColorFactor:i===0?[.38,.44,.53,1]:[.22,.28,.38,1],baseColorTexture:{index:0},metallicRoughnessTexture:{index:2},metallicFactor:.32,roughnessFactor:.78};materials[i].normalTexture={index:1,scale:.16};materials[i].occlusionTexture={index:4,strength:.85};}
materials[2].pbrMetallicRoughness={baseColorFactor:[.61,.65,.7,1],baseColorTexture:{index:3},metallicFactor:.85,roughnessFactor:.34};
materials[8].pbrMetallicRoughness={baseColorFactor:[.25,.3,.38,1],baseColorTexture:{index:3},metallicFactor:.7,roughnessFactor:.4};
materials[4]={name:'Smoked panoramic glazing',pbrMetallicRoughness:{baseColorFactor:[.025,.035,.045,.42],metallicFactor:.06,roughnessFactor:.13},alphaMode:'BLEND',doubleSided:true,emissiveFactor:[0,0,0]};
materials[5]={name:'Warm static cabin windows',pbrMetallicRoughness:{baseColorFactor:[.38,.2,.065,1],metallicFactor:.05,roughnessFactor:.3},emissiveFactor:[.12,.05,.012]};
materials.push({name:'Interior upholstery',pbrMetallicRoughness:{baseColorFactor:[.24,.12,.052,1],metallicFactor:0,roughnessFactor:.8},emissiveFactor:[.025,.009,.001]});
materials.push({name:'Interior warm ceiling',pbrMetallicRoughness:{baseColorFactor:[.5,.3,.11,1],metallicFactor:0,roughnessFactor:.8},emissiveFactor:[.26,.13,.045]});
materials.push({name:'Interior floor',pbrMetallicRoughness:{baseColorFactor:[.047,.035,.025,1],metallicFactor:.1,roughnessFactor:.8},emissiveFactor:[0,0,0]});
let parts=[],sockets=[];
function mesh(name,mat,p,idx,smooth=true,uv=null){
 if(!smooth){const pp=[],ii=[],uu=[];for(const v of idx){pp.push(...p.slice(v*3,v*3+3));if(uv)uu.push(...uv.slice(v*2,v*2+2));ii.push(ii.length);}p=pp;idx=ii;if(uv)uv=uu;}
 const n=new Array(p.length).fill(0);
 for(let k=0;k<idx.length;k+=3){const [a,b,c]=idx.slice(k,k+3).map(i=>p.slice(i*3,i*3+3));const normal=cross(sub(b,a),sub(c,a));for(const v of idx.slice(k,k+3))for(let j=0;j<3;j++)n[v*3+j]+=normal[j];}
 for(let k=0;k<n.length;k+=3)n.splice(k,3,...unit(n.slice(k,k+3)));
 if(!uv){uv=[];for(let i=0;i<p.length;i+=3){const nn=n.slice(i,i+3).map(Math.abs),axis=nn.indexOf(Math.max(...nn));uv.push(axis===0?p[i+2]*.18+.5:p[i]*.18+.5,axis===1?p[i+2]*.18+.5:p[i+1]*.18+.5);}}
 parts.push({name,mat,p,n,idx,uv});
}
function box(name,mat,c,s,transform=p=>p){
 const p=[],idx=[];const corners=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
 for(const v of corners)p.push(...transform(add(c,v.map((x,i)=>x*s[i]/2))));
 for(const f of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])idx.push(f[0],f[1],f[2],f[0],f[2],f[3]);
 mesh(name,mat,p,idx,false);
}
function loft(name,mat,c,profile,N=40,transform=p=>p,cap=true,power=.72){
 const p=[],idx=[],uv=[],stride=N+1;
 for(const [z,rx,ry] of profile)for(let j=0;j<=N;j++){const a=j/N*TAU-Math.PI/2,co=Math.cos(a),si=Math.sin(a);p.push(...transform(add(c,[Math.sign(co)*Math.abs(co)**power*rx,Math.sign(si)*Math.abs(si)**power*ry,z])));uv.push(j/N,(z-profile[0][0])/(profile.at(-1)[0]-profile[0][0]));}
 for(let k=0;k<profile.length-1;k++)for(let j=0;j<N;j++){const a=k*stride+j,b=a+1,d=(k+1)*stride+j+1,e=d-1;idx.push(a,b,e,b,d,e);}
 if(cap){for(const k of [0,profile.length-1]){const center=p.length/3;p.push(...transform(add(c,[0,0,profile[k][0]])));uv.push(.5,k===0?0:1);for(let j=0;j<N;j++){const a=k*stride+j,b=a+1;idx.push(...(k===0?[center,b,a]:[center,a,b]));}}}
 mesh(name,mat,p,idx,true,uv);
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
  nozzle('main_nozzle_'+(side>0?'port':'starboard'),[side*2.15,.43,-3.92],.47);
  beam('Wing shoulder rib',2,[side*.5,.18,4],[side*3.9,.18,-2.2],.08,.1);
  beam('Painted wing trim',6,[side*1.25,-.05,2.5],[side*4.02,-.05,-2.2],.045,.055);
  fixture('nav_'+(side>0?'port':'starboard'),[side*4.03,.04,-2.2]);
  for(let z=-1;z<3;z+=.32){const w=1.15+(2.8-z)*.43;box('Cabin side window',5,[side*w,-.05,z],[.06,.09,.16]);}
  for(let z=-2.4;z<1;z+=.6)box('Deck inset panel',1,[side*1.1,.55,z],[.25,.018,.33]);
 }
 fixture('nav_aft',[0,.33,-4]);sockets.push({name:'dock_collar',translation:[0,-.55,.3],axis:[0,-1,0],kind:'docking',enabled:false});
}
function tandem(){
 for(const side of [-1,1]){
  pod('Passenger hull '+side,[side*1.85,0,0],9.4,.76,.64);
  nozzle('main_nozzle_'+(side>0?'port':'starboard'),[side*1.85,0,-4.75],.7);
  for(let z=-3.8;z<2.8;z+=.48)box('Dorsal panel',1,[side*1.85,.643,z],[.76,.018,.34]);
  for(let z of [-1.3,1.1]){tube('Dock collar',2,[side*2.63,-.02,z],.29,.2,.11,'x');box('Dock recess',3,[side*2.64,-.02,z],[.03,.42,.42]);sockets.push({name:'dock_'+(side>0?'port':'starboard')+'_'+z,translation:[side*2.7,0,z],axis:[side,0,0],kind:'docking',enabled:false});}
  fixture('nav_'+(side>0?'port':'starboard'),[side*2.45,.33,3.1]);
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
function bevelBox(name,mat,c,s,bevel=.06){
 const b=Math.min(bevel,...s.map(x=>x*.3)),z=s[2]/2,rx=s[0]/2,ry=s[1]/2;
 loft(name,mat,c,[[-z,rx-b,ry-b],[-z+b,rx,ry],[z-b,rx,ry],[z,rx-b,ry-b]],12,p=>p,true,.25);
}
function frames(name,c,profile,step=.4,half=true){
 for(let z=profile[0][0]+.2;z<profile.at(-1)[0]-.15;z+=step){const [rx,ry]=radiusAt(profile,z),N=32,p=[],idx=[];for(const dz of [-.018,.018])for(let j=0;j<=N;j++){const a=(half?Math.PI:TAU)*j/N;p.push(c[0]+Math.cos(a)*rx*1.008,c[1]+Math.sin(a)*ry*1.008,c[2]+z+dz);}for(let j=0;j<N;j++){const a=j,b=j+1,e=N+1+j,d=e+1;idx.push(a,b,e,b,d,e);}mesh(name,2,p,idx);}
}
function lounge(name,c,length,width,height){
 const h=length/2,profile=[[-h,width*.28,height*.12],[-h*.8,width*.82,height*.7],[-h*.5,width,height],[h*.5,width,height],[h*.82,width*.8,height*.65],[h,width*.28,height*.1]],N=32,p=[],idx=[],uv=[];
 for(let k=0;k<profile.length;k++){const [z,rx,ry]=profile[k];for(let j=0;j<=N;j++){const a=Math.PI*j/N;p.push(c[0]+rx*Math.cos(a),c[1]+ry*Math.sin(a),c[2]+z);uv.push(j/N,k/(profile.length-1));}}
 for(let k=0;k<profile.length-1;k++)for(let j=0;j<N;j++){const a=k*(N+1)+j,b=a+1,e=(k+1)*(N+1)+j,d=e+1;idx.push(a,b,e,b,d,e);}mesh(name+' glazing',4,p,idx,true,uv);
 bevelBox(name+' floor',11,[c[0],c[1]+.015,c[2]],[width*1.7,.055,length*.84],.02);
 frames(name+' mullions',c,profile,.48,true);
 loft(name+' opaque roof crown',0,[c[0],c[1]+height*.94,c[2]], [[-h*.53,width*.18,.025],[-h*.36,width*.48,.045],[h*.36,width*.48,.045],[h*.53,width*.18,.025]],32,p=>p,true,.65);
 for(const side of [-1,1]) beam(name+' crown edge',8,[c[0]+side*width*.4,c[1]+height*.97,c[2]-h*.36],[c[0]+side*width*.4,c[1]+height*.97,c[2]+h*.36],.025,.025);
 for(const side of [-1,1]){beam(name+' sill',2,[c[0]+side*width*.9,c[1],c[2]-h*.7],[c[0]+side*width*.9,c[1],c[2]+h*.7],.045,.07);beam(name+' interior light rail',10,[c[0]+side*width*.76,c[1]+.04,c[2]-h*.7],[c[0]+side*width*.76,c[1]+.04,c[2]+h*.7],.022,.025);}
 for(let z=-h*.42;z<h*.48;z+=.4)for(const side of [-1,1]){const x=c[0]+side*width*.43;bevelBox('Passenger seat',9,[x,c[1]+height*.18,c[2]+z],[width*.48,height*.21,.24],.035);bevelBox('Passenger seat back',9,[x,c[1]+height*.38,c[2]+z-.12],[width*.48,height*.38,.08],.025);}
}
function cabinWindows(name,c,profile,length){
 for(const side of [-1,1])for(let z=-length*.34;z<length*.32;z+=.28){if(name==='Forward cabin'&&z>.6)continue;if(Math.round((z+length*.34)/.28)%9===4)continue;const [rx,ry]=radiusAt(profile,z),x=side*(rx+.008);bevelBox(name+' surround',3,add(c,[x,0,z]),[.028,ry*.23,.205],.01);box(name+' amber glass',5,add(c,[x+side*.02,0,z]),[.012,ry*.1,.14]);}
}
function passengerHull(name,c,length,rx,ry){
 const h=length/2,profile=[[-h,rx*.79,ry*.79],[-h+.12,rx*.92,ry*.95],[-h+.45,rx,ry],[h*.34,rx,ry],[h*.55,rx*.97,ry*.96],[h*.78,rx*.8,ry*.76],[h*.96,rx*.44,ry*.45],[h,rx*.25,ry*.27]];
 const mainProfile=name==='Forward cabin'?[...profile.filter(p=>p[0]<.65),[.65,...radiusAt(profile,.65)]]:profile;
 loft(name,0,c,mainProfile,48,p=>p,true,.65);cabinWindows(name,c,profile,length);
 for(const z of [-h+.2,-h+.48,h*.56,h*.83]){if(name==='Forward cabin'&&z>.6)continue;const [w,hg]=radiusAt(profile,z);loft(name+' structural collar',2,add(c,[0,0,z]),[[-.028,w*1.004,hg*1.004],[.028,w*1.004,hg*1.004]],48,p=>p,true,.65);}
 for(const side of [-1,1])beam(name+' waist trim',6,add(c,[side*rx*.998,-.16,-h+.6]),add(c,[side*rx*.998,-.16,h*.4]),.018,.026);
 D.hull(c,profile,length,name.includes('Forward')?513:name.length*19,(a,z)=>!(name==='Forward cabin'&&z>.65)&&!(name.startsWith('Long passenger')&&(Math.abs(z-1.2)<.66||Math.abs(z+3.45)<.29)));
 D.shoulder(c,profile,-h+.65,.35);
 return profile;
}
function kestrelV2(){
 const profile=[[-4,1.2,.31],[-3.7,2.25,.39],[-2.8,3.9,.39],[-2.1,4.15,.4],[-.8,3.2,.47],[1.1,2.1,.46],[2.8,1.15,.34],[4.2,.48,.22],[4.8,.17,.16]];
 loft('Broad delta navy shell',0,[0,0,0],profile,64,p=>p,true,.62);
 loft('Brushed perimeter band',2,[0,-.19,0],profile.map(([z,x,y])=>[z,x*1.006,y*.49]),64,p=>p,true,.65);
 loft('Graphite underside keel',1,[0,-.3,0],[[-3.8,1,.16],[-2.7,2.7,.2],[0,1.8,.23],[3,.72,.15],[4.5,.2,.07]],48,p=>p,true,.6);
 lounge('Panoramic lounge',[0,.39,1],4.5,.61,.46);
 for(const side of [-1,1]){
  const x=side*2.18;
  loft('Rising aft shroud',0,[x,.43,-2.45],[[-1.45,.62,.78],[-1.17,.67,.79],[.1,.54,.35],[1.23,.13,.05]],48,p=>p,true,.28);
  loft('Aft shroud silver rim',2,[x,.43,-3.91],[[-.035,.625,.78],[.035,.625,.78]],48,p=>p,true,.28);
  bevelBox('Dark rectangular propulsion recess',3,[x,.43,-3.965],[1.02,1.3,.045],.1);
  for(let y=-.05;y<1.02;y+=.12)bevelBox('Recess louver',8,[x,y,-4.0],[.87,.025,.065],.01);
  sockets.push({name:'main_nozzle_'+(side>0?'port':'starboard'),translation:[x,.43,-4.05],axis:[0,0,-1],kind:'propulsion',enabled:false});
  for(let z=-1.4;z<3.3;z+=.27){const [rx]=radiusAt(profile,z);box('Warm flank window',5,[side*(rx+.005),-.01,z],[.018,.075,.15]);}
  beam('Cyan painted wing seam',6,[side*1.25,-.03,2.6],[side*4.05,-.03,-2.2],.025,.03);
  fixture('nav_'+(side>0?'port':'starboard'),[side*4.04,.02,-2.22]);
  for(const z of [-1.2,.1,1.1])bevelBox('Dorsal service hatch',1,[side*.95,.46,z],[.35,.025,.5],.03);
 }
 sockets.push({name:'dock_collar',translation:[0,-.52,.2],axis:[0,-1,0],kind:'docking',enabled:false});fixture('nav_aft',[0,.21,-4.01]);
}
function tandemV2(){
 for(const side of [-1,1]){
  passengerHull('Long passenger hull '+side,[side*1.9,0,0],10,.91,.69);
 for(const [z,len] of [[1.2,1.24],[-3.45,.52]]){
  const ps=[],ix=[],uv=[];for(let k=0;k<2;k++)for(let j=0;j<=32;j++){const a=.08+(Math.PI-.16)*j/32;ps.push(side*1.9+Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.65*.918,Math.sin(a)**.65*.704,z+(k-.5)*len);uv.push(j/32,k);}for(let j=0;j<32;j++)ix.push(j,j+1,j+33,j+1,j+34,j+33);mesh('Wraparound bridge shoulder armor',2,ps,ix,true,uv);
  for(const dx of [-.45,.45])bevelBox('Armor access panel',8,[side*1.9+dx,.65,z],[.22,.055,len*.68],.03);
 }

  nozzle('main_nozzle_'+(side>0?'port':'starboard'),[side*1.9,0,-5.05],.79);

  for(const z of [-1.55,1.05]){const x=side*2.83;bevelBox('Dock square surround',2,[x,0,z],[.14,.56,.64],.05);bevelBox('Dock dark recessed collar',3,[x+side*.08,0,z],[.02,.4,.48],.04);tube('Dock circular rim',8,[x+side*.1,0,z],.17,.13,.025,'x');sockets.push({name:'dock_'+(side>0?'port':'starboard')+'_'+z,translation:[x+side*.13,0,z],axis:[side,0,0],kind:'docking',enabled:false});}
  fixture('nav_'+(side>0?'port':'starboard'),[side*2.65,.28,3.4]);
 }
 bevelBox('Forward lounge bridge',0,[0,.12,1.2],[3.8,.56,1.22],.12);bevelBox('Bridge silver capping',2,[0,.415,1.2],[3.8,.06,1.21],.025);
 bevelBox('Aft bridge',0,[0,.05,-3.45],[3.8,.42,.54],.09);bevelBox('Aft bridge cap',2,[0,.28,-3.45],[3.8,.055,.51],.025);
 for(let x=-.85;x<1;x+=.2){box('Bridge warm window',5,[x,.08,1.816],[.14,.2,.012]);box('Aft bridge warm window',5,[x,.03,-3.725],[.14,.15,.01]);}
 lounge('Observation promenade',[-1.9,.64,2.1],3.2,.74,.56);
 fixture('nav_aft',[0,.29,-3.45]);
}
function lanternV2(){
 loft('Structural spine',8,[0,0,-.35],[[-4,.29,.29],[2.5,.29,.29]],32);
 passengerHull('Forward cabin',[0,0,3.05],3.35,.86,.72);
 const noseProfile=[[.65,.845,.71],[.95,.81,.67],[1.3,.67,.54],[1.6,.41,.35],[1.675,.215,.194]];
 loft('Wraparound bow cabin glazing',4,[0,0,3.05],noseProfile,48,p=>p,true,.65);
 for(const z of [.65,1.12,1.55]){const [w,h]=radiusAt(noseProfile,z);loft('Bow pressure ring',2,[0,0,3.05+z],[[-.022,w*1.006,h*1.006],[.022,w*1.006,h*1.006]],48,p=>p,false,.65);}
 const noseMap=D.hullMap([0,0,3.05],noseProfile,.65);
 for(const a of [.1,Math.PI/2,Math.PI-.1,Math.PI*1.5])D.pipe([D.point(noseMap,a,.67,.01),D.point(noseMap,a,1.12,.01),D.point(noseMap,a,1.55,.01)],.021,16);
 bevelBox('Bow cabin warm floor',19,[0,-.18,4.08],[1.08,.045,.75],.025);
 for(const side of [-1,1])for(const z of [3.9,4.15]){bevelBox('Bow cabin seat',9,[side*.29,-.1,z],[.21,.13,.19],.03);bevelBox('Bow cabin backrest',9,[side*.29,.06,z-.08],[.21,.22,.06],.02);}

 for(let j=0;j<3;j++){
  const a=Math.PI/2+j*TAU/3,c=[Math.cos(a)*1.56,Math.sin(a)*1.56,-.12];
  const start=parts.length;passengerHull('Enclosed passenger petal '+(j+1),c,3.65,.81,.67);
  const radial=[Math.cos(a),Math.sin(a)],tangent=[-radial[1],radial[0]];
  for(const p of parts.slice(start))for(let i=0;i<p.p.length;i+=3){
   const x=p.p[i]-c[0],y=p.p[i+1]-c[1],rr=(x*radial[0]+y*radial[1])*1.3,tt=(x*tangent[0]+y*tangent[1])*.72;
   p.p[i]=c[0]+radial[0]*rr+tangent[0]*tt;p.p[i+1]=c[1]+radial[1]*rr+tangent[1]*tt;
   const nr=(p.n[i]*radial[0]+p.n[i+1]*radial[1])/1.3,nt=(p.n[i]*tangent[0]+p.n[i+1]*tangent[1])/.72,n=unit([radial[0]*nr+tangent[0]*nt,radial[1]*nr+tangent[1]*nt,p.n[i+2]]);p.n.splice(i,3,...n);
  }
  for(const z of [-1.25,.8])beam('Pod structural pylon',2,[0,0,z],[c[0],c[1],z],.23,.27);
  fixture('nav_pod_'+(j+1),add(c,[0,.68,0]));
 }
 const tri=[[0,1.92,-4.3],[-1.67,-.97,-4.3],[1.67,-.97,-4.3]];
 for(let i=0;i<3;i++){beam('Triangular tail pale edge',2,tri[i],tri[(i+1)%3],.2,.22);beam('Tail inner graphite',1,add(tri[i],[0,0,.04]),add(tri[(i+1)%3],[0,0,.04]),.13,.28);beam('Tail structural strut',8,[0,0,-2.65],tri[i],.13,.15);}
 nozzle('main_nozzle',[0,0,-4.34],.79);tube('Dark drive housing',1,[0,0,-3.65],.83,.68,.8);
 beam('Cyan painted spine',6,[.3,.06,-2.7],[.3,.06,1.6],.026,.03);sockets.push({name:'dock_collar',translation:[0,-.74,3.1],axis:[0,-1,0],kind:'docking',enabled:false});
}
function wayfarerV2(){
 const begin=Math.PI/4,end=TAU-Math.PI/4,count=16;
 for(let k=0;k<count;k++){
  const a=begin+(end-begin)*k/count,b=begin+(end-begin)*(k+1)/count;
  ringSegment('Curved navy concourse',0,a+.009,b-.009,3.8,1.16,1.18);
  ringSegment('Broad brushed structural rib',2,a-.017,a+.017,3.8,1.2,1.22);
  ringSegment('Upper hull cap',1,a+.03,b-.03,3.8,.78,.04,.605);
  for(const rr of [3.217,4.383]){
   ringSegment('Recessed continuous glass band',3,a+.03,b-.03,rr,.02,.48,.02);
   for(let w=0;w<5;w++){const aa=a+.044+(b-a-.088)*w/5,bb=aa+(b-a-.088)/5*.78;ringSegment('Warm passenger window',5,aa,bb,rr+(rr<3.8?-.014:.014),.011,.18,.145);ringSegment('Lower warm passenger window',5,aa,bb,rr+(rr<3.8?-.014:.014),.011,.14,-.15);}
   ringSegment('Glazing lower sill',2,a+.026,b-.026,rr,.024,.025,-.258);
  }
  if(k%4===0){const mid=(a+b)/2;fixture('nav_ring_'+k,[3.8*Math.sin(mid),.64,3.8*Math.cos(mid)]);}
 }
 ringSegment('End structural rib',2,end-.018,end+.018,3.8,1.2,1.22);
 bevelBox('Offset service spine',0,[-4.7,.02,-.7],[2.6,.7,2.65],.14);
 for(const z of [-1.65,-.7,.25]){bevelBox('Service channel cap',1,[-4.65,.39,z],[2.45,.1,.52],.05);tube('Berth rim',2,[-6.03,0,z],.43,.33,.25,'x');tube('Berth throat',3,[-5.72,0,z],.34,.28,.55,'x');box('Unoccupied berth dark back',3,[-5.4,0,z],[.02,.56,.56]);sockets.push({name:'dock_collar_'+z,translation:[-6.18,0,z],axis:[-1,0,0],kind:'docking',enabled:false});}
 lounge('Station lookout',[-3.77,.58,-1.4],1.25,.55,.38);
 for(const a of [begin,end]){const c=[3.8*Math.sin(a),0,3.8*Math.cos(a)],xdir=[Math.sin(a),0,Math.cos(a)];for(let y=-.3;y<=.3;y+=.19)beam('Open concourse end window',5,add(add(c,mul(xdir,-.25)),[0,y,0]),add(add(c,mul(xdir,.25)),[0,y,0]),.09,.08);}
}
function exportModel(id,label,fn){
 parts=[];sockets=[];D.reset();fn();
 const all=parts.flatMap(p=>p.p),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<all.length;i++) {const a=i%3;min[a]=Math.min(min[a],all[i]);max[a]=Math.max(max[a],all[i]);}
 const center=mul(add(min,max),.5);
 for(const p of parts)for(let i=0;i<p.p.length;i++)p.p[i]-=center[i%3];
 sockets=sockets.map(s=>({...s,translation:sub(s.translation,center)}));
 const buffers=[],views=[],accessors=[];let offset=0;
 const accessor=(arr,type,componentType,target)=>{
  const bytes=Buffer.from(arr.buffer,arr.byteOffset,arr.byteLength);const aligned=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(aligned);buffers.push(aligned);
  const vi=views.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});offset+=aligned.length;
  const dim=type==='VEC3'?3:type==='VEC2'?2:1;const ac={bufferView:vi,componentType,count:arr.length/dim,type};
  if(type==='VEC3'){ac.min=[Infinity,Infinity,Infinity];ac.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<arr.length;i++){ac.min[i%3]=Math.min(ac.min[i%3],arr[i]);ac.max[i%3]=Math.max(ac.max[i%3],arr[i]);}}
  accessors.push(ac);return accessors.length-1;
 };
 const meshes=[],nodes=[];let triangleCount=0,vertexCount=0;
 // Merge static components per material to keep the draw-call budget small.
 for(let mat=0;mat<materials.length;mat++){
  const group=parts.filter(p=>p.mat===mat);if(!group.length)continue;
  const p=[],n=[],uv=[],idx=[];for(const part of group){const base=p.length/3;p.push(...part.p);n.push(...part.n);uv.push(...part.uv);idx.push(...part.idx.map(i=>i+base));}
  const primitive={attributes:{POSITION:accessor(new Float32Array(p),'VEC3',5126,34962),NORMAL:accessor(new Float32Array(n),'VEC3',5126,34962),TEXCOORD_0:accessor(new Float32Array(uv),'VEC2',5126,34962)},indices:accessor(new Uint32Array(idx),'SCALAR',5125,34963),material:mat,mode:4};
  meshes.push({name:materials[mat].name,primitives:[primitive]});nodes.push({name:materials[mat].name,mesh:meshes.length-1});triangleCount+=idx.length/3;vertexCount+=p.length/3;
 }
 const renderNodeCount=nodes.length;
 for(const s of sockets)nodes.push({name:s.name,translation:s.translation,extras:{kind:s.kind,localDirection:s.axis??null,effectEnabled:false,requiresRecordedState:true}});
 const bounds={min:sub(min,center),max:sub(max,center)};
 const imageNames=['hull-basecolor.png','hull-normal.png','hull-metalrough.png','alloy-basecolor.png','hull-occlusion.png'];const images=imageNames.map(name=>{const bytes=fs.readFileSync(path.join(ROOT,'textures',name)),aligned=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(aligned);const vi=views.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length});buffers.push(aligned);offset+=aligned.length;return {name,bufferView:vi,mimeType:'image/png'};});
 const doc={asset:{version:'2.0',generator:'Starfare detail refinement v3',copyright:'Original Starfare mesh; built-in generated surface maps'},scene:0,scenes:[{name:label,nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials,images,textures:images.map((_,source)=>({source,sampler:0})),samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],accessors,bufferViews:views,buffers:[{byteLength:offset}],extras:{assetId:id,provenance:'fictional',stage:'fitted armor and mechanical detail',units:'arbitrary art units; not physical scale',forward:'+Z',up:'+Y',pivot:'visual bounds center',effects:'navigation and propulsion off; static cabin emission only',geometrySource:'build-models.mjs',reference:'../'+(id==='wayfarer'?'wayfarer-station':id==='kestrel'?'starseeker-01-kestrel':id==='tandem'?'starseeker-02-tandem':'starseeker-03-lantern')+'.png'}};
 const json0=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(json0.length/4)*4,32);json0.copy(json);const bin=Buffer.concat(buffers);
 const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);
 const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
 fs.mkdirSync(path.join(ROOT,'models'),{recursive:true});const out=path.join(ROOT,'models',id+'.glb');fs.writeFileSync(out,Buffer.concat([head,json,bh,bin]));
 return {id,name:label,file:'models/'+id+'.glb',triangles:triangleCount,vertices:vertexCount,renderNodes:renderNodeCount,materialCount:meshes.length,bytes:fs.statSync(out).size,bounds,sockets,provenance:'fictional',effectsEnabled:false,detailFeatures:D.stats()};
}
const api={mesh,materials,add,sub,mul,cross,unit,box,beam,tube,loft,ringSegment,bevelBox,radiusAt,passengerHull,lounge,nozzle,fixture,kestrelV2,tandemV2,lanternV2,getParts:()=>parts,getSockets:()=>sockets};
const D=installDetail(api),M=detailedModels(api,D);
const records=[exportModel('kestrel','Starseeker Kestrel',M.kestrel),exportModel('tandem','Starseeker Tandem',M.tandem),exportModel('lantern','Starseeker Lantern',M.lantern),exportModel('wayfarer','Wayfarer Station',M.wayfarer)];
fs.writeFileSync(path.join(ROOT,'manifest.json'),JSON.stringify({version:3,format:'glTF 2.0 binary',stage:'fitted armor and mechanical detail',units:'arbitrary art units; rescale explicitly',axes:{up:'+Y',forward:'+Z'},pivot:'bounds center',models:records},null,2)+'\n');
console.log(JSON.stringify(records.map(({id,triangles,vertices,renderNodes,bytes})=>({id,triangles,vertices,renderNodes,bytes})),null,2));
