// A drawing is a list of objects (shapes, freehand lines, imported SVG, text), each with its own size,
// position, rotation and fill. Shared by the app and the Raspberry Pi server.
import {DEFAULTS,bounds,simplify,compensate,fillRegion,normalizeFill,finishJob,checkSettings,validateProject,validateTextSpec,PROJECT_FORMAT} from './geometry.mjs';

export const DOCUMENT_VERSION=2;
export const OBJECT_KINDS=Object.freeze({rect:'Retângulo',ellipse:'Elipse',polygon:'Polígono',star:'Estrela',heart:'Coração',line:'Linha',freehand:'Mão livre',svg:'SVG',text:'Texto'});
export const MAX_OBJECTS=200;

// ---------- Shapes (unit box, y up) ----------
const circle=(n,f)=>Array.from({length:n},(_,i)=>f(i/n*2*Math.PI));
export function shapePaths(kind,params={}){
  switch(kind){
    case 'rect':return [{closed:true,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}];
    case 'ellipse':return [{closed:true,points:circle(96,a=>({x:.5+.5*Math.cos(a),y:.5+.5*Math.sin(a)}))}];
    case 'polygon':{const n=clampInt(params.sides,3,24,6);return [{closed:true,points:circle(n,a=>({x:.5+.5*Math.cos(a+Math.PI/2),y:.5+.5*Math.sin(a+Math.PI/2)}))}];}
    case 'star':{const n=clampInt(params.points,3,24,5),inner=clamp(params.inner,.1,.95,.45);
      return [{closed:true,points:Array.from({length:n*2},(_,i)=>{const a=i/(n*2)*2*Math.PI+Math.PI/2,r=i%2?inner*.5:.5;return {x:.5+r*Math.cos(a),y:.5+r*Math.sin(a)};})}];}
    case 'heart':return [{closed:true,points:circle(120,t=>({x:16*Math.sin(t)**3,y:13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)}))}];
    case 'line':return [{closed:false,points:[{x:0,y:0},{x:1,y:1}]}];
    default:throw Error('Forma desconhecida.');
  }
}
const clamp=(v,lo,hi,d)=>Number.isFinite(Number(v))?Math.min(hi,Math.max(lo,Number(v))):d;
const clampInt=(v,lo,hi,d)=>Math.round(clamp(v,lo,hi,d));

let counter=0;
export const newId=()=>Date.now().toString(36)+(counter++).toString(36)+Math.random().toString(36).slice(2,6);
// Creates an object whose box is (x,y,w,h) in bed millimetres.
export function makeObject(kind,{paths,x=0,y=0,w=40,h=40,rotation=0,fill,params,text,name}={}){
  const base=paths||shapePaths(kind,params);
  return {id:newId(),kind,name:name||OBJECT_KINDS[kind]||'Objeto',paths:base.map(p=>({closed:!!p.closed,points:p.points.map(v=>({x:v.x,y:v.y}))})),
    x,y,w,h,rotation,keepRatio:['svg','text','freehand','polygon','star','heart'].includes(kind),fill:normalizeFill(fill),...(params?{params:{...params}}:{}),...(text?{text}:{})};
}

// ---------- Placement ----------
const baseBounds=new WeakMap();
function boundsOf(paths){if(!baseBounds.has(paths))baseBounds.set(paths,bounds(paths));return baseBounds.get(paths);}
// Object paths relative to the object's centre (rotation applied), in millimetres.
export function localPaths(object){
  const b=boundsOf(object.paths),sx=b.width>1e-9?object.w/b.width:1,sy=b.height>1e-9?object.h/b.height:1;
  const a=Number(object.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return object.paths.map(p=>({closed:p.closed,points:p.points.map(v=>{const x=(v.x-b.minX-b.width/2)*sx,y=(v.y-b.minY-b.height/2)*sy;return {x:x*c-y*s,y:x*s+y*c};})}));
}
export const centerOf=o=>({x:o.x+o.w/2,y:o.y+o.h/2});
const translate=(paths,d)=>paths.map(p=>({...p,points:p.points.map(v=>({x:v.x+d.x,y:v.y+d.y}))}));
export function placedPaths(object){return translate(localPaths(object),centerOf(object));}
// Corners of the rotated box, in bed millimetres (for selection and limits).
export function objectCorners(o){
  const c=centerOf(o),a=Number(o.rotation||0)*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>{const x=i*o.w/2,y=j*o.h/2;return {x:c.x+x*cos-y*sin,y:c.y+x*sin+y*cos};});
}

// ---------- Ink ----------
// Ink depends on size, rotation, fill, tip and compensation, not on position: it is cached around the
// centre so moving an object only translates it.
const inkCache=new WeakMap();
export function objectInk(object,options){
  const settings={compensation:'center',tip:DEFAULTS.tip,...options};
  const key=JSON.stringify([object.w,object.h,object.rotation,object.fill,Number(settings.tip),settings.compensation]);
  let byKey=inkCache.get(object.paths);if(!byKey)inkCache.set(object.paths,byKey=new Map());
  if(!byKey.has(key)){
    if(byKey.size>12)byKey.clear();
    const local=localPaths(object).map(p=>({...p,points:simplify(p.points)})),warnings=[];
    // Patterns turn with the object.
    const fill={...normalizeFill(object.fill)};fill.angle+=Number(object.rotation||0);
    let ink;
    if(fill.pattern!=='none'&&local.some(p=>p.closed)){
      const filled=fillRegion(local.filter(p=>p.closed),Number(settings.tip),fill);
      ink=[...filled.paths,...local.filter(p=>!p.closed)];warnings.push(...filled.warnings);
    }else{const offset=compensate(local,Number(settings.tip),settings.compensation);ink=offset.paths;warnings.push(...offset.warnings);}
    byKey.set(key,{ink,local,warnings});
  }
  const cached=byKey.get(key),c=centerOf(object);
  return {ink:translate(cached.ink,c),original:translate(cached.local,c),warnings:cached.warnings};
}
export function composeInk(objects,settings){
  const ink=[],original=[],warnings=[];
  for(const o of objects){const r=objectInk(o,settings);ink.push(...r.ink);original.push(...r.original);warnings.push(...r.warnings);}
  return {ink,original,warnings};
}
export function composeJob(objects,options={}){
  const settings=checkSettings(options,{placement:false});
  if(!objects.length)throw Error('Ainda não há nada para desenhar.');
  const {ink,original,warnings}=composeInk(objects,settings);
  return finishJob(ink,original,settings,warnings,settings.compensation==='center'?0:(settings.compensation==='inside'?-1:1)*settings.tip/2);
}

