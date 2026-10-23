const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const now=Date.now()/1000;
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function load(file){
  const context={module:{exports:{}},esc:escape,number:String,accountTime:String};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/codex_usage/static/'+file),'utf8'),context);
  return context.module.exports;
}
test('public updates show schedules, types and statistics without legacy probabilities',()=>{
  const page=load('quota-page.js');
  const f={fresh:true,generated_at:now,probability:90,signal:{horizon:'within 24h'},
    scheduled:{at:now-100,scheduled_for:now+3600,reset_type:'banked',text:'<script>bad</script>',source:'https://x.com/a'},
    latest:{at:now-86400,reset_type:'regular',text:'Done',source:'https://x.com/b'},stats:{total:64,avg_interval_days:6.3}};
  const html=page.forecastMarkup(f);
  assert.match(html,/已安排重置/);assert.match(html,/发放重置卡/);assert.match(html,/常规重置/);
  assert.match(html,/64 次/);assert.match(html,/6.3 天/);assert.match(html,/1 天/);
  assert.match(html,/&lt;script>/);assert.doesNotMatch(html,/<script>|90%|预测窗口|尚未校准/);
  assert.match(html,/查看完整历史/);assert.match(html,/Codex Resets/);
  assert.doesNotMatch(page.forecastMarkup({...f,latest:{...f.latest,source:'javascript:alert(1)'}}),/javascript:/);
});

test('event cards keep observed interval and explicit inferred attribution',()=>{
  const page=load('quota-page.js');
  const event={id:'1',kind:'credit',label:'每周额度',since:now-120,at:now-60,confirmed_at:now,before_used:80,after_used:2,old_reset:now+1000,new_reset:now+1000,before_count:3,after_count:2};
  const html=page.eventMarkup(event);
  assert.match(html,/手动重置卡重置/);
  assert.match(html,/卡数推断/);
  assert.match(html,/剩余 20% → 98%/);
  assert.doesNotMatch(html,/已用/);
  assert.match(html,/保持不变/);
  assert.match(page.eventMarkup({...event,kind:'official'}),/默认归因/);
  assert.equal(page.eventTitle({...event,kind:'scheduled',label:'5 小时额度'}),'正常周期重置');
});

test('public updates distinguish no schedule, overdue announcement, stale cache and errors',()=>{
  const page=load('quota-page.js'),quiet={fresh:true,generated_at:now,stats:{total:0,avg_interval_days:0}};
  assert.match(page.forecastMarkup(null),/正在读取公开重置动态/);
  for(const busy of [true,false]){
    const html=page.forecastMarkup({...quiet,busy});
    assert.match(html,/来源已同步/);assert.match(html,/暂无已安排重置/);assert.match(html,/0 次/);
    assert.doesNotMatch(html,/暂时失败|0%|预测窗口/);
  }
  const scheduled={at:now-50,scheduled_for:now-1};
  assert.match(page.forecastMarkup({...quiet,scheduled}),/等待后续确认/);
  assert.match(page.forecastMarkup({...quiet,scheduled:{at:now-50,scheduled_for:null}}),/公告未提供执行时间/);
  const stale=page.forecastMarkup({...quiet,fresh:false,scheduled:{...scheduled,scheduled_for:now+900}});
  assert.match(stale,/来源数据已过期/);assert.match(stale,/上次获取的重置安排/);
  assert.doesNotMatch(stale,/距公告时间约/);
  assert.match(page.forecastMarkup({...quiet,fresh:false,problem:'Offline'}),/同步暂时失败/);
  assert.match(page.forecastMarkup({...quiet,fresh:false,busy:true}),/正在同步来源/);
});

