import svgpath from 'svgpath';
import {bounds} from './geometry.mjs';
const NS='http://www.w3.org/2000/svg';
const SHAPES=new Set(['path','rect','circle','ellipse','line','polyline','polygon']);
const ATTRS=new Set(['d','x','y','x1','x2','y1','y2','width','height','rx','ry','cx','cy','r','points','transform']);
export async function importSVG(text){
  if(text.length>3_000_000)throw Error('O SVG é demasiado grande (máximo 3 MB).');
  const parsed=new DOMParser().parseFromString(text,'image/svg+xml');
  if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw Error('Este ficheiro não é um SVG válido.');
  const source=parsed.documentElement,warnings=[];
  if(source.querySelector('text'))warnings.push('Texto não importado. Converte o texto em caminhos no editor de desenho.');
  if(source.querySelector('image,use,clipPath,mask,filter'))warnings.push('Imagens, símbolos, recortes e efeitos não são importados. Exporta caminhos simples.');
  const root=document.createElementNS(NS,'svg');
  const vb=(source.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  const width=vb.length===4&&vb.every(Number.isFinite)&&vb[2]>0?vb[2]:parseFloat(source.getAttribute('width'))||300;
  const height=vb.length===4&&vb.every(Number.isFinite)&&vb[3]>0?vb[3]:parseFloat(source.getAttribute('height'))||300;
  root.setAttribute('viewBox',vb.length===4?vb.join(' '):`0 0 ${width} ${height}`);
  root.setAttribute('width',width);root.setAttribute('height',height);
  Object.assign(root.style,{position:'absolute',left:'-100000px',top:'0',width:width+'px',height:height+'px',visibility:'hidden',pointerEvents:'none'});
  const targets=[];
  function copy(node,parent){
    for(const child of node.children){
      const tag=child.localName;
      if(['defs','clipPath','mask','symbol','script','style','foreignObject','image','use','text'].includes(tag))continue;
      if(child.getAttribute('display')==='none'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(child.getAttribute('style')||''))continue;
      if(tag==='g'||tag==='svg'){
        const group=document.createElementNS(NS,'g');
        if(child.hasAttribute('transform'))group.setAttribute('transform',child.getAttribute('transform'));
        parent.append(group);copy(child,group);
      }else if(SHAPES.has(tag)){
        const shape=document.createElementNS(NS,tag);
        for(const attr of child.attributes)if(ATTRS.has(attr.name))shape.setAttribute(attr.name,attr.value);
        parent.append(shape);targets.push(shape);
      }
    }
  }
  if(source.hasAttribute('transform'))root.setAttribute('transform',source.getAttribute('transform'));
  copy(source,root);
  if(targets.length>2000)throw Error('O SVG tem demasiados objetos. Simplifica-o antes de importar.');
  document.body.append(root);
  const paths=[];let total=0;
  try{
    const box=root.getBBox(),samplingScale=140/(box.width||box.height||1);
    for(const shape of targets){
      let pieces=[];
      if(shape.localName==='path'){
        const normalized=svgpath(shape.getAttribute('d')||'').abs().unshort().unarc();
        if(normalized.err)throw Error('Existe um caminho SVG inválido.');
        let segments=[];
        for(const segment of normalized.segments){
          if(segment[0]==='M'&&segments.length){pieces.push(segments);segments=[];}
          segments.push(segment);
        }
        if(segments.length)pieces.push(segments);
      }else pieces=[null];
      for(const piece of pieces){
        let element=shape;
        if(piece){element=document.createElementNS(NS,'path');element.setAttribute('d',piece.map(s=>s[0]+s.slice(1).join(' ')).join(' '));if(shape.hasAttribute('transform'))element.setAttribute('transform',shape.getAttribute('transform'));shape.parentNode.append(element);}
        const length=element.getTotalLength();if(!Number.isFinite(length)||length<1e-8){if(piece)element.remove();continue;}
        const matrix=element.getCTM(),factor=Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d));
        const count=Math.min(15000,Math.max(2,Math.ceil(length*factor*samplingScale/.35)));
        total+=count+1;if(total>180000)throw Error('O SVG tem demasiados detalhes. Simplifica os caminhos.');
        const points=[];
        for(let i=0;i<=count;i++){const p=element.getPointAtLength(length*i/count),v=new DOMPoint(p.x,p.y).matrixTransform(matrix);if(!Number.isFinite(v.x)||!Number.isFinite(v.y))throw Error('Transformação SVG inválida.');points.push({x:v.x,y:-v.y});}
        const closed=piece?piece.at(-1)[0].toUpperCase()==='Z':['rect','circle','ellipse','polygon'].includes(shape.localName);
        if(closed&&points.length>2)points.pop();
        paths.push({points,closed});if(piece)element.remove();
      }
    }
  }finally{root.remove();}
  if(!paths.length)throw Error('Não foram encontrados caminhos. Usa um SVG vetorial com linhas ou contornos.');
  const b=bounds(paths);for(const p of paths)for(const v of p.points){v.x-=b.minX;v.y-=b.minY;}
  return {paths,warnings};
}
