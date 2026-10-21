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
test('generated site uses subdirectory-safe assets and includes no server data',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../dist/demo');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.includes('全部数据由浏览器生成'));assert.doesNotMatch(html,/(?:href|src)="\/(?!\/)/);
  assert.ok(html.indexOf('demo-bridge.js')<html.indexOf('src="./app.js"'));
  for(const name of fs.readdirSync(root))assert.ok(/\.(?:html|js|css|svg)$/.test(name)||name==='.nojekyll');
  for(const match of html.matchAll(/(?:href|src)="\.\/([^"?]*)"/g))if(match[1])assert.ok(fs.existsSync(path.join(root,match[1])),match[1]);
});
