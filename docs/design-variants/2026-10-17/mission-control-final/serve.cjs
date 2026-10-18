const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname,port=8795,startedAt=new Date().toISOString();
const logFile=path.join(root,'preview-process.json');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
let lastRequest=Date.now(),closing=false;
function record(status,reason){fs.writeFileSync(logFile,JSON.stringify({owner:'Starfare Design',pid:process.pid,purpose:'Mission Control final-look review',url:'http://127.0.0.1:'+port,startedAt,status,reason,updatedAt:new Date().toISOString(),idleTimeoutMinutes:45,maximumLifetimeHours:2},null,2));}
function close(reason){if(closing)return;closing=true;record('stopping',reason);clearInterval(idle);clearTimeout(lifetime);server.close(()=>record('stopped',reason));server.closeAllConnections();}
const server=http.createServer((req,res)=>{
  if(req.method==='POST'&&req.url==='/__stop'){res.writeHead(200);res.end('Stopped');setTimeout(()=>close('Owner requested shutdown'),50);return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  lastRequest=Date.now();let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(target,(error,data)=>{if(error){res.writeHead(404).end('Not found');return;}res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:data);});
});
const idle=setInterval(()=>{if(Date.now()-lastRequest>45*60*1000)close('45 minutes without a request');},60000);idle.unref();
const lifetime=setTimeout(()=>close('Maximum two-hour review window'),2*60*60*1000);lifetime.unref();
process.on('SIGINT',()=>close('SIGINT'));process.on('SIGTERM',()=>close('SIGTERM'));
server.on('error',error=>{record('failed',error.message);clearInterval(idle);clearTimeout(lifetime);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{record('running','Retained for user review');console.log('Review: http://127.0.0.1:'+port+' | PID '+process.pid);});