test('reset board excludes legacy deadline drift and card-count-only observations',()=>{
  const page=load('quota-page.js');
  const q={reset_events:[{kind:'adjustment'},{kind:'official'},{kind:'credit_change'},{kind:'credit'},{kind:'scheduled'}]};
  assert.deepEqual(Array.from(page.resetEvents(q),e=>e.kind),['official','credit','scheduled']);
  assert.deepEqual(Array.from(page.resetEvents(q,'credit'),e=>e.kind),['credit']);
  assert.equal(page.eventMarkup({kind:'adjustment'}),'');
  assert.equal(page.eventMarkup({kind:'credit_change'}),'');
});
test('daily quota graph preserves reset observation even when daily last point is later',()=>{
  const charts=load('usage-insights.js');
  const at=Date.parse('2026-10-16T12:00:00Z')/1000;
  const window={id:'weekly',label:'每周额度',window_minutes:10080,resets_at:at+86400,segment_started_at:at,segment_baseline:2};
  const p={daily_timezone:'UTC',daily_samples:[{at:at+60,date:'2026-10-16',used_percent:5}],start_event:{at,after_used:2}};
  const html=charts.dailyPaceChart(window,p,240,true);
  assert.equal((html.match(/class="pace-day"/g)||[]).length,2);
  assert.doesNotMatch(html,/NaN|Infinity/);
  const series=charts.dailyPaceSeries([{at:1,date:'2026-10-16',used_percent:80},{at:2,date:'2026-10-16',used_percent:0}]);
  assert.equal(series.segments.length,2);
});

test('cycle graph uses exact reset origin and eight ticks spaced 24 hours apart',()=>{
  const charts=load('usage-insights.js'),begin=Date.parse('2026-10-15T14:43:00+08:00')/1000;
  const window={id:'weekly',label:'每周额度',window_minutes:10080,resets_at:begin+7*86400};
  const p={daily_timezone:'Asia/Shanghai',cycle_samples:[{at:begin+23*3600,date:'2026-10-16',interval:0,used_percent:10},
    {at:begin+35*3600,date:'2026-10-17',interval:1,used_percent:20}]};
  for(const width of [240,500,1000]){
    const html=charts.cyclePaceChart(window,p,width);
    const ticks=[...html.matchAll(/class="pace-cycle-label" data-at="([\d.]+)"/g)].map(m=>Number(m[1]));
    assert.equal(ticks.length,8);
    assert.deepEqual(ticks,Array.from({length:8},(_,i)=>begin+i*86400));
    assert.equal((html.match(/dy="16">14:43</g)||[]).length,8);
    assert.match(html,/168 小时/);
    const dots=[...html.matchAll(/class="pace-day-dot" cx="([\d.]+)"/g)].map(m=>Number(m[1]));
    assert.ok(Math.abs((dots[1]-dots[0])/(width-70)-12/168)<1e-8);
    assert.doesNotMatch(html,/NaN|Infinity/);
  }
  const sameDay=charts.cyclePaceSeries([{at:1,interval:0,used_percent:1},{at:2,interval:1,used_percent:2},
    {at:3,interval:3,used_percent:4},{at:4,interval:4,used_percent:2},{at:5,interval:5,used_percent:3,break_before:true}]);
  assert.deepEqual(Array.from(sameDay.segments,s=>s.length),[2,1,1,1]);
});

