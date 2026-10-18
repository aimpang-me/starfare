const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../../../..');
const child=spawn(process.execPath,[path.join(root,'connector/node_modules/wrangler/bin/wrangler.js'),'dev','--ip','127.0.0.1','--port','8796','--persist-to',path.join(root,'connector/.wrangler/design-integration'),'--var','STARFARE_OAUTH:off','--var','RATE_PER_MIN:6000'],{cwd:path.join(root,'connector'),windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false',CI:'1'}});
const log=fs.createWriteStream(path.join(__dirname,'worker.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);
const state={owner:'Starfare Design',purpose:'Actual app integration review; local only; OAuth off',pid:process.pid,workerPid:child.pid,url:'http://127.0.0.1:8796',startedAt:new Date().toISOString(),status:'running',maximumLifetimeMinutes:90};
const save=()=>fs.writeFileSync(path.join(__dirname,'app-process.json'),JSON.stringify(state,null,2)+'\n');save();
function stop(){if(process.platform==='win32'){try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});}catch{}}else child.kill();state.status='stopped';state.stoppedAt=new Date().toISOString();save();process.exit();}
setTimeout(stop,90*60*1000);process.on('SIGTERM',stop);process.on('SIGINT',stop);child.on('exit',code=>{state.status='exited';state.code=code;save();process.exit(code||0);});
