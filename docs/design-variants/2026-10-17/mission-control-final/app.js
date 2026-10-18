const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const arrow = '<svg class="icon" aria-hidden="true"><use href="#arrow"/></svg>';
const bookings = [
  { id:'SF–2401', from:'Earth', to:'Moon', category:'Crew rotation', people:2, port:'Lunar hub', time:'04:10 UTC', description:'Crew rotation · Shared-flight eligible', passengers:[['M. Chen','Flight engineer'],['A. Okafor','Habitat systems']] },
  { id:'SF–2402', from:'Moon', to:'Earth', category:'Return transfer', people:3, port:'Orbital depot', time:'06:40 UTC', description:'Return transfer · Shared-flight eligible', passengers:[['S. Rao','Geologist'],['J. Park','Field researcher'],['L. Silva','Mission specialist']] },
  { id:'SF–2403', from:'Earth', to:'Moon', category:'Seasonal', people:1, port:'Lunar hub', time:'08:20 UTC', description:'Research team · Seasonal booking', passengers:[['R. Lee','Research specialist']] }
];
const initialEvents = [
  { kind:'agent', time:'03:19', text:'Atlas checked the lunar route.', detail:'SF–01 · Planning complete' },
  { kind:'simulation', time:'03:17', text:'Ceres port is full.', detail:'Next berth opens at 04:30 · Sample forecast' },
  { kind:'agent', time:'03:14', text:'Departure conditions checked.', detail:'Atlas · Earth departure is clear' },
  { kind:'simulation', time:'03:10', text:'A seasonal booking is available.', detail:'SF–2403 · Earth to Moon' }
];
const records = [
  {time:'03:00:00 UTC',state:'Docked',description:'SF–01 is recorded at Orbital depot. No departure event is present.',position:'Orbital depot',event:'State snapshot'},
  {time:'03:04:00 UTC',state:'Hold',description:'The recorded departure hold remains active. The ship stays at Orbital depot.',position:'Orbital depot',event:'Departure hold'},
  {time:'03:08:00 UTC',state:'Hold',description:'A checkpoint records the same hold state. No motion or arrival is inferred.',position:'Orbital depot',event:'Checkpoint'}
];
let selected=0, filter='all', dataState='sample', paused=false, pendingUpdate=false, events=[...initialEvents], recordIndex=0, previousFocus=null, closeTimer=null;
function announce(message){$('#announcement').textContent=message;}
function reveal(el,{distance=0,duration=180}={}){
  el.getAnimations().forEach(a=>a.cancel());
  if(reducedMotion.matches||document.hidden)return;
  el.animate([{opacity:.35,transform:`translateY(${distance}px)`},{opacity:1,transform:'translateY(0)'}],{duration,easing:'cubic-bezier(.16,1,.3,1)'});
}
function showDialog(kind,content){
  clearTimeout(closeTimer);previousFocus=$('#detail-dialog').open?previousFocus:document.activeElement;
  $('#dialog-kind').textContent=kind;$('#dialog-body').innerHTML=content;
  if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
  $('#dialog-close').focus();reveal($('#detail-dialog'),{distance:6,duration:220});
}
function closeDialog(){
  const dialog=$('#detail-dialog');dialog.getAnimations().forEach(a=>a.cancel());
  function done(){dialog.close();previousFocus?.focus();}
  if(reducedMotion.matches){done();return;}
  dialog.animate([{opacity:1},{opacity:0}],{duration:140,easing:'ease-out'});
  closeTimer=setTimeout(done,140);
}
$('#dialog-close').addEventListener('click',closeDialog);
$('#detail-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
$('#detail-dialog').addEventListener('click',e=>{if(e.target===$('#detail-dialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeDialog();}});
$('#detail-dialog').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const items=[...e.currentTarget.querySelectorAll('button,a[href],input,select,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)document.getAnimations().forEach(a=>a.finish());});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)document.getAnimations().forEach(a=>a.finish());});
function renderBookings(){
  const list=$('#booking-list');$('#booking-count').textContent=dataState==='sample'?'03':dataState==='empty'?'00':'—';
  if(dataState==='loading')list.innerHTML='<div class="state-message" role="status"><strong>Loading bookings</strong>Waiting for the next snapshot.</div>'+Array(2).fill('<div class="skeleton" aria-hidden="true"><i></i><i></i></div>').join('');
  else if(dataState==='empty')list.innerHTML='<div class="state-message"><strong>No open bookings</strong>New seasonal bookings will appear here. Your agent can check availability.</div>';
  else if(dataState==='unavailable')list.innerHTML='<div class="state-message"><strong>Bookings unavailable</strong>The connection could not be refreshed. Last snapshot: 03:20 UTC.<button class="text-button" data-retry>Retry connection '+arrow+'</button></div>';
  else list.innerHTML=bookings.map((b,i)=>`<button class="booking" data-booking="${i}" aria-pressed="${i===selected}" aria-label="${b.id}, ${b.from} to ${b.to}, ${b.category}, ${b.people} passengers, ${b.time}"><span class="booking-head"><span>${b.id}</span><span class="booking-category">${b.category}</span></span><span class="booking-route">${b.from}${arrow}${b.to}</span><span class="booking-bottom"><span>${b.people} ${b.people===1?'passenger':'passengers'}</span><span>${b.time}</span></span></button>`).join('');
  list.querySelectorAll('[data-booking]').forEach(button=>button.addEventListener('click',()=>selectBooking(Number(button.dataset.booking))));
  list.querySelector('[data-retry]')?.addEventListener('click',retry);
  $('#more-bookings').hidden=dataState!=='sample';
}
function selectBooking(i){
  selected=i;document.querySelectorAll('[data-booking]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.booking)===i)));
  const b=bookings[i];$('#booking-id').textContent=b.id;$('#route-heading').innerHTML=`${b.from}<svg class="icon route-arrow" aria-hidden="true"><use href="#arrow"/></svg>${b.to}`;
  $('#route-passengers').textContent=b.people+(b.people===1?' person':' people');$('#route-port').textContent=b.port;$('#route-window').textContent=b.time;$('#route-description').textContent=b.description;
  $('#chart-title').textContent=b.from+' to '+b.to+' booking overview';$('#path-caption').textContent=b.from+' to '+b.to+' · Planned';
  $('#route-line').setAttribute('d',i===1?'M578 132C430 71 390 330 260 214':'M260 214C390 330 430 71 578 132');
  $('#map-disclosure span').textContent='Explore '+b.from+' to '+b.to;
  reveal($('.route-facts'));reveal($('#route-line'));
  announce('Selected '+b.id+', '+b.from+' to '+b.to+'. Route details updated.');
}
function renderFeed(){
  const shown=events.filter(e=>filter==='all'||e.kind===filter);const feed=$('#feed');
  if(dataState==='loading')feed.innerHTML='<div class="state-message" role="status"><strong>Loading activity</strong>No events are shown until the connection responds.</div>';
  else if(dataState==='empty')feed.innerHTML='<div class="state-message"><strong>No events yet</strong>Agent decisions and simulation updates will appear here.</div>';
  else if(dataState==='unavailable')feed.innerHTML='<div class="state-message"><strong>Activity unavailable</strong>No live connection. Event freshness cannot be confirmed.<button class="text-button" data-retry>Retry connection '+arrow+'</button></div>';
  else feed.innerHTML=shown.map(e=>`<article class="event"><div class="event-head"><span class="event-kind ${e.kind}">${e.kind==='agent'?'Agent':'Simulation'}</span><time>${e.time} UTC</time></div><p>${e.text}</p><small>${e.detail}</small></article>`).join('');
  feed.querySelector('[data-retry]')?.addEventListener('click',retry);
  $('#feed-count').textContent=dataState==='sample'?shown.length+' events':dataState==='empty'?'0 events':'—';
  $('#feed-caption').textContent=paused?(pendingUpdate?'Paused · 1 sample update waiting':'Activity paused'):'Agent decisions. Simulation events.';
  $('#more-events').hidden=dataState!=='sample'||shown.length<=2;
  $('#sample-update').disabled=dataState!=='sample'||events.length>initialEvents.length||pendingUpdate;
}
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderFeed();reveal($('#feed'),{duration:150});announce('Showing '+(filter==='all'?'agent and simulation':filter)+' events.');}));
$('#pause-feed').addEventListener('click',()=>{paused=!paused;$('#pause-feed').setAttribute('aria-pressed',String(paused));$('#pause-feed').setAttribute('aria-label',paused?'Resume activity updates':'Pause activity updates');$('#pause-feed use').setAttribute('href',paused?'#play':'#pause');if(!paused&&pendingUpdate){pendingUpdate=false;addEvent();}else renderFeed();announce(paused?'Activity updates paused.':'Activity updates resumed.');});
function addEvent(){events.unshift({kind:'agent',time:'03:20',text:'Atlas inspected the passenger manifest.',detail:'SF–2401 · 2 passengers · Sample event'});renderFeed();reveal($('#feed .event'),{duration:180});announce('Sample agent event added.');}
$('#sample-update').addEventListener('click',()=>{if(paused){pendingUpdate=true;renderFeed();announce('One sample update is waiting while paused.');}else addEvent();});
$('#more-bookings').addEventListener('click',()=>{const open=$('.bookings').classList.toggle('expanded');$('#more-bookings').setAttribute('aria-expanded',String(open));$('#more-bookings').innerHTML=(open?'Show fewer bookings':'Show all bookings')+arrow;});
$('#more-events').addEventListener('click',()=>{const open=$('.activity').classList.toggle('expanded');$('#more-events').setAttribute('aria-expanded',String(open));$('#more-events').innerHTML=(open?'Compact activity':'More activity')+arrow;});
$('#map-disclosure').addEventListener('click',()=>{const open=$('.route-panel').classList.toggle('expanded');$('#map-disclosure').setAttribute('aria-expanded',String(open));if(open)reveal($('#route-content'));});
function connection(){showDialog('Bring your own agent',`<h2 id="dialog-title">Connect your agent.</h2><p>Starfare is the observation desk. Your MCP-compatible agent makes the flight decisions.</p><div class="connection-step"><b>1</b><div><p>Choose your agent</p><small>Use a client that supports MCP connectors.</small></div></div><div class="connection-step"><b>2</b><div><p>Add the Starfare connector</p><small>Use the connector address from the application's setup guide. This preview does not configure a connection.</small></div></div><div class="connection-step"><b>3</b><div><p>Start with a clear instruction</p><small>Ask your agent to inspect conditions before planning.</small></div></div><div class="copy-box" id="agent-prompt">Inspect open Starfare bookings and available ships. Check conditions and propose a shared-flight plan before dispatching.</div><button class="button-fill" id="copy-prompt">Copy starter prompt</button><div class="copy-status" role="status" id="copy-status"></div>`);$('#copy-prompt').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#agent-prompt').textContent);$('#copy-status').textContent='Copied. Paste this into your agent client.';}catch{$('#copy-status').textContent='Copy is unavailable. Select and copy the prompt above.';}});}
document.querySelectorAll('[data-connect]').forEach(b=>b.addEventListener('click',connection));
function renderReplay(){const r=records[recordIndex];$('#replay-state').textContent=r.state;$('#replay-time').textContent=r.time;$('#replay-description').textContent=r.description;$('#replay-position').textContent=r.position;$('#replay-event').textContent=r.event;$('#record-count').textContent='Record '+(recordIndex+1)+' of '+records.length;$('#previous-record').disabled=recordIndex===0;$('#next-record').disabled=recordIndex===records.length-1;document.querySelectorAll('.replay-point').forEach((p,i)=>{p.classList.toggle('selected',i===recordIndex);p.setAttribute('aria-current',i===recordIndex?'step':'false');});announce('Replay record '+(recordIndex+1)+'. '+r.time+'. '+r.state+'.');}
function replay(){recordIndex=0;showDialog('Local replay preview',`<h2 id="dialog-title">Flight replay</h2><p>Inspect timestamped sample records. The ship moves only when recorded positions change.</p><div class="replay-label">SAMPLE RECORDS · EXCLUDED FROM ACTIVITY</div><div class="replay-display"><strong id="replay-state"></strong><time id="replay-time"></time><p id="replay-description"></p><h3 id="replay-position"></h3><small class="muted" id="replay-event"></small></div><div class="replay-rail" aria-label="Record position">${records.map((r,i)=>`${i?'<span class="replay-line" aria-hidden="true"></span>':''}<span class="replay-point" aria-label="Record ${i+1}"></span>`).join('')}</div><div class="replay-controls"><button class="button-outline" id="previous-record">Previous record</button><button class="button-outline" id="next-record">Next record</button></div><div class="replay-record-count" id="record-count"></div>`);$('#previous-record').addEventListener('click',()=>{recordIndex=Math.max(0,recordIndex-1);renderReplay();});$('#next-record').addEventListener('click',()=>{recordIndex=Math.min(records.length-1,recordIndex+1);renderReplay();});renderReplay();}
document.querySelectorAll('[data-replay]').forEach(b=>b.addEventListener('click',replay));
$('#fleet-details-button').addEventListener('click',()=>showDialog('Fictional spacecraft · Sample fleet',`<h2 id="dialog-title">Starseeker SF–01</h2><p>Kestrel class · Available at Orbital depot</p><img class="asset-large" src="assets/kestrel.png" width="1536" height="1024" alt="Detailed Kestrel spacecraft, with a broad navy hull and passenger cabin"><h3>A shared journey starts here.</h3><p>A passenger spacecraft concept by Starfare Art. Its cabin, capacity and flight plan are separate: this image does not establish a seat count or performance specification.</p><p>Recorded sample state: docked. Engine and movement effects remain off.</p>`));
$('#credits-button').addEventListener('click',()=>showDialog('Assets & credits',`<h2 id="dialog-title">Built for Starfare.</h2><p>An independent final-look design prototype. No affiliation with SpaceX or xAI.</p><ul class="credits-list"><li>Kestrel: original Starfare Art concept, adapted into a transparent UI cutout using built-in image generation.</li><li><a href="https://science.nasa.gov/earth/earth-observatory/an-epic-new-view-of-earth-86257/" target="_blank" rel="noopener">Earth: DSCOVR EPIC team / NASA</a></li><li><a href="https://science.nasa.gov/resource/moon-mosaic/" target="_blank" rel="noopener">Moon: NASA Scientific Visualization Studio / LRO</a></li><li>Inter: Rasmus Andersson, SIL Open Font License.</li><li>Map positions, connecting lines, times and passenger details are illustrative sample data.</li></ul>`));
const routeMarkup=$('#route-content').innerHTML;
function setDataState(state){
  dataState=state;$('#data-state').value=state;
  if(state==='sample'){
    $('#route-content').innerHTML=routeMarkup;bindRouteControls();selectBooking(selected);
  }else{
    const messages={loading:['Loading route data','Waiting for a verified snapshot. No flight progress is inferred.'],empty:['No route selected','When an open booking is available, select it to see the route and manifest.'],unavailable:['Connection unavailable','The last snapshot cannot be refreshed. Routes are hidden until freshness can be confirmed.']};
    $('#route-content').innerHTML=`<div class="route-unavailable"><svg class="icon" aria-hidden="true"><use href="#link"/></svg><h2 id="route-heading">${messages[state][0]}</h2><p>${messages[state][1]}</p>${state==='unavailable'?'<button class="button-outline" data-retry>Retry connection</button>':''}</div>`;
    $('#route-content [data-retry]')?.addEventListener('click',retry);
  }
  renderBookings();renderFeed();$('#pause-feed').disabled=state!=='sample';announce('Prototype data state: '+state+'.');
}
function bindRouteControls(){
  $('#map-key-button').addEventListener('click',()=>{const open=$('#map-key').hidden;$('#map-key').hidden=!open;$('#map-key-button').setAttribute('aria-expanded',String(open));});
  $('#manifest-button').addEventListener('click',()=>{const b=bookings[selected];showDialog(b.id+' · Sample manifest',`<h2 id="dialog-title">${b.from} to ${b.to}</h2><p>${b.category}. ${b.people} ${b.people===1?'passenger':'passengers'} in this sample booking.</p>${b.passengers.map((p,i)=>`<div class="passenger"><span>${p[0]}<small>${p[1]}</small></span><span>Passenger ${i+1}</span></div>`).join('')}<h3>Shared-flight eligible</h3><p>Your agent plans the seating and stop order. Names and windows are illustrative sample data.</p>`);});
}
function retry(){setDataState('sample');announce('Sample snapshot restored. No real connection was attempted.');}
$('#data-state').addEventListener('change',e=>setDataState(e.target.value));
bindRouteControls();renderBookings();renderFeed();
