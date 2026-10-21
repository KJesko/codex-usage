const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('../src/codex_usage/static/activity-heatmap.js');
const cell=(total,known_cost=0,unpriced_tokens=0)=>({total,known_cost,unpriced_tokens,input:total,uncached:total,events:1});
const report=(since,until,rows,today=until)=>({range:{since,until,today,grain:'month'},model_timeline:rows.map(([date,...models])=>({date,models}))});

test('daily heatmap sums models, respects selected dates and distinguishes excluded from zero',()=>{
  const r=report('2026-10-14','2026-10-16',[
    ['2026-10-13',cell(999)],['2026-10-14',cell(100,.1),cell(50,.05)],
    ['2026-10-15',cell(200,.2),cell(300,0,300)],['2026-10-16']]);
  const chart=build(r);
  assert.equal(chart.start,'2025-11-01');assert.equal(chart.end,'2026-10-31');
  assert.equal(chart.summary.total,650);assert.equal(chart.summary.activeDays,2);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-13').included,false);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-14').value.total,150);
  const zero=chart.cells.find(c=>c.key==='2026-10-16');
  assert.equal(zero.included,true);assert.equal(zero.level,0);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-17').included,false);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-15').value.unpriced_tokens,300);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-15').level,4);
});
test('weeks start Monday and aggregate only the included part of a week',()=>{
  const r=report('2026-10-14','2026-10-20',[
    ['2026-10-13',cell(999)],['2026-10-14',cell(100,.1)],
    ['2026-10-18',cell(200,.2)],['2026-10-19',cell(50,.05)]]);
  const weeks=build(r,'week').cells.filter(c=>c.included);
  assert.deepEqual(weeks.map(c=>[c.key,c.from,c.to,c.value.total]),[
    ['2026-10-12','2026-10-14','2026-10-18',300],['2026-10-19','2026-10-19','2026-10-20',50]]);
  assert.ok(Math.abs(weeks[0].value.known_cost-.3)<1e-10);
});
test('cumulative includes earlier windows and preserves totals on zero days',()=>{
  const r=report('2025-01-01','2026-10-15',[
    ['2025-01-01',cell(100,.1)],['2026-10-14',cell(50,.05)],['2026-10-15']]);
  const chart=build(r,'cumulative');
  assert.equal(chart.summary.total,50); // The summary describes just the visible window.
  assert.equal(chart.cells.find(c=>c.key==='2026-10-14').value.total,150);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-15').value.total,150);
  assert.equal(chart.cells.find(c=>c.key==='2026-10-15').dayValue.total,0);
  assert.equal(chart.canPrevious,true);assert.equal(chart.canNext,false);
  const previous=build(r,'day',-1);
  assert.equal(previous.start,'2024-11-01');assert.equal(previous.canNext,true);
  assert.equal(previous.summary.total,100);
  assert.equal(build(report('2026-10-14','2026-10-15',[]),'day',-1).start,'2025-11-01');
});
test('calendar handles leap days and calendar-year boundaries without browser timezone shifts',()=>{
  const chart=build(report('2024-01-01','2024-12-31',[
    ['2024-02-29',cell(29)],['2024-12-31',cell(31)]]));
  assert.equal(chart.cells.find(c=>c.key==='2024-02-29').row,3); // Thursday, Monday-first.
  assert.equal(chart.cells.filter(c=>c.included).length,366);
  assert.equal(chart.months.length,12);
  assert.equal(chart.summary.total,60);
  assert.ok(chart.cells.every(c=>c.column>=0 && c.column<chart.weeks));
});
test('future dates never become zero-use observations and empty ranges remain empty',()=>{
  const future=build(report('2026-10-14','2026-10-31',[
    ['2026-10-15',cell(10)],['2026-10-16',cell(999)]],'2026-10-15'));
  assert.equal(future.summary.total,10);
  assert.equal(future.cells.find(c=>c.key==='2026-10-16').included,false);
  const empty=build(report('2026-10-14','2026-10-13',[]));
  assert.equal(empty.cells.filter(c=>c.included).length,0);
  assert.equal(empty.summary.total,0);
});
