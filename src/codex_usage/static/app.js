'use strict';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const compact = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : number(n);
const usd = (n) => n == null ? '待定价' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:n > 0 && n < .01 ? 4 : 2}).format(n);
const costLabel = (r) => r.unpriced_events ? usd(r.known_cost) + ' + 待定价' : usd(r.cost);
const percent = (n) => (n * 100).toFixed(1) + '%';
const colors = {uncached:'#da7756', cached:'#d9cec0', write:'#aa966a', output:'#7d8e87'};
const paths = {
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
  chat:'M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z M7 9h10M7 13h7',
  model:'m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5M12 12v10',
  dollar:'M12 2v20M17 5H9a4 4 0 0 0 0 8h6a3 3 0 0 1 0 6H6',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  refresh:'M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6 M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
  info:'M12 8v.1M12 11v6 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  tokens:'M4 5h4v14H4zM10 10h4v9h-4zM16 2h4v17h-4z',
  cache:'m4 9 8-6 8 6-8 6zM4 13l8 6 8-6M4 17l8 6 8-6',
  filter:'M4 7h16M4 17h16M8 4v6M16 14v6'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));

const views = {
  overview:['用量总览','Token 用量、API 等价成本和活动记录。'],
  quota:['额度与重置','当前账号的实时额度、重置卡、使用分段和重置动态。'],
  projects:['项目分析','按项目查看用量与 API 等价成本。'],
  sessions:['会话明细','查看各会话的模型、用量和最近活跃时间。'],
  models:['模型分析','对比不同模型的用量、缓存与 API 等价成本。'],
  pricing:['价格与计费','模型单价与 API 等价成本的计算方式。'],
  settings:['数据与设置','管理本机与远程服务器、统计时区和覆盖范围。']
};
const routeDefaults = {view:'overview', tab:'summary', range:'30', grain:'day', project:'', model:'', account:'', source:'', since:'', until:''};
function readRoute(search) {
  const query=new URLSearchParams(search),route={...routeDefaults};
  for(const key of Object.keys(route))if(query.has(key))route[key]=query.get(key);
  if(!views[route.view])route.view='overview';
  if(!['summary','analysis'].includes(route.tab))route.tab='summary';
  if(!['today','week','7','30','all','custom'].includes(route.range))route.range='30';
  if(!['day','week','month'].includes(route.grain))route.grain='day';
  return route;
}
const state = {...readRoute(location.search), metric:'tokens', search:'', sort:'total', page:1};
let data = null, settings = null, requestId = 0, controller = null, toastTimer = null;
let accountData = null, accountPending = false, accountTimer = null, accountGeneration = 0;
let projectDetailReport = null, projectDetailMetric = 'tokens', projectDetailController = null;
let sessionDetailController = null;
let filterDraft = null;
let dataSnapshot=null, statusReading=false, statusError='', statusChecked=null, reportError='', remoteReading=false;
let remotePollAt=0,remoteFailures=0;
let settingsWrite=Promise.resolve(), appearanceSaveError='';
const restored = new URLSearchParams(location.search);
const appearanceDefaults={mode:'system',accent:'#da7756',font:'serif',customFont:'',size:15};
let appearance={...appearanceDefaults};
try{const saved=JSON.parse(localStorage.getItem('codex-usage-appearance')||'null');appearance={...appearanceDefaults,...(saved||{mode:localStorage.getItem('codex-usage-theme')||'system'})};}catch(_){}
function applyAppearance(){
  const dark=appearance.mode==='dark'||(appearance.mode==='system'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark',dark);
  if(!document.body.style)return;
  const accent=/^#[0-9a-f]{6}$/i.test(appearance.accent)?appearance.accent:appearanceDefaults.accent;
  const rgb=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16));
  const luminance=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const fonts={serif:'Georgia, "Source Han Serif SC", serif',sans:'system-ui, "Microsoft YaHei", sans-serif',mono:'"JetBrains Mono", Consolas, monospace'};
  const custom=String(appearance.font.startsWith('local:')?appearance.font.slice(6):appearance.customFont||'').replace(/["\\;{}<>]/g,'').slice(0,80);
  const font=(appearance.font==='custom'||appearance.font.startsWith('local:'))&&custom?`"${custom}", system-ui, sans-serif`:fonts[appearance.font]||fonts.serif;
  const values={'--accent':accent,'--chart-strong':accent,'--accent-soft':`color-mix(in srgb, ${accent} 18%, var(--bg))`,'--accent-ink':`color-mix(in srgb, ${accent} 65%, ${dark?'white':'black'})`,'--green':`color-mix(in srgb, ${accent} 65%, ${dark?'white':'black'})`,'--accent-contrast':luminance>.179?'#111111':'#ffffff','--font-ui':font};
  for(const [key,value] of Object.entries(values))document.body.style.setProperty(key,value);
  document.body.style.fontFamily=font;
  document.body.style.fontSize=Math.max(12,Math.min(20,Number(appearance.size)||15))+'px';
}
function saveAppearance(){
  applyAppearance();
  try{localStorage.setItem('codex-usage-appearance',JSON.stringify(appearance));localStorage.setItem('codex-usage-theme',appearance.mode);appearanceSaveError='';}
  catch(_){appearanceSaveError='外观已应用，但浏览器未能保存。请检查存储权限后重试。';}
  paintAppearanceSave();
}
let detectedFonts=[];
function detectCommonFonts(){
  if(!document.createElement)return;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)return;
  const sample='mmmmmmWWWWW0123456789汉字测试';
  const bases=['monospace','serif','sans-serif'];
  const widths=bases.map(base=>{ctx.font='72px '+base;return ctx.measureText(sample).width;});
  detectedFonts=['Arial','Calibri','Cambria','Candara','Consolas','Courier New','Georgia','Helvetica','Menlo','Microsoft YaHei','Microsoft JhengHei','PingFang SC','SimHei','SimSun','Source Han Sans SC','Source Han Serif SC','Noto Sans CJK SC','Noto Serif CJK SC','Segoe UI','Tahoma','Times New Roman','Trebuchet MS','Verdana','JetBrains Mono'].filter(name=>bases.some((base,i)=>{ctx.font='72px "'+name+'",'+base;return Math.abs(ctx.measureText(sample).width-widths[i])>.01;}));
}
function sourceActionIcon(name){
  const shapes={folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/>',detect:'<circle cx="12" cy="12" r="8"/><path d="M12 8a4 4 0 1 0 4 4M12 12l7-7"/><circle cx="12" cy="12" r="1"/>',check:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m8 13 3 3 5-5"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
}
function roundedIcon(name){const path={check:'m5 12 4 4 10-10',down:'m6 9 6 6 6-6',up:'m6 15 6-6 6 6'}[name];return `<svg class="rounded-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;}
function fontLabel(){return ({serif:'系统衬线',sans:'系统无衬线',mono:'系统等宽',custom:'手动输入字体名称'})[appearance.font]||appearance.font.slice(6);}
function fontOptions(){
  const item=(value,label)=>`<button type="button" role="option" aria-selected="${appearance.font===value}" data-font-option="${esc(value)}"><span>${esc(label)}</span><span aria-hidden="true">${appearance.font===value?roundedIcon('check'):''}</span></button>`;
  const names=[...new Set([...detectedFonts,...(appearance.font.startsWith('local:')?[appearance.font.slice(6)]:[])])].sort((a,b)=>a.localeCompare(b));
  return [['serif','系统衬线'],['sans','系统无衬线'],['mono','系统等宽']].map(([v,l])=>item(v,l)).join('')+'<div class="font-divider" role="presentation"><span>自定义字体</span></div>'+names.map(name=>item('local:'+name,name)).join('')+item('custom','手动输入字体名称');
}
detectCommonFonts();
function themeModeIcon(mode){
  const sun='<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  const moon='<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>';
  const both='<path d="M5 19 19 5M10 3v2M3 10h2M5 5l1.4 1.4M7 13a4.2 4.2 0 0 1 6-6M20 11a5.8 5.8 0 0 1-7 8 5.8 5.8 0 0 0 7-8Z"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mode==='light'?sun:mode==='dark'?moon:both}</svg>`;
}
function syncModeButtons(){document.querySelectorAll('[data-theme-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeMode===appearance.mode)));}
function appearanceView(){
  return `<section class="panel appearance-panel" data-settings-page="appearance"><div class="panel-head"><h2>外观与偏好</h2><button class="button" data-appearance-reset>恢复默认外观</button></div><div class="settings-body appearance-layout"><div class="appearance-controls"><div class="appearance-row"><label for="settingsLanguage">界面语言</label><select id="settingsLanguage" data-settings-language><option value="zh-CN" ${document.documentElement.lang.startsWith('en')?'':'selected'}>简体中文</option><option value="en" ${document.documentElement.lang.startsWith('en')?'selected':''}>English</option></select></div>
  <div class="appearance-row"><span id="appearanceModeLabel">主题模式</span><div class="appearance-mode-buttons" role="group" aria-labelledby="appearanceModeLabel">${[['light','浅色'],['dark','深色'],['system','跟随系统']].map(([mode,label])=>`<button type="button" data-theme-mode="${mode}" aria-label="${label}" title="${label}" aria-pressed="${appearance.mode===mode}">${themeModeIcon(mode)}</button>`).join('')}</div></div>
  <div class="appearance-row"><span>强调色</span><div class="appearance-colors">${['#da7756','#3b82f6','#16a085','#8b5cf6','#db2777','#737373'].map(color=>`<button class="appearance-swatch" style="--swatch:${color}" data-accent="${color}" aria-label="${color}" aria-pressed="${appearance.accent===color}"></button>`).join('')}<button type="button" class="button" data-custom-color>自定义</button><input class="appearance-color-input" type="color" data-appearance="accent" aria-label="自定义强调色" tabindex="-1" value="${esc(appearance.accent)}"></div></div>
  <div class="appearance-row"><span id="fontPickerLabel">界面字体</span><div class="font-row-controls"><button class="text-button" data-detect-fonts>检测全部本机字体</button><details class="font-picker"><summary aria-haspopup="listbox" aria-labelledby="fontPickerLabel fontPickerValue"><span id="fontPickerValue">${esc(fontLabel())}</span><span class="font-chevron">${roundedIcon('down')}</span></summary><div class="font-menu" role="listbox" aria-labelledby="fontPickerLabel">${fontOptions()}</div></details></div></div>
  <div class="subtle font-detection-status" id="fontDetectionStatus" role="status"></div>
  <div class="appearance-row" data-custom-font-field ${appearance.font==='custom'?'':'hidden'}><label for="customFontName">本机字体名称</label><div><input id="customFontName" data-appearance="customFont" maxlength="80" value="${esc(appearance.customFont)}" placeholder="Microsoft YaHei" ${appearance.font==='custom'?'':'disabled'}><span class="subtle">仅使用本机已安装字体，未安装时使用系统字体。</span></div></div>
  <div class="appearance-row"><label for="appearanceSize">正文字号</label><div class="appearance-size"><input id="appearanceSize" type="number" min="12" max="20" step="1" data-appearance="size" value="${Number(appearance.size)||15}"><span aria-hidden="true">px</span><div class="appearance-size-buttons"><button type="button" data-size-step="1" aria-label="增大字号">${roundedIcon('up')}</button><button type="button" data-size-step="-1" aria-label="减小字号">${roundedIcon('down')}</button></div></div></div>
  <div class="appearance-row"><label for="settingsAvatar">头像文字</label><input id="settingsAvatar" aria-label="自定义头像文字" maxlength="3" pattern="[A-Za-z0-9\\u3400-\\u9fff]{1,3}" required value="${esc(settings.avatar_initials || 'CU')}" autocomplete="off"><p>自定义头像文字，支持一至三个英文字母、数字或汉字。修改后自动保存。</p></div>
  </div><div class="appearance-preview"><span class="badge">实时预览</span><h2>你的用量，一目了然</h2><p>外观修改立即生效，自动保存在当前浏览器。</p><div class="quota-track"><span style="width:68%"></span></div><button class="button primary" type="button" disabled>示例按钮</button></div></div></section>`;
}

applyAppearance();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(appearance.mode==='system')applyAppearance();});


function dateInZone() {
  return new Intl.DateTimeFormat('en-CA', {timeZone:settings?.timezone || 'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function offsetDate(day, delta) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0,10); }
function rangeParams() {
  const today = dateInZone();
  if (state.range === 'all') return {};
  if (state.range === 'custom') return {since:state.since, until:state.until};
  let since = today;
  if (state.range === 'week') since = offsetDate(today, -((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
  else if (state.range !== 'today') since = offsetDate(today, 1 - Number(state.range));
  return {since, until:today};
}
function params(extra={}) {
  const value = {...rangeParams(), period:state.range, grain:state.grain, project:state.project, model:state.model, account:state.account, source:state.source, ...extra};
  return new URLSearchParams(Object.entries(value).filter(([,v]) => v !== '' && v != null));
}
function syncURL(push=false) {
  const q = new URLSearchParams();
  for (const key of Object.keys(routeDefaults)) if (state[key] && (key!=='tab' || state.view==='overview' && state.tab!=='summary')) q.set(key,state[key]);
  const next='?' + q.toString();
  if(push && next!==location.search)history.pushState(null,'',next);
  else history.replaceState(null,'',next);
}
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3000); }
function failure(message) { $('error').textContent = message; $('error').hidden = false; }
async function sessionFetch(url, options) {
  const response = await boundedFetch(url, options);
  const token=options?.headers?.['X-CSRF-Token'];
  if(response.status===403 && token && options.method==='POST') {
    // A restarted local service has a new token. Retry only rejected requests,
    // once, without replacing settings or discarding an unsaved form.
    const fresh=await boundedFetch('/api/settings');
    if(fresh.ok) {
      const current=await fresh.json();
      if(current.csrf && current.csrf!==token) {
        settings.csrf=current.csrf;
        return boundedFetch(url,{...options,headers:{...options.headers,'X-CSRF-Token':current.csrf}});
      }
    }
  }
  return response;
}
async function boundedFetch(url,options={}){
  const request=new AbortController(),abort=()=>request.abort();
  if(options.signal?.aborted)request.abort();
  else options.signal?.addEventListener('abort',abort,{once:true});
  let expired=false;
  const timer=setTimeout(()=>{expired=true;request.abort();},url.startsWith('/api/data')?60000:20000);
  try{return await fetch(url,{...options,signal:request.signal});}
  catch(error){if(expired)throw new Error('请求超时，请检查本地服务后重试。');throw error;}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
async function api(url, options) {
  const response = await sessionFetch(url, options);
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || '请求失败');
  return result;
}
function updateControls() {
  document.body.classList.toggle('settings-open',state.view==='settings');
  const analysis=state.view==='overview' && state.tab==='analysis';
  const [title, subtitle] = analysis?['详细分析','用量变化、趋势明细、项目排行和近期统计。']:views[state.view];
  $('pageTitle').textContent = title;
  $('breadcrumb').textContent = state.view==='overview'?'用量总览 / '+(analysis?'详细分析':'概览'):title;
  $('pageSubtitle').textContent = subtitle;
  document.title = `${title} · Codex Usage`;
  document.querySelectorAll('[data-view]').forEach(b => {b.classList.toggle('active',b.dataset.view === state.view); b.setAttribute('aria-current',b.dataset.view === state.view && state.view!=='overview' ? 'page' : 'false');});
  document.querySelectorAll('[data-overview-tab]').forEach(b=>{const active=state.view==='overview' && b.dataset.overviewTab===state.tab;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
  $('export').hidden = ['settings','pricing','quota'].includes(state.view);
  $('export').title = state.view==='sessions'?'导出当前搜索和筛选匹配的全部会话，包含所有分页':'导出当前筛选范围的统计结果';
  paintIdentity();
  $('filterButton').hidden=state.view==='quota';
  $('alertsButton').hidden=false;
  $('quotaAlertBanner').hidden=state.view!=='quota';
  updateFilterControls();
  if (data) {
    const boundary = data.usage_start;
    $('usageBoundary').hidden = !boundary;
    $('usageBoundary').textContent = boundary ? `统计起点：${boundary.date} 00:00（${boundary.timezone === 'Asia/Shanghai' ? '北京时间' : boundary.timezone}）。仅计入此后新增的 Token 与 API 等价成本。` : '';
    document.querySelector('[data-range="all"]').textContent = boundary ? '起点以来' : '全部';
    renderRemoteStatus(data.remotes || []);
  }
  updateFilterSummary();
}
function updateFilterControls() {
  const selected=filterDraft||state;
  document.querySelectorAll('[data-range]').forEach(b=>{b.classList.toggle('selected',b.dataset.range===selected.range);b.setAttribute('aria-pressed',String(b.dataset.range===selected.range));});
  $('customRange').hidden=selected.range!=='custom';
  $('since').required=$('until').required=selected.range==='custom';
  $('since').value=filterDraft?filterDraft.since:selected.since||settings?.usage_since||offsetDate(dateInZone(),-29);
  $('until').value=filterDraft?filterDraft.until:selected.until||dateInZone();
  if(data){
    $('source').innerHTML='<option value="">全部机器</option>'+data.options.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('project').innerHTML='<option value="">全部项目</option>'+data.options.projects.filter(p=>!selected.source||p.source===selected.source).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.path)}</option>`).join('');
    $('model').innerHTML='<option value="">全部模型</option>'+data.options.models.map(m=>`<option>${esc(m)}</option>`).join('');
    $('account').innerHTML='<option value="">全部账号分组</option>'+data.options.accounts.map((a,i)=>`<option value="${esc(a)}">${a==='unknown'?'未标记账号':`账号分组 ${i+1}`}</option>`).join('');
    for(const id of ['source','project','model','account']){
      if(selected[id] && ![...$(id).options].some(option=>option.value===selected[id]))$(id).add(new Option(selected[id],selected[id]));
      $(id).value=selected[id];
    }
  }
  positionFilterPopover();
}
function updateFilterSummary() {
  const labels={today:'今天',week:'本周','7':'近 7 天','30':'近 30 天',all:settings?.usage_since?'起点以来':'全部时间',custom:`${state.since} — ${state.until}`};
  const sources=data?.options.sources||[],project=data?.options.projects.find(p=>p.id===state.project);
  const source=state.source?(sources.find(s=>s.id===state.source)?.name||state.source):data?`全部 ${sources.length} 台机器`:'全部机器';
  const accountIndex=data?.options.accounts.indexOf(state.account)??-1;
  const account=state.account?(state.account==='unknown'?'未标记账号':accountIndex>=0?`账号分组 ${accountIndex+1}`:'所选账号分组'):'全部账号';
  const values=[labels[state.range],source,state.project?(project?.name||state.project):'全部项目',state.model||'全部模型',account];
  $('filterSummary').innerHTML=values.map(value=>`<span>${esc(value)}</span>`).join('');
  const description=values.join(' · ')+(data?` · 统计日期 ${data.range.since} — ${data.range.until}`:'');
  $('filterButton').title=description;
  $('filterButton').setAttribute('aria-label','展开筛选设置：'+description);
}
async function load(force=false) {
  if(state.view==='quota') {
    controller?.abort();requestId++;$('refresh').disabled=false;$('loading').hidden=true;$('content').hidden=false;
    if(!$('quotaCurrent'))render();else {QuotaPage.render(accountData);renderQuotaPace();}
    if(force)refreshAccount(true);
    return true;
  }
  const id = ++requestId;
  controller?.abort();
  controller = new AbortController();
  $('refresh').disabled = true;
  if (!data) $('loading').hidden = false;
  try {
    const next = await api('/api/data?' + params(force ? {refresh:'1'} : {}), {signal:controller.signal});
    if (id !== requestId) return;
    data = next;
    reportError='';
    dataSnapshot={local:next.collector,remotes:next.remotes,prices:next.pricing?.sync};
    $('error').hidden = true;
    $('loading').hidden = true;
    $('content').hidden = false;
    updateControls();
    // Background refreshes must not replace focused settings inputs or remote drafts.
    if(state.view==='settings' && $('settingsForm')){paintSetupAccount();renderRemoteStatus(next.remotes||[]);paintSaveFeedback();paintDataStatus();}
    else render();
    $('updated').textContent = '更新于 ' + new Date(data.scanned_at).toLocaleString('zh-CN', {timeZone:data.timezone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    paintDataStatus();return true;
  } catch (e) {
    if (id===requestId && e.name !== 'AbortError') { reportError=e.message;failure('读取失败：' + e.message); $('loading').hidden = true;paintDataStatus(); }
    return false;
  } finally { if (id === requestId) $('refresh').disabled = false; }
}
function metric(label, value, note, name, accent=false) {
  return `<div class="metric${accent?' accent':''}"><div class="metric-label">${label}${icon(name)}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`;
}
function metrics(s) {
  return `<div class="metrics">${metric('总 Token 用量',compact(s.total)+'<span class="unit">tokens</span>',`<strong>${number(s.events)}</strong> 次用量事件 · 输入 + 输出`,'tokens')}${metric('API 等价成本',usd(s.known_cost),s.unpriced_events ? `另有 ${compact(s.unpriced_tokens)} tokens 待定价` : '按当前 <strong>Standard</strong> API 价格折算','dollar',true)}${metric('缓存命中率',percent(s.cache_rate),`${compact(s.cached)} 缓存读取 · 已包含在输入中`,'cache')}${metric('活跃会话',number(s.sessions),`分布在 <strong>${number(s.projects)}</strong> 个项目中`,'chat')}</div>`;
}
function notice() {
  const c = data.coverage;
  return `<div class="notice coverage-notice">${icon('info')}<div><p><strong>统计范围：本机与已同步的远程日志</strong> · ${c.sessions} 个日志会话 / ${c.files} 个文件${!data.usage_start && c.missing_sessions ? `；另有 ${c.missing_sessions} 个已知会话缺少可读日志，尚未计入。` : '。'}${c.retained_files ? ` 已保留 ${c.retained_files} 个源文件消失前的缓存。` : ''}</p><p>${data.usage_start ? '起点以前的用量及无法按日期拆分的历史累计值不计入。' : ''}API 等价金额不代表订阅账单，未包含工具调用费用。<button class="text-button" data-view="settings">查看数据来源 →</button></p></div></div>`;
}
function unknownNotice() {
  return data.pricing.unknown_models.length ? `<div class="notice warning">${icon('info')}<div>${data.pricing.unknown_models.map(esc).join('、')} 暂无价格，已单独标记未计价用量。<button class="text-button" data-view="pricing">补充单价 →</button></div></div>` : '';
}
function empty(message='这个日期范围内没有用量记录。') { return `<div class="empty"><h3>这里还没有用量</h3>${esc(message)}<br>试试“${data?.usage_start ? '起点以来' : '全部'}”日期范围，或在数据设置中添加日志目录。</div>`; }
function chart(rows, metricName, W, H) {
  if (!rows.some(r => r.total)) return empty();
  const val = r => metricName === 'cost' ? r.known_cost : r.total;
  const max = Math.max(...rows.map(val), .001) * 1.15;
  const ticks = Array.from({length:5}, (_,i) => metricName==='cost' ? usd(max*i/4) : compact(max*i/4));
  const L=Math.max(70, ...ticks.map(label=>label.length*8.4+14)),R=28,T=18,B=38,w=Math.max(1,W-L-R),h=H-T-B;
  const step = w / rows.length, bar = Math.max(.6, Math.min(28, step * .64));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${metricName==='cost'?'API 等价成本':'用量趋势'}">`;
  for (let i=0;i<=4;i++) {
    const y=T+h-(i/4)*h;
    svg += `<line class="grid" x1="${L}" y1="${y}" x2="${W-R}" y2="${y}"/><text x="${L-12}" y="${y+5}" text-anchor="end">${esc(ticks[i])}</text>`;
  }
  const labelStep = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(w/72))));
  rows.forEach((r,i) => {
    const x=L+step*i+step/2;
    svg += `<g class="bar-group"><title>${r.date} · ${number(r.total)} tokens · ${costLabel(r)}</title>`;
    if (metricName === 'cost') {
      const bh=val(r)/max*h;
      svg += `<rect class="bar" x="${x-bar/2}" y="${T+h-bh}" width="${bar}" height="${bh}" rx="2" fill="var(--chart-strong)"/>`;
    } else {
      let base=T+h;
      for (const key of ['cached','uncached','write','output']) {
        const bh=r[key]/max*h; base-=bh;
        svg += `<rect class="bar" x="${x-bar/2}" y="${base}" width="${bar}" height="${bh}" fill="${colors[key]}"/>`;
      }
    }
    svg += '</g>';
    if (i%labelStep===0) svg+=`<text x="${Math.max(24,Math.min(W-24,x))}" y="${H-10}" text-anchor="middle">${r.date.slice(5).replace('-','/')}</text>`;
  });
  return svg+'</svg>';
}
const chartSeries = new WeakMap();
const chartObserver = new ResizeObserver(entries => {
  for (const {target} of entries) chartSeries.get(target)?.draw();
});
function mountChart(host, rows, metric='tokens') {
  chartSeries.get(host)?.viewport?.release();
  const series={rows,metric,viewport:null,geometry:null};
  series.draw=()=>{
    const W=host.clientWidth,H=host.clientHeight;if(!W||!H)return;
    const visible=series.viewport?series.viewport.slice(rows):rows;
    host.innerHTML=chart(visible,metric,W,H);
    const grid=host.querySelector('.grid');
    series.geometry=grid?{L:Number(grid.getAttribute('x1')),w:Number(grid.getAttribute('x2'))-Number(grid.getAttribute('x1')),T:18,h:H-56}:null;
  };
  chartSeries.set(host,series);
  // Include filters and dates, but not metric or totals, so polling preserves zoom.
  const key=JSON.stringify([host.id,rows[0]?.date,rows.at(-1)?.date,state.grain,state.source,state.project,state.model,state.account]);
  if(host.id==='trendChart')series.viewport=UsageViewport.mount(host,key,rows.length,series.draw,()=>series.geometry);
  chartObserver.observe(host);if(series.viewport)series.viewport.refresh();else series.draw();
}
function releaseCharts(root) {
  root.querySelectorAll('.chart-host').forEach(host => { chartObserver.unobserve(host);chartSeries.get(host)?.viewport?.release();chartSeries.delete(host); });
}
function grainSwitch(label='统计粒度') { return `<div class="segmented" role="group" aria-label="${esc(label)}">${[['day','按天'],['week','按周'],['month','按月']].map(([key,label])=>`<button data-grain="${key}" class="${state.grain===key?'selected':''}" aria-pressed="${state.grain===key}">${label}</button>`).join('')}</div>`; }
function trendPanel(rows) {
  const legend = [['uncached','未缓存输入'],['cached','缓存读取'],['write','缓存写入'],['output','输出']];
  return `<section class="panel usage-trend" aria-labelledby="usageTrendTitle"><div class="panel-head"><div><h2 id="usageTrendTitle">用量趋势</h2><p>${data.range.since} — ${data.range.until}${state.grain==='week'?' · 每周一开始':''}</p></div>${grainSwitch()}</div>
    <div class="trend-visuals"><div class="trend-plot"><div class="panel-head"><div class="metric-switch" role="group" aria-label="趋势指标"><button data-metric="tokens" class="${state.metric==='tokens'?'selected':''}">Tokens</button><button data-metric="cost" class="${state.metric==='cost'?'selected':''}">API 等价 USD</button></div><span class="subtle">${state.grain==='day'?'每日':state.grain==='week'?'每周':'每月'}汇总</span></div><div class="chart-wrap"><div class="chart-host" id="trendChart"></div></div><div class="chart-legend">${state.metric==='tokens' ? legend.map(([key,label])=>`<span class="legend-item"><i style="background:${colors[key]}"></i>${label}</span>`).join('') : '<span data-help>仅绘制已定价部分；未知价格不视为零成本</span>'}</div></div>${composition(data.summary)}</div>
    </section>`;
}
function composition(s) {
  return `<section class="panel"><div class="panel-head"><h2>Token 构成</h2><span class="badge neutral">所选范围</span></div><div class="composition"><div class="composition-total"><b>${compact(s.total)}</b><span>tokens</span></div><div class="stack">${Object.entries(colors).map(([key,color])=>`<span style="width:${s.total?s[key]/s.total*100:0}%;background:${color}"></span>`).join('')}</div>${[['uncached','未缓存输入'],['cached','缓存读取'],['write','缓存写入'],['output','输出']].map(([key,label])=>`<div class="composition-row"><span class="label"><i class="dot" style="background:${colors[key]}"></i>${label}</span><span class="amount" title="${number(s[key])}">${compact(s[key])}<span class="percent">${percent(s.total?s[key]/s.total:0)}</span></span></div>`).join('')}<p class="inset-note">输出已包含 ${compact(s.reasoning)} 推理 tokens。缓存读取、缓存写入都是输入的组成部分。</p></div></section>`;
}
function ranking() {
  const rows=data.projects.slice(0,5);
  return `<section class="panel"><div class="panel-head"><h2 id="rankingTitle">项目用量排行</h2><button class="text-button" data-view="projects">查看全部 →</button></div><div class="table-scroll summary-table-wrap"><table class="data-table summary-table ranking-table" aria-labelledby="rankingTitle"><thead><tr><th>项目</th><th class="num">Tokens</th><th class="num">API 等价</th></tr></thead><tbody>${rows.map((p,i)=>`<tr class="clickable" data-project="${esc(p.id)}"><td><button class="rank-project" data-project="${esc(p.id)}" title="${esc(p.path)}"><span class="rank-index">${String(i+1).padStart(2,'0')}</span><span class="rank-name">${esc(p.name)}</span></button></td><td class="num" title="${number(p.total)} tokens">${compact(p.total)}</td><td class="num cost">${costLabel(p)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-cell">没有符合条件的项目</td></tr>'}</tbody></table></div></section>`;
}
function quickPeriods() {
  return `<section class="panel"><div class="panel-head"><h2 id="recentTitle">近期用量</h2><span data-help class="subtle" title="按当前机器、项目、模型和账号分组筛选，分别计算今天、本周和本月的用量">跟随维度筛选</span></div><div class="table-scroll summary-table-wrap"><table class="data-table summary-table" aria-labelledby="recentTitle"><thead><tr><th>时间</th><th class="num">Tokens</th><th class="num">API 等价</th></tr></thead><tbody>${[['今天',data.today],['本周',data.week],['本月',data.month]].map(([label,s])=>`<tr><td>${label}</td><td class="num" title="${number(s.total)} tokens">${compact(s.total)}</td><td class="num cost">${costLabel(s)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function timelineTable(rows, grain=state.grain, timezone=data.timezone, embedded=false) {
  const heading=embedded?'h3':'h2';
  return `<section class="${embedded?'trend-table':'panel'}" ${embedded?'id="usageTimeline"':''}><div class="table-toolbar timeline-toolbar"><${heading}>${grain==='week'?'每周':grain==='month'?'每月':'每日'}统计</${heading}><span class="subtle">含零用量日期 · ${esc(timezone)}</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>日期${grain==='week'?'（周一）':''}</th><th class="num">总 Tokens</th><th class="num">输入</th><th class="num">其中缓存读取</th><th class="num">输出</th><th class="num">API 等价</th><th class="num">会话数</th></tr></thead><tbody>${[...rows].reverse().map(r=>`<tr><td>${r.date}</td><td class="num">${number(r.total)}</td><td class="num">${number(r.input)}</td><td class="num">${number(r.cached)}</td><td class="num">${number(r.output)}</td><td class="num cost">${costLabel(r)}</td><td class="num">${r.sessions}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-cell">当前范围内没有用量记录</td></tr>'}</tbody></table></div></section>`;
}
function projectView() {
  return unknownNotice()+`<section class="panel"><div class="table-toolbar"><h2>全部项目 <span class="badge neutral">${data.projects.length}</span></h2><span class="subtle">点击项目查看每日趋势</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>项目 / 目录</th><th class="num">总 Tokens</th><th class="num">缓存命中率</th><th class="num">API 等价</th><th class="num">活跃会话</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${data.projects.map(p=>`<tr class="clickable" data-project-detail="${esc(p.id)}"><td class="title-cell"><button class="text-button" data-project-detail="${esc(p.id)}" aria-haspopup="dialog"><strong>${esc(p.name)}</strong></button><span class="badge neutral">${esc(p.source_name)}</span><small title="${esc(p.path)}">${esc(p.path)}</small></td><td class="num">${number(p.total)}</td><td class="num">${percent(p.cache_rate)}</td><td class="num cost">${costLabel(p)}</td><td class="num">${p.sessions}</td><td><button class="text-button" data-project="${esc(p.id)}" aria-label="查看 ${esc(p.name)} 的会话">查看会话 ↗</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-cell">没有符合条件的项目</td></tr>'}</tbody></table></div></section>`;
}
function sessionRows() {
  const query=state.search.toLowerCase();
  const rows=data.sessions.filter(s=>[s.title,s.id,...s.model_names,...s.project_names].some(v=>v.toLowerCase().includes(query)));
  rows.sort((a,b)=>state.sort==='last_at'?b.last_at.localeCompare(a.last_at):(b[state.sort]||0)-(a[state.sort]||0));
  const pages=Math.max(1,Math.ceil(rows.length/20)); state.page=Math.min(state.page,pages);
  $('sessionRows').innerHTML=rows.slice((state.page-1)*20,state.page*20).map(s=>`<tr class="clickable" data-session="${esc(s.id)}"><td class="title-cell"><button class="text-button" data-session="${esc(s.id)}"><strong>${esc(s.title)}</strong></button><small>${s.source_names.map(esc).join(' / ')} · ${s.project_names.map(esc).join(' · ')} · ${esc(s.id.slice(0,8))}</small></td><td><span class="badge neutral">${esc(s.model_names[0])}</span>${s.model_names.length>1?`<small>共 ${s.model_names.length} 个模型</small>`:''}</td><td class="num">${number(s.total)}</td><td class="num cost">${costLabel(s)}</td><td>${new Date(s.last_at).toLocaleString('zh-CN',{timeZone:data.timezone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-cell">没有匹配的会话，请更换筛选条件。</td></tr>';
  $('pagination').innerHTML=`<span>共 ${rows.length} 个会话 · ${state.page} / ${pages} 页</span><button class="button small" data-page="prev" ${state.page===1?'disabled':''}>上一页</button><button class="button small" data-page="next" ${state.page===pages?'disabled':''}>下一页</button>`;
  CompactTables.mount($('sessionRows').closest('section'));
}
function sessionView() {
  return unknownNotice()+`<section class="panel"><div class="table-toolbar"><input type="search" id="sessionSearch" placeholder="搜索会话、项目、模型…" aria-label="搜索会话" value="${esc(state.search)}"><label><span class="sr-only">会话排序</span><select id="sessionSort"><option value="total">按用量排序</option><option value="known_cost">按已定价成本排序</option><option value="last_at">按最近活跃排序</option></select></label></div><div class="table-scroll"><table class="data-table"><thead><tr><th>会话</th><th>模型</th><th class="num">总 Tokens</th><th class="num">API 等价</th><th>最近活跃</th></tr></thead><tbody id="sessionRows"></tbody></table></div><div class="pagination" id="pagination"></div></section>`;
}
function modelTable(rows) {
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>模型</th><th class="num">总 Tokens</th><th class="num">未缓存输入</th><th class="num">缓存读取</th><th class="num">输出</th><th class="num">API 等价</th></tr></thead><tbody>${rows.map(m=>`<tr><td><strong>${esc(m.name)}</strong>${m.unpriced_events?'<small>待配置价格</small>':''}</td><td class="num">${number(m.total)}</td><td class="num">${number(m.uncached)}</td><td class="num">${number(m.cached)}</td><td class="num">${number(m.output)}</td><td class="num cost">${costLabel(m)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-cell">暂无模型用量</td></tr>'}</tbody></table></div>`;
}
let priceFetchMessage='';
function pricingSyncPanel() {
  const sync=data.pricing.sync;
  if(!sync)return '';
  const time=at=>at?new Date(at*1000).toLocaleString('zh-CN',{timeZone:data.timezone,hour12:false}):'尚未检查';
  const missing=data.pricing.missing_models||[];
  return `<section class="panel price-spacer"><div class="panel-head"><h2>模型价格同步</h2><span class="badge">${sync.busy?'正在查询官方':missing.length?`${missing.length} 个模型待补价`:'已使用模型价格齐全'}</span></div><div class="settings-body"><p>每 24 小时同步已使用模型的官方价格，发现缺价模型时自动查询。</p><dl class="price-sync-grid"><dt>最近定时检查</dt><dd>${esc(time(sync.last_check))}</dd><dt>下次定时同步</dt><dd>${esc(time(sync.next_check))}</dd></dl>${sync.error?`<p role="status">${esc(sync.error)}</p>`:''}${priceFetchMessage?`<p role="status">${esc(priceFetchMessage)}</p>`:''}<p data-help>只展示所有本地及已同步日志中实际使用的模型，不受日期筛选影响。缺价可点击“从官方获取”。官方尚未公布适用价格时仍保留待补价，不猜测单价。手动查询间隔至少 60 秒。自定义单价优先；已有官方价格每 24 小时更新。缺价自动查询失败或官方未公布时，每个模型最多每日自动重试一次。</p></div></section>`;
}
function pricingView() {
  return pricingSyncPanel()+`<div class="notice">${icon('info')}<div><strong>如果同样的 Token 通过 API 使用，会花多少钱？</strong><br>默认按当前 Standard API 单价计算。历史用量也使用此价格快照，不是历史账单重建；Codex 的订阅费、Fast / Ultrafast 加价、地区附加费和工具调用费不包含在内。</div></div><section class="panel"><div class="table-toolbar"><h2>已使用模型单价</h2><span class="badge">USD / 百万 tokens</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>模型</th><th class="num">未缓存输入</th><th class="num">缓存读取</th><th class="num">缓存写入</th><th class="num">输出</th><th>来源</th></tr></thead><tbody>${Object.entries(data.pricing.models).map(([name,p])=>`<tr><td>${esc(name)}</td>${['input','cached','write','output'].map(k=>`<td class="num">${p[k]==null?'—':esc('$'+p[k])}</td>`).join('')}<td>${(data.pricing.missing_models||[]).includes(name)?`<button class="button small" data-fetch-price="${esc(name)}" ${data.pricing.sync?.busy?'disabled':''}>从官方获取</button><span>${data.pricing.sync?.unresolved?.includes(name) && data.pricing.sync?.last_success && !data.pricing.sync?.busy && !data.pricing.sync?.error?' 官方暂无适用单价':' 待补价'}</span>`:data.pricing.overrides.includes(name)?'<span class="badge neutral">自定义</span>':`<a href="https://developers.openai.com/api/docs/models/${encodeURIComponent(name)}" target="_blank" rel="noreferrer">官方 ↗</a>`}</td></tr>`).join('')}</tbody></table></div><div class="formula">等价 USD =（未缓存输入 × 输入价 + 缓存读取 × 缓存价 + 缓存写入 × 写入价 + 输出 × 输出价）/ 1,000,000</div><div class="price-source">官方价格核对于 ${data.pricing.verified_at} · <a href="${esc(data.pricing.source)}" target="_blank" rel="noreferrer">查看官方价目表 ↗</a><br>长上下文按官方对应档位计价，按日志中的单次请求长度判断；完整档位可打开官方价目表查看。仅查询缺失价格，自定义价格保持优先。</div></section><section class="panel price-spacer"><div class="panel-head"><h2>添加或覆盖模型单价</h2></div><div class="settings-body"><p data-help class="subtle">保存后立即重算历史用量；单价仅保存在本机。长上下文阈值留空表示不启用倍率。</p><form id="priceForm" class="price-form"><label class="model-field"><span>模型名称</span><input name="name" required placeholder="例如 gpt-6.1-sol" list="priceModels"></label><datalist id="priceModels">${data.options.models.map(m=>`<option value="${esc(m)}">`).join('')}</datalist>${[['input','输入价'],['cached','缓存读取价'],['write','缓存写入价'],['output','输出价']].map(([key,label])=>`<label><span>${label}</span><input name="${key}" type="number" min="0" step="any" required placeholder="$/M"></label>`).join('')}<label><span>长上下文阈值</span><input name="long_context" type="number" min="1" step="1" placeholder="272000"></label><button class="button primary" type="submit">保存价格</button></form>${data.pricing.overrides.length?`<div class="inset-note" data-help-keep>自定义模型：${data.pricing.overrides.map(name=>`<button class="text-button" data-reset-price="${esc(name)}">${esc(name)} · 恢复默认</button>`).join('')}</div>`:''}</div></section>`;
}
let backgroundStatus=null,backgroundBusy=false,backgroundReading=false,backgroundError='';
function backgroundPanel(){
  return '<section class="panel price-spacer"><div class="panel-head"><h2>网页版后台服务</h2><button class="button small" id="refreshBackground">刷新状态</button></div><div class="settings-body" id="backgroundStatus"></div></section>';
}
function paintBackground(){
  const host=$('backgroundStatus');if(!host)return;
  if(!backgroundStatus){host.textContent=backgroundError||'正在检查 Windows 后台服务…';return;}
  const s=backgroundStatus;
  if(!s.supported){host.textContent='当前运行方式不支持此功能，请使用 Windows 源码网页版。';return;}
  const format=t=>t?new Date(t*1000).toLocaleString('zh-CN',{timeZone:settings.timezone,hour12:false}):'暂无记录';
  const enabled=s.enabled===true,unknown=s.enabled==null;
  const error=backgroundError||s.error;
  const collector=s.collector||{};
  const phases={managed:'已接管后台服务',waiting_server:'等待当前前台服务退出后接管',port_conflict:'端口被其他服务占用，无法启动'};
  const opened=host.querySelector('details')?.open;
  const markup=`<div class="background-controls"><div><strong>开机自启与异常恢复</strong><div>${unknown?'状态未知':enabled?'已开启':'已关闭'}</div></div><button class="button" id="toggleBackground" role="switch" aria-label="开机自启与异常恢复" aria-checked="${enabled}" ${backgroundBusy||unknown?'disabled':''}>${backgroundBusy?'正在设置…':enabled?'关闭自动保护':'开启自动保护'}</button></div><dl class="definition"><dt>访问地址</dt><dd><code>http://127.0.0.1:${esc(s.port||8787)}</code></dd><dt>应用数据目录</dt><dd><code>${esc(s.data_dir||'—')}</code></dd><dt>网页服务</dt><dd>${backgroundError?'连接待确认':'运行中'}</dd><dt>额度采集</dt><dd>${collector.running?'运行中 · 每 '+collector.interval_seconds+' 秒':'未运行'}${collector.failures?' · 连续失败 '+collector.failures+' 次':''}</dd><dt>最近成功采集</dt><dd>${collector.last_success?esc(new Date(collector.last_success).toLocaleString('zh-CN',{timeZone:settings.timezone,hour12:false})):'暂无记录'}</dd><dt>开机自动启动</dt><dd>${unknown?'状态未知':enabled?'已开启 · 登录后启动':'已关闭'}</dd><dt>异常退出恢复</dt><dd>${s.supervisor_running?(phases[s.phase]||'运行中'):enabled?'尚未就绪 · 等待自动恢复':'未运行'}</dd><dt>最近启动</dt><dd>${esc(format(s.last_started))}</dd><dt>最近一次重启</dt><dd>${esc(format(s.last_restart))}</dd></dl>${enabled && s.configuration_matches===false?'<p role="alert">后台配置与当前端口不一致，请关闭后重新开启自动保护。</p>':''}${error?'<p role="alert">'+esc(error)+'</p>':''}<p>关闭自动保护不会停止当前网页和采集；服务退出后将不会自动恢复。</p><details><summary>启动与恢复说明</summary><p>开启时保存当前端口、应用数据目录、日志来源和统计时区；不同数据目录使用独立后台任务。登录当前 Windows 账号后静默启动。网页进程退出后通常约 5 秒恢复，连续失败最长等待 60 秒；守护进程退出后约 1 分钟恢复。关机、休眠或尚未登录时无法采集。时间按设置时区显示；重启时间从启用状态记录后开始保存。</p></details>`;
  QuotaDOM.patch(host,markup);if(opened)host.querySelector('details').open=true;
  $('refreshBackground').disabled=backgroundBusy||backgroundReading;
}
async function readBackground(){
  if(backgroundReading||backgroundBusy||!$('backgroundStatus'))return;
  backgroundReading=true;
  try{backgroundStatus=await api('/api/web-background');backgroundError='';}
  catch(e){backgroundError='无法读取后台状态，请稍后刷新。';}
  finally{backgroundReading=false;paintBackground();}
}
document.addEventListener('input',event=>{if(event.target.id==='sourcePaths' && $('sourceCheckResult'))$('sourceCheckResult').textContent='';});
function setupPanel() {
  const setup=settings.setup;
  const sourceReady=setup?.sources?.some(row=>row.status==='ready');
  const checkup=setup?`<div class="settings-body setup-checkup"><strong>${setup.first_run?'首次配置：先确认日志，再选择是否连接额度':'当前配置检查'}</strong><div class="setup-checks"><span class="setup-status ${sourceReady?'ready':'pending'}"><i aria-hidden="true">${sourceReady?roundedIcon('check'):'!'}</i>${sourceReady?'日志目录已识别':'日志目录待检查'}</span><span class="setup-status ${data?.summary?.events?'ready':'pending'}"><i aria-hidden="true">${data?.summary?.events?roundedIcon('check'):'!'}</i>${data?.summary?.events?'当前筛选中已读到用量':'当前筛选中没有用量事件'}</span><span class="setup-status ${setup.cli_available?'ready':'pending'}"><i aria-hidden="true">${setup.cli_available?roundedIcon('check'):'!'}</i>${setup.cli_available?'已找到额度连接程序':'未找到额度连接程序'}</span></div><div>${sourceReady?'目录识别通过；实际 Token 以项目和会话页面为准。':'请在下方选择 Codex 主目录，检查后保存。没有日志时也可先保存配置。'}</div><details><summary>运行位置与配置</summary><dl class="definition"><dt>运行环境</dt><dd>${esc(setup.system)}</dd><dt>访问地址</dt><dd>${esc(setup.url)}</dd><dt>应用数据目录</dt><dd><code>${esc(setup.data_dir)}</code></dd></dl><div>日志、登录和网络均来自运行后台的系统用户。远程环境与当前浏览器所在电脑可能不同。</div></details></div>`:'';
  return `<section class="panel setup-panel"><div class="panel-head"><h2>开始使用</h2></div>${checkup}<div class="settings-body setup-grid"><div><h3>项目与会话 Token</h3><div>读取本机日志，无需连接账号。请在下方检查 Codex 数据目录。</div><button class="button" data-setup-source>检查日志目录</button></div><div><h3>账号额度</h3><div id="setupAccountStatus" role="status"></div><div class="setup-actions"><button class="button" data-browser-login>浏览器登录</button><button class="button" data-refresh-quota>重新连接额度</button></div><div id="browserLoginStatus" role="status"></div><details><summary>连接步骤与常见问题</summary><ol><li>在运行看板的同一系统用户下，打开 Codex 并登录 ChatGPT 账号。</li><li>终端运行 <code>codex login status</code> 检查登录；未登录时运行 <code>codex login</code>，完成浏览器登录。</li><li>回到这里重新连接。浏览器登录 ChatGPT 不等于本机 Codex 已登录。</li></ol><div>未找到程序时，将 CODEX_USAGE_CLI 设为原生 Codex 程序的绝对路径并重启后台；Windows 使用 codex.exe，不使用 cmd 或 bat 包装脚本。</div><div>额度连接使用后台进程的账号环境；更改日志目录不会切换账号。无需向看板填写密码或 API Key。</div></details></div><div><h3>其他机器的用量</h3><div>在下方远程服务器中添加已有的 SSH 别名。先确认免密登录和远程 Python 可用。</div><div>SSH 只汇总日志，不连接远程账号额度。</div><button class="button" data-setup-remote>管理服务器</button></div></div></section>`;
}
let loginWindow=null;
async function beginBrowserLogin(cancel=false) {
  const login=accountData?.browser_login;
  if(!cancel && login?.status==='waiting' && login.url){
    try{
      const url=new URL(login.url);
      if(url.protocol==='https:' && url.hostname==='auth.openai.com' && !url.username && !url.password){
        window.open(url.href,'_blank','noopener,noreferrer');return;
      }
    }catch(_){}
  }
  if(cancel){if(loginWindow && !loginWindow.closed)loginWindow.close();loginWindow=null;}
  else if(!loginWindow || loginWindow.closed){loginWindow=window.open('about:blank','_blank');if(loginWindow){loginWindow.opener=null;loginWindow.document.title='Codex Usage';loginWindow.document.body.textContent='正在准备登录…';}}
  const host=$('browserLoginStatus');
  if(host)host.textContent='正在准备登录…';
  try {
    const result=await api(cancel?'/api/account/login/cancel':'/api/account/login',{method:'POST',headers:{'X-CSRF-Token':settings.csrf}});
    accountData={...(accountData||{}),browser_login:result};renderAccount();refreshAccount();
  } catch(error){if(loginWindow && !loginWindow.closed)loginWindow.close();loginWindow=null;if(host)host.textContent=error.message;notify(error.message);}
}
function paintBrowserLogin() {
  const login=accountData?.browser_login||{status:'idle'};
  if(loginWindow && !loginWindow.closed){
    if(login.status==='waiting' && login.url){
      try{const url=new URL(login.url);if(url.protocol==='https:' && url.hostname==='auth.openai.com' && !url.username && !url.password){loginWindow.location.replace(url.href);loginWindow=null;}}catch(_){}
    }else if(['failed','expired','cancelled'].includes(login.status)){loginWindow.close();loginWindow=null;}
  }
  const host=$('browserLoginStatus');if(!host)return;
  const labels={starting:'正在准备官方登录链接…',waiting:'在浏览器完成官方登录后，额度会自动刷新。',success:'登录已完成，正在按新登录状态读取额度。',failed:'未能完成登录。请检查 Codex 安装、网络或本机登录回调端口，然后重试；原有连接方式仍可使用。',expired:'登录等待已超时，请重新发起。',cancelled:'已取消本次登录。'};
  const active=['starting','waiting'].includes(login.status);
  const button=document.querySelector('[data-browser-login]');if(button){button.disabled=login.status==='starting';button.textContent=login.status==='starting'?'正在准备登录…':login.status==='waiting'?'继续浏览器登录':'浏览器登录';}
  const signature=JSON.stringify(login);if(host.dataset.state===signature)return;host.dataset.state=signature;
  host.replaceChildren();
  const message=document.createElement('div');message.textContent=labels[login.status]||'通过官方页面登录，无需复制 Session；这会更新本机 Codex 的登录账号。';host.append(message);
  if(login.status==='waiting' && login.url){
    const url=new URL(login.url);
    if(url.protocol==='https:' && url.hostname==='auth.openai.com' && !url.username && !url.password){
      const link=document.createElement('a');link.className='button';link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='打开官方登录页';host.append(link);
    }
  }
  if(active){const cancel=document.createElement('button');cancel.className='text-button';cancel.type='button';cancel.textContent='取消登录';cancel.addEventListener('click',()=>beginBrowserLogin(true));host.append(cancel);}
}
function paintSetupAccount() {
  const host=$('setupAccountStatus');if(!host)return;
  paintBrowserLogin();
  paintIdentity();
  const q=accountData, kind=q?.problem?.kind;
  const guidance={signed_out:'登录已失效，请在本机 Codex 重新登录后重试。',unavailable:'未能读取额度，请展开连接步骤检查 Codex 程序与版本。',unsupported:'请更新 Codex 后重启后台，再重新连接。',timeout:'额度请求超时，请检查后台进程使用的网络或代理后重试。',routing_timeout:'账号服务暂时不可达，看板会自动重试。',offline:'账号服务暂时不可达，看板会自动重试。',connection_lost:'连接已中断，请重新连接额度。'};
  host.textContent=q?.signed_out?'请登录后查看额度和重置卡，本地日志仍可使用。':q?.busy?'正在连接额度…':q?.problem?guidance[kind]||q.problem.message:q?.transportError?q.transportError:q?.fetched_at?(q.stale?'等待更新；上次成功：':'额度已连接；上次成功：')+accountTime(q.fetched_at):'等待首次额度读取，可点击重新连接。';
}
function paintIdentity() {
  const profile=accountData?.profile;
  $('sidebarAccount').textContent=accountData?.signed_out?'未登录':profile?.label || accountData?.account?.label || 'Codex 账号';
  const signedIn=accountData && !accountData.signed_out && accountData.problem?.kind!=='signed_out' && (accountData.account || accountData.browser_login?.status==='success');
  $('accountAvatar').textContent=signedIn?(settings?.avatar_initials || 'CU'):'';
  $('accountAvatar').classList.toggle('account-avatar-default',!signedIn);
}
let sourceBrowseId=0;
async function openSourcePicker() {
  let dialog=$('sourcePicker');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='sourcePicker';dialog.className='source-picker';
    dialog.setAttribute('aria-labelledby','sourcePickerTitle');
    dialog.innerHTML=`<div class="panel-head"><h2 id="sourcePickerTitle">选择数据目录</h2><button type="button" class="icon-button" data-source-close aria-label="关闭">×</button></div><form id="sourceBrowseForm" class="source-browse-path"><label for="sourceBrowsePath">当前目录</label><input id="sourceBrowsePath" spellcheck="false"><button class="button" type="submit">打开</button></form><div id="sourceBrowseShortcuts" class="setup-actions"></div><div id="sourceBrowseStatus" role="status"></div><div id="sourceBrowseFolders" class="source-folder-list"></div><div class="source-picker-actions"><button type="button" class="button" data-source-close>取消</button><button type="button" class="button primary" id="sourceBrowseSelect">选择此目录</button></div>`;
    document.body.append(dialog);
    dialog.addEventListener('close',()=>{sourceBrowseId++;});
    dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();browseSource($('sourceBrowsePath').value.trim());});
    dialog.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-source-close'))dialog.close();
      if(button.dataset.sourceDirectory!==undefined)browseSource(button.dataset.sourceDirectory);
      if(button.id==='sourceBrowseSelect'){
        const input=$('sourcePaths');if(!input)return;
        const paths=input.value.split('\n').map(p=>p.trim()).filter(Boolean);
        if(!paths.includes(dialog.dataset.path))paths.push(dialog.dataset.path);
        if(paths.length>20){$('sourceBrowseStatus').textContent='最多添加 20 个目录';return;}
        input.value=paths.join('\n');input.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();input.focus();
      }
    });
  }
  dialog.showModal();
  await browseSource(null);
}
async function browseSource(path) {
  const request=++sourceBrowseId,dialog=$('sourcePicker');
  $('sourceBrowseSelect').disabled=true;$('sourceBrowseFolders').replaceChildren();
  $('sourceBrowseStatus').textContent='正在读取目录…';
  try{
    const result=await api('/api/setup/browse',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':settings.csrf},body:JSON.stringify({path})});
    if(request!==sourceBrowseId || !dialog.open)return;
    dialog.dataset.path=result.path;$('sourceBrowsePath').value=result.path;
    const button=(label,path)=>`<button type="button" class="button" data-source-directory="${esc(path)}">${esc(label)}</button>`;
    $('sourceBrowseShortcuts').innerHTML=(result.parent?button('上一级',result.parent):'')+button('用户目录',result.home)+result.roots.map(path=>button(path,path)).join('');
    $('sourceBrowseFolders').innerHTML=result.folders.map(row=>button('▸ '+row.name,row.path)).join('');
    $('sourceBrowseStatus').textContent=result.truncated?'目录较多，仅显示部分；可输入完整路径打开':result.folders.length?'':'此目录没有子文件夹';
    $('sourceBrowseSelect').disabled=false;
  }catch(error){if(request===sourceBrowseId && dialog.open)$('sourceBrowseStatus').textContent=error.message;}
}
function settingsView() {
  const c=data.coverage;
  const warningLabels={invalid_records:'格式无效的记录',partial_lines:'尚未写完的行（下次刷新重试）',counter_resets:'累计计数重置（使用最后一次用量）',unobserved_prefixes:'缺少起始历史的日志（仅计可确认用量）',last_only_events:'仅有单次用量的事件',inconsistent_counts:'不一致的缓存计数',orphan_forks:'缺少父会话的分支'};
  return appearanceView()+setupPanel()+`<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>数据来源</h2><span class="badge">本机只读</span></div><form class="settings-body" id="settingsForm"><div class="field"><label for="sourcePaths">Codex 数据目录</label><div class="source-path-control"><textarea id="sourcePaths" rows="1" wrap="off" required spellcheck="false" placeholder="C:\\Users\\you\\.codex / /home/you/.codex">${esc(settings.sources.join('\n'))}</textarea><button type="button" class="button source-picker-open source-action" data-pick-source aria-label="选择文件夹" title="选择文件夹">${sourceActionIcon('folder')}</button>${settings.setup?`<button type="button" class="button source-action" data-default-source aria-label="自动检测日志目录" title="自动检测日志目录">${sourceActionIcon('detect')}</button>`:''}<button class="button source-action" type="button" data-check-sources aria-label="检查日志目录（不保存）" title="检查日志目录（不保存）">${sourceActionIcon('check')}</button></div><div id="sourceCheckResult" role="status" aria-live="polite"></div><div class="source-path-example"><span>路径示例：</span><span>Windows: <code>C:\\Users\\you\\.codex</code></span><span>macOS: <code>/Users/you/.codex</code></span><span>Linux: <code>/home/you/.codex</code></span></div><p>每行一个绝对路径，指向含 sessions 或 archived_sessions 的 Codex 主目录。可添加从其他机器复制的目录；相同会话事件会去重。</p></div><label class="field"><span>统计时区</span><select id="settingsTimezone"><option value="system" ${settings.timezone_mode==='system'?'selected':''}>跟随系统</option>${[...new Set([settings.timezone,'America/Los_Angeles','Asia/Shanghai','Asia/Tokyo','Europe/London','UTC'])].map(z=>`<option ${settings.timezone_mode!=='system'&&z===settings.timezone?'selected':''}>${esc(z)}</option>`).join('')}</select><p>按所选时区划分日期；每周从周一开始，自动处理夏令时。</p></label><label class="field"><span>统计起始日期</span><input id="settingsUsageSince" type="date" value="${esc(settings.usage_since || '')}"><p>从所选时区当天 00:00 起计算所有用量与 API 等价成本，包含本机和远程服务器。更早的记录不计入；留空恢复全部历史。</p></label><p class="inset-note">修改后自动保存，并重新获取和更新数据；保存失败时会在对应设置下提示，可重试。日志索引仅保存用量、会话标题、路径与额度快照。实时额度由 Codex 通过当前登录读取；本程序不读取或保存登录凭据。</p></form></section><section class="panel"><div class="panel-head"><h2>数据覆盖情况</h2></div><div class="settings-body"><dl class="definition"><dt>已知会话元数据</dt><dd>${c.metadata_sessions}</dd><dt>已统计日志会话</dt><dd>${c.sessions}</dd><dt>可读日志文件</dt><dd>${c.files}</dd><dt>缺少日志的已知会话</dt><dd>${c.missing_sessions}</dd><dt>源文件消失后保留的缓存</dt><dd>${c.retained_files}</dd><dt>最近扫描耗时</dt><dd>${c.scan_ms} ms</dd></dl><div class="help-copy"><p>这份看板代表<strong>配置目录中的可观测用量</strong>。没有日志的远程会话、云端会话和已删除历史不会自动补齐；元数据计数也不一定覆盖所有账号活动。</p><p>只有账号标记可用时才能区分本地账号分组。来源不明的历史会单列为“未标记账号”。</p><p>项目按工作目录归属；可访问的 Git 子目录和 worktree 会尽量合并回主仓库。</p></div>${Object.keys(c.warnings).length||c.issues.length?`<ul class="info-list">${Object.entries(c.warnings).map(([k,v])=>`<li>${esc(warningLabels[k]||k)}：${v}</li>`).join('')}${c.issues.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}</div></section></div><section class="panel price-spacer"></section>`;
}
function parkPreferenceControls(){
  let parking=$('preferenceControlParking');if(!parking){parking=document.createElement('div');parking.id='preferenceControlParking';parking.hidden=true;document.body.append(parking);}
  for(const id of ['language','filterButton','filterPopover']){const control=$(id);if(control)parking.append(control);}
}
let settingsReturnView='overview',settingsReturnTab='summary';
let settingsSection='start';
try{settingsSection=localStorage.getItem('codex-usage-settings-section')||'start';}catch(_){}
function selectSettingsSection(section){
  if(section==='scope'||section==='remote')section='data';
  const shell=document.querySelector('.settings-shell');if(!shell)return;
  if(!shell.querySelector(`[data-settings-page="${section}"]`))section='start';
  settingsSection=section;
  shell.querySelectorAll('[data-settings-page]').forEach(page=>page.hidden=page.dataset.settingsPage!==section);
  document.querySelectorAll('[data-settings-section]').forEach(button=>{const active=button.dataset.settingsSection===section;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  try{localStorage.setItem('codex-usage-settings-section',section);}catch(_){}
}
let aboutVersion=null,aboutVersionPending=false;
function aboutView(){
  const repo='https://github.com/KJesko/codex-usage';
  const link=(url,title,description)=>`<a class="about-link" href="${url}" target="_blank" rel="noopener noreferrer"><strong>${title}<span aria-hidden="true">↗</span></strong><span>${description}</span></a>`;
  return `<div class="settings-body about-content"><div class="about-hero"><span class="about-logo" aria-hidden="true">&gt;_</span><div><h2>Codex Usage</h2><p>本地运行的 Codex 用量看板</p></div><span class="badge" data-about-version>${aboutVersion?'v'+esc(aboutVersion):'正在读取版本…'}</span></div><div class="about-tags"><span>中文 / English</span><span>本地隐私</span><span>多机器汇总</span></div>
  <div class="about-author"><span>开发与维护</span><a href="https://github.com/KJesko" target="_blank" rel="noopener noreferrer">KJesko ↗</a><p>按项目、会话和模型查看用量与参考成本，跟踪账号额度与重置，通过 SSH 汇总多台机器。</p></div>
  <div class="about-links">${link(repo,'开源仓库','查看源代码、参与贡献')}${link(repo+'/releases','版本与更新','下载发布版本、查看更新说明')}${link(repo+'/issues','问题反馈','报告问题或提出功能建议')}${link(repo+'/blob/main/docs/SETUP.md','安装与使用','配置账号、日志目录和后台服务')}${link('https://kjesko.github.io/codex-usage/','在线演示','使用模拟数据体验功能')}${link(repo+'/blob/main/SECURITY.md','安全与隐私','了解数据边界与安全反馈方式')}</div>
  <div class="about-note"><h3>反馈前准备</h3><p>请附上当前版本、操作系统、复现步骤和脱敏截图。不要提交登录凭据、密钥或包含隐私的完整日志。</p></div>
  <div class="about-credits"><h3>开源与许可证</h3><p>采用 <a href="${repo}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>。项目来源见 <a href="${repo}/blob/main/README.md" target="_blank" rel="noopener noreferrer">README</a>。</p><p>独立社区项目，与 OpenAI 无隶属关系。API 等价成本仅供参考，不是订阅账单。</p></div></div>`;
}
async function readAboutVersion(){
  if(aboutVersion||aboutVersionPending)return;
  aboutVersionPending=true;
  try{const result=await api('/api/health');aboutVersion=result.version||null;document.querySelectorAll('[data-about-version]').forEach(el=>el.textContent=aboutVersion?'v'+aboutVersion:'版本未知');}
  catch(_){document.querySelectorAll('[data-about-version]').forEach(el=>el.textContent='版本暂不可用');}
  finally{aboutVersionPending=false;}
}
function mountSettingsNavigation(){
  const content=$('content'),grid=content.querySelector('.settings-grid');
  const scope=document.createElement('section');scope.className='panel scope-settings';scope.innerHTML='<div class="panel-head"><h2>统计范围</h2></div><div class="settings-body"><p>选择统计时间、机器、项目、模型和账号，应用到用量分析页面。</p><div id="settingsFilterSlot"></div></div>';content.append(scope);
  const groups=[['start','开始使用',content.querySelector('.setup-panel')],['appearance','外观与偏好',content.querySelector('.appearance-panel')],['data','数据来源',$('settingsForm')?.closest('section')],['coverage','数据覆盖情况',grid?.children[1]],['background','后台服务',$('backgroundStatus')?.closest('section')],['about','关于',content.querySelector('.settings-grid + section')]];
  const about=groups.find(([key])=>key==='about')[2];if(about)about.innerHTML=aboutView();readAboutVersion();
  const dataGroup=document.createElement('div');dataGroup.className='data-settings-group';dataGroup.append(groups.find(([key])=>key==='data')[2],scope);const remote=content.querySelector('.remote-panel');if(remote)dataGroup.append(remote);groups.find(([key])=>key==='data')[2]=dataGroup;
  const coverageGroup=document.createElement('div');coverageGroup.className='coverage-settings-group';coverageGroup.append(groups.find(([key])=>key==='coverage')[2]);groups.find(([key])=>key==='coverage')[2]=coverageGroup;
  const shell=document.createElement('div');shell.className='settings-shell';
  const nav=document.createElement('nav');nav.className='settings-navigation';nav.setAttribute('aria-label','设置分类');
  nav.innerHTML='<button type="button" class="settings-back" data-settings-back>← 返回</button><h2>设置</h2>'+ groups.map(([key,label])=>`<button type="button" data-settings-section="${key}">${label}</button>`).join('');
  const pages=document.createElement('div');pages.className='settings-pages';
  for(const [key,,panel] of groups){if(panel){panel.dataset.settingsPage=key;pages.append(panel);}}
  document.querySelector('.sidebar .settings-navigation')?.remove();document.querySelector('.sidebar').prepend(nav);shell.append(pages);content.replaceChildren(shell);$('filterPopover').removeAttribute('popover');$('filterPopover').classList.add('filter-inline');$('settingsFilterSlot').append($('filterPopover'));if(!filterDraft)filterDraft={...state,since:state.since||data?.range.since||settings?.usage_since||offsetDate(dateInZone(),-29),until:state.until||data?.range.until||dateInZone()};updateFilterControls();selectSettingsSection(settingsSection);
}
function render() {
  const search=$('sessionSearch');
  const searchSelection=state.view==='sessions' && search && search===document.activeElement
    ? {start:search.selectionStart,end:search.selectionEnd,direction:search.selectionDirection} : null;
  if (!data && state.view!=='quota') return;
  const paceFocus=quotaPaceFocus();
  const paceOpened=[...document.querySelectorAll('#quotaPace details')].map(el=>el.open);
  let html;
  if (state.view==='overview') html=state.tab==='summary'?metrics(data.summary)+ActivityHeatmap.panel():unknownNotice()+UsageInsights.comparisonPanel()+trendPanel(data.timeline)+`<div class="lower-grid">${ranking()}${quickPeriods()}</div><div class="price-spacer">${notice()}</div>`;
  if (state.view==='projects') html=ProjectTreemap.panel()+UsageInsights.cachePanel(data)+projectView()+missingProjectsView()+`<div class="price-spacer">${notice()}</div>`;
  if (state.view==='sessions') html=sessionView()+`<div class="price-spacer">${notice()}</div>`;
  if (state.view==='models') html=unknownNotice()+ModelCharts.panel()+UsageInsights.cachePanel(data)+`<section class="panel"><div class="table-toolbar"><h2>模型用量汇总</h2><span class="subtle">当前筛选范围 · 不受图表勾选影响</span></div>${modelTable(data.models)}</section><div class="price-spacer">${notice()}</div>`;
  if (state.view==='pricing') html=pricingView();
  if (state.view==='quota') html=QuotaPage.panel();
  if (state.view==='settings') html=settingsView()+remoteSettingsView();
  releaseCharts($('content'));
  UsageInsights.release($('content'));
  ModelCharts.release();
  ActivityHeatmap.release();
  ProjectTreemap.release();
  parkPreferenceControls();
  $('content').innerHTML=(!data?.coverage?.files && !data?.summary?.events && state.view==='overview'?`<section class="panel setup-panel"><div class="settings-body"><h2>先接入用量数据</h2><div>尚未读到本地日志。配置 Codex 数据目录即可查看项目和会话 Token，额度连接可以稍后完成。</div><button class="button primary" data-view="settings">配置数据来源</button></div></section>`:'')+html;
  if (state.view==='overview' && state.tab==='summary') { ActivityHeatmap.mount($('tokenActivity'),data); }
  if (state.view==='overview' && state.tab==='analysis') { mountChart($('trendChart'),data.timeline,state.metric);UsageInsights.drawComparison(data); }
  if (state.view==='quota') {QuotaPage.render(accountData);renderQuotaPace(paceFocus,paceOpened);}
  if (state.view==='projects') ProjectTreemap.mount($('projectTreemap'),data);
  if (state.view==='models') ModelCharts.mount($('modelExplorer'),data);
  if (state.view==='projects' || state.view==='models') UsageInsights.mountCache($('content'),data);
  if (state.view==='sessions') {
    $('sessionSort').value=state.sort; sessionRows();
    if(searchSelection) {
      $('sessionSearch').focus({preventScroll:true});
      $('sessionSearch').setSelectionRange(searchSelection.start,searchSelection.end,searchSelection.direction);
    }
  }
  if(state.view==='settings'){$('content').insertAdjacentHTML('beforeend',backgroundPanel());paintSetupAccount();paintBackground();readBackground();mountSettingsNavigation();}
  CompactTables.mount($('content'));
  for(const [id,value] of Object.entries(settingsAutosave.drafts())){if($(id))$(id).value=value;}
  paintSaveFeedback();paintDataStatus();
}
function setView(view, tab='summary') {
  if(view==='settings' && state.view!=='settings'){settingsReturnView=state.view;settingsReturnTab=state.tab;}
  if($('filterPopover').matches(':popover-open'))$('filterPopover').hidePopover();
  // The project index is the way out of a single project's session drill-down.
  if (view === 'projects') { state.project = ''; state.page = 1; }
  if(view!=='settings')filterDraft=null;
  state.view=view;if(view==='overview')state.tab=tab;
  updateControls(); syncURL(true); render(); window.scrollTo({top:0,behavior:'instant'});
  if(view!=='quota' && (view!=='settings' || !data))load();
}
async function showSession(id) {
  sessionDetailController?.abort();
  const controller = new AbortController();
  sessionDetailController = controller;
  const dialog = $('sessionDialog');
  releaseCharts($('sessionDetail'));
  $('sessionDetail').innerHTML='<h2 id="sessionTitle">正在读取会话…</h2>';
  dialog.showModal();
  dialog.scrollTop=0;
  try {
    const detail=await api('/api/data?'+params({session:id,grain:'day'}), {signal:controller.signal});
    if (controller.signal.aborted || !dialog.open) return;
    const s=detail.sessions[0];
    if (!s) { $('sessionDetail').innerHTML='<h2 id="sessionTitle">当前范围内没有该会话的用量</h2>'; return; }
    const sum=detail.summary;
    $('sessionDetail').innerHTML=`<h2 id="sessionTitle">${esc(s.title)}</h2><div class="dialog-meta">${esc(s.id)} · ${s.project_names.map(esc).join(' / ')}<br>仅显示 ${detail.range.since} 至 ${detail.range.until} 内符合筛选条件的用量</div><div class="detail-metrics">${metric('总 Tokens',compact(sum.total),number(sum.total)+' tokens','tokens')}${metric('API 等价',usd(sum.known_cost),sum.unpriced_events?'包含尚未计价的用量':'按当前 Standard 价格','dollar',true)}${metric('缓存命中率',percent(sum.cache_rate),number(sum.events)+' 次用量事件','cache')}</div><section class="panel"><div class="panel-head"><h2>会话用量趋势 · 按天</h2></div><div class="chart-wrap"><div class="chart-host" id="sessionChart"></div></div></section><section class="panel price-spacer">${modelTable(detail.models)}</section><div class="notice price-spacer">${icon('info')}<div>未缓存输入 ${usd(sum.input_cost)} + 缓存读取 ${usd(sum.cached_cost)} + 缓存写入 ${usd(sum.write_cost)} + 输出 ${usd(sum.output_cost)}${sum.unpriced_events?'（仅已定价部分）':''}。</div></div>`;
    mountChart($('sessionChart'),detail.timeline);
    CompactTables.mount($('sessionDetail'));
  } catch(e) {
    if (e.name!=='AbortError' && !controller.signal.aborted && dialog.open) $('sessionDetail').innerHTML=`<h2 id="sessionTitle">读取失败</h2><p role="alert">${esc(e.message)}</p>`;
  }
}
async function showProject(id) {
  projectDetailController?.abort();
  const controller = new AbortController();
  projectDetailController = controller;
  projectDetailReport = null;
  projectDetailMetric = 'tokens';
  const dialog = $('projectDialog');
  releaseCharts($('projectDetail'));
  $('projectDetail').innerHTML='<h2 id="projectTitle">正在读取项目…</h2>';
  dialog.showModal();
  dialog.scrollTop=0;
  try {
    // Project totals aggregate every matching session, always at daily granularity.
    const detail=await api('/api/data?'+params({project:id,grain:'day'}), {signal:controller.signal});
    if (controller.signal.aborted || !dialog.open) return;
    const p=detail.projects.find(p=>p.id===id);
    if (!p) { $('projectDetail').innerHTML='<h2 id="projectTitle">当前范围内没有该项目的用量</h2>'; return; }
    projectDetailReport=detail;
    const sum=detail.summary;
    const timezone=detail.timezone==='Asia/Shanghai'?'北京时间':detail.timezone;
    $('projectDetail').innerHTML=`<div class="project-detail-heading"><h2 id="projectTitle">${esc(p.name)}</h2><button class="button small" data-project="${esc(id)}">查看项目会话 ↗</button></div>
      <div class="dialog-meta">${esc(p.source_name)} · ${esc(p.path)}<br>${detail.range.since} — ${detail.range.until} · ${esc(timezone)} · 按当前筛选合计项目内所有会话</div>
      <div class="detail-metrics">${metric('总 Tokens',compact(sum.total),number(sum.total)+' tokens','tokens')}${metric('API 等价',usd(sum.known_cost),sum.unpriced_events?'另有 '+compact(sum.unpriced_tokens)+' tokens 待定价':'按当前 Standard API 价格折算','dollar',true)}${metric('活跃会话',number(sum.sessions),'缓存命中率 '+percent(sum.cache_rate),'chat')}</div>
      <section class="panel"><div class="panel-head"><h3>项目用量趋势 · 按天</h3><div class="metric-switch" role="group" aria-label="项目趋势指标"><button data-project-metric="tokens" class="selected" aria-pressed="true">Tokens</button><button data-project-metric="cost" aria-pressed="false">API 等价 USD</button></div></div><div class="chart-wrap"><div class="chart-host" id="projectChart"></div></div><div class="chart-legend" id="projectChartLegend"></div></section>
      <div class="price-spacer">${timelineTable(detail.timeline,'day',detail.timezone)}</div>`;
    drawProjectChart();
    CompactTables.mount($('projectDetail'));
  } catch(e) {
    if (e.name!=='AbortError' && !controller.signal.aborted && dialog.open) $('projectDetail').innerHTML=`<h2 id="projectTitle">读取失败</h2><p role="alert">${esc(e.message)}</p>`;
  }
}
function drawProjectChart() {
  if (!projectDetailReport || !$('projectDialog').open) return;
  $('projectDetail').querySelectorAll('[data-project-metric]').forEach(button=>{
    const active=button.dataset.projectMetric===projectDetailMetric;
    button.classList.toggle('selected',active);
    button.setAttribute('aria-pressed',String(active));
  });
  $('projectChartLegend').innerHTML=projectDetailMetric==='tokens'
    ? [['uncached','未缓存输入'],['cached','缓存读取'],['write','缓存写入'],['output','输出']].map(([key,label])=>`<span class="legend-item"><i style="background:${colors[key]}"></i>${label}</span>`).join('')
    : '<span data-help>仅绘制已定价部分；未知价格不视为零成本</span>';
  releaseCharts($('projectDetail'));
  mountChart($('projectChart'),projectDetailReport.timeline,projectDetailMetric);
}
async function saveSettings(next) {
  const patch=Object.fromEntries(Object.entries(next).filter(([key,value])=>!['csrf','setup'].includes(key)&&JSON.stringify(value)!==JSON.stringify(settings[key])));
  if(Object.keys(patch).length)await persistSettingsPatch(patch);
  renderAccount();
  await load(true);
}
function persistSettingsPatch(patch){
  const save=()=>api('/api/settings/patch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':settings.csrf},body:JSON.stringify(patch)}).then(current=>{settings={...settings,...current};});
  const result=settingsWrite.then(save);settingsWrite=result.catch(()=>{});return result;
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button,[data-project],[data-project-detail],[data-session]'); if(!b) return;
  if(UsageInsights.handle(b))return;
  if(b.dataset.defaultSource!==undefined && settings.setup){$('sourcePaths').value=settings.setup.default_source;$('sourcePaths').dispatchEvent(new Event('input',{bubbles:true}));$('sourcePaths').focus();}
  if(b.dataset.localTimezone!==undefined){const zone=Intl.DateTimeFormat().resolvedOptions().timeZone,select=$('settingsTimezone');if(zone){if(![...select.options].some(o=>o.value===zone))select.add(new Option(zone,zone));select.value=zone;}}
  if(b.dataset.browserLogin!==undefined)beginBrowserLogin();
  if(b.dataset.cancelAccountLogin!==undefined)beginBrowserLogin(true);
  if(b.dataset.accountLogin!==undefined)beginBrowserLogin();
  if(b.dataset.accountLogout!==undefined){$('logoutError').textContent='';$('logoutDialog').showModal();}
  if(b.dataset.cancelLogout!==undefined)$('logoutDialog').close();
  if(b.dataset.confirmLogout!==undefined){
    const dialog=$('logoutDialog');
    if(dialog.dataset.busy==='true')return;
    dialog.dataset.busy='true';dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
    accountGeneration++;
    try{accountData=await api('/api/account/logout',{method:'POST',headers:{'X-CSRF-Token':settings.csrf}});renderAccount();dialog.close();}
    catch(error){$('logoutError').textContent=error.message;}
    finally{dialog.dataset.busy='false';dialog.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }
  if(b.dataset.pickSource!==undefined)openSourcePicker();
  if(b.dataset.setupSource!==undefined){selectSettingsSection('data');$('sourcePaths')?.focus();$('sourcePaths')?.scrollIntoView({block:'center'});}
  if(b.dataset.setupRemote!==undefined){selectSettingsSection('remote');const field=$('remoteForm')?.querySelector('[name=host]');field?.focus();field?.scrollIntoView({block:'center'});}
  if(b.dataset.parentSource!==undefined){const input=$('sourcePaths');input.value=input.value.split('\n').map(path=>path.trim()===b.dataset.parentSource?b.dataset.suggestedSource:path).join('\n');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
  if(b.dataset.checkSources!==undefined){
    const host=$('sourceCheckResult'), paths=$('sourcePaths').value.split('\n').map(x=>x.trim()).filter(Boolean);
    b.disabled=true;host.textContent='正在检查目录…';
    try{
      const result=await api('/api/setup/check',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':settings.csrf},body:JSON.stringify({sources:paths})});
      if(paths.join('\n')!==$('sourcePaths').value.split('\n').map(x=>x.trim()).filter(Boolean).join('\n'))return;
      const messages={ready:'已识别 Codex 目录；保存后读取用量，目录识别不代表已有 Token 记录。',child:'请选择上一级 Codex 主目录：',missing:'目录不存在，请检查路径或连接磁盘。',file:'这是文件，请填写 Codex 主目录。',unreadable:'目录无法读取，请检查当前用户的访问权限。',no_logs:'未识别到日志目录；请确认不是项目源码目录，或先在 Codex 中完成一次本地会话。'};
      host.innerHTML='<ul>'+result.sources.map(row=>`<li><code>${esc(row.path)}</code><div>${esc(messages[row.status]||row.status)} ${row.suggested?`${esc(row.suggested)} <button type="button" class="text-button" data-parent-source="${esc(row.path)}" data-suggested-source="${esc(row.suggested)}">使用上一级目录</button>`:''}</div></li>`).join('')+'</ul>';
    }catch(error){host.textContent=error.message;}finally{b.disabled=false;}
  }
  if(b.dataset.view) setView(b.dataset.view);
  if(b.dataset.overviewTab)setView('overview',b.dataset.overviewTab);
  if(b.dataset.rangeJump) { state.range=b.dataset.rangeJump;state.page=1;updateControls();syncURL(true);load(); }
  if(b.dataset.range) {
    if(!filterDraft)return;
    filterDraft.range=b.dataset.range;
    $('filterError').hidden=true;updateFilterControls();
  }
  if(b.dataset.grain) { state.grain=b.dataset.grain;syncURL();load(); }
  if(b.dataset.metric) { state.metric=b.dataset.metric;render(); }
  if(b.dataset.projectDetail) showProject(b.dataset.projectDetail);
  if(b.dataset.projectMetric) { projectDetailMetric=b.dataset.projectMetric;drawProjectChart(); }
  if(b.dataset.project) { if($('projectDialog').open)$('projectDialog').close();state.project=b.dataset.project;state.page=1;state.search='';setView('sessions'); }
  if(b.dataset.session) showSession(b.dataset.session);
  if(b.dataset.page) { state.page+=b.dataset.page==='next'?1:-1;sessionRows(); }
  if(b.dataset.resetPrice) {
    try { const prices={...settings.prices};delete prices[b.dataset.resetPrice];await saveSettings({...settings,prices});notify('已恢复默认价格'); }
    catch(err) { failure(err.message); }
  }
  if(b.id==='syncRemotes') {
    b.disabled=true;
    try {await api('/api/remotes/sync',{method:'POST',headers:{'X-CSRF-Token':settings.csrf}});await pollRemotes();notify('已开始同步远程用量');}
    catch(err){failure(err.message);b.disabled=false;}
  }
  if(b.dataset.removeRemote) {
    try {await saveSettings({...settings,remotes:settings.remotes.filter(r=>r.id!==b.dataset.removeRemote)});notify('已移除远程数据源');}
    catch(err){failure(err.message);}
  }
  if(b.dataset.toggleRemote) {
    try {await saveSettings({...settings,remotes:settings.remotes.map(r=>r.id===b.dataset.toggleRemote?{...r,enabled:!r.enabled}:r)});}
    catch(err){failure(err.message);}
  }
});
document.addEventListener('input',e=>{
  if(e.target.id==='sessionSearch') {state.search=e.target.value;state.page=1;sessionRows();}
  if(filterDraft && ['since','until'].includes(e.target.id)){filterDraft[e.target.id]=e.target.value;$('filterError').hidden=true;}
});
document.addEventListener('change',e=>{
  if(filterDraft && ['project','model','account','source'].includes(e.target.id)) {filterDraft[e.target.id]=e.target.value;if(e.target.id==='source')filterDraft.project='';updateFilterControls();renderRemoteStatus(data?.remotes||[]);}
  if(e.target.id==='sessionSort') {state.sort=e.target.value;sessionRows();}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='remoteForm') {
    e.preventDefault();const form=new FormData(e.target),button=e.target.querySelector('button');button.disabled=true;
    const remote={name:form.get('name').trim(),host:form.get('host').trim(),path:form.get('path').trim(),interval:Number(form.get('interval')),enabled:true};
    try {await saveSettings({...settings,remotes:[...(settings.remotes||[]),remote]});e.target.reset();button.disabled=false;notify('远程服务器已添加，开始同步');}
    catch(err){failure(err.message);button.disabled=false;}
  }
  if(e.target.id==='filters') {
    e.preventDefault();if(!filterDraft)return;
    if(filterDraft.range==='custom' && (!filterDraft.since||!filterDraft.until||filterDraft.since>filterDraft.until)){
      $('filterError').textContent='请选择有效的开始和结束日期，结束日期不能早于开始日期。';$('filterError').hidden=false;return;
    }
    for(const key of ['range','source','project','model','account','since','until'])state[key]=filterDraft[key];
    state.page=1;state.search='';filterDraft=null;updateControls();syncURL();load();
  }
  if(e.target.id==='settingsForm') {e.preventDefault();flushSettingsEdits();}
  if(e.target.id==='priceForm') {
    e.preventDefault();const f=new FormData(e.target), price={};
    for(const k of ['input','cached','write','output']) price[k]=Number(f.get(k));
    price.long_context=f.get('long_context')?Number(f.get('long_context')):null;
    const button=e.target.querySelector('button[type=submit]');button.disabled=true;
    try {await saveSettings({...settings,prices:{...settings.prices,[f.get('name').trim()]:price}});notify('价格已保存，用量已重新估算');}
    catch(err){failure(err.message);button.disabled=false;}
  }
});
$('refresh').addEventListener('click',async()=>{refreshAccount(true);try{if(settings.remotes?.length)await api('/api/remotes/sync',{method:'POST',headers:{'X-CSRF-Token':settings.csrf}});load(true);}catch(err){failure(err.message);}});
function clearFilters() { if(filterDraft){filterDraft.project=filterDraft.model=filterDraft.account=filterDraft.source='';updateFilterControls();renderRemoteStatus(data?.remotes||[]);} }
$('clearFilters').addEventListener('click',clearFilters);
function positionFilterPopover() {
  const panel=$('filterPopover');if(!panel.matches(':popover-open'))return;
  const trigger=$('filterButton').getBoundingClientRect(),box=panel.getBoundingClientRect();
  panel.style.left=Math.max(12,Math.min(trigger.right-box.width,innerWidth-box.width-12))+'px';
  panel.style.top=Math.max(12,Math.min(trigger.bottom+8,innerHeight-box.height-12))+'px';
}
$('filterPopover').addEventListener('beforetoggle',e=>{
  const open=e.newState==='open';$('filterButton').setAttribute('aria-expanded',String(open));
  if(open){
    filterDraft={...state,since:state.range==='custom'?state.since:data?.range.since||settings?.usage_since||offsetDate(dateInZone(),-29),until:state.range==='custom'?state.until:data?.range.until||dateInZone()};
    $('filterError').hidden=true;updateFilterControls();renderRemoteStatus(data?.remotes||[]);
  }else filterDraft=null;
});
$('filterPopover').addEventListener('toggle',positionFilterPopover);
window.addEventListener('resize',positionFilterPopover);
document.addEventListener('scroll',positionFilterPopover,true);
window.addEventListener('popstate',()=>{
  if($('filterPopover').matches(':popover-open'))$('filterPopover').hidePopover();
  Object.assign(state,readRoute(location.search),{page:1,search:''});updateControls();render();load();window.scrollTo({top:0,behavior:'instant'});
});
$('closeDialog').addEventListener('click',()=>$('sessionDialog').close());
$('sessionDialog').addEventListener('close',()=>{sessionDetailController?.abort();releaseCharts($('sessionDetail'));});
$('sessionDialog').addEventListener('click',e=>{if(e.target===$('sessionDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('closeProjectDialog').addEventListener('click',()=>$('projectDialog').close());
$('projectDialog').addEventListener('close',()=>{projectDetailController?.abort();projectDetailReport=null;releaseCharts($('projectDetail'));});
$('projectDialog').addEventListener('click',e=>{if(e.target===$('projectDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('theme')?.addEventListener('click',()=>{appearance.mode=document.body.classList.contains('dark')?'light':'dark';saveAppearance();syncModeButtons();});
$('export').addEventListener('click',()=>{const dimension={overview:'timeline',projects:'projects',sessions:'sessions',models:'models'}[state.view];location.href='/api/export?'+params({dimension,...(state.view==='sessions'?{search:state.search,sort:state.sort}:{})});});
async function init() {
  if (state.view === 'projects' && state.project) { state.project = ''; syncURL(); }
  try {settings=await api('/api/settings');if(settings.timezone_mode==='system'){const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;if(zone&&zone!==settings.timezone){await persistSettingsPatch({timezone:zone});}}if(settings.setup?.first_run && !restored.has('view')){state.view='settings';syncURL();}if(settings.usage_since && !restored.has('range'))state.range='all';updateControls();refreshAccount();refreshDataStatus();await load();}
  catch(e){failure('初始化失败：'+e.message);$('loading').hidden=true;}
}
document.addEventListener('click',async e=>{
  if(e.target.closest('#refreshBackground')){readBackground();return;}
  if(!e.target.closest('#toggleBackground')||backgroundBusy||backgroundStatus?.enabled==null)return;
  backgroundBusy=true;paintBackground();
  try{
    backgroundStatus=await api('/api/web-background',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':settings.csrf},body:JSON.stringify({enabled:!backgroundStatus.enabled})});
    backgroundError='';
  }catch(e){backgroundError=e.message||'设置失败，请刷新状态后重试。';}
  finally{backgroundBusy=false;paintBackground();setTimeout(readBackground,2500);}
});
setInterval(()=>{if(!document.hidden&&state.view==='settings')readBackground();},15000);

init();
setInterval(()=>{if(!document.hidden && !['settings','pricing','quota'].includes(state.view) && !$('sessionDialog').open && !$('projectDialog').open)load();},30000);
setInterval(()=>{if(!document.hidden && settings?.remotes?.length && Date.now()>=remotePollAt)pollRemotes();},3000);

function remoteRows(remotes) {
  return remotes.map(r=>`<div class="remote-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.host)} · ${esc(r.root||r.path||'自动发现 Codex 目录')}</small><p>${!r.enabled?'已暂停':r.busy?'正在同步…':r.error?'连接失败，保留上次数据':r.synced_at?'已同步 '+new Date(r.synced_at).toLocaleString('zh-CN',{timeZone:settings.timezone}):'等待首次同步'}${r.synced_at?` · ${r.files} 个日志文件`:''}</p>${r.error?`<p class="remote-error">${esc(r.error)}</p>`:''}</div><div class="remote-actions"><button class="text-button" data-toggle-remote="${esc(r.id)}">${r.enabled?'暂停':'启用'}</button><button class="text-button" data-remove-remote="${esc(r.id)}">移除</button></div></div>`).join('') || '<p class="subtle">还没有远程服务器。添加后可与本机用量一起统计。</p>';
}
function renderRemoteStatus(remotes) {
  const active=remotes.filter(r=>r.enabled);
  const source=(filterDraft||state).source;
  const selected=(data?.options.sources || []).filter(s=>!source || s.id===source);
  $('remoteSummary').hidden=!data;
  $('remoteSummary').innerHTML=`<span class="machine-count">已选 <strong>${selected.length}</strong> 台机器</span>`+selected.map(s=>{
    const remote=active.find(r=>'ssh:'+r.id===s.id);
    const status=s.id==='local'?'本地日志':remote?.busy?'同步中':remote?.error?'离线 / 显示上次数据':remote?.synced_at?'上次同步 '+new Date(remote.synced_at).toLocaleTimeString('zh-CN',{timeZone:settings.timezone}):'等待同步';
    return `<span class="badge ${remote?.error?'remote-error':''}">${esc(s.name)} · ${status}</span>`;
  }).join('')+'<button type="button" class="text-button" data-view="settings">管理服务器 →</button>';
  if($('remoteRows')) QuotaDOM.patch($('remoteRows'),remoteRows(remotes));
  if($('syncRemotes')) $('syncRemotes').disabled=remotes.some(r=>r.busy)||!active.length;
}
async function pollRemotes() {
  if(remoteReading)return;
  remoteReading=true;
  try {
    const remotes=await api('/api/remotes');
    remoteFailures=0;remotePollAt=Date.now()+(remotes.some(row=>row.busy)?3000:15000);
    const previous=(data?.remotes||[]).map(r=>r.synced_at).join('|');
    const current=remotes.map(r=>r.synced_at).join('|');
    if(data)data.remotes=remotes;
    dataSnapshot={...(dataSnapshot||{}),remotes};
    renderRemoteStatus(remotes);
    paintDataStatus();
    if(previous!==current) {
      // Avoid replacing settings inputs while someone is editing them.
      if(!['settings','quota'].includes(state.view) && !$('sessionDialog').open)await load(true);
    }
  }catch(error){remotePollAt=Date.now()+Math.min(60000,5000*2**Math.min(++remoteFailures,4));statusError=error.message;paintDataStatus();}
  finally{remoteReading=false;}
}
function remoteSettingsView() {
  return `<section class="panel remote-panel"><div class="panel-head"><div><h2>远程服务器</h2><p data-help>沿用本机已保存的 SSH 连接；无需在服务器安装程序。</p></div><button class="button" id="syncRemotes">立即同步</button></div><div class="settings-body"><div id="remoteRows">${remoteRows(data.remotes||[])}</div><form id="remoteForm" class="price-form"><label><span>名称</span><input name="name" placeholder="例如 开发服务器" maxlength="80"></label><label class="model-field"><span>SSH 连接名称 / 地址</span><input name="host" placeholder="例如 my-server" required></label><label class="model-field"><span>远程 Codex 目录</span><input name="path" placeholder="留空自动发现，或 ~/.codex"></label><label><span>同步间隔（秒）</span><input name="interval" type="number" min="30" max="86400" value="120" required></label><button type="submit" class="button primary">添加服务器</button></form><p class="inset-note">只在服务器内存中提取用量、会话标题、项目目录和额度；不下载对话正文、不读取 auth.json。本地服务运行时自动同步，断线保留上次结果。需要已验证主机的免密 SSH 和远程 Python 3。</p></div></section>`;
}
function missingProjectsView() {
  const rows=data.missing_projects||[];
  if(!rows.length)return '';
  return `<section class="panel price-spacer"><div class="panel-head"><div><h2>缺少日志的历史项目</h2><p data-help>以下为全部历史元数据，不受日期和模型筛选影响；没有加入上方明细总量。</p></div></div><div class="settings-body help-copy">这些项目有会话记录，但日志已不可读。历史 Token 仅为数据库记录的参考值，无法恢复每天用量、输入 / 输出 / 缓存拆分或美元成本。</div><div class="table-scroll"><table class="data-table"><thead><tr><th>项目 / 目录</th><th>机器</th><th class="num">缺日志会话</th><th class="num">历史 Token 参考</th><th>API 等价</th></tr></thead><tbody>${rows.map(p=>`<tr><td class="title-cell"><strong>${esc(p.name)}</strong><small>${esc(p.path)}</small></td><td>${esc(p.source_name)}</td><td class="num">${p.sessions}</td><td class="num">${p.token_records?number(p.metadata_tokens):'无记录'}</td><td>无法折算</td></tr>`).join('')}</tbody></table></div></section>`;
}

function accountTime(value) {
  return new Date(value).toLocaleString('zh-CN',{timeZone:settings?.timezone || 'America/Los_Angeles',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function remainingTime(seconds) {
  if(seconds<=0)return '重置时间已到，等待更新';
  const mins=Math.ceil(seconds/60),days=Math.floor(mins/1440),hours=Math.floor(mins%1440/60),rest=mins%60;
  return days?`${days} 天 ${hours} 小时后重置`:hours?`${hours} 小时 ${rest} 分钟后重置`:`${rest} 分钟后重置`;
}
function quotaPaceFocus() {
  const active=document.activeElement;
  if(!active?.closest('#quotaPace'))return null;
  if(active.id.startsWith('quotaRange'))return {rangeControl:active.id};
  if(active.dataset.paceView)return {view:active.dataset.paceView};
  if(active.matches('[data-range-chart], [data-range-action]'))return {rangeChart:active.closest('.quota-range-window').dataset.rangeGroup,rangeAction:active.dataset.rangeAction};
  const rangePoint=active.closest('[data-range-detail]');
  if(rangePoint)return {rangeGroup:rangePoint.closest('.quota-range-window').dataset.rangeGroup,rangeDetail:rangePoint.getAttribute('aria-label')};
  const point=active.closest('.pace-day');
  return point?{day:point.dataset.paceDay,at:point.dataset.paceAt,window:point.dataset.paceWindow}:active.hasAttribute('data-refresh-quota')?{refresh:true}:null;
}
function renderQuotaPace(focus=quotaPaceFocus(), opened=null) {
  const host=$('quotaPace');if(!host)return;
  if(accountData?.signed_out){QuotaTools.display(accountData);QuotaDOM.patch(host,'');return;}
  if(host.dataset.historyScope===accountData?.history_scope && QuotaRange.interacting(host))return;
  // Do not close a native date picker or overwrite a draft on a background poll.
  if(document.activeElement?.matches('#quotaRangeForm input, #quotaRangeForm select') && host.dataset.historyScope===accountData?.history_scope)return;
  host.dataset.historyScope=accountData?.history_scope||'';
  opened ??= [...host.querySelectorAll('details')].map(el=>el.open);
  const disclosureFocus=[...host.querySelectorAll('details>summary')].indexOf(document.activeElement);
  const displayed=QuotaTools.display(accountData);
  const html=UsageInsights.pacePanel(displayed,{filters:QuotaTools.rangeControls(),collection:QuotaTools.collectionMarkup(accountData,data)});
  QuotaDOM.patch(host,html,element=>element.matches('[data-range-chart], [data-range-viewport], [data-range-action], .pace-chart-host'));
  UsageInsights.mountPace(host,displayed);
  host.querySelectorAll('details').forEach((el,i)=>{el.open=Boolean(opened[i]);});
  const target=focus?.view?[...host.querySelectorAll('[data-pace-view]')].find(button=>button.dataset.paceView===focus.view):focus?.refresh?host.querySelector('[data-refresh-quota]'):focus?[...host.querySelectorAll('.pace-day')].find(point=>point.dataset.paceDay===focus.day && (!focus.at || point.dataset.paceAt===focus.at) && point.dataset.paceWindow===focus.window):null;
  target?.focus({preventScroll:true});
  if(focus?.rangeControl)host.querySelector('#'+focus.rangeControl)?.focus({preventScroll:true});
  if(focus?.rangeChart){
    const section=[...host.querySelectorAll('[data-range-group]')].find(el=>el.dataset.rangeGroup===focus.rangeChart);
    const control=focus.rangeAction?[...(section?.querySelectorAll('[data-range-action]')||[])].find(el=>el.dataset.rangeAction===focus.rangeAction):section?.querySelector('[data-range-chart]');
    control?.focus({preventScroll:true});
  }
  if(focus?.rangeGroup)[...host.querySelectorAll('[data-range-detail]')].find(el=>el.closest('.quota-range-window').dataset.rangeGroup===focus.rangeGroup && el.getAttribute('aria-label')===focus.rangeDetail)?.focus({preventScroll:true});
  if(disclosureFocus>=0)host.querySelectorAll('details>summary')[disclosureFocus]?.focus({preventScroll:true});
}
function renderAccount() {
  const q=accountData;if(!q)return;
  paintBrowserLogin();
  paintSetupAccount();
  if(state.view==='quota')$('updated').textContent=q.fetched_at?'额度更新于 '+accountTime(q.fetched_at):'等待首次额度读取';
  const plan=q.account?.plan,planName=plan?String(plan).replace(/\b\w/g,c=>c.toUpperCase()):'';
  paintIdentity();
  $('sidebarPlan').textContent=q.browser_login?.status==='success'&&!q.fetched_at?'正在同步额度':q.signed_out?'点击登录':planName?`ChatGPT ${planName}`:q.problem?.kind==='signed_out'?'需要登录':q.fetched_at?'套餐信息暂不可用':'暂不可用';
  const old=q.stale || Boolean(q.transportError),status=q.signed_out?'未登录':q.busy?'正在更新':old?(q.problem||q.transportError?'更新失败':'等待更新'):q.fetched_at?'已连接':'等待连接';
  const windows=q.windows || [],prefix=windows.some(w=>w.bucket!=='codex');
  $('accountQuota').classList.toggle('quota-stale',old);
  const zoneLabel=settings?.timezone === 'Asia/Shanghai' ? '北京时间' : settings?.timezone || '';
  const needsLogin=q.signed_out || q.problem?.kind==='signed_out' || (!q.account && q.browser_login?.status!=='success');
  const refreshFocused = document.activeElement?.id === 'refreshAccount';
  const quotaScroll = $('accountQuota').scrollTop;
  $('accountQuota').innerHTML=`<div class="account-heading"><h2 id="accountQuotaTitle">${esc(needsLogin?'未登录':q.profile?.label || '当前 Codex 账号')}</h2><button id="refreshAccount" class="icon-button" aria-label="刷新账号额度" title="刷新账号额度" ${q.busy?'disabled':''}>${icon('refresh')}</button></div><p class="account-footnote">${esc(planName||'套餐未知')} · ${status}</p><div class="quota-windows">${windows.map(w=>{const remaining=Number.isFinite(w.remaining_percent)?Math.max(0,Math.min(100,w.remaining_percent)):null;return `<div class="quota-window"><div class="quota-topline"><span class="quota-label">${esc(prefix?w.bucket_name+' · '+w.label:w.label)}</span><strong class="quota-value">${remaining==null?'—':number(remaining)+'%'}<span>剩余</span></strong></div><div class="quota-track" ${remaining==null?'':`role="meter" aria-label="${esc(w.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}"`}><span class="${remaining!=null&&remaining<=20?'low':''}" style="width:${remaining??0}%"></span></div><div class="quota-window-meta"><span>${w.resets_at?'下次重置 '+accountTime(w.resets_at*1000):'重置时间未知'}</span>${old?'<span>上次结果</span>':''}</div></div>`;}).join('')||'<p class="quota-empty">等待首次额度读取</p>'}</div>`;
  $('accountQuota').innerHTML=needsLogin?`<div class="account-heading"><h2 id="accountQuotaTitle">未登录</h2></div><p>请登录后查看额度和重置卡，本地日志仍可使用。</p><button class="button primary" data-account-login ${q.browser_login?.status==='starting'?'disabled':''}>${q.browser_login?.status==='starting'?'正在准备登录…':q.browser_login?.status==='waiting'?'继续浏览器登录':'登录账号'}</button>${['starting','waiting'].includes(q.browser_login?.status)?'<button class="text-button" data-cancel-account-login>取消登录</button>':''}${['failed','expired'].includes(q.browser_login?.status)?'<p role="status">登录未完成，请重新点击登录账号。</p>':''}`:$('accountQuota').innerHTML+`<div class="account-session-actions"><button class="button" data-view="quota" popovertarget="accountQuota" popovertargetaction="hide">查看额度与重置 →</button><button class="button account-logout" data-account-logout>退出登录</button></div>`;
  $('accountStatus').innerHTML=`<span class="account-state ${old?'is-stale':''}"><i></i>${status}</span><span class="quota-updated" title="${q.fetched_at?'更新于 '+accountTime(q.fetched_at):''}">${q.fetched_at?new Date(q.fetched_at).toLocaleTimeString('zh-CN',{timeZone:settings?.timezone || 'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hour12:false})+' 更新':''}</span>`;
  if (refreshFocused) $('refreshAccount')?.focus({preventScroll:true});
  $('accountQuota').scrollTop = quotaScroll;
  positionQuotaPopover();
  // Account access must stay usable even if an optional chart/alert script failed to load.
  if(typeof QuotaTools!=='undefined')QuotaTools.render(q);
  if(typeof QuotaPage!=='undefined')QuotaPage.render(q);
  if(typeof QuotaTools!=='undefined' && typeof QuotaRange!=='undefined' && typeof QuotaDOM!=='undefined' && typeof UsageInsights!=='undefined')renderQuotaPace();
}
async function refreshAccount(force=false) {
  if(accountPending)return;
  accountPending=true;clearTimeout(accountTimer);
  const generation=accountGeneration;
  try {
    const response=await sessionFetch(force?'/api/account/refresh':'/api/account',force?{method:'POST',headers:{'X-CSRF-Token':settings.csrf}}:{});
    if(!response.ok)throw new Error('账号连接暂时不可用，请重试。');
    const next=await response.json();
    if(generation!==accountGeneration)return;
    accountData=next;renderAccount();
  } catch(e) {
    if(generation!==accountGeneration)return;
    accountData={...(accountData || {windows:[]}),busy:false,stale:true,transportError:'无法连接额度服务，请稍后刷新。'};renderAccount();
  } finally {
    accountPending=false;
    paintDataStatus();
    accountTimer=setTimeout(()=>{
      // Opening the login tab hides this page; keep polling until that tab can
      // navigate to the official URL and the login result has been received.
      const loginActive=['starting','waiting'].includes(accountData?.browser_login?.status);
      if(!document.hidden || loginActive || (loginWindow && !loginWindow.closed))refreshAccount();
    },accountData?.busy || ['starting','waiting'].includes(accountData?.browser_login?.status)?1200:15000);
  }
}
document.addEventListener('click',e=>{if(e.target.closest('#refreshAccount, [data-refresh-quota]'))refreshAccount(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && settings)refreshAccount();});
setInterval(()=>{if(!document.hidden)document.querySelectorAll('[data-reset-at]').forEach(el=>el.textContent=remainingTime(Number(el.dataset.resetAt)-Date.now()/1000));},1000);

// A native popover provides outside-click dismissal and Escape handling.
function positionQuotaPopover() {
  const panel=$('accountQuota');
  if (!panel.matches(':popover-open')) return;
  const profile=$('profileButton').getBoundingClientRect();
  const width=panel.offsetWidth,height=panel.offsetHeight;
  const left=Math.max(12,Math.min(profile.left,window.innerWidth-width-12));
  const top=Math.max(12,Math.min(profile.top-height-10,window.innerHeight-height-12));
  panel.style.left=left+'px'; panel.style.top=top+'px';
}
$('accountQuota').addEventListener('toggle',e=>{
  $('profileButton').setAttribute('aria-expanded', String(e.newState==='open'));
  positionQuotaPopover();
});
window.addEventListener('resize',positionQuotaPopover);
document.addEventListener('scroll',positionQuotaPopover,true);

setInterval(()=>{if(!document.hidden && state.view==='pricing' && ![...document.querySelectorAll('#priceForm input')].some(input=>input.value || input===document.activeElement) && !document.querySelector('#content details[open]'))load();},60000);

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-fetch-price]');
  if(!button||button.disabled)return;
  button.disabled=true;button.textContent='查询中…';
  try{
    await api('/api/pricing/fetch',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':settings.csrf},body:JSON.stringify({model:button.dataset.fetchPrice})});
    priceFetchMessage='已提交查询；官方未公布的价格仍保留待补价。';
    await load();
    for(let i=0;i<20 && (i===0 || data.pricing.sync?.busy);i++){
      await new Promise(resolve=>setTimeout(resolve,2000));
      if(state.view!=='pricing' || document.querySelector('#priceForm input:focus') || [...document.querySelectorAll('#priceForm input')].some(input=>input.value))break;
      await load();
    }
  }catch(error){priceFetchMessage=error.message;if(state.view==='pricing')render();}
});

$('logoutDialog').addEventListener('cancel',event=>{if(event.currentTarget.dataset.busy==='true')event.preventDefault();});
document.addEventListener('change',event=>{const key=event.target.dataset?.appearance;if(!Object.hasOwn(appearanceDefaults,key))return;appearance[key]=key==='size'?Math.max(12,Math.min(20,Math.round(Number(event.target.value)||15))):event.target.value;if(key==='size')event.target.value=appearance.size;saveAppearance();if(key==='accent')document.querySelectorAll('[data-accent]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.accent===appearance.accent)));if(key==='font'){const field=document.querySelector('[data-appearance="customFont"]');if(field){field.disabled=appearance.font!=='custom';field.closest('[data-custom-font-field]').hidden=appearance.font!=='custom';}}});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-accent],[data-appearance-reset]');if(!button)return;
  if(button.dataset.accent)appearance.accent=button.dataset.accent;else appearance={...appearanceDefaults};
  saveAppearance();
  const panel=document.querySelector('.appearance-panel');
  if(panel){
    panel.outerHTML=appearanceView();
    for(const [id,value] of Object.entries(settingsAutosave.drafts())){if($(id))$(id).value=value;}
    paintSaveFeedback();
  }
});

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-detect-fonts]');if(!button)return;
  const status=document.getElementById('fontDetectionStatus');
  if(!window.queryLocalFonts){status.textContent='浏览器不支持完整字体列表，已检测常见字体；其他字体可手动输入。';return;}
  button.disabled=true;
  try{const fonts=await window.queryLocalFonts();detectedFonts=[...new Set(fonts.map(font=>font.family))];const menu=document.querySelector('.font-menu');if(menu)menu.innerHTML=fontOptions();status.textContent='字体列表已更新。';}
  catch(_){status.textContent='未获得字体访问权限，仍可使用已检测字体或手动输入。';}
  finally{button.disabled=false;}
});

document.addEventListener('click',event=>{
  const picker=document.querySelector('.font-picker');if(!picker)return;
  if(event.target.closest('.font-picker summary')){event.preventDefault();picker.open=!picker.open;return;}
  const option=event.target.closest('[data-font-option]');
  if(option){appearance.font=option.dataset.fontOption;saveAppearance();picker.querySelector('.font-menu').innerHTML=fontOptions();picker.querySelector('#fontPickerValue').textContent=fontLabel();picker.open=false;picker.querySelector('summary').focus();const field=document.querySelector('[data-custom-font-field]');field.hidden=appearance.font!=='custom';field.querySelector('input').disabled=appearance.font!=='custom';}
  else if(!picker.contains(event.target))picker.open=false;
});
document.addEventListener('keydown',event=>{
  const picker=event.target.closest('.font-picker');if(!picker)return;
  const options=[...picker.querySelectorAll('[data-font-option]')],index=options.indexOf(document.activeElement);
  if(event.key==='Escape'){picker.open=false;picker.querySelector('summary').focus();event.preventDefault();}
  else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();picker.open=true;
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:index<0?Math.max(0,options.findIndex(o=>o.getAttribute('aria-selected')==='true')):Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1)));
    options[next]?.focus();
  }
});
document.addEventListener('focusin',event=>{const picker=document.querySelector('.font-picker');if(picker&&!picker.contains(event.target))picker.open=false;});

document.addEventListener('click',event=>{
  const mode=event.target.closest('[data-theme-mode]');if(mode){appearance.mode=mode.dataset.themeMode;saveAppearance();syncModeButtons();}
  const custom=event.target.closest('[data-custom-color]');if(custom){const input=document.querySelector('.appearance-color-input');if(input.showPicker)input.showPicker();else input.click();}
  const step=event.target.closest('[data-size-step]');if(step){const input=document.getElementById('appearanceSize');appearance.size=Math.max(12,Math.min(20,(Number(input.value)||15)+Number(step.dataset.sizeStep)));input.value=appearance.size;saveAppearance();}
});

document.addEventListener('click',event=>{const button=event.target.closest('[data-settings-section]');if(button){selectSettingsSection(button.dataset.settingsSection);window.scrollTo({top:0,behavior:'instant'});}});

document.addEventListener('click',event=>{if(event.target.closest('[data-settings-back]'))setView(settingsReturnView,settingsReturnTab);});

document.addEventListener('change',event=>{if(event.target.matches('[data-settings-language]')){const language=$('language');language.value=event.target.value;language.dispatchEvent(new Event('change',{bubbles:true}));}});

// Keep native form values and change events while sharing the themed menu UI.
