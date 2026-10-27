'use strict';
(function(root){
  const labels={tracking:'额度持续追踪中',signed_out:'等待账号连接',connecting:'正在连接',waiting:'等待首次额度',error:'额度读取失败，自动重试',stale:'额度等待更新',paused:'额度采集已暂停',history_error:'额度已读取，历史保存异常',offline:'后台连接中断'};
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function time(value){if(!value)return '—';const d=new Date(typeof value==='number'?value*1000:value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d):'—';}
  function messageMarkup(alerts){return alerts.slice(0,50).map(a=>'<article class="companion-message"><div><p>'+escape(a.message)+'</p><small>'+time(a.at)+(a.active?'':' · 历史提醒')+'</small></div><button class="text-button" data-action="acknowledge" data-value="'+escape(a.id)+'">已读</button></article>').join('')||'<p class="companion-empty">暂时没有未读提醒。</p>';}
  function canOpen(s,dirty){return !!(s.connected&&s.dashboard_ready&&(!dirty||['tracking','paused','history_error'].includes(s.state)));}
  function tracking(s){
    if(!s.connected)return ['正在连接后台','后台与看板服务启动后会自动连接'];
    const collector=s.account?.usage_collector||{};
    const logs=s.logs?.valid,quota=s.state==='tracking';
    if(logs&&collector.running&&!collector.problem)return [quota?'日志与额度持续追踪中':'日志持续获取中',quota?'用量与额度历史自动更新':'无需登录即可查看本地用量'];
    if(quota)return ['额度持续追踪中','已连接账号，额度历史自动更新'];
    if(logs&&collector.problem)return ['日志获取异常','后台将自动重试，已有记录保留'];
    if(logs)return ['日志已就绪',collector.running?'等待首次读取':'日志采集未运行'];
    return [labels[s.state]||'等待配置','选择正确日志目录，或通过浏览器连接账号'];
  }
  function indicators(s,now=Date.now()){
    const a=s.account||{},c=a.usage_collector||{};
    function fresh(at,interval){const age=now-new Date(at).getTime();return !!at&&Number.isFinite(age)&&age>=-60000&&age<=Math.max(120,2*(interval||60))*1000;}
    return {logs:!!(s.connected&&s.logs?.valid&&c.running&&!c.problem&&fresh(c.last_scan,c.scan_interval_seconds)),quota:!!(s.connected&&s.state==='tracking'&&fresh(a.fetched_at,a.collector?.interval_seconds))};
  }
  root.CompanionView={labels,messageMarkup,canOpen,tracking,indicators};
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id);
  let last={},busy=false,timer,logTimer,reportTimer,ready=false,stopped=false,dirty=false,revision=0;
  function setHTML(id,html){if($(id).innerHTML!==html)$(id).innerHTML=html;}
  function text(id,value){$(id).textContent=value;$(id).title=value;}
  function render(s){
    last=s;const a=s.account||{},logs=s.logs||{},prefs=s.preferences||{},login=a.browser_login||{},collector=a.usage_collector||{};
    text('trackingTitle',tracking(s)[0]);
    const lamps=indicators(s);
    for(const [kind,active,at,reason] of [['log',lamps.logs&&!dirty,collector.last_scan,dirty?'正在验证目录':collector.problem||logs.message],['quota',lamps.quota,a.fetched_at,a.history_problem||a.problem?.message||labels[s.state]]]){
      const label=kind==='log'?'日志':'额度';
      const hint=label+' · '+(active?'持续追踪中':'未连接或暂无更新')+'\n最近获取：'+(at?time(at):'尚无成功记录')+(!active&&reason?'\n'+reason:'');
      $(kind+'Dot').classList.toggle('active',active);
      $(kind+'Indicator').title=hint;$(kind+'Indicator').setAttribute('aria-label',hint);
      text(kind+'Tooltip',hint);
    }
    text('version','v'+(s.version||''));
    const logHint=dirty?'正在验证目录':logs.valid?'已找到有效日志':logs.message||'尚未找到有效日志';
    $('logState').title=logHint;$('logState').setAttribute('aria-label',logHint);
    $('logState').classList.toggle('valid',!!logs.valid&&!dirty);
    setHTML('logState','<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/>'+(!dirty&&logs.valid?'<path d="m7.5 12 3 3 6-6"/>':'<path d="M12 7v6m0 3h.01"/>')+'</svg>');
    if(!dirty&&document.activeElement!==$('logPath'))$('logPath').value=logs.path||'';
    const accountReady=['tracking','paused','history_error'].includes(s.state);
    text('accountLabel',accountReady?(a.profile?.label||a.account?.label||'账号已连接'):(labels[s.state]||'尚未连接'));
    const loginMessages={starting:'正在准备官方登录页面…',waiting:'请在浏览器完成登录，随后自动获取额度',failed:'登录未完成，请重试',expired:'登录已超时，请重试',cancelled:'已取消登录',success:'登录完成，正在获取额度'};
    $('accountLabel').title=s.login_error||loginMessages[login.status]||a.problem?.message||$('accountLabel').textContent;
    $('loginButton').textContent=login.status==='waiting'?'继续登录':login.status==='starting'?'准备中…':accountReady?'切换账号':'浏览器登录';
    $('loginButton').title=accountReady?'通过官方页面切换，会更新本机 Codex 登录账号':'通过官方浏览器页面登录';
    $('loginButton').disabled=busy||!s.connected||login.status==='starting';
    $('cancelLogin').hidden=!['starting','waiting'].includes(login.status);
    $('refreshButton').disabled=busy||!s.connected;
    document.querySelectorAll('.icon-button[data-action]').forEach(b=>b.disabled=busy||!s.connected);
    const allowed=canOpen(s,dirty);
    $('dashboardButton').disabled=busy||!allowed;
    $('dashboardGate').dataset.blocked=String(!allowed);
    $('dashboardGate').title=allowed?'在默认浏览器打开完整用量看板':'需要正确日志目录或者登陆';
    const unread=(a.alerts||[]).filter(a=>!a.acknowledged);
    $('messageCount').textContent=unread.length>99?'99+':String(unread.length);$('messageCount').hidden=unread.length===0;$('messagesButton').setAttribute('aria-label','消息中心，'+unread.length+' 条未读');setHTML('messages',messageMarkup(unread));
    $('notifications').checked=prefs.notifications!==false;$('notifications').disabled=busy||!s.tray_available;
    $('testNotification').disabled=busy||!s.tray_available||prefs.notifications===false;
    const notice=s.notification_error||(!s.tray_available?'托盘不可用，请在这里查看提醒':'');
    text('notificationError',notice);$('notificationError').hidden=!notice;
    text('lifecycle',s.tray_available?'关闭窗口后收进托盘，后台继续运行':'请最小化保持运行；关闭窗口会退出');
    text('quitDescription',s.owned?'退出后将停止日志与额度追踪、消息提醒，以及本助手启动的看板服务。关闭窗口收进托盘即可继续追踪。':'退出后，助手将停止追踪和消息提醒。当前连接的独立后台服务仍会继续采集。关闭窗口收进托盘可继续使用助手。');
    document.body.classList.toggle('dark',window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function report(value){clearTimeout(reportTimer);$('actionStatus').textContent=value;if(value)reportTimer=setTimeout(()=>{$('actionStatus').textContent='';},6000);}
  async function poll(){
    clearTimeout(timer);if(stopped||!ready)return;
    try{render(await window.pywebview.api.status());}catch(_){render({...last,state:'offline',connected:false});}
    if(!stopped)timer=setTimeout(poll,1500);
  }
  function saveLogs(){clearTimeout(logTimer);if(!dirty||stopped)return;if(busy||!ready){logTimer=setTimeout(saveLogs,300);return;}action('logs',$('logPath').value);}
  async function action(name,value){
    if(busy||!ready)return;
    const sentRevision=revision;busy=true;render(last);report('');
    try{
      const result=await window.pywebview.api.action(name,value);
      if(name==='logs'&&result.retryable)return;
      if(['logs','browse_logs','detect_logs'].includes(name)&&revision===sentRevision)dirty=false;
      if(!result.ok)report(result.error||'操作未完成，请重试。');
      else if(['logs','browse_logs','detect_logs'].includes(name))report('目录检测完成');
      else if(name==='test_notification')report('测试提醒已发送');
    }catch(_){report('助手暂时没有响应，请稍后重试。');}
    finally{busy=false;await poll();if(dirty)logTimer=setTimeout(saveLogs,700);}
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)action(b.dataset.action,b.dataset.value);});
  $('logPath').addEventListener('input',()=>{dirty=true;revision++;clearTimeout(logTimer);render(last);logTimer=setTimeout(saveLogs,700);});
  $('logPath').addEventListener('blur',()=>{clearTimeout(logTimer);logTimer=setTimeout(saveLogs,150);});
  $('logPath').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveLogs();}});
  $('notifications').addEventListener('change',e=>action('notifications',e.target.checked));
  $('messagesButton').addEventListener('click',()=>$('messagesDialog').showModal());$('closeMessages').addEventListener('click',()=>$('messagesDialog').close());
  $('quitButton').addEventListener('click',()=>$('quitDialog').showModal());$('cancelQuit').addEventListener('click',()=>$('quitDialog').close());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>render(last));
  function start(){if(ready)return;ready=true;poll();}
  window.addEventListener('pywebviewready',start);if(window.pywebview?.api)start();
  window.addEventListener('beforeunload',()=>{stopped=true;clearTimeout(timer);clearTimeout(logTimer);clearTimeout(reportTimer);});
})(typeof globalThis==='undefined'?this:globalThis);
