'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,layout}=require('../src/codex_usage/static/project-treemap.js');

function verifyGeometry(values,width,height) {
  const entries=values.map((value,index)=>({value,project:{id:String(index)}}));
  const tiles=layout(entries,width,height),total=values.reduce((sum,n)=>sum+n,0);
  assert.equal(tiles.length,values.length);
  assert.equal(new Set(tiles.map(tile=>tile.project.id)).size,values.length);
  let area=0;
  for(const tile of tiles) {
    assert.ok(tile.width>0 && tile.height>0,'positive dimensions');
    assert.ok(tile.x>=-1e-8 && tile.y>=-1e-8,'inside top/left boundaries');
    assert.ok(tile.x+tile.width<=width+1e-8 && tile.y+tile.height<=height+1e-8,'inside bottom/right boundaries');
    const expected=tile.value/total*width*height;
    assert.ok(Math.abs(tile.width*tile.height-expected)<Math.max(1e-7,expected*1e-8),'area proportional to weight');
    area+=tile.width*tile.height;
  }
  assert.ok(Math.abs(area-width*height)<1e-7,'covers the complete board');
  for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++) {
    const a=tiles[i],b=tiles[j];
    const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
    const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    assert.ok(overlapX<1e-8 || overlapY<1e-8,'no overlapping projects');
  }
  return tiles;
}

test('project identity includes its machine; metrics sort and sum their own weights',()=>{
  const projects=[
    {id:'local:/app',name:'app',total:80,known_cost:1,unpriced_events:0},
    {id:'ssh:/app',name:'app',total:20,known_cost:3,unpriced_events:0},
  ];
  const tokens=summarize(projects),cost=summarize(projects,'cost');
  assert.equal(tokens.total,100);assert.equal(cost.total,4);
  assert.deepEqual(tokens.entries.map(e=>[e.project.id,e.share]),[['local:/app',.8],['ssh:/app',.2]]);
  assert.deepEqual(cost.entries.map(e=>[e.project.id,e.share]),[['ssh:/app',.75],['local:/app',.25]]);
  assert.equal(projects[0].id,'local:/app','does not mutate original table order');
});

test('unknown costs are excluded from dollar area but still counted as unpriced',()=>{
  const projects=[
    {id:'unknown',total:90,known_cost:0,cost:null,unpriced_events:2},
    {id:'partial',total:10,known_cost:2,cost:null,unpriced_events:1},
    {id:'empty',total:0,known_cost:0,unpriced_events:0},
  ];
  assert.equal(summarize(projects).total,100);
  const cost=summarize(projects,'cost');
  assert.equal(cost.total,2);assert.equal(cost.excluded,2);assert.equal(cost.unpriced,2);
  assert.equal(cost.entries[0].project.id,'partial');
});

test('treemap preserves proportional area without overlap across screen shapes',()=>{
  for(const [w,h] of [[960,390],[510,300],[260,370],[1300,200],[200,1300]]) {
    verifyGeometry([47,36,12,10,3.56,3.48,2,.3],w,h);
    verifyGeometry([10,10,10,10,10,10,10],w,h);
    verifyGeometry([7],w,h);
  }
});

test('tiny and numerous projects are retained instead of inflating or dropping their area',()=>{
  verifyGeometry([1e9,1000,1,.01],1000,400);
  verifyGeometry(Array.from({length:200},(_,i)=>(i%19+1)**2),800,400);
});

test('invalid and empty weights cannot create malformed rectangles',()=>{
  assert.deepEqual(layout([],800,400),[]);
  assert.deepEqual(layout([{value:0},{value:-1},{value:NaN},{value:Infinity}],800,400),[]);
  for(const [w,h] of [[0,400],[800,0],[-1,100],[NaN,100],[100,Infinity]])assert.deepEqual(layout([{value:1}],w,h),[]);
  const invalid=summarize([{id:'a',total:NaN},{id:'b',total:-1},{id:'c',total:Infinity}]);
  assert.equal(invalid.total,0);assert.deepEqual(invalid.entries,[]);
});
