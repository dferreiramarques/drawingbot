import {DEFAULTS,createJob,demoPaths,exportGcode,validateProject,PROJECT_FORMAT} from './geometry.mjs';
import {importSVG} from './svg-import.mjs';
import {MarlinLink,SimulatedLink,WebSerialTransport} from './serial.mjs';
import {Machine} from './machine.mjs';
import {RemoteMachine,detectServer} from './remote.mjs';

const $=id=>document.getElementById(id),all=selector=>[...document.querySelectorAll(selector)];
const ns='http://www.w3.org/2000/svg';
const STORAGE='drawingbot-settings-v1',OLD_STORAGE='pen-studio-settings-v1';
let settings={...DEFAULTS},source=demoPaths(),fileName='Roseta de estudo.svg',importWarnings=[];
try{const saved=JSON.parse(localStorage.getItem(STORAGE)||localStorage.getItem(OLD_STORAGE)||'null');if(saved)for(const key of Object.keys(DEFAULTS))if(key in saved)settings[key]=saved[key];}catch{}
let job=null,server=null,zoom=1,showOriginal=true,toastTimer,pinOpen=false;
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
function project(){return {format:PROJECT_FORMAT,version:1,fileName,settings:{...settings},paths:source};}
function prepare(){
  readSettings();
  try{job=createJob(source,settings);$('size-stat').textContent=`${format(job.bounds.width)} × ${format(job.bounds.height)} mm`;$('paths-stat').textContent=job.metrics.strokes;
    $('time-stat').textContent=duration(job.metrics.seconds);
    const messages=[...job.errors,...importWarnings,...job.warnings];
    $('job-notice').className='job-notice'+(job.errors.length?' error':messages.length?' warning':'');
    $('job-notice').children[0].textContent=job.errors.length?'!':messages.length?'i':'✓';
    $('job-notice').querySelector('p').textContent=messages.length?messages.join(' '):'O desenho e a largura da tinta cabem no papel.';
  }catch(error){job=null;$('job-notice').className='job-notice error';$('job-notice').children[0].textContent='!';$('job-notice').querySelector('p').textContent=error.message;$('size-stat').textContent='—';$('paths-stat').textContent='—';$('time-stat').textContent='—';}
  const helpers={center:'A ponta segue a linha original. Ideal para ilustrações e linhas abertas.',inside:`O percurso entra ${format(settings.tip/2,3)} mm. A borda exterior da tinta coincide com o contorno.`,outside:`O percurso sai ${format(settings.tip/2,3)} mm. A borda interior da tinta coincide com o contorno.`};
  $('compensation-help').textContent=helpers[settings.compensation]||helpers.center;
  const inset=settings.compensation==='inside'?5:settings.compensation==='outside'?-5:0;
  for(const [key,value] of Object.entries({x:15+inset,y:8+inset,width:36-inset*2,height:34-inset*2}))$('offset-demo').setAttribute(key,value);
  $('tip-line').style.height=Math.max(1,Math.min(12,settings.tip*5))+'px';
  all('[data-tip]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.tip)===settings.tip));
  $('file-name').textContent=fileName;$('bed-size').textContent=`${format(settings.bedWidth)} × ${format(settings.bedHeight)} mm`;
  renderPreview();renderMachine();
}
function duration(seconds){return seconds<60?`~ ${Math.ceil(seconds)} s`:`~ ${Math.ceil(seconds/60)} min`;}
function svgElement(tag,attrs={}){const node=document.createElementNS(ns,tag);for(const [name,value] of Object.entries(attrs))node.setAttribute(name,value);return node;}
function pathD(path){return path.points.map((p,i)=>(i?'L':'M')+p.x.toFixed(3)+' '+p.y.toFixed(3)).join(' ')+(path.closed?' Z':'');}
function renderPreview(){
  const svg=$('preview');svg.replaceChildren();
  const w=Number(settings.bedWidth)||300,h=Number(settings.bedHeight)||300,size=Math.max(w,h),span=(size+30)/zoom;
  const center=zoom>1&&job?{x:(job.bounds.minX+job.bounds.maxX)/2,y:h-(job.bounds.minY+job.bounds.maxY)/2}:{x:w/2,y:h/2};
  svg.setAttribute('viewBox',`${center.x-span/2} ${center.y-span/2} ${span} ${span}`);
  const defs=svgElement('defs'),grid=svgElement('pattern',{id:'grid',width:10,height:10,patternUnits:'userSpaceOnUse'});
  grid.append(svgElement('path',{d:'M10 0H0V10',class:'pv-grid','stroke-width':.25}));defs.append(grid);svg.append(defs);
  svg.append(svgElement('rect',{x:0,y:0,width:w,height:h,class:'pv-bed',rx:1,'stroke-width':.5}));
  const paper=svgElement('g',{transform:`translate(0 ${h}) scale(1 -1)`});
  paper.append(svgElement('rect',{x:settings.paperX,y:settings.paperY,width:settings.paperWidth,height:settings.paperHeight,class:'pv-paper','stroke-width':.5}));
  paper.append(svgElement('rect',{x:0,y:0,width:w,height:h,fill:'url(#grid)'}));
  if(job){
    if(showOriginal)for(const p of job.original)paper.append(svgElement('path',{d:pathD(p),class:'pv-original','stroke-width':.3,'stroke-dasharray':'1.5 1.5'}));
    for(const p of job.paths)paper.append(svgElement('path',{d:pathD(p),class:job.errors.length?'pv-ink error':'pv-ink','stroke-width':settings.tip,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.88}));
  }
  const position=S().position;
  if(position.x!==null&&position.y!==null){
    const marker=svgElement('g',{transform:`translate(${position.x} ${position.y})`,class:'pv-pen','stroke-width':.65});
    marker.append(svgElement('circle',{r:2}),svgElement('path',{d:'M-4 0H4M0-4V4'}));paper.append(marker);
  }
  svg.append(paper);
  for(let i=0;i<=w;i+=50){const label=svgElement('text',{x:i,y:h+11,'font-size':3.5,class:'pv-label','text-anchor':'middle'});label.textContent=i;svg.append(label);}
  for(let i=0;i<=h;i+=50){const label=svgElement('text',{x:-4,y:h-i+2.5,'font-size':3.5,class:'pv-label','text-anchor':'end'});label.textContent=i;svg.append(label);}
  const xLabel=svgElement('text',{x:w+6,y:h+2.5,'font-size':4,class:'pv-axis'});xLabel.textContent='X';svg.append(xLabel);
  const yLabel=svgElement('text',{x:-2,y:-6,'font-size':4,class:'pv-axis'});yLabel.textContent='Y';svg.append(yLabel);
  $('zoom-fit').textContent=Math.round(zoom*100)+'%';$('original-legend').classList.toggle('hidden',!showOriginal);
}
let lastPosition='';
function renderMachine(){
  const s=S(),remote=!!server,offline=remote&&!machine.online;
  const ready=s.connected&&!s.fault&&!offline,locked=s.busy||s.running||s.connecting||offline;
  const key=JSON.stringify(s.position);
  if(key!==lastPosition){lastPosition=key;for(const axis of ['x','y','z'])$('pos-'+axis).textContent=s.position[axis]===null?'—':format(s.position[axis],2);renderPreview();}
  $('connection-badge').className='status-badge'+(s.connected&&!offline?(s.simulated?' sim':' live'):'');
  const label=offline?'DrawingBot sem ligação':s.connecting?'A ligar…':s.connected?(s.simulated?'Simulação':'USB ligada'):s.fault?'Verificar ligação':'Desligada';
  $('connection-badge').replaceChildren(document.createElement('i'),document.createTextNode((remote&&!offline?'DrawingBot · ':'')+label));
  $('connect').textContent=s.connecting?'A preparar…':s.connected?'Desligar USB':'Ligar máquina ↗';$('connect').disabled=s.connecting||s.running||s.busy||offline;
  $('machine-indicator').className='tiny-dot'+(s.connected?' teal':'');
  $('offline-note').classList.toggle('hidden',s.connected);
  $('simulate').classList.toggle('hidden',remote);
  $('offline-copy').textContent=remote?'Liga a CR-10 por USB ao DrawingBot. A ligação é feita automaticamente.':'Liga a CR-10 por USB para controlar os eixos e enviar o desenho.';
  for(const id of ['home','zero','pen-up','bed-off','bed-apply','endstops','release','use-position'])$(id).disabled=!ready||locked;
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
  document.body.classList.toggle('busy',s.busy||s.running);$('design-settings').disabled=s.running&&!remote;
  $('bedWidth').disabled=s.running;$('bedHeight').disabled=s.running;$('bedTarget').disabled=s.running;
  for(const id of ['import','load-project','example'])$(id).disabled=s.running&&!remote;
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
    <h3>1 · Liga e define as referências</h3><p>No computador ligado por USB, usa Chrome ou Edge. Com o DrawingBot (Raspberry Pi) a CR-10 liga-se ao Pi e abres a app em <strong>http://drawingbot.local</strong> a partir de qualquer browser da rede. Se não houver USB, exporta o G-code e usa o cartão SD. A origem e o zero Z nunca são recuperados automaticamente depois de um reinício.</p>
    <h3>2 · Deixa a caneta trabalhar pelo peso</h3><p>Com a caneta levantada, faz a origem X/Y. Aproxima a ponta ao papel em passos de 0,1 mm e usa «Definir zero Z». A app define o zero e levanta a caneta. Deixa a folga do suporte absorver as variações.</p>
    <h3>3 · Escolhe a ponta e a compensação</h3><p>«Centro do traço» segue as linhas do SVG. «Por dentro» e «Por fora» deslocam os contornos fechados em metade da espessura real da ponta. Linhas abertas mantêm o eixo. Contornos totalmente contidos são tratados como recortes; formas sobrepostas são unidas.</p>
    <h3>No DrawingBot</h3><p>«Enviar para o DrawingBot» guarda o projeto no Pi. O desenho corre no Pi: podes fechar o browser ou bloquear o telemóvel sem interromper o trabalho, e voltar a abrir a página para acompanhar, pausar ou terminar.</p>
    <h3>SVG e papel</h3><p>Importa caminhos, linhas e formas simples. Converte texto e símbolos em caminhos antes de exportar o SVG. O preenchimento de áreas não é gerado: a app desenha os contornos. Define onde o papel começa na cama e verifica a pré-visualização antes de enviar.</p>
    <h3>Ao terminar</h3><p>No fim de um desenho completo, a caneta sobe para Z = 10 mm. Só depois a cama avança para o máximo Y configurado (300 mm por defeito). X mantém a última posição. Esta sequência também faz parte do G-code exportado.</p>
    <h3>Pausar e parar</h3><p>«Pausar» termina os movimentos já em fila e levanta a caneta. «Terminar» faz o mesmo e encerra o trabalho, sem avançar a cama. A paragem de emergência desliga a máquina através do firmware e exige um reinício. Os motores mantêm a posição até os soltares ou desligares a alimentação.</p>`);
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const baseName=()=>fileName.replace(/\.[^.]+$/,'');
async function loadSVG(file){
  if(!file||(S().running&&!server))return;
  try{const imported=await importSVG(await file.text());source=imported.paths;importWarnings=imported.warnings;fileName=file.name;zoom=1;prepare();toast(`${source.length} percursos importados.`);}catch(error){toast(error.message,true);}
}
function loadProject(saved){
  const valid=validateProject(saved);
  source=valid.paths;settings=valid.settings;fileName=valid.fileName;importWarnings=[];zoom=1;writeSettings();prepare();
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
$('example').onclick=()=>{source=demoPaths();importWarnings=[];fileName='Roseta de estudo.svg';prepare();};
$('drop-target').ondragover=e=>{e.preventDefault();$('drop-target').classList.add('drop-active');};
$('drop-target').ondragleave=()=>$('drop-target').classList.remove('drop-active');
$('drop-target').ondrop=e=>{e.preventDefault();$('drop-target').classList.remove('drop-active');loadSVG(e.dataTransfer.files[0]);};
for(const key of Object.keys(DEFAULTS))if($(key))$(key).addEventListener('input',()=>{
  if(key==='paper'){paperChanged();return;}
  if((key==='bedWidth'||key==='bedHeight')&&settings.paper==='bed'){settings.paperWidth=Number($('bedWidth').value);settings.paperHeight=Number($('bedHeight').value);}
  prepare();
});
all('[data-tip]').forEach(b=>b.onclick=()=>{$('tip').value=b.dataset.tip;prepare();});
$('zoom-in').onclick=()=>{zoom=Math.min(4,zoom*1.4);renderPreview();};$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom/1.4);renderPreview();};$('zoom-fit').onclick=()=>{zoom=1;renderPreview();};
$('original-toggle').onclick=()=>{showOriginal=!showOriginal;$('original-toggle').classList.toggle('active',showOriginal);renderPreview();};
$('export').onclick=()=>{try{download(baseName()+'-caneta.gcode',exportGcode(job));toast('G-code exportado. Define a origem e o zero Z antes de o executar.');}catch(error){toast(error.message,true);}};
$('save-project').onclick=()=>download(baseName()+'.drawingbot.json',JSON.stringify(project(),null,2),'application/json');
$('load-project').onclick=()=>$('project-file').click();
$('project-file').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>8e6)throw Error('O projeto é demasiado grande.');
    loadProject(JSON.parse(await file.text()));toast('Projeto aberto. As referências da máquina não são alteradas.');
  }catch(error){toast(error.message,true);}finally{e.target.value='';}
};
$('upload-job').onclick=()=>perform(async()=>{const meta=await machine.upload(project());return `«${meta.name}» enviado para o DrawingBot.`;});
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
$('use-position').onclick=()=>perform(async()=>{const p=await machine.position();$('originX').value=p.x;$('originY').value=p.y;prepare();},{quiet:true});
$('endstops').onclick=()=>perform(()=>machine.endstops(),{quiet:true});
$('release').onclick=()=>modal('Soltar os motores?',`<p>Os eixos ficam livres e a posição pode mudar. Será necessário repetir a origem X/Y e o contacto da caneta antes de desenhar.</p>`,()=>perform(()=>machine.release()),'Soltar e limpar referências');
$('bed-off').onclick=()=>{$('bedTarget').value=0;prepare();perform(()=>machine.setBed({target:0}));};
$('bed-apply').onclick=()=>{readSettings();perform(()=>machine.setBed({target:settings.bedTarget}));};
$('start').onclick=()=>perform(async()=>{
  if(!job||job.errors.length)throw Error('Revê o desenho antes de enviar.');
  if(server){const meta=await machine.upload(project());return (await machine.startJob(meta.id)).result;}
  await machine.start(job,{name:fileName});
},{quiet:!server});
$('pause').onclick=()=>perform(()=>machine.pause(),{quiet:true});
$('stop').onclick=()=>perform(()=>machine.cancel(),{quiet:true});
$('emergency').onclick=()=>perform(()=>machine.emergency(),{quiet:true});
window.addEventListener('beforeunload',event=>{if(!server&&S().running){event.preventDefault();event.returnValue='';}});
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').classList.remove('hidden');});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').classList.add('hidden');}};

async function init(){
  writeSettings();prepare();
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
