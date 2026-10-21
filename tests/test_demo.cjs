const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../demo/demo-data.js');
const catalog=require('../src/codex_usage/prices.json');
const now=Date.parse('2026-10-21T15:30:00Z');
const query={since:'2026-09-22',until:'2026-10-21'};
test('demo API bridge intercepts account and mutation requests without reaching a real backend',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');let calls=0;
  const context={DemoData:require('../demo/demo-data.js'),DEMO_CATALOG:catalog,URL,Response,DOMException,
    location:{href:'https://example.invalid/codex-usage/'},window:{fetch:()=>{calls++;throw new Error('Unexpected real network');}},
    document:{addEventListener(){},body:{}},MutationObserver:class{observe(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../demo/demo-bridge.js'),'utf8'),context);
  const q=await context.window.fetch('/api/account');assert.equal((await q.json()).account.label,'演示账号 · 非真实数据');
  const blocked=await context.window.fetch('/api/remotes/sync',{method:'POST'});assert.equal(blocked.status,400);
  const forecast=await context.window.fetch('/api/reset-forecast');assert.equal((await forecast.json()).probability,null);
  await assert.rejects(()=>context.window.fetch('/api/data',{signal:{aborted:true}}),{name:'AbortError'});
  assert.equal(calls,0);
});
test('synthetic totals reconcile across dimensions and obey model, machine, date and session filters',()=>{
  const demo=create(catalog,now),r=demo.report(query);
  for(const dimension of ['timeline','projects','sessions','models'])assert.equal(r[dimension].reduce((s,r)=>s+r.total,0),r.summary.total);
  assert.ok(r.sessions.length>20);assert.equal(r.projects.length,6);assert.equal(r.options.sources.length,3);
  const project=r.projects[0],detail=demo.report({...query,project:project.id});assert.equal(detail.summary.total,project.total);
  const session=r.sessions[0];assert.equal(demo.report({...query,session:session.id}).summary.total,session.total);
  const filtered=demo.report({...query,source:'local',model:'gpt-6.1-sol'});assert.ok(filtered.summary.total<r.summary.total);
  assert.ok(filtered.projects.every(p=>p.source==='local'));assert.deepEqual(filtered.models.map(m=>m.name),['gpt-6.1-sol']);
  const one=demo.report({since:query.until,until:query.until});assert.equal(one.timeline.length,1);assert.ok(one.summary.total>0);
});
test('grain changes preserve totals; boundary, empty and unknown-price behavior remain explicit',()=>{
  const demo=create(catalog,now),r=demo.report(query);
  for(const grain of ['week','month'])assert.equal(demo.report({...query,grain}).summary.total,r.summary.total);
  assert.ok(r.summary.unpriced_tokens>0);assert.equal(r.summary.cost,null);
  const empty=demo.report({...query,project:'no-such-project'});assert.equal(empty.summary.total,0);assert.equal(empty.timeline.length,30);
  demo.settings({...demo.settings(),usage_since:'2026-10-15'});assert.equal(demo.report(query).range.since,'2026-10-15');
  assert.throws(()=>demo.report({since:'2026-10-22',until:'2026-10-21'}));
});
test('custom prices recalculate only simulated data and CSV follows search and filters',()=>{
  const demo=create(catalog,now);const before=demo.report({...query,model:'gpt-6.1-sol'}).summary.known_cost;
  const config=demo.settings();config.prices['gpt-6.1-sol']={input:0,cached:0,write:0,output:0,long_context:null};demo.settings(config);
  assert.ok(before>0);assert.equal(demo.report({...query,model:'gpt-6.1-sol'}).summary.known_cost,0);
  const csv=demo.csv({...query,dimension:'sessions',search:'搜索'});assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('SIMULATED'));
  assert.ok(csv.split('\r\n').slice(1).every(row=>row.includes('实现搜索与筛选')));
  assert.equal(demo.csv({...query,dimension:'sessions',search:'不存在的任务'}).split('\r\n').length,1);
});
test('quota fixture has ordered samples, bounded percentages, reset breaks and acknowledgement',()=>{
  const demo=create(catalog,now),q=demo.quotaRange(),g=q.groups[0];
  assert.equal(g.events.length,3);assert.ok(g.samples.length>100);
  assert.ok(g.samples.every((s,i)=>s.used_percent>=0&&s.used_percent<=100&&(!i||s.at>g.samples[i-1].at)));
  for(const e of g.events)assert.ok(g.samples.some(s=>s.at===e.at&&s.break_before));
  assert.equal(g.samples.at(-1).used_percent,demo.quota().windows[0].used_percent);
  assert.equal(demo.acknowledge('demo-alert').alerts[0].acknowledged,true);
});

test('sparse activity, project scales and cached inputs stay consistent across calendar boundaries',()=>{
  const {build}=require('../src/codex_usage/static/activity-heatmap.js');
  for(const date of ['2026-10-21T15:30:00Z','2027-01-01T00:05:00Z','2028-03-01T15:30:00Z']){
    const clock=Date.parse(date),demo=create(catalog,clock),r=demo.report();
    const active=r.timeline.filter(d=>d.total>0);
    assert.ok(active.length>65&&active.length<180,`${date}: ${active.length} active days`);
    for(const mode of ['day','week','cumulative'])assert.equal(build(r,mode).summary.total,r.summary.total);
    assert.ok(r.projects[0].total/r.projects.at(-1).total>1000);
    assert.equal(r.projects.length,6);
    for(const p of r.projects)assert.ok(p.cache_rate>.9&&p.cache_rate<1);
    for(const e of demo.events){
      assert.equal(e.input,e.uncached+e.cached+e.write);
      assert.equal(e.total,e.input+e.output);
      assert.ok(e.uncached>=0&&e.reasoning<=e.output&&Date.parse(e.at)<=clock);
    }
    for(const key of ['total','input','cached','output','events','unpriced_tokens']){
      for(const dimension of ['timeline','projects','sessions','models']){
        assert.equal(r[dimension].reduce((sum,row)=>sum+row[key],0),r.summary[key]);
      }
    }
    for(const dimension of ['timeline','projects','sessions','models']){
      assert.ok(Math.abs(r[dimension].reduce((sum,row)=>sum+row.known_cost,0)-r.summary.known_cost)<1e-8);
    }
    const dailyTotals=active.map(d=>d.total);
    assert.ok(Math.max(...dailyTotals)>Math.min(...dailyTotals)*20);
  }
});

test('weekly reset, independent references, sleep plateaus and collection gaps model different behavior',()=>{
  const demo=create(catalog,now),q=demo.quotaRange(),g=q.groups[0],scheduled=g.events[0];
  assert.equal(scheduled.at-q.range.since,7*86400);
  assert.equal(scheduled.old_reset,scheduled.at);
  assert.equal(scheduled.new_reset-scheduled.at,7*86400);
  assert.equal(g.references[0].until,scheduled.at);assert.equal(g.references[0].after,100);
  for(const ref of g.references){
    assert.equal(ref.after,100*(ref.until-ref.since)/(ref.cycle_end-ref.since));
  }
  for(const e of g.events){
    const before=g.samples.findLast(s=>s.at<e.at),after=g.samples.find(s=>s.at===e.at);
    assert.equal(e.before_used,before.used_percent);assert.equal(e.after_used,after.used_percent);
    assert.ok(after.break_before);
  }
  let sleepIntervals=0,gaps=0,fast=false,slow=false;
  for(let i=1;i<g.samples.length;i++){
    const a=g.samples[i-1],b=g.samples[i];
    if(!b.break_before){
      assert.ok(b.used_percent>=a.used_percent);
      const hour=((a.at+8*3600)%86400)/3600;
      if(b.at-a.at===1800&&(hour<9||hour>=23)){
        assert.equal(b.used_percent,a.used_percent);sleepIntervals++;
      }
    }else if(b.at-a.at>900){
      gaps++;assert.ok(!g.events.some(e=>e.at>a.at&&e.at<=b.at));
    }
    const ref=g.references.find(r=>b.at>=r.since&&b.at<r.until);
    if(ref){const baseline=100*(b.at-ref.since)/(ref.cycle_end-ref.since);
      fast||=b.used_percent>baseline+15;slow||=b.used_percent<baseline-15;}
  }
  assert.ok(sleepIntervals>100);assert.equal(gaps,2);assert.ok(fast&&slow);
  assert.equal(demo.quota().windows[0].used_percent+demo.quota().windows[0].remaining_percent,100);
});
test('generated site uses subdirectory-safe assets and includes no server data',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../dist/demo');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.includes('全部数据由浏览器生成'));assert.doesNotMatch(html,/(?:href|src)="\/(?!\/)/);
  assert.ok(html.indexOf('demo-bridge.js')<html.indexOf('src="./app.js?'));
  for(const name of fs.readdirSync(root))assert.ok(/\.(?:html|js|css|svg)$/.test(name)||name==='.nojekyll');
  const assets=[...html.matchAll(/(?:href|src)="\.\/([^"?]+)\?v=([a-f0-9]{12})"/g)];
  assert.ok(assets.length>10);
  for(const match of assets){
    const file=path.join(root,match[1]);assert.ok(fs.existsSync(file),match[1]);
    assert.equal(match[2],require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12));
  }
});
