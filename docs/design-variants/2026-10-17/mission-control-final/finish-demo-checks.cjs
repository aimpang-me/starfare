const fs=require('node:fs');let s=fs.readFileSync('verify-demo.cjs','utf8');
s=s.replace("await p.emulateMedia({reducedMotion:'reduce'});check", "await p.emulateMedia({reducedMotion:'reduce'});await p.waitForFunction(()=>!designScene.state.skyPlaying);check");
s=s.replace("for(const [width,height] of", `if(round==='final'){const v=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:path.join(__dirname,'recordings'),size:{width:1280,height:720}}});const vp=await v.newPage();await ready(vp);const video=vp.video();await vp.waitForTimeout(6500);await v.close();const source=await video.path();fs.copyFileSync(source,path.join(__dirname,'recordings/demo-flights.webm'));result.motionRecording='recordings/demo-flights.webm';}
 for(const [width,height] of`);
fs.writeFileSync('verify-demo.cjs',s);
