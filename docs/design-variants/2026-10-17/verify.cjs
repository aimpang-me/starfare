// Runs only the isolated localhost design study. No application endpoints are called.
const fs = require('node:fs');
const {chromium} = require('C:/Users/PC-AIMPANG/AppData/Local/npm-cache/_npx/1ac161d228dd2210/node_modules/playwright');
(async()=>{
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const verify=eval('('+fs.readFileSync('verify-browser.js','utf8')+')');
    const original=console.log;
    console.log=(value)=>{fs.writeFileSync('verification.json',value);original(value);};
    await verify(page);
    const result=JSON.parse(fs.readFileSync('verification.json','utf8'));
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const phone=await mobile.newPage();result.mobileEmulation=[];
    for(const [variant,name] of Object.entries({a:'orbital-desk',b:'departure-lounge',c:'mission-control'})){
      await phone.goto('http://127.0.0.1:8795/?variant='+variant);
      const geometry=await phone.evaluate(()=>({innerWidth,scrollWidth:document.documentElement.scrollWidth,scale:visualViewport.scale,touch:navigator.maxTouchPoints}));
      result.mobileEmulation.push({variant,...geometry,pass:geometry.innerWidth===390&&geometry.scrollWidth===390&&geometry.scale===1&&geometry.touch>0});
      await phone.screenshot({path:name+'-mobile.png',fullPage:true});
    }
    await mobile.close();result.pass=result.pass&&result.mobileEmulation.every(x=>x.pass);
    fs.writeFileSync('verification.json',JSON.stringify(result,null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
