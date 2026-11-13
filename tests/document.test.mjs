import test from 'node:test';
import assert from 'node:assert/strict';
import {bounds,createJob,FILL_PATTERNS,fillRegion} from '../src/geometry.mjs';
import {makeObject,composeJob,objectInk,objectCorners,validateDocument,documentProject,shapePaths,OBJECT_KINDS} from '../src/document.mjs';

const settings={tip:.5,paper:'bed'};
const near=(a,b,e=.02)=>Math.abs(a-b)<=e;

test('every shape fits its box, with rotation around the centre',()=>{
  for(const kind of ['rect','ellipse','polygon','star','heart','line']){
    const o=makeObject(kind,{x:50,y:60,w:40,h:20});
    const b=bounds(objectInk(o,{...settings,compensation:'center'}).original);
    assert.ok(near(b.minX,50,.6)&&near(b.maxX,90,.6)&&near(b.minY,60,.6)&&near(b.maxY,80,.6),`${kind} ${JSON.stringify(b)}`);
  }
  const turned=makeObject('rect',{x:50,y:60,w:40,h:20,rotation:90});
  const b=bounds(objectInk(turned,settings).original);
  assert.ok(near(b.width,20)&&near(b.height,40)&&near((b.minX+b.maxX)/2,70)&&near((b.minY+b.maxY)/2,70));
  assert.deepEqual(objectCorners(turned).map(p=>Math.round(p.x)),[80,80,60,60]);
});

test('moving an object translates its ink without changing it',()=>{
  const a=makeObject('star',{x:20,y:20,w:50,h:50,fill:{pattern:'waves',spacing:3}});
  const first=objectInk(a,settings);
  const moved=objectInk({...a,x:120,y:70},settings);
  assert.equal(moved.ink.length,first.ink.length);
  assert.ok(near(moved.ink[0].points[0].x-first.ink[0].points[0].x,100,1e-9)&&near(moved.ink[0].points[0].y-first.ink[0].points[0].y,50,1e-9));
});

test('every fill pattern stays inside the shape and draws something',()=>{
  const square=[{closed:true,points:[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}]}];
  for(const [pattern] of FILL_PATTERNS){
    const result=fillRegion(square,.5,{pattern,spacing:3,angle:30});
    if(pattern==='none'){assert.equal(result.paths.length,0);continue;}
    const b=bounds(result.paths);
    assert.ok(result.paths.length>1,pattern);
    assert.ok(b.minX>=.24&&b.minY>=.24&&b.maxX<=39.76&&b.maxY<=39.76,`${pattern} ${JSON.stringify(b)}`);
  }
  const hatch=fillRegion(square,.5,{pattern:'hatch',spacing:4}).paths.filter(p=>!p.closed);
  assert.equal(hatch.length,1,'rows joined into one zig-zag');
});

test('a document becomes one job, ordered and checked against the paper',()=>{
  const objects=[makeObject('rect',{x:10,y:10,w:30,h:30,fill:{pattern:'cross',spacing:4}}),makeObject('ellipse',{x:60,y:10,w:30,h:30}),makeObject('line',{x:100,y:10,w:40,h:0})];
  const job=composeJob(objects,settings);
  assert.ok(job.paths.length>3&&!job.errors.length);
  const outside=composeJob([makeObject('rect',{x:290,y:10,w:30,h:30})],settings);
  assert.match(outside.errors.join(' '),/área da máquina/);
  assert.throws(()=>composeJob([],settings),/nada para desenhar/);
});

test('projects: version 2 round-trips; version 1 drawings keep their place',()=>{
  const objects=[makeObject('star',{x:10,y:20,w:30,h:30,params:{points:7},fill:{pattern:'dots',spacing:3}})];
  const saved=JSON.parse(JSON.stringify(documentProject({fileName:'Estrela',settings,objects})));
  const loaded=validateDocument(saved);
  assert.equal(loaded.objects[0].params.points,7);assert.equal(loaded.objects[0].fill.pattern,'dots');
  assert.throws(()=>validateDocument({...saved,objects:[{...saved.objects[0],kind:'virus'}]}),/inválido/);
  assert.throws(()=>validateDocument({...saved,objects:[{...saved.objects[0],w:-1}]}),/Tamanho/);

  const v1={format:'drawingbot',version:1,settings:{width:60,originX:40,originY:50,rotation:90},paths:shapePaths('rect').map(p=>({...p,points:p.points.map(v=>({x:v.x*30,y:v.y*10}))}))};
  const old=createJob(v1.paths,v1.settings),now=composeJob(validateDocument(v1).objects,v1.settings);
  assert.ok(near(old.bounds.minX,now.bounds.minX,.05)&&near(old.bounds.maxY,now.bounds.maxY,.05),`${JSON.stringify(old.bounds)} vs ${JSON.stringify(now.bounds)}`);
  assert.ok(Object.keys(OBJECT_KINDS).length>=9);
});
