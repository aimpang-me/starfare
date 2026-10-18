const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const backup = 'C:/Users/PC-AIMPANG/Documents/New project 3/starfare-design-preservation/sync-ff66fbc-20261017';
const before = JSON.parse(fs.readFileSync(path.join(backup, 'before.json'), 'utf8'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding:'utf8'}).trim();
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}
const manifest = files(path.join(__dirname, 'assets')).sort().map(file => ({
  path: path.relative(__dirname, file).replaceAll('\\', '/'),
  bytes: fs.statSync(file).size, sha256: digest(file)
}));
fs.writeFileSync(path.join(__dirname, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const missing = [], changed = [], backupChanged = [];
for (const entry of before.files) {
  const current = path.join(root, entry.path);
  const saved = path.join(backup, 'workspace', entry.path);
  if (!fs.existsSync(current)) missing.push(entry.path);
  else if (digest(current) !== entry.sha256) changed.push(entry.path);
  if (!fs.existsSync(saved) || digest(saved) !== entry.sha256) backupChanged.push(entry.path);
}
const result = {
  verifiedAt: new Date().toISOString(), branch:git('branch','--show-current'),
  head:git('rev-parse','HEAD'), originalCount:before.files.length,
  originalBytes:before.files.reduce((n,e)=>n+e.bytes,0), missing, changed, backupChanged,
  backup, trackedStatus:git('status','--porcelain=v1','--untracked-files=no'),
  mergedMainAncestor: (() => {try {git('merge-base','--is-ancestor',before.target,'HEAD');return true;} catch {return false;}})(),
  copiedEngineMatchesSource: digest(path.join(__dirname,'assets/sky-engine.js')) === digest(path.join(root,'connector/src/engine/sol-page.cjs'))
};
fs.writeFileSync(path.join(__dirname, 'sync-preservation-final.json'), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if (missing.length || backupChanged.length || result.trackedStatus || !result.mergedMainAncestor || !result.copiedEngineMatchesSource) process.exitCode=1;
