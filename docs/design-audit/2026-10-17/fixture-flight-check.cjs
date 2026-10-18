const {chromium}=require('C:/Users/PC-AIMPANG/AppData/Local/npm-cache/_npx/1ac161d228dd2210/node_modules/playwright');const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..'),fixture=JSON.parse(fs.readFileSync(path.join(root,'connector/test/fixtures/live-golden.json'),'utf8'));
const record=JSON.parse(fixture['phobos-commute.record.arrived']),id='run_00000000000000000000';record.run_id=id;
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const report={provenance:'Browser-only fixture injection. phobos-commute.record.arrived from committed live-golden.json, run_id replaced for local route. No server run was created. Empty initial arcs trigger existing client fallback planning. Not a live flight or shared-manifest validation.',cases:[]};try{
for(const cfg of [{id:'desktop',viewport:{width:1440,height:1000}},{id:'phone',viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
const c=await browser.newContext({...cfg,reducedMotion:'reduce'}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/rides/'+id+'.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)}));
await p.goto('http://127.0.0.1:8794/flight/'+id,{waitUntil:'networkidle'});await p.waitForSelector('#loading',{state:'detached',timeout:30000});
await p.evaluate(()=>{document.title='[AUDIT FIXTURE] '+document.title;const b=document.createElement('div');b.textContent='AUDIT FIXTURE • committed Phobos record • not a live flight';b.style='position:fixed;top:0;left:0;right:0;z-index:9999;background:#ffe49a;color:#1b1605;text-align:center;font:12px/20px sans-serif';document.body.appendChild(b)});
await p.screenshot({path:path.join(__dirname,'screenshots','fixture-flight-'+cfg.id+'.png'),fullPage:true});
report.cases.push({id:cfg.id,errors,text:(await p.locator('body').innerText()).slice(0,18000),metrics:await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scale:visualViewport.scale,headings:[...document.querySelectorAll('h1,h2,h3')].map(x=>x.textContent),controls:[...document.querySelectorAll('button,input,select')].map(x=>({id:x.id,label:x.getAttribute('aria-label'),text:x.textContent.slice(0,60)}))}))});
await c.close();}
}finally{fs.writeFileSync(path.join(__dirname,'evidence','fixture-flight-check.json'),JSON.stringify(report,null,2));await browser.close();}console.log(JSON.stringify(report.cases.map(c=>({id:c.id,errors:c.errors,metrics:c.metrics})),null,2));})().catch(e=>{console.error(e);process.exitCode=1});

