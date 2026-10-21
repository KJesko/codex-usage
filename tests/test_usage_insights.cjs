'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {waterfallRows,dailyPaceSeries}=require('../src/codex_usage/static/usage-insights.js');

test('cache charts retain isolated active days even above the ninety-day dot threshold',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const context={module:{exports:{}},esc:String,percent:n=>(n*100).toFixed(1)+'%'};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/codex_usage/static/usage-insights.js'),'utf8'),context);
  const days=Array.from({length:200},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),input:i%2?0:100,cached:i%2?0:95}));
  const svg=context.module.exports.cacheTrend(days);
  assert.equal((svg.match(/<circle /g)||[]).length,100);
  assert.equal((svg.match(/95.0%/g)||[]).length,200);
  assert.ok(!svg.includes('NaN'));
});

test('waterfall retains signed reconciliation after grouping smaller contributors',()=>{
  const projects=[100,-70,55,40,-30,20,-10,3,1].map((value,i)=>({name:`Project ${i}`,delta_total:value,delta_cost:-value/10}));
  const original=structuredClone(projects);
  for(const metric of ['tokens','cost']){
    const rows=waterfallRows({projects},metric,'projects');
    assert.equal(rows.length,7);
    const key=metric==='cost'?'delta_cost':'delta_total';
    assert.ok(Math.abs(rows.reduce((sum,row)=>sum+row.value,0)-projects.reduce((sum,row)=>sum+row[key],0))<1e-10);
    assert.equal(rows[6].name,'其他 3 项');
    assert.equal(Math.abs(rows[0].value),metric==='cost'?10:100);
  }
  assert.deepEqual(projects,original);
});

test('waterfall supports model attribution, zero baseline and no activity',()=>{
  assert.deepEqual(waterfallRows({models:[]},'tokens','models'),[]);
  const rows=waterfallRows({models:[{name:'new',delta_total:20,delta_cost:0},{name:'removed',delta_total:-50,delta_cost:-3}]},'tokens','models');
  assert.deepEqual(rows.map(row=>row.value),[-50,20]);
});

test('daily quota lines connect consecutive calendar days but leave missing dates empty',()=>{
  const samples=[{date:'2026-10-18',at:4,used_percent:40},
    {date:'2026-10-15',at:1,used_percent:10},
    {date:'2026-10-19',at:5,used_percent:39},
    {date:'2026-10-16',at:2,used_percent:20,break_before:true}];
  const original=structuredClone(samples),result=dailyPaceSeries(samples);
  assert.deepEqual(result.segments.map(s=>s.map(p=>p.date)),
    [['2026-10-15','2026-10-16'],['2026-10-18'],['2026-10-19']]);
  assert.equal(result.points.length,4);
  assert.deepEqual(samples,original);
  assert.deepEqual(dailyPaceSeries(),{points:[],segments:[]});
  assert.equal(dailyPaceSeries([samples[0]]).segments[0].length,1);
});

test('daily quota adjacency follows dates even when DST makes the day 25 hours',()=>{
  const result=dailyPaceSeries([
    {date:'2026-11-01',at:Date.parse('2026-11-01T07:00:00Z')/1000,used_percent:20},
    {date:'2026-11-02',at:Date.parse('2026-11-02T08:00:00Z')/1000,used_percent:25}]);
  assert.equal(result.segments.length,1);
  assert.equal(result.segments[0].length,2);
});

test('daily chart renders one accessible dot per recorded day and a line only for adjacent days',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const context={module:{exports:{}},number:String,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/codex_usage/static/usage-insights.js'),'utf8'),context);
  const chart=context.module.exports.dailyPaceChart;
  const window={id:'codex:primary',label:'每周额度',window_minutes:10080,resets_at:Date.parse('2026-10-22T06:43:00Z')/1000};
  const daily_samples=[15,16,18].map((day,i)=>({date:`2026-10-${day}`,at:Date.parse(`2026-10-${day}T12:00:00Z`)/1000,used_percent:10+i*5}));
  const p={daily_samples,daily_ticks:[],daily_timezone:'Asia/Shanghai'};
  const html=chart(window,p);
  assert.equal((html.match(/class="pace-day"/g)||[]).length,3);
  assert.equal((html.match(/class="pace-daily-line"/g)||[]).length,1);
  assert.match(html,/2026-10-15 · 已用 10% · 剩余 90% · 最后记录 20:00/);
  assert.match(html,/tabindex="0"/);
  assert.match(html,/北京时间/);
  assert.match(chart(window,{...p,daily_samples:daily_samples.slice(0,1)}),/目前只记录了 1 天/);
  assert.equal(chart(window,{...p,daily_samples:[]}), '');
});

