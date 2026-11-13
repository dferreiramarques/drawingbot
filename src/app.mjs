import {DEFAULTS,demoPaths,exportGcode,FILL_PATTERNS,fillRegion,normalizeFill} from './geometry.mjs';
import {composeInk,composeJob,makeObject,shapePaths,validateDocument,documentProject,OBJECT_KINDS} from './document.mjs';
import {importSVG} from './svg-import.mjs';
import {MarlinLink,SimulatedLink,WebSerialTransport} from './serial.mjs';
import {Machine} from './machine.mjs';
import {RemoteMachine,detectServer} from './remote.mjs';
import {createTextTool} from './app-text.mjs';
import {createEditor,TOOLS} from './editor.mjs';

const $=id=>document.getElementById(id),all=selector=>[...document.querySelectorAll(selector)];
const STORAGE='drawingbot-settings-v1',OLD_STORAGE='pen-studio-settings-v1',DOC_STORAGE='drawingbot-document-v2';
let settings={...DEFAULTS},docName='Desenho';
try{const saved=JSON.parse(localStorage.getItem(STORAGE)||localStorage.getItem(OLD_STORAGE)||'null');if(saved)for(const key of Object.keys(DEFAULTS))if(key in saved)settings[key]=saved[key];}catch{}
let job=null,server=null,showOriginal=true,toastTimer,pinOpen=false,finalizeTimer=0,saveTimer=0;
const logs=[];
const handlers={onChange:()=>renderMachine(),onNotice:n=>toast(n.message,n.error),onLine:log};
let machine=new Machine(handlers);
const S=()=>machine.state;

function toast(message,error=false){$('toast').textContent=message;$('toast').className='show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').className='',6500);}
function log(line){logs.push(line);if(logs.length>180)logs.shift();$('console').textContent=logs.join('\n');$('console').scrollTop=$('console').scrollHeight;}
function format(v,d=1){return Number(v).toLocaleString('pt-PT',{maximumFractionDigits:d,minimumFractionDigits:0});}
function readSettings(){
  for(const key of Object.keys(DEFAULTS)){const element=$(key);if(element)settings[key]=element.tagName==='SELECT'?element.value:Number(element.value);}
  try{localStorage.setItem(STORAGE,JSON.stringify(settings));}catch{}
}
function writeSettings(){for(const key of Object.keys(DEFAULTS))if($(key))$(key).value=settings[key];}
function project(){return documentProject({fileName:docName,settings,objects:editor.objects});}

