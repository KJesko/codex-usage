'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
const source=fs.readFileSync(require.resolve('../src/codex_usage/static/model-charts.js'),'utf8');
vm.runInContext(source.slice(0,source.indexOf('// UI choices'))+';this.group=ModelTimeline.group;',context);
const group=(rows,grain)=>JSON.parse(JSON.stringify(context.group(rows,grain)));
const cell=(name,n,unknown=false)=>({name,total:n*10,uncached:n*2,cached:n*6,write:n,output:n,
  known_cost:unknown?0:n*4,input_cost:unknown?0:n,cached_cost:unknown?0:n,
  write_cost:unknown?0:n,output_cost:unknown?0:n,unpriced_events:unknown?1:0,
  cost:unknown?null:n*4});

test('weekly groups use Monday across years and retain the actual partial range',()=>{
  const rows=[
    {date:'2027-01-04',models:[cell('a',4)]},
    {date:'2026-12-31',models:[cell('a',1)]},
    {date:'2027-01-01',models:[cell('b',2)]},
    {date:'2027-01-03',models:[cell('a',3)]},
    {date:'2027-01-05',models:[]}
  ];
  const before=JSON.stringify(rows),weeks=group(rows,'week');
  assert.deepEqual(weeks.map(({date,since,until})=>({date,since,until})),[
    {date:'2026-12-28',since:'2026-12-31',until:'2027-01-03'},
    {date:'2027-01-04',since:'2027-01-04',until:'2027-01-05'}
  ]);
  assert.deepEqual(weeks[0].models.map(m=>[m.name,m.total,m.cost]),[['a',40,16],['b',20,8]]);
  assert.equal(JSON.stringify(rows),before,'grouping must not change the daily feed used by other charts');
});

test('monthly grouping preserves leap days, empty periods, costs and unpriced usage',()=>{
  const rows=[
    {date:'2028-02-28',models:[cell('a',1)]},
    {date:'2028-02-29',models:[cell('a',2,true),cell('b',3)]},
    {date:'2028-03-01',models:[]},
    {date:'2028-03-31',models:[]},
    {date:'2028-04-01',models:[cell('a',4)]}
  ];
  const months=group(rows,'month');
  assert.deepEqual(months.map(m=>m.date),['2028-02-01','2028-03-01','2028-04-01']);
  assert.deepEqual([months[0].since,months[0].until],['2028-02-28','2028-02-29']);
  assert.deepEqual(months[1].models,[],'zero-usage periods must remain in the chart');
  const a=months[0].models.find(m=>m.name==='a');
  assert.deepEqual([a.total,a.known_cost,a.cost,a.unpriced_events],[30,4,null,1]);
  assert.deepEqual([a.uncached,a.cached,a.write,a.output],[6,18,3,3]);
  for(const grain of ['day','week','month']) {
    const cells=group(rows,grain).flatMap(d=>d.models);
    assert.equal(cells.reduce((sum,m)=>sum+m.total,0),100);
    assert.equal(cells.reduce((sum,m)=>sum+m.known_cost,0),32);
    for(const m of cells)assert.equal(m.uncached+m.cached+m.write+m.output,m.total);
    for(const model of ['a','b']) {
      assert.equal(cells.filter(m=>m.name===model).reduce((sum,m)=>sum+m.total,0),model==='a'?70:30);
    }
  }
});

test('grouping uses reporting dates regardless of DST or browser time zone',()=>{
  const rows=[{date:'2026-03-08',models:[cell('a',1)]},{date:'2026-03-09',models:[cell('a',2)]},
    {date:'2026-11-01',models:[cell('a',3)]},{date:'2026-11-02',models:[cell('a',4)]}];
  assert.deepEqual(group(rows,'week').map(m=>m.date),['2026-03-02','2026-03-09','2026-10-26','2026-11-02']);
  assert.deepEqual(group(rows,'day').map(m=>m.models),rows.map(m=>m.models));
  assert.deepEqual(group(rows,'invalid'),group(rows,'day'));
  assert.deepEqual(group([],'month'),[]);
});
