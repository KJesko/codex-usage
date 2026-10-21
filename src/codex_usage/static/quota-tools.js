'use strict';

const QuotaTools=(()=>{
  let historical=null,historyPending=false,historyError='',historyController=null,scope=null;
  let rangeVersion=null,lastQuota=null;
  const storageKey='codex-usage-notifications',seenKey='codex-usage-notified';
  const time=value=>accountTime(typeof value==='number'?value*1000:value);
  function display(q) {
    const changed=scope!==q?.history_scope;
    scope=q?.history_scope;
    lastQuota=q;
    const available=Boolean(scope && q?.history_available);
    if(changed || !available) {
      historyController?.abort();historical=null;historyPending=false;historyError='';rangeVersion=null;
    }
    if(available && rangeVersion!==q.fetched_at && !historyPending){
      rangeVersion=q.fetched_at;historyPending=true;const owner=scope;
      Promise.resolve().then(()=>{if(scope===owner && lastQuota?.history_available)loadRange(true);});
    }
    return {...(historical||{}),historical:true,history_scope:scope,custom_range:true,busy:historyPending&&!historical,
      history_problem:!available?'成功同步当前账号身份后，会自动显示已保存的范围记录。':q.history_problem,
      problem:historyError?{message:historyError}:null};
  }
  function dateBounds() {
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const before=days=>new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
    return {today,minimum:before(89),week:before(6)};
  }
  function rangeControls() { return ''; }
  function collectionMarkup(q,report) {
    const collector=q?.collector,logs=q?.usage_collector||report?.collector;
    const failed=q?.stale||q?.transportError||q?.history_problem||q?.alerts_problem||logs?.problem;
    return `<details class="collection-status"><summary><span class="status-dot ${failed?'is-stale':''}"></span>${collector?.running?'额度采集 · 每 '+(collector.interval_seconds||60)+' 秒':'额度采集未运行'}<span>额度 ${q?.fetched_at?time(q.fetched_at):'等待首次成功'}${failed?' · 需要关注':''}</span></summary><div class="collection-details"><p>本地服务运行时，关闭网页仍会采集；关机、休眠或退出服务时暂停。额度历史保留 90 天。</p><p>额度与重置卡：共用一次额度读取，默认每 ${collector?.interval_seconds||60} 秒请求；不额外轮询账号资料。手动刷新可提前请求，最短间隔 5 秒，同一时间只运行一个请求。</p><p>网页状态：可见时通常每 15 秒读取本地缓存，额度正在更新时每 1.2 秒检查一次；不代表再次向 Codex 请求额度。</p><p>图表自动调整显示精度，只读取已保存的历史记录；缩放、拖动和选择日期不会额外请求额度；有新额度记录后自动更新曲线。</p><p>社区预测：本页每 5 分钟按需检查 Codex Resets。Token 日志：每 ${logs?.scan_interval_seconds||30} 秒扫描本地文件，不是额度请求。</p><p>额度最近成功：${q?.fetched_at?time(q.fetched_at):'暂无'} · 连续失败 ${collector?.failures||0} 次</p><p>日志最近采集：${logs?.last_scan?time(logs.last_scan):'暂无'}${logs?.problem?' · '+esc(logs.problem):''}</p>${(report?.remotes||[]).map(r=>`<p>${esc(r.name)}：${!r.enabled?'已暂停':r.error?'同步失败，保留上次数据':r.busy?'同步中':'正常'}${r.synced_at?' · 最近成功 '+time(r.synced_at):''}</p>`).join('')}${[q?.history_problem,q?.alerts_problem,historyError].filter(Boolean).map(message=>`<p class="is-stale">${esc(message)}</p>`).join('')}</div></details>`;
  }
  async function loadRange(preserve=false) {
    historyController?.abort();if(!preserve)historical=null;historyError='';
    if(!lastQuota?.history_available || !scope){historyPending=false;renderQuotaPace();return;}
    historyPending=true;rangeVersion=lastQuota.fetched_at;
    if(!preserve)document.activeElement?.blur?.();
    const controller=new AbortController();historyController=controller;renderQuotaPace();
    try {
      const response=await api('/api/account/range?'+new URLSearchParams({since:dateBounds().minimum,until:dateBounds().today,grain:'auto'}),{signal:controller.signal});
      if(controller.signal.aborted)return;
      // Do not pad "all history" with months before the first observation.
      if(response.range && response.ticks?.length){
        let earliest=response.ticks.at(-8)?.at ?? response.range.since;
        for(const group of response.groups||[]){
          if(group.samples.length)earliest=Math.min(earliest,group.samples[0].at);
          for(const event of group.events)earliest=Math.min(earliest,event.at);
        }
        const first=response.ticks.filter(t=>t.at<=earliest).at(-1);
        if(first){response.range.since=first.at;response.range.since_date=first.date;response.ticks=response.ticks.filter(t=>t.at>=first.at);}
      }
      historical=response;
    } catch(e) { if(!controller.signal.aborted)historyError=e.message; }
    finally { if(!controller.signal.aborted){historyPending=false;renderQuotaPace();} }
  }
  function notificationEnabled() { try{return localStorage.getItem(storageKey)==='true';}catch(_){return false;} }
  function notifyDesktop(alerts) {
    if(!notificationEnabled() || typeof Notification==='undefined' || Notification.permission!=='granted')return;
    let seen;try{seen=JSON.parse(localStorage.getItem(seenKey)||'[]');if(!Array.isArray(seen))seen=[];}catch(_){seen=[];}
    for(const alert of alerts)if(alert.active&&!alert.acknowledged&&!seen.includes(alert.id)){
      seen.push(alert.id);try{localStorage.setItem(seenKey,JSON.stringify(seen.slice(-200)));new Notification('Codex Usage · 额度提醒',{body:alert.message,tag:alert.id});}catch(_){}
    }
  }
  function render(q) {
    const collection=document.querySelector('.settings-body>.collection-status');
    if(collection){
      const open=collection.open,focused=collection.contains(document.activeElement);
      const holder=document.createElement('div');holder.innerHTML=collectionMarkup(q,data);
      const next=holder.firstElementChild;next.open=open;collection.replaceWith(next);
      if(focused)next.querySelector('summary').focus({preventScroll:true});
    }
    const items=q?.alerts||[],active=items.filter(a=>a.active&&!a.acknowledged&&!q.stale&&!q.transportError);
    const unread=items.filter(a=>!a.acknowledged).length;
    const button=document.getElementById('alertsButton');
    button.textContent=unread?`提醒 ${unread}`:'提醒';button.classList.toggle('has-alerts',active.length>0);
    button.setAttribute('aria-label',`额度提醒，${unread} 条未读`);
    document.getElementById('quotaAlertBanner').innerHTML=active.length?`<div class="quota-alert-banner" role="status"><span>${esc(active[0].message)}${active.length>1?` 另有 ${active.length-1} 条提醒。`:''}</span><button class="text-button" popovertarget="alertsPopover">查看提醒</button><button class="text-button" data-ack-alert="${esc(active[0].id)}">知道了</button></div>`:'';
    const popup=document.getElementById('alertsPopover'),scroll=popup.scrollTop;
    popup.innerHTML=`<div class="filter-heading"><h2>额度提醒</h2><button class="icon-button" popovertarget="alertsPopover" popovertargetaction="hide" aria-label="关闭额度提醒">×</button></div><p class="alerts-intro">按账号和额度周期记录，同类提醒每个使用段只出现一次，重置后重新计算。</p>${items.map(a=>`<article class="alert-item"><p>${esc(a.message)}</p><div><span>${time(a.at)} · ${a.active?'当前提醒':'历史记录'}</span>${a.acknowledged?'<span>已读</span>':`<button class="text-button" data-ack-alert="${esc(a.id)}">标为已读</button>`}</div></article>`).join('')||'<p class="empty-alerts">暂无额度提醒</p>'}<button class="text-button" data-view="quota" popovertarget="alertsPopover" popovertargetaction="hide">设置提醒阈值 →</button>`;
    popup.scrollTop=scroll;position();notifyDesktop(active);
  }
  function settingsPanel() {
    const config=settings.quota_alerts||{enabled:true,remaining_percent:20,predictive:true};
    return `<section class="panel price-spacer"><div class="panel-head"><h2>额度提醒与后台采集</h2></div><div class="settings-body">${collectionMarkup(accountData,data)}<form id="quotaAlertForm" class="alert-settings"><label><input name="enabled" type="checkbox" ${config.enabled?'checked':''}>启用额度提醒</label><label>剩余额度低于或等于 <input name="remaining_percent" type="number" min="1" max="99" step="1" value="${config.remaining_percent}" required> % 时提醒</label><label><input name="predictive" type="checkbox" ${config.predictive?'checked':''}>预计在重置前耗尽时提醒</label><button class="button primary" type="submit">保存提醒设置</button></form><div class="notification-setting"><button class="button small" id="desktopNotifications">${notificationEnabled()?'关闭桌面通知':'启用桌面通知'}</button><p>网页内提醒和本机记录始终可查看。桌面通知需要浏览器允许，并保持网页打开；关闭网页后仍会采集和记录提醒。</p></div><p class="inset-note">后台采集随本地服务启动，无需保持网页打开；关机和休眠期间暂停采集。中断期间的额度不能补算，也不会记为零。</p></div></section>`;
  }
  function position() {
    const panel=document.getElementById('alertsPopover');if(!panel?.matches(':popover-open'))return;
    const viewportWidth=document.documentElement.clientWidth;
    panel.style.maxWidth=Math.max(0,viewportWidth-24)+'px';
    const rect=document.getElementById('alertsButton').getBoundingClientRect();
    panel.style.left=Math.max(12,Math.min(rect.right-panel.offsetWidth,viewportWidth-panel.offsetWidth-12))+'px';
    panel.style.top=Math.max(12,Math.min(rect.bottom+8,window.innerHeight-panel.offsetHeight-12))+'px';
  }
  if(typeof document!=='undefined'){
    document.addEventListener('submit',async e=>{
      if(e.target.id!=='quotaAlertForm')return;e.preventDefault();
      const form=new FormData(e.target);
      try{await saveSettings({...settings,quota_alerts:{enabled:form.has('enabled'),remaining_percent:Number(form.get('remaining_percent')),predictive:form.has('predictive')}});await refreshAccount(true);notify('提醒设置已保存');}catch(error){failure(error.message);}
    });
    document.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.ackAlert){
        b.disabled=true;
        try{accountData=await api('/api/account/acknowledge?'+new URLSearchParams({id:b.dataset.ackAlert}),{method:'POST',headers:{'X-CSRF-Token':settings.csrf}});renderAccount();}catch(error){b.disabled=false;notify('提醒暂未保存，请重试');}
      }
      if(b.id==='desktopNotifications'){
        if(notificationEnabled()){try{localStorage.setItem(storageKey,'false');}catch(_){}b.textContent='启用桌面通知';return;}
        if(typeof Notification==='undefined'){notify('此浏览器暂不支持桌面通知，仍会显示网页提醒');return;}
        try{const permission=await Notification.requestPermission();if(permission==='granted'){localStorage.setItem(storageKey,'true');b.textContent='关闭桌面通知';notify('桌面通知已开启，网页打开时生效');}else notify('未获得通知权限，仍会显示网页提醒');}catch(_){notify('桌面通知不可用，仍会显示网页提醒');}
      }
    });
    document.addEventListener('toggle',e=>{if(e.target.id==='alertsPopover'){document.getElementById('alertsButton').setAttribute('aria-expanded',String(e.newState==='open'));position();}},true);
    window.addEventListener('resize',position);document.addEventListener('scroll',position,true);
  }
  return {display,rangeControls,collectionMarkup,render,settingsPanel};
})();
