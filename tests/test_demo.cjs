const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../demo/demo-data.js');
const catalog=require('../src/codex_usage/prices.json');
const now=Date.parse('2026-10-21T15:30:00Z');
const query={since:'2026-09-22',until:'2026-10-21'};
// Parse CSV independently, including quoted commas, quotes and embedded newlines.
function readCsv(csv){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=csv.charCodeAt(0)===0xfeff?1:0;i<csv.length;i++){
    const c=csv[i];
    if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if(c==='\r'&&!quoted&&csv[i+1]==='\n'){row.push(field);rows.push(row);row=[];field='';i++;}
    else field+=c;
  }
  row.push(field);rows.push(row);const headers=rows.shift();
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]])));
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('demo API bridge intercepts account and mutation requests without reaching a real backend',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');let calls=0,refreshes=0,loads=0;const listeners={};
  const context={DemoData:require('../demo/demo-data.js'),DEMO_CATALOG:catalog,URL,Response,DOMException,
    location:{href:'https://example.invalid/codex-usage/'},window:{fetch:()=>{calls++;throw new Error('Unexpected real network');}},
    document:{addEventListener(name,fn){listeners[name]=fn;},body:{}},MutationObserver:class{observe(){}},
    accountData:{history_scope:'old'},
    refreshAccount(force){assert.equal(force,true);refreshes++;},load(force){assert.equal(force,true);loads++;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../demo/demo-bridge.js'),'utf8'),context);
  const q=await context.window.fetch('/api/account');assert.equal((await q.json()).account.label,'演示账号 · 非真实数据');
  const blocked=await context.window.fetch('/api/remotes/sync',{method:'POST'});assert.equal(blocked.status,400);
  const forecast=await context.window.fetch('/api/reset-forecast');assert.equal((await forecast.json()).probability,null);
  await assert.rejects(()=>context.window.fetch('/api/data',{signal:{aborted:true}}),{name:'AbortError'});
  assert.equal(calls,0);
  listeners.click({target:{closest:()=>({id:'refresh'})},preventDefault(){},stopImmediatePropagation(){}});
  assert.equal(refreshes,1);assert.equal(loads,1);assert.equal(calls,0);
  await context.window.fetch('/api/settings',{method:'POST',body:JSON.stringify({timezone:'America/Los_Angeles'})});
  assert.equal(context.accountData.history_scope,'demo-account:America/Los_Angeles');
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
  assert.ok(g.samples.every((s,i)=>Number.isInteger(s.used_percent)&&s.used_percent>=0&&s.used_percent<=100&&(!i||s.at>g.samples[i-1].at)));
  for(const e of g.events)assert.ok(g.samples.some(s=>s.at===e.at&&s.break_before));
  assert.equal(g.samples.at(-1).used_percent,demo.quota().windows[0].used_percent);
  for(const time of ['2026-10-21T02:17:39Z','2026-10-21T07:43:21Z','2026-10-21T15:30:00Z']){
    const snapshot=create(catalog,Date.parse(time)),account=snapshot.quota(),history=snapshot.quotaRange().groups[0];
    assert.ok(history.samples.every(s=>Number.isInteger(s.used_percent)));
    assert.ok(account.reset_events.every(e=>Number.isInteger(e.before_used)&&Number.isInteger(e.after_used)));
    for(const w of account.windows){
      assert.ok(Number.isInteger(w.used_percent)&&Number.isInteger(w.remaining_percent));
      assert.equal(w.used_percent+w.remaining_percent,100);
    }
    assert.equal(account.windows[0].used_percent,history.samples.at(-1).used_percent);
  }
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

test('72 filter combinations reconcile raw events, every report dimension, daily models and four CSV exports',()=>{
  const demo=create(catalog,now);
  const filters=[{}, {source:'local'}, {source:'ssh:dev',project:'orbit-api'},
    {project:'atlas-web',model:'gpt-6.1-sol'}, {account:'demo-team',model:'gpt-6-luna'},
    {project:'design-system',account:'demo-personal'}, {model:'demo-experimental'},
    {source:'ssh:lab',project:'atlas-web'}];
  for(const timezone of ['Asia/Shanghai','America/Los_Angeles','Europe/London']){
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    const raw=demo.events.map(e=>({...e,date:formatter.format(new Date(e.at))}));
    for(const grain of ['day','week','month'])for(const filter of filters){
      const q={...query,...filter,timezone,grain},r=demo.report(q);
      const selected=raw.filter(e=>e.date>=q.since&&e.date<=q.until&&Object.entries(filter).every(([k,v])=>e[k]===v));
      const keys=['total','input','uncached','cached','write','output','reasoning'];
      for(const k of keys)assert.equal(r.summary[k],selected.reduce((s,e)=>s+e[k],0));
      assert.equal(r.summary.sessions,new Set(selected.map(e=>e.session)).size);
      close(r.summary.cache_rate,r.summary.input?r.summary.cached/r.summary.input:0);
      assert.equal(r.model_timeline.reduce((s,d)=>s+d.models.reduce((s,m)=>s+m.total,0),0),r.summary.total);
      for(const dimension of ['timeline','projects','sessions','models']){
        const csv=readCsv(demo.csv({...q,dimension}));assert.equal(csv.length,r[dimension].length);
        for(const k of [...keys,'events','unpriced_tokens','unpriced_events','known_cost','cache_savings']){
          close(csv.reduce((s,row)=>s+Number(row[k]),0),r.summary[k]);
        }
        csv.forEach((row,i)=>{
          const expected=r[dimension][i];
          assert.equal(row.cost,expected.cost===null?'':String(expected.cost));
          assert.equal(row.timezone,timezone);assert.equal(row.range_since,r.range.since);
          assert.equal(row.range_until,r.range.until);assert.equal(row.data_type,'SIMULATED');
          for(const k of keys)assert.equal(Number(row[k]),expected[k]);
          if(dimension==='sessions')assert.equal(row.id,expected.id);
        });
      }
    }
  }
});

test('cost components, long context, overrides and unknown prices remain explicit in reports and exports',()=>{
  const demo=create(catalog,now),r=demo.report(query);
  let expected=0,savings=0,unknown=0,longCount=0;
  for(const e of demo.events.filter(e=>e.at>='2026-09-21T16:00:00Z'&&e.at<'2026-10-21T16:00:00Z')){
    const rate=catalog.models[catalog.aliases?.[e.model]||e.model];
    if(!rate){unknown+=e.total;continue;}
    const long=rate.long_context&&e.context_input>rate.long_context;if(long)longCount++;
    expected+=((e.uncached*rate.input+e.cached*rate.cached+e.write*rate.write)*(long?2:1)+e.output*rate.output*(long?1.5:1))/1e6;
    savings+=e.cached*(rate.input-rate.cached)*(long?2:1)/1e6;
  }
  assert.ok(longCount>0);assert.equal(r.summary.unpriced_tokens,unknown);
  close(r.summary.known_cost,expected);close(r.summary.cache_savings,savings);
  close(r.summary.known_cost,r.summary.input_cost+r.summary.cached_cost+r.summary.write_cost+r.summary.output_cost);
  const unknownReport=demo.report({...query,model:'demo-experimental'});
  assert.equal(unknownReport.summary.cost,null);assert.equal(unknownReport.summary.known_cost,0);
  const csv=readCsv(demo.csv({...query,model:'demo-experimental',dimension:'models'}))[0];
  assert.equal(csv.cost,'');assert.ok(Number(csv.unpriced_tokens)>0);
  demo.settings({...demo.settings(),prices:{'demo-experimental':{input:2,cached:.2,write:2,output:8,long_context:null}}});
  const updated=demo.report(query);
  assert.equal(updated.summary.total,r.summary.total);assert.equal(updated.summary.unpriced_tokens,0);
  assert.ok(updated.summary.known_cost>r.summary.known_cost);assert.equal(updated.summary.cost,updated.summary.known_cost);
});

test('session exports include every search match across pages, preserve sorting and expose mixed-model details',()=>{
  const demo=create(catalog,now),all=demo.report();
  assert.ok(all.sessions.some(s=>s.model_names.length>1));
  assert.ok(all.models[0].total/all.models.filter(m=>m.name!=='demo-experimental').at(-1).total>2);
  for(const search of ['','搜索','Atlas','gpt-6-luna','不存在的会话'])for(const sort of ['total','known_cost','last_at']){
    const expected=all.sessions.filter(s=>[s.title,s.id,...s.model_names,...s.project_names].some(v=>v.toLowerCase().includes(search.toLowerCase())))
      .sort((a,b)=>sort==='last_at'?b.last_at.localeCompare(a.last_at):b[sort]-a[sort]);
    const csv=readCsv(demo.csv({dimension:'sessions',search,sort}));
    assert.deepEqual(csv.map(r=>r.id),expected.map(r=>r.id));
    close(csv.reduce((s,r)=>s+Number(r.total),0),expected.reduce((s,r)=>s+r.total,0));
    if(!search)assert.ok(csv.length>20);
  }
  const mixed=all.sessions.find(s=>s.model_names.length>1),detail=demo.report({session:mixed.id});
  assert.equal(detail.summary.total,mixed.total);assert.ok(detail.models.length>1);
  const event=demo.events.find(e=>e.session===mixed.id);event.title='  =SUM(A1:A2), "示例"\n第二行';
  const row=readCsv(demo.csv({dimension:'sessions',search:mixed.id}))[0];
  assert.equal(row.title,"'"+event.title);
});

test('comparison calendar boundaries carry the selected timezone and handle DST, future ranges and cutoffs',()=>{
  const demo=create(catalog,now),r=demo.report({...query,timezone:'Asia/Shanghai'});
  assert.equal(r.comparison.current_range.since,'2026-09-21T16:00:00.000Z');
  const dst=create(catalog,Date.parse('2026-11-02T18:30:00Z'));
  const c=dst.report({since:'2026-11-02',until:'2026-11-02',timezone:'America/Los_Angeles'}).comparison;
  assert.equal(c.current_range.since,'2026-11-02T08:00:00.000Z');
  assert.equal(c.previous_range.since,'2026-11-01T07:00:00.000Z');
  assert.equal(c.previous_range.until,'2026-11-01T18:30:00.000Z');
  for(const dimension of ['projects','models'])for(const [amount,key] of [['total','total'],['cost','known_cost']]){
    close(c[dimension].reduce((s,row)=>s+row['delta_'+amount],0),c.current[key]-c.previous[key]);
  }
  const week=demo.report({since:'2026-10-19',until:'2026-10-21',period:'week',timezone:'Asia/Shanghai'}).comparison;
  assert.equal(week.previous_range.since,'2026-10-11T16:00:00.000Z');
  assert.equal(week.previous_range.until,'2026-10-14T15:30:00.000Z');
  const future=demo.report({since:'2026-10-01',until:'2026-11-10'});
  assert.equal(future.comparison.current.total,future.summary.total);
  assert.equal(future.comparison.current_range.until,new Date(now).toISOString());
  assert.equal(demo.report({since:'2026-11-01',until:'2026-11-10'}).comparison.available,false);
  demo.settings({...demo.settings(),usage_since:'2026-11-01'});
  const empty=demo.report(query);assert.equal(empty.summary.total,0);assert.deepEqual(empty.timeline,[]);
  assert.equal(readCsv(demo.csv({...query,dimension:'sessions'})).length,0);
  assert.throws(()=>demo.report({since:'2026-02-30',until:'2026-03-02'}),/日期/);
  assert.throws(()=>demo.settings({...demo.settings(),usage_since:'2026-02-30'}),/日期/);
});

test('quota date selection uses local midnight ticks, survives DST and invalidates history after timezone changes',()=>{
  const demo=create(catalog,Date.parse('2026-11-02T18:30:00Z')),oldScope=demo.quota().history_scope;
  demo.settings({...demo.settings(),timezone:'America/Los_Angeles'});
  const q=demo.quotaRange();assert.notEqual(q.history_scope,oldScope);assert.equal(q.history_scope,demo.quota().history_scope);
  const before=q.ticks.find(t=>t.date==='2026-11-01'),after=q.ticks.find(t=>t.date==='2026-11-02');
  assert.equal(after.at-before.at,25*3600);
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:q.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(const t of q.ticks)assert.equal(clock.format(new Date(t.at*1000)),'00:00');
  assert.equal(q.range.since,q.ticks[0].at);assert.equal(q.range.until,q.ticks.at(-1).at);
});

test('recent-period cards follow dimensions independently of the selected historical date range',()=>{
  const demo=create(catalog,now),q={source:'local',model:'gpt-6.1-sol',account:'demo-personal'};
  const r=demo.report({...q,since:'2026-09-01',until:'2026-09-07'});
  for(const [key,since] of [['today','2026-10-21'],['week','2026-10-19'],['month','2026-10-01']]){
    const expected=demo.report({...q,since,until:'2026-10-21'}).summary;
    assert.equal(r[key].total,expected.total);close(r[key].known_cost,expected.known_cost);
  }
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
