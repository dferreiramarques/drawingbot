import test from 'node:test';
import assert from 'node:assert/strict';
import {Machine} from '../src/machine.mjs';
import {SimulatedLink} from '../src/serial.mjs';
import {createJob,validateProject} from '../src/geometry.mjs';

const square={closed:true,points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]};
async function simulated(){
  const notices=[];const machine=new Machine({pollInterval:0,onNotice:n=>notices.push(n)});
  await machine.connect(h=>new SimulatedLink({onLine:h.onLine}),{simulated:true});
  return {machine,notices};
}

test('drawing is refused until X/Y origin and Z contact are defined',async()=>{
  const {machine}=await simulated();
  const job=createJob([square],{width:20});
  await assert.rejects(machine.start(job),/origem/);
  await assert.rejects(machine.setZero({lift:3}),/origem X\/Y/);
  await machine.home();
  await assert.rejects(machine.penDown({drawZ:0}),/contacto/);
  await machine.setZero({lift:3});
  assert.equal(machine.state.zero,true);assert.equal(machine.state.position.z,3);
});

test('a job runs to completion and parks at Z10 with Y at the maximum',async()=>{
  const {machine,notices}=await simulated();
  await machine.home();await machine.setZero({lift:3});
  await machine.start(createJob([square],{width:20,bedHeight:250}),{name:'quadrado'});
  assert.equal(machine.state.running,true);assert.equal(machine.state.job.name,'quadrado');
  await assert.rejects(machine.home(),/ocupada/);
  await machine.done;
  assert.equal(machine.state.runState,'complete');assert.equal(machine.state.running,false);
  assert.deepEqual({y:machine.state.position.y,z:machine.state.position.z},{y:250,z:10});
  assert.match(notices.at(-1).message,/Simulação terminada/);
});

test('jog rejects unknown axes, steps and moves outside the machine',async()=>{
  const {machine}=await simulated();
  await assert.rejects(machine.jog({axis:'e',sign:1,step:1}),/inválido/);
  await assert.rejects(machine.jog({axis:'x',sign:1,step:50}),/inválido/);
  await machine.home();
  await assert.rejects(machine.jog({axis:'x',sign:-1,step:1}),/área útil/);
  await machine.jog({axis:'x',sign:1,step:10});assert.equal(machine.state.position.x,10);
});

test('emergency invalidates references and blocks further actions',async()=>{
  const {machine}=await simulated();
  await machine.home();await machine.emergency();
  assert.equal(machine.state.fault,true);assert.equal(machine.state.homed,false);
  await assert.rejects(machine.home(),/Reinicia/);
});

test('projects are validated before reaching the machine; older pen-studio files still open',()=>{
  const ok=validateProject({format:'pen-studio',version:1,fileName:'a.svg',settings:{width:20,unknown:1},paths:[square]});
  assert.equal(ok.settings.width,20);assert.ok(!('unknown' in ok.settings));
  assert.throws(()=>validateProject({format:'drawingbot',version:1,paths:[{closed:true,points:[{x:NaN,y:0},{x:1,y:1}]}]}),/Coordenada/);
  assert.throws(()=>validateProject({format:'other',version:1,paths:[]}),/incompatível/);
  assert.throws(()=>validateProject({format:'drawingbot',version:1,paths:[]}),/não tem percursos/);
});
