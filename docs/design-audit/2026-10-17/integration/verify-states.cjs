const {chromium}=require('C:/Users/PC-AIMPANG/AppData/Local/npm-cache/_npx/1ac161d228dd2210/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const base='http://127.0.0.1:8796',checks=[],errors=[];
function check(name,pass){checks.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
try{
const p=await browser.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>errors.push(e.message));
await p.route(base+'/live.json',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"test outage"}'}));
await p.goto(base);await p.locator('#loading').waitFor({state:'detached'});await p.waitForFunction(()=>document.querySelector('#liveStatus').dataset.error==='true');
check('Fleet outage is stated on mobile canvas',/unavailable/i.test(await p.locator('#mapSub').innerText()));
await p.locator('#tabF').click();check('Fleet outage is not presented as an empty sky',/unavailable/i.test(await p.locator('#flList').innerText()));
await p.locator('#tabB').click();check('Real bookings remain usable during fleet outage',await p.locator('[data-b]').count()>0);
await p.locator('#operationsMenu').click();await p.locator('[data-drawer=reports]').click();await p.locator('#boardBtn').click();await p.keyboard.press('Escape');await p.waitForTimeout(100);
check('Escape closes only the top modal',await p.locator('#logM').isHidden()&&await p.locator('#opsDrawer').isVisible());
check('Escape restores keyboard focus inside Reports',await p.evaluate(()=>document.activeElement.id==='boardBtn'));await p.locator('#drawerClose').click();
await p.screenshot({path:path.join(__dirname,'integrated-fleet-outage.png')});await p.close();
const run=JSON.parse(fs.readFileSync(path.join(__dirname,'local-flight.json'),'utf8')).attempts.at(-1).runId;
const reduced=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});reduced.on('pageerror',e=>errors.push(e.message));
await reduced.goto(base+'/flight/'+run);await reduced.locator('#loading').waitFor({state:'detached'});await reduced.waitForTimeout(300);
check('Reduced-motion flight replay starts paused',await reduced.locator('#play').getAttribute('aria-label')==='Play');
check('Reduced-motion replay keeps actual manifest accessible',(await reduced.locator('#plStops').innerText()).length>0);
check('Replay phone has no horizontal overflow',await reduced.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await reduced.screenshot({path:path.join(__dirname,'integrated-flight-mobile-reduced.png'),fullPage:true});
await reduced.locator('#play').click();check('Reduced-motion user can explicitly play actual replay',await reduced.locator('#play').getAttribute('aria-label')==='Pause');await reduced.close();
check('State checks have no browser JavaScript errors',errors.length===0);
}catch(e){checks.push({name:'Harness completed',pass:false,error:String(e.stack)});}
finally{await browser.close();const report={checks,errors,browserClosed:true,completedAt:new Date().toISOString(),pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass).length};fs.writeFileSync(path.join(__dirname,'state-verification.json'),JSON.stringify(report,null,2)+'\n');if(report.fail)process.exitCode=1;}})();