// ---------- Board ----------
const editor=createEditor({svg:$('preview'),onChange:kind=>refresh(kind),onSelect:()=>{renderPanel();renderMachine();},onTool:renderTools});
function penPosition(){const p=S().position;return p.x!==null&&p.y!==null?p:null;}
// Fast path: ink comes from per-object caches, so moving things stays smooth. The full job (order,
// limits and time) is rebuilt shortly after the last change.
function refresh(kind='commit'){
  readSettings();
  let ink=[],original=[];
  try{({ink,original}=composeInk(editor.objects,settings));}catch{}
  editor.draw({settings,ink,original,errors:!!job?.errors.length,pen:penPosition(),showOriginal});
  $('board-hint').classList.toggle('hidden',editor.objects.length>0);
  if(kind!=='live')renderPanel();
  clearTimeout(finalizeTimer);finalizeTimer=setTimeout(finalize,kind==='live'?250:30);
  if(kind!=='live'){clearTimeout(saveTimer);saveTimer=setTimeout(autosave,500);}
}
function finalize(){
  clearTimeout(finalizeTimer);
  const notice=(cls,mark,text)=>{$('job-notice').className='job-notice'+cls;$('job-notice').children[0].textContent=mark;$('job-notice').querySelector('p').textContent=text;};
  try{
    job=composeJob(editor.objects,settings);
    $('size-stat').textContent=`${format(job.bounds.width)} × ${format(job.bounds.height)} mm`;$('paths-stat').textContent=job.metrics.strokes;$('time-stat').textContent=duration(job.metrics.seconds);
    const messages=[...job.errors,...job.warnings];
    notice(job.errors.length?' error':messages.length?' warning':'',job.errors.length?'!':messages.length?'i':'✓',messages.length?messages.join(' '):'O desenho e a largura da tinta cabem no papel.');
  }catch(error){job=null;notice(editor.objects.length?' error':'',editor.objects.length?'!':'i',error.message);for(const id of ['size-stat','paths-stat','time-stat'])$(id).textContent='—';}
  editor.draw({errors:!!job?.errors.length});
  renderMachine();
}
function prepare(){
  readSettings();
  const helpers={center:'A ponta segue a linha original. Ideal para ilustrações e linhas abertas.',inside:`O percurso entra ${format(settings.tip/2,3)} mm. A borda exterior da tinta coincide com o contorno.`,outside:`O percurso sai ${format(settings.tip/2,3)} mm. A borda interior da tinta coincide com o contorno.`};
  $('compensation-help').textContent=helpers[settings.compensation]||helpers.center;
  const inset=settings.compensation==='inside'?5:settings.compensation==='outside'?-5:0;
  for(const [key,value] of Object.entries({x:15+inset,y:8+inset,width:36-inset*2,height:34-inset*2}))$('offset-demo').setAttribute(key,value);
  $('tip-line').style.height=Math.max(1,Math.min(12,settings.tip*5))+'px';
  all('[data-tip]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.tip)===settings.tip));
  $('bed-size').textContent=`${format(settings.bedWidth)} × ${format(settings.bedHeight)} mm`;
  renderFillTiles();refresh();
}
function duration(seconds){return seconds<60?`~ ${Math.ceil(seconds)} s`:`~ ${Math.ceil(seconds/60)} min`;}
function renderPreview(){editor.draw({pen:penPosition()});$('zoom-fit').textContent=Math.round(editor.zoom*100)+'%';$('original-legend').classList.toggle('hidden',!showOriginal);}
function autosave(){try{localStorage.setItem(DOC_STORAGE,JSON.stringify(project()));}catch{}}
function paperCenter(){return {x:Number(settings.paperX)+Number(settings.paperWidth)/2,y:Number(settings.paperY)+Number(settings.paperHeight)/2};}

// ---------- Tools, objects and properties ----------
function renderTools(tool){all('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));}
all('[data-tool]').forEach(b=>b.onclick=()=>editor.setTool(b.dataset.tool));
const KIND_MARK={rect:'▭',ellipse:'◯',polygon:'⬡',star:'☆',heart:'♡',line:'╱',freehand:'∿',svg:'◇',text:'Aa'};
function renderPanel(){
  const list=editor.objects,sel=editor.selected;
  $('object-count').textContent=list.length;$('objects-empty').classList.toggle('hidden',list.length>0);
  const ul=$('object-list');ul.replaceChildren();
  for(const o of [...list].reverse()){
    const li=document.createElement('li'),b=document.createElement('button');
    b.setAttribute('aria-current',String(o.id===sel?.id));b.onclick=()=>editor.select(o.id);
    const kind=document.createElement('span');kind.className='kind';kind.textContent=KIND_MARK[o.kind]||'·';
    const name=document.createElement('span');name.className='name';name.textContent=o.name;
    const meta=document.createElement('span');meta.className='meta';meta.textContent=`${format(o.w)}×${format(o.h)}`;
    b.append(kind,name,meta);li.append(b);ul.append(li);
  }
  $('undo').disabled=!editor.canUndo;$('redo').disabled=!editor.canRedo;
  $('inspector').classList.toggle('hidden',!sel);if(!sel)return;
  $('inspector-title').textContent=sel.name;
  const set=(id,v)=>{if(document.activeElement!==$(id))$(id).value=v;};
  set('obj-x',sel.x);set('obj-y',sel.y);set('obj-w',sel.w);set('obj-h',sel.h);set('obj-rotation',sel.rotation);$('obj-ratio').checked=!!sel.keepRatio;
  const params=['polygon','star'].includes(sel.kind);$('obj-params').classList.toggle('hidden',!params);
  $('obj-sides-field').classList.toggle('hidden',sel.kind!=='polygon');$('obj-points-field').classList.toggle('hidden',sel.kind!=='star');$('obj-inner-field').classList.toggle('hidden',sel.kind!=='star');
  if(params){set('obj-sides',sel.params?.sides??6);set('obj-points',sel.params?.points??5);set('obj-inner',Math.round((sel.params?.inner??.45)*100));}
  $('obj-edit-text').classList.toggle('hidden',sel.kind!=='text');
  const closed=sel.paths.some(p=>p.closed),fill=normalizeFill(sel.fill);
  $('fill-patterns').classList.toggle('hidden',!closed);$('fill-note').classList.toggle('hidden',closed);
  all('#fill-patterns [data-pattern]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.pattern===fill.pattern)));
  const options=closed&&!['none','solid'].includes(fill.pattern);$('fill-options').classList.toggle('hidden',!options);
  set('fill-spacing',fill.spacing);set('fill-angle',fill.angle);
  $('fill-angle').disabled=['concentric','spiral','dots'].includes(fill.pattern);
  const i=list.findIndex(o=>o.id===sel.id);$('obj-up').disabled=i<=0;$('obj-down').disabled=i>=list.length-1;
}
// Pattern tiles: each tile is the real fill of a small circle.
let tilesFor='';
function renderFillTiles(){
  const key=String(settings.tip);if(tilesFor===key)return;tilesFor=key;
  const host=$('fill-patterns');host.replaceChildren();
  const circle=[{closed:true,points:shapePaths('ellipse')[0].points.map(v=>({x:v.x*24,y:v.y*24}))}];
  for(const [pattern,label] of FILL_PATTERNS){
    const b=document.createElement('button');b.type='button';b.dataset.pattern=pattern;b.setAttribute('role','radio');b.title=label;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','-1 -1 26 26');svg.setAttribute('aria-hidden','true');
    const ink=pattern==='none'?circle:fillRegion(circle,.6,{pattern,spacing:pattern==='dots'?4:2.6,angle:pattern==='solid'?0:30}).paths;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class','fp-ink');
    path.setAttribute('d',ink.map(p=>p.points.map((v,i)=>(i?'L':'M')+v.x.toFixed(2)+' '+(24-v.y).toFixed(2)).join('')+(p.closed?'Z':'')).join(''));
    svg.append(path);const span=document.createElement('span');span.textContent=label;b.append(svg,span);
    b.onclick=()=>{const sel=editor.selected;if(sel)editor.update(sel.id,{fill:{...normalizeFill(sel.fill),pattern}});};
    host.append(b);
  }
}
function numberInput(id,apply){
  const input=$(id);let pending=null;
  input.addEventListener('input',()=>{const v=Number(input.value);if(input.value===''||!Number.isFinite(v))return;const sel=editor.selected;if(!sel)return;
    if(!pending){pending=sel.id;editor.update(sel.id,apply(sel,v));}else editor.update(sel.id,apply(sel,v),{commit:false});});
  input.addEventListener('change',()=>{pending=null;renderPanel();});
}
numberInput('obj-x',(o,v)=>({x:v}));numberInput('obj-y',(o,v)=>({y:v}));
numberInput('obj-w',(o,v)=>{const w=Math.max(.1,v);return o.keepRatio&&o.w>0?{w,h:Math.round(o.h*w/o.w*100)/100,x:o.x+(o.w-w)/2,y:o.y+(o.h-o.h*w/o.w)/2}:{w,x:o.x+(o.w-w)/2};});
numberInput('obj-h',(o,v)=>{const h=Math.max(.1,v);return o.keepRatio&&o.h>0?{h,w:Math.round(o.w*h/o.h*100)/100,x:o.x+(o.w-o.w*h/o.h)/2,y:o.y+(o.h-h)/2}:{h,y:o.y+(o.h-h)/2};});
numberInput('obj-rotation',(o,v)=>({rotation:((v%360)+540)%360-180}));
const reshape=(o,params)=>({params,paths:shapePaths(o.kind,params)});
numberInput('obj-sides',(o,v)=>reshape(o,{...o.params,sides:Math.round(Math.min(24,Math.max(3,v)))}));
numberInput('obj-points',(o,v)=>reshape(o,{...o.params,points:Math.round(Math.min(24,Math.max(3,v)))}));
numberInput('obj-inner',(o,v)=>reshape(o,{...o.params,inner:Math.min(.95,Math.max(.1,v/100))}));
numberInput('fill-spacing',(o,v)=>({fill:{...normalizeFill(o.fill),spacing:Math.min(50,Math.max(.3,v))}}));
numberInput('fill-angle',(o,v)=>({fill:{...normalizeFill(o.fill),angle:v}}));
$('obj-ratio').onchange=()=>{const sel=editor.selected;if(sel)editor.update(sel.id,{keepRatio:$('obj-ratio').checked});};
$('obj-delete').onclick=()=>{const sel=editor.selected;if(sel)editor.remove(sel.id);};
$('obj-duplicate').onclick=()=>editor.duplicate();
$('obj-up').onclick=()=>{const sel=editor.selected;if(sel)editor.move(sel.id,-1);};
$('obj-down').onclick=()=>{const sel=editor.selected;if(sel)editor.move(sel.id,1);};
$('undo').onclick=()=>editor.undo();$('redo').onclick=()=>editor.redo();
$('file-name').oninput=()=>{docName=$('file-name').value.trim()||'Desenho';clearTimeout(saveTimer);saveTimer=setTimeout(autosave,500);};
function setDocName(name){docName=String(name||'Desenho').replace(/\.(svg|json)$/i,'').replace(/\.(drawingbot|pen-studio)$/i,'').slice(0,80)||'Desenho';$('file-name').value=docName;}
function exampleObject(){const c=paperCenter();return makeObject('svg',{paths:demoPaths(),x:c.x-60,y:c.y-60,w:120,h:120,name:'Roseta de estudo'});}

let renderedMachine=null;
function renderMachine(){
  const s=S(),remote=!!server,offline=remote&&!machine.online;
  const ready=s.connected&&!s.fault&&!offline,locked=s.busy||s.running||s.connecting||offline;
  const key=JSON.stringify(s.position);
  if(key!==renderedMachine){renderedMachine=key;for(const axis of ['x','y','z'])$('pos-'+axis).textContent=s.position[axis]===null?'—':format(s.position[axis],2);renderPreview();}
  $('connection-badge').className='status-badge'+(s.connected&&!offline?(s.simulated?' sim':' live'):'');
  const label=offline?'DrawingBot sem ligação':s.connecting?'A ligar…':s.connected?(s.simulated?'Simulação':'USB ligada'):s.fault?'Verificar ligação':'Desligada';
  $('connection-badge').replaceChildren(document.createElement('i'),document.createTextNode((remote&&!offline?'DrawingBot · ':'')+label));
  $('connect').textContent=s.connecting?'A preparar…':s.connected?'Desligar USB':'Ligar máquina ↗';$('connect').disabled=s.connecting||s.running||s.busy||offline;
  $('machine-indicator').className='tiny-dot'+(s.connected?' teal':'');
  $('offline-note').classList.toggle('hidden',s.connected);
  $('simulate').classList.toggle('hidden',remote);
  $('offline-copy').textContent=remote?'Liga a CR-10 por USB ao DrawingBot. A ligação é feita automaticamente.':'Liga a CR-10 por USB para controlar os eixos e enviar o desenho.';
  for(const id of ['home','zero','pen-up','bed-off','bed-apply','endstops','release'])$(id).disabled=!ready||locked;
  $('use-position').disabled=!ready||locked||!editor.selected;
  $('pen-down').disabled=!ready||locked||!s.zero;
  all('[data-jog]').forEach(b=>b.disabled=!ready||locked);
  $('zero').disabled=!ready||locked||!s.homed;
  for(const [id,done] of [['step-xy',s.homed],['step-z',s.zero]]){$(id).classList.toggle('done',done);$(id).querySelector('i').textContent=done?'✓':'○';}
  $('emergency').disabled=!s.connected||offline;
  const canDraw=ready&&!locked&&s.homed&&s.zero;
  $('start').disabled=!canDraw||!job||!!job.errors.length;
  $('start').firstChild.textContent=remote?'Enviar e desenhar ':'Desenhar ';
  $('export').disabled=!job||!!job.errors.length||s.running;
  $('upload-job').classList.toggle('hidden',!remote);$('upload-job').disabled=!job||!!job.errors.length||offline;
  $('pause').classList.toggle('hidden',!s.running);$('stop').classList.toggle('hidden',!s.running);$('start').classList.toggle('hidden',s.running);
  $('pause').textContent=s.runState==='paused'?'Continuar':'Pausar';$('pause').disabled=['pausing','stopping'].includes(s.runState)||offline;
  $('stop').disabled=offline;
  const editingLocked=s.running&&!remote;
  document.body.classList.toggle('busy',s.busy||s.running);$('design-settings').disabled=editingLocked;editor.setLocked(editingLocked);
  $('bedWidth').disabled=s.running;$('bedHeight').disabled=s.running;$('bedTarget').disabled=s.running;
  for(const id of ['import','text-tool','load-project','example','new-drawing'])$(id).disabled=editingLocked;
  all('[data-tool]').forEach(b=>b.disabled=editingLocked);
  const titles={running:s.simulated?'A simular o desenho…':'A desenhar…',pausing:'A levantar a caneta para pausar…',paused:'Em pausa · caneta levantada',stopping:'A terminar os movimentos em fila…',complete:s.simulated?'Simulação concluída':'Desenho concluído',cancelled:'Trabalho terminado · caneta levantada',error:'Trabalho interrompido'};
  $('run-title').textContent=offline?'Sem ligação ao DrawingBot':titles[s.runState]||(!s.connected?'Pronto para preparar a máquina':!s.homed?'Faz a origem X/Y':!s.zero?'Define o contacto da caneta':'Tudo pronto para desenhar');
  const jobName=s.job?.name?` · ${s.job.name}`:'';
  $('run-subtitle').textContent=offline?'A tentar ligar novamente. Verifica se o DrawingBot está ligado à rede.':s.running?`${Math.round(s.progress*100)}% enviado · ${s.job?.strokes||0} percursos${jobName}`:
    s.fault?'Reinicia a ligação e redefine as referências.':s.runState==='complete'?`Caneta a Z10 mm · Y no máximo${s.simulated?' · simulação':''}.`:s.simulated?'Modo de demonstração: nenhum motor será acionado.':!s.connected?(remote?'Liga a CR-10 ao DrawingBot, faz a origem e define o contacto.':'Liga a máquina, faz a origem e define o contacto.'):!s.homed?'A caneta deve estar levantada antes da origem.':!s.zero?'Aproxima a ponta ao papel com movimentos de 0,1 mm.':Number(settings.bedTarget)>0?`Cama a ${settings.bedTarget} °C, sem espera por aquecimento.`:'A caneta assenta pelo peso. A cama fica desligada.';
  $('progress').style.width=(s.progress*100)+'%';
  if(s.bed.temp!==null){$('bed-temp').textContent=format(s.bed.temp,1)+' °C';$('bed-state').textContent=s.bed.target?'Alvo '+format(s.bed.target)+' °C':'Aquecimento desligado';}
  $('endstop-state').textContent=s.endstops||'—';
  if(remote)renderJobs();
}
function renderJobs(){
  const s=S(),list=machine.jobs||[],canDraw=s.connected&&!s.fault&&machine.online&&!s.busy&&!s.running&&!s.connecting&&s.homed&&s.zero;
  $('pi-jobs').classList.remove('hidden');$('pi-jobs-count').textContent=list.length;$('pi-jobs-empty').classList.toggle('hidden',!!list.length);
  const ul=$('pi-jobs-list');ul.replaceChildren();
  for(const item of list){
    const li=document.createElement('li'),info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('div');
    name.textContent=item.name;
    meta.textContent=`${format(item.width)} × ${format(item.height)} mm · ${item.strokes} percursos · ${duration(item.seconds)} · ${new Date(item.createdAt).toLocaleString('pt-PT',{dateStyle:'short',timeStyle:'short'})}`;
    info.append(name,meta);actions.className='pi-job-actions';
    const button=(text,cls,onclick,disabled=false)=>{const b=document.createElement('button');b.className=cls;b.textContent=text;b.disabled=disabled;b.onclick=onclick;actions.append(b);};
    button('Abrir','text-button',()=>openRemote(item));
    button('Apagar','text-button danger-text',()=>modal('Apagar o projeto?',`<p>«${escapeHTML(item.name)}» será removido do DrawingBot.</p>`,()=>machine.deleteJob(item.id).catch(e=>toast(e.message,true)),'Apagar projeto'));
    button('Desenhar →','button primary small',()=>startRemote(item),!canDraw);
    li.append(info,actions);ul.append(li);
  }
}
function escapeHTML(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function openRemote(item){
  try{const {project:saved}=await machine.request('jobs/'+encodeURIComponent(item.id));loadProject(saved);toast('Projeto aberto a partir do DrawingBot.');}catch(error){toast(error.message,true);}
}
async function startRemote(item){
  try{toast(await machine.startJob(item.id).then(r=>r.result));}catch(error){toast(error.message,true);}
}
async function perform(action,{quiet=false}={}){
  try{const message=await action();if(!quiet&&typeof message==='string'&&message)toast(message);return message;}
  catch(error){toast(error.message,true);}finally{renderMachine();}
}
async function connect(){
  const s=S();
  if(server)return perform(()=>s.connected?machine.disconnect():machine.connect());
  if(s.connected)return perform(()=>machine.disconnect(),{quiet:true});
  if(!navigator.serial){showHelp();return;}
  let port;try{port=await navigator.serial.requestPort();}catch(error){if(error.name!=='NotFoundError')toast(error.message,true);return;}
  await perform(async()=>{await machine.connect(h=>new MarlinLink({transport:new WebSerialTransport(port),...h}));return 'Ligação pronta. Começa pela origem X/Y, com a caneta levantada.';});
}
async function simulate(){
  if(server)return;
  await perform(async()=>{
    if(S().connected)await machine.disconnect();
    await machine.connect(h=>new SimulatedLink({onLine:h.onLine}),{simulated:true});
    return 'Simulação ligada. Os controlos não acionam a impressora.';
  });
}
function modal(title,body,action,label='Continuar'){
  $('modal-content').replaceChildren();const h=document.createElement('h2');h.textContent=title;$('modal-content').append(h);
  const content=document.createElement('div');content.innerHTML=body;$('modal-content').append(content);
  if(action){const button=document.createElement('button');button.className='button primary';button.textContent=label;button.onclick=()=>{$('modal').close();action();};$('modal-content').append(button);}
  $('modal').showModal();
}
function showHelp(){
  modal('Do ecrã ao papel.',`<p>O DrawingBot prepara e envia desenhos para a tua CR-10 com o firmware de desenho.</p>
    <h3>Desenhar na mesa</h3><p>Escolhe uma ferramenta na barra da mesa e arrasta: retângulo, elipse, polígono, estrela, coração, linha ou mão livre. «Aa» escreve texto e a seta importa um SVG (também podes arrastar o ficheiro para a mesa). Com «Selecionar» moves os objetos, os cantos mudam o tamanho e a pega redonda roda. Shift mantém a proporção ou roda de 15 em 15°. Delete apaga, Ctrl+Z desfaz, Ctrl+D duplica, as setas movem 1 mm (Shift: 10 mm).</p>
    <h3>Preenchimentos</h3><p>Qualquer forma fechada pode ser preenchida: cheio, linhas, quadriculado, ondas, ziguezague, concêntrico, espiral ou pontos. O contorno fica meia ponta para dentro, por isso a tinta respeita o tamanho da forma.</p>
    <h3>1 · Liga e define as referências</h3><p>No computador ligado por USB, usa Chrome ou Edge. Com o DrawingBot (Raspberry Pi) a CR-10 liga-se ao Pi e abres a app em <strong>http://drawingbot.local</strong> a partir de qualquer browser da rede. Se não houver USB, exporta o G-code e usa o cartão SD. A origem e o zero Z nunca são recuperados automaticamente depois de um reinício.</p>
    <h3>2 · Deixa a caneta trabalhar pelo peso</h3><p>Com a caneta levantada, faz a origem X/Y. Aproxima a ponta ao papel em passos de 0,1 mm e usa «Definir zero Z». A app define o zero e levanta a caneta. Deixa a folga do suporte absorver as variações.</p>
    <h3>3 · Escolhe a ponta e a compensação</h3><p>«Centro do traço» segue as linhas. «Por dentro» e «Por fora» deslocam os contornos fechados sem preenchimento em metade da espessura real da ponta. Linhas abertas mantêm o eixo.</p>
    <h3>No DrawingBot</h3><p>«Enviar para o DrawingBot» guarda o desenho no Pi. O desenho corre no Pi: podes fechar o browser ou bloquear o telemóvel sem interromper o trabalho, e voltar a abrir a página para acompanhar, pausar ou terminar.</p>
    <h3>Ao terminar</h3><p>No fim de um desenho completo, a caneta sobe para Z = 10 mm. Só depois a cama avança para o máximo Y configurado (300 mm por defeito). X mantém a última posição. Esta sequência também faz parte do G-code exportado.</p>
    <h3>Pausar e parar</h3><p>«Pausar» termina os movimentos já em fila e levanta a caneta. «Terminar» faz o mesmo e encerra o trabalho, sem avançar a cama. A paragem de emergência desliga a máquina através do firmware e exige um reinício. Os motores mantêm a posição até os soltares ou desligares a alimentação.</p>`);
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function loadSVG(file,at=null){
  if(!file||(S().running&&!server))return;
  try{
    const imported=await importSVG(await file.text());
    const shape=makeObject('svg',{paths:imported.paths,name:file.name.replace(/\.svg$/i,'').slice(0,80)});
    const ratio=shape.paths.length?(()=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of shape.paths)for(const v of p.points){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);}return (maxY-minY)/((maxX-minX)||1);})():1;
    const w=Math.min(Number(settings.paperWidth)*.6,ratio>1?Number(settings.paperHeight)*.6/ratio:120),h=w*ratio,c=at||paperCenter();
    editor.add({...shape,x:Math.round((c.x-w/2)*10)/10,y:Math.round((c.y-h/2)*10)/10,w:Math.round(w*10)/10,h:Math.round(h*10)/10});
    if(editor.objects.length===1)setDocName(file.name);
    toast(imported.warnings.length?imported.warnings.join(' '):`${imported.paths.length} percursos importados.`,false);
  }catch(error){toast(error.message,true);}
}
function loadProject(saved){
  const valid=validateDocument(saved);
  settings=valid.settings;writeSettings();setDocName(valid.fileName);editor.setObjects(valid.objects);prepare();
}
function paperChanged(){
  const formats={bed:[settings.bedWidth,settings.bedHeight],a4:[210,297],a4landscape:[297,210],a5:[148,210]};
  readSettings();const [w,h]=formats[$('paper').value];settings.paperWidth=w;settings.paperHeight=h;
  settings.paperX=Math.max(0,(settings.bedWidth-w)/2);settings.paperY=Math.max(0,(settings.bedHeight-h)/2);writeSettings();prepare();
}
function askPin(){
  if(pinOpen)return;pinOpen=true;
  modal('PIN do DrawingBot',`<p>Este DrawingBot está protegido. Introduz o PIN definido em <strong>drawingbot.txt</strong>.</p><input id="pin-input" type="password" inputmode="numeric" autocomplete="current-password" aria-label="PIN">`,
    async()=>{pinOpen=false;try{await machine.login($('pin-input').value);toast('Ligado ao DrawingBot.');}catch(error){toast(error.message,true);setTimeout(askPin,400);}},'Entrar');
  $('modal').addEventListener('close',()=>{pinOpen=false;},{once:true});
  setTimeout(()=>$('pin-input')?.focus(),50);
}

function toggleTheme(){
  const root=document.documentElement,current=root.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  const next=current==='dark'?'light':'dark';root.dataset.theme=next;try{localStorage.setItem('drawingbot-theme',next);}catch{}
  syncThemeColor();
}
function syncThemeColor(){const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();}
$('theme-toggle').onclick=toggleTheme;syncThemeColor();matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',syncThemeColor);
$('connect').onclick=connect;$('simulate').onclick=simulate;$('help').onclick=()=>showHelp();
$('import').onclick=()=>$('svg-file').click();$('svg-file').onchange=e=>{loadSVG(e.target.files[0]);e.target.value='';};
$('example').onclick=()=>{editor.add(exampleObject());};
$('new-drawing').onclick=()=>{
  const start=()=>{editor.setObjects([],{keepHistory:true});setDocName('Desenho');toast('Mesa limpa. Ctrl+Z recupera o desenho anterior.');};
  if(editor.objects.length)modal('Começar um desenho novo?','<p>Os objetos da mesa são removidos. Podes recuperá-los com «Desfazer».</p>',start,'Limpar a mesa');else start();
};
$('drop-target').ondragover=e=>{e.preventDefault();$('drop-target').classList.add('drop-active');};
$('drop-target').ondragleave=()=>$('drop-target').classList.remove('drop-active');
$('drop-target').ondrop=e=>{e.preventDefault();$('drop-target').classList.remove('drop-active');loadSVG(e.dataTransfer.files[0],editor.pointToBed(e));};
for(const key of Object.keys(DEFAULTS))if($(key))$(key).addEventListener('input',()=>{
  if(key==='paper'){paperChanged();return;}
  if((key==='bedWidth'||key==='bedHeight')&&settings.paper==='bed'){settings.paperWidth=Number($('bedWidth').value);settings.paperHeight=Number($('bedHeight').value);}
  prepare();
});
all('[data-tip]').forEach(b=>b.onclick=()=>{$('tip').value=b.dataset.tip;prepare();});
$('zoom-in').onclick=()=>{editor.setZoom(Math.min(6,editor.zoom*1.4));renderPreview();};$('zoom-out').onclick=()=>{editor.setZoom(Math.max(1,editor.zoom/1.4));renderPreview();};$('zoom-fit').onclick=()=>{editor.setZoom(1);renderPreview();};
$('original-toggle').onclick=()=>{showOriginal=!showOriginal;$('original-toggle').classList.toggle('active',showOriginal);refresh('live');renderPreview();};
const fileBase=()=>docName.replace(/[\\/:*?"<>|]+/g,'-');
$('export').onclick=()=>{finalize();try{download(fileBase()+'-caneta.gcode',exportGcode(job));toast('G-code exportado. Define a origem e o zero Z antes de o executar.');}catch(error){toast(error.message,true);}};
$('save-project').onclick=()=>download(fileBase()+'.drawingbot.json',JSON.stringify(project(),null,2),'application/json');
$('load-project').onclick=()=>$('project-file').click();
$('project-file').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>8e6)throw Error('O projeto é demasiado grande.');
    loadProject(JSON.parse(await file.text()));toast('Projeto aberto. As referências da máquina não são alteradas.');
  }catch(error){toast(error.message,true);}finally{e.target.value='';}
};
$('upload-job').onclick=()=>perform(async()=>{finalize();const meta=await machine.upload(project());return `«${meta.name}» enviado para o DrawingBot.`;});
$('home').onclick=()=>modal('Encontrar a origem X/Y',`<p>Levanta a caneta e deixa o caminho livre. X e Y vão procurar os fins de curso; <strong>o Z não se move</strong>.</p><p class="dialog-note">A origem é sempre da máquina. A posição do desenho é escolhida na mesa.</p>`,
  ()=>perform(()=>machine.home()),'A caneta está levantada · fazer origem');
$('zero').onclick=()=>{readSettings();modal('A ponta toca no papel?',`<p>Aproxima primeiro a caneta com passos de 0,1 mm. A ponta deve tocar levemente no papel, com a caneta livre para subir no suporte.</p><p class="dialog-note">Vamos definir este contacto como Z = 0 e levantar ${format(settings.lift)} mm, sem acrescentar pressão.</p>`,
  ()=>perform(()=>machine.setZero({lift:settings.lift})),'Definir zero e levantar');};
all('[data-jog]').forEach(button=>button.onclick=()=>{
  const [axis,sign]=button.dataset.jog.split(':');
  perform(()=>machine.jog({axis,sign:Number(sign),step:Number($('jog-step').value),bedWidth:settings.bedWidth,bedHeight:settings.bedHeight}),{quiet:true});
});
$('pen-up').onclick=()=>perform(()=>machine.penUp({lift:settings.lift}),{quiet:true});
$('pen-down').onclick=()=>perform(()=>machine.penDown({drawZ:settings.drawZ}),{quiet:true});
$('use-position').onclick=()=>perform(async()=>{const p=await machine.position();const sel=editor.selected;if(sel)editor.update(sel.id,{x:p.x,y:p.y});},{quiet:true});
$('endstops').onclick=()=>perform(()=>machine.endstops(),{quiet:true});
$('release').onclick=()=>modal('Soltar os motores?',`<p>Os eixos ficam livres e a posição pode mudar. Será necessário repetir a origem X/Y e o contacto da caneta antes de desenhar.</p>`,()=>perform(()=>machine.release()),'Soltar e limpar referências');
$('bed-off').onclick=()=>{$('bedTarget').value=0;prepare();perform(()=>machine.setBed({target:0}));};
$('bed-apply').onclick=()=>{readSettings();perform(()=>machine.setBed({target:settings.bedTarget}));};
$('start').onclick=()=>perform(async()=>{
  finalize();
  if(!job||job.errors.length)throw Error('Revê o desenho antes de enviar.');
  if(server){const meta=await machine.upload(project());return (await machine.startJob(meta.id)).result;}
  await machine.start(job,{name:docName});
},{quiet:!server});
$('pause').onclick=()=>perform(()=>machine.pause(),{quiet:true});
$('stop').onclick=()=>perform(()=>machine.cancel(),{quiet:true});
$('emergency').onclick=()=>perform(()=>machine.emergency(),{quiet:true});
window.addEventListener('beforeunload',event=>{if(!server&&S().running){event.preventDefault();event.returnValue='';}});
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').classList.remove('hidden');});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').classList.add('hidden');}};

