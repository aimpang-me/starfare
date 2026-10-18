/* Planetary appearance only. Never accepts or modifies a flight, orbit or simulation clock. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarfarePlanetEffects = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var TAU = Math.PI * 2, geometries = new WeakMap(), ringGeometries = new WeakMap();
  // Seconds below are deliberately slow illustration periods, not astronomical spin telemetry.
  // Retain the map's existing .35-radian presentation tilt; anchors live outside that frame.
  var PROFILES = {
    earth: { map:'earth_day_2k.jpg', period:180, air:[.1,.34,.8], shell:1.035, airStrength:.35 },
    moon: { map:'moon_1k.jpg', period:420, rough:1 },
    mercury: { map:'mercury_1k.jpg', period:540, rough:1 },
    venus: { map:'venus_1k.jpg', period:-540, air:[.65,.42,.18], shell:1.045, airStrength:.32, haze:.25 },
    mars: { map:'mars_1k.jpg', period:300, air:[.48,.18,.08], shell:1.022, airStrength:.2 },
    phobos: { map:'phobos_1k.jpg', period:480, rough:1 },
    ceres: { map:'ceres_1k.jpg', period:420, rough:1 },
    bennu: { map:'bennu_1k.jpg', period:480, rough:1 },
    jupiter: { map:'jupiter_2k.jpg', period:240, gas:.009, air:[.28,.22,.16], shell:1.014, airStrength:.14 },
    io: { map:'io_1k.jpg', period:420, rough:1 },
    europa: { map:'europa_1k.jpg', period:480, ice:.08 },
    ganymede: { map:'ganymede_1k.jpg', period:540, ice:.035 },
    callisto: { map:'callisto_1k.jpg', period:600, rough:1 },
    saturn: { map:'saturn_1k.jpg', period:300, gas:.006, air:[.3,.24,.13], shell:1.018, airStrength:.17, ring:true },
    titan: { map:'titan_1k.jpg', period:600, air:[.65,.31,.065], shell:1.07, airStrength:.45, haze:.5 },
    enceladus: { map:'enceladus_1k.jpg', period:480, ice:.1 },
    uranus: { map:'uranus_1k.jpg', period:-420, gas:.002, air:[.09,.32,.36], shell:1.025, airStrength:.2 },
    neptune: { map:'neptune_1k.jpg', period:360, gas:.004, air:[.07,.15,.46], shell:1.025, airStrength:.2 },
    triton: { map:'triton_1k.jpg', period:540, ice:.07 }
  };
  function createClock() {
    var last = null, active = false, elapsed = 0;
    return {
      sample: function (now, enabled) {
        if (!Number.isFinite(now)) return elapsed;
        if (enabled && active && last !== null) elapsed += Math.min(.1, Math.max(0, (now - last) / 1000));
        last = now; active = !!enabled; return elapsed;
      },
      reset: function (now) { last = Number.isFinite(now) ? now : null; active = false; elapsed = 0; }
    };
  }
  function detailAmount(radius) { var x = Math.max(0, Math.min(1, (radius - 24) / 40)); return x * x * (3 - 2 * x); }
  function wantsDetail(previous, radius) { return radius >= 32 || (!!previous && radius > 16); }
  var VS = '#include <common>\n#include <logdepthbuf_pars_vertex>\n' +
    'varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB; varying vec3 vW;\n' +
    'void main(){vUv=uv; vec3 t=abs(normal.y)>.9999?vec3(1.,0.,0.):normalize(vec3(normal.z,0.,-normal.x));' +
    'vN=normalize(mat3(modelMatrix)*normal);vT=normalize(mat3(modelMatrix)*t);vB=normalize(cross(vN,vT));' +
    'vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;\n#include <logdepthbuf_vertex>\n}';
  var HEAD = '#include <common>\n#include <logdepthbuf_pars_fragment>\n' +
    'varying vec2 vUv;varying vec3 vN;varying vec3 vT;varying vec3 vB;varying vec3 vW;' +
    'uniform vec3 lightDirection;uniform vec3 viewDirection;uniform float orthographic;uniform float detail;' +
    'vec3 viewRay(){return normalize(mix(cameraPosition-vW,viewDirection,orthographic));}' +
    'vec3 linearColor(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}' +
    'vec3 displayColor(vec3 c){return pow(max(c,vec3(0.)),vec3(1./2.2));}\n';
  var SURFACE = HEAD +
    'uniform sampler2D day;uniform sampler2D night;uniform sampler2D relief;uniform sampler2D ocean;uniform sampler2D clouds;' +
    'uniform float normalReady;uniform float oceanReady;uniform float cloudReady;uniform float cloudShift;' +
    'uniform float time;uniform float gas;uniform float ice;uniform float rough;uniform float haze;uniform vec3 airColor;' +
    '\n#ifdef RINGS\nuniform sampler2D ringMap;uniform float ringReady;uniform vec3 ringNormal;uniform vec3 center;uniform float bodyRadius;\n#endif\n' +
    'void main(){\n#include <logdepthbuf_fragment>\n' +
    'vec3 N=normalize(vN),L=normalize(lightDirection),V=viewRay();vec3 n=texture2D(relief,vUv).xyz*2.-1.;' +
    'float polar=smoothstep(.02,.16,sin(vUv.y*3.14159265));' +
    'n=normalize(mix(vec3(0.,0.,1.),n,normalReady*detail*polar));N=normalize(vT*n.x+vB*n.y+N*n.z);' +
    'float d=dot(N,L),sun=max(d,0.);vec2 uv=vUv;' +
    'uv.x=fract(uv.x+gas*detail*sin(time/90.)*sin(uv.y*18.8495559)*pow(sin(uv.y*3.14159265),2.));' +
    'vec3 color=linearColor(texture2D(day,uv).rgb);' +
    '\n#ifdef RINGS\n' +
    'vec3 p=(vW-center)/bodyRadius;float den=dot(L,ringNormal);' +
    'if(abs(den)>.0001){float t=-dot(p,ringNormal)/den;float rr=length(p+t*L);' +
    'if(t>0.&&rr>1.24&&rr<2.27){float opacity=texture2D(ringMap,vec2((rr-1.24)/1.03,.5)).a*ringReady;sun*=1.-opacity*.78;}}' +
    '\n#endif\n' +
    '\n#ifdef EARTH\n' +
    'vec2 cuv=vec2(fract(vUv.x+cloudShift),vUv.y);' +
    'vec2 shadowOffset=vec2(dot(L,vT),dot(L,vB))*.0035/max(dot(normalize(vN),L),.18);' +
    'float cover=smoothstep(.12,.85,texture2D(clouds,cuv+shadowOffset).r)*cloudReady*detail;' +
    'vec3 col=color*(.012+1.08*sun)*(1.-cover*.38);' +
    'float water=texture2D(ocean,vUv).r*oceanReady;' +
    'float glint=pow(max(dot(N,normalize(L+V)),0.),96.)*water*sun*.6;' +
    'col+=vec3(.92,.97,1.)*glint;' +
    'float nightSide=1.-smoothstep(-.18,.06,d);' +
    'col+=linearColor(texture2D(night,vUv).rgb)*vec3(1.,.82,.58)*2.2*nightSide*(1.-cover*.82);' +
    'float air=pow(1.-max(dot(normalize(vN),V),0.),4.)*smoothstep(-.2,.45,dot(normalize(vN),L));' +
    'col+=vec3(.025,.095,.24)*air*detail;' +
    '\n#else\n' +
    'float diffuse=mix(sun,pow(sun,.82),rough*.35);vec3 col=color*(.012+.98*diffuse);' +
    'float edge=pow(1.-max(dot(normalize(vN),V),0.),3.);' +
    'col+=airColor*edge*smoothstep(-.15,.55,d)*detail*.22;' +
    'col=mix(col,airColor*(.025+.65*sun),haze*edge*detail*.45);' +
    'col+=vec3(.65,.78,.85)*pow(max(dot(N,normalize(L+V)),0.),24.)*ice*sun*detail;' +
    '\n#endif\n' +
    'gl_FragColor=vec4(displayColor(col),1.);}';
  var CLOUD = HEAD + 'uniform sampler2D clouds;uniform float cloudReady;\n' +
    'void main(){\n#include <logdepthbuf_fragment>\n' +
    'float a=smoothstep(.12,.88,texture2D(clouds,vUv).r)*.91*cloudReady*detail;' +
    'float d=dot(normalize(vN),normalize(lightDirection));vec3 col=displayColor(vec3(.012+max(d,0.)*.95));' +
    'gl_FragColor=vec4(col,a);}';
  var ATMOSPHERE = HEAD + 'uniform vec3 airColor;uniform float airStrength;\nvoid main(){\n#include <logdepthbuf_fragment>\n' +
    'vec3 N=normalize(vN),V=viewRay();float edge=pow(clamp(-dot(N,V)*3.,0.,1.),2.);' +
    'float lit=.025+.975*smoothstep(-.3,.55,dot(N,normalize(lightDirection)));' +
    'gl_FragColor=vec4(airColor*edge*lit,edge*airStrength*detail);}';
  var RING = HEAD + 'uniform sampler2D ringMap;uniform vec3 center;uniform float bodyRadius;uniform vec3 ringNormal;\n' +
    'void main(){\n#include <logdepthbuf_fragment>\n' +
    'vec4 map=texture2D(ringMap,vUv);vec3 p=(vW-center)/bodyRadius,L=normalize(lightDirection);' +
    'float t=-dot(p,L),miss=length(p+max(t,0.)*L);float shadow=t>0.?1.-smoothstep(.97,1.03,miss):0.;' +
    'float lit=.16+.84*sqrt(abs(dot(normalize(ringNormal),L)))*(1.-shadow*.96);' +
    'gl_FragColor=vec4(displayColor(linearColor(map.rgb)*vec3(.85,.8,.7)*lit),map.a*.92);}';
  var SOLAR = HEAD + 'uniform sampler2D day;uniform float time;\nvoid main(){\n#include <logdepthbuf_fragment>\n' +
    'vec2 uv=vUv;float pole=pow(sin(uv.y*3.14159265),2.);uv.x=fract(uv.x+.0015*detail*pole*sin(time/60.+uv.y*12.));' +
    'vec3 N=normalize(vN);float cell=sin(N.x*31.+time*.025)*sin(N.y*37.-time*.017)*sin(N.z*29.+time*.021);' +
    'float limb=.78+.22*pow(max(dot(N,viewRay()),0.),.35);' +
    'gl_FragColor=vec4(texture2D(day,uv).rgb*vec3(1.6,1.35,1.05)*limb*(1.+cell*.025*detail),1.);}';
  function imageReady(t) { return !!(t && t.image && t.image.width && t.image.height && !(t.userData && t.userData.failed)); }
  function createBody(T, id, services) {
    var profile = PROFILES[id]; if (!profile) return null;
    if (id === 'earth' && services.maxTextures != null && services.maxTextures < 5) return null;
    var geo = geometries.get(T);
    if (!geo) { geo = new T.SphereGeometry(1, 64, 32); geometries.set(T, geo); }
    var root = new T.Group(), tilt = new T.Group(); tilt.rotation.z = .35; root.add(tilt);
    var uniforms = {
      day: { value: services.texture(profile.map) },
      night: { value: id === 'earth' ? services.texture('earth_lights_2k.jpg') : null },
      relief: { value: null }, ocean: { value: null }, clouds: { value: null },
      normalReady: { value: 0 }, oceanReady: { value: 0 }, cloudReady: { value: 0 }, cloudShift: { value: 0 },
      lightDirection: { value: new T.Vector3(1, 0, 0) }, viewDirection: { value: new T.Vector3(0, 0, 1) },
      orthographic: { value: 0 }, detail: { value: 0 }, time: { value: 0 },
      gas: { value: profile.gas || 0 }, ice: { value: profile.ice || 0 }, rough: { value: profile.rough || 0 }, haze: { value: profile.haze || 0 },
      airColor: { value: new T.Vector3().fromArray(profile.air || [0,0,0]) }, airStrength: { value: profile.airStrength || 0 },
      ringMap: { value: profile.ring ? services.texture('saturn_ring_1k.webp') : null },
      ringReady: { value: 0 },
      ringNormal: { value: new T.Vector3(0,1,0) }, center: { value: new T.Vector3() }, bodyRadius: { value: 1 }
    };
    var surface = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: uniforms, defines: id === 'earth' ? { EARTH: 1 } : profile.ring ? { RINGS: 1 } : {}, vertexShader: VS, fragmentShader: SURFACE }));
    tilt.add(surface);
    var cloud = null, atmosphere = null;
    if (id === 'earth') {
      cloud = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: uniforms, vertexShader: VS, fragmentShader: CLOUD, transparent: true, depthWrite: false }));
      cloud.scale.setScalar(1.007); cloud.renderOrder = 1; tilt.add(cloud);
    }
    if (profile.air) {
      atmosphere = new T.Mesh(geo, new T.ShaderMaterial({ uniforms: uniforms, vertexShader: VS, fragmentShader: ATMOSPHERE, transparent: true, depthWrite: false, side: T.BackSide, blending: T.AdditiveBlending }));
      atmosphere.scale.setScalar(profile.shell); atmosphere.renderOrder = 2; tilt.add(atmosphere);
    }
    var ring = null;
    if (profile.ring) {
      var rg = ringGeometries.get(T);
      if (!rg) {
        rg = new T.RingGeometry(1.24,2.27,128,1); var p=rg.attributes.position,uv=rg.attributes.uv;
        for(var i=0;i<p.count;i++) uv.setXY(i,(Math.hypot(p.getX(i),p.getY(i))-1.24)/1.03,.5);
        ringGeometries.set(T,rg);
      }
      ring = new T.Mesh(rg,new T.ShaderMaterial({uniforms:uniforms,vertexShader:VS,fragmentShader:RING,transparent:true,depthWrite:false,side:T.DoubleSide}));
      ring.rotation.x=-Math.PI/2+.47; ring.renderOrder=1; tilt.add(ring);
    }
    root.userData.textured = true;
    root.userData.planetEffects = { id: id, profile:profile, uniforms: uniforms, surface: surface, cloud: cloud, atmosphere: atmosphere, ring:ring, services: services, wanted: false, tier: null, center: new T.Vector3(), scale:new T.Vector3(), disposed: false };
    return root;
  }
  function createSun(T, services) {
    var geo=geometries.get(T); if(!geo){geo=new T.SphereGeometry(1,64,32);geometries.set(T,geo);}
    var u={day:{value:services.texture('sun_1k.jpg')},time:{value:0},detail:{value:0},viewDirection:{value:new T.Vector3(0,0,1)},orthographic:{value:0}};
    var root=new T.Group(), surface=new T.Mesh(geo,new T.ShaderMaterial({uniforms:u,vertexShader:VS,fragmentShader:SOLAR}));root.add(surface);
    root.userData.planetEffects={id:'sun',uniforms:u,surface:surface,profile:{period:720},disposed:false}; return root;
  }
  function update(body, context) {
    var e = body && body.userData.planetEffects; if (!e || e.disposed) return;
    var u = e.uniforms, radius = Math.max(0, context.radiusPx || 0), sec = context.elapsedSeconds || 0;
    e.surface.rotation.y = sec * TAU / e.profile.period; u.time.value=sec;
    if (context.camera) {
      context.camera.getWorldDirection(u.viewDirection.value).negate();
      u.orthographic.value = context.camera.isOrthographicCamera ? 1 : 0;
    }
    u.detail.value = detailAmount(radius);
    if(e.id==='sun') return;
    if (e.cloud) { e.cloud.rotation.y = sec * TAU / 240; u.cloudShift.value = sec * (1 / 180 - 1 / 240); }
    e.wanted = wantsDetail(e.wanted, radius);
    var tier = context.quality === 'desktop' ? '2k' : '1k';
    if (e.wanted && e.tier !== tier && (e.id==='earth'||e.id==='moon')) {
      e.tier = tier;
      u.relief.value = e.services.texture(e.id === 'earth' ? 'earth_normal_' + tier + '.png' : 'moon_normal_1k.png');
      if (e.id === 'earth') { u.clouds.value = e.services.texture('earth_clouds_' + tier + '.webp'); u.ocean.value = e.services.texture('earth_ocean_1k.png'); }
    }
    u.normalReady.value = imageReady(u.relief.value) ? 1 : 0;
    u.oceanReady.value = imageReady(u.ocean.value) ? 1 : 0;
    u.cloudReady.value = imageReady(u.clouds.value) ? 1 : 0;
    body.updateWorldMatrix(true, false); body.getWorldPosition(e.center);
    u.lightDirection.value.copy(e.services.sun.value).sub(e.center).normalize();
    if(e.ring){u.ringReady.value=imageReady(u.ringMap.value)?1:0;e.ring.visible=!!u.ringReady.value;e.ring.updateWorldMatrix(true,false);u.ringNormal.value.set(0,0,1).transformDirection(e.ring.matrixWorld);u.center.value.copy(e.center);body.getWorldScale(e.scale);u.bodyRadius.value=e.scale.x;}
    if (e.cloud) e.cloud.visible = !!(u.cloudReady.value && u.detail.value);
    if (e.atmosphere) e.atmosphere.visible = u.detail.value > 0;
  }
  // CPU counterpart of the analytic planet-on-ring shadow, for opposite-Sun regression checks.
  function ringShadowAt(p,l) {
    var len=Math.hypot(l[0],l[1],l[2]),d=l.map(function(v){return v/len;}),t=-(p[0]*d[0]+p[1]*d[1]+p[2]*d[2]);
    if(t<=0)return 0;var miss=Math.hypot(p[0]+t*d[0],p[1]+t*d[1],p[2]+t*d[2]),x=Math.max(0,Math.min(1,(miss-.97)/.06));return 1-x*x*(3-2*x);
  }
  function dispose(body) {
    var e = body && body.userData.planetEffects; if (!e || e.disposed) return;
    e.disposed = true;
    body.traverse(function (o) { if (o.material) o.material.dispose(); });
    // Geometry and loaded maps are shared, bounded page-lifetime caches, never owned by an instance.
  }
  return { createClock: createClock, createBody: createBody, createSun:createSun, update: update, dispose: dispose, detailAmount: detailAmount, wantsDetail: wantsDetail, ringShadowAt:ringShadowAt };
});
