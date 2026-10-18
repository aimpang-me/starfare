// One-time, guarded migration of the standalone canvas to the living refinement.
const fs=require('node:fs');let s=fs.readFileSync('solar.js','utf8');
function replace(a,b){if(!s.includes(a))throw new Error('Expected source fragment missing: '+a.slice(0,75));s=s.replace(a,b);}
replace('worldReady=true;$(\'#scene-loading\').hidden=true;','worldReady=true;$(\'#scene-loading\').hidden=true;startSkyPreview();');
replace('shipPosition:shipMarker.position.toArray(),target:target.toArray()',`shipPosition:shipMarker.position.toArray(),target:target.toArray(),skyPlaying,skyOffsetDays,currentEpoch:new Date((sceneData.jd+skyOffsetDays-2440587.5)*864e5).toISOString(),earthPosition:positions.earth.toArray(),ships:fleet.map(s=>({id:s.id,visible:!s.label.hidden,offset:s.marker.position.clone().sub(positions[s.parent]).toArray()})),bodyPixels:Object.fromEntries(Object.entries(meshes).map(([id,m])=>[id,m.scale.x/(camera.top-camera.bottom)*height*2]))`);
replace('Camera movement does not advance time. No booking flight path is inferred.', 'Sky preview advances the engine ephemeris at one simulated day per real second. Pause freezes sky time. No booking flight path is inferred.');
replace('Planet locations are extracted from the baseline Starfare engine at 10 Sep 2033, 03:20 UTC.', 'Planet locations use the baseline Starfare engine, starting at 10 Sep 2033, 03:20 UTC.');
replace('The solar system remains at the labeled frozen snapshot.', 'Sky playback is suspended while inspecting these records.');
replace('Position from the frozen engine snapshot.', 'Position from the engine-driven sky preview.');
replace('Sky time unchanged.', 'Camera adjusted.');
const staticStart=' const moonPts=Array.from({length:129}';const start=s.indexOf(staticStart),end=s.indexOf("for(const id of ['moon','titan']){const b=sceneData.bodies.find",start);
if(start<0||end<0)throw new Error('Moon orbit initialization missing');s=s.slice(0,start)+' '+s.slice(end);
fs.writeFileSync('solar.js',s);
let h=fs.readFileSync('canvas-static.html','utf8').replace('href="solar.css"','href="solar-static.css"').replace('src="solar.js"','src="solar-static.js"');fs.writeFileSync('canvas-static.html',h);
fs.copyFileSync('canvas.html','index.html');
