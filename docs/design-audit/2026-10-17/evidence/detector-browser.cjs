const { chromium } = require('C:/Users/PC-AIMPANG/AppData/Local/npm-cache/_npx/1ac161d228dd2210/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const out = __dirname;
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true});
 const context = await browser.newContext({viewport:{width:1440,height:1000}});
 const page = await context.newPage(); globalThis.starfareDetectorPage = page;
 const records = [];
 try {
  for (const route of ['/', '/bench', '/board']) {
   const rec = {url:'https://starfare.aimpang.workers.dev'+route,console:[],errors:[]}; records.push(rec);
   const onConsole = m => rec.console.push({type:m.type(),text:m.text()});
   const onError = e => rec.errors.push(e.message);
   page.on('console',onConsole);page.on('pageerror',onError);
   await page.goto(rec.url,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(4000);
   rec.metrics = await page.evaluate(() => {
    const visible = e => {const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
    return {title:document.title, width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
     headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({tag:e.tagName,text:e.textContent})),
     controls:[...document.querySelectorAll('button,a,input,select,[role="button"]')].filter(visible).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,text:e.textContent.trim().slice(0,90),label:e.getAttribute('aria-label'),width:r.width,height:r.height,fontSize:s.fontSize,color:s.color,background:s.backgroundColor,tabIndex:e.tabIndex};}),
     status:[...document.querySelectorAll('[role="status"],[role="alert"],[aria-live]')].map(e=>({tag:e.tagName,role:e.getAttribute('role'),live:e.getAttribute('aria-live'),text:e.textContent.slice(0,500)})),
     body:document.body.innerText.slice(0,16000)};
   });
   const name=route==='/'?'home':route.slice(1);
   await page.screenshot({path:path.join(out,`b-${name}-desktop.png`),fullPage:true});
   rec.preflight = await page.evaluate(() => {document.title='[Human] '+document.title; const s=document.createElement('script');s.textContent='window.__starfareMutablePreflight = true';document.head.appendChild(s);return {title:document.title,scriptExecuted:window.__starfareMutablePreflight===true};});
   await page.evaluate(()=>scrollTo(0,0));
   try {await page.addScriptTag({url:'http://localhost:8400/detect.js'});rec.injection='loaded';} catch(e){rec.injection=e.message;}
   await page.waitForTimeout(3000);
   rec.overlay = await page.evaluate(()=>({impeccableElements:[...document.querySelectorAll('*')].filter(e=>(e.id+' '+e.className).includes('impeccable')).map(e=>({tag:e.tagName,id:e.id,class:String(e.className).slice(0,120)})).slice(0,60),title:document.title}));
   await page.screenshot({path:path.join(out,`b-${name}-overlay.png`),fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);
   rec.mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,body:document.body.innerText.slice(0,18000)}));
   await page.screenshot({path:path.join(out,`b-${name}-mobile.png`),fullPage:true});
   await page.setViewportSize({width:1440,height:1000});
   page.off('console',onConsole);page.off('pageerror',onError);
  }
 } catch(e){records.push({fatal:e.stack});}
 finally {fs.writeFileSync(path.join(out,'detector-browser.json'),JSON.stringify(records,null,2));await browser.close();}
 console.log(JSON.stringify(records.map(r=>({url:r.url,preflight:r.preflight,injection:r.injection,overlay:r.overlay,errors:r.errors,fatal:r.fatal,console:r.console?.filter(c=>/impeccable/i.test(c.text))})),null,2));
})();