// ---------- Text ----------
const textTool=createTextTool({toast});
function openText(target=editor.selected?.kind==='text'?editor.selected:null){
  // Reopen with the letter height that matches the current size of the text object.
  const spec=target?.text?{...target.text,capHeight:target.text.width?Math.round(target.text.capHeight*target.w/target.text.width*10)/10:target.text.capHeight}:null;
  textTool.open({spec,onApply:(chosen,result)=>{
    const paths=result.paths.map(p=>({closed:p.closed,points:p.points}));
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of paths)for(const v of p.points){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);}
    const w=Math.round((maxX-minX)*100)/100,h=Math.round((maxY-minY)*100)/100;
    const text={content:chosen.content,font:chosen.font,mode:chosen.mode,align:chosen.align,lineHeight:chosen.lineHeight,capHeight:chosen.capHeight,width:w};
    const name=`Texto · ${chosen.content.trim().split(/\n/)[0].slice(0,32)}`;
    const fill=chosen.mode==='fill'?{...normalizeFill(target?.fill),pattern:target&&normalizeFill(target.fill).pattern!=='none'?normalizeFill(target.fill).pattern:'solid'}:{pattern:'none'};
    if(target&&editor.objects.some(o=>o.id===target.id)){
      const c={x:target.x+target.w/2,y:target.y+target.h/2};
      editor.update(target.id,{paths,text,name,fill,w,h,x:Math.round((c.x-w/2)*100)/100,y:Math.round((c.y-h/2)*100)/100,keepRatio:true});
    }else{
      const c=paperCenter();editor.add(makeObject('text',{paths,text,name,fill,w,h,x:Math.round((c.x-w/2)*100)/100,y:Math.round((c.y-h/2)*100)/100}));
    }
    toast(chosen.mode==='fill'?'Texto pronto: contorno e enchimento à medida da ponta.':'Texto pronto: um só traço por letra.');
  }});
}
$('text-tool').onclick=()=>openText();
$('obj-edit-text').onclick=()=>openText(editor.selected);
$('preview').addEventListener('dblclick',()=>{if(editor.selected?.kind==='text')openText(editor.selected);});
document.addEventListener('keydown',event=>{
  const t=event.target;if(event.ctrlKey||event.metaKey||event.altKey||t?.closest?.('input,textarea,select,dialog')||document.querySelector('dialog[open]'))return;
  if(event.key.toLowerCase()==='t'){event.preventDefault();openText(null);}
  if(event.key.toLowerCase()==='i'){event.preventDefault();$('svg-file').click();}
});

