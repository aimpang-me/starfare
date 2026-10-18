/* Load after Starfare's THREE r128 and GLTFLoader. A loaded model is required. */
(function(root){
 const ids=['kestrel'],templates={},textures=new Set(),geometries=new Set(),materials=new Set();let ready;
 function load(base){if(ready)return ready;const loader=new THREE.GLTFLoader();return ready=Promise.all(ids.map(async id=>{
  const gltf=await loader.loadAsync(base.replace(/\/$/,'')+'/'+id+'.glb');
  gltf.scene.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);for(const m of [].concat(o.material)){materials.add(m);for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'])if(m[key])textures.add(m[key]);if(m.transparent)m.depthWrite=false;}});
  templates[id]=gltf.scene;
 }));}
 function create(id='kestrel',options={}){if(!templates[id])throw new Error('Await StarfareAssets.load() before creating '+id);const g=new THREE.Group(),model=templates[id].clone(true),size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(1/size.z);g.add(model);g.name='Starfare '+id;g.userData.assetId=id;g.userData.provenance='Higgsfield generated; fictional spacecraft';g.userData.effectsEnabled=false;g.userData.callsign=options.callsign||null;
  g.userData.update=function(time,flying,reduced){};return g;
 }
 function install(solArt,choose){const previous=solArt.ship;solArt.ship=opt=>create(choose?choose(opt):'kestrel',opt);return ()=>{solArt.ship=previous;};}
 function configureOutput(renderer,post){
  if(post&&post.composer){if(post.starfareOutput)return post.starfareOutput;
   const pass=new THREE.ShaderPass({uniforms:{tDiffuse:{value:null}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 x=max(c.rgb,vec3(0.0));vec3 lo=x*12.92;vec3 hi=1.055*pow(x,vec3(1.0/2.4))-0.055;gl_FragColor=vec4(mix(lo,hi,step(vec3(0.0031308),x)),c.a);}'});
   renderer.setClearColor(renderer.getClearColor(new THREE.Color()).clone().convertSRGBToLinear(),renderer.getClearAlpha());const index=post.post?post.composer.passes.indexOf(post.post):-1;if(index>=0)post.composer.insertPass(pass,index);else post.composer.addPass(pass);post.starfareOutput=pass;return pass;
  }renderer.outputEncoding=THREE.sRGBEncoding;return null;
 }
 function dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());geometries.clear();materials.clear();textures.clear();Object.keys(templates).forEach(k=>delete templates[k]);ready=null;}
 root.StarfareAssets={load,create,install,configureOutput,dispose,ids};
})(window);
