// Read-only extraction from the audit baseline engine. Writes design evidence only.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../../..');
const E=require(path.join(root,'connector/src/engine/sol-page.cjs'));
const jd=Date.parse('2033-09-10T03:20:00Z')/864e5+2440587.5,au=149597870.7;
const ids=['mercury','venus','earth','mars','ceres','jupiter','saturn','uranus','neptune','moon','titan'];
const bodies=ids.map(id=>{const p=E.PLACES.find(p=>p.id===id),s=E.placeState(id,jd),local=['moon','titan'].includes(id);let orbit=[];if(!local){const period=E.periodDays(s);orbit=Array.from({length:241},(_,i)=>E.propagate(s.r,s.v,period*86400*i/240).r.map(v=>v/au));}else{const period=p.period_days||(id==='moon'?27.321661:15.945421);orbit=Array.from({length:129},(_,i)=>{const t=jd+period*i/128,a=E.placeState(id,t).r,b=E.placeState(p.parent,t).r;return a.map((v,k)=>(v-b[k])/au);});}return {id,name:p.name,parent:p.parent,position:s.r.map(v=>v/au),orbit};});
fs.writeFileSync(path.join(__dirname,'assets/system-snapshot.json'),JSON.stringify({jd,iso:'2033-09-10T03:20:00Z',source:'Starfare audit-baseline engine; JPL DE421; heliocentric J2000 ecliptic',orbitMethod:'One osculating two-body orbit per planet at snapshot epoch',bodies}));
console.log(JSON.stringify({jd,bodies:bodies.map(b=>({id:b.id,points:b.orbit.length,position:b.position.map(x=>+x.toFixed(3))}))},null,2));
