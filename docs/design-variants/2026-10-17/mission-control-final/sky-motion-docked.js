// Preview sky motion uses the unchanged baseline engine. It creates no flight state.
const SKY_DAYS_PER_SECOND=1,skyAu=149597870.7;
let skyPlaying=!matchMedia('(prefers-reduced-motion: reduce)').matches;
let skyOffsetDays=0,skyFrame=0,skyLastTick=0,skyLastPaint=0,skyStarted=false;
const skyInitialParents={},skyLocalScales={};
const skyPauseIcon='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const skyPlayIcon='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
function syncSkyControls(){const b=document.querySelector('#motion-toggle');b.setAttribute('aria-pressed',String(skyPlaying));b.setAttribute('aria-label',skyPlaying?'Pause sky preview':'Play sky preview');b.title=skyPlaying?'Pause sky preview':'Play sky preview';b.innerHTML=skyPlaying?skyPauseIcon:skyPlayIcon;document.querySelector('#sky-status').textContent=skyPlaying?'Sky preview':'Sky paused';document.querySelector('#sky-speed').textContent=skyPlaying?'1 day/s':'Paused';}
function suspendSky(){if(skyFrame)cancelAnimationFrame(skyFrame);skyFrame=0;skyLastTick=0;skyLastPaint=0;}
function resumeSky(){if(!skyStarted||!skyPlaying||document.hidden||document.querySelector('#dialog').open||skyFrame)return;skyLastTick=0;skyFrame=requestAnimationFrame(skyTick);}
function skyTick(now){skyFrame=0;if(!skyPlaying||document.hidden||document.querySelector('#dialog').open){suspendSky();return;}if(skyLastTick)skyOffsetDays+=(now-skyLastTick)/1000*SKY_DAYS_PER_SECOND;skyLastTick=now;const end=SOLE.EPHEM_RANGE[1]-sceneData.jd-.001;if(skyOffsetDays>=end){skyOffsetDays=end;skyPlaying=false;syncSkyControls();say('Sky preview reached the end of the available ephemeris.');requestDraw();return;}const budget=1000/(innerWidth<700?20:30);if(now-skyLastPaint>=budget){skyLastPaint=now;requestDraw();}skyFrame=requestAnimationFrame(skyTick);}
function setSkyPlaying(playing){skyPlaying=playing;suspendSky();syncSkyControls();resumeSky();if(skyStarted)requestDraw();}
function startSkyPreview(){for(const b of sceneData.bodies){if(b.parent&&positions[b.parent])skyInitialParents[b.parent]=positions[b.parent].clone();if(['moon','titan'].includes(b.id))skyLocalScales[b.id]=(b.id==='moon'?4.2:5.6)/Math.hypot(...b.orbit[0]);}skyStarted=true;syncSkyControls();resumeSky();}
function applySkyState(){if(!skyStarted)return;const jd=sceneData.jd+skyOffsetDays,follow=positions[mode]?.clone(),states={};for(const b of sceneData.bodies)states[b.id]=SOLE.placeState(b.id,jd).r.map(x=>x/skyAu);
 for(const b of sceneData.bodies){if(['moon','titan'].includes(b.id))continue;positions[b.id].copy(compressed(states[b.id]));meshes[b.id].position.copy(positions[b.id]);}
 for(const id of ['moon','titan']){const b=sceneData.bodies.find(b=>b.id===id),p=states[b.parent],v=states[id].map((x,i)=>(x-p[i])*skyLocalScales[id]);positions[id].copy(positions[b.parent]).add(new THREE.Vector3(v[0],v[2],-v[1]));meshes[id].position.copy(positions[id]);localOrbits[id].position.copy(positions[b.parent]).sub(skyInitialParents[b.parent]);}
 if(follow&&!['system','inner'].includes(mode))target.add(positions[mode].clone().sub(follow));fleet.forEach(s=>s.marker.position.copy(positions[s.parent]).add(s.offset));ringGroup.children.forEach((ring,i)=>ring.position.copy(positions[[bookings[selected].a,bookings[selected].b][i]]));
 const date=new Date((jd-2440587.5)*864e5),clock=document.querySelector('.sky-time time'),iso=date.toISOString();clock.dateTime=iso;const label=date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});const html=label+(skyPlaying?'':' <b>'+iso.slice(11,16)+' UTC</b>');if(clock.innerHTML!==html)clock.innerHTML=html;
}
document.querySelector('#motion-toggle').addEventListener('click',()=>{setSkyPlaying(!skyPlaying);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspendSky();else resumeSky();});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{if(e.matches)setSkyPlaying(false);});