async function init(){
  writeSettings();
  let restored=false;
  try{const saved=JSON.parse(localStorage.getItem(DOC_STORAGE)||'null');if(saved){const valid=validateDocument(saved);setDocName(valid.fileName);editor.setObjects(valid.objects);restored=true;}}catch{}
  if(!restored){setDocName('Roseta de estudo');editor.setObjects([exampleObject()]);}
  renderTools(editor.tool);prepare();
  server=await detectServer();
  if(server){
    machine=new RemoteMachine({...handlers,onJobs:()=>renderMachine(),onAuth:askPin});
    document.body.classList.add('remote');
    $('offline-status').textContent=server.simulated?'Ligado ao DrawingBot · simulação':'Ligado ao DrawingBot';
    renderMachine();
    try{const session=await machine.session();if(session.required&&!session.ok)askPin();else machine.open();}
    catch(error){toast(error.message,true);}
    return;
  }
  if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').then(async()=>{await navigator.serviceWorker.ready;$('offline-status').textContent='Disponível offline';}).catch(()=>$('offline-status').textContent='Usar online ou por localhost');
  window.addEventListener('offline',()=>$('offline-status').textContent='Offline · tudo continua no dispositivo');
  window.addEventListener('online',()=>$('offline-status').textContent='Disponível offline');
}
init();
