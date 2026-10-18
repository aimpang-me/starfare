/* glTF 2.0 / Starfare Three.js r128 review and native PNG exporter. */
(async function(){
const T=THREE,canvas=document.querySelector('canvas'),renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true,logarithmicDepthBuffer:true});
renderer.setSize(1024,1024,false);renderer.setClearColor(0x000000,0);renderer.outputEncoding=T.sRGBEncoding;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.01,1000),pivot=new T.Group();scene.add(pivot);
const lights=new T.Group();scene.add(lights);const ambient=new T.AmbientLight(0xd5e5ff,.06);lights.add(ambient);
function key(c,i,x,y,z){const l=new T.DirectionalLight(c,i);l.position.set(x,y,z);lights.add(l);if(x===-3){l.castShadow=true;l.shadow.mapSize.set(4096,4096);l.shadow.camera.left=l.shadow.camera.bottom=-10;l.shadow.camera.right=l.shadow.camera.top=10;l.shadow.camera.near=.1;l.shadow.camera.far=40;l.shadow.bias=-.0001;l.shadow.normalBias=.001;}return l;}
key(0xffe2b8,1.5,-3,7,-4);key(0x9eb3c7,.10,-5,3,-2);key(0xc7dcff,.65,4,3,7);
// Reflection cards illuminate metallic surfaces without adding painted highlights to the texture.
const envScene=new T.Scene();envScene.background=new T.Color(.025,.035,.05);
for(const [p,s,c] of [[[0,7,0],[12,.1,12],0x536578],[[7,1,0],[.1,6,10],0x202a35],[[-7,2,-3],[.1,4,8],0x526e89]]){const o=new T.Mesh(new T.BoxGeometry(...s),new T.MeshBasicMaterial({color:c}));o.position.set(...p);envScene.add(o);}
const pmrem=new T.PMREMGenerator(renderer),env=pmrem.fromScene(envScene,.04).texture;scene.environment=env;
const manifest=window.EMBEDDED_MANIFEST||await (await fetch('manifest.json')).json(),cache={};let id,object,radius=1,yaw=.62,pitch=.48,mode='studio',zoom=1,look=new T.Vector3();
const concepts={kestrel:'starseeker-01-kestrel.png',tandem:'starseeker-02-tandem.png',lantern:'starseeker-03-lantern.png',wayfarer:'wayfarer-station.png','kestrel-low':'starseeker-01-kestrel.png'};
function render(){camera.position.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(radius*3.9*zoom).add(look);camera.lookAt(look);camera.updateMatrixWorld();renderer.render(scene,camera);}
async function load(next,url){if(url)delete cache[next];if(!cache[next])cache[next]=(await new T.GLTFLoader().loadAsync(url||window.EMBEDDED_MODELS?.[next]||'models/'+next+'.glb')).scene;cache[next].traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true;if(o.material.transparent)o.material.depthWrite=false;}});if(object)pivot.remove(object);id=next;object=cache[next];pivot.add(object);radius=new T.Box3().setFromObject(object).getSize(new T.Vector3()).length()/2;camera.far=radius*50;camera.updateProjectionMatrix();document.querySelector('#concept').src=window.EMBEDDED_CONCEPTS?.[next]||'concept/'+concepts[next];const m=manifest.models.find(m=>m.id===id);document.querySelector('#caption').textContent=m.name+' · '+m.triangles.toLocaleString()+' triangles · PBR textured GLB';view('portrait');window.assetReady=next;return stats();}
function view(v){zoom=v==='portrait'?.9:1;look.set(0,0,0);[yaw,pitch]=({portrait:[1.02,.66],top:[0,Math.PI/2-.001],side:[Math.PI/2,.08],rear:[Math.PI,.12]})[v];render();}
function detail(){const focus={tandem:[-1.14,.38,.4],kestrel:[.95,.1,.5],'kestrel-low':[.95,.1,.5],lantern:[0,.0,-1.15],wayfarer:[2.8,0,-1.8]};look.set(...focus[id]);zoom=.43;yaw=.8;pitch=.6;render();}
function lighting(){mode=mode==='studio'?'engine':'studio';lights.visible=mode==='studio';engineLight.visible=mode==='engine';scene.environment=mode==='studio'?env:null;renderer.outputEncoding=mode==='studio'?T.sRGBEncoding:T.LinearEncoding;document.querySelector('#light').textContent='Lighting: '+mode;render();}
const engineLight=new T.Group();engineLight.add(new T.AmbientLight(0xffffff,.17));const sun=new T.PointLight(0xfff1dc,1.45,0);sun.position.set(10,6,10);engineLight.add(sun);engineLight.visible=false;scene.add(engineLight);
function stats(){let meshes=0,textured=0,normal=0,uv=0;object.traverse(o=>{if(o.isMesh){meshes++;if(o.material.map)textured++;if(o.material.normalMap)normal++;if(o.geometry.attributes.uv)uv++;}});return {id,revision:T.REVISION,meshes,textured,normal,uv,yaw,pitch,glError:renderer.getContext().getError(),info:JSON.parse(JSON.stringify(renderer.info.render))};}
for(const m of manifest.models){const b=document.createElement('button');b.textContent=m.name;b.onclick=()=>load(m.id);document.querySelector('#models').appendChild(b);}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));document.querySelector('#light').onclick=lighting;document.querySelector('#detail').onclick=detail;
function png(size=1024){renderer.setSize(size,size,false);render();const data=canvas.toDataURL('image/png');renderer.setSize(1024,1024,false);render();return data;}
document.querySelector('#save').onclick=()=>{const a=document.createElement('a');a.download=id+'.png';a.href=png();a.click();};let drag;
canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=()=>drag=null;canvas.onpointermove=e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*.008;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];render();};canvas.onkeydown=e=>{if(e.key==='ArrowLeft')yaw-=.15;else if(e.key==='ArrowRight')yaw+=.15;else if(e.key==='ArrowUp')pitch=Math.min(1.5,pitch+.15);else if(e.key==='ArrowDown')pitch=Math.max(-1.5,pitch-.15);else return;e.preventDefault();render();};
canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(.25,Math.min(1.8,zoom*Math.exp(e.deltaY*.001)));render();};
window.assetReview={load,view,stats,png,render,lighting,detail};await load('kestrel');
})();
