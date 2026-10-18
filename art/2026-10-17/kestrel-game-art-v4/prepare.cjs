const fs=require('node:fs'),path=require('node:path'),root=__dirname;
const sharp=require('C:/Users/PC-AIMPANG/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
async function run(){
 // New procedural surface maps, with no baked lighting or imagery. Geometry supplies the seams.
 const N=512,base=Buffer.alloc(N*N*3),norm=Buffer.alloc(N*N*3),mr=Buffer.alloc(N*N*3),ao=Buffer.alloc(N*N*3,255),alloy=Buffer.alloc(N*N*3);
 let seed=8135;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){let i=(y*N+x)*3,g=(rnd()-.5)*2.1,b=150+g;for(let c=0;c<3;c++){base[i+c]=b;alloy[i+c]=191+Math.sin(y*1.8)*1.2+g;}norm[i]=128+(rnd()-.5)*2;norm[i+1]=128+(rnd()-.5)*2;norm[i+2]=255;mr[i]=255;mr[i+1]=145+(rnd()-.5)*9;mr[i+2]=235;}
 for(const [name,data]of [['hull-basecolor',base],['hull-normal',norm],['hull-metalrough',mr],['hull-occlusion',ao],['alloy-basecolor',alloy]])await sharp(data,{raw:{width:N,height:N,channels:3}}).png().toFile(path.join(root,'textures',name+'.png'));
 fs.mkdirSync(path.join(root,'concept'),{recursive:true});const concept=path.join(root,'concept','starseeker-01-kestrel.png');if(!fs.existsSync(concept))fs.copyFileSync(path.join(root,'..','starseeker-01-kestrel.png'),concept);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
