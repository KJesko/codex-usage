const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const context={module:{exports:{}},esc,number:String};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/codex_usage/static/quota-range.js'),'utf8'),context);
const range=context.module.exports,begin=Date.parse('2026-10-16T00:00:00+08:00')/1000,end=begin+5*86400;
const q={range:{since:begin,until:end,since_date:'2026-10-16',until_date:'2026-10-20'},timezone:'Asia/Shanghai',grain:'hour'};
const group={id:'g',label:'每周额度',plan:'pro',window:'codex:primary',sample_count:999,segment_count:3,
  samples:[{at:begin+60,used_percent:25,break_before:true},{at:begin+3600,used_percent:30},
    {at:begin+86400,used_percent:80,break_before:true},{at:begin+86460,used_percent:0,break_before:true},
    {at:begin+86520,used_percent:5},{at:begin+2*86400,used_percent:1,break_before:true}],
  references:[{since:begin,until:begin+86460,before:20,after:50},{since:begin+86520,until:end,before:0,after:60}],
  idle:[{since:begin+86460,until:begin+86520}],
  events:[{id:'a',kind:'official',since:begin+86400,at:begin+86460,before_used:80,after_used:0},
    {id:'b',kind:'credit',since:begin+86500,at:begin+86520,before_used:5,after_used:0},
    {id:'c',kind:'scheduled',since:begin+2*86400-60,at:begin+2*86400,before_used:90,after_used:1}]};

test('range chart separates reset/gap runs, retains independent references and labels all reset types',()=>{
  assert.deepEqual(Array.from(range.series(group.samples),s=>s.length),[2,1,2,1]);
  const html=range.chart(group,q);
  assert.equal((html.match(/class="quota-range-reference"/g)||[]).length,2);
  assert.equal((html.match(/class="quota-range-line"/g)||[]).length,2);
  assert.equal((html.match(/class="quota-reset-guide"/g)||[]).length,3);
  assert.match(html,/data-reset-ids="a b"/);
  for(const label of ['官方重置','重置卡重置','周期重置'])assert.ok(html.includes('>'+label+'</text>'));
  assert.match(html,/剩余 20% → 100%/);
  const panel=range.panel({...q,groups:[group]});
  assert.match(panel,/class="quota-range-tooltip"[^>]*role="tooltip" hidden/);
  assert.doesNotMatch(panel,/quota-range-detail|最后记录剩余|quota-range-events|data-range-event=/);
  for(const text of ['官方重置（默认）','重置卡重置（推断）','正常周期重置','闲置阶段','显示精度自动调整'])assert.ok(panel.includes(text));
});

test('reset labels stay inside narrow plots and merge without losing event details',()=>{
  const events=[0,1,20,45,48,49,99,100].map((percent,i)=>({...group.events[0],id:'e'+i,at:begin+(end-begin)*percent/100}));
  for(const width of [230,460,1000]){
    const html=range.chart({...group,events},q,width);
    const markers=[...html.matchAll(/<g class="quota-range-event"[^>]*data-reset-ids="([^"]+)"[^>]*><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)];
    assert.ok(markers.length);
    assert.deepEqual(markers.flatMap(m=>m[1].split(' ')),events.map(e=>e.id));
    let right=36;
    for(const [,ids,x,size] of markers){
      assert.ok(Number(x)>=right+8-1e-8,ids);
      right=Number(x)+Number(size);
      assert.ok(right<=width-26+1e-8);
    }
  }
});

test('overlapping reset types remain visible as separate lines with per-type counts',()=>{
  const events=['official','credit','scheduled','credit'].map((kind,i)=>({...group.events[0],kind,id:'mixed'+i,at:begin+i}));
  const html=range.chart({...group,events},q,230);
  assert.match(html,/data-reset-ids="mixed0 mixed1 mixed2 mixed3"/);
  for(const label of ['官方重置','周期重置','重置卡重置 ×2'])assert.ok(html.includes('>'+label+'</text>'));
  const rect=html.match(/<g class="quota-range-event"[^>]*><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/);
  assert.ok(Number(rect[1])>=0);assert.ok(Number(rect[1])+Number(rect[2])<70);
});
test('responsive timeline uses clipped curves without persistent dots or invalid geometry',()=>{
  for(const width of [230,460,1000]){
    const html=range.chart(group,q,width);
    assert.doesNotMatch(html,/NaN|Infinity|undefined/);
    assert.doesNotMatch(html,/<circle|class="quota-range-point"/);
    assert.match(html,/<clipPath/);
    assert.equal((html.match(/class="quota-range-isolated"/g)||[]).length,2);
  }
});

test('zoom is anchored at the cursor, clamped to the selected dates and limited to one hour',()=>{
  const full={since:begin,until:end},view=range.zoom(full,full,.5,.25);
  assert.equal(view.until-view.since,(end-begin)/2);
  assert.equal(view.since+(view.until-view.since)*.25,begin+(end-begin)*.25);
  const minimum=range.zoom(view,full,.00001,.7);
  assert.equal(minimum.until-minimum.since,3600);
  const restored=range.zoom(minimum,full,1000,.9);
  assert.equal(restored.since,begin);assert.equal(restored.until,end);
  assert.equal(range.constrain({since:begin-7200,until:begin},full).since,begin);
  assert.equal(range.constrain({since:end-100,until:end+7100},full).until,end);
  assert.notEqual(range.viewportKey(group,{...q,history_scope:'one'}),range.viewportKey(group,{...q,history_scope:'two'}));
  assert.equal(range.viewportKey(group,{...q,fetched_at:'new'}),range.viewportKey(group,q));
});

