'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run the real event handlers with a small DOM boundary and controllable requests.
function dashboard() {
  const nodes=new Map(),listeners={},pending=[],released=[];
  function node(id) {
    if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',open:false,scrollTop:0,listeners:{},
      addEventListener(type,callback){this.listeners[type]=callback;},
      showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},
      matches(){return false;}});
    return nodes.get(id);
  }
  const context=vm.createContext({URLSearchParams,AbortController,Intl,Date,
    location:{search:'?view=models&range=today&project=selected-project'},
    document:{getElementById:node,querySelectorAll:()=>[],body:{classList:{toggle(){}}},
      addEventListener(type,callback){(listeners[type]??=[]).push(callback);}},
    window:{addEventListener(){}},localStorage:{getItem:()=>null},
    ResizeObserver:class{observe(){}unobserve(){}},setInterval(){},setTimeout(){},clearTimeout(){},
    UsageInsights:{handle:()=>false},
    CompactTables:{mount(){}},
    fetch:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject})),
    released});
  const source=fs.readFileSync(require.resolve('../src/codex_usage/static/app.js'),'utf8');
  vm.runInContext(source.replace(/^init\(\);\r?$/m,''),context);
  vm.runInContext(`
    updateControls=()=>{};syncURL=()=>{};load=()=>{};
    metric=()=>'';modelTable=()=>'';mountChart=()=>{};
    releaseCharts=element=>released.push(element.id);
    this.dashboardState=state;
  `,context);
  const finish=(request,title)=>request.resolve({ok:true,json:async()=>({
    sessions:[{title,id:title,project_names:[]}],range:{since:'2026-10-14',until:'2026-10-16'},
    summary:{total:1,known_cost:1,cache_rate:0,events:1},models:[],timeline:[]})});
  return {context,node,pending,released,finish,
    click:button=>listeners.click[0]({target:{closest:()=>button}})};
}

test('model range shortcut applies outside the filter popover without clearing dimensions',async()=>{
  const app=dashboard();
  // The real chart's button must be wired to the immediate shortcut, not the draft controls.
  const source=fs.readFileSync(require.resolve('../src/codex_usage/static/model-charts.js'),'utf8');
  const range=source.match(/data-range-jump="([^"]+)"/)[1];
  await app.click({dataset:{rangeJump:range}});
  assert.equal(app.context.dashboardState.range,'all');
  assert.equal(app.context.dashboardState.project,'selected-project');
  vm.runInContext('filterDraft={...state};',app.context);
  await app.click({dataset:{range:'7'}});
  assert.equal(vm.runInContext('filterDraft.range',app.context),'7');
  assert.equal(app.context.dashboardState.range,'all','draft changes must wait for Apply');
});

test('opening settings directly from the quota page loads its missing usage report',()=>{
  const app=dashboard();
  vm.runInContext(`
    state.view='quota';data=null;this.loads=0;
    render=()=>{};window.scrollTo=()=>{};load=()=>{this.loads++;};
  `,app.context);
  app.context.setView('settings');
  assert.equal(app.context.dashboardState.view,'settings');assert.equal(app.context.loads,1);
  vm.runInContext('data={};',app.context);
  app.context.setView('quota');app.context.setView('settings');
  assert.equal(app.context.loads,1,'already loaded settings must not trigger another scan');
});

test('late session response cannot replace a newer session',async()=>{
  const app=dashboard();
  const first=app.context.showSession('first');
  const second=app.context.showSession('second');
  assert.equal(app.pending[0].options.signal.aborted,true);
  assert.equal(new URL(app.pending[1].url,'http://localhost').searchParams.get('session'),'second');
  app.finish(app.pending[1],'Second session');await second;
  app.finish(app.pending[0],'First session');await first;
  assert.match(app.node('sessionDetail').innerHTML,/Second session/);
  assert.doesNotMatch(app.node('sessionDetail').innerHTML,/First session/);
});

test('closing session cancels work and ignores stale errors after reopening',async()=>{
  const app=dashboard(),first=app.context.showSession('first');
  app.node('sessionDialog').close();
  assert.equal(app.pending[0].options.signal.aborted,true);
  assert.equal(app.released.at(-1),'sessionDetail');
  app.node('sessionDialog').scrollTop=400;
  const second=app.context.showSession('second');
  assert.equal(app.node('sessionDialog').scrollTop,0);
  app.finish(app.pending[1],'Second session');await second;
  app.pending[0].reject(new Error('stale failure'));await first;
  assert.match(app.node('sessionDetail').innerHTML,/Second session/);
  app.node('sessionDialog').close();
  const third=app.context.showSession('third');app.node('sessionDialog').close();
  app.finish(app.pending[2],'Closed session');await third;
  assert.doesNotMatch(app.node('sessionDetail').innerHTML,/Closed session/);
});

test('remote polling on the quota route never forces an account refresh when no usage report is loaded',async()=>{
  const app=dashboard();
  vm.runInContext(`
    state.view='quota';data=null;this.forcedLoads=0;
    load=()=>{this.forcedLoads++;};renderRemoteStatus=()=>{};
    api=async()=>[{id:'remote',synced_at:'updated'}];
  `,app.context);
  await app.context.pollRemotes();await app.context.pollRemotes();
  assert.equal(app.context.forcedLoads,0);
  // A real log view still refreshes when its source changes.
  vm.runInContext("state.view='projects';",app.context);
  await app.context.pollRemotes();assert.equal(app.context.forcedLoads,1);
});

test('shared chart viewport clamps panning and supports exactly one bucket at maximum zoom',()=>{
  const source=fs.readFileSync(require.resolve('../src/codex_usage/static/model-charts.js'),'utf8');
  const context=vm.createContext({});
  vm.runInContext(source.slice(0,source.indexOf('// UI choices'))+';this.viewport=UsageViewport;',context);
  const clamp=context.viewport.clamp;
  assert.deepEqual({...clamp({start:-5,end:-2},10)},{start:0,end:3});
  assert.deepEqual({...clamp({start:9,end:12},10)},{start:7,end:10});
  assert.deepEqual({...clamp({start:2.7,end:3},10)},{start:3,end:4});
  assert.deepEqual({...clamp({start:-5,end:20},10)},{start:0,end:10});
});
