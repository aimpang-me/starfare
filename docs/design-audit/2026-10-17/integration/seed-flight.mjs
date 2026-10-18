// Real local MCP calls for UI validation. No mocked bookings, records or trajectories.
import {Client} from '../../../../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../../../../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url), E=require('../../../../connector/src/engine/sol-page.cjs'), meta=require('../../../../connector/src/engine/meta.json');
const client=new Client({name:'starfare-design-local-verification',version:'1'});
const attempts=[];
async function call(name,args={}){const r=await client.callTool({name,arguments:args});let v;try{v=JSON.parse(r.content[0].text);}catch{v=r.content[0].text;}if(r.isError||v.error)throw new Error(JSON.stringify(v));return v;}
try{
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8796/mcp')));
for(const id of ['ceres-shift','titan-home','jovian-hop','iss-crew']){
try{
const hail=await call('take_hail',{hail_id:id});
const jd=Date.parse(hail.rider_ready.replace(' ','T')+':00Z')/864e5+2440587.5;
const car=E.R.terms(id,jd,meta.sky.jd0+meta.sky.len_days-1,String(hail.season)).par.car;
const pickup=await call('plan_pickup',{run_id:hail.run_id,car});
const ride=await call('plan_ride',{run_id:hail.run_id,after_leg:pickup.leg_id});
const result=await call('dispatch',{run_id:hail.run_id,pickup_leg:pickup.leg_id,ride_leg:ride.leg_id,quoted_fare_usd:ride.fare_usd,quoted_arrival:ride.arrive,ask_after_hours:'never',note:'Local Design integration verification through MCP'});
attempts.push({id,runId:hail.run_id,car,status:result.status,landsIn:result.lands_in_s});
if(result.ok && result.lands_in_s>15){const fl=await (await fetch('http://127.0.0.1:8796/flight/'+hail.run_id+'.json')).json();
fs.writeFileSync(new URL('local-flight.json',import.meta.url),JSON.stringify({origin:'Actual local Worker + MCP, not hosted',attempts,flight:fl},null,2)+'\n');console.log(JSON.stringify(attempts));break;}
}catch(e){attempts.push({id,error:String(e).slice(0,250)});}
}
if(!fs.existsSync(new URL('local-flight.json',import.meta.url)))throw new Error('No persistent local flight: '+JSON.stringify(attempts));
}finally{await client.close();}