test('responsive charts retain data and keep geometry inside narrow and wide viewports',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const context={module:{exports:{}},number:String,compact:value=>String(Math.round(value)),usd:value=>'$'+value.toFixed(2),percent:value=>Math.round(value*100)+'%',esc:String};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/codex_usage/static/usage-insights.js'),'utf8'),context);
  const {waterfall,cacheTrend,dailyPaceChart}=context.module.exports;
  const projects=[100,-60,40,20,-10,5,3].map((value,i)=>({name:'Project '+i,delta_total:value,source_name:'本机'}));
  const comparison={previous:{total:1000},current:{total:1098},projects};
  const end=Date.parse('2026-10-22T00:00:00Z')/1000;
  const window={id:'weekly',label:'每周额度',window_minutes:10080,resets_at:end};
  const p={daily_samples:Array.from({length:7},(_,i)=>({date:`2026-10-${15+i}`,at:end-(7-i)*86400,used_percent:i*10})),daily_ticks:[],daily_timezone:'UTC'};
  for(const width of [240,480,1056]){
    const bars=waterfall(comparison,'tokens','projects',width);
    assert.doesNotMatch(bars,/min-width|NaN|Infinity/);
    assert.equal((bars.match(/<rect /g)||[]).length,9);
    assert.equal(bars.includes('waterfall-horizontal'),width<900);
    for(const match of bars.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)){
      assert.ok(Number(match[1])>=0 && Number(match[1])+Number(match[3])<=width+.01);
    }
    const pace=dailyPaceChart(window,p,width,true);
    assert.match(pace,new RegExp(`viewBox="0 0 ${width} ${width<406?206:188}"`));
    assert.equal((pace.match(/class="pace-day"/g)||[]).length,7);
    const ticks=[...pace.matchAll(/<text class="pace-date-label" x="([\d.]+)" y="([\d.]+)"/g)].map(m=>({x:Number(m[1]),y:Number(m[2])}));
    assert.equal(ticks.length,8);
    assert.ok(ticks.every(t=>t.x>=20 && t.x<=width-20));
    for(const y of new Set(ticks.map(t=>t.y))){
      const row=ticks.filter(t=>t.y===y);
      assert.ok(row.every((t,i)=>!i || t.x-row[i-1].x>=48));
    }
    const cache=cacheTrend([{date:'2026-10-14',input:10,cached:5},{date:'2026-10-15',input:0,cached:0},{date:'2026-10-16',input:20,cached:15}],width);
    assert.match(cache,new RegExp(`viewBox="0 0 ${width} 148"`));
    assert.equal((cache.match(/<circle /g)||[]).length,2);
    assert.equal((cache.match(/<path /g)||[]).length,2);
  }
});

test('near-midnight daily samples have stable equal date spacing and never hide October 17',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const context={module:{exports:{}},number:String,esc:String};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/codex_usage/static/usage-insights.js'),'utf8'),context);
  const chart=context.module.exports.dailyPaceChart;
  const window={id:'weekly',label:'每周额度',window_minutes:10080,resets_at:Date.parse('2026-10-22T14:43:00+08:00')/1000};
  const p={daily_timezone:'Asia/Shanghai',daily_samples:[
    {date:'2026-10-16',at:Date.parse('2026-10-16T23:59:00+08:00')/1000,used_percent:40},
    {date:'2026-10-17',at:Date.parse('2026-10-17T00:01:00+08:00')/1000,used_percent:43},
  ]};
  for(const width of [240,360,500]){
    const html=chart(window,p,width);
    const dots=[...html.matchAll(/class="pace-day-dot" cx="([\d.]+)"/g)].map(m=>Number(m[1]));
    assert.ok(Math.abs(dots[1]-dots[0]-(width-70)/7)<.001);
    for(let day=15;day<=22;day++)assert.match(html,new RegExp(`>10/${day}</text>`));
    assert.match(html,/2026-10-16 · 已用 40% · 剩余 60% · 最后记录 23:59/);
    assert.match(html,/2026-10-17 · 已用 43% · 剩余 57% · 最后记录 00:01/);
    const later=chart(window,{...p,daily_samples:[p.daily_samples[0],{...p.daily_samples[1],at:p.daily_samples[1].at+12*3600}]},width);
    assert.deepEqual([...later.matchAll(/class="pace-day-dot" cx="([\d.]+)"/g)].map(m=>Number(m[1])),dots);
  }
});
