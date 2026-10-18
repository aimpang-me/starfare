// Inventory research/validation artifacts; never scans credentials or application state stores.
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), audit='docs/design-audit/2026-10-17', variants='docs/design-variants';
const manifest=audit+'/HANDOFF-ARTIFACTS.json', files=[], localOnly=[], omittedCaches=[];
function visit(relative){
  for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
    const p=relative+'/'+entry.name;
    if(entry.name.startsWith('.') || /^(node_modules|cache|profiles?)$/i.test(entry.name)){omittedCaches.push(p);continue;}
    if(entry.isDirectory()){visit(p);continue;}
    if(p===manifest)continue;
    const bytes=fs.readFileSync(path.join(root,p));
    const record={path:p,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    const local=/\/sources\/|\/steam-\d+\.jpg$|\/solar-expanse-page\.html$|\.zip$|\.log$|\/app-process\.json$|\/local-(earth-)?flight\.json$|\/full-interrupted\.tap$/.test(p);
    record.role=local?'preserved local research or runtime state':p.includes('/planet-effects/')?'current all-world validation':p.startsWith(variants)?'historical standalone prototype':'historical audit and integration evidence';
    (local?localOnly:files).push(record);
  }
}
visit(audit);visit(variants);files.sort((a,b)=>a.path.localeCompare(b.path));localOnly.sort((a,b)=>a.path.localeCompare(b.path));
const result={createdAt:new Date().toISOString(),implementationCommit:'5cb1ab9',note:'Historical screenshots/prototypes are not claims about current production. Sources/runtime logs stay local. Hidden browser/tool caches excluded without reading them. Regenerate after final captures/tests.',files,localOnly,omittedCaches};
fs.writeFileSync(path.join(root,manifest),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({files:files.length,bytes:files.reduce((a,b)=>a+b.bytes,0),localOnlyFiles:localOnly.length,localOnlyBytes:localOnly.reduce((a,b)=>a+b.bytes,0)}));
if(process.argv.includes('--stage')){
  const {execFileSync}=require('node:child_process');
  for(let i=0;i<files.length;i+=40)execFileSync('git',['add','--',...files.slice(i,i+40).map(x=>x.path)],{cwd:root,stdio:'pipe'});
  execFileSync('git',['add','--',manifest],{cwd:root,stdio:'pipe'});
}
