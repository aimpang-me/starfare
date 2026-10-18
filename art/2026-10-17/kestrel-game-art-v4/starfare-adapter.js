/* Explicit, opt-in integration. Load after THREE r128 + GLTFLoader; await load() before creating ships. */
(function(root){
 const ids=['kestrel','kestrel-low'],templates={},sharedTextures=new Map();let ready;
 function load(base){if(ready)return ready;const loader=new THREE.GLTFLoader();return ready=Promise.all(ids.map(async id=>{
  const gltf=await loader.loadAsync(base.replace(/\/$/,'')+'/'+id+'.glb');
  gltf.scene.traverse(o=>{if(!o.isMesh)return;for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap']){const tex=o.material[key];if(!tex)continue;const tag=tex.name+'|'+tex.encoding+'|'+tex.flipY;const old=sharedTextures.get(tag);if(old)o.material[key]=old;else sharedTextures.set(tag,tex);}
   // A single transparent shell is sufficient for these enclosed glazing surfaces.
   if(o.material.transparent)o.material.depthWrite=false;
  });templates[id]=gltf.scene;
 }));}
 function create(id='kestrel',options={}){if(!templates[id])throw new Error('Await StarfareAssets.load() before creating '+id);const g=new THREE.Group(),model=templates[id].clone(true),size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(1/(id==='wayfarer'?Math.max(size.x,size.y,size.z):size.z));g.add(model);g.name='Starfare '+id;g.userData.assetId=id;g.userData.provenance='fictional';g.userData.effectsEnabled=false;g.userData.callsign=options.callsign||null;
  g.userData.update=function(time,flying,reduced){/* Generic flying is not recorded burn telemetry. No effects are emitted. */};return g;}
 function install(solArt,choose){const previous=solArt.ship;solArt.ship=opt=>create(choose?choose(opt):'kestrel',opt);return ()=>{solArt.ship=previous;};}
 function configureOutput(renderer,post){
  // opt-in final conversion: glTF color textures decode to linear; encode after bloom, before perceptual grain/vignette.
  if(post&&post.composer){if(post.starfareOutput)return post.starfareOutput;
   const pass=new THREE.ShaderPass({uniforms:{tDiffuse:{value:null}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 x=max(c.rgb,vec3(0.0));vec3 lo=x*12.92;vec3 hi=1.055*pow(x,vec3(1.0/2.4))-0.055;gl_FragColor=vec4(mix(lo,hi,step(vec3(0.0031308),x)),c.a);}'});
   const clear=renderer.getClearColor(new THREE.Color()).clone().convertSRGBToLinear();renderer.setClearColor(clear,renderer.getClearAlpha());
   const index=post.post?post.composer.passes.indexOf(post.post):-1;
   if(index>=0)post.composer.insertPass(pass,index);else post.composer.addPass(pass);post.starfareOutput=pass;return pass;
  }renderer.outputEncoding=THREE.sRGBEncoding;return null;
 }
 function dispose(){Object.values(templates).forEach(g=>g.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}}));sharedTextures.forEach(t=>t.dispose());sharedTextures.clear();Object.keys(templates).forEach(k=>delete templates[k]);ready=null;}
 root.StarfareAssets={load,create,install,configureOutput,dispose,ids};
})(window);