// ---------- Projects ----------
const finite=(v,lo,hi)=>Number.isFinite(Number(v))&&Number(v)>=lo&&Number(v)<=hi;
function validPaths(paths,limit){
  if(!Array.isArray(paths)||!paths.length)throw Error('Objeto sem percursos.');
  let count=0;
  for(const path of paths){
    if(!path||typeof path.closed!=='boolean'||!Array.isArray(path.points)||path.points.length<2)throw Error('Percurso inválido.');
    count+=path.points.length;
    for(const p of path.points)if(!p||!finite(p.x,-1e7,1e7)||!finite(p.y,-1e7,1e7))throw Error('Coordenada inválida.');
  }
  if(count>limit)throw Error('Demasiados pontos no projeto.');
  return paths.map(p=>({closed:p.closed,points:p.points.map(v=>({x:Number(v.x),y:Number(v.y)}))}));
}
export function validateObject(raw,budget=180000){
  if(!raw||typeof raw!=='object'||!(raw.kind in OBJECT_KINDS))throw Error('Objeto inválido.');
  for(const key of ['x','y'])if(!finite(raw[key],-5000,5000))throw Error('Posição inválida.');
  for(const key of ['w','h'])if(!finite(raw[key],0,2000))throw Error('Tamanho inválido.');
  if(!(raw.w>0||raw.h>0))throw Error('Objeto sem tamanho.');
  if(!finite(raw.rotation??0,-3600,3600))throw Error('Rotação inválida.');
  const object={id:typeof raw.id==='string'&&/^[\w-]{1,40}$/.test(raw.id)?raw.id:newId(),kind:raw.kind,name:String(raw.name||OBJECT_KINDS[raw.kind]).slice(0,120),
    paths:validPaths(raw.paths,budget),x:Number(raw.x),y:Number(raw.y),w:Number(raw.w),h:Number(raw.h),rotation:Number(raw.rotation||0),
    keepRatio:!!raw.keepRatio,fill:normalizeFill(raw.fill)};
  if(raw.params&&typeof raw.params==='object')object.params={sides:clampInt(raw.params.sides,3,24,6),points:clampInt(raw.params.points,3,24,5),inner:clamp(raw.params.inner,.1,.95,.45)};
  if(raw.kind==='text'){const text=validateTextSpec(raw.text);if(text)object.text=text;}
  return object;
}
// Accepts version 2 projects (objects) and version 1 projects (one placed drawing). Returns {fileName,settings,objects}.
export function validateDocument(saved){
  if(saved&&saved.version===DOCUMENT_VERSION&&['drawingbot'].includes(saved.format)){
    if(!Array.isArray(saved.objects)||!saved.objects.length)throw Error('O projeto não tem objetos.');
    if(saved.objects.length>MAX_OBJECTS)throw Error(`O projeto tem demasiados objetos (máximo ${MAX_OBJECTS}).`);
    let budget=180000;const objects=[];
    for(const raw of saved.objects){const o=validateObject(raw,budget);budget-=o.paths.reduce((n,p)=>n+p.points.length,0);objects.push(o);}
    const settings={...DEFAULTS};
    if(saved.settings&&typeof saved.settings==='object')for(const key of Object.keys(DEFAULTS))if(key in saved.settings)settings[key]=saved.settings[key];
    composeJob(objects,settings);
    return {fileName:String(saved.fileName||'Desenho').slice(0,200),settings,objects};
  }
  const v1=validateProject(saved);
  return {fileName:v1.fileName,settings:v1.settings,objects:[objectFromPlacement(v1.paths,v1.settings,v1.text)]};
}
// Converts a version 1 drawing (global width, origin and rotation) into an object in the same place.
export function objectFromPlacement(paths,settings,text=null){
  const b=bounds(paths),a=Number(settings.rotation||0)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
  const rotatedWidth=b.width*c+b.height*s,rotatedHeight=b.width*s+b.height*c;
  const scale=Number(settings.width)/(rotatedWidth||rotatedHeight||1),w=b.width*scale,h=b.height*scale;
  const cx=Number(settings.originX)+rotatedWidth*scale/2,cy=Number(settings.originY)+rotatedHeight*scale/2;
  const anyFill=paths.some(p=>p.fill&&p.closed);
  return makeObject(text?'text':'svg',{paths,x:cx-w/2,y:cy-h/2,w,h,rotation:Number(settings.rotation||0),fill:anyFill?{pattern:'solid'}:undefined,text:text||undefined,
    name:text?`Texto · ${text.content.trim().split(/\n/)[0].slice(0,32)}`:undefined});
}
export function documentProject({fileName,settings,objects}){
  return {format:PROJECT_FORMAT,version:DOCUMENT_VERSION,fileName,settings:{...settings},objects:objects.map(o=>({...o}))};
}
