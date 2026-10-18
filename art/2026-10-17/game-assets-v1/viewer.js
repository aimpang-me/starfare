// Minimal glTF 2.0 static-mesh viewer for this package; no external scripts or network services.
const canvas=document.querySelector('#view');
const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:true,premultipliedAlpha:false});
if(!gl)throw new Error('WebGL 2 unavailable. Use the supplied PNG previews.');
const vertex=`#version 300 es
in vec3 position;in vec3 normal;uniform mat4 projection;uniform mat4 view;out vec3 N;out vec3 P;
void main(){N=normal;P=position;gl_Position=projection*view*vec4(position,1.);}`;
const fragment=`#version 300 es
precision highp float;in vec3 N;in vec3 P;uniform vec3 color;uniform vec3 eye;uniform float roughness;uniform float metal;out vec4 outputColor;
void main(){vec3 n=normalize(N),v=normalize(eye-P),l=normalize(vec3(-.45,1.,.8)),l2=normalize(vec3(.8,.3,-.7));float ndl=max(dot(n,l),0.);float fill=max(dot(n,l2),0.);vec3 h=normalize(l+v);float spec=pow(max(dot(n,h),0.),mix(100.,10.,roughness));vec3 f0=mix(vec3(.04),color,metal);float rim=pow(1.-max(dot(n,v),0.),3.);vec3 c=color*(.48+1.5*ndl+.55*fill)+f0*spec*.85+color*rim*.24;c=c/(vec3(1.)+c*.35);outputColor=vec4(pow(max(c,vec3(0.)),vec3(1./2.2)),1.);}`;
function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const U=Object.fromEntries(['projection','view','color','eye','roughness','metal'].map(k=>[k,gl.getUniformLocation(program,k)]));
const unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n)};const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function lookAt(eye){const z=unit(eye),x=unit(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
function ortho(size){const near=.1,far=100;return new Float32Array([1/size,0,0,0,0,1/size,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1]);}
let meshes=[],yaw=.7,pitch=.6,zoom=1,current=null,manifest=null,loadToken=0;
function readAccessor(doc,bin,index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],count=a.count*(a.type==='VEC3'?3:1),off=v.byteOffset+(a.byteOffset||0);return a.componentType===5126?new Float32Array(bin,off,count):a.componentType===5125?new Uint32Array(bin,off,count):new Uint16Array(bin,off,count);}
async function loadModel(id){
 const token=++loadToken;const record=manifest.models.find(m=>m.id===id);if(!record)throw Error('Unknown model');
 let data;if(window.STARFARE_PACKAGED_DATA){data=Uint8Array.from(atob(window.STARFARE_PACKAGED_DATA.models[id]),c=>c.charCodeAt(0)).buffer;}else{const response=await fetch(record.file);if(!response.ok)throw Error('Could not load model');data=await response.arrayBuffer();}const header=new DataView(data);if(header.getUint32(0,true)!==0x46546c67)throw Error('Bad GLB magic');
 const jl=header.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,jl))),bin=data.slice(28+jl);if(token!==loadToken)return;
 for(const mesh of meshes){gl.deleteVertexArray(mesh.vao);for(const b of mesh.buffers)gl.deleteBuffer(b);}meshes=[];
 for(const node of doc.nodes){if(node.mesh===undefined)continue;for(const primitive of doc.meshes[node.mesh].primitives){
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
  for(const [attr,key] of [['position','POSITION'],['normal','NORMAL']]){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,readAccessor(doc,bin,primitive.attributes[key]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(program,attr);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);}
  const indices=readAccessor(doc,bin,primitive.indices);const ib=gl.createBuffer();buffers.push(ib);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
  meshes.push({vao,buffers,count:indices.length,type:indices instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT,mat:doc.materials[primitive.material].pbrMetallicRoughness});
 }}
 current=record;setView('portrait');document.querySelector('#name').textContent=record.name;document.querySelector('#download').href=window.STARFARE_PACKAGED_DATA?'data:model/gltf-binary;base64,'+window.STARFARE_PACKAGED_DATA.models[id]:record.file;document.querySelector('#download').download=id+'.glb';
 document.querySelector('#stats').innerHTML=`<dt>Geometry</dt><dd>${record.triangles.toLocaleString()} triangles · ${record.renderNodes} material groups</dd><dt>Self-contained file</dt><dd>${(record.bytes/1024).toFixed(0)} KB · no external textures</dd><dt>Coordinates</dt><dd>+Y up · +Z forward<br>Centered pivot · arbitrary art units</dd><dt>Effect attachment points</dt><dd>${record.sockets.length} named sockets · effects off</dd>`;
 for(const button of document.querySelectorAll('[data-model]'))button.setAttribute('aria-pressed',String(button.dataset.model===id));
 window.assetReady=id;return record;
}
function render(){if(!current)return;const extent=Math.max(...current.bounds.max.map((v,i)=>v-current.bounds.min[i]));const eye=[Math.sin(yaw)*Math.cos(pitch)*22,Math.sin(pitch)*22,Math.cos(yaw)*Math.cos(pitch)*22];gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.uniformMatrix4fv(U.projection,false,ortho(extent*.64*zoom));gl.uniformMatrix4fv(U.view,false,lookAt(eye));gl.uniform3fv(U.eye,eye);for(const mesh of meshes){gl.bindVertexArray(mesh.vao);gl.uniform3fv(U.color,mesh.mat.baseColorFactor.slice(0,3));gl.uniform1f(U.metal,mesh.mat.metallicFactor);gl.uniform1f(U.roughness,mesh.mat.roughnessFactor);gl.drawElements(gl.TRIANGLES,mesh.count,mesh.type,0);}gl.finish();}
function setView(name){[yaw,pitch]=({portrait:[.7,.6],top:[0,Math.PI/2-.0001],side:[Math.PI/2,0],rear:[Math.PI,.2]})[name]??[.7,.6];zoom=1;render();}
let drag=null;canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*.007;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-drag[1])*.007));drag=[e.clientX,e.clientY];render();});
canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(e.key==='ArrowUp')pitch=Math.min(1.5,pitch+.12);if(e.key==='ArrowDown')pitch=Math.max(-1.5,pitch-.12);if(e.key==='+'||e.key==='=')zoom=Math.max(.65,zoom-.1);if(e.key==='-')zoom=Math.min(2,zoom+.1);render();});
for(const b of document.querySelectorAll('[data-model]'))b.addEventListener('click',()=>loadModel(b.dataset.model).catch(showError));for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>setView(b.dataset.view));
let bg=0;document.querySelector('#bg').onclick=()=>{bg=(bg+1)%3;document.querySelector('#stage').className='stage '+['','checker','light'][bg];document.querySelector('#bg').textContent='Background: '+['navy','checker','light'][bg];};
document.querySelector('#png').onclick=()=>{render();const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=current.id+'-view.png';a.click();};
function showError(e){document.querySelector('#error').textContent=e.message;console.error(e);}
// Used only by the local export/check script; captures the loaded GLB geometry.
window.assetReview={load:loadModel,view:setView,render,exportPNG:()=>{render();return canvas.toDataURL('image/png')},get state(){return {id:current?.id,yaw,pitch,zoom,drawCalls:meshes.length,glError:gl.getError()}}};
try{manifest=window.STARFARE_PACKAGED_DATA?.manifest??await fetch('manifest.json').then(r=>r.json());await loadModel('tandem');}catch(e){showError(e);}
