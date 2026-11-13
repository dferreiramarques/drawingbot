// Drawing board: renders the bed, paper and ink, and lets the user draw, select, move, resize and rotate
// objects directly on the preview. Objects are immutable: every change replaces the object.
import {makeObject,objectCorners,centerOf,newId} from './document.mjs';
import {simplify} from './geometry.mjs';

export const TOOLS=[['select','Selecionar','V'],['rect','Retângulo','R'],['ellipse','Elipse','E'],['polygon','Polígono','P'],
  ['star','Estrela','S'],['heart','Coração','H'],['line','Linha','L'],['freehand','Mão livre','F']];
const NS='http://www.w3.org/2000/svg';
const el=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const pathD=p=>p.points.map((v,i)=>(i?'L':'M')+v.x.toFixed(3)+' '+v.y.toFixed(3)).join(' ')+(p.closed?' Z':'');
const rotate=(v,deg)=>{const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return {x:v.x*c-v.y*s,y:v.x*s+v.y*c};};

export function createEditor({svg,onChange,onSelect,onTool}){
  let objects=[],selected=null,tool='select',locked=false,gesture=null,view={w:300,h:300,zoom:1};
  const history=[],future=[];let frame=0,last=null;

  const find=id=>objects.find(o=>o.id===id);
  const snapshot=()=>({objects:objects.slice(),selected});
  function remember(){history.push(snapshot());if(history.length>80)history.shift();future.length=0;}
  function changed(kind='commit'){onChange(kind);}
  function setSelected(id){selected=id&&find(id)?id:null;onSelect(selected);draw();}

  // ---------- Coordinates ----------
  function toBed(event){
    const ctm=svg.getScreenCTM();if(!ctm)return {x:0,y:0};
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(ctm.inverse());
    return {x:p.x,y:view.h-p.y};
  }
  const mmPerPx=()=>{const ctm=svg.getScreenCTM();return ctm&&ctm.a?1/ctm.a:.5;};
  function toLocal(o,p){const c=centerOf(o);return rotate({x:p.x-c.x,y:p.y-c.y},-o.rotation);}
  function hitObject(p){
    const tol=Math.max(1.2,6*mmPerPx());
    for(let i=objects.length-1;i>=0;i--){const o=objects[i],l=toLocal(o,p);if(Math.abs(l.x)<=o.w/2+tol&&Math.abs(l.y)<=o.h/2+tol)return o;}
    return null;
  }
  function handles(o){
    const corners=objectCorners(o),c=centerOf(o),off=rotate({x:0,y:o.h/2+10*mmPerPx()*2.2},o.rotation);
    return {corners,rotate:{x:c.x+off.x,y:c.y+off.y}};
  }
  function hitHandle(o,p){
    const r=9*mmPerPx(),h=handles(o);
    if(Math.hypot(p.x-h.rotate.x,p.y-h.rotate.y)<=r)return {type:'rotate'};
    const i=h.corners.findIndex(q=>Math.hypot(p.x-q.x,p.y-q.y)<=r);
    return i<0?null:{type:'resize',corner:i};
  }

  // ---------- Pointer gestures ----------
  svg.addEventListener('pointerdown',event=>{
    if(locked||event.button>0)return;
    const p=toBed(event);try{svg.setPointerCapture(event.pointerId);}catch{}
    if(tool==='select'){
      const current=find(selected),handle=current&&hitHandle(current,p);
      if(handle){gesture={...handle,id:current.id,start:p,before:{...current}};return;}
      const hit=hitObject(p);
      if(hit){if(hit.id!==selected)setSelected(hit.id);gesture={type:'move',id:hit.id,start:p,before:{...hit}};return;}
      setSelected(null);gesture=null;return;
    }
    gesture={type:tool==='freehand'?'freehand':'create',kind:tool,start:p,end:p,points:[p]};draw();
  });
  svg.addEventListener('pointermove',event=>{
    if(!gesture){svg.style.cursor=cursorAt(toBed(event));return;}
    const p=toBed(event);gesture.shift=event.shiftKey;gesture.alt=event.altKey;
    if(gesture.type==='freehand'){const lastPoint=gesture.points.at(-1);if(Math.hypot(p.x-lastPoint.x,p.y-lastPoint.y)>=.4)gesture.points.push(p);}
    gesture.end=p;schedule();
  });
  const finish=event=>{
    if(!gesture)return;
    const g=gesture;gesture=null;
    if(g.type==='create')createFromDrag(g);
    else if(g.type==='freehand')createFreehand(g);
    else if(g.end&&['move','resize','rotate'].includes(g.type)){apply(g);const after=find(g.id);
      if(after&&JSON.stringify([after.x,after.y,after.w,after.h,after.rotation])!==JSON.stringify([g.before.x,g.before.y,g.before.w,g.before.h,g.before.rotation])){
        history.push({objects:objects.map(o=>o.id===g.id?g.before:o),selected});future.length=0;changed('commit');}}
    draw();
  };
  // The gesture ends wherever the pointer is released, even outside the board.
  svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);svg.addEventListener('lostpointercapture',finish);
  window.addEventListener('pointerup',finish);window.addEventListener('mouseup',finish);
  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(gesture&&['move','resize','rotate'].includes(gesture.type)){apply(gesture);changed('live');}else draw();});}
  function cursorAt(p){
    if(locked)return 'default';if(tool!=='select')return 'crosshair';
    const o=find(selected),h=o&&hitHandle(o,p);
    if(h)return h.type==='rotate'?'grab':'nwse-resize';
    return hitObject(p)?'move':'default';
  }
  function replace(id,patch){objects=objects.map(o=>o.id===id?{...o,...patch}:o);}
  function apply(g){
    const b=g.before,p=g.end;
    if(g.type==='move'){replace(g.id,{x:round(b.x+p.x-g.start.x),y:round(b.y+p.y-g.start.y)});return;}
    if(g.type==='rotate'){const c=centerOf(b);let a=Math.atan2(p.y-c.y,p.x-c.x)*180/Math.PI-90;a=g.shift?Math.round(a/15)*15:Math.round(a);replace(g.id,{rotation:normalizeAngle(a)});return;}
    // Resize from a corner: the opposite corner stays put, in the object's own (rotated) frame.
    const signs=[[-1,-1],[1,-1],[1,1],[-1,1]][g.corner],c=centerOf(b);
    const fixed=rotate({x:-signs[0]*b.w/2,y:-signs[1]*b.h/2},b.rotation);const F={x:c.x+fixed.x,y:c.y+fixed.y};
    const d=rotate({x:p.x-F.x,y:p.y-F.y},-b.rotation);
    let w=Math.max(1,signs[0]*d.x),h=Math.max(1,signs[1]*d.y);
    if(b.h<1e-6)h=0;if(b.w<1e-6)w=0;
    const ratio=b.keepRatio!==!!g.shift;
    if(ratio&&b.w>0&&b.h>0){const k=Math.max(w/b.w,h/b.h);w=b.w*k;h=b.h*k;}
    const nc=rotate({x:signs[0]*w/2,y:signs[1]*h/2},b.rotation);const C={x:F.x+nc.x,y:F.y+nc.y};
    replace(g.id,{w:round(w),h:round(h),x:round(C.x-w/2),y:round(C.y-h/2)});
  }
  function createFromDrag(g){
    let x0=Math.min(g.start.x,g.end.x),y0=Math.min(g.start.y,g.end.y),w=Math.abs(g.end.x-g.start.x),h=Math.abs(g.end.y-g.start.y);
    const kind=g.kind;
    if(kind==='line'){
      if(Math.hypot(w,h)<2){x0=g.start.x;y0=g.start.y;w=40;h=0;}
      const flipX=g.end.x<g.start.x,flipY=g.end.y<g.start.y;
      const pts=[{x:flipX?1:0,y:flipY?1:0},{x:flipX?0:1,y:flipY?0:1}];
      if(h<.5){h=0;pts[0].y=pts[1].y=0;}if(w<.5){w=0;pts[0].x=pts[1].x=0;}
      add(makeObject('line',{paths:[{closed:false,points:pts}],x:round(x0),y:round(y0),w:round(w),h:round(h)}));return;
    }
    if(w<2&&h<2){w=h=40;x0=g.start.x-20;y0=g.start.y-20;}
    else if(g.shift||['polygon','star','heart'].includes(kind)&&!g.alt){const s=Math.max(w,h);if(g.end.x<g.start.x)x0=g.start.x-s;if(g.end.y<g.start.y)y0=g.start.y-s;w=h=s;}
    add(makeObject(kind,{x:round(x0),y:round(y0),w:round(Math.max(1,w)),h:round(Math.max(1,h)),params:kind==='polygon'?{sides:6}:kind==='star'?{points:5,inner:.45}:undefined}));
    setTool('select');
  }
  function createFreehand(g){
    const points=simplify(g.points,.15);if(points.length<2)return;
    const first=points[0],end=points.at(-1),closed=points.length>3&&Math.hypot(first.x-end.x,first.y-end.y)<3;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const v of points){minX=Math.min(minX,v.x);minY=Math.min(minY,v.y);maxX=Math.max(maxX,v.x);maxY=Math.max(maxY,v.y);}
    add(makeObject('freehand',{paths:[{closed,points:closed?points.slice(0,-1):points}],x:round(minX),y:round(minY),w:round(Math.max(maxX-minX,.01)),h:round(Math.max(maxY-minY,.01))}));
  }
  function add(object,{select=true}={}){remember();objects=[...objects,object];if(select)selected=object.id;onSelect(selected);changed('commit');}

  // ---------- Keyboard ----------
  document.addEventListener('keydown',event=>{
    const t=event.target;if(locked||t&&(t.closest?.('input,textarea,select,dialog')||t.isContentEditable)||document.querySelector('dialog[open]'))return;
    const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    if(mod&&key==='z'){event.preventDefault();event.shiftKey?api.redo():api.undo();return;}
    if(mod&&key==='y'){event.preventDefault();api.redo();return;}
    if(mod&&key==='d'){event.preventDefault();api.duplicate();return;}
    if(mod)return;
    if((key==='delete'||key==='backspace')&&selected){event.preventDefault();api.remove(selected);return;}
    if(key==='escape'){if(gesture){gesture=null;draw();}else if(tool!=='select')setTool('select');else setSelected(null);return;}
    const arrows={arrowleft:[-1,0],arrowright:[1,0],arrowup:[0,1],arrowdown:[0,-1]};
    if(arrows[key]&&selected){event.preventDefault();const o=find(selected),step=event.shiftKey?10:1;
      remember();replace(selected,{x:round(o.x+arrows[key][0]*step),y:round(o.y+arrows[key][1]*step)});changed('commit');return;}
    const t2=TOOLS.find(([,,shortcut])=>shortcut.toLowerCase()===key);if(t2){setTool(t2[0]);}
  });
  function setTool(next){tool=next;gesture=null;svg.style.cursor=tool==='select'?'default':'crosshair';onTool(tool);draw();}

  // ---------- Rendering ----------
  let scene={settings:null,ink:[],original:[],errors:false,pen:null,showOriginal:true,selectionOnly:false};
  function draw(next){
    if(next)scene={...scene,...next};
    const s=scene.settings;if(!s)return;
    const w=Number(s.bedWidth)||300,h=Number(s.bedHeight)||300;view={w,h,zoom:view.zoom};
    const size=Math.max(w,h),span=(size+30)/view.zoom,sel=find(selected);
    const focus=view.zoom>1&&sel?centerOf(sel):{x:w/2,y:h/2};
    svg.setAttribute('viewBox',`${focus.x-span/2} ${h-focus.y-span/2} ${span} ${span}`);
    svg.replaceChildren();
    const defs=el('defs'),grid=el('pattern',{id:'grid',width:10,height:10,patternUnits:'userSpaceOnUse'});
    grid.append(el('path',{d:'M10 0H0V10',class:'pv-grid','stroke-width':.25}));defs.append(grid);svg.append(defs);
    svg.append(el('rect',{x:0,y:0,width:w,height:h,class:'pv-bed',rx:1,'stroke-width':.5}));
    const paper=el('g',{transform:`translate(0 ${h}) scale(1 -1)`});
    paper.append(el('rect',{x:s.paperX,y:s.paperY,width:s.paperWidth,height:s.paperHeight,class:'pv-paper','stroke-width':.5}));
    paper.append(el('rect',{x:0,y:0,width:w,height:h,fill:'url(#grid)'}));
    if(scene.showOriginal&&scene.original.length)paper.append(el('path',{d:scene.original.map(pathD).join(' '),class:'pv-original','stroke-width':.3,'stroke-dasharray':'1.5 1.5'}));
    if(scene.ink.length)paper.append(el('path',{d:scene.ink.map(pathD).join(' '),class:scene.errors?'pv-ink error':'pv-ink','stroke-width':s.tip,'stroke-linecap':'round','stroke-linejoin':'round'}));
    if(scene.pen){const m=el('g',{transform:`translate(${scene.pen.x} ${scene.pen.y})`,class:'pv-pen','stroke-width':.65});m.append(el('circle',{r:2}),el('path',{d:'M-4 0H4M0-4V4'}));paper.append(m);}
    // Selection and gesture overlay.
    const px=mmPerPx();
    if(sel&&!locked){
      const corners=objectCorners(sel),hd=handles(sel),c=centerOf(sel),top=rotate({x:0,y:sel.h/2},sel.rotation);
      paper.append(el('polygon',{points:corners.map(p=>`${p.x},${p.y}`).join(' '),class:'ed-box','stroke-width':1.2*px}));
      paper.append(el('line',{x1:c.x+top.x,y1:c.y+top.y,x2:hd.rotate.x,y2:hd.rotate.y,class:'ed-box','stroke-width':1.2*px}));
      for(const p of corners)paper.append(el('rect',{x:p.x-4*px,y:p.y-4*px,width:8*px,height:8*px,class:'ed-handle','stroke-width':1.2*px}));
      paper.append(el('circle',{cx:hd.rotate.x,cy:hd.rotate.y,r:5*px,class:'ed-handle','stroke-width':1.2*px}));
    }
    if(gesture&&gesture.type==='create'){
      const a=gesture.start,b=gesture.end;
      paper.append(gesture.kind==='line'?el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'ed-draft','stroke-width':1.5*px}):
        el('rect',{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),class:'ed-draft','stroke-width':1.5*px}));
    }
    if(gesture&&gesture.type==='freehand')paper.append(el('path',{d:pathD({closed:false,points:gesture.points}),class:'ed-draft-line','stroke-width':Math.max(s.tip,1.5*px)}));
    svg.append(paper);
    for(let i=0;i<=w;i+=50){const t=el('text',{x:i,y:h+11,class:'pv-label','text-anchor':'middle'});t.textContent=i;svg.append(t);}
    for(let i=0;i<=h;i+=50){const t=el('text',{x:-4,y:h-i+2.5,class:'pv-label','text-anchor':'end'});t.textContent=i;svg.append(t);}
    const xl=el('text',{x:w+6,y:h+2.5,class:'pv-axis'});xl.textContent='X';svg.append(xl);
    const yl=el('text',{x:-2,y:-6,class:'pv-axis'});yl.textContent='Y';svg.append(yl);
  }

  const round=v=>Math.round(v*100)/100;
  const normalizeAngle=a=>((a%360)+540)%360-180;
  const api={
    get objects(){return objects;},get selected(){return find(selected)||null;},get tool(){return tool;},
    setObjects(list,{keepHistory=false}={}){if(keepHistory)remember();else{history.length=0;future.length=0;}objects=list.slice();selected=null;onSelect(null);changed('commit');},
    add,select:setSelected,setTool,draw,
    setZoom(z){view.zoom=z;draw();},get zoom(){return view.zoom;},
    setLocked(value){if(locked===value)return;locked=value;gesture=null;draw();},
    update(id,patch,{commit=true}={}){const o=find(id);if(!o)return;if(commit)remember();replace(id,patch);changed(commit?'commit':'live');},
    remove(id){if(!find(id))return;remember();objects=objects.filter(o=>o.id!==id);if(selected===id)selected=null;onSelect(selected);changed('commit');},
    duplicate(){const o=find(selected);if(!o)return;const copy={...o,id:newId(),x:round(o.x+8),y:round(o.y-8),name:o.name};add(copy);},
    move(id,delta){const i=objects.findIndex(o=>o.id===id),j=i+delta;if(i<0||j<0||j>=objects.length)return;remember();const list=objects.slice();[list[i],list[j]]=[list[j],list[i]];objects=list;changed('commit');},
    undo(){if(!history.length)return;future.push(snapshot());const s=history.pop();objects=s.objects;selected=s.selected&&s.objects.some(o=>o.id===s.selected)?s.selected:null;onSelect(selected);changed('commit');},
    redo(){if(!future.length)return;history.push(snapshot());const s=future.pop();objects=s.objects;selected=s.selected&&s.objects.some(o=>o.id===s.selected)?s.selected:null;onSelect(selected);changed('commit');},
    get canUndo(){return history.length>0;},get canRedo(){return future.length>0;},
    pointToBed:toBed,
  };
  return api;
}
