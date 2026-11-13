import Clipper from 'clipper-lib';

export const DEFAULTS = Object.freeze({tip:0.5, compensation:'center', width:140, originX:30, originY:30, rotation:0,
  drawSpeed:15, travelSpeed:40, lift:3, drawZ:0, paper:'bed', paperX:0, paperY:0,
  bedWidth:300,bedHeight:300,paperWidth:300,paperHeight:300,bedTarget:0});
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function bounds(paths){
  const all=paths.flatMap(p=>p.points);
  if(!all.length)return {minX:0,minY:0,maxX:0,maxY:0,width:0,height:0};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of all){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
export function simplify(points,tolerance=.025){
  if(points.length<3)return points.map(p=>({...p}));
  const sq=tolerance*tolerance;
  function segmentDistance(p,a,b){let x=a.x,y=a.y,dx=b.x-x,dy=b.y-y;
    if(dx||dy){const t=((p.x-x)*dx+(p.y-y)*dy)/(dx*dx+dy*dy);if(t>1){x=b.x;y=b.y;}else if(t>0){x+=dx*t;y+=dy*t;}}
    return (p.x-x)**2+(p.y-y)**2;
  }
  // Iterative RDP keeps large imported paths off the JavaScript call stack.
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]];
  while(stack.length){const [first,last]=stack.pop();let far=sq,index=0;
    for(let i=first+1;i<last;i++){const d=segmentDistance(points[i],points[first],points[last]);if(d>far){far=d;index=i;}}
    if(index){keep[index]=1;stack.push([first,index],[index,last]);}
  }
  return points.filter((_,i)=>keep[i]).map(p=>({...p}));
}
export function placePaths(paths,settings){
  const angle=Number(settings.rotation)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const rotated=paths.map(p=>({...p,points:p.points.map(v=>({x:v.x*c-v.y*s,y:v.x*s+v.y*c}))}));
  const b=bounds(rotated);if(b.width<1e-8&&b.height<1e-8)throw Error('O desenho não tem dimensão.');
  const scale=Number(settings.width)/(b.width||b.height);
  return rotated.map(p=>({...p,points:simplify(p.points.map(v=>({x:(v.x-b.minX)*scale+Number(settings.originX),y:(v.y-b.minY)*scale+Number(settings.originY)})))}));
}
const SCALE=1000;
const toInt=points=>points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)}));
const toFloat=points=>points.map(p=>({x:p.X/SCALE,y:p.Y/SCALE}));
export function compensate(paths,tip,mode){
  if(mode==='center')return {paths:structuredClone(paths),warnings:[],offset:0};
  if(!['inside','outside'].includes(mode))throw Error('Compensação desconhecida.');
  const open=paths.filter(p=>!p.closed),closed=paths.filter(p=>p.closed);
  const rings=closed.map(p=>toInt(p.points)).filter(p=>p.length>=3);
  // Consistent outer/hole orientation. Full containment avoids treating overlaps as holes.
  for(let i=0;i<rings.length;i++){
    const area=Math.abs(Clipper.Clipper.Area(rings[i]));
    const depth=rings.filter((q,j)=>j!==i&&Math.abs(Clipper.Clipper.Area(q))>area&&rings[i].every(p=>Clipper.Clipper.PointInPolygon(p,q)!==0)).length;
    const desired=depth%2===0;
    if(Clipper.Clipper.Orientation(rings[i])!==desired)rings[i].reverse();
  }
  const union=new Clipper.Clipper(),normalized=[];
  if(rings.length){union.AddPaths(rings,Clipper.PolyType.ptSubject,true);union.Execute(Clipper.ClipType.ctUnion,normalized,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);}
  const result=[];
  if(normalized.length){const offset=new Clipper.ClipperOffset(2,.015*SCALE);offset.AddPaths(normalized,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);offset.Execute(result,(mode==='inside'?-1:1)*Number(tip)*SCALE/2);}
  const warnings=[];
  if(open.length)warnings.push(`${open.length} ${open.length===1?'linha aberta mantém':'linhas abertas mantêm'} o eixo original.`);
  if(closed.length&&!result.length)warnings.push('A ponta é demasiado larga: os contornos fechados desapareceram. Reduz a ponta ou aumenta o desenho.');
  return {paths:[...result.map(points=>({closed:true,points:toFloat(points)})),...structuredClone(open)],warnings,offset:(mode==='inside'?-1:1)*tip/2};
}
// ---------- Fills ----------
// A filled shape keeps its ink inside the shape: the outline sits half a tip inside and a pattern covers
// the interior. "solid" packs lines slightly closer than the tip so no paper shows through.
export const HATCH_OVERLAP=.85;
export const FILL_PATTERNS=Object.freeze([
  ['none','Sem preenchimento'],['solid','Cheio'],['hatch','Linhas'],['cross','Quadriculado'],['waves','Ondas'],
  ['zigzag','Ziguezague'],['concentric','Concêntrico'],['spiral','Espiral'],['dots','Pontos']]);
