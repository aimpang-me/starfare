const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),log=path.join(__dirname,'sync-unit-tests.tap'),fd=fs.openSync(log,'w');
const files=['connector/test/booking-replay.test.mjs','connector/test/flight-timing.test.mjs','connector/test/public-pool.test.mjs','connector/test/e2e-parity.test.mjs'];
const child=spawn(process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,stdio:['ignore',fd,fd],windowsHide:true});
const record={purpose:'Merged booking/manifest/replay/timing compatibility',parentPid:process.pid,pid:child.pid,files,startedAt:new Date().toISOString(),status:'running'};
const report=path.join(__dirname,'sync-unit-tests.json');fs.writeFileSync(report,JSON.stringify(record,null,2));
child.on('close',code=>{fs.closeSync(fd);record.status='exited';record.exitCode=code;record.completedAt=new Date().toISOString();const text=fs.readFileSync(log,'utf8');for(const key of ['tests','pass','fail','skipped'])record[key]=Number(text.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??-1);fs.writeFileSync(report,JSON.stringify(record,null,2));console.log(JSON.stringify(record));process.exitCode=code??1;});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