test('cycle graph stops at early segment end and retains the observed reset point',()=>{
  const charts=load('usage-insights.js'),begin=Date.parse('2026-10-16T12:37:00Z')/1000;
  const window={id:'weekly',label:'每周额度',window_minutes:10080,resets_at:begin+6*86400,
    segment_started_at:begin,segment_baseline:2,display_end:begin+25*3600};
  const p={daily_timezone:'UTC',start_event:{at:begin,after_used:2},cycle_samples:[
    {at:begin+23*3600,date:'2026-10-17',interval:0,used_percent:20}]};
  const html=charts.cyclePaceChart(window,p,240);
  assert.match(html,/168 小时/);
  assert.match(html,/本段提前结束于/);
  assert.match(html,/重置首次记录/);
  assert.equal((html.match(/class="pace-day"/g)||[]).length,2);
  const ticks=[...html.matchAll(/data-at="([\d.]+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(ticks,[begin-86400,begin,begin+86400,begin+25*3600]);
});

test('idle before a formal window is separate from both chart modes and remaining reset label',()=>{
  const charts=load('usage-insights.js'),begin=Date.parse('2026-10-19T18:46:00+08:00')/1000,reset=begin-38*3600;
  const window={id:'weekly',label:'每周额度',window_minutes:10080,resets_at:begin+7*86400,
    cycle_started_at:begin,segment_started_at:reset,reference_started_at:begin,
    idle_period:{since:reset,until:begin,after_reset:true}};
  const p={daily_timezone:'Asia/Shanghai',start_event:{at:reset,before_used:46,after_used:0},
    daily_samples:[{at:reset,date:'2026-10-18',used_percent:0},{at:begin+60,date:'2026-10-19',used_percent:1}],
    cycle_samples:[{at:begin+60,date:'2026-10-19',interval:0,used_percent:1}]};
  for(const chart of [charts.cyclePaceChart,charts.dailyPaceChart]){
    const html=chart(window,p,240);
    assert.equal((html.match(/class="pace-day"/g)||[]).length,1);
    assert.doesNotMatch(html,/206 小时|2026-10-18|NaN|Infinity/);
  }
  const phases=charts.pacePhases(window);
  assert.match(phases,/重置后闲置 · 38 小时 0 分钟/);
  assert.match(phases,/正式额度周期 · 7 × 24 小时/);
  const panel=charts.pacePanel({windows:[window],pace:{weekly:p}});
  assert.match(panel,/剩余 54% → 100%/);
  assert.doesNotMatch(panel,/已用 46% → 0%/);
  const pending={...window,cycle_pending:true,idle_period:{...window.idle_period,ongoing:true}};
  assert.equal(charts.cyclePaceChart(pending,p),'');
  assert.equal(charts.dailyPaceChart(pending,p),'');
  assert.match(charts.pacePhases(pending),/等待开始使用/);
});

test('time view choice is restored and changing it requests a chart redraw',()=>{
  const saved=new Map([['codex-usage-pace-view','date']]),redraw=[];
  const context={module:{exports:{}},esc:escape,number:String,accountTime:String,
    localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},renderQuotaPace:focus=>redraw.push(focus)};
  const source=fs.readFileSync(require.resolve('../src/codex_usage/static/usage-insights.js'),'utf8');
  vm.runInNewContext(source,context);
  const q={windows:[{id:'weekly',label:'每周额度'}]};
  assert.match(context.module.exports.pacePanel(q),/data-pace-view="date" aria-pressed="true"/);
  context.module.exports.handle({dataset:{paceView:'cycle'}});
  assert.equal(saved.get('codex-usage-pace-view'),'cycle');
  assert.equal(redraw[0].view,'cycle');
  assert.match(context.module.exports.pacePanel(q),/data-pace-view="cycle" aria-pressed="true"/);
});

test('large reset history renders only the initial batch and retains scroll position',()=>{
  let html='';
  const host={scrollTop:120,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[]};
  const context={module:{exports:{}},esc:escape,number:String,accountTime:String,
    document:{documentElement:{lang:'zh-CN'},getElementById:()=>host,addEventListener:()=>{},activeElement:null},
    QuotaDOM:{patch:(_,value)=>{html=value;host.scrollTop=0;}}};
  const source=fs.readFileSync(require.resolve('../src/codex_usage/static/quota-page.js'),'utf8').replace('return {panel,render,','return {renderEvents,panel,render,');
  vm.runInNewContext(source,context);
  const rows=Array.from({length:2000},(_,id)=>({id:String(id),kind:'official',at:now-id,since:now-id-60,before_used:80,after_used:0,label:'long '.repeat(100)}));
  context.module.exports.renderEvents({reset_events:rows});
  assert.equal((html.match(/class="reset-event"/g)||[]).length,10);
  assert.match(html,/还有 1990 条/);
  assert.equal(host.scrollTop,120);
});
