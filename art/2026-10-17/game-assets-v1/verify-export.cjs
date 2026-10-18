// Local-only GLB validation and transparent render export. Uses existing bundled Playwright/sharp.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const dependencyRoot=process.env.STARFARE_NODE_PACKAGES||'C:/Users/PC-AIMPANG/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(dependencyRoot,'playwright'));
const sharp=require(path.join(dependencyRoot,'sharp'));
const root=__dirname,owner='Starfare Art / 01a14be0-eb35-7433-9ef0-8b13ecc6a61d';
const report={owner,checks:[],renders:[],errors:[],processes:[],cleanup:{}};
function validate(file){
 const data=fs.readFileSync(path.join(root,file));assert.equal(data.readUInt32LE(0),0x46546c67);assert.equal(data.readUInt32LE(4),2);assert.equal(data.readUInt32LE(8),data.length);
 const jl=data.readUInt32LE(12);assert.equal(data.readUInt32LE(16),0x4e4f534a);const doc=JSON.parse(data.subarray(20,20+jl).toString()),bin=data.subarray(28+jl);assert.equal(data.readUInt32LE(24+jl),0x004e4942);assert.equal(doc.buffers[0].byteLength,bin.length);
 const values=doc.accessors.map(a=>{const v=doc.bufferViews[a.bufferView],size=a.componentType===5126||a.componentType===5125?4:2,dim=a.type==='VEC3'?3:1,offset=v.byteOffset+(a.byteOffset||0);assert.ok(offset+a.count*dim*size<=bin.length);const out=[];for(let i=0;i<a.count*dim;i++)out.push(a.componentType===5126?bin.readFloatLE(offset+i*4):a.componentType===5125?bin.readUInt32LE(offset+i*4):bin.readUInt16LE(offset+i*2));assert.ok(out.every(Number.isFinite));return out;});
 let triangles=0,degenerate=0;for(const mesh of doc.meshes)for(const p of mesh.primitives){const pos=values[p.attributes.POSITION],norm=values[p.attributes.NORMAL],idx=values[p.indices];assert.equal(pos.length,norm.length);assert.equal(idx.length%3,0);assert.ok(idx.every(i=>i>=0&&i<pos.length/3));for(let i=0;i<norm.length;i+=3)assert.ok(Math.abs(Math.hypot(...norm.slice(i,i+3))-1)<.001,'Unit normals');for(let i=0;i<idx.length;i+=3){const [a,b,c]=idx.slice(i,i+3).map(v=>pos.slice(v*3,v*3+3)),u=b.map((v,k)=>v-a[k]),v=c.map((vv,k)=>vv-a[k]);const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);if(area<1e-9)degenerate++;}triangles+=idx.length/3;}
 assert.equal(degenerate,0,'No zero-area triangles');assert.ok(doc.materials.every(m=>m.emissiveFactor.every(v=>v===0)));assert.ok(!doc.images&&!doc.textures,'Self-contained material-only meshes');
 return {file,passed:true,triangles,degenerate,finiteGeometry:true,unitNormals:true,indicesInRange:true,emissionOff:true};
}
let server,browserServer,browser,port;
const processFile=path.join(root,'process-ownership.json');
async function run(){
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));for(const m of manifest.models)report.checks.push(validate(m.file));
  server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'preview.html',file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.md':'text/plain'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;report.processes.push({pid:process.pid,role:'verification runner and localhost server',port,owner});
  browserServer=await chromium.launchServer({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.processes.push({pid:browserServer.process().pid,role:'isolated verification Chrome',owner});fs.writeFileSync(processFile,JSON.stringify({status:'running',...report},null,2));
  browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage({viewport:{width:1440,height:1250},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/preview.html`);await page.waitForFunction(()=>window.assetReady==='tandem');
  fs.mkdirSync(path.join(root,'sprites'),{recursive:true});fs.mkdirSync(path.join(root,'inspection'),{recursive:true});
  for(const m of manifest.models){
   await page.evaluate(id=>window.assetReview.load(id),m.id);
   for(const view of ['portrait','top','side','rear']){
    const png=await page.evaluate(v=>{window.assetReview.view(v);return window.assetReview.exportPNG()},view);const bytes=Buffer.from(png.split(',')[1],'base64');const file='sprites/'+m.id+'-'+view+'.png';fs.writeFileSync(path.join(root,file),bytes);
    const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});let transparent=0,opaque=0,partial=0;const bbox=[info.width,info.height,-1,-1];for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(a===0)transparent++;else {if(a===255)opaque++;else partial++;bbox[0]=Math.min(bbox[0],x);bbox[1]=Math.min(bbox[1],y);bbox[2]=Math.max(bbox[2],x);bbox[3]=Math.max(bbox[3],y);}}
    assert.ok(transparent>1000&&opaque>100,'Real alpha and visible subject');assert.ok(bbox[0]>10&&bbox[1]>10&&bbox[2]<info.width-10&&bbox[3]<info.height-10,'Unclipped subject with padding');assert.equal(await page.evaluate(()=>window.assetReview.state.glError),0);
    report.renders.push({file,width:info.width,height:info.height,transparent,opaque,partial,alphaBounds:bbox,passed:true});
   }
   // Native 96px render, not a resized image; checks readability at inventory-icon size.
   const small=await page.evaluate(()=>{const c=document.querySelector('canvas');c.width=96;c.height=96;window.assetReview.view('portrait');const p=window.assetReview.exportPNG();c.width=1024;c.height=1024;window.assetReview.render();return p;});fs.writeFileSync(path.join(root,'sprites',m.id+'-portrait-96.png'),Buffer.from(small.split(',')[1],'base64'));
  }
  await page.evaluate(()=>window.assetReview.load('tandem'));await page.screenshot({path:path.join(root,'inspection','tandem-viewer.png'),fullPage:true});
  const before=await page.evaluate(()=>window.assetReview.state.yaw);await page.locator('canvas').focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.evaluate(()=>window.assetReview.state.yaw),before);report.checks.push({test:'keyboard rotation changes view',passed:true});
  await page.getByRole('button',{name:'Background: navy',exact:true}).click();await page.screenshot({path:path.join(root,'inspection','checker-alpha.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});const stillA=await page.evaluate(()=>window.assetReview.state);await page.waitForTimeout(350);const stillB=await page.evaluate(()=>window.assetReview.state);assert.deepEqual(stillA,stillB);report.checks.push({test:'no automatic motion under reduced motion',passed:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.checks.push({test:'viewer at 390px has no horizontal overflow',passed:true});
  await page.goto(`http://127.0.0.1:${port}/review-sheet.html`);await page.setViewportSize({width:1440,height:1300});await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));await page.screenshot({path:path.join(root,'inspection','all-models.png'),fullPage:true});
  const offlineRequests=[];const captureRequest=req=>offlineRequests.push(req.url());page.on('request',captureRequest);await page.goto(`http://127.0.0.1:${port}/standalone-preview.html`);await page.waitForFunction(()=>window.assetReady==='tandem');for(const m of manifest.models)await page.evaluate(id=>window.assetReview.load(id),m.id);page.off('request',captureRequest);assert.equal(offlineRequests.length,1,'Standalone loads models without secondary requests');report.checks.push({test:'standalone loads all four embedded GLBs with no resource requests',passed:true});
  assert.equal(report.errors.length,0);report.passed=true;
 }catch(e){report.passed=false;report.errors.push(e.stack);process.exitCode=1;}
 finally{
  if(browser)await browser.close().catch(e=>report.errors.push('Browser close: '+e.message));if(browserServer)await browserServer.close().catch(e=>report.errors.push('Browser server close: '+e.message));
  if(server&&server.listening)await new Promise(resolve=>server.close(resolve));
  report.cleanup.browserExited=!browserServer||browserServer.process().exitCode!==null;report.cleanup.serverClosed=!server||!server.listening;
  if(port){const probe=http.createServer();try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve)});report.cleanup.portReleased=true;}catch{report.cleanup.portReleased=false;}finally{if(probe.listening)await new Promise(resolve=>probe.close(resolve));}}
  fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(processFile,JSON.stringify({status:'stopped',owner,processes:report.processes,cleanup:report.cleanup},null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }
}
run();
