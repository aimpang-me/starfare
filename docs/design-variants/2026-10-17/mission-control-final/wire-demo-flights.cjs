// Guarded, one-time wiring of explicit visual demos into the standalone preview.
const fs=require('node:fs');
for(const name of ['solar.js','sky-motion.js'])fs.copyFileSync(name,name.replace('.js','-docked.js'));
let html=fs.readFileSync('canvas.html','utf8');fs.writeFileSync('canvas-docked.html',html.replace('src="solar.js"','src="solar-docked.js"').replace('src="sky-motion.js"','src="sky-motion-docked.js"'));
html=html.replace('href="living.css">','href="living.css"><link rel="stylesheet" href="demo-flights.css">');
html=html.replace(' <button class="quiet ui-toggle"',` <div class="demo-controls"><label><input id="demo-enabled" type="checkbox" checked><span>Demo flights<small>Illustrative paths</small></span></label><button id="demo-restart" aria-label="Restart demo flights" title="Restart demo flights"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a8 8 0 1 1-1 8M5 3v5h5"/></svg></button></div>
 <button class="quiet ui-toggle"`);
html=html.replace('src="sky-motion.js"','src="demo-flights.js"></script><script src="sky-motion.js"');html=html.replace('> Sample spacecraft</label>','> Spacecraft</label>');
fs.writeFileSync('canvas.html',html);fs.writeFileSync('index.html',html);
let s=fs.readFileSync('solar.js','utf8');function sub(a,b){if(!s.includes(a))throw new Error('Missing source fragment '+a.slice(0,70));s=s.replace(a,b);}
sub('function inspectShip(ship){dialog(', 'function inspectShip(ship){if(ship.demoActive){inspectDemo(ship);return;}dialog(');
sub('worldReady=true;$(\'#scene-loading\').hidden=true;startSkyPreview();', 'worldReady=true;$(\'#scene-loading\').hidden=true;initDemoFlights();startSkyPreview();');
sub('.ship-card,.camera-presets,.map-tools', '.ship-card,.camera-presets,.map-tools,.demo-controls');
sub("(['system','inner'].includes(mode)||ship.parent===viewParent)","(ship.demoActive||['system','inner'].includes(mode)||ship.parent===viewParent)");
sub('if(!visible){ship.label.hidden=true;continue;}\n  const candidates=',`if(!visible){ship.label.hidden=true;continue;}
  if(ship.demoActive){const rect={x:p.x-w/2,y:p.y-h/2,w,h};ship.label.hidden=false;ship.label.style.transform=\`translate3d(\${rect.x}px,\${rect.y}px,0)\`;const d=ship.demo,tangent=d.curve.getTangentAt(d.eased).multiplyScalar(d.returning?-1:1),q=projected(ship.marker.position.clone().add(tangent)),dx=q.x-p.x,dy=q.y-p.y,angle=Math.max(-.22,Math.min(.22,Math.atan2(-dy,Math.abs(dx))));ship.label.querySelector('img').style.transform=\`scaleX(\${dx>0?-1:1}) rotate(\${angle}rad)\`;used.push(rect);continue;}
  const candidates=`);
sub('No booking flight path is inferred.', 'Optional demo paths are illustrative and are never dispatched or recorded flights.');
sub('// Frozen ephemeris scene. Camera controls only: no timeline loop or inferred spacecraft motion.', '// Engine-driven sky, with explicitly separate local demo motion. No real flight is inferred.');
sub('skyPlaying,skyOffsetDays,currentEpoch:', 'skyPlaying,skyOffsetDays,demoEnabled,demoElapsedSeconds,demoFlights:fleet.filter(s=>s.demoActive).map(s=>({id:s.demo.id,position:s.marker.position.toArray(),progress:s.demo.progress,stopped:s.demo.stopped,returning:s.demo.returning})),currentEpoch:');
fs.writeFileSync('solar.js',s);
s=fs.readFileSync('sky-motion.js','utf8');
s=s.replace("skyPlaying?'Pause sky preview':'Play sky preview'", "skyPlaying?'Pause preview motion':'Play preview motion'");
s=s.replace("b.title=skyPlaying?'Pause sky preview':'Play sky preview'", "b.title=skyPlaying?'Pause preview motion':'Play preview motion'");
s=s.replace("function syncSkyControls(){", "function syncSkyControls(){document.body.classList.toggle('demo-playing',skyPlaying);");
s=s.replace('if(skyLastTick)skyOffsetDays+=(now-skyLastTick)/1000*SKY_DAYS_PER_SECOND;', 'if(skyLastTick){const dt=(now-skyLastTick)/1000;skyOffsetDays+=dt*SKY_DAYS_PER_SECOND;if(demoEnabled)demoElapsedSeconds+=dt;}');
s=s.replace('fleet.forEach(s=>s.marker.position.copy(positions[s.parent]).add(s.offset));', 'fleet.forEach(s=>s.marker.position.copy(positions[s.parent]).add(s.offset));updateDemoFlights();');
fs.writeFileSync('sky-motion.js',s);
