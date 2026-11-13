// Text tool: lays out text with outline fonts (filled letters) or single-line fonts (one stroke per line),
// returning paths in millimetres, y up, like the SVG importer.
import opentype from 'opentype.js';

export const TEXT_CATEGORIES=[['serif','Serifadas'],['sans','Sem serifa'],['tecnico','Técnicas'],['divertido','Divertidas']];
export const TEXT_FONTS=[
  {id:'playfair-display',mode:'fill',category:'serif',label:'Playfair Display',file:'playfair-display.woff'},
  {id:'merriweather',mode:'fill',category:'serif',label:'Merriweather',file:'merriweather.woff'},
  {id:'montserrat',mode:'fill',category:'sans',label:'Montserrat',file:'montserrat.woff'},
  {id:'roboto',mode:'fill',category:'sans',label:'Roboto',file:'roboto.woff'},
  {id:'roboto-mono',mode:'fill',category:'tecnico',label:'Roboto Mono',file:'roboto-mono.woff'},
  {id:'orbitron',mode:'fill',category:'tecnico',label:'Orbitron',file:'orbitron.woff'},
  {id:'pacifico',mode:'fill',category:'divertido',label:'Pacifico',file:'pacifico.woff'},
  {id:'bangers',mode:'fill',category:'divertido',label:'Bangers',file:'bangers.woff'},
  {id:'hershey-serif',mode:'line',category:'serif',label:'Hershey Serif',file:'hershey-serif.json'},
  {id:'hershey-serif-italic',mode:'line',category:'serif',label:'Hershey Serif Itálico',file:'hershey-serif-italic.json'},
  {id:'hershey-sans',mode:'line',category:'sans',label:'Hershey Sans',file:'hershey-sans.json'},
  {id:'ems-readability',mode:'line',category:'sans',label:'EMS Readability',file:'ems-readability.json'},
  {id:'ems-osmotron',mode:'line',category:'tecnico',label:'EMS Osmotron',file:'ems-osmotron.json'},
  {id:'ems-nixish',mode:'line',category:'tecnico',label:'EMS Nixish',file:'ems-nixish.json'},
  {id:'ems-allure',mode:'line',category:'divertido',label:'EMS Allure',file:'ems-allure.json'},
  {id:'ems-tech',mode:'line',category:'divertido',label:'EMS Tech',file:'ems-tech.json'},
];
export const TEXT_DEFAULTS=Object.freeze({content:'DrawingBot',mode:'fill',font:'montserrat',align:'center',lineHeight:1.25,capHeight:15});
export const fontInfo=id=>TEXT_FONTS.find(f=>f.id===id);

// ---------- Font loading ----------
// `data` is an ArrayBuffer (outline .woff/.ttf/.otf) or the parsed JSON of a single-line font.
export function parseFont(id,data){
  const info=fontInfo(id);if(!info)throw Error('Tipo de letra desconhecido.');
  if(info.mode==='fill'){
    const font=opentype.parse(data);
    const h=font.charToGlyph('H').getBoundingBox();
    return {id,mode:'fill',font,units:font.unitsPerEm,cap:h.y2>0?h.y2:font.unitsPerEm*.7};
  }
  if(!data||typeof data!=='object'||!data.glyphs)throw Error('Ficheiro de letra inválido.');
  const glyphs=new Map();
  for(const [ch,[width,d]] of Object.entries(data.glyphs))glyphs.set(ch,{width,strokes:parseStrokes(d)});
  const H=glyphs.get('H');let cap=data.cap||data.units*.7;
  if(H&&H.strokes.length)cap=Math.max(...H.strokes.flat().map(p=>p.y));
  return {id,mode:'line',glyphs,units:data.units,cap,adv:data.adv};
}

// SVG path data with absolute M/L/C/Z (the subset used by the EMS and Hershey fonts) → polylines.
function parseStrokes(d){
  const tokens=d.match(/[MLCZmlcz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g)||[];
  const strokes=[];let current=null,command='',i=0,start=null;
  const num=()=>Number(tokens[i++]);
  while(i<tokens.length){
    if(/[a-z]/i.test(tokens[i]))command=tokens[i++].toUpperCase();
    if(command==='M'){const p={x:num(),y:num()};current=[p];start=p;strokes.push(current);command='L';}
    else if(command==='L'){current?.push({x:num(),y:num()});}
    else if(command==='C'){const from=current.at(-1),c1={x:num(),y:num()},c2={x:num(),y:num()},to={x:num(),y:num()};current.push(...cubic(from,c1,c2,to,8));}
    else if(command==='Z'){if(current&&start)current.push({...start});command='';}
    else i++;
  }
  return strokes.filter(s=>s.length>=2);
}
function cubic(a,b,c,d,steps){const out=[];for(let s=1;s<=steps;s++){const t=s/steps,u=1-t;
  out.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});}return out;}
