import {DEFAULTS,createJob,demoPaths,jobCommands,exportGcode} from './geometry.mjs';
import {importSVG} from './svg-import.mjs';
import {MarlinLink,SimulatedLink,JobRunner} from './serial.mjs';

const $=id=>document.getElementById(id),all=selector=>[...document.querySelectorAll(selector)];
const ns='http://www.w3.org/2000/svg';
const STORAGE='pen-studio-settings-v1';
let settings={...DEFAULTS},source=demoPaths(),fileName='Roseta de estudo.svg',importWarnings=[];
try{const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');if(saved)for(const key of Object.keys(DEFAULTS))if(key in saved)settings[key]=saved[key];}catch{}
let job=null,link=null,runner=null,connected=false,connecting=false,busy=false,homed=false,zero=false,fault=false,
  simulated=false,position={x:null,y:null,z:null},zoom=1,showOriginal=true,progress=0,runState='idle',toastTimer,pollTimer;
const logs=[];
function toast(message,error=false){$('toast').textContent=message;$('toast').className='show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').className='',6500);}
function log(line){logs.push(line);if(logs.length>180)logs.shift();$('console').textContent=logs.join('\n');$('console').scrollTop=$('console').scrollHeight;
  const temp=line.match(/\bB:([\d.]+)\s*\/([\d.]+)/);if(temp){$('bed-temp').textContent=Number(temp[1]).toFixed(1)+' °C';$('bed-state').textContent=Number(temp[2])===0?'Aquecimento desligado':'Alvo '+temp[2]+' °C';}
}
function clearReferences(){homed=false;zero=false;renderMachine();}
function onReset(){clearReferences();if(runner){runner.cancel();fault=true;runState='error';}toast('A placa reiniciou. Repete a origem X/Y e o contacto Z.');renderMachine();}
function onDisconnect(){connected=false;fault=true;clearReferences();if(runner)runner.cancel();stopPolling();toast('USB desligado. As referências precisam de ser definidas novamente.',true);renderMachine();}
function format(v,d=1){return Number(v).toLocaleString('pt-PT',{maximumFractionDigits:d,minimumFractionDigits:0});}
function readSettings(){
  for(const key of Object.keys(DEFAULTS)){const element=$(key);if(element)settings[key]=element.tagName==='SELECT'?element.value:Number(element.value);}
  try{localStorage.setItem(STORAGE,JSON.stringify(settings));}catch{}
}
function writeSettings(){for(const key of Object.keys(DEFAULTS))if($(key))$(key).value=settings[key];}
function prepare(){
  readSettings();
  try{job=createJob(source,settings);$('size-stat').textContent=`${format(job.bounds.width)} × ${format(job.bounds.height)} mm`;$('paths-stat').textContent=job.metrics.strokes;
    const seconds=job.metrics.seconds;$('time-stat').textContent=seconds<60?`~ ${Math.ceil(seconds)} s`:`~ ${Math.ceil(seconds/60)} min`;
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
function svgElement(tag,attrs={}){const node=document.createElementNS(ns,tag);for(const [name,value] of Object.entries(attrs))node.setAttribute(name,value);return node;}
function pathD(path){return path.points.map((p,i)=>(i?'L':'M')+p.x.toFixed(3)+' '+p.y.toFixed(3)).join(' ')+(path.closed?' Z':'');}
function renderPreview(){
  const svg=$('preview');svg.replaceChildren();
  const w=Number(settings.bedWidth)||300,h=Number(settings.bedHeight)||300,size=Math.max(w,h),span=(size+30)/zoom;
  const center=zoom>1&&job?{x:(job.bounds.minX+job.bounds.maxX)/2,y:h-(job.bounds.minY+job.bounds.maxY)/2}:{x:w/2,y:h/2};
  svg.setAttribute('viewBox',`${center.x-span/2} ${center.y-span/2} ${span} ${span}`);
  const defs=svgElement('defs'),grid=svgElement('pattern',{id:'grid',width:10,height:10,patternUnits:'userSpaceOnUse'});
  grid.append(svgElement('path',{d:'M10 0H0V10',fill:'none',stroke:'#c7cfbb','stroke-width':.25}));defs.append(grid);svg.append(defs);
  svg.append(svgElement('rect',{x:0,y:0,width:w,height:h,fill:'#e7eadf',rx:1,stroke:'#c8d0bc','stroke-width':.5}));
  const paper=svgElement('g',{transform:`translate(0 ${h}) scale(1 -1)`});
  paper.append(svgElement('rect',{x:settings.paperX,y:settings.paperY,width:settings.paperWidth,height:settings.paperHeight,fill:'#fffef9',stroke:'#d7ddcb','stroke-width':.5}));
  paper.append(svgElement('rect',{x:0,y:0,width:w,height:h,fill:'url(#grid)'}));
  if(job){
    if(showOriginal)for(const p of job.original)paper.append(svgElement('path',{d:pathD(p),fill:'none',stroke:'#a5ad96','stroke-width':.3,'stroke-dasharray':'1.5 1.5'}));
    for(const p of job.paths)paper.append(svgElement('path',{d:pathD(p),fill:'none',stroke:job.errors.length?'#b66e50':'#367c71','stroke-width':settings.tip,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.88}));
  }
  if(position.x!==null&&position.y!==null){
    const marker=svgElement('g',{transform:`translate(${position.x} ${position.y})`,stroke:'#cf764e','stroke-width':.65});
    marker.append(svgElement('circle',{r:2,fill:'#fdfaf3'}),svgElement('path',{d:'M-4 0H4M0-4V4'}));paper.append(marker);
  }
  svg.append(paper);
  for(let i=0;i<=w;i+=50){const label=svgElement('text',{x:i,y:h+8,'font-size':3.5,fill:'#9ba58d','text-anchor':'middle'});label.textContent=i;svg.append(label);}
  for(let i=0;i<=h;i+=50){const label=svgElement('text',{x:-5,y:h-i+1,'font-size':3.5,fill:'#9ba58d','text-anchor':'end'});label.textContent=i;svg.append(label);}
  const xLabel=svgElement('text',{x:w+8,y:h+1,'font-size':4,fill:'#8d9b7c'});xLabel.textContent='X';svg.append(xLabel);
  const yLabel=svgElement('text',{x:-1,y:-7,'font-size':4,fill:'#8d9b7c'});yLabel.textContent='Y';svg.append(yLabel);
  $('zoom-fit').textContent=Math.round(zoom*100)+'%';$('original-legend').classList.toggle('hidden',!showOriginal);
}
function setPosition(p){position={...position,...p};for(const axis of ['x','y','z'])$('pos-'+axis).textContent=position[axis]===null?'—':format(position[axis],2);renderPreview();}
function renderMachine(){
  const ready=connected&&!fault,locked=busy||!!runner;
  $('connection-badge').className='status-badge'+(connected?(simulated?' sim':' live'):'');
  $('connection-badge').replaceChildren(Object.assign(document.createElement('i'),{}),document.createTextNode(connecting?'A ligar…':connected?(simulated?'Simulação':'USB ligada'):fault?'Verificar ligação':'Desligada'));
  $('connect').textContent=connecting?'A preparar…':connected?'Desligar USB':'Ligar máquina ↗';$('connect').disabled=connecting||locked;
  $('machine-indicator').className='tiny-dot'+(connected?' teal':'');
  $('offline-note').classList.toggle('hidden',connected);
  for(const id of ['home','zero','pen-up','bed-off','bed-apply','endstops','release','use-position'])$(id).disabled=!ready||locked;
  $('pen-down').disabled=!ready||locked||!zero;
  all('[data-jog]').forEach(b=>b.disabled=!ready||locked);
  $('zero').disabled=!ready||locked||!homed;
  for(const [id,done] of [['step-xy',homed],['step-z',zero]]){$(id).classList.toggle('done',done);$(id).querySelector('i').textContent=done?'✓':'○';}
  $('emergency').disabled=!connected;
  $('start').disabled=!ready||locked||!homed||!zero||!job||!!job.errors.length;
  $('export').disabled=!job||!!job.errors.length||locked;
  $('pause').classList.toggle('hidden',!runner);$('stop').classList.toggle('hidden',!runner);$('start').classList.toggle('hidden',!!runner);
  $('pause').textContent=runState==='paused'?'Continuar':'Pausar';$('pause').disabled=['pausing','stopping'].includes(runState);
  document.body.classList.toggle('busy',locked);$('design-settings').disabled=locked;
  $('bedWidth').disabled=locked;$('bedHeight').disabled=locked;
  $('bedTarget').disabled=locked;
  for(const id of ['import','load-project','example'])$(id).disabled=locked;
  const titles={running:simulated?'A simular o desenho…':'A desenhar…',pausing:'A levantar a caneta para pausar…',paused:'Em pausa · caneta levantada',stopping:'A terminar os movimentos em fila…',complete:simulated?'Simulação concluída':'Desenho concluído',cancelled:'Trabalho terminado · caneta levantada',error:'Trabalho interrompido'};
  $('run-title').textContent=titles[runState]||(!connected?'Pronto para preparar a máquina':!homed?'Faz a origem X/Y':!zero?'Define o contacto da caneta':'Tudo pronto para desenhar');
  $('run-subtitle').textContent=runner?`${Math.round(progress*100)}% enviado · ${job?.metrics.strokes||0} percursos`:
    fault?'Reinicia a ligação e redefine as referências.':runState==='complete'?`Caneta a Z10 mm · Y no máximo${simulated?' · simulação':''}.`:simulated?'Modo de demonstração: nenhum motor será acionado.':!connected?'Liga a máquina, faz a origem e define o contacto.':!homed?'A caneta deve estar levantada antes da origem.':!zero?'Aproxima a ponta ao papel com movimentos de 0,1 mm.':Number(settings.bedTarget)>0?`Cama a ${settings.bedTarget} °C, sem espera por aquecimento.`:'A caneta assenta pelo peso. A cama fica desligada.';
  $('progress').style.width=(progress*100)+'%';
}
async function act(action){
  if(!connected||busy||runner||fault)return;
  busy=true;renderMachine();
  try{await link.sync();await action();}catch(error){toast(error.message,true);if(!link.connected){connected=false;clearReferences();}}
  finally{busy=false;renderMachine();}
}
function stopPolling(){clearInterval(pollTimer);pollTimer=null;}
function startPolling(){stopPolling();pollTimer=setInterval(()=>{
  if(connected&&!busy&&!runner&&!connecting&&!fault)act(async()=>{setPosition(await link.position());await link.command('M105');});
},6000);}
async function disconnect(){stopPolling();await link?.disconnect();link=null;connected=false;simulated=false;fault=false;runState='idle';clearReferences();setPosition({x:null,y:null,z:null});renderMachine();}
async function connect(){
  if(connected){await disconnect();return;}
  if(!navigator.serial){showHelp('usb');return;}
  let port;try{port=await navigator.serial.requestPort();}catch(error){if(error.name!=='NotFoundError')toast(error.message,true);return;}
  connecting=true;fault=false;clearReferences();renderMachine();
  link=new MarlinLink({onLine:log,onReset,onDisconnect});
  try{
    await link.connect(port);connected=true;simulated=false;runState='idle';
    await link.sync();setPosition(await link.position());await link.command('M105');startPolling();
    toast('Ligação pronta. Começa pela origem X/Y, com a caneta levantada.');
  }catch(error){await link.disconnect();link=null;connected=false;toast(error.message,true);}
  finally{connecting=false;renderMachine();}
}
async function simulate(){await disconnect();link=new SimulatedLink({onLine:log});connected=true;simulated=true;fault=false;setPosition(await link.position());renderMachine();toast('Simulação ligada. Os controlos não acionam a impressora.');}
function modal(title,body,action,label='Continuar'){
  $('modal-content').replaceChildren();const h=document.createElement('h2');h.textContent=title;$('modal-content').append(h);
  const content=document.createElement('div');content.innerHTML=body;$('modal-content').append(content);
  if(action){const button=document.createElement('button');button.className='button primary';button.textContent=label;button.onclick=()=>{$('modal').close();action();};$('modal-content').append(button);}
  $('modal').showModal();
}
function showHelp(section){
  modal('Do ecrã ao papel.',`<p>O Pen Studio prepara e envia desenhos para a tua CR-10 com o firmware de desenho.</p>
    <h3>1 · Liga e define as referências</h3><p>Usa Chrome ou Edge no computador ligado por USB. Se o navegador não disponibilizar USB, exporta o G-code e usa o cartão SD. Ao ligar por USB, a placa pode reiniciar: a origem e o zero Z nunca são recuperados automaticamente.</p>
    <h3>2 · Deixa a caneta trabalhar pelo peso</h3><p>Com a caneta levantada, faz a origem X/Y. Aproxima a ponta ao papel em passos de 0,1 mm e usa «Definir zero Z». A app define o zero e levanta a caneta. Deixa a folga do suporte absorver as variações.</p>
    <h3>3 · Escolhe a ponta e a compensação</h3><p>«Centro do traço» segue as linhas do SVG. «Por dentro» e «Por fora» deslocam os contornos fechados em metade da espessura real da ponta. Linhas abertas mantêm o eixo. Contornos totalmente contidos são tratados como recortes; formas sobrepostas são unidas.</p>
    <h3>SVG e papel</h3><p>Importa caminhos, linhas e formas simples. Converte texto e símbolos em caminhos antes de exportar o SVG. O preenchimento de áreas não é gerado: a app desenha os contornos. Define onde o papel começa na cama e verifica a pré-visualização antes de enviar.</p>
    <h3>Ao terminar</h3><p>No fim de um desenho completo, a caneta sobe para Z = 10 mm. Só depois a cama avança para o máximo Y configurado (300 mm por defeito). X mantém a última posição. Esta sequência também faz parte do G-code exportado.</p>
    <h3>Pausar e parar</h3><p>«Pausar» termina os movimentos já em fila e levanta a caneta. «Terminar» faz o mesmo e encerra o trabalho, sem avançar a cama. A paragem de emergência desliga a máquina através do firmware e exige um reinício. Os motores mantêm a posição até os soltares ou desligares a alimentação.</p>
    <h3>Instalar e trabalhar offline</h3><p>No Chrome ou Edge, instala esta PWA pelo botão de instalação do navegador. A app e a geometria funcionam localmente; os desenhos não são enviados para um servidor. A ligação USB direta não está disponível em todos os navegadores de telemóvel.</p>`);
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function loadSVG(file){
  if(!file||busy||runner)return;
  try{const imported=await importSVG(await file.text());source=imported.paths;importWarnings=imported.warnings;fileName=file.name;zoom=1;progress=0;runState='idle';prepare();toast(`${source.length} percursos importados.`);}catch(error){toast(error.message,true);}
}
function paperChanged(){
  const formats={bed:[settings.bedWidth,settings.bedHeight],a4:[210,297],a4landscape:[297,210],a5:[148,210]};
  readSettings();const [w,h]=formats[$('paper').value];settings.paperWidth=w;settings.paperHeight=h;
  settings.paperX=Math.max(0,(settings.bedWidth-w)/2);settings.paperY=Math.max(0,(settings.bedHeight-h)/2);writeSettings();prepare();
}
$('connect').onclick=connect;$('simulate').onclick=simulate;$('help').onclick=()=>showHelp();
$('import').onclick=()=>$('svg-file').click();$('svg-file').onchange=e=>{loadSVG(e.target.files[0]);e.target.value='';};
$('example').onclick=()=>{source=demoPaths();importWarnings=[];fileName='Roseta de estudo.svg';prepare();};
$('drop-target').ondragover=e=>{e.preventDefault();$('drop-target').classList.add('drop-active');};
$('drop-target').ondragleave=()=>$('drop-target').classList.remove('drop-active');
$('drop-target').ondrop=e=>{e.preventDefault();$('drop-target').classList.remove('drop-active');loadSVG(e.dataTransfer.files[0]);};
for(const key of Object.keys(DEFAULTS))if($(key))$(key).addEventListener('input',()=>{
  if(key==='paper'){paperChanged();return;}
  if((key==='bedWidth'||key==='bedHeight')&&settings.paper==='bed'){settings.paperWidth=Number($('bedWidth').value);settings.paperHeight=Number($('bedHeight').value);}
  progress=0;runState='idle';prepare();
});
all('[data-tip]').forEach(b=>b.onclick=()=>{$('tip').value=b.dataset.tip;prepare();});
$('zoom-in').onclick=()=>{zoom=Math.min(4,zoom*1.4);renderPreview();};$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom/1.4);renderPreview();};$('zoom-fit').onclick=()=>{zoom=1;renderPreview();};
$('original-toggle').onclick=()=>{showOriginal=!showOriginal;$('original-toggle').classList.toggle('active',showOriginal);renderPreview();};
$('export').onclick=()=>{try{download(fileName.replace(/\.[^.]+$/,'')+'-caneta.gcode',exportGcode(job));toast('G-code exportado. Define a origem e o zero Z antes de o executar.');}catch(error){toast(error.message,true);}};
$('save-project').onclick=()=>download(fileName.replace(/\.[^.]+$/,'')+'.pen-studio.json',JSON.stringify({format:'pen-studio',version:1,fileName,settings,paths:source},null,2),'application/json');
$('load-project').onclick=()=>$('project-file').click();
$('project-file').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>8e6)throw Error('O projeto é demasiado grande.');
    const saved=JSON.parse(await file.text());if(saved.format!=='pen-studio'||saved.version!==1||!Array.isArray(saved.paths))throw Error('Projeto incompatível.');
    let count=0;for(const path of saved.paths){if(typeof path.closed!=='boolean'||!Array.isArray(path.points)||path.points.length<2)throw Error('Percurso inválido.');count+=path.points.length;for(const p of path.points)if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)throw Error('Coordenada inválida.');}
    if(count>180000)throw Error('Demasiados pontos no projeto.');
    const next={...DEFAULTS};for(const key of Object.keys(DEFAULTS))if(key in saved.settings)next[key]=saved.settings[key];createJob(saved.paths,next);
    source=saved.paths;settings=next;fileName=String(saved.fileName||'Projeto.svg');importWarnings=[];writeSettings();prepare();toast('Projeto aberto. As referências da máquina não são alteradas.');
  }catch(error){toast(error.message,true);}finally{e.target.value='';}
};
$('home').onclick=()=>modal('Encontrar a origem X/Y',`<p>Levanta a caneta e deixa o caminho livre. X e Y vão procurar os fins de curso; <strong>o Z não se move</strong>.</p><p class="dialog-note">A origem é sempre da máquina. A posição do desenho é escolhida na mesa.</p>`,()=>act(async()=>{
  await link.command('G28 X Y',{timeout:90000});await link.command('M400');homed=true;setPosition(await link.position());toast('Origem X/Y definida.');
}),'A caneta está levantada · fazer origem');
$('zero').onclick=()=>modal('A ponta toca no papel?',`<p>Aproxima primeiro a caneta com passos de 0,1 mm. A ponta deve tocar levemente no papel, com a caneta livre para subir no suporte.</p><p class="dialog-note">Vamos definir este contacto como Z = 0 e levantar ${format(settings.lift)} mm, sem acrescentar pressão.</p>`,()=>act(async()=>{
  await link.command('M400');await link.command('G92 Z0');zero=true;
  await link.command('G90');await link.command(`G0 Z${settings.lift} F180`);await link.command('M400');setPosition(await link.position());toast('Contacto definido. A caneta está levantada.');
}),'Definir zero e levantar');
all('[data-jog]').forEach(button=>button.onclick=()=>act(async()=>{
  const [axis,sign]=button.dataset.jog.split(':');let step=Number($('jog-step').value);
  if(axis==='z')step=Math.min(step,1);else if(!homed)step=Math.min(step,1);
  const p=await link.position(),delta=step*Number(sign),next=p[axis]+delta;
  if(axis!=='z'&&homed&&(next<0||next>Number(settings[axis==='x'?'bedWidth':'bedHeight'])))throw Error('Esse movimento sai da área útil.');
  await link.command('G91');try{await link.command(`G1 ${axis.toUpperCase()}${delta.toFixed(3)} F${axis==='z'?120:1200}`);await link.command('M400');}finally{await link.command('G90');}
  setPosition(await link.position());
}));
$('pen-up').onclick=()=>act(async()=>{await link.command('G90');if(zero)await link.command(`G0 Z${settings.lift} F180`);else{await link.command('G91');await link.command(`G0 Z${settings.lift} F180`);await link.command('G90');}await link.command('M400');setPosition(await link.position());});
$('pen-down').onclick=()=>act(async()=>{await link.command('G90');await link.command(`G1 Z${settings.drawZ} F120`);await link.command('M400');setPosition(await link.position());});
$('use-position').onclick=()=>act(async()=>{setPosition(await link.position());$('originX').value=position.x;$('originY').value=position.y;prepare();});
$('endstops').onclick=()=>act(async()=>{const result=await link.command('M119');$('endstop-state').textContent=result.replace(/\nok$/,'').replace(/x_min:/,'X:').replace(/y_min:/,'Y:').replace(/TRIGGERED/g,'acionado').replace(/open/g,'livre');});
$('release').onclick=()=>modal('Soltar os motores?',`<p>Os eixos ficam livres e a posição pode mudar. Será necessário repetir a origem X/Y e o contacto da caneta antes de desenhar.</p>`,()=>act(async()=>{await link.command('M400');await link.command('M18');clearReferences();toast('Motores livres. Repete as referências antes de desenhar.');}),'Soltar e limpar referências');
$('bed-off').onclick=()=>act(async()=>{$('bedTarget').value=0;prepare();await link.command('M140 S0');await link.command('M105');toast('Aquecimento da cama desligado.');});
$('bed-apply').onclick=()=>act(async()=>{readSettings();const target=Number(settings.bedTarget);if(!Number.isFinite(target)||target<0||target>60)throw Error('Escolhe uma temperatura entre 0 e 60 °C.');await link.command(`M140 S${target}`);await link.command('M105');toast(target?`Cama definida para ${target} °C, sem espera.`:'Cama desligada.');});
$('start').onclick=async()=>{
  if(!connected||busy||runner||fault||!homed||!zero||!job||job.errors.length)return;
  busy=true;renderMachine();
  try{
    await link.sync();setPosition(await link.position());
    const active=structuredClone(job),commands=jobCommands(active);progress=0;
    runner=new JobRunner(link,{onProgress:value=>{progress=value;renderMachine();},onState:value=>{runState=value;renderMachine();},onPosition:setPosition});
    busy=false;renderMachine();await runner.run(active,commands);
    toast(runState==='complete'?(simulated?'Simulação terminada: Z10 mm e Y no máximo.':'Desenho terminado: caneta a 10 mm e Y no máximo.'):'Trabalho terminado. A caneta ficou levantada.');
  }catch(error){fault=true;homed=false;zero=false;runState='error';toast(error.message,true);}
  finally{runner=null;busy=false;renderMachine();}
};
$('pause').onclick=()=>{if(!runner)return;if(runState==='paused')runner.resume();else runner.pause();};
$('stop').onclick=()=>runner?.cancel();
$('emergency').onclick=async()=>{runner?.cancel();fault=true;clearReferences();runState='error';renderMachine();await link?.emergency();toast('Emergência enviada. Reinicia a máquina e volta a ligar a app.',true);};
window.addEventListener('beforeunload',event=>{if(runner){event.preventDefault();event.returnValue='';}});
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').classList.remove('hidden');});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').classList.add('hidden');}};
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').then(async registration=>{await navigator.serviceWorker.ready;$('offline-status').textContent='Disponível offline';}).catch(()=>$('offline-status').textContent='Usar online ou por localhost');
window.addEventListener('offline',()=>$('offline-status').textContent='Offline · tudo continua no dispositivo');
window.addEventListener('online',()=>$('offline-status').textContent='Disponível offline');
writeSettings();prepare();setPosition(position);
