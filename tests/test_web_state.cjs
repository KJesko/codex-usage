'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAutosave,validateField,sourceState,dataRows}=require('../src/codex_usage/static/web-state.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const calls=[],timers=new Map();let sequence=0,active=0,maximum=0;
  const save=createAutosave({systemZone:()=> 'Asia/Shanghai',schedule:fn=>{timers.set(++sequence,fn);return sequence;},cancel:id=>timers.delete(id),persist:patch=>{active++;maximum=Math.max(maximum,active);return new Promise((resolve,reject)=>calls.push({patch,resolve:()=>{active--;resolve();},reject:()=>{active--;reject(new Error('offline'));}}));}});
  return {save,calls,timers,get maximum(){return maximum;}};
}
test('rapid typing is debounced and only the latest valid value is submitted',async()=>{
  const f=fixture();for(const value of ['A','AB','ABC'])f.save.edit('settingsAvatar',value);
  assert.equal(f.timers.size,1);assert.equal(f.calls.length,0);
  const done=f.save.flush();assert.deepEqual(f.calls[0].patch,{avatar_initials:'ABC'});f.calls[0].resolve();await done;
  assert.equal(f.save.snapshot().settingsAvatar.status,'saved');assert.equal(f.save.hasUnsaved(),false);
});
test('an invalid field cannot block independent valid edits',async()=>{
  const f=fixture();f.save.edit('sourcePaths','relative/path');f.save.edit('settingsAvatar','XY');
  const done=f.save.flush();assert.deepEqual(f.calls[0].patch,{avatar_initials:'XY'});f.calls[0].resolve();await done;
  assert.equal(f.save.snapshot().sourcePaths.status,'invalid');assert.deepEqual(f.save.drafts(),{sourcePaths:'relative/path'});
});
test('a newer edit survives an older in-flight response and requests are serialized',async()=>{
  const f=fixture();f.save.edit('settingsAvatar','A');const done=f.save.flush();f.save.edit('settingsAvatar','B');f.save.flush();
  assert.equal(f.calls.length,1);f.calls[0].resolve();await turn();assert.equal(f.calls[1].patch.avatar_initials,'B');
  assert.equal(f.save.snapshot().settingsAvatar.status,'saving');f.calls[1].resolve();await done;
  assert.equal(f.maximum,1);assert.equal(f.save.snapshot().settingsAvatar.value,'B');
});
test('failure retains the draft without a retry loop, explicit retry saves once',async()=>{
  const f=fixture();f.save.edit('settingsAvatar','A');const first=f.save.flush();f.calls[0].reject();await first;
  assert.equal(f.save.snapshot().settingsAvatar.status,'error');await f.save.flush();assert.equal(f.calls.length,1);
  const second=f.save.retry('settingsAvatar');assert.equal(f.calls.length,2);f.calls[1].resolve();await second;assert.equal(f.save.hasUnsaved(),false);
});
test('a failed older save cannot roll back a newer edit',async()=>{
  const f=fixture();f.save.edit('settingsAvatar','A');const done=f.save.flush();f.save.edit('settingsAvatar','B');f.calls[0].reject();await turn();
  assert.equal(f.calls[1].patch.avatar_initials,'B');f.calls[1].resolve();await done;assert.equal(f.save.snapshot().settingsAvatar.status,'saved');
});
test('a newer invalid value survives completion of the previous valid save',async()=>{
  const f=fixture();f.save.edit('settingsAvatar','A');const done=f.save.flush();f.save.edit('settingsAvatar','!');f.calls[0].resolve();await done;
  assert.equal(f.save.snapshot().settingsAvatar.status,'invalid');assert.equal(f.save.drafts().settingsAvatar,'!');f.save.discard('settingsAvatar');assert.equal(f.save.hasUnsaved(),false);
});
test('validation covers paths, deduplication, leap days and system timezones',()=>{
  assert.deepEqual(validateField('sourcePaths','C:\\logs\nC:\\logs\n/server/logs').patch.sources,['C:\\logs','/server/logs']);
  assert.ok(validateField('sourcePaths','').error);assert.ok(validateField('sourcePaths',Array(21).fill('/logs').join('\n')).error);
  assert.ok(validateField('settingsUsageSince','2026-02-29').error);assert.equal(validateField('settingsUsageSince','2024-02-29').patch.usage_since,'2024-02-29');
  assert.deepEqual(validateField('settingsTimezone','system','Asia/Shanghai').patch,{timezone_mode:'system',timezone:'Asia/Shanghai'});assert.ok(validateField('settingsTimezone','bad/zone').error);
});
test('ten thousand sequential saves keep only the latest field state and release timers',async()=>{
  const save=createAutosave({persist:async()=>{},schedule:()=>0,cancel:()=>{}});
  for(let i=0;i<10000;i++){save.edit('settingsAvatar',String(i%1000));await save.flush();}
  assert.equal(Object.keys(save.snapshot()).length,1);assert.equal(save.hasUnsaved(),false);save.dispose();
});
test('source status distinguishes fresh, late, retained failure, busy and paused',()=>{
  const now=Date.parse('2026-10-24T00:00:00Z'),at=new Date(now-60000).toISOString();
  assert.equal(sourceState({at,interval:30},now).state,'ready');assert.equal(sourceState({at,interval:30},now+120000).state,'stale');
  const failed=sourceState({at,error:'offline'},now);assert.equal(failed.state,'error');assert.equal(failed.retained,true);
  assert.equal(sourceState({at,busy:true},now).state,'busy');assert.equal(sourceState({at,paused:true},now).state,'paused');assert.equal(sourceState({},now).state,'waiting');
});
test('signed-out quota is neutral and failed sources do not change other source timestamps',()=>{
  const now=Date.now(),at=new Date(now-1000).toISOString();
  const rows=dataRows({local:{last_scan:at,running:true},remotes:[{id:'a',enabled:true,synced_at:at,error:'SSH offline'}],prices:{last_success:now/1000,unresolved:['unknown']}},{signed_out:true,problem:{kind:'signed_out',message:'out'}},{now});
  assert.equal(rows[0].state,'ready');assert.equal(rows[1].state,'error');assert.equal(rows[2].state,'idle');assert.equal(rows[2].action,'login');assert.equal(rows[3].state,'partial');
});
