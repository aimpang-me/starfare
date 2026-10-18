// Source-directed Kestrel reconstruction. All panelwork and machinery is exported geometry.
export function detailedModels(api,D){
 const {mesh,materials,add,mul,sub,unit,cross,box,beam,loft,bevelBox,radiusAt,getParts,getSockets}=api;
 let low=false;
 const outline=[[-4.05,2.72,.25],[-3.8,3.27,.31],[-3.1,3.87,.34],[-2.25,4.12,.36],[-1.5,3.73,.4],[-.6,3.05,.42],[.5,2.38,.4],[1.7,1.67,.34],[2.8,1.02,.27],[3.9,.49,.19],[4.75,.19,.13]];
 // A shallow central stern notch leaves the two rear shrouds as the aftmost silhouette.
 function stern(p){return [p[0],p[1],p[2]+.78*Math.exp(-(p[2]+4.05)/.36)*Math.max(0,1-(Math.abs(p[0])/2.72)**4)];}
 function map(a,z){const [rx,ry]=radiusAt(outline,z),co=Math.cos(a),si=Math.sin(a);return stern([Math.sign(co)*Math.abs(co)**.62*rx,Math.sign(si)*Math.abs(si)**.62*ry,z]);}
 function strip(name,mat,fn,a,b,z0,z1,ns=1,nz=40){
  const p=[],ix=[],uv=[];for(let j=0;j<=nz;j++)for(let i=0;i<=ns;i++){const u=a+(b-a)*i/ns,z=z0+(z1-z0)*j/nz;p.push(...fn(u,z));uv.push(u*.31,z*.19);}
  for(let j=0;j<nz;j++)for(let i=0;i<ns;i++){const n=j*(ns+1)+i;ix.push(n,n+1,n+ns+1,n+1,n+ns+2,n+ns+1);}mesh(name,mat,p,ix,true,uv);
 }
 function rect(map,u0,u1,z0,z1,mat,h=.009,name='Nested access cover'){D.patch(name,mat,map,u0,u1,z0,z1,h);}
 function trimLine(name,mat,a,z0,z1,r=.012){let prev;for(let z=z0;z<=z1+.001;z+=(z1-z0)/32){const p=D.point(map,a,z,.018);if(prev)D.cylinder(name,mat,prev,p,r,low?4:6);prev=p;}}
 function canopy(){
  const prof=[[-1.45,.15,.055],[-1.2,.43,.25],[-.65,.60,.40],[.3,.64,.43],[1.4,.56,.37],[2.4,.39,.21],[2.8,.15,.035]],c=[0,.397,0],N=low?20:40;
  const cm=(a,z)=>{const [w,h]=radiusAt(prof,z);return [Math.cos(a)*w,c[1]+Math.sin(a)*h,z];};
  // Open upper half only: the painted hull is never used as a glass backplane.
  strip('Continuous smoked panoramic pressure glazing',4,cm,0,Math.PI,prof[0][0],prof.at(-1)[0],N,low?18:38);
  for(const side of [-1,1]){
   let prev;for(let z=-1.42;z<2.81;z+=.07){const [w]=radiusAt(prof,z),p=[side*w,.405,z];if(prev)D.cylinder('Continuous satin canopy sill',2,prev,p,.028,6);prev=p;}
   beam('Recessed warm cabin light rail',10,[side*.43,.447,-.8],[side*.43,.447,2.1],.018,.017);
  }
  for(let z=-1;z<2.5;z+=.49){let prev;for(let j=0;j<=N;j++){const p=add(cm(Math.PI*j/N,z),[0,.005,0]);if(prev)D.cylinder('Slim graphite pressure-glass mullion',8,prev,p,.012,low?4:6);prev=p;}}
  bevelBox('Cabin recessed charcoal floor',11,[0,.403,.65],[.98,.035,3.42],.01);
  for(let z=-.65;z<2.0;z+=.45)for(const side of [-1,1]){
   const x=side*.27;
   bevelBox('Contoured warm leather seat cushion',9,[x,.48,z],[.26,.085,.28],.035);
   bevelBox('Contoured warm leather seat back',9,[x,.57,z-.13],[.27,.2,.075],.025);
   for(const dx of [-.15,.15])bevelBox('Seat armrest',8,[x+dx,.535,z-.01],[.025,.025,.19],.006);
   if(!low){D.cylinder('Seat support pedestal',8,[x,.41,z],[x,.45,z],.032,6);beam('Cabin side console',8,[side*.47,.46,z-.12],[side*.47,.46,z+.15],.04,.07);}
  }
 }
 function shroud(side){
  const c=[side*2.35,.28,-2.6],prof=[[-1.5,.54,.96],[-1.3,.58,.97],[-.93,.56,.84],[.0,.47,.41],[.97,.2,.10],[1.2,.08,.025]],N=low?24:48;
  const sm=D.hullMap(c,prof,.25);
  // An angular tall stern frame and long sloping hood, rather than a rounded engine pod.
  loft('Angular rising aft shroud',0,c,prof,N,p=>p,true,.25);
  const filter=(a,z)=>!(a>.68&&a<2.46&&z>-1.16&&z<-.24);
  for(const q of [0,1])D.grid(sm,q*Math.PI/2+.025,(q+1)*Math.PI/2-.025,-1.42,1.05,2,low?3:6,401+q,filter);
  const inlet=(u,z)=>[c[0]-u,c[1]+radiusAt(prof,z)[1]+.016,c[2]+z];
  D.vent(inlet,-.37,.37,-.90,-.27);
  // Narrow raised titanium hood frame follows the actual surface, with a dark inlet beneath.
  for(const u of [-.41,.41]){let prev;for(let z=-.95;z<-.22;z+=.06){const p=D.point(inlet,u,z,.027);if(prev)D.cylinder('Intake perimeter titanium frame',2,prev,p,.022,6);prev=p;}}
  const rearZ=c[2]-1.517;
  bevelBox('Satin stern nacelle flange',2,[c[0],c[1],rearZ],[1.11,1.93,.075],.09);
  bevelBox('Deep rectangular stern machinery cavity',17,[c[0],c[1],rearZ-.045],[.91,1.67,.025],.09);
  for(let y=-.44;y<1.04;y+=.15){bevelBox('Inset stern heat exchanger blade',16,[c[0],y,rearZ-.068],[.8,.03,.09],.008);}
  for(const x of [-.44,.44]){
   D.cylinder('Aft shroud polished damper',16,[c[0]+x,-.28,rearZ-.075],[c[0]+x,.85,rearZ-.075],.025,8);
   for(const y of [-.22,.82])D.cylinder('Aft damper sleeve',18,[c[0]+x,y-.07,rearZ-.075],[c[0]+x,y+.07,rearZ-.075],.045,8);
  }
  if(!low)for(const x of [-.49,.49])for(const y of [-.51,1.06])D.cylinder('Stern flange fastener',16,[c[0]+x,y,rearZ-.042],[c[0]+x,y,rearZ-.055],.016,6);
  getSockets().push({name:'main_nozzle_'+(side>0?'port':'starboard'),translation:[c[0],c[1],rearZ-.1],axis:[0,0,-1],kind:'propulsion',enabled:false});
 }
 function kestrel(isLow=false){
  low=isLow;D.quality(low);
  // Materials are intentionally dark painted alloy; bevels catch the studio/solar key light.
  for(const [i,c]of [[0,[.025,.045,.075,1]],[1,[.012,.021,.036,1]],[12,[.027,.047,.076,1]],[13,[.021,.038,.063,1]],[14,[.017,.030,.048,1]],[15,[.033,.053,.080,1]]]){
   materials[i].pbrMetallicRoughness.baseColorFactor=c;materials[i].pbrMetallicRoughness.metallicFactor=.85;materials[i].pbrMetallicRoughness.roughnessFactor=1.0;materials[i].normalTexture.scale=.12;
  }
  materials[4].pbrMetallicRoughness={baseColorFactor:[.027,.051,.073,.68],metallicFactor:.18,roughnessFactor:.09};
  materials[2].pbrMetallicRoughness.baseColorFactor=[.66,.71,.78,1];materials[2].pbrMetallicRoughness.roughnessFactor=.29;
  materials[8].pbrMetallicRoughness.baseColorFactor=[.045,.075,.11,1];
  const dense=[];for(let z=-4.05;z<4.75;z+=low?.45:.16)dense.push([z,...radiusAt(outline,z)]);dense.push(outline.at(-1));
  loft('Low-slung sculpted arrowhead monocoque',0,[0,0,0],dense,low?40:80,stern,true,.62);
  loft('Satin titanium wraparound perimeter belt',2,[0,-.12,0],dense.map(([z,x,y])=>[z,x*1.003,y*.40]),low?40:80,stern,true,.62);
  loft('Graphite ventral pressure keel',1,[0,-.18,0],dense.map(([z,x,y])=>[z,x*.84,y*.53]),low?32:48,stern,true,.62);
  const filter=(a,z)=>{const p=map(a,z);return !(p[1]>.0&&Math.abs(p[0])<.72&&z>-1.6&&z<2.95);};
  // Structured large armor plates follow the delta's surface. Fine seams come from gaps in geometry.
  for(let q=0;q<4;q++)D.grid(map,q*Math.PI/2+.022,(q+1)*Math.PI/2-.022,-3.95,4.63,low?2:5,low?7:16,12+q*41,filter);
  const rearDeck=(u,z)=>[z,.425,u];D.grid(rearDeck,-3.25,-1.55,-.85,.85,low?2:4,low?2:4,721);
  for(const side of [-1,1]){
   shroud(side);
   const aa=side>0?.15:Math.PI-.15;
   trimLine('Inset cyan painted perimeter stripe',6,aa,-3.65,4.46,.011);
   // A fitted segmented edge band instead of floating windows at a guessed hull width.
   for(let z=-3.5;z<4.35;z+=low?.7:.43){
    const a=side>0?.055:Math.PI-.27;D.patch('Fitted satin edge armor',2,map,a,a+.215,z,z+.37,.018);
   }
   for(let z=-1.1;z<3.5;z+=.34){const a=side>0?.018:Math.PI-.018,p=D.point(map,a,z,.025);bevelBox('Warm recessed flank window',5,[p[0],-.025,p[2]],[.018,.053,.17],.006);}
   // Purposeful maintenance wells, each framed by a cover, gasket, hinge and captive screws.
   for(const [z,a]of [[-2.8,.47],[-1.4,.73],[.1,.64],[1.5,.54],[3.25,.50]]){
    const aa=side>0?a:Math.PI-a;
    rect(map,aa-.12,aa+.12,z-.24,z+.24,17,.024,'Recessed pressure hatch gasket');
    rect(map,aa-.105,aa+.105,z-.22,z+.22,16,.032,'Machined service hatch rim');
    rect(map,aa-.092,aa+.092,z-.20,z+.20,14,.038,'Navy flush access cover');
    for(const dz of [-.15,.15]){D.bolt(map,aa-.075,z+dz,.012);D.bolt(map,aa+.075,z+dz,.012);}
    D.cylinder('Hatch recessed latch',16,D.point(map,aa,z-.09,.045),D.point(map,aa,z+.03,.045),.012,6);
   }
   for(const z of [-2.1,.4,2.5]){const a=side>0?.32:Math.PI-.32;D.vent(map,a-.095,a+.095,z-.21,z+.21);}
   if(!low){
    for(const z of [-2.6,-.9,1.0]){const a=side>0?3.55:5.88;const pts=[z-.24,z,z+.28].map(zz=>D.point(map,a,zz,.055));D.pipe(pts,.019,16);for(const p of [pts[0],pts[2]])bevelBox('Ventral conduit clamp',18,p,[.06,.04,.07],.009);}
   }
  }
  // Detailed central underside docking service bay is geometry, with no active effects.
  bevelBox('Ventral docking service well',17,[0,-.405,.0],[1.1,.06,1.5],.1);
  for(const x of [-.42,.42]){D.cylinder('Docking carriage guide',16,[x,-.45,-.55],[x,-.45,.55],.04,8);for(const z of [-.45,.45])bevelBox('Docking slide bracket',8,[x,-.44,z],[.13,.09,.19],.02);}
  bevelBox('Ventral closed docking hatch',14,[0,-.45,0],[.64,.045,.85],.055);
  canopy();
  loft('Machined blunt bow cap',2,[0,0,0],[[4.5,.30,.16],[4.7,.22,.145],[4.78,.19,.13]],low?24:40,p=>p,true,.40);
  loft('Recessed graphite bow service aperture',17,[0,0,4.785],[[-.005,.134,.085],[.005,.134,.085]],16,p=>p,true,.32);
  for(let y=-.05;y<=.05;y+=.025)beam('Bow service grille',16,[-.10,y,4.795],[.10,y,4.795],.009,.007);
  getSockets().push({name:'dock_collar',translation:[0,-.49,0],axis:[0,-1,0],kind:'docking',enabled:false});
 }
 return {kestrel:()=>kestrel(false),kestrelLow:()=>kestrel(true)};
}
