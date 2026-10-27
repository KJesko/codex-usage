'use strict';
(function(root){
  const labels={tracking:['正在稳定追踪','后台持续采集额度，历史记录正常保存。'],signed_out:['等待账号连接','通过官方浏览器页面登录，完成后自动开始追踪。'],connecting:['正在连接后台','正在确认采集服务和最近一次成功记录。'],waiting:['等待首次额度','后台已连接，尚未取得成功记录；可以登录或刷新重试。'],error:['额度读取遇到问题','后台会自动重试。已有记录保留，不会把旧数据当作新数据。'],stale:['额度等待更新','最近记录已过期，正在等待下一次成功采集。'],paused:['采集已暂停','账号曾成功读取，但采集任务当前未运行。'],history_error:['额度可用，历史未保存','请检查数据目录或磁盘空间；实时额度仍可查看。'],offline:['后台暂时无法连接','正在自动重试。请确认后台服务仍在运行。']};
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function percent(value){return typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value)):null;}
  function time(value){if(!value)return '—';const d=new Date(typeof value==='number'?value*1000:value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d):'—';}
  function quotaMarkup(account,retained){return (account.windows||[]).slice(0,12).map(w=>{const p=percent(w.remaining_percent);return `<article class="companion-quota"><header><h3>${escape(w.label||'账号额度')}</h3><strong>${p===null?'—':Math.round(p)}<small>${p===null?'':'%'}</small></strong></header><div class="quota-track" role="meter" aria-label="${escape(w.label||'额度')}剩余" ${p===null?'aria-valuetext="未知"':`aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"`}><span style="width:${p??0}%"></span></div><p>${retained?'上次记录 · ':''}${w.resets_at?'重置于 '+time(w.resets_at):'重置时间暂不可用'}</p></article>`;}).join('')||'<p class="companion-empty">成功获取额度后，将在这里显示剩余额度和重置时间。</p>';}
  function messageMarkup(alerts){return alerts.slice(0,50).map(a=>`<article class="companion-message"><div><p>${escape(a.message)}</p><small>${time(a.at)}${a.active?'':' · 历史提醒'}</small></div><button class="text-button" data-action="acknowledge" data-value="${escape(a.id)}">已读</button></article>`).join('')||'<p class="companion-empty">暂时没有未读提醒，安心使用。</p>';}
  root.CompanionView={labels,quotaMarkup,messageMarkup,percent};
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id);
  let last={},busy=false,timer,ready=false,stopped=false;
  const icon=ok=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>${ok?'<path d="m7.5 12 3 3 6-6"/>':'<path d="M12 7v6m0 3h.01"/>'}</svg>`;
  function setHTML(id,html){if($(id).innerHTML!==html)$(id).innerHTML=html;}
  function theme(mode){document.body.classList.toggle('dark',mode==='dark'||mode==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.querySelectorAll('[data-action="theme"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===mode)));}
  function render(s){
    last=s; const account=s.account||{},prefs=s.preferences||{},state=s.state||'connecting',login=account.browser_login||{};
    const [title,detail]=labels[state]||labels.error;
    $('trackingTitle').textContent=title;$('trackingDetail').textContent=state==='offline'?detail:account.history_problem||account.problem?.message||detail;
    setHTML('trackingIcon',icon(state==='tracking'));
    $('serviceState').textContent=s.connected?(s.owned?'助手托管后台 · 运行中':'已连接现有后台'):'正在重新连接后台';
    $('lastUpdated').textContent=account.fetched_at?'上次成功：'+time(account.fetched_at)+'（本机时间）':'等待首次成功采集';
    $('accountLabel').textContent=[account.profile?.label||account.account?.label||'尚未连接账号',account.account?.plan].filter(Boolean).join(' · ');
    $('loginButton').textContent=login.status==='starting'?'准备登录…':login.status==='waiting'?'继续浏览器登录':account.fetched_at?'切换账号':'浏览器登录';
    $('loginButton').disabled=busy||!s.connected||login.status==='starting';
    $('refreshButton').disabled=busy||!s.connected||account.busy;
    $('refreshButton').textContent=account.busy?'正在读取…':'刷新状态';
    $('loginHelp').textContent=account.fetched_at?'切换账号会更新本机 Codex 登录，其他本机客户端也会受影响。':'通过官方浏览器页面登录，完成后自动追踪额度。';
    const loginMessages={starting:'正在准备官方登录页面…',waiting:'请在默认浏览器完成官方登录；完成后自动获取额度。',success:'官方登录已完成，正在按新账号更新额度。',failed:'登录未完成，请重新发起浏览器登录。',expired:'本次登录已超时，请重试。',cancelled:'已取消本次登录，原有账号不受影响。'};
    const loginText=s.login_error||(login.status==='success'&&state==='tracking'?'账号已连接，额度正在自动追踪。':loginMessages[login.status])||'';
    $('loginProgress').hidden=!loginText;$('loginMessage').textContent=loginText;
    $('cancelLogin').hidden=!['starting','waiting'].includes(login.status);
    setHTML('quotaWindows',quotaMarkup(account,state!=='tracking'&&state!=='history_error'));
    const unread=(account.alerts||[]).filter(a=>!a.acknowledged);
    $('messageCount').textContent=String(unread.length);setHTML('messages',messageMarkup(unread));
    $('notifications').checked=prefs.notifications!==false;$('notifications').disabled=busy||!s.tray_available;
    $('testNotification').disabled=busy||!s.tray_available||prefs.notifications===false;
    $('notificationHint').textContent=s.notification_error||(!s.tray_available?'托盘不可用，消息仍会显示在这里。':'系统勿扰模式可能隐藏通知，消息中心仍会保留额度提醒。');
    $('hideButton').hidden=!s.tray_available;
    $('lifecycle').textContent=s.tray_available?'关闭窗口后收进托盘，后台继续追踪。':'请最小化窗口以继续追踪；关闭窗口会退出助手。';
    $('quitDescription').textContent=s.owned?'退出后，本助手启动的后台将停止采集。收进托盘可以继续追踪。':'助手将退出，已经运行的独立后台服务会继续采集。';
    $('version').textContent='Codex Usage '+(s.version||'');theme(prefs.theme||'system');
  }
  function report(text){$('actionStatus').hidden=!text;$('actionStatus').textContent=text;}
  async function poll(){
    clearTimeout(timer);
    if(stopped||!ready)return;
    try{render(await window.pywebview.api.status());}catch(_){render({...last,state:'offline',connected:false});}
    if(!stopped)timer=setTimeout(poll,1500);
  }
  async function action(name,value){
    if(busy||!ready)return;busy=true;render(last);report('');
    try{const result=await window.pywebview.api.action(name,value);if(!result.ok)report(result.error||'操作未完成，请重试。');else if(name==='test_notification')report('测试提醒已发送，请查看系统通知。');}
    catch(_){report('助手暂时没有响应，请稍后重试。');}
    finally{busy=false;await poll();}
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)action(b.dataset.action,b.dataset.value);});
  $('notifications').addEventListener('change',e=>action('notifications',e.target.checked));
  $('quitButton').addEventListener('click',()=>$('quitDialog').showModal());$('cancelQuit').addEventListener('click',()=>$('quitDialog').close());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>theme(last.preferences?.theme||'system'));
  function start(){if(ready)return;ready=true;poll();}
  window.addEventListener('pywebviewready',start);if(window.pywebview?.api)start();
  window.addEventListener('beforeunload',()=>{stopped=true;clearTimeout(timer);});
})(typeof globalThis==='undefined'?this:globalThis);
