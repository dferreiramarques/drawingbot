import test from 'node:test';
import assert from 'node:assert/strict';
import {createJob,compensate,bounds,exportGcode,jobCommands} from '../src/geometry.mjs';
const square=(x=0,y=0,size=20)=>({closed:true,points:[{x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size}]});
const close=(a,b)=>assert.ok(Math.abs(a-b)<.01,`${a} != ${b}`);
test('inside compensation offsets centreline by half actual tip diameter',()=>{
  const job=createJob([square()],{width:20,tip:2,compensation:'inside',originX:30,originY:30});
  close(job.bounds.minX,31);close(job.bounds.maxX,49);assert.deepEqual(job.errors,[]);close(job.offset,-1);
});
test('outside compensation expands the path by radius, not full tip diameter',()=>{
  const job=createJob([square()],{width:20,tip:2,compensation:'outside'});
  close(job.bounds.minX,29);close(job.bounds.maxX,51);close(job.offset,1);
});
test('holes expand when outer contours shrink',()=>{
  const result=compensate([square(0,0,100),square(35,35,30)],4,'inside');
  assert.equal(result.paths.length,2);
  const boxes=result.paths.map(p=>bounds([p])).sort((a,b)=>b.width-a.width);
  close(boxes[0].width,96);close(boxes[1].width,34);
});
test('overlapping outer polygons are united rather than turned into holes',()=>{
  const result=compensate([square(0,0,20),square(10,0,20)],2,'outside');
  assert.equal(result.paths.length,1);close(bounds(result.paths).width,32);
});
test('open paths keep their centreline and explicitly report the limitation',()=>{
  const open={closed:false,points:[{x:0,y:0},{x:30,y:10}]};
  const result=compensate([open],2,'inside');assert.deepEqual(result.paths,[open]);assert.equal(result.warnings.length,1);
});
test('a vanished inset is rejected instead of generating an empty job',()=>{
  assert.throws(()=>createJob([square()],{width:2,tip:5,compensation:'inside'}),/demasiado larga/);
});
test('paper and machine limits include the physical width of the ink',()=>{
  const job=createJob([square()],{width:20,originX:0,originY:30,tip:1});assert.ok(job.errors.some(e=>e.includes('máquina')));
  const paper=createJob([square()],{width:20,originX:30,originY:30,paperWidth:40,paperHeight:40});assert.ok(paper.errors.some(e=>e.includes('papel')));
});
test('export never homes, redefines manual zero, extrudes, or waits for heat',()=>{
  const job=createJob([square()],{width:20});const code=exportGcode(job);
  assert.doesNotMatch(code,/^G28|^G92|^M10[49]|^M190|^G[01].* E[\d-]/m);
  const commands=jobCommands(job).map(c=>c.code);assert.ok(commands.indexOf('G0 Z3 F180')<commands.findIndex(c=>c.startsWith('G0 X')));
  assert.deepEqual(commands.slice(-6),['M400','G90','G0 Z10 F180','M400','G0 Y300 F2400','M400']);
});
test('nonfinite values and profiles beyond this machine are rejected',()=>{
  assert.throws(()=>createJob([square()],{originX:NaN}));assert.throws(()=>createJob([square()],{bedWidth:400}));
});
test('optional bed heating never adds a temperature wait and is bounded',()=>{
  const job=createJob([square()],{bedTarget:30});const code=exportGcode(job);
  assert.match(code,/^M140 S30$/m);assert.doesNotMatch(code,/^M190/m);
  assert.throws(()=>createJob([square()],{bedTarget:80}));
});
test('completion raises Z to 10 before moving Y to the configured maximum',()=>{
  const job=createJob([square()],{width:20,bedHeight:250,travelSpeed:25});
  const commands=jobCommands(job),tail=commands.slice(-6);
  assert.deepEqual(tail.map(c=>c.code),['M400','G90','G0 Z10 F180','M400','G0 Y250 F1500','M400']);
  assert.ok(tail.every(c=>c.safeZ===10));
  assert.deepEqual(tail[2].position,{z:10});assert.deepEqual(tail[4].position,{y:250});
  assert.doesNotMatch(tail.map(c=>c.code).join('\n'),/X/);
  assert.ok(exportGcode(job).includes('G0 Z10 F180\nM400\nG0 Y250 F1500\nM400'));
});
