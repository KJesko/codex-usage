'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const quota={history_available:true,history_scope:'one',fetched_at:'first'};
function tools() {
  const listeners={},pending=[];
  const context=vm.createContext({AbortController,URLSearchParams,esc:String,accountTime:String,
    FormData:class {constructor(form){this.form=form;}get(key){return this.form[key];}},
    document:{addEventListener(type,fn){(listeners[type]??=[]).push(fn);}},
    window:{addEventListener(){}},renderQuotaPace(){},settings:{timezone:'Asia/Shanghai'},
    api:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}))});
  vm.runInContext(fs.readFileSync(require.resolve('../src/codex_usage/static/quota-tools.js'),'utf8')+'\nthis.tools=QuotaTools;',context);
  return {display:q=>context.tools.display(q),controls:()=>context.tools.rangeControls(),
    collection:q=>context.tools.collectionMarkup(q),pending,
    input:(name,value)=>listeners.input[0]({target:{name,value,closest:()=>true}}),
    apply:range=>listeners.submit[0]({target:{id:'quotaRangeForm',...range},preventDefault(){}})};
}

test('quota page automatically loads only a custom range without a cycle selection',async()=>{
  const t=tools(),initial=t.display(quota);
  assert.equal(initial.custom_range,true);assert.equal(initial.busy,true);
  t.display(quota);await settle();
  assert.equal(t.pending.length,1);
  assert.match(t.pending[0].url,/^\/api\/account\/range\?since=\d{4}-\d{2}-\d{2}&until=/);
  assert.match(t.pending[0].url,/grain=auto/);
  const dates=new URLSearchParams(t.pending[0].url.split('?')[1]);
  assert.equal((Date.parse(dates.get('until'))-Date.parse(dates.get('since')))/86400000,89);
  assert.equal(t.controls(),'');
  assert.doesNotMatch(t.controls(),/quotaCycle|记录密度|当前使用段/);
  t.pending[0].resolve({groups:[{id:'first'}]});await settle();
  assert.equal(t.display(quota).groups[0].id,'first');
  assert.equal(t.display(quota).busy,false);assert.equal(t.pending.length,1);
});

test('account changes cancel old responses and load the new account automatically',async()=>{
  const t=tools();t.display(quota);await settle();
  const second={...quota,history_scope:'two'};
  assert.equal(t.display(second).groups,undefined);
  assert.equal(t.pending[0].options.signal.aborted,true);await settle();
  t.pending[0].resolve({groups:[{id:'wrong-owner'}]});await settle();
  assert.equal(t.display(second).groups,undefined);
  t.pending[1].resolve({groups:[{id:'new-owner'}]});await settle();
  assert.equal(t.display(second).groups[0].id,'new-owner');
  const signedOut={history_available:false,history_scope:null};
  assert.equal(t.display(signedOut).groups,undefined);
  assert.equal(t.pending[1].options.signal.aborted,true);await settle();
  assert.equal(t.pending.length,2);
  assert.match(t.display(signedOut).history_problem,/当前账号身份/);
});

test('queued range work cannot cross an account change before the request starts',async()=>{
  const t=tools();t.display(quota);t.display({...quota,history_scope:'two'});await settle();
  assert.equal(t.pending.length,1);
  t.pending[0].resolve({groups:[{id:'two'}]});await settle();
  assert.equal(t.display({...quota,history_scope:'two'}).groups[0].id,'two');
});

test('new observations refresh the chart without a loading flash',async()=>{
  const t=tools();t.display(quota);await settle();
  t.pending[0].resolve({groups:[{id:'first'}]});await settle();
  const updated={...quota,fetched_at:'second'};
  assert.equal(t.display(updated).busy,false);await settle();
  assert.equal(t.display(updated).groups[0].id,'first');
  assert.equal(t.pending.length,2);
  assert.equal(t.pending[1].url,t.pending[0].url);
  t.pending[1].resolve({groups:[{id:'updated'}]});await settle();
  assert.equal(t.display(updated).groups[0].id,'updated');
});

test('failed background history reads retain the chart and retry after the next observation',async()=>{
  const t=tools();t.display(quota);await settle();
  t.pending[0].resolve({groups:[{id:'saved'}]});await settle();
  const updated={...quota,fetched_at:'second'};t.display(updated);await settle();
  t.pending[1].reject(new Error('Temporary history failure'));await settle();
  assert.equal(t.display(updated).groups[0].id,'saved');
  assert.equal(t.display(updated).problem.message,'Temporary history failure');
  assert.equal(t.display(updated).busy,false);await settle();assert.equal(t.pending.length,2);
  t.display({...updated,fetched_at:'third'});await settle();assert.equal(t.pending.length,3);
});

test('collection disclosure distinguishes polling, official sampling and chart aggregation',()=>{
  const t=tools(),html=t.collection({collector:{running:true,interval_seconds:60}});
  for(const text of ['额度采集 · 每 60 秒','共用一次额度读取','每 15 秒','每 1.2 秒','最短间隔 5 秒','不会额外请求额度','每 5 分钟'])assert.ok(html.includes(text),text);
});

test('all history includes early observations without padding the entire retention window',async()=>{
  const t=tools();t.display(quota);await settle();
  const ticks=Array.from({length:91},(_,i)=>({at:i*86400,date:String(i)}));
  t.pending[0].resolve({range:{since:0,until:90*86400},ticks,groups:[{samples:[{at:40*86400+60}],events:[]}]});await settle();
  const q=t.display(quota);
  assert.equal(q.range.since,40*86400);assert.equal(q.ticks.length,51);
});