const PATTERN_IDS=new Set(FILL_PATTERNS.map(p=>p[0]));
export function normalizeFill(fill){
  if(fill===true)return {pattern:'solid',spacing:2,angle:0};
  const f=fill&&typeof fill==='object'?fill:{};
  const n=(v,lo,hi,d)=>Number.isFinite(Number(v))&&Number(v)>=lo&&Number(v)<=hi?Number(v):d;
  return {pattern:PATTERN_IDS.has(f.pattern)?f.pattern:'none',spacing:n(f.spacing,.1,50,2),angle:n(f.angle,-360,360,0)};
}
function clipOpen(lines,region){
  if(!lines.length)return [];
  const clip=new Clipper.Clipper(),tree=new Clipper.PolyTree();
  clip.AddPaths(lines,Clipper.PolyType.ptSubject,false);clip.AddPaths(region,Clipper.PolyType.ptClip,true);
  clip.Execute(Clipper.ClipType.ctIntersection,tree,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return Clipper.Clipper.OpenPathsFromPolyTree(tree).filter(p=>p.length>=2);
}
function ringBounds(rings){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const ring of rings)for(const p of ring){minX=Math.min(minX,p.X);minY=Math.min(minY,p.Y);maxX=Math.max(maxX,p.X);maxY=Math.max(maxY,p.Y);}
  return {minX,minY,maxX,maxY};
}
// Parallel rows across the region, rotated by `angle`. `wave(u)` bends each row (0 for straight lines).
// Returns clipped segments tagged with their row, in millimetres.
function rows(region,spacingMM,angle,wave=()=>0,step=Infinity){
  const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),sp=spacingMM*SCALE;
  const b=ringBounds(region),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2,r=Math.hypot(b.maxX-b.minX,b.maxY-b.minY)/2+sp;
  const lines=[],toWorld=(u,v)=>({X:Math.round(cx+u*c-v*s),Y:Math.round(cy+u*s+v*c)});
  const du=Math.min(step*SCALE,2*r);
  for(let v=-r+sp/2,row=0;v<r;v+=sp,row++){
    const line=[];for(let u=-r;u<=r+1e-9;u+=du)line.push(toWorld(u,v+wave(u/SCALE)*SCALE));
    if(line.length<2)line.push(toWorld(r,v+wave(r/SCALE)*SCALE));
    lines.push(line);
  }
  // Recover each clipped segment's row from its first point in the rotated frame.
  return clipOpen(lines,region).map(seg=>{
    const p=seg[0],u=((p.X-cx)*c+(p.Y-cy)*s),v=(-(p.X-cx)*s+(p.Y-cy)*c)-wave(u/SCALE)*SCALE;
    return {row:Math.round((v+r-sp/2)/sp),points:toFloat(seg)};
  });
}
// Joins segments of neighbouring rows into continuous chains, so the pen does not lift for every row.
// Only short hops are joined: they run along the edge, inside the half-tip margin of the outline.
function joinRows(segments,spacing){
  const byRow=new Map();
  for(const s of segments){if(!byRow.has(s.row))byRow.set(s.row,[]);byRow.get(s.row).push(s.points);}
  const keys=[...byRow.keys()].sort((a,b)=>a-b),used=new Set(),chains=[],maxHop=spacing*2.2;
  for(const startKey of keys)for(const first of byRow.get(startKey)){
    if(used.has(first))continue;
    used.add(first);const chain=[...first];let key=startKey;
    for(;;){
      const end=chain.at(-1),next=byRow.get(key+1);if(!next)break;
      let best=null,bestD=maxHop,flip=false;
      for(const seg of next){if(used.has(seg))continue;
        const d0=distance(end,seg[0]),d1=distance(end,seg.at(-1));
        if(d0<bestD){best=seg;bestD=d0;flip=false;}if(d1<bestD){best=seg;bestD=d1;flip=true;}}
      if(!best)break;
      used.add(best);chain.push(...(flip?[...best].reverse():best));key++;
    }
    chains.push(chain);
  }
  return chains.map(points=>({closed:false,points}));
}
function patternPaths(region,pattern,spacing,angle,tip){
  switch(pattern){
    case 'solid':case 'hatch':return joinRows(rows(region,spacing,angle),spacing);
    case 'cross':return [...joinRows(rows(region,spacing,angle),spacing),...joinRows(rows(region,spacing,angle+90),spacing)];
    case 'waves':{const period=spacing*4,amp=spacing*.45;return joinRows(rows(region,spacing,angle,u=>amp*Math.sin(2*Math.PI*u/period),period/16),spacing);}
    case 'zigzag':{const period=spacing*2,amp=spacing*.45;return joinRows(rows(region,spacing,angle,u=>{const t=((u/period)%1+1)%1;return amp*(t<.5?4*t-1:3-4*t);},period/2),spacing);}
    case 'concentric':{
      const out=[];let current=region;
      for(let i=0;i<400;i++){
        const next=[],offset=new Clipper.ClipperOffset(2,.015*SCALE);offset.AddPaths(current,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);offset.Execute(next,-spacing*SCALE);
        if(!next.length)break;out.push(...next.map(p=>({closed:true,points:toFloat(p)})));current=next;
      }
      return out;
    }
    case 'spiral':{
      const b=ringBounds(region),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2,R=Math.hypot(b.maxX-b.minX,b.maxY-b.minY)/2,pitch=spacing*SCALE;
      const line=[];for(let t=0;;){const r=pitch*t/(2*Math.PI);if(r>R)break;line.push({X:Math.round(cx+r*Math.cos(t)),Y:Math.round(cy+r*Math.sin(t))});t+=Math.min(.35,(spacing*.6*SCALE)/Math.max(r,1));}
      return clipOpen([line],region).map(p=>({closed:false,points:toFloat(p)}));
    }
    case 'dots':{
      const b=ringBounds(region),sp=spacing*SCALE,radius=Math.max(Number(tip)*.6,spacing*.18),out=[];
      // Dot centres must sit a full dot radius inside, so the dots stay within the outline.
      const core=[],shrink=new Clipper.ClipperOffset(2,.015*SCALE);shrink.AddPaths(region,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);shrink.Execute(core,-radius*SCALE);
      for(let y=b.minY+sp/2,row=0;y<b.maxY;y+=sp*.866,row++)for(let x=b.minX+sp/2+(row%2?sp/2:0);x<b.maxX;x+=sp){
        const point={X:Math.round(x),Y:Math.round(y)};
        if(core.reduce((n,ring)=>n+(Clipper.Clipper.PointInPolygon(point,ring)!==0?(Clipper.Clipper.Orientation(ring)?1:-1):0),0)<=0)continue;
        const cxm=x/SCALE,cym=y/SCALE;
        out.push({closed:true,points:Array.from({length:10},(_,i)=>({x:cxm+radius*Math.cos(i/10*2*Math.PI),y:cym+radius*Math.sin(i/10*2*Math.PI)}))});
      }
      return out;
    }
    default:return [];
  }
}
// Fills the closed paths with a pattern. Returns the inner outline plus the pattern, in millimetres.
export function fillRegion(paths,tip,fill){
  const spec=normalizeFill(fill);
  const rings=paths.filter(p=>p.closed&&p.points.length>=3).map(p=>toInt(p.points));
  if(!rings.length||spec.pattern==='none')return {paths:[],warnings:[]};
  const union=new Clipper.Clipper(),region=[];
  union.AddPaths(rings,Clipper.PolyType.ptSubject,true);
  union.Execute(Clipper.ClipType.ctUnion,region,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  let inner=[];
  const offset=new Clipper.ClipperOffset(2,.015*SCALE);offset.AddPaths(region,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);offset.Execute(inner,-Number(tip)*SCALE/2);
  const warnings=[];
  if(!inner.length){warnings.push('Há formas mais finas do que a ponta: só o contorno será desenhado. Aumenta-as ou usa uma ponta mais fina.');inner=region;}
  const spacing=spec.pattern==='solid'?Math.max(.05,Number(tip)*HATCH_OVERLAP):Math.max(Number(tip)*HATCH_OVERLAP,spec.spacing);
  const out=inner.map(points=>({closed:true,points:toFloat(points)}));
  out.push(...patternPaths(inner,spec.pattern,spacing,spec.pattern==='solid'?0:spec.angle,tip));
  return {paths:out,warnings};
}
// Text "letra preenchida" and older projects: solid fill.
export function fillPaths(paths,tip){return fillRegion(paths,tip,{pattern:'solid'});}
export function orderPaths(paths){
  const pending=structuredClone(paths),result=[];let cursor={x:0,y:0};
  while(pending.length){let selected=0,best=Infinity,reverse=false,start=0;
    for(let i=0;i<pending.length;i++){
      const p=pending[i];
      if(p.closed){for(let j=0;j<p.points.length;j++){const d=distance(cursor,p.points[j]);if(d<best){best=d;selected=i;start=j;reverse=false;}}}
      else {const first=distance(cursor,p.points[0]),last=distance(cursor,p.points.at(-1));const d=Math.min(first,last);if(d<best){best=d;selected=i;reverse=last<first;start=0;}}
    }
    const p=pending.splice(selected,1)[0];
    if(p.closed)p.points=[...p.points.slice(start),...p.points.slice(0,start)];else if(reverse)p.points.reverse();
    cursor=p.closed?p.points[0]:p.points.at(-1);result.push(p);
  }
  return result;
}
export function checkSettings(options={},{placement=true}={}){
  const settings={...DEFAULTS,...options};
  for(const key of ['tip','drawSpeed','travelSpeed','lift','bedWidth','bedHeight','paperWidth','paperHeight',...(placement?['width']:[])]){
    if(!Number.isFinite(Number(settings[key]))||Number(settings[key])<=0)throw Error('Revê os valores: dimensões, velocidade e ponta devem ser positivas.');
  }
  if(settings.tip>10||(placement&&settings.width>2000)||settings.drawSpeed>80||settings.travelSpeed>80||settings.lift>20||settings.lift<.2||settings.drawZ>settings.lift||settings.drawZ< -2)throw Error('Há um valor fora do intervalo permitido.');
  if(settings.bedWidth>300||settings.bedHeight>300||settings.bedWidth<20||settings.bedHeight<20)throw Error('A área útil desta CR-10 deve ficar entre 20 e 300 mm por eixo.');
  if(!Number.isFinite(Number(settings.bedTarget))||settings.bedTarget<0||settings.bedTarget>60)throw Error('A temperatura opcional da cama deve ficar entre 0 e 60 °C.');
  for(const key of ['originX','originY','drawZ','paperX','paperY','rotation'])if(!Number.isFinite(Number(settings[key])))throw Error('As coordenadas devem ser números.');
  return settings;
}
// Single drawing placed by the global width/origin/rotation (older projects and G-code tests).
export function createJob(source,options={}){
  const settings=checkSettings(options);
  const original=placePaths(source,settings);
  const filled=fillPaths(original.filter(p=>p.fill&&p.closed),Number(settings.tip));
  const offset=compensate(original.filter(p=>!(p.fill&&p.closed)),Number(settings.tip),settings.compensation);
  return finishJob([...offset.paths,...filled.paths],original,settings,[...offset.warnings,...filled.warnings],offset.offset);
}
// Orders the ink, checks it against the machine and the paper, and estimates the time.
export function finishJob(ink,original,settings,warnings=[],offset=0){
  const paths=orderPaths(ink.filter(p=>p.points.length>=2));
  if(!paths.length)throw Error(warnings.at(-1)||'Não existem percursos para desenhar.');
  const b=bounds(paths),r=Number(settings.tip)/2,errors=[];
  if(b.minX-r<0||b.minY-r<0||b.maxX+r>settings.bedWidth||b.maxY+r>settings.bedHeight)errors.push('O traço da caneta sai da área da máquina. Ajusta a posição, o tamanho ou a ponta.');
  if(b.minX-r<settings.paperX||b.minY-r<settings.paperY||b.maxX+r>Number(settings.paperX)+Number(settings.paperWidth)||b.maxY+r>Number(settings.paperY)+Number(settings.paperHeight))errors.push('Há tinta fora do papel. Ajusta a posição ou o tamanho do desenho.');
  let drawing=0,travel=0,cursor={x:0,y:0};
  for(const p of paths){travel+=distance(cursor,p.points[0]);for(let i=1;i<p.points.length;i++)drawing+=distance(p.points[i-1],p.points[i]);if(p.closed)drawing+=distance(p.points.at(-1),p.points[0]);cursor=p.closed?p.points[0]:p.points.at(-1);}
  const seconds=drawing/settings.drawSpeed+travel/settings.travelSpeed+paths.length*2*Math.abs(settings.lift-settings.drawZ)/3
    +Math.abs(10-settings.lift)/3+Math.abs(settings.bedHeight-cursor.y)/settings.travelSpeed;
  return {settings,original,paths,bounds:b,warnings:[...new Set(warnings)],errors,offset,metrics:{drawing,travel,seconds,strokes:paths.length,points:paths.reduce((s,p)=>s+p.points.length,0)}};
}
const number=v=>Number(v).toFixed(3).replace(/\.?0+$/,'')||'0';
export function jobCommands(job,{origin={x:0,y:0}}={}){
  if(job.errors.length)throw Error(job.errors.join(' '));
  const s=job.settings,commands=[];
  const add=(code,extra={})=>commands.push({code,...extra});
  add('G21');add('G90');add('M84 S0');add(`M140 S${number(s.bedTarget)}`);
  add(`G0 Z${number(s.lift)} F180`,{position:{z:Number(s.lift)}});
  for(const path of job.paths){
    const first=path.points[0];
    add(`G0 X${number(first.x)} Y${number(first.y)} F${number(s.travelSpeed*60)}`,{position:first});
    add(`G1 Z${number(s.drawZ)} F120`,{penDown:true,position:{z:Number(s.drawZ)}});
    const points=path.closed?[...path.points.slice(1),first]:path.points.slice(1);
    for(const p of points)add(`G1 X${number(p.x)} Y${number(p.y)} F${number(s.drawSpeed*60)}`,{penDown:true,position:p});
    add(`G0 Z${number(s.lift)} F180`,{penDown:false,position:{z:Number(s.lift)}});
  }
  // Complete the lift before presenting the paper. X stays at its last position.
  const park={safeZ:10};
  add('M400',park);add('G90',park);
  add('G0 Z10 F180',{...park,penDown:false,position:{z:10}});
  add('M400',park);
  add(`G0 Y${number(s.bedHeight)} F${number(s.travelSpeed*60)}`,{...park,penDown:false,position:{y:Number(s.bedHeight)}});
  add('M400',park);return commands;
}
export function exportGcode(job){
  return ['; DRAWINGBOT - Marlin',`; Ponta ${job.settings.tip} mm | compensacao ${job.settings.compensation} | deslocamento ${job.offset.toFixed(3)} mm`,
    '; Antes de executar: origem X/Y e zero Z manual no papel.',
    '; Este ficheiro nao faz homing nem define o zero automaticamente.',
    ...jobCommands(job).map(c=>c.code),`; Terminado: Z10 mm, Y${number(job.settings.bedHeight)} mm. Motores mantidos ativos.`].join('\n')+'\n';
}
export function demoPaths(){
  // Concentric architectural rosette, all dimensions in local millimetres.
  const paths=[];
  for(let k=0;k<7;k++){
    const points=[];for(let i=0;i<144;i++){const a=i/144*Math.PI*2,r=47-k*4.4+5*Math.cos(8*a);points.push({x:60+r*Math.cos(a),y:60+r*Math.sin(a)});}
    paths.push({closed:true,points});
  }
  paths.push({closed:true,points:[{x:0,y:0},{x:120,y:0},{x:120,y:120},{x:0,y:120}]});
  return paths;
}
export const PROJECT_FORMAT='drawingbot';
// Text settings stored with a project so the text can be edited again. Unknown or invalid values are dropped.
export function validateTextSpec(text){
  if(!text||typeof text!=='object'||typeof text.content!=='string'||typeof text.font!=='string')return null;
  const n=(v,lo,hi,d)=>Number.isFinite(Number(v))&&Number(v)>=lo&&Number(v)<=hi?Number(v):d;
  return {content:text.content.slice(0,2000),font:text.font.slice(0,60),mode:text.mode==='line'?'line':'fill',
    align:['left','center','right'].includes(text.align)?text.align:'center',lineHeight:n(text.lineHeight,.5,4,1.25),capHeight:n(text.capHeight,.5,300,20),width:n(text.width,.1,2000,null)};
}
// Validates a saved or uploaded project and returns {fileName,settings,paths}. Accepts older pen-studio files.
export function validateProject(saved){
  if(!saved||typeof saved!=='object'||!['drawingbot','pen-studio'].includes(saved.format)||saved.version!==1||!Array.isArray(saved.paths))throw Error('Projeto incompatível.');
  let count=0;
  for(const path of saved.paths){
    if(!path||typeof path.closed!=='boolean'||!Array.isArray(path.points)||path.points.length<2)throw Error('Percurso inválido.');
    count+=path.points.length;
    for(const p of path.points)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)throw Error('Coordenada inválida.');
  }
  if(!saved.paths.length)throw Error('O projeto não tem percursos.');
  if(count>180000)throw Error('Demasiados pontos no projeto.');
  const settings={...DEFAULTS};
  if(saved.settings&&typeof saved.settings==='object')for(const key of Object.keys(DEFAULTS))if(key in saved.settings)settings[key]=saved.settings[key];
  const paths=saved.paths.map(p=>({closed:p.closed,...(p.fill===true&&p.closed?{fill:true}:{}),points:p.points.map(v=>({x:v.x,y:v.y}))}));
  createJob(paths,settings);
  return {fileName:String(saved.fileName||'Projeto.svg').slice(0,200),settings,paths,text:validateTextSpec(saved.text)};
}
