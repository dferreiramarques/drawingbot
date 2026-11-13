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
export function createJob(source,options={}){
  const settings={...DEFAULTS,...options};
  for(const key of ['tip','width','drawSpeed','travelSpeed','lift','bedWidth','bedHeight','paperWidth','paperHeight']){
    if(!Number.isFinite(Number(settings[key]))||Number(settings[key])<=0)throw Error('Revê os valores: dimensões, velocidade e ponta devem ser positivas.');
  }
  if(settings.tip>10||settings.width>2000||settings.drawSpeed>80||settings.travelSpeed>80||settings.lift>20||settings.lift<.2||settings.drawZ>settings.lift||settings.drawZ< -2)throw Error('Há um valor fora do intervalo permitido.');
  if(settings.bedWidth>300||settings.bedHeight>300||settings.bedWidth<20||settings.bedHeight<20)throw Error('A área útil desta CR-10 deve ficar entre 20 e 300 mm por eixo.');
  if(!Number.isFinite(Number(settings.bedTarget))||settings.bedTarget<0||settings.bedTarget>60)throw Error('A temperatura opcional da cama deve ficar entre 0 e 60 °C.');
  for(const key of ['originX','originY','drawZ','paperX','paperY','rotation'])if(!Number.isFinite(Number(settings[key])))throw Error('As coordenadas devem ser números.');
  const original=placePaths(source,settings),offset=compensate(original,Number(settings.tip),settings.compensation);
  const paths=orderPaths(offset.paths.filter(p=>p.points.length>=2));
  if(!paths.length)throw Error(offset.warnings.at(-1)||'Não existem percursos para desenhar.');
  const b=bounds(paths),r=Number(settings.tip)/2,errors=[];
  if(b.minX-r<0||b.minY-r<0||b.maxX+r>settings.bedWidth||b.maxY+r>settings.bedHeight)errors.push('O traço da caneta sai da área da máquina. Ajusta a posição, o tamanho ou a ponta.');
  if(b.minX-r<settings.paperX||b.minY-r<settings.paperY||b.maxX+r>Number(settings.paperX)+Number(settings.paperWidth)||b.maxY+r>Number(settings.paperY)+Number(settings.paperHeight))errors.push('Há tinta fora do papel. Ajusta a posição ou o tamanho do desenho.');
  let drawing=0,travel=0,cursor={x:0,y:0};
  for(const p of paths){travel+=distance(cursor,p.points[0]);for(let i=1;i<p.points.length;i++)drawing+=distance(p.points[i-1],p.points[i]);if(p.closed)drawing+=distance(p.points.at(-1),p.points[0]);cursor=p.closed?p.points[0]:p.points.at(-1);}
  const seconds=drawing/settings.drawSpeed+travel/settings.travelSpeed+paths.length*2*Math.abs(settings.lift-settings.drawZ)/3
    +Math.abs(10-settings.lift)/3+Math.abs(settings.bedHeight-cursor.y)/settings.travelSpeed;
  return {settings,original,paths,bounds:b,warnings:offset.warnings,errors,offset:offset.offset,metrics:{drawing,travel,seconds,strokes:paths.length,points:paths.reduce((s,p)=>s+p.points.length,0)}};
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
  const paths=saved.paths.map(p=>({closed:p.closed,points:p.points.map(v=>({x:v.x,y:v.y}))}));
  createJob(paths,settings);
  return {fileName:String(saved.fileName||'Projeto.svg').slice(0,200),settings,paths};
}
