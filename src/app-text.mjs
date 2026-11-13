// Text dialog: picks a font and mode, previews the result and hands the paths to the app.
// The text engine (opentype.js + layout) is a separate bundle, text.js, loaded on first use.
const $=id=>document.getElementById(id);
const ns='http://www.w3.org/2000/svg';
let engine=null;const fonts=new Map();

function loadEngine(){
  if(engine)return engine;
  engine=new Promise((resolve,reject)=>{
    if(window.DrawingBotText)return resolve(window.DrawingBotText);
    const script=document.createElement('script');script.src='./text.js';
    script.onload=()=>window.DrawingBotText?resolve(window.DrawingBotText):reject(Error('Ferramenta de texto indisponível.'));
    script.onerror=()=>{engine=null;reject(Error('Não foi possível carregar a ferramenta de texto. Verifica a ligação.'));};
    document.head.append(script);
  });
  return engine;
}
async function loadFont(T,id){
  if(!fonts.has(id))fonts.set(id,(async()=>{
    const info=T.fontInfo(id),response=await fetch('./fonts/'+info.file);
    if(!response.ok)throw Error(`Não foi possível carregar «${info.label}».`);
    return T.parseFont(id,info.mode==='fill'?await response.arrayBuffer():await response.json());
  })().catch(error=>{fonts.delete(id);throw error;}));
  return fonts.get(id);
}
const d=paths=>paths.map(p=>p.points.map((v,i)=>(i?'L':'M')+v.x.toFixed(2)+' '+(-v.y).toFixed(2)).join('')+(p.closed?'Z':'')).join('');
function drawInto(svg,paths,mode,pad=.08){
  svg.replaceChildren();if(!paths.length)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of paths)for(const v of p.points){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,-v.y);maxY=Math.max(maxY,-v.y);}
  const w=maxX-minX||1,h=maxY-minY||1,m=Math.max(w,h)*pad;
  svg.setAttribute('viewBox',`${minX-m} ${minY-m} ${w+2*m} ${h+2*m}`);
  const path=document.createElementNS(ns,'path');path.setAttribute('d',d(paths));
  path.setAttribute('class',mode==='fill'?'text-ink-fill':'text-ink-line');
  if(mode==='line')path.setAttribute('stroke-width',String(Math.max(w,h)/(svg.dataset.small?40:220)));
  svg.append(path);
}

// open({spec, currentWidth, onApply(spec, result)}) — spec is null for new text.
export function createTextTool({toast}){
  let state=null,onApply=null,T=null,renderToken=0;
  const dialog=$('text-dialog');

  function syncControls(){
    for(const b of dialog.querySelectorAll('[data-text-mode]'))b.setAttribute('aria-checked',String(b.dataset.textMode===state.mode));
    for(const b of dialog.querySelectorAll('[data-text-align]'))b.setAttribute('aria-checked',String(b.dataset.textAlign===state.align));
  }
  function writeControls(){$('text-content').value=state.content;$('text-cap').value=state.capHeight;$('text-line').value=String(state.lineHeight);}
  async function renderFonts(){
    const grid=$('text-fonts');grid.replaceChildren();
    for(const [category,label] of T.TEXT_CATEGORIES){
      const column=document.createElement('div');column.className='font-column';
      const title=document.createElement('span');title.className='font-category';title.textContent=label;column.append(title);
      for(const info of T.TEXT_FONTS.filter(f=>f.mode===state.mode&&f.category===category)){
        const button=document.createElement('button');button.type='button';button.className='font-option';button.dataset.font=info.id;
        button.setAttribute('aria-pressed',String(info.id===state.font));button.title=info.label;
        const sample=document.createElementNS(ns,'svg');sample.dataset.small='1';sample.setAttribute('aria-hidden','true');
        const name=document.createElement('span');name.textContent=info.label;
        button.append(sample,name);button.onclick=()=>{state.font=info.id;for(const b of grid.querySelectorAll('.font-option'))b.setAttribute('aria-pressed',String(b===button));render();};
        column.append(button);
        loadFont(T,info.id).then(font=>drawInto(sample,T.layoutText(font,{content:'Aa',capHeight:10}).paths,state.mode,.12)).catch(()=>{});
      }
      grid.append(column);
    }
  }
  async function render(){
    if(!state||!dialog.open)return;
    const token=++renderToken;
    readControls();
    try{
      const font=await loadFont(T,state.font);if(token!==renderToken)return;
      const result=T.layoutText(font,state);
      drawInto($('text-preview'),result.paths,state.mode,.04);
      const size=`${format(result.width)} × ${format(result.height)} mm`;
      $('text-status').textContent=result.missing.length?`${size} · sem desenho para: ${result.missing.join(' ')}`:size;
      $('text-status').classList.toggle('warning',!!result.missing.length);
      $('text-apply').disabled=false;return result;
    }catch(error){if(token!==renderToken)return;$('text-preview').replaceChildren();$('text-status').textContent=error.message;$('text-status').classList.add('warning');$('text-apply').disabled=true;}
  }
  function readControls(){
    state.content=$('text-content').value;state.capHeight=Number($('text-cap').value);state.lineHeight=Number($('text-line').value);
  }
  const format=v=>Number(v).toLocaleString('pt-PT',{maximumFractionDigits:1});

  dialog.querySelectorAll('[data-text-mode]').forEach(b=>b.onclick=()=>{
    if(!state||state.mode===b.dataset.textMode)return;
    readControls();const old=T.fontInfo(state.font);state.mode=b.dataset.textMode;
    // Keep the style family when switching mode: same category, first font.
    state.font=T.TEXT_FONTS.find(f=>f.mode===state.mode&&f.category===old.category).id;
    syncControls();renderFonts();render();
  });
  dialog.querySelectorAll('[data-text-align]').forEach(b=>b.onclick=()=>{if(!state)return;state.align=b.dataset.textAlign;syncControls();render();});
  let timer;$('text-content').oninput=()=>{clearTimeout(timer);timer=setTimeout(render,150);};
  $('text-cap').oninput=()=>{clearTimeout(timer);timer=setTimeout(render,150);};
  $('text-line').onchange=render;
  $('text-cancel').onclick=()=>dialog.close();
  $('text-apply').onclick=async()=>{
    const result=await render();if(!result)return;
    dialog.close();onApply({...state},result);
  };

  return {async open({spec,onApply:apply}){
    try{T=await loadEngine();}catch(error){toast(error.message,true);return;}
    onApply=apply;state={...T.TEXT_DEFAULTS,...(spec||{})};
    if(!T.fontInfo(state.font)||T.fontInfo(state.font).mode!==state.mode)state.font=T.TEXT_FONTS.find(f=>f.mode===state.mode).id;
    writeControls();syncControls();renderFonts();dialog.showModal();render();
    setTimeout(()=>{$('text-content').focus();$('text-content').select();},30);
  }};
}
