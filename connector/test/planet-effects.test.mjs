import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
let Effects;
try { Effects = require('../../design/assets/planet-effects.js'); } catch { Effects = {}; }

test('visual time advances slowly, freezes and resumes without catching up', () => {
  assert.equal(typeof Effects.createClock, 'function');
  const c = Effects.createClock();
  assert.equal(c.sample(0, true), 0);
  assert.equal(c.sample(50, true), .05);
  assert.equal(c.sample(100, false), .05);
  assert.equal(c.sample(90000, false), .05);
  assert.equal(c.sample(90050, true), .05);
  assert.ok(Math.abs(c.sample(90100, true) - .1) < 1e-10);
  assert.ok(Math.abs(c.sample(190100, true) - .2) < 1e-10);
});
test('seek/reset is deterministic and each page owns its clock', () => {
  const a = Effects.createClock(), b = Effects.createClock();
  a.sample(0, true); a.sample(100, true);
  assert.equal(b.sample(100, true), 0);
  a.reset(500); assert.equal(a.sample(500, true), 0);
  assert.equal(a.sample(600, true), .1);
});
test('reduced-motion/static sampling never animates', () => {
  const c = Effects.createClock();
  for (const t of [0, 100, 200, 50000]) assert.equal(c.sample(t, false), 0);
});
test('detail has a smooth ramp and does not request texture layers at overview size', () => {
  assert.equal(Effects.detailAmount(8), 0);
  assert.equal(Effects.detailAmount(24), 0);
  assert.ok(Effects.detailAmount(40) > 0 && Effects.detailAmount(40) < 1);
  assert.equal(Effects.detailAmount(64), 1);
  assert.equal(Effects.wantsDetail(false, 24), false);
  assert.equal(Effects.wantsDetail(false, 32), true);
  assert.equal(Effects.wantsDetail(true, 24), true);
  assert.equal(Effects.wantsDetail(true, 16), false);
});

