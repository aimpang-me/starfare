const {chromium}=require('C:/Users/PC-AIMPANG/AppData/Local/npm-cache/_npx/1ac161d228dd2210/node_modules/playwright');
const fs=require('fs'),path=require('path');
const out=__dirname, ev=path.join(out,'evidence'), ss=path.join(out,'screenshots');
const base='http://127.0.0.1:8794';
const results={capturedAt:new Date().toISOString(),base,commit:'783986893d427e7963e0acf0d598d71d8772badb',cases:[]};
async function metrics(p){return p.evaluate(()=>({url:location.href,title:document.title,lang:document.documentElement.lang,viewportMeta:document.querySelector('meta[name=viewport]')?.content||null,width:innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,scale:visualViewport.scale,coarse:matchMedia('(pointer:coarse)').matches,h1:[...document.querySelectorAll('h1')].map(e=>e.textContent),feed:document.querySelector('#feed')?.innerText,feedY:document.querySelector('#fdH')?.getBoundingClientRect().y,buttons:[...document.querySelectorAll('button,a,input')].filter(e=>e.getBoundingClientRect().height).map(e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return {id:e.id,text:e.textContent.trim().slice(0,55),width:r.width,height:r.height,color:s.color,bg:s.backgroundColor,fontSize:s.fontSize}}),headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({tag:e.tagName,id:e.id,text:e.textContent})),canvas:[...document.querySelectorAll('canvas')].map(e=>({id:e.id,role:e.getAttribute('role'),label:e.getAttribute('aria-label')}))}));}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});
try{
for(const cfg of [{id:'desktop',viewport:{width:1440,height:1000}},{id:'tablet',viewport:{width:768,height:1024},isMobile:true,hasTouch:true},{id:'phone',viewport:{width:390,height:844},isMobile:true,hasTouch:true},{id:'phone360',viewport:{width:360,height:800},isMobile:true,hasTouch:true}]){
 const c=await browser.newContext(cfg),p=await c.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message)); await p.goto(base,{waitUntil:'networkidle'}); await p.waitForSelector('#loading',{state:'detached',timeout:30000}); await p.screenshot({path:path.join(ss,'main-'+cfg.id+'.png'),fullPage:true});
 results.cases.push({id:cfg.id,metrics:await metrics(p),errors});
 if(cfg.id==='desktop'){
  await p.locator('#connectBtn').click(); let focus=[];for(let i=0;i<15;i++){await p.keyboard.press('Tab');focus.push(await p.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,text:document.activeElement.textContent.slice(0,65),inside:!!document.activeElement.closest('#intro')})));}
  await p.screenshot({path:path.join(ss,'main-connect-dialog.png')});results.modalFocus=focus;
  await p.keyboard.press('Escape');results.focusAfterEscape=await p.evaluate(()=>document.activeElement.id);
  await p.locator('#fBtn').click();await p.keyboard.press('Escape');results.filterAfterEscape=await p.locator('#fBtn').getAttribute('aria-expanded');
  await p.locator('#tabB').click();await p.screenshot({path:path.join(ss,'main-bookings.png'),fullPage:true});
  await p.locator('#tabB').focus();await p.keyboard.press('ArrowLeft');results.tabArrow=await p.evaluate(()=>({focused:document.activeElement.id,active:document.querySelector('[role=tab][aria-selected=true]').id}));
 }
 await c.close();
}
const c=await browser.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();
await p.route('**/live.json',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"audit induced outage"}'}));
await p.goto(base,{waitUntil:'networkidle'});await p.waitForSelector('#loading',{state:'detached'});await p.screenshot({path:path.join(ss,'main-live-service-error.png'),fullPage:true});results.liveFailure=await metrics(p);results.liveFailureText=await p.locator('body').innerText();
for(const route of ['/board','/bench','/method','/flight/run_00000000000000000000']){
 const response=await p.goto(base+route,{waitUntil:'networkidle'});await p.waitForTimeout(800);
 const label=route.split('/')[1];await p.screenshot({path:path.join(ss,'main-'+label+'.png'),fullPage:true});results.cases.push({id:label,status:response.status(),metrics:await metrics(p),text:(await p.locator('body').innerText()).slice(0,14000)});
}
await c.close();
const rm=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),rp=await rm.newPage();await rp.goto(base,{waitUntil:'networkidle'});await rp.waitForSelector('#loading',{state:'detached'});results.reducedMotion=await rp.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,animations:document.getAnimations().map(a=>({state:a.playState,effect:a.effect?.getTiming()}))}));await rm.close();
}finally{fs.writeFileSync(path.join(ev,'technical-check.json'),JSON.stringify(results,null,2));await browser.close();}
console.log(JSON.stringify({cases:results.cases.map(x=>({id:x.id,status:x.status,width:x.metrics.width,scrollWidth:x.metrics.scrollWidth,scale:x.metrics.scale,feedY:x.metrics.feedY,errors:x.errors})),modalFocus:results.modalFocus,filterAfterEscape:results.filterAfterEscape,tabArrow:results.tabArrow},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});