function quad(a,b,c,steps){const out=[];for(let s=1;s<=steps;s++){const t=s/steps,u=1-t;
  out.push({x:u*u*a.x+2*u*t*b.x+t*t*c.x,y:u*u*a.y+2*u*t*b.y+t*t*c.y});}return out;}

// ---------- Layout ----------
// Returns {paths, width, height, missing} with paths in mm (y up) and the cap height equal to options.capHeight.
export function layoutText(font,options={}){
  const o={...TEXT_DEFAULTS,...options};
  const content=String(o.content||'').replace(/\r\n?/g,'\n').replace(/\t/g,'  ');
  const lines=content.split('\n');
  if(!content.trim())throw Error('Escreve o texto a desenhar.');
  const capHeight=Number(o.capHeight),lineHeight=Number(o.lineHeight);
  if(!(capHeight>0&&capHeight<=300))throw Error('A altura das letras deve ficar entre 0 e 300 mm.');
  if(!(lineHeight>=.5&&lineHeight<=4))throw Error('O espaçamento entre linhas deve ficar entre 0,5 e 4.');
  const scale=capHeight/font.cap,advance=font.units*lineHeight,missing=new Set();
  const laid=lines.map(line=>font.mode==='fill'?outlineLine(font,line):strokeLine(font,line,missing));
  const widest=Math.max(0,...laid.map(l=>l.width));
  const paths=[];
  laid.forEach((line,row)=>{
    const dx=o.align==='center'?(widest-line.width)/2:o.align==='right'?widest-line.width:0,dy=-row*advance;
    for(const p of line.paths)paths.push({...p,points:p.points.map(v=>({x:(v.x+dx)*scale,y:(v.y+dy)*scale}))});
  });
  if(!paths.length)throw Error('O texto não tem letras que este tipo de letra consiga desenhar.');
  return {paths,width:widest*scale,height:(font.cap+(lines.length-1)*advance)*scale,missing:[...missing]};
}

function strokeLine(font,line,missing){
  let x=0;const paths=[];
  for(const ch of line){
    let glyph=font.glyphs.get(ch);
    if(!glyph){const base=ch.normalize('NFD').replace(/[̀-ͯ]/g,'');glyph=font.glyphs.get(base);if(ch.trim())missing.add(ch);}
    if(!glyph){x+=font.adv;continue;}
    for(const s of glyph.strokes){
      const points=s.map(p=>({x:p.x+x,y:p.y}));
      const closed=points.length>3&&Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)<1e-6;
      paths.push({closed,points:closed?points.slice(0,-1):points});
    }
    x+=glyph.width;
  }
  return {paths,width:x};
}

function outlineLine(font,line){
  const f=font.font,size=font.units;
  const path=f.getPath(line,0,0,size,{kerning:true});
  const contours=[];let current=null;
  for(const c of path.commands){
    // opentype.js uses y down; flip to y up.
    if(c.type==='M'){current=[{x:c.x,y:-c.y}];contours.push(current);}
    else if(c.type==='L')current.push({x:c.x,y:-c.y});
    else if(c.type==='C')current.push(...cubic(current.at(-1),{x:c.x1,y:-c.y1},{x:c.x2,y:-c.y2},{x:c.x,y:-c.y},8));
    else if(c.type==='Q')current.push(...quad(current.at(-1),{x:c.x1,y:-c.y1},{x:c.x,y:-c.y},6));
  }
  const paths=contours.map(points=>{
    const last=points.at(-1),first=points[0];
    if(points.length>1&&Math.hypot(last.x-first.x,last.y-first.y)<1e-6)points=points.slice(0,-1);
    return {closed:true,fill:true,points};
  }).filter(p=>p.points.length>=3);
  return {paths,width:f.getAdvanceWidth(line,size,{kerning:true})};
}
