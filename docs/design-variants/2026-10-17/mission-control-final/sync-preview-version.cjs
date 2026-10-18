// Update only standalone dependency/version metadata after the safe worktree fast-forward.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const head=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(head!=='ff66fbc4532ec694770099e257dcc7214b9faaa0')throw Error('Unexpected sync target; inspect before updating assets.');
const source=fs.readFileSync(path.join(root,'connector/src/engine/sol-page.cjs')),meta=JSON.parse(fs.readFileSync(path.join(root,'connector/src/engine/meta.json'),'utf8'));
if(sha(source)!==meta.sha256)throw Error('Merged engine differs from its metadata.');
const asset=path.join(__dirname,'assets/sky-engine.js'),beforeHash=sha(fs.readFileSync(asset));fs.copyFileSync(path.join(root,'connector/src/engine/sol-page.cjs'),asset);
const version={kind:'standalone-design-prototype',branch:'codex/design-audit',worktreeCommit:head,mergedMainCommit:head,engineeringCodeCommit:'f0564ba493ba2b5cfcb8fa461674cec8cab4424d',engineSha256:sha(source),previousEngineSha256:beforeHash,backendConnected:false,bookingFixtures:true,illustrativeFlights:true,productionDomIntegrated:false,art:'independent asset revision; existing Kestrel concept derivative reused'};
fs.writeFileSync(path.join(__dirname,'assets/design-version.json'),JSON.stringify(version,null,2));
let html=fs.readFileSync(path.join(__dirname,'canvas.html'),'utf8');html=html.replace('PR12 7839868 <span>· Standalone design</span>','Design ff66fbc <span>· Standalone demo</span>').replace('Design prototype <span>·</span> PR12 7839868','Standalone demo <span>·</span> main ff66fbc');
fs.writeFileSync(path.join(__dirname,'canvas.html'),html);fs.writeFileSync(path.join(__dirname,'index.html'),html);
const E=require(path.join(root,'connector/src/engine/sol-page.cjs')),snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'assets/system-snapshot.json'),'utf8'));
const comparisons=snapshot.bodies.map(b=>({id:b.id,maxDifferenceAu:Math.max(...E.placeState(b.id,snapshot.jd).r.map((v,i)=>Math.abs(v/149597870.7-b.position[i])))}));
if(comparisons.some(c=>c.maxDifferenceAu>1e-10))throw Error('Existing sky snapshot needs numerical review.');
const results={version,copiedEngineMatchesSource:sha(fs.readFileSync(asset))===sha(source),snapshotCompatible:comparisons.every(c=>c.maxDifferenceAu<=1e-10),snapshotComparisons:comparisons,ephemerisRange:E.EPHEM_RANGE};
fs.writeFileSync(path.join(__dirname,'sync-compatibility.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({commit:head,engineSha256:version.engineSha256,copiedEngineMatchesSource:results.copiedEngineMatchesSource,snapshotCompatible:results.snapshotCompatible,bodies:comparisons.length}));
