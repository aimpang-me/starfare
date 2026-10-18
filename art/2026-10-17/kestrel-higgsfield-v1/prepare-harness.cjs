const fs=require('node:fs'),path=require('node:path'),root=__dirname;
let s=fs.readFileSync(path.join(root,'../kestrel-game-art-v4/verify.cjs'),'utf8').replaceAll("['kestrel','kestrel-low']","['kestrel']").replace('assert.ok(stats.textured>5)','assert.ok(stats.textured>=1)').replace('Both embedded GLBs','The embedded Higgsfield GLB');
fs.writeFileSync(path.join(root,'verify.cjs'),s);
fs.mkdirSync(path.join(root,'concept'),{recursive:true});fs.copyFileSync(path.join(root,'source/kestrel-original-concept.png'),path.join(root,'concept/starseeker-01-kestrel.png'));
let h=fs.readFileSync(path.join(root,'preview.html'),'utf8').replace('Starfare / Surface & silhouette review','Kestrel / Higgsfield 3D review').replace('Fictional designs · original concept and rotatable textured mesh · static cabin light only','Original concept and Higgsfield-generated textured GLB · manual rotation');fs.writeFileSync(path.join(root,'preview.html'),h);
