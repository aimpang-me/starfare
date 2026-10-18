export function detailedModels(api,D){
const {add,sub,mul,unit,box,beam,tube,loft,ringSegment,bevelBox,passengerHull,lounge,nozzle,fixture,radiusAt,kestrelV2,tandemV2,lanternV2,getParts,getSockets}=api,TAU=Math.PI*2;
function kestrel(){
 kestrelV2();const profile=[[-4,1.2,.31],[-3.7,2.25,.39],[-2.8,3.9,.39],[-2.1,4.15,.4],[-.8,3.2,.47],[1.1,2.1,.46],[2.8,1.15,.34],[4.2,.48,.22],[4.8,.17,.16]],map=D.hullMap([0,0,0],profile,.62);
 D.hull([0,0,0],profile,8.8,17,(a,z)=>{const p=map(a,z);return !(p[1]>.12&&Math.abs(p[0])<.71&&z>-1.3&&z<3.3);},.62);
 for(const side of [-1,1]){
  for(let z=-2.7;z<3.4;z+=.55){const aa=side>0?.11:Math.PI-.40;D.patch('Segmented silver perimeter armor',2,map,aa,aa+.29,z,z+.52,.032);}
  const c=[side*2.18,.43,-2.45],shroud=[[-1.45,.62,.78],[-1.17,.67,.79],[.1,.54,.35],[1.23,.13,.05]],m=D.hull(c,shroud,2.68,37,(a,z)=>!(a>Math.PI*.36&&a<Math.PI*.64&&z>-.78&&z<-.02),.28);
  D.vent(m,Math.PI*.36,Math.PI*.64,-.75,-.05);
  for(const a of [.18,Math.PI-.18])D.pipe([D.point(m,a,-1.2,.04),D.point(m,a,-.3,.04),D.point(m,a,.35,.04)],.018,16);
  for(let z=-2;z<2.5;z+=.9){const a=side>0?.65:Math.PI-.65;D.vent(map,a-.15,a+.15,z,z+.35);}
  // Fine inboard hydraulic lines are visible from the rear and underside.
  D.pipe([[side*.7,-.36,-3.7],[side*1.35,-.39,-2.7],[side*1.2,-.36,-.6]],.025,18);
 }
 loft('Machined bow cap',2,[0,0,0],[[4.4,.36,.2],[4.65,.24,.18],[4.81,.17,.16]],32,p=>p,true,.62);
 loft('Dark recessed bow service port',17,[0,0,4.815],[[-.004,.119,.102],[.004,.119,.102]],16,p=>p,true,.35);
 for(const side of [-1,1])D.pipe([[side*.31,-.33,3.8],[side*.58,-.38,1.6],[side*.56,-.4,-1.4]],.018,16);
}
function tandem(){
 tandemV2();
 for(const side of [-1,1]){
  D.drive([side*1.9,0,-5.11],.78);
  for(const z of [-1.55,1.05])D.docking([side*2.93,0,z],side);
  D.pipe([[side*2.39,-.52,-4.45],[side*2.45,-.53,-2.7],[side*2.45,-.53,.2]],.022,18);
  D.pipe([[side*1.47,-.55,-4.4],[side*1.41,-.55,-3.5],[side*1.41,-.52,.9]],.022,16);
  // Nested drive service panels and radial clamp hardware.
  for(let j=0;j<12;j++){const a=j/12*TAU;D.cylinder('Drive service union',16,[side*1.9+Math.cos(a)*.74,Math.sin(a)*.65,-4.45],[side*1.9+Math.cos(a)*.74,Math.sin(a)*.65,-4.18],.025,6);}
 }
 for(const [z,w]of [[1.2,1.1],[-3.45,.44]]){
  D.flatTop([0,0,z],3.5,w,.454,73);
  for(const side of [-1,1]){
   const map=(u,v)=>[v,.463,z+u];D.vent(map,-w*.33,w*.33,side*.98-.2,side*.98+.2);
   D.cylinder('Bridge undercarriage damper',16,[side*.5,-.16,z],[side*1.1,-.23,z],.06,10);
   D.cylinder('Bridge damper polished shaft',2,[side*1.1,-.23,z],[side*1.47,-.15,z],.033,10);
  }
 }
 // Correct the overly broad v2 planform to the concept's long, narrow twin hulls.
 for(const p of getParts()){
  for(let i=0;i<p.p.length;i+=3){p.p[i]*=.6;p.p[i+1]*=.86;const n=unit([p.n[i]/.6,p.n[i+1]/.86,p.n[i+2]]);p.n.splice(i,3,...n);}
 }
 for(const s of getSockets()){s.translation[0]*=.6;s.translation[1]*=.86;}
}
function lantern(){
 lanternV2();
 const spine=[[-4,.29,.29],[2.5,.29,.29]];D.hull([0,0,-.35],spine,6.5,123,()=>true,.72);
 for(const a of [Math.PI/6,Math.PI*5/6,Math.PI*1.5]){
  const co=Math.cos(a),si=Math.sin(a);
  D.pipe([[co*.39,si*.39,2.2],[co*.43,si*.43,.9],[co*.43,si*.43,-2.7],[co*.68,si*.68,-3.7]],.045,16);
  D.pipe([[co*.56,si*.56,.8],[co*.58,si*.58,-1.65],[co*.62,si*.62,-3.1]],.025,18);
  for(const z of [-2.4,-1.7,.9,1.65]){
   D.cylinder('Spine hydraulic housing',18,[co*.5,si*.5,z-.13],[co*.5,si*.5,z+.13],.085,10);
   D.cylinder('Spine hydraulic piston',16,[co*.5,si*.5,z+.13],[co*.5,si*.5,z+.32],.04,10);
  }
 }
 for(let j=0;j<3;j++){
  const a=Math.PI/2+j*TAU/3,c=[Math.cos(a)*1.56,Math.sin(a)*1.56,-.12];
  for(const z of [-1.25,.8]){
   const end=add(c,[0,0,z+.12]);D.pipe([[0,0,z],[c[0]*.45,c[1]*.45,z+.15],end],.034,18);
   for(const dx of [-.07,.07])D.cylinder('Pod suspension piston',16,[dx,0,z-.14],add(end,[dx,0,-.15]),.033,8);
  }
 }
 const tri=[[0,1.92,-4.3],[-1.67,-.97,-4.3],[1.67,-.97,-4.3]];
 for(let i=0;i<3;i++){
  const a=tri[i],b=tri[(i+1)%3],d=sub(b,a),n=unit([d[1],-d[0],0]);
  for(let k=0;k<9;k++){const mid=add(a,mul(d,(k+.5)/9));bevelBox('Tail frame inset service tile',k%3?14:16,add(mid,[0,0,.17]),[.1,.1,.025],.015);D.cylinder('Tail frame captive fastener',16,add(mid,[0,0,-.13]),add(mid,[0,0,-.14]),.012,6);}
  const p0=add(a,mul(n,.02)),p1=add(b,mul(n,.02));D.pipe([add(p0,[0,0,.14]),add(p1,[0,0,.14])],.018,18);
 }
 D.drive([0,0,-4.38],.78);
 for(const z of [-3.3,-2.65,1.15])tube('Segmented spine structural collar',2,[0,0,z],.43,.34,.18);
}
function wayfarer(){
 const begin=Math.PI/4,end=TAU-Math.PI/4,count=9,r=3.8;
 for(let k=0;k<count;k++){
  const a=begin+(end-begin)*k/count,b=begin+(end-begin)*(k+1)/count;
  ringSegment('Beveled concourse roof',0,a+.006,b-.006,r,1.16,.35,.43);
  ringSegment('Concourse lower armored deck',14,a+.006,b-.006,r,1.16,.25,-.48);
  ringSegment('Central two-deck spandrel',8,a+.006,b-.006,r,1.15,.085,-.025);
  ringSegment('Load-bearing titanium module rib',2,a-.014,a+.014,r,1.21,1.24);
  const top=(u,v)=>[u*Math.sin(v),.61,u*Math.cos(v)];
  D.grid(top,3.39,4.21,a+.03,b-.03,3,3,201+k);
  for(const rr of [3.215,4.385]){
   const outer=rr>r,dir=outer?1:-1;
   // Warm room backplanes, glazing and real interior partitions produce layered windows.
   for(let w=0;w<10;w++){
    const aa=a+.032+(b-a-.064)*w/10,bb=aa+(b-a-.064)/10*.93,mid=(aa+bb)/2;
    for(const y of [-.225,.175]){
     ringSegment('Warm cabin interior backplane',w%4?19:5,aa,bb,rr-dir*.1,.014,.22,y);
     ringSegment('Panoramic smoke glass',20,aa,bb,rr+dir*.012,.012,.235,y);
     const point=rad=>[rad*Math.sin(mid),y-.075,rad*Math.cos(mid)];
     box('Window-side interior console',9,point(rr-dir*.045),[.06,.06,.06]);
    }
    ringSegment('Window vertical titanium mullion',8,aa,aa+.004,rr+dir*.027,.022,.64,-.025);
   }
   for(const y of [-.365,-.08,.04,.31])ringSegment('Glazing continuous pressure sill',16,a+.025,b-.025,rr+dir*.018,.027,.025,y);
   const wall=(u,v)=>[rr*Math.sin(v),outer?u:-u,rr*Math.cos(v)];
   for(const y of [-.47,.43])D.grid(wall,outer?y-.055:-y-.055,outer?y+.055:-y+.055,a+.04,b-.04,1,5,307+k);
  }
  // Rib latch blocks, clamps, dorsal access hatches and conduits.
  for(const dr of [-.39,.39]){
   const p=[(r+dr)*Math.sin(a),.64,(r+dr)*Math.cos(a)];bevelBox('Rib upper locking clamp',16,p,[.095,.045,.13],.012);
   D.cylinder('Rib clamp fastener',2,add(p,[0,.025,0]),add(p,[0,.031,0]),.014,6);
  }
  const mid=(a+b)/2;D.pipe([[3.38*Math.sin(a+.025),.54,3.38*Math.cos(a+.025)],[3.38*Math.sin(mid),.54,3.38*Math.cos(mid)],[3.38*Math.sin(b-.025),.54,3.38*Math.cos(b-.025)]],.016,18);
  if(k%3===0)fixture('nav_ring_'+k,[r*Math.sin(mid),.67,r*Math.cos(mid)]);
 }
 ringSegment('Last load-bearing module rib',2,end-.014,end+.014,r,1.21,1.24);
 for(const a of [begin,end]){
  const tangent=[Math.cos(a),0,-Math.sin(a)],sign=a===begin?-1:1;
  for(const y of [-.225,.175]){
   const c=[r*Math.sin(a),y,r*Math.cos(a)];
   beam('End cap warm room',19,add(c,mul([Math.sin(a),0,Math.cos(a)],-.38)),add(c,mul([Math.sin(a),0,Math.cos(a)],.38)),.012,.22);
   beam('End panoramic glass',20,add(add(c,mul(tangent,sign*.085)),mul([Math.sin(a),0,Math.cos(a)],-.4)),add(add(c,mul(tangent,sign*.025)),mul([Math.sin(a),0,Math.cos(a)],.4)),.025,.235);
  }
 }
 bevelBox('Offset service spine armored base',0,[-4.7,.02,-.7],[2.6,.7,2.65],.14);D.flatTop([-4.7,0,-.7],2.5,2.55,.39,401);
 for(const z of [-1.65,-.7,.25]){
  bevelBox('Service trunk shoulder',13,[-4.78,.18,z],[2.35,.55,.65],.1);
  tube('Berth outer flange',2,[-6.03,0,z],.43,.33,.25,'x');tube('Berth throat',17,[-5.72,0,z],.34,.28,.55,'x');D.drive([-6.18,0,z],.42,'x');tube('Dock mechanism protective sleeve',8,[-6.17,0,z],.44,.36,.38,'x');
  for(const y of [-.27,.27])D.pipe([[-5.95,y,z+.2],[-5.3,y,z+.2],[-4.1,y,z+.2]],.021,16);
  const map=(u,v)=>[-4.65+v,.485,z+u];D.vent(map,-.15,.15,-.65,.65);
  getSockets().push({name:'dock_collar_'+z,translation:[-6.18,0,z],axis:[-1,0,0],kind:'docking',enabled:false});
 }
 // The concept's operations cupola is a layered low turret, not a clear bubble.
 loft('Operations cupola base',2,[-3.8,.53,-1.42],[[-.48,.32,.18],[-.24,.49,.28],[.24,.49,.28],[.48,.32,.18]],32);
 lounge('Station operations glazing',[-3.8,.73,-1.42],.92,.38,.24);
 bevelBox('Operations armored roof',13,[-3.8,.98,-1.42],[.4,.07,.46],.045);
}
return {kestrel,tandem,lantern,wayfarer};
}
