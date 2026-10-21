'use strict';

const QuotaPage=(()=>{
  let forecast=null,pending=false,lastRequest=0,eventFilter='all',eventLimit=10,scope=null;
  const time=value=>value?accountTime(typeof value==='number'?value*1000:value):'未知';
  const labels={official:'官方重置',credit:'手动重置卡重置',scheduled:'7 天周期重置'};
  const eventTitle=e=>e.kind==='scheduled' && e.label!=='每周额度'?'正常周期重置':labels[e.kind]||'额度变化';
  const link=(url,label)=>url?`<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`:'';
  function panel(){
    return `<div id="quotaCurrent" class="quota-current"></div><div id="quotaPace"></div><section class="panel reset-records"><div class="panel-head"><div><h2>重置记录</h2><p data-help>只记录实际检测到的额度重置，保留 90 天。满额闲置时的截止时间变化不会另记事件。</p></div><label><span class="sr-only">筛选重置事件</span><select id="resetEventFilter" aria-label="筛选重置事件">${[['all','全部重置'],['official','官方重置'],['credit','重置卡重置'],['scheduled','周期重置']].map(([value,label])=>`<option value="${value}" ${eventFilter===value?'selected':''}>${label}</option>`).join('')}</select></label></div><div id="resetEventList"></div><p class="insight-note">偏离正常周期的额度恢复默认归为官方重置；同期卡数减少则归为手动重置卡重置。两种原因都是规则推断，非官方原因回执。卡片过期或同时发卡可能影响归因。</p></section><section class="panel reset-forecast"><div class="panel-head"><div><h2>官方重置预测</h2><p data-help>社区观察 · 与个人账号实际重置记录分开。</p></div>${link('https://codex-resets.com','Codex Resets')}</div><div id="resetForecastBody"></div></section><details class="quota-settings"><summary>额度提醒与采集设置</summary>${QuotaTools.settingsPanel()}</details>`;
  }
  function currentMarkup(q){
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
    const open=new Set([...host.querySelectorAll('details[open]')].map(el=>el.dataset.eventId));
    const focused=document.activeElement?.closest?.('[data-event-id]')?.dataset.eventId;
    const rows=resetEvents(q);
    const html=(rows.slice(0,eventLimit).map(eventMarkup).join('')||'<p class="reset-empty">还没有检测到匹配的重置。首次同步建立基准，实际额度恢复后会自动记录。</p>')+(rows.length>eventLimit?`<button class="button small reset-more" id="moreResetEvents">查看更多（还有 ${rows.length-eventLimit} 条）</button>`:'');
    QuotaDOM.patch(host,html);
    host.querySelectorAll('details').forEach(el=>{el.open=open.has(el.dataset.eventId);if(el.dataset.eventId===focused)el.querySelector('summary').focus({preventScroll:true});});
  }
  function forecastMarkup(f){
    if(!f)return '<p class="reset-empty">正在读取公开预测…</p>';
    const signal=f.signal,now=Date.now()/1000,valid=f.probability!=null&&f.fresh&&signal?.expires_at>now;
    const status=valid?'社区估计 · 尚未校准':!f.fresh
      ?f.problem?'预测来源暂时无法连接':f.busy?'正在更新预测来源':'来源数据已过期'
      :!signal?'来源正常 · 暂无预测':signal.expires_at && signal.expires_at<=now
        ?'来源正常 · 上次预测已过期':'来源正常 · 暂无有效概率';
    return `<div class="reset-forecast-body"><div class="forecast-number"><span>${signal?.horizon==='within 24h'?'未来 24 小时':esc(signal?.horizon||'当前预测窗口')}</span><strong>${valid?Math.round(f.probability)+'%':'—'}</strong><span>${status}</span></div><div class="forecast-evidence">${valid?`<p>${signal.text?esc(signal.text):'查看原帖了解预测依据。'}</p><p>${link(signal.source,'预测依据原帖')} · ${time(signal.at)}</p><p>有效至 ${time(signal.expires_at)}</p>`:'<p data-help>来源正常表示已成功获取公开数据。Codex Resets 没有发布预测窗口，或预测已过期、未提供有效概率时，不显示百分比；这不代表重置概率为零。有新预测后会自动更新。</p>'}${f.problem?`<p class="is-stale">${esc(f.problem)}</p>`:''}<p>来源更新 ${time(f.generated_at)} · 本页每 5 分钟检查</p></div></div>${f.scheduled?`<p class="insight-note" data-help-keep>已收录待执行预告：${esc(f.scheduled.text)} ${link(f.scheduled.source,'查看预告')}</p>`:''}${f.latest?`<p class="insight-note" data-help-keep>最近公开重置消息：${time(f.latest.at)} ${link(f.latest.source,'查看原帖')}。<span data-help>消息发布不等于个人账号已重置。</span></p>`:''}<p class="insight-note">数据来自 ${link('https://codex-resets.com','Codex Resets')}；概率是该站对公开信号的判断，不是 OpenAI 承诺，不参与本账号的重置判定。</p>`;
  }
  async function refreshForecast(){
    if(!document.getElementById('resetForecastBody')||pending||Date.now()-lastRequest<15000)return;
    pending=true;lastRequest=Date.now();
    try{forecast=await api('/api/reset-forecast');}catch(_){forecast={...(forecast||{}),fresh:false,probability:null,problem:'无法读取社区预测，请稍后重试。'};}
    finally{pending=false;QuotaDOM.patch(document.getElementById('resetForecastBody'),forecastMarkup(forecast));}
  }
  function render(q){
    const host=document.getElementById('quotaCurrent');if(!host)return;
    if(scope!==q?.history_scope){scope=q?.history_scope;eventFilter='all';eventLimit=10;const filter=document.getElementById('resetEventFilter');if(filter)filter.value='all';}
    const open=host.querySelector('details')?.open,focus=host.querySelector('summary')===document.activeElement;
    QuotaDOM.patch(host,currentMarkup(q));
    const detail=host.querySelector('details');if(detail){detail.open=Boolean(open);if(focus)detail.querySelector('summary').focus({preventScroll:true});}
    renderEvents(q);
    QuotaDOM.patch(document.getElementById('resetForecastBody'),forecastMarkup(forecast));
    refreshForecast();
  }
  if(typeof document!=='undefined'){
    document.addEventListener('change',e=>{if(e.target.id==='resetEventFilter'){eventFilter=e.target.value;eventLimit=10;renderEvents(accountData);}});
    document.addEventListener('click',e=>{if(e.target.closest('#moreResetEvents')){eventLimit+=10;renderEvents(accountData);}});
  }
  return {panel,render,refreshForecast,resetEvents,eventTitle,eventMarkup,forecastMarkup};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=QuotaPage;
