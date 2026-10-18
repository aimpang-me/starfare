const fs=require('node:fs'),path=require('node:path'),root=__dirname;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),models={},concepts={};
for(const m of manifest.models){models[m.id]='data:model/gltf-binary;base64,'+fs.readFileSync(path.join(root,m.file)).toString('base64');concepts[m.id]='data:image/png;base64,'+fs.readFileSync(path.join(root,'concept','starseeker-01-kestrel.png')).toString('base64');}
let html=fs.readFileSync(path.join(root,'preview.html'),'utf8');
html=html.replace('<script src="vendor/three.min.js"></script>',()=>'<script>window.EMBEDDED_MANIFEST='+JSON.stringify(manifest)+';window.EMBEDDED_MODELS='+JSON.stringify(models)+';window.EMBEDDED_CONCEPTS='+JSON.stringify(concepts)+';</script>\n<script>'+fs.readFileSync(path.join(root,'vendor/three.min.js'),'utf8').replaceAll('</script','<\\/script')+'</script>');
for(const file of ['vendor/GLTFLoader.js','viewer.js'])html=html.replace('<script src="'+file+'"></script>',()=>'<script>'+fs.readFileSync(path.join(root,file),'utf8').replaceAll('</script','<\\/script')+'</script>');
fs.writeFileSync(path.join(root,'standalone-preview.html'),html);console.log('Embedded offline viewer: '+(Buffer.byteLength(html)/1024/1024).toFixed(1)+' MiB');
