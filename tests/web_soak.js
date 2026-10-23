'use strict';
// Exercises shipped UI modules against synthetic state; there are no fetch calls.
const $=id=>document.getElementById(id),esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let settings={avatar_initials:'CU',timezone:'UTC',sources:['/logs']};
let statusReading=false,statusError='',statusChecked=null,reportError='',appearanceSaveError='',dataSnapshot={},accountData={signed_out:true};
let failSave=true,saveCount=0;
function roundedIcon(){return '<svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';}
async function persistSettingsPatch(patch){saveCount++;if(failSave)throw new Error('Simulated offline');Object.assign(settings,patch);}
function renderAccount(){}
function api(url){return Promise.resolve(url==='/api/settings'?{...settings}:dataSnapshot);}
function load(){reportError='Simulated read failure';paintDataStatus();return Promise.resolve(false);}
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
const assert=(value,message)=>{if(!value)throw new Error(message);};
window.addEventListener('error',event=>{$('results').textContent+='\nERROR: '+event.message;});
window.addEventListener('unhandledrejection',event=>{$('results').textContent+='\nERROR: '+event.reason;});
$('runChecks').addEventListener('click',async()=>{
  $('runChecks').disabled=true;const started=performance.now(),checks=[];
  try{
    paintSaveFeedback();
    const avatar=$('settingsAvatar');avatar.value='AB';avatar.dispatchEvent(new Event('input',{bubbles:true}));await flushSettingsEdits();
    assert($('settingsAvatarSaveStatus').textContent.includes('保存未确认'),'failed save must be visible');assert(avatar.value==='AB','failed draft lost');
    failSave=false;$('settingsAvatarSaveStatus').querySelector('[data-retry-setting]').click();await flushSettingsEdits();
    assert($('settingsAvatarSaveStatus').textContent.includes('已保存'),'retry did not show saved');assert(settings.avatar_initials==='AB'&&saveCount===2,'retry count or saved value incorrect');checks.push('Save failure, draft retention and explicit retry: PASS');
    await load();assert($('settingsAvatarSaveStatus').textContent.includes('已保存'),'read failure changed saved state');assert($('dataUpdatePanel').textContent.includes('已保存的设置仍然有效'),'read failure lacked separate feedback');reportError='';checks.push('Saved settings remain saved after a read failure: PASS');
    avatar.value='!';avatar.dispatchEvent(new Event('input',{bubbles:true}));$('settingsAvatarSaveStatus').querySelector('[data-discard-setting]').click();await next();assert(avatar.value==='AB','restore did not use committed value');checks.push('Restore saved value after invalid input: PASS');
    const host=$('selectHost');
    host.innerHTML='<label>Large options <select id="manyOptions" aria-label="Large options">'+Array.from({length:10000},(_,i)=>'<option value="'+i+'">Option '+i+'</option>').join('')+'</select></label>';
    await next();host.querySelector('.select-trigger').click();await next();
    assert(document.querySelectorAll('#sharedSelectMenu [role=option]').length===100,'unbounded options');
    const search=document.querySelector('.select-search');search.value='Option 9999';search.dispatchEvent(new Event('input',{bubbles:true}));
    assert(document.querySelectorAll('#sharedSelectMenu [role=option]').length===1,'option search failed');document.querySelector('#sharedSelectMenu [role=option]').click();
    assert($('manyOptions').value==='9999','last option unreachable');await next();assert(!$('sharedSelectMenu').children.length,'closed menu retained options');checks.push('10,000 options: bounded menu, search and selection: PASS');
    const markup=i=>'<div class="probe"><select id="probeSelect" aria-label="Probe"><option value="a">A</option><option value="b" '+(i%2?'selected':'')+'>B</option></select><span>'+i+'</span><input id="draft" value="initial"></div>';
    host.innerHTML=markup(0);await next();const select=$('probeSelect'),trigger=host.querySelector('.select-trigger');
    const baseline=document.querySelectorAll('*').length;
    for(let i=1;i<=1000;i++){
      QuotaDOM.patch(host,markup(i),node=>node.id==='draft');
      if(i===1){$('draft').value='unsaved';$('draft').focus();}
      $('clockTick').textContent=String(i);await next();
      assert($('probeSelect')===select,'select recreated during update');assert(host.querySelector('.select-trigger')===trigger,'trigger recreated during update');
      assert($('draft').value==='unsaved'&&document.activeElement===$('draft'),'input/focus lost');
      if(i%100===0){host.querySelector('.select-trigger').click();await next();$('sharedSelectMenu').hidePopover();await next();$('draft').focus();}
    }
    assert(document.querySelectorAll('.select-trigger').length===1,'duplicate triggers');assert(document.querySelectorAll('*').length<=baseline+1,'DOM growth');
    checks.push('1,000 incremental updates: stable controls, focus, drafts and DOM size: PASS');
    for(let i=0;i<200;i++){host.innerHTML=markup(i);await next();assert(host.querySelectorAll('.select-trigger').length===1,'route remount duplicated trigger');}
    host.querySelector('.select-trigger').click();await next();host.replaceChildren();await next();
    assert(!document.querySelector('.select-trigger'),'detached trigger retained');assert(!$('sharedSelectMenu').matches(':popover-open')&&!$('sharedSelectMenu').children.length,'detached popup retained');checks.push('200 page remounts and detached popup cleanup: PASS');
    $('results').textContent=checks.join('\n')+'\nElapsed: '+Math.round(performance.now()-started)+' ms\nALL PASS';
  }catch(error){$('results').textContent=checks.join('\n')+'\nFAIL: '+error.stack;}
  finally{$('runChecks').disabled=false;}
});
