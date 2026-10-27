'use strict';

const autoSettingsFields=['sourcePaths','settingsTimezone','settingsUsageSince','settingsAvatar'];
const settingsAutosave=WebState.createAutosave({
  persist:async patch=>{
    await persistSettingsPatch(patch);
    // Saving and refreshing have separate outcomes. Never retry an already saved edit.
    setTimeout(()=>{renderAccount();if(Object.keys(patch).some(key=>key!=='avatar_initials'))load(true);refreshDataStatus();},0);
  },
  changed:()=>paintSaveFeedback()
});
function queueSettingsEdit(event){
  if(!autoSettingsFields.includes(event.target.id))return;
  const value=event.target.validity?.badInput?'invalid':event.target.value;
  const previous=settingsAutosave.snapshot()[event.target.id];
  if(!previous || previous.value!==value)settingsAutosave.edit(event.target.id,value);
  if(event.type==='change')settingsAutosave.flush();
}
function flushSettingsEdits(){return settingsAutosave.flush();}
function paintAppearanceSave(){
  const panel=document.querySelector?.('.appearance-panel');if(!panel)return;
  let note=$('appearanceSaveStatus');
  if(!note){note=document.createElement('div');note.id='appearanceSaveStatus';note.className='settings-save-summary';note.setAttribute('role','status');panel.querySelector('.panel-head').after(note);}
  const html=appearanceSaveError?`${esc(appearanceSaveError)} <button class="text-button" data-retry-appearance>重试保存</button>`:'外观修改自动保存在此浏览器。';
  if(note.innerHTML!==html)note.innerHTML=html;
  note.classList.toggle('save-error',Boolean(appearanceSaveError));
}
function paintSaveFeedback(){
  if(!document.querySelector)return;
  const fields=settingsAutosave.snapshot();
  for(const id of autoSettingsFields){
    const input=$(id);if(!input)continue;
    const row=fields[id],parent=input.closest('.field,.appearance-row');if(!parent)continue;
    let note=$(id+'SaveStatus');
    if(!note){note=document.createElement('div');note.id=id+'SaveStatus';note.className='field-save-status';note.setAttribute('role','status');note.setAttribute('aria-live','polite');parent.append(note);}
    const status=row?.status||'idle',invalid=['invalid','error'].includes(status);
    input.setAttribute('aria-invalid',String(status==='invalid'));input.setAttribute('aria-describedby',note.id);
    const trigger=input.nextElementSibling?.matches('.select-trigger')?input.nextElementSibling:null;
    trigger?.setAttribute('aria-describedby',note.id);trigger?.setAttribute('aria-invalid',String(status==='invalid'));
    note.dataset.status=status;note.hidden=status==='idle';
    if(status==='idle'){note.replaceChildren();input.removeAttribute('aria-describedby');trigger?.removeAttribute('aria-describedby');continue;}
    const label={pending:'等待保存…',saving:'正在保存…',saved:'已保存',invalid:'尚未保存',error:'保存未确认'}[status];
    const html=`<span class="save-indicator" aria-hidden="true">${status==='saved'?roundedIcon('check'):invalid?'!':'•'}</span><span>${label}${row?.error?' · '+esc(row.error):''}</span>${status==='error'?`<button type="button" class="text-button" data-retry-setting="${id}">重试保存</button>`:''}${invalid?`<button type="button" class="text-button" data-discard-setting="${id}">恢复已保存值</button>`:''}`;
    if(note.innerHTML!==html)note.innerHTML=html;
  }
  paintAppearanceSave();
}
document.addEventListener('input',queueSettingsEdit);
document.addEventListener('change',queueSettingsEdit);
window.addEventListener('beforeunload',event=>{if(settingsAutosave.hasUnsaved()){event.preventDefault();event.returnValue='';}});
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.retrySetting)settingsAutosave.retry(button.dataset.retrySetting);
  if(button.dataset.discardSetting){
    const id=button.dataset.discardSetting,revision=settingsAutosave.snapshot()[id]?.revision;
    button.disabled=true;
    try{
      // A lost response may hide a committed save. Read the server before restoring.
      await settingsAutosave.flush();
      const saved=await api('/api/settings');
      if(settingsAutosave.snapshot()[id]?.revision!==revision)return;
      settings={...settings,...saved};
      const values={sourcePaths:settings.sources.join('\n'),settingsTimezone:settings.timezone_mode==='system'?'system':settings.timezone,settingsUsageSince:settings.usage_since,settingsAvatar:settings.avatar_initials};
      settingsAutosave.discard(id);
      if($(id)){$(id).value=values[id];if($(id).tagName==='SELECT')$(id).dispatchEvent(new Event('change',{bubbles:false}));}
    }catch(_){notify('无法读取已保存值，请稍后重试。');}
    finally{button.disabled=false;}
  }
  if(button.hasAttribute('data-retry-appearance'))saveAppearance();
});

