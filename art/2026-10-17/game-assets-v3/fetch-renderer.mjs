import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const sources=['build/three.min.js','examples/js/loaders/GLTFLoader.js','examples/js/shaders/CopyShader.js','examples/js/shaders/LuminosityHighPassShader.js','examples/js/postprocessing/EffectComposer.js','examples/js/postprocessing/RenderPass.js','examples/js/postprocessing/ShaderPass.js','examples/js/postprocessing/UnrealBloomPass.js','LICENSE'];
const records=await Promise.all(sources.map(async file=>{const url='https://raw.githubusercontent.com/mrdoob/three.js/r128/'+file;const r=await fetch(url);if(!r.ok)throw Error(url+': '+r.status);const data=Buffer.from(await r.arrayBuffer()),name=path.basename(file);fs.writeFileSync(path.join(root,'vendor',name),data);return {file:'vendor/'+name,url,sha256:crypto.createHash('sha256').update(data).digest('hex')};}));
fs.writeFileSync(path.join(root,'vendor','sources.json'),JSON.stringify(records,null,2));
console.log('Saved exact r128 renderer, GLTFLoader and matching postprocessing sources; '+records.length+' files.');
