'use strict';

const QuotaPage=(()=>{
  let forecast=null,pending=false,lastRequest=0,eventFilter='all',eventLimit=10,scope=null;
  const time=value=>value?accountTime(typeof value==='number'?value*1000:value):'未知';
  const publicHome=typeof document!=='undefined'&&document.documentElement.lang.startsWith('en')?'https://codex-resets.com/':'https://codex-resets.com/zh-CN';
  const labels={official:'官方重置',credit:'手动重置卡重置',scheduled:'7 天周期重置'};
  const eventTitle=e=>e.kind==='scheduled' && e.label!=='每周额度'?'正常周期重置':labels[e.kind]||'额度变化';
  const link=(url,label)=>typeof url==='string'&&/^https:\/\/(?:codex-resets\.com|x\.com|twitter\.com|openai\.com)(?:\/|$)/.test(url)?`<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`:'';
  function panel(){
    return `<div id="quotaCurrent" class="quota-current"></div><div id="quotaPace"></div><section class="panel reset-records"><div class="panel-head"><div><h2>重置记录</h2><p data-help>只记录实际检测到的额度重置，保留 90 天。满额闲置时的截止时间变化不会另记事件。</p></div><label><span class="sr-only">筛选重置事件</span><select id="resetEventFilter" aria-label="筛选重置事件">${[['all','全部重置'],['official','官方重置'],['credit','重置卡重置'],['scheduled','周期重置']].map(([value,label])=>`<option value="${value}" ${eventFilter===value?'selected':''}>${label}</option>`).join('')}</select></label></div><div id="resetEventList" tabindex="0" role="region" aria-label="重置记录"></div><p class="insight-note">偏离正常周期的额度恢复默认归为官方重置；同期卡数减少则归为手动重置卡重置。两种原因都是规则推断，非官方原因回执。卡片过期或同时发卡可能影响归因。</p></section><section class="panel reset-forecast"><div class="panel-head"><div><h2>公开重置动态</h2><p data-help>来自第三方对公开消息的整理，与个人账号实际重置记录分开。</p></div>${link(publicHome,'Codex Resets')}</div><div id="resetForecastBody"></div></section><details class="quota-settings"><summary>额度提醒与采集设置</summary>${QuotaTools.settingsPanel()}</details>`;
  }
  function currentMarkup(q){
    if(q?.signed_out || q?.problem?.kind==='signed_out')return '<section class="panel quota-current-card"><h2>需要登录</h2><p>请登录后查看额度和重置卡，本地日志仍可使用。</p><button class="button primary" data-account-login>浏览器登录</button></section>';
    const credits=q?.reset_credits||{},details=credits.details;
    const old=q?.stale||q?.transportError;
    return `${(q?.windows||[]).map(w=>`<section class="panel quota-current-card"><h2>${esc(w.bucket!=='codex'?w.bucket_name+' · ':'')}${esc(w.label)}</h2><strong>${w.remaining_percent==null?'—':number(w.remaining_percent)+'%'}<small>剩余${old?' · 上次结果':''}</small></strong><div class="quota-track"><span style="width:${w.remaining_percent??0}%"></span></div><p>${w.resets_at?`下次重置 ${time(w.resets_at)}`:'下次重置时间未知'}</p><p>${w.resets_at?`<span data-reset-at="${w.resets_at}">${remainingTime(w.resets_at-Date.now()/1000)}</span>`:''}</p></section>`).join('')}<section class="panel quota-current-card reset-credit-card"><h2>可用重置卡</h2><strong>${credits.available_count==null?'—':number(credits.available_count)}<small>${credits.available_count==null?'接口暂未提供数量':'张'+(old?' · 上次结果':'')}</small></strong><p data-help>随账号额度同步，每 60 秒检查变化。</p>${details?.length?`<details><summary>查看到期时间${details.length<credits.available_count?'（部分）':''}</summary><ul>${details.map((c,i)=>`<li>卡片 ${i+1} · ${c.expires_at?time(c.expires_at)+' 到期':'未提供到期时间'}</li>`).join('')}</ul></details>`:credits.available_count!=null?`<p>${details===null?'接口仅返回数量':'暂无卡片明细'}</p>`:''}</section>`;
  }
  function resetEvents(q,filter=eventFilter){
    return (q?.reset_events||[]).filter(e=>['official','credit','scheduled'].includes(e.kind) && (filter==='all'||e.kind===filter));
  }
  function eventMarkup(e){
    if(!['official','credit','scheduled'].includes(e.kind))return '';
    const inferred=['official','credit'].includes(e.kind);
    const value=`剩余 ${number(100-e.before_used)}% → ${number(100-e.after_used)}%`;
    return `<details class="reset-event" data-event-id="${esc(e.id)}"><summary><span class="reset-event-mark" aria-hidden="true">↻</span><span><strong>${eventTitle(e)}</strong>${inferred?`<span class="badge neutral">${e.kind==='official'?'默认归因':'卡数推断'}</span>`:''}<small>${time(e.at)} 首次检测${e.label?' · '+esc(e.label):''}</small></span><span class="reset-event-value">${value}</span></summary><div class="reset-event-detail"><p>变化发生在 ${time(e.since)} — ${time(e.at)} 之间。${e.confirmed_at && e.confirmed_at!==e.at?`于 ${time(e.confirmed_at)} 再次确认。`:''}</p><p>下次重置时间：${time(e.old_reset)} → ${time(e.new_reset)}${e.old_reset===e.new_reset?'（保持不变）':''}</p>${e.kind==='credit'?`<p>关联卡数 ${e.before_count} → ${e.after_count}；归因按前后 10 分钟内的观测匹配。</p>`:''}<p>${e.kind==='official'?'按你的规则默认归为官方重置；公共公告并不能证明此账号已到账。':'额度恢复会建立新的使用段，Token 和费用统计继续累计。'}</p></div></details>`;
  }

  function renderEvents(q){
    const host=document.getElementById('resetEventList');if(!host)return;
    const scrollTop=host.scrollTop;
    const edge=host.getBoundingClientRect().top;
    const anchor=scrollTop>0?[...host.querySelectorAll('[data-event-id]')].find(el=>el.getBoundingClientRect().bottom>edge):null;
    const anchorId=anchor?.dataset.eventId,anchorOffset=anchor?anchor.getBoundingClientRect().top-edge:0;
    const open=new Set([...host.querySelectorAll('details[open]')].map(el=>el.dataset.eventId));
    const focused=document.activeElement?.closest?.('[data-event-id]')?.dataset.eventId;
    const rows=resetEvents(q);
    const html=(rows.slice(0,eventLimit).map(eventMarkup).join('')||'<p class="reset-empty">还没有检测到匹配的重置。首次同步建立基准，实际额度恢复后会自动记录。</p>')+(rows.length>eventLimit?`<button class="button small reset-more" id="moreResetEvents">查看更多（还有 ${rows.length-eventLimit} 条）</button>`:'');
    QuotaDOM.patch(host,html);
    host.querySelectorAll('details').forEach(el=>{el.open=open.has(el.dataset.eventId);if(el.dataset.eventId===focused)el.querySelector('summary').focus({preventScroll:true});});
    const retained=anchorId?[...host.querySelectorAll('[data-event-id]')].find(el=>el.dataset.eventId===anchorId):null;
    host.scrollTop=retained?host.scrollTop+retained.getBoundingClientRect().top-host.getBoundingClientRect().top-anchorOffset:scrollTop;
  }
  function forecastMarkup(f){
    if(!f)return '<p class="reset-empty">正在读取公开重置动态…</p>';
    const now=Date.now()/1000,scheduled=f.scheduled,latest=f.latest,stats=f.stats||{};
    const past=scheduled?.scheduled_for!=null&&scheduled.scheduled_for<=now;
    const status=f.fresh?'来源已同步':f.problem?'同步暂时失败':f.busy?'正在同步来源':'来源数据已过期';
    const kind=item=>({regular:'常规重置',banked:'发放重置卡'})[item?.reset_type]||'重置消息';
    const announcement=item=>`<details class="reset-update-detail"><summary><span>公告内容</span>${link(item.source,'原帖')}</summary><div class="reset-update-copy"><p>公告时间 ${time(item.at)}</p>${item.text?`<p>${esc(item.text)}</p>`:''}</div></details>`;
    const lastAt=latest?.at??stats.last_reset_at;
    const days=lastAt!=null&&lastAt<=now?Math.round((now-lastAt)/86400*10)/10:null;
    const scheduleTitle=!f.fresh?'上次获取的重置安排':!scheduled?'暂无已安排重置':past?'等待后续确认':'已安排重置';
    return `<div class="reset-updates-body"><div class="reset-updates-status"><span class="${f.fresh?'':'is-stale'}" role="status">${status}${!f.fresh&&f.generated_at?' · 显示上次成功数据':''}</span><span>来源更新 ${time(f.generated_at)}</span></div>${f.problem?`<p class="is-stale">${esc(f.problem)}</p>`:''}<div class="reset-update-grid"><section class="reset-update-card"><div class="reset-update-heading"><h3>${scheduleTitle}</h3>${scheduled?`<span class="badge neutral">${kind(scheduled)}</span>`:''}</div>${scheduled?`<div class="reset-update-timing"><strong class="reset-scheduled-time">${scheduled.scheduled_for?`<span>公告预计时间</span> ${time(scheduled.scheduled_for)}`:'公告未提供执行时间'}</strong>${past?'<span class="is-stale">公告时间已过，来源尚未确认执行。</span>':f.fresh&&scheduled.scheduled_for?`<span>距公告时间约 ${number(Math.ceil((scheduled.scheduled_for-now)/3600))} 小时</span>`:''}</div>${announcement(scheduled)}`:`<p>${f.fresh?'来源当前没有待执行公告。':'同步成功后确认是否有新安排。'}</p>`}</section><section class="reset-update-card"><div class="reset-update-heading"><h3>最近公开重置消息</h3>${latest?`<span class="badge neutral">${kind(latest)}</span>`:''}</div>${latest?`<div class="reset-update-timing"><strong><span>公告时间</span> ${time(latest.at)}</strong></div>${announcement(latest)}`:'<p>暂无公开记录</p>'}</section></div><dl class="reset-update-stats"><div><dt>累计公开记录</dt><dd>${stats.total==null?'—':number(stats.total)+' 次'}</dd></div><div><dt>平均重置间隔</dt><dd>${stats.avg_interval_days==null?'—':number(stats.avg_interval_days)+' 天'}</dd></div><div><dt>距最近公开记录</dt><dd>${days==null?'—':number(days)+' 天'}</dd></div></dl><div class="reset-updates-footer"><span>数据来自 ${link(publicHome,'Codex Resets')}</span>${link(publicHome+'#log-heading','查看完整历史')}</div><p data-help>本页每 5 分钟按需同步公开公告。常规重置与发放重置卡是来源的消息分类，不代表此账号已恢复额度或收到卡片。公告时间已过也不代表重置完成；实际到账以上方账号记录为准。平均间隔仅描述历史，不用于预测下次重置。时间按看板时区显示。</p></div>`;
  }
  async function refreshForecast(){
    if(!document.getElementById('resetForecastBody')||pending||Date.now()-lastRequest<15000)return;
    pending=true;lastRequest=Date.now();
    try{forecast=await api('/api/reset-updates');}catch(_){forecast={...(forecast||{}),fresh:false,problem:'无法读取公开重置动态，请稍后重试。'};}
    finally{pending=false;QuotaDOM.patch(document.getElementById('resetForecastBody'),forecastMarkup(forecast));}
  }
  function render(q){
    const host=document.getElementById('quotaCurrent');if(!host)return;
    if(scope!==q?.history_scope){scope=q?.history_scope;eventFilter='all';eventLimit=10;const filter=document.getElementById('resetEventFilter');if(filter)filter.value='all';}
    const open=host.querySelector('details')?.open,focus=host.querySelector('summary')===document.activeElement;
    QuotaDOM.patch(host,currentMarkup(q));
    const detail=host.querySelector('details');if(detail){detail.open=Boolean(open);if(focus)detail.querySelector('summary').focus({preventScroll:true});}
    const events=document.getElementById('resetEventList');
    if(events)events.closest('section').hidden=Boolean(q?.signed_out);
    renderEvents(q);
    QuotaDOM.patch(document.getElementById('resetForecastBody'),forecastMarkup(forecast));
    refreshForecast();
  }
  if(typeof document!=='undefined'){
    document.addEventListener('change',e=>{if(e.target.id==='resetEventFilter'){eventFilter=e.target.value;eventLimit=10;const list=document.getElementById('resetEventList');if(list)list.scrollTop=0;renderEvents(accountData);}});
    document.addEventListener('click',e=>{if(e.target.closest('#moreResetEvents')){eventLimit+=10;renderEvents(accountData);}});
  }
  return {panel,render,refreshForecast,resetEvents,eventTitle,eventMarkup,forecastMarkup};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=QuotaPage;