test('smooth curve passes actual observations, keeps plateaus flat and never overshoots',()=>{
  const samples=[0,1,2,8,9,20,21,22].map((at,i)=>({at,used_percent:[0,25,25,26,80,80,99,100][i]}));
  const path=range.smoothPath(samples,x=>x,y=>y);
  const cubics=[...path.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)];
  assert.equal(cubics.length,samples.length-1);
  for(let i=0;i<cubics.length;i++){
    const [,,y1,,y2,x3,y3]=cubics[i].map(Number),a=samples[i],b=samples[i+1];
    assert.equal(x3,b.at);assert.equal(y3,b.used_percent);
    let previous=a.used_percent;
    for(let t=0;t<=1;t+=.01){
      const value=(1-t)**3*a.used_percent+3*(1-t)**2*t*y1+3*(1-t)*t*t*y2+t**3*y3;
      assert.ok(value>=a.used_percent-1e-8 && value<=b.used_percent+1e-8);
      assert.ok(value>=previous-1e-8);previous=value;
    }
  }
});

test('zoom clips full paths rather than inventing edge values, and hides offscreen events',()=>{
  const visible={since:begin+1200,until:begin+4800};
  const html=range.chart(group,q,460,visible);
  assert.equal((html.match(/class="quota-range-reference"/g)||[]).length,1);
  assert.equal((html.match(/class="quota-range-line"/g)||[]).length,1);
  assert.doesNotMatch(html,/quota-reset-guide|data-reset-ids|quota-idle-band/);
  assert.match(html,/class="quota-range-line" d="M-/);
  assert.match(html,/10\/16/);assert.match(html,/00:20/);assert.match(html,/01:20/);
  // Duplicate timestamps must not divide by zero or connect separate samples.
  const duplicate={...group,samples:[group.samples[0],{...group.samples[0],used_percent:26}]};
  assert.doesNotMatch(range.chart(duplicate,q),/NaN|Infinity/);
});
test('loading, empty ranges and untrusted labels stay distinct and escaped',()=>{
  assert.match(range.panel({busy:true}),/正在读取/);
  assert.match(range.panel({groups:[]}),/没有已保存/);
  assert.match(range.panel({problem:{message:'bad'}}),/重试/);
  const html=range.panel({...q,groups:[{...group,label:'<script>bad</script>'}]});
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script>/);
});

test('initial viewport is seven days while zoom and pan bounds retain all history',()=>{
  const history={range:{since:0,until:90*86400}};
  assert.equal(range.initialView(history).since,83*86400);
  assert.equal(range.initialView(history).until,90*86400);
  assert.equal(range.zoom(range.initialView(history),history.range,100).since,0);
});
test('adaptive rendering reduces dense observations but retains extrema and run edges',()=>{
  const points=Array.from({length:10000},(_,i)=>({at:i*60,used_percent:i===5000?100:i/100}));
  const reduced=range.adaptive(points,0,600000,320);
  assert.ok(reduced.length<500);
  assert.equal(reduced[0],points[0]);assert.equal(reduced.at(-1),points.at(-1));
  assert.ok(reduced.includes(points[5000]));
  const close=range.adaptive(points,5000*60,5010*60,800);
  for(let i=5000;i<=5010;i++)assert.ok(close.includes(points[i]));
});
const points=Array.from({length:120},(_,i)=>({at:i,used_percent:Math.floor(i/3)}));
test('visual simplification adapts to zoom and preserves exact run endpoints without mutating observations',()=>{
  const original=JSON.stringify(points);
  const far=range.simplify(points,x=>x*.3,y=>y*.3);
  const near=range.simplify(points,x=>x*10,y=>y*10);
  assert.ok(far.length<near.length);
  assert.equal(far[0],points[0]);assert.equal(far.at(-1),points.at(-1));
  assert.equal(JSON.stringify(points),original);
});
test('gap connectors only bridge marked outages, never resets, decreases or compressed plateaus',()=>{
  const samples=[{at:0,used_percent:20},{at:1800,used_percent:30,break_before:true}];
  const base={...group,samples,events:[]};
  assert.equal(range.gaps(base).length,1);
  assert.equal(range.gaps({...base,events:[{since:1700,at:1800}]}).length,0);
  assert.equal(range.gaps({...base,samples:[samples[0],{...samples[1],used_percent:0}]}).length,0);
  assert.equal(range.gaps({...base,samples:[samples[0],{...samples[1],break_before:false}]}).length,0);
  assert.match(range.chart(base,{...q,range:{since:0,until:3600}}),/class="quota-range-gap"/);
});

test('one hundred thousand observations stay finite at wide, narrow and zoomed scales',t=>{
  const points=Array.from({length:100000},(_,i)=>({at:begin+i*60,used_percent:(i%10000)/100,break_before:i%10000===0}));
  const large={...group,samples:points,events:[],idle:[],references:[]},query={...q,range:{since:begin,until:points.at(-1).at}};
  const started=performance.now();
  for(const width of [230,800,1800]){
    for(const view of [query.range,{since:query.range.until-3600,until:query.range.until}]){
      const html=range.chart(large,query,width,view);
      assert.doesNotMatch(html,/NaN|Infinity|undefined/);
      assert.ok(html.length<100000,'rendering must be bounded by screen resolution');
    }
  }
  t.diagnostic('100,000 observations, six scales: '+Math.round(performance.now()-started)+' ms');
});