let threePromise;
async function three() {
  if (!threePromise) threePromise = (async () => {
    const html = readFileSync(new URL('../src/site.html', import.meta.url), 'utf8');
    const tag = html.match(/<script src="([^"]*three\.min\.js)"[^>]*integrity="(sha384|sha512)-([^"]+)"/);
    const response = await fetch(tag[1], { signal: AbortSignal.timeout(20000) }); assert.ok(response.ok);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash(tag[2]).update(bytes).digest('base64'), tag[3]);
    const module = { exports: {} }; vm.runInNewContext(bytes.toString(), { module, exports: module.exports });
    return module.exports;
  })();
  return threePromise;
}
test('appearance changes only surface children, keeping root and external anchors intact', async () => {
  assert.equal(typeof Effects.createBody, 'function');
  const T = await three(), textures = new Map(), requested = [];
  const texture = f => { requested.push(f); if (!textures.has(f)) textures.set(f, new T.Texture()); return textures.get(f); };
  const body = Effects.createBody(T, 'earth', { texture, sun: { value: new T.Vector3() } });
  body.position.set(12, 5, -8); body.scale.setScalar(.85);
  const anchor = new T.Object3D(); anchor.position.set(0, 2, 0); body.add(anchor); body.updateMatrixWorld();
  const before = anchor.getWorldPosition(new T.Vector3()).toArray(), root = body.matrixWorld.toArray();
  Effects.update(body, { elapsedSeconds: 30, camera: new T.OrthographicCamera(), radiusPx: 8, quality: 'overview' });
  body.updateMatrixWorld();
  assert.deepEqual(body.matrixWorld.toArray(), root);
  assert.deepEqual(anchor.getWorldPosition(new T.Vector3()).toArray(), before);
  assert.equal(body.userData.planetEffects.surface.rotation.y, 30 * Math.PI * 2 / 180);
  assert.equal(requested.some(f => /normal|cloud|ocean/.test(f)), false);
  Effects.update(body, { elapsedSeconds: 30, camera: new T.OrthographicCamera(), radiusPx: 100, quality: 'desktop' });
  assert.ok(requested.some(f => /cloud/.test(f)));
  assert.ok(requested.some(f => /normal/.test(f)));
  assert.ok(requested.some(f => /ocean/.test(f)));
  assert.equal(body.userData.planetEffects.surface.rotation.y, 30 * Math.PI * 2 / 180);
  assert.equal(body.userData.planetEffects.uniforms.normalReady.value, 0, 'missing image uses base lighting');
  const sibling = Effects.createBody(T, 'earth', { texture, sun: { value: new T.Vector3() } });
  const shared = textures.get('earth_day_2k.jpg'); let disposed = false; shared.addEventListener('dispose', () => { disposed = true; });
  Effects.dispose(body); assert.equal(disposed, false); assert.ok(sibling.children.length);
});
test('Moon is matte relief without atmosphere; unknown bodies use the existing fallback', async () => {
  const T = await three(), texture = () => new T.Texture();
  const body = Effects.createBody(T, 'moon', { texture, sun: { value: new T.Vector3() } });
  assert.equal(body.userData.planetEffects.atmosphere, null);
  assert.equal(Effects.createBody(T, 'unknown', { texture, sun: { value: new T.Vector3() } }), null);
  Effects.update(body, { elapsedSeconds: 0, camera: new T.PerspectiveCamera(), radiusPx: 100, quality: 'mobile' });
  assert.equal(body.userData.planetEffects.uniforms.orthographic.value, 0);
});
test('all mapped worlds have bounded, distinct profiles and preserve their external anchors', async () => {
  const T = await three(), ids = ['mercury','venus','mars','phobos','ceres','bennu','jupiter','io','europa','ganymede','callisto','saturn','titan','enceladus','uranus','neptune','triton'];
  const texture = () => new T.Texture(), sun = {value:new T.Vector3(20,3,4)};
  for (const id of ids) {
    const b = Effects.createBody(T,id,{texture,sun}); assert.ok(b, id);
    b.position.set(2,3,4); b.scale.setScalar(2);
    const a = new T.Object3D(); a.position.y=3; b.add(a); b.updateMatrixWorld();
    const before = a.getWorldPosition(new T.Vector3()).toArray();
    Effects.update(b,{elapsedSeconds:40,camera:new T.OrthographicCamera(),radiusPx:100,quality:'desktop'});
    b.updateMatrixWorld(); assert.deepEqual(a.getWorldPosition(new T.Vector3()).toArray(),before,id);
    const e=b.userData.planetEffects; assert.ok(Number.isFinite(e.surface.rotation.y));
    assert.equal(!!e.atmosphere,['venus','mars','titan','jupiter','saturn','uranus','neptune'].includes(id),id);
    assert.equal(e.uniforms.normalReady.value,0,'no invented terrain for '+id);
    if(id==='saturn') { const frame=e.ring.matrixWorld.toArray(); Effects.update(b,{elapsedSeconds:80,radiusPx:100,quality:'mobile'}); b.updateMatrixWorld(); assert.deepEqual(e.ring.matrixWorld.toArray(),frame); }
    Effects.dispose(b); Effects.dispose(b);
  }
});
test('Mars shows its 2K colour map only once loaded, on the desktop tier, with MOLA relief on every tier', async () => {
  const T = await three(), sun = { value: new T.Vector3(20, 3, 4) };
  function mars(quality) {
    const textures = new Map(), texture = f => { if (!textures.has(f)) textures.set(f, new T.Texture()); return textures.get(f); };
    const body = Effects.createBody(T, 'mars', { texture, sun }), u = body.userData.planetEffects.uniforms;
    const frame = () => Effects.update(body, { elapsedSeconds: 0, camera: new T.PerspectiveCamera(), radiusPx: 100, quality });
    return { textures, u, frame };
  }
  const desk = mars('desktop');
  assert.equal(desk.u.day.value, desk.textures.get('mars_1k.jpg'));
  desk.frame();
  assert.equal(desk.u.relief.value, desk.textures.get('mars_normal_1k.png'));
  assert.equal(desk.u.day.value, desk.textures.get('mars_1k.jpg'), 'the 2K map is still loading');
  desk.textures.get('mars_2k.jpg').image = { width: 2048, height: 1024 };
  desk.frame();
  assert.equal(desk.u.day.value, desk.textures.get('mars_2k.jpg'));
  const phone = mars('mobile');
  phone.frame();
  assert.equal(phone.u.relief.value, phone.textures.get('mars_normal_1k.png'));
  assert.deepEqual([...phone.textures.keys()].sort(), ['mars_1k.jpg', 'mars_normal_1k.png']);
});
test('Saturn casts opposite ring shadows as the Sun moves, with a clear light-facing side', () => {
  assert.equal(typeof Effects.ringShadowAt,'function');
  assert.ok(Effects.ringShadowAt([-1.5,0,0],[1,.1,0])>.95);
  assert.equal(Effects.ringShadowAt([1.5,0,0],[1,.1,0]),0);
  assert.ok(Effects.ringShadowAt([1.5,0,0],[-1,.1,0])>.95);
  assert.equal(Effects.ringShadowAt([0,0,2],[1,.1,0]),0);
});
test('the Sun effect has a stable silhouette and a deterministic static phase', async () => {
  const T=await three(), body=Effects.createSun(T,{texture:()=>new T.Texture()});
  body.scale.setScalar(3); const scale=body.scale.toArray();
  Effects.update(body,{elapsedSeconds:10,radiusPx:100,quality:'desktop'});
  const phase=body.userData.planetEffects.uniforms.time.value;
  Effects.update(body,{elapsedSeconds:10,radiusPx:100,quality:'mobile'});
  assert.equal(body.userData.planetEffects.uniforms.time.value,phase); assert.deepEqual(body.scale.toArray(),scale);
  Effects.dispose(body);
});
test('same-flight rebuild preserves the paused cosmetic clock; a new flight starts at zero', () => {
  const html=readFileSync(new URL('../src/flight.html',import.meta.url),'utf8');
  const source=html.slice(html.indexOf('function loadRide(keep)'),html.indexOf('function placeK('));
  const rp={start:0,end:10,focus:'earth',record:{hail_id:'x'},events:[],plan:[]};
  const el={value:'1',setAttribute(){}};
  const ctx={RS:null,RIDE:{record:{},lg:{}},SF:{replay:()=>rp,name:x=>x,SHIP:'Ship'},
    window:{StarfarePlanetEffects:Effects,StarfareView:{timingConflicts:()=>[]}},StarfarePlanetEffects:Effects,
    $:()=>el,GL:null,reduced:false,hailOf:()=>({}),passengerList:()=>[],shipWords:x=>x,playIcon(){},renderPlist(){},renderDebrief(){},renderDlog(){}};
  vm.createContext(ctx); vm.runInContext(source,ctx); ctx.loadRide(false);
  const clock=ctx.RS.planetClock; clock.sample(0,true); clock.sample(100,true); clock.sample(150,false); ctx.RS.playing=false;
  ctx.loadRide(true); assert.equal(ctx.RS.planetClock,clock); assert.equal(ctx.RS.playing,false); assert.equal(clock.sample(10000,false),.1);
  ctx.loadRide(false); assert.notEqual(ctx.RS.planetClock,clock); assert.equal(ctx.RS.planetClock.sample(10000,false),0);
});
test('asynchronous texture completion requests a redraw even when the map is paused', async () => {
  const T = await three(), callbacks = [], events = [];
  class TextureLoader { load(url, loaded, progress, failed) { const t = new T.Texture(); callbacks.push({t,loaded,failed}); return t; } }
  const window = { THREE: {...T,TextureLoader}, dispatchEvent: e => events.push(e.type) };
  vm.runInNewContext(readFileSync(new URL('../../design/assets/sol-art.js',import.meta.url),'utf8'), {
    window, document:{currentScript:{src:'/assets/sol-art.js'},body:null,addEventListener(){}},
    CustomEvent:class {constructor(type){this.type=type;}}, fetch:async()=>({ok:true,json:async()=>({s:[]})}), console
  });
  window.SolArt.planet('moon');
  assert.equal(typeof callbacks[0].loaded,'function');
  callbacks[0].loaded(callbacks[0].t);
  assert.deepEqual(events,['solart-texture-ready']);
  callbacks[0].failed();
  assert.equal(callbacks[0].t.userData.failed,true);
});
test('quality drops a tier for frames that cost too much, not for idle time between cheap frames', async () => {
  const T = await three(), src = readFileSync(new URL('../../design/assets/sol-art.js',import.meta.url),'utf8');
  // The page's own work runs before it renders, so the frame's cost lands ahead of the render call. The next
  // animation frame comes as soon as that work ends; a paused page then sits idle before it renders again.
  function tierAfter(frameMs, idleMs) {
    let start = 0, now = 0, next = null;
    const window = { THREE:T, innerWidth:1280, requestAnimationFrame:f => { next = f; } };
    const document = { currentScript:{src:'/assets/sol-art.js'}, body:null, addEventListener(){}, timeline:{ get currentTime() { return start; } } };
    vm.runInNewContext(src, { window, document, console, performance:{ now:() => now }, fetch:async()=>({ok:true,json:async()=>({s:[]})}) });
    const post = window.SolArt.composer({ render(){} });
    for (let i = 0; i < 400; i++) {
      now = start + frameMs;
      post.render();
      const f = next; next = null; if (f) f(now);
      start = now + idleMs;
    }
    return window.SolArt.quality().name;
  }
  assert.equal(tierAfter(40,0),'high');
  assert.equal(tierAfter(16.7,5000),'high');
  assert.equal(tierAfter(100,0),'low');
  assert.equal(tierAfter(400,0),'low');
});
