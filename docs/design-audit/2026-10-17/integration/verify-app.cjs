const {chromium}=require('C:/Users/PC-AIMPANG/AppData/Local/npm-cache/_npx/1ac161d228dd2210/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const base='http://127.0.0.1:8796',checks=[],errors=[],failedAssets=[];
function check(name,pass,details){checks.push({name,pass:!!pass,...(details===undefined?{}:{details})});console.log((pass?'PASS ':'FAIL ')+name);}
const probe=`
var originalDesignDraw=draw, designSnapshot=null;
draw=function(dt,t){originalDesignDraw(dt,t);designSnapshot={jd:MAPJD,paused:MAP_PAUSED,rig:{az:RIG.az,dist:RIG.dist},flights:FL.map(function(F){return {id:F.run_id,jd:F.jd,phase:F.sc.s.phase,p:F.ship.position.toArray(),expected:shipC(F.rp,F.jd,MAPJD).v.toArray()};})};};
window.designReadOnlyProbe=function(){return {snapshot:designSnapshot,raf:raf,paused:MAP_PAUSED,liveCount:FL.length,gsap:gsap.version,arcCounts:FL.map(function(F){return F.rp.legs.filter(function(L){return L.arc&&L.arc.arc_au&&L.arc.arc_au.length;}).length;}),cameraTweens:gsap.globalTimeline.getChildren().length};};
`;
async function attach(page){
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname.startsWith('/assets/'))failedAssets.push({url:r.url(),status:r.status()});});
await page.route(base+'/',async route=>{const response=await route.fetch();let html=await response.text();if(!html.includes('SF.loadEngine().then(start)'))throw new Error('Probe anchor missing');html=html.replace('SF.loadEngine().then(start)',probe+'\nSF.loadEngine().then(start)');await route.fulfill({response,body:html});});
}
async function ready(page){await page.goto(base+'/');await page.locator('#loading').waitFor({state:'detached',timeout:60000});await page.waitForFunction(()=>window.designReadOnlyProbe?.().snapshot);await page.waitForFunction(()=>!document.querySelector('#liveStatus').textContent.includes('Connecting'));}
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const result={startedAt:new Date().toISOString(),browserPid:null,checks,errors,failedAssets,origin:'Actual local Worker; actual MCP dispatch. Browser-only read-only renderer probe; no data fixtures.'};
try{
execFileSync(process.execPath,['seed-flight.mjs'],{cwd:__dirname,stdio:'pipe'});
const actual=JSON.parse(fs.readFileSync(path.join(__dirname,'local-flight.json'),'utf8'));result.runId=actual.attempts.at(-1).runId;
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});await attach(page);await ready(page);
const pool=await (await fetch(base+'/hails.json')).json();
check('Actual seasonal bookings rendered',await page.locator('[data-b]').count()>0 && await page.locator('#bkN').innerText()===String(pool.hails.length));
check('Bookings is the default tab',await page.locator('#tabB').getAttribute('aria-selected')==='true');
check('World fills the viewport',await page.locator('#mapbox').evaluate(n=>n.clientWidth===innerWidth&&n.clientHeight>innerHeight*.8));
check('GSAP is local and loaded',await page.evaluate(()=>designReadOnlyProbe().gsap==='3.15.0'));
check('No illustrative demo flights installed',!(/DEMO[–-]0|Illustrative paths/.test(await page.locator('body').innerText())));
check('Real MCP flight is present',await page.evaluate(id=>designReadOnlyProbe().snapshot.flights.some(f=>f.id===id),result.runId));
check('Flight has recorded arcs',await page.evaluate(()=>designReadOnlyProbe().arcCounts.some(n=>n>0)));
const a=await page.evaluate(()=>designReadOnlyProbe().snapshot);await page.waitForTimeout(1000);const b=await page.evaluate(()=>designReadOnlyProbe().snapshot);
const fa=a.flights.find(f=>f.id===result.runId),fb=b.flights.find(f=>f.id===result.runId);
check('Real flight moves as its recorded clock advances',fa&&fb&&fb.jd>fa.jd&&Math.hypot(...fb.p.map((n,i)=>n-fa.p[i]))>1e-7,{a:fa,b:fb});
check('Rendered flight positions equal recorded replay mapping',b.flights.every(f=>Math.hypot(...f.p.map((n,i)=>n-f.expected[i]))<1e-8));
await page.locator('#pauseMap').click();await page.waitForTimeout(120);const p1=await page.evaluate(()=>designReadOnlyProbe().snapshot);await page.waitForTimeout(500);const p2=await page.evaluate(()=>designReadOnlyProbe().snapshot);
check('Pause freezes the visual sky/flight clock and renderer',p1.jd===p2.jd&&JSON.stringify(p1.flights)===JSON.stringify(p2.flights)&&await page.evaluate(()=>designReadOnlyProbe().raf===0));
await page.locator('[data-f="earth"]').click();await page.waitForTimeout(850);check('GSAP camera focus completes while map is paused',await page.evaluate(()=>designReadOnlyProbe().snapshot.rig.dist===7));
await page.locator('#resetMap').click();await page.waitForTimeout(850);await page.screenshot({path:path.join(__dirname,'integrated-desktop.png')});
await page.locator('#activityToggle').click();
check('Agent trail events are explicitly attributed',await page.locator('#feed>li[data-source=agent]').count()>0);
check('Flight/hazard simulation events are explicitly attributed',await page.locator('#feed>li[data-source=simulation]').count()>0);
await page.selectOption('#feedSource','agent');check('Agent filter hides simulation output',await page.locator('#feed>li[data-source=simulation]:visible').count()===0);
await page.selectOption('#feedSource','simulation');check('Simulation filter hides agent calls',await page.locator('#feed>li[data-source=agent]:visible').count()===0);await page.selectOption('#feedSource','all');
await page.locator('#activityToggle').click();
await page.locator('#bkSearch').fill('ceres');check('Booking search filters real seasonal rows',await page.locator('[data-b]').count()>0&&/ceres/i.test(await page.locator('#bkList').innerText()));await page.locator('#bkSearch').fill('');
const first=await page.locator('[data-b]').first().getAttribute('data-b');await page.locator('[data-b]').first().click();await page.waitForTimeout(1800);
check('Booking selection opens real planner inspector',await page.locator('#info').isVisible()&&/open booking/i.test(await page.locator('#info').innerText()));
check('Local route previews never enter feed',await page.locator('#feed>li.k-plan').count()===0&&!(/DESK/.test(await page.locator('#feed').innerText())));
await page.locator('[data-act=dismiss]').click();
await page.locator('#connectBtn').click();await page.waitForTimeout(50);await page.keyboard.press('Tab');
check('Connect modal traps keyboard focus',await page.evaluate(()=>document.querySelector('#intro').contains(document.activeElement)));
await page.locator('#introClose').click();await page.waitForTimeout(80);check('Connect modal returns focus',await page.evaluate(()=>document.activeElement.id==='connectBtn'));
await page.locator('[data-drawer=reports]').click();await page.locator('#boardBtn').click();await page.waitForTimeout(50);await page.locator('#logClose').click();await page.waitForTimeout(80);check('Scoreboard returns focus to its visible Reports trigger',await page.evaluate(()=>document.activeElement.id==='boardBtn'));
await page.locator('#drawerClose').click();await page.locator('#tabF').click();await page.locator('[data-f="0"]').filter({has:page.locator('.cs')}).first().click();
const flightLink=await page.locator('#info a[href^="/flight/"]').getAttribute('href');check('Flight inspector links to actual run receipt',flightLink?.includes('run_'));
await page.goto(base+flightLink);await page.locator('#loading').waitFor({state:'detached',timeout:60000});await page.waitForTimeout(800);check('Actual flight replay and manifest render',await page.locator('#rhost canvas').count()===1&&(await page.locator('#plStops').innerText()).length>0);
await page.screenshot({path:path.join(__dirname,'integrated-flight.png')});
await page.goBack();await page.waitForFunction(()=>window.designReadOnlyProbe?.().snapshot);const before=await page.locator('#clk').innerText();await page.waitForFunction(old=>document.querySelector('#clk').textContent!==old,before,{timeout:8000});check('Browser Back restores a ticking app',true);
for(const width of [1280,900,390,360]){await page.setViewportSize({width,height:width>760?900:844});await page.waitForTimeout(300);check('No horizontal overflow at '+width+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(__dirname,'integrated-'+width+'.png')});}
for(const key of ['tools','reports','fleet','alerts']){await page.locator('#operationsMenu').click();const nav=page.locator('[data-drawer='+key+']');await nav.click();check('Mobile '+key+' navigation remains reachable',await page.locator('#opsDrawer').isVisible());await page.locator('#drawerClose').click();}
await page.locator('#mobileActivity').click();check('Mobile compact Activity opens',await page.locator('#activityPanel').isVisible());await page.locator('#mobileActivity').click();
await page.locator('#sheetCollapse').click();check('Mobile bookings can collapse for more canvas',await page.locator('.c-fl').evaluate(n=>n.clientHeight<=45));
await page.screenshot({path:path.join(__dirname,'integrated-mobile-canvas.png')});
const reduced=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await attach(reduced);await ready(reduced);await reduced.waitForTimeout(200);check('Reduced motion starts with a paused map',await reduced.evaluate(()=>designReadOnlyProbe().paused&&designReadOnlyProbe().raf===0));
await reduced.locator('[data-f="earth"]').click();await reduced.waitForTimeout(120);check('Reduced motion focus is immediate',await reduced.evaluate(()=>designReadOnlyProbe().snapshot.rig.dist===7));await reduced.close();
const fallback=await browser.newPage({viewport:{width:390,height:844}});await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(/webgl/i.test(type))return null;return original.call(this,type,...args);};});await attach(fallback);await fallback.goto(base+'/');await fallback.locator('#loading').waitFor({state:'detached',timeout:60000});check('WebGL fallback keeps bookings usable',await fallback.locator('#nogl').isVisible()&&await fallback.locator('[data-b]').count()>0);await fallback.close();
check('No browser JavaScript errors',errors.length===0,errors);check('No failed local assets',failedAssets.length===0,failedAssets);
}catch(e){result.failure=String(e.stack||e);check('Harness completed',false,result.failure);}
finally{await browser.close();result.browserClosed=true;result.finishedAt=new Date().toISOString();result.passed=checks.filter(c=>c.pass).length;result.failed=checks.filter(c=>!c.pass).length;fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(result,null,2)+'\n');if(result.failed)process.exitCode=1;}
})();
