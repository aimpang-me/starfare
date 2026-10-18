const fs=require('node:fs'),path=require('node:path'),root=__dirname;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),models={},concepts={};
const names={kestrel:'starseeker-01-kestrel.png',tandem:'starseeker-02-tandem.png',lantern:'starseeker-03-lantern.png',wayfarer:'wayfarer-station.png'};
fs.mkdirSync(path.join(root,'concept'),{recursive:true});
for(const m of manifest.models){models[m.id]='data:model/gltf-binary;base64,'+fs.readFileSync(path.join(root,m.file)).toString('base64');const b=fs.readFileSync(path.join(root,'..',names[m.id]));concepts[m.id]='data:image/png;base64,'+b.toString('base64');fs.writeFileSync(path.join(root,'concept',names[m.id]),b);}
let html=fs.readFileSync(path.join(root,'preview.html'),'utf8');
html=html.replace('<script src="vendor/three.min.js"></script>',()=>'<script>window.EMBEDDED_MANIFEST='+JSON.stringify(manifest)+';window.EMBEDDED_MODELS='+JSON.stringify(models)+';window.EMBEDDED_CONCEPTS='+JSON.stringify(concepts)+';</script>\n<script>'+fs.readFileSync(path.join(root,'vendor/three.min.js'),'utf8').replaceAll('</script','<\\/script')+'</script>');
for(const file of ['vendor/GLTFLoader.js','viewer.js'])html=html.replace('<script src="'+file+'"></script>',()=>'<script>'+fs.readFileSync(path.join(root,file),'utf8').replaceAll('</script','<\\/script')+'</script>');
fs.writeFileSync(path.join(root,'standalone-preview.html'),html);console.log('Standalone preview: '+Math.round(Buffer.byteLength(html)/1024/1024)+' MiB; no server required.');
