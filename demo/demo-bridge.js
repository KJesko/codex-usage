'use strict';
(() => {
  const demo=DemoData.create(DEMO_CATALOG,Date.now(),()=>Date.now());
  const realFetch=window.fetch.bind(window);
  window.fetch=async (input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(!url.pathname.startsWith('/api/'))return realFetch(input,options);
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const query=Object.fromEntries(url.searchParams);
    try {
      let result;
      switch(url.pathname){
        case '/api/data':if(query.refresh==='1')demo.recover('local');result=demo.report(query);break;
        case '/api/settings':case '/api/settings/patch':
          if(options.method==='POST'&&typeof setTimeout==='function')await new Promise(resolve=>setTimeout(resolve,450));
          if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
          result=demo.settings(options.method==='POST'?JSON.parse(options.body):null);
          // saveSettings renders the cached account immediately; update its history
          // scope too, so a timezone change does not wait for the next account poll.
          if(options.method==='POST'&&typeof accountData!=='undefined')accountData=demo.quota();
          break;
        case '/api/status':result=demo.status();break;
        case '/api/account':result=demo.quota();break;
        case '/api/account/refresh':demo.recover('account');result=demo.quota();break;
        case '/api/account/logout':result=demo.signOut(true);break;
        case '/api/account/range':result=demo.quotaRange();break;
        case '/api/account/acknowledge':result=demo.acknowledge(query.id);break;
        case '/api/remotes':result=demo.remotes();break;
        case '/api/remotes/sync':demo.recover('remote');result={ok:true,remotes:demo.remotes()};break;
        case '/api/health':result={version:typeof DEMO_VERSION==='string'?DEMO_VERSION:'demo',demo:true};break;
        case '/api/web-background':result={supported:false,enabled:false};break;
        case '/api/reset-updates':
        case '/api/reset-forecast':result={demo:true,fresh:false,probability:null,signal:null,problem:'演示站不请求公开重置动态，也不展示虚构的实时公告。'};break;
        default:throw new Error('演示模式不执行本机服务或远程连接操作。');
      }
      return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    }catch(e){return new Response(JSON.stringify({error:e.message}),{status:400,headers:{'Content-Type':'application/json'}});}
  };
  const descriptions={daily:'日常开发：三台机器分工、冷启动与热缓存交替，可按项目和模型追踪用量。',interrupted:'连接中断：实验机与额度暂时离线，旧数据继续可见。点击重新同步或刷新额度，体验恢复。',limit:'额度告急：每周剩余 5%，同时查看告警、重置时间与消耗曲线。',history:'长期记录：近三个月的 13 次重置，体验列表滚动、加载更多、事件筛选与图表缩放。'};
  function openSettings(section){settingsSection=section;setView('settings');selectSettingsSection(section);window.scrollTo({top:0});}
  document.addEventListener('click',async e=>{
    const target=e.target.closest('button');if(!target)return;
    if(target.dataset?.demoScenario||target.dataset?.demoTour||target.id==='demoSaveFailure'){
      e.preventDefault();e.stopImmediatePropagation();
      if(!settings){notify('演示数据正在准备，请稍后再试。');return;}
      // Quota deep links intentionally skip loading the usage report.
      if(!data)data=demo.report(Object.fromEntries(params()));
      if(target.dataset.demoTour){openSettings(target.dataset.demoTour);return;}
      if(target.id==='demoSaveFailure'){demo.failNextSave();openSettings('appearance');document.getElementById('demoScenarioNote').textContent='已准备一次模拟失败：修改头像文字，观察失败提示后点击重试。不会修改真实设置。';return;}
      const mode=demo.setScenario(target.dataset.demoScenario);
      document.querySelectorAll('[data-demo-scenario]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.demoScenario===mode)));
      document.getElementById('demoScenarioNote').textContent=descriptions[mode];
      accountData=demo.quota();dataSnapshot=demo.status();statusError='';reportError='';
      if(mode==='interrupted'){openSettings('coverage');paintDataStatus();renderAccount();}
      else if(mode==='limit'||mode==='history'){setView('quota');renderAccount();renderQuotaPace();}
      else {state.range='30';state.since='';state.until='';state.source='';state.project='';state.model='';state.account='';state.tab='analysis';setView('overview');await load();}
      return;
    }
    if(target.hasAttribute?.('data-account-login')||target.hasAttribute?.('data-browser-login')){
      e.preventDefault();e.stopImmediatePropagation();accountData=demo.signOut(false);renderAccount();paintDataStatus();if(state.view==='quota'){QuotaPage.render(accountData);renderQuotaPace();}return;
    }
    if(target.id==='refresh'){
      e.preventDefault();e.stopImmediatePropagation();
      refreshAccount(true);load(true);return;
    }
    if(target.id==='export'){
      e.preventDefault();e.stopImmediatePropagation();
      const dimension={overview:'timeline',projects:'projects',sessions:'sessions',models:'models'}[state.view];
      const query=Object.fromEntries(params({dimension,search:state.search,sort:state.sort}));
      const blob=new Blob([demo.csv(query)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='codex-usage-DEMO-'+dimension+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return;
    }
    if(target.id==='resetDemo'){e.preventDefault();location.href=location.pathname;return;}
    if(target.id==='desktopNotifications'||target.dataset.toggleRemote||target.dataset.removeRemote){
      e.preventDefault();e.stopImmediatePropagation();notify('这是模拟演示；本机连接与桌面通知请在安装后使用。');
    }
  },true);
  document.addEventListener('submit',e=>{if(e.target.id==='remoteForm'){e.preventDefault();e.stopImmediatePropagation();notify('演示站不会连接 SSH 或读取真实数据。');}},true);
  // Label and disable local-only controls whenever the shared UI renders a view.
  const decorate=()=>{
    document.querySelectorAll('#remoteForm input,#remoteForm button,#sourcePaths,[data-pick-source],[data-default-source],[data-check-sources],[data-toggle-remote],[data-remove-remote],#desktopNotifications').forEach(el=>{
      el.disabled=true;el.title='仅安装到本机后可用；演示站使用模拟数据';
    });
    const status=document.getElementById('accountStatus');if(status&&status.textContent!=='模拟账号 · 未连接真实服务')status.textContent='模拟账号 · 未连接真实服务';
    const background=document.getElementById('backgroundStatus');if(background&&background.textContent!=='静态演示不运行后台采集或开机任务。')background.textContent='静态演示不运行后台采集或开机任务。';
  };
  new MutationObserver(decorate).observe(document.body,{childList:true,subtree:true});
})();