function statusTime(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:settings?.timezone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'暂无成功记录';}
function paintDataStatus(){
  if(!document.querySelector)return;
  const rows=WebState.dataRows(dataSnapshot||{},accountData||{});
  const attention=rows.filter(row=>['error','stale','partial'].includes(row.state)).length;
  let shortcut=$('dataStatusShortcut');
  if(!shortcut){const actions=document.querySelector('.top-actions');if(actions){shortcut=document.createElement('button');shortcut.id='dataStatusShortcut';shortcut.type='button';shortcut.className='data-status-shortcut';shortcut.dataset.updateAction='status';actions.prepend(shortcut);}}
  if(shortcut){
    const label=statusError?'状态连接中断':reportError?'页面更新失败':attention?'数据待处理':statusReading&&!dataSnapshot?'读取数据状态':'数据状态';
    shortcut.dataset.state=statusError||reportError||attention?'attention':'ready';
    const html=`<i aria-hidden="true"></i><span>${label}${attention?' · '+attention:''}</span>`;
    if(shortcut.innerHTML!==html)shortcut.innerHTML=html;
    shortcut.setAttribute('aria-label',label+'，查看各项更新时间');
  }
  const group=document.querySelector('.coverage-settings-group');if(!group)return;
  let panel=$('dataUpdatePanel');
  if(!panel){panel=document.createElement('section');panel.className='panel data-update-panel';panel.id='dataUpdatePanel';group.prepend(panel);}
  const actions={local:'刷新日志',remote:'重新同步','remote-settings':'管理服务器',account:'刷新额度',login:'浏览器登录',prices:'查看价格'};
  const body=`<div class="panel-head"><div><h2>数据更新状态</h2><p>各来源独立更新，时间均按统计时区显示。</p></div><button class="button small" data-update-action="refresh-status" ${statusReading?'disabled':''}>${statusReading?'读取中…':'刷新状态'}</button></div><div class="data-status-content">${statusError?`<div class="status-callout" role="status"><strong>无法读取最新状态</strong><p>${esc(statusError)}${statusChecked?' · 上次检查 '+statusTime(statusChecked):''}。恢复连接前保留上次状态。</p></div>`:''}${reportError?`<div class="status-callout" role="status"><strong>页面数据未更新</strong><p>${esc(reportError)}。当前保留上次结果，已保存的设置仍然有效。</p><button class="text-button" data-update-action="local">重新读取数据</button></div>`:''}<div class="data-status-list">${rows.map(row=>`<div class="data-source-status" data-source-status="${esc(row.id)}"><div class="source-status-main"><strong>${esc(row.name)}</strong><span class="source-state" data-state="${row.state}"><i aria-hidden="true"></i>${row.label}${row.state==='ready'&&row.last?`：<time datetime="${new Date(row.last).toISOString()}">${statusTime(row.last)}</time>`:''}</span>${row.state!=='ready'?`<small>${row.last?'上次成功更新 '+statusTime(row.last):row.fallback||(!['idle','paused'].includes(row.state)?'暂无成功记录':'')}${row.retained?' · 保留上次数据':''}${row.checked?' · 上次检查 '+statusTime(row.checked):''}</small>`:''}${row.error||['stale','partial'].includes(row.state)?`<p class="source-status-detail">${row.error?esc(row.error)+' · ':''}${esc(row.guidance||'')}</p>`:''}</div><button type="button" class="text-button" data-update-action="${row.action}" ${row.state==='busy'?'disabled':''}>${actions[row.action]}</button></div>`).join('')}</div></div>`;
  QuotaDOM.patch(panel,body);
}
async function refreshDataStatus(){
  if(statusReading||!settings)return;
  statusReading=true;paintDataStatus();
  try{dataSnapshot=await api('/api/status');statusError='';statusChecked=Date.now();}
  catch(error){statusError=error.message;}
  finally{statusReading=false;paintDataStatus();}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-update-action]');if(!button)return;
  const action=button.dataset.updateAction;
  if(action==='status'){settingsSection='coverage';setView('settings');selectSettingsSection('coverage');$('dataUpdatePanel')?.scrollIntoView({block:'start'});refreshDataStatus();return;}
  if(action==='remote-settings'){selectSettingsSection('data');$('remoteForm')?.scrollIntoView({block:'center'});$('remoteForm')?.querySelector('input')?.focus();return;}
  if(action==='prices'){setView('pricing');return;}
  if(action==='login'){beginBrowserLogin();return;}
  button.disabled=true;
  try{
    if(action==='local')await load(true);
    if(action==='account')await refreshAccount(true);
    if(action==='remote'){await api('/api/remotes/sync',{method:'POST',headers:{'X-CSRF-Token':settings.csrf}});await pollRemotes();}
    await refreshDataStatus();
  }catch(error){statusError=error.message;paintDataStatus();}
  finally{button.disabled=false;}
});
setInterval(()=>{if(!document.hidden)refreshDataStatus();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDataStatus();});
