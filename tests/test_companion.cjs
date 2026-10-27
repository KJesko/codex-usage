'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({Intl,Date});
vm.runInContext(fs.readFileSync('src/codex_usage/desktop_assets/companion.js','utf8'),context);
const view=context.CompanionView;
test('dashboard gate requires backend readiness and handles unsaved edits',()=>{
  assert.equal(view.canOpen({connected:true,dashboard_ready:false},false),false);
  assert.equal(view.canOpen({connected:true,dashboard_ready:true,state:'signed_out'},false),true);
  assert.equal(view.canOpen({connected:true,dashboard_ready:true,state:'signed_out'},true),false);
  assert.equal(view.canOpen({connected:true,dashboard_ready:true,state:'tracking'},true),true);
  assert.equal(view.canOpen({connected:false,dashboard_ready:true,state:'tracking'},false),false);
});
test('tracking status distinguishes logs only, quota only and stopped collectors',()=>{
  const logs={connected:true,logs:{valid:true},state:'signed_out',account:{usage_collector:{running:true}}};
  assert.equal(view.tracking(logs)[0],'日志持续获取中');
  assert.equal(view.tracking({...logs,state:'tracking'})[0],'日志与额度持续追踪中');
  assert.equal(view.tracking({...logs,account:{usage_collector:{running:false}}})[0],'日志已就绪');
  assert.equal(view.tracking({...logs,account:{usage_collector:{running:true,problem:'error'}}})[0],'日志获取异常');
});
test('message content is escaped and histories have bounded rendered items',()=>{
  const html=view.messageMarkup(Array.from({length:1000},()=>({message:'<img onerror="oops">',id:'" onclick="bad',at:1793200000})));
  assert.equal((html.match(/<article/g)||[]).length,50);assert.doesNotMatch(html,/<img|data-value=""/);
});
test('log and quota lamps are independent and stale, failed or disconnected data stays gray',()=>{
  const now=Date.parse('2026-10-27T20:00:00Z'),fresh='2026-10-27T19:59:30Z';
  const s={connected:true,state:'tracking',logs:{valid:true},account:{fetched_at:fresh,collector:{interval_seconds:60},usage_collector:{running:true,last_scan:fresh,scan_interval_seconds:30}}};
  assert.equal(view.indicators(s,now).logs,true);assert.equal(view.indicators(s,now).quota,true);
  assert.equal(view.indicators({...s,logs:{valid:false}},now).logs,false);
  assert.equal(view.indicators({...s,logs:{valid:false}},now).quota,true);
  assert.equal(view.indicators({...s,state:'signed_out'},now).logs,true);
  assert.equal(view.indicators({...s,state:'signed_out'},now).quota,false);
  assert.equal(view.indicators({...s,connected:false},now).logs,false);
  assert.equal(view.indicators({...s,connected:false},now).quota,false);
  assert.equal(view.indicators(s,now+300000).logs,false);
  assert.equal(view.indicators(s,now+300000).quota,false);
  assert.equal(view.indicators({...s,account:{...s.account,usage_collector:{running:true,last_scan:'invalid'}}},now).logs,false);
  assert.equal(view.indicators({...s,account:{...s.account,usage_collector:{running:true,last_scan:fresh,problem:'read error'}}},now).logs,false);
});
