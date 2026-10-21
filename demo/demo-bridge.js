'use strict';
(() => {
  const demo=DemoData.create(DEMO_CATALOG);
  const realFetch=window.fetch.bind(window);
  window.fetch=async (input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(!url.pathname.startsWith('/api/'))return realFetch(input,options);
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const query=Object.fromEntries(url.searchParams);
    try {
      let result;
      switch(url.pathname){
        case '/api/data':result=demo.report(query);break;
        case '/api/settings':result=demo.settings(options.method==='POST'?JSON.parse(options.body):null);break;
        case '/api/account':case '/api/account/refresh':result=demo.quota();break;
        case '/api/account/range':result=demo.quotaRange();break;
        case '/api/account/acknowledge':result=demo.acknowledge(query.id);break;
        case '/api/remotes':result=demo.remotes();break;
        case '/api/web-background':result={supported:false,enabled:false};break;
        case '/api/reset-forecast':result={fresh:false,probability:null,signal:null,problem:'演示站不请求社区预测，也不展示虚构的实时预测概率。'};break;
        default:throw new Error('演示模式不执行本机服务或远程连接操作。');
      }
      return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    }catch(e){return new Response(JSON.stringify({error:e.message}),{status:400,headers:{'Content-Type':'application/json'}});}
  };
  document.addEventListener('click',e=>{
    const target=e.target.closest('button');if(!target)return;
    if(target.id==='export'){
      e.preventDefault();e.stopImmediatePropagation();
      const dimension={overview:'timeline',projects:'projects',sessions:'sessions',models:'models'}[state.view];
      const query=Object.fromEntries(params({dimension,search:state.search,sort:state.sort}));
      const blob=new Blob([demo.csv(query)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='codex-usage-DEMO-'+dimension+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      return;
    }
    if(target.id==='resetDemo'){e.preventDefault();location.href=location.pathname;return;}
    if(target.id==='syncRemotes'||target.id==='desktopNotifications'||target.dataset.toggleRemote||target.dataset.removeRemote){
      e.preventDefault();e.stopImmediatePropagation();notify('这是模拟演示；本机连接与桌面通知请在安装后使用。');
    }
  },true);
  document.addEventListener('submit',e=>{if(e.target.id==='remoteForm'){e.preventDefault();e.stopImmediatePropagation();notify('演示站不会连接 SSH 或读取真实数据。');}},true);
  // Label and disable local-only controls whenever the shared UI renders a view.
  const decorate=()=>{
    document.querySelectorAll('#remoteForm input,#remoteForm button,#sourcePaths,#syncRemotes,[data-toggle-remote],[data-remove-remote],#desktopNotifications').forEach(el=>{
      el.disabled=true;el.title='仅安装到本机后可用；演示站使用模拟数据';
    });
    const status=document.getElementById('accountStatus');if(status&&status.textContent!=='模拟账号 · 未连接真实服务')status.textContent='模拟账号 · 未连接真实服务';
    const background=document.getElementById('backgroundStatus');if(background&&background.textContent!=='静态演示不运行后台采集或开机任务。')background.textContent='静态演示不运行后台采集或开机任务。';
  };
  new MutationObserver(decorate).observe(document.body,{childList:true,subtree:true});
})();
