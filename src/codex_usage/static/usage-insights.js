'use strict';

const UsageInsights=(()=>{
  let comparisonMetric='tokens',comparisonGroup='projects';
  let paceView='cycle';
  try{if(localStorage.getItem('codex-usage-pace-view')==='date')paceView='date';}catch(_){}
  const format=(value,metric)=>metric==='cost'?usd(value):compact(value);
  const signed=(value,metric)=>(value>0?'+':value<0?'−':'')+format(Math.abs(value),metric);
  const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:settings.timezone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  // Draw in CSS pixels so resizing changes geometry, never the axis font size.
  const renderers=new Map();
  const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
    for(const {target,contentRect} of entries)resizeChart(target,contentRect.width);
  });
  function resizeChart(host,width) {
    const entry=renderers.get(host);
    if(!entry || width<=0 || Math.abs(width-entry.width)<.5)return;
    entry.width=width;
    const focused=host.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
    const html=entry.draw(width);
    if(entry.html===html)return;
    host.innerHTML=html;entry.html=html;
    if(focused)[...host.querySelectorAll('[tabindex]')].find(el=>el.getAttribute('aria-label')===focused)?.focus({preventScroll:true});
  }
  function observeChart(host,draw) {
    if(!host)return;
    const previous=renderers.get(host);
    renderers.set(host,{draw,width:0,html:previous?.html});
    resizeChart(host,host.clientWidth);resizeObserver?.observe(host);
  }
  function release(root) {
    if(typeof QuotaRange!=='undefined')QuotaRange.release(root);
    for(const host of renderers.keys())if(root.contains(host)){resizeObserver?.unobserve(host);renderers.delete(host);}
  }
  const dailyCache=report=>report.model_timeline.map(row=>({date:row.date,input:row.models.reduce((sum,m)=>sum+m.input,0),cached:row.models.reduce((sum,m)=>sum+m.cached,0)}));
  function mountCache(root,report) {
    const daily=dailyCache(report);
    observeChart(root.querySelector('.cache-trend-chart'),width=>cacheTrend(daily,width));
  }
  function mountPace(root,quota) {
    for(const host of renderers.keys())if(!host.isConnected){resizeObserver?.unobserve(host);renderers.delete(host);}
    QuotaRange.releaseDetached();
    if(quota?.custom_range){
      for(const host of root.querySelectorAll('[data-range-chart]')){
        const group=quota.groups?.find(g=>g.id===host.dataset.rangeChart);
        if(group)QuotaRange.mount(host,group,quota);
      }
      return;
    }
    for(const host of root.querySelectorAll('.pace-chart-host')){
      const window=quota?.windows?.find(w=>w.id===host.dataset.paceWindow),p=quota?.pace?.[window?.id];
      if(window && p)observeChart(host,width=>(paceView==='cycle'?cyclePaceChart:dailyPaceChart)(window,p,width,true));
    }
  }
  function waterfallRows(comparison,metric,group) {
    const key=metric==='cost'?'cost':'total';
    const rows=[...comparison[group]].sort((a,b)=>Math.abs(b['delta_'+key])-Math.abs(a['delta_'+key]));
    const visible=rows.slice(0,6).map(row=>({...row,value:row['delta_'+key]}));
    if(rows.length>6)visible.push({name:`其他 ${rows.length-6} 项`,value:rows.slice(6).reduce((sum,row)=>sum+row['delta_'+key],0)});
    return visible;
  }
  function comparisonPanel() {
    return `<section class="panel comparison-panel" id="usageComparison" aria-labelledby="comparisonTitle"><div class="panel-head"><div><h2 id="comparisonTitle">周期对比与增长归因</h2><p data-help>基于已采集日志，沿用当前筛选；今天按相同时间进度比较。</p></div><div class="metric-switch" role="group" aria-label="周期对比指标">${['tokens','cost'].map(key=>`<button data-comparison-metric="${key}" aria-pressed="${comparisonMetric===key}" class="${comparisonMetric===key?'selected':''}">${key==='tokens'?'Tokens':'API 等价 USD'}</button>`).join('')}</div></div><div id="comparisonBody"></div></section>`;
  }
  function drawComparison(report) {
    const root=document.getElementById('comparisonBody');if(!root)return;
    release(root);
    const c=report.comparison;if(!c)return;
    if(!c.current_range){root.innerHTML=`<p class="insight-note">${esc(c.reason)}</p>`;return;}
    const metric=comparisonMetric,key=metric==='cost'?'known_cost':'total',current=c.current[key],previous=c.previous?.[key];
    const delta=previous===undefined?null:current-previous;
    const change=previous>0?(delta>0?'+':'')+percent(delta/previous):delta>0?'上期为零':delta===0?'无变化':'不可比较';
    const partial=metric==='cost' && (c.current.unpriced_events || c.previous?.unpriced_events);
    root.innerHTML=`<div class="comparison-dates"><span>本期 ${stamp(c.current_range.since)} — ${stamp(c.current_range.until)}</span><span>${esc(c.basis)} ${stamp(c.previous_range.since)} — ${stamp(c.previous_range.until)}</span></div>
      <div class="insight-stats"><div><span>本期${partial?' · 已定价':''}</span><strong>${format(current,metric)}</strong></div><div><span>${esc(c.basis)}</span><strong>${c.available?format(previous,metric):'—'}</strong></div><div><span>变化${c.available?' · '+change:''}</span><strong class="${delta>0?'delta-up':delta<0?'delta-down':''}">${c.available?signed(delta,metric):'不可比较'}</strong></div></div>
      ${c.available?`<div class="insight-controls"><div class="segmented" role="group" aria-label="增长归因维度"><button data-comparison-group="projects" class="${comparisonGroup==='projects'?'selected':''}" aria-pressed="${comparisonGroup==='projects'}">按项目</button><button data-comparison-group="models" class="${comparisonGroup==='models'?'selected':''}" aria-pressed="${comparisonGroup==='models'}">按模型</button></div><span>橙色增加 · 绿色减少 · 方块可聚焦查看明细</span></div><div class="waterfall-chart"></div>`:`<p class="insight-note">${esc(c.reason)}可选择较近的完整日期范围查看对比。</p>`}
      ${partial?'<p class="insight-note">包含未定价用量；此处仅比较已定价金额，不代表完整成本变化。</p>':''}`;
    root.closest('section').querySelectorAll('[data-comparison-metric]').forEach(button=>{const selected=button.dataset.comparisonMetric===metric;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    observeChart(root.querySelector('.waterfall-chart'),width=>waterfall(c,metric,comparisonGroup,width));
  }
  function fitLabel(text,width) {
    let used=0,result='';
    for(const char of text){used+=char.charCodeAt(0)>255?13:7.5;if(used>width-13)return result+'…';result+=char;}
    return result;
  }
  function waterfall(c,metric,group,width=1000) {
    const key=metric==='cost'?'known_cost':'total',rows=waterfallRows(c,metric,group);
    let running=c.previous[key];
    const bars=[{name:'上期',bottom:0,top:running,value:running,kind:'total'}];
    for(const row of rows){const next=running+row.value;bars.push({...row,bottom:Math.min(running,next),top:Math.max(running,next),kind:row.value<0?'down':'up'});running=next;}
    bars.push({name:'本期',bottom:0,top:c.current[key],value:c.current[key],kind:'total'});
    const textValue=b=>metric==='cost' && Math.abs(b.value)>=10000?(b.kind!=='total'?(b.value<0?'−':'+'):'')+'$'+compact(Math.abs(b.value)):b.kind==='total'?format(b.value,metric):signed(b.value,metric);
    const peak=Math.max(1,...bars.map(b=>b.top))*1.18;
    if(width<bars.length*100){
      const left=Math.min(140,width*.32),right=Math.min(100,width*.27),plot=Math.max(1,width-left-right),rowHeight=58,height=bars.length*rowHeight+12;
      const x=value=>left+value/peak*plot;
      return `<svg class="waterfall waterfall-horizontal" viewBox="0 0 ${width} ${height}" role="group" aria-label="从上期到本期的${metric==='cost'?'已定价成本':'Token'}变化瀑布图"><line x1="${left}" x2="${left}" y1="4" y2="${height-8}" stroke="var(--line)"/>${bars.map((b,i)=>{
        const y=i*rowHeight+12,full=b.name+(b.source_name?' · '+b.source_name:'')+'：'+(b.kind==='total'?format(b.value,metric):signed(b.value,metric));
        return `<g tabindex="0" role="img" aria-label="${esc(full)}"><title>${esc(full)}</title><text x="2" y="${y+13}">${esc(fitLabel(b.name,left-10))}</text>${b.source_name?`<text class="waterfall-source" x="2" y="${y+32}">${esc(fitLabel(b.source_name,left-10))}</text>`:''}<rect x="${x(b.bottom)}" y="${y}" width="${Math.max(.8,x(b.top)-x(b.bottom))}" height="24" rx="3" fill="var(--waterfall-${b.kind})"/><text class="chart-number" x="${width-4}" y="${y+17}" text-anchor="end">${textValue(b)}</text></g>`;
      }).join('')}</svg>`;
    }
    const height=250,pad=28,base=185;
    const y=value=>base-value/peak*(base-pad),step=(width-32)/bars.length;
    return `<svg class="waterfall" viewBox="0 0 ${width} ${height}" role="group" aria-label="从上期到本期的${metric==='cost'?'已定价成本':'Token'}变化瀑布图"><line x1="16" x2="${width-16}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bars.map((b,i)=>{
      const x=16+step*i,w=step*.62,label=fitLabel(b.name,step-8);
      return `<g tabindex="0" role="img" aria-label="${esc(b.name+' '+(b.source_name||'')+'：'+(b.kind==='total'?format(b.value,metric):signed(b.value,metric)))}"><title>${esc(b.name)}${b.source_name?' · '+esc(b.source_name):''}\n${b.kind==='total'?format(b.value,metric):signed(b.value,metric)}</title><rect x="${x+(step-w)/2}" y="${y(b.top)}" width="${w}" height="${Math.max(.8,y(b.bottom)-y(b.top))}" rx="3" fill="var(--waterfall-${b.kind})"/><text x="${x+step/2}" y="${y(b.top)-9}" text-anchor="middle" class="chart-number">${textValue(b)}</text><text x="${x+step/2}" y="212" text-anchor="middle">${esc(label)}</text>${b.source_name?`<text x="${x+step/2}" y="233" text-anchor="middle" class="waterfall-source">${esc(fitLabel(b.source_name,step-8))}</text>`:''}</g>`;
    }).join('')}</svg>`;
  }
  function cacheTrend(daily,w=560) {
    const h=148,left=46,right=20,top=15,bottom=116;
    const dateLabel=value=>value?(daily[0]?.date.slice(0,4)===daily.at(-1)?.date.slice(0,4)?value.slice(5):value.slice(2)).replaceAll('-','/'):'';
    const x=i=>left+(daily.length>1?i/(daily.length-1):.5)*(w-left-right),y=rate=>bottom-rate*(bottom-top);
    let paths=[],path=[];
    daily.forEach((row,i)=>{if(!row.input){if(path.length)paths.push(path.join(' '));path=[];}else path.push(`${path.length?'L':'M'}${x(i)},${y(row.cached/row.input)}`);});if(path.length)paths.push(path.join(' '));
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="每日输入缓存命中率；无输入日期断开显示">${[0,.5,1].map(rate=>`<line x1="${left}" x2="${w-right}" y1="${y(rate)}" y2="${y(rate)}" stroke="var(--line)"/><text x="${left-6}" y="${y(rate)+4}" text-anchor="end">${rate*100}%</text>`).join('')}${paths.map(d=>`<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`).join('')}${daily.filter(row=>row.input).length<=90?daily.map((row,i)=>row.input?`<circle tabindex="0" cx="${x(i)}" cy="${y(row.cached/row.input)}" r="3" fill="var(--accent-ink)" aria-label="${row.date} ${percent(row.cached/row.input)}"><title>${row.date} · ${percent(row.cached/row.input)}</title></circle>`:'').join(''):''}<text x="${left}" y="142">${esc(dateLabel(daily[0]?.date))}</text><text x="${w-right}" y="142" text-anchor="end">${esc(daily.length>1?dateLabel(daily.at(-1)?.date):'')}</text></svg>`;
  }
  function cachePanel(report) {
    const s=report.summary,baseline=s.known_cost+s.cache_savings,maximum=Math.max(baseline,s.known_cost,0.00001);
    const daily=dailyCache(report);
    const expanded=document.querySelector('.cache-breakdown')?.open;
    const dimension=state.view==='projects'?'项目':'模型';
    const breakdown=[...(state.view==='projects'?report.projects:report.models)].sort((a,b)=>b.cache_savings-a.cache_savings);
    const detail=`<details class="cache-breakdown" ${expanded?'open':''}><summary>查看各${dimension}缓存收益</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>${dimension}</th><th class="num">缓存命中率</th><th class="num">缓存读取 Tokens</th><th class="num">API 等价节省</th></tr></thead><tbody>${breakdown.map(row=>`<tr><td>${state.view==='projects'?`<button class="text-button" data-project-detail="${esc(row.id)}">${esc(row.name)}</button><small>${esc(row.source_name)}</small>`:esc(row.name)}</td><td class="num">${percent(row.cache_rate)}</td><td class="num">${number(row.cached)}</td><td class="num cost">${usd(row.cache_savings)}${row.unpriced_events?'（部分）':''}</td></tr>`).join('')||'<tr><td colspan="4">暂无用量</td></tr>'}</tbody></table></div></details>`;
    return `<section class="panel cache-panel" aria-labelledby="cacheTitle"><div class="panel-head"><div><h2 id="cacheTitle">缓存收益分析</h2><p data-help>比较缓存读取计价与按普通输入计价的 API 等价成本。</p></div><span class="badge neutral">${s.unpriced_events?'仅已定价部分':'当前筛选范围'}</span></div><div class="insight-stats"><div><span>输入缓存命中率</span><strong>${percent(s.cache_rate)}</strong></div><div><span>API 等价节省</span><strong class="cost">${usd(s.cache_savings)}</strong></div><div><span>相对无缓存成本减少</span><strong>${baseline>0?percent(s.cache_savings/baseline):'—'}</strong></div></div><div class="cache-visuals"><div class="cache-bars">${[['当前 API 等价成本',s.known_cost,'current'],['缓存读取按普通输入计价',baseline,'baseline']].map(([label,value,kind])=>`<div class="cache-bar-row"><div><span>${label}</span><strong>${usd(value)}</strong></div><div class="cache-bar-track"><span class="${kind}" style="width:${Math.max(0,value)/maximum*100}%"></span></div></div>`).join('')}</div><div class="cache-trend"><h3>每日缓存命中率</h3><div class="cache-trend-chart">${cacheTrend(daily)}</div></div></div><p class="insight-note">按相同模型、输入长度和单价，将缓存读取改按普通输入计价；其他用量不变。这是 API 等价差额，不是 Pro 订阅账单节省。${s.unpriced_events?`${compact(s.unpriced_tokens)} tokens 尚未定价，未纳入金额比较。`:''}</p>${detail}</section>`;
  }
  function pacePanel(quota, extras={}) {
    const q=quota||{},windows=q.windows||[],problem=q.transportError||q.problem?.message;
    const status=q.custom_range?'范围记录':q.historical?'历史记录':q.busy?'正在更新':problem?'更新失败':q.stale?'等待更新':q.fetched_at?'已连接':'等待连接';
    const updated=q.fetched_at?` · ${accountTime(q.fetched_at)} 更新`:'';
    const historyProblem=q.history_problem||(q.history_available===false?'额度接口未返回账号标识，暂不保存历史；实时额度正常更新。':'');
    return `<section class="panel quota-pace-panel" aria-labelledby="quotaPaceTitle"><div class="panel-head"><div><h2 id="quotaPaceTitle">额度消耗节奏</h2><p data-help>当前账号 · ${q.custom_range?'自定义日期范围，可跨多次重置':q.historical?'历史额度周期':'当前额度周期'} · 不受项目或日期筛选影响</p></div><div class="pace-panel-actions">${extras.controls||''}<span class="${problem?'is-stale':''}" role="status">${status}${esc(updated)}</span><button class="button small" data-refresh-quota aria-label="刷新额度消耗节奏" ${!quota||q.busy?'disabled':''}>刷新</button></div></div>${extras.collection||''}${extras.filters||''}${problem?`<p class="pace-panel-message is-stale">${esc(problem)}${q.fetched_at?' 显示上次成功记录。':''}</p>`:''}${historyProblem?`<p class="pace-panel-message">${esc(historyProblem)}</p>`:''}${q.custom_range?QuotaRange.panel(q):windows.length?`<div class="pace-view-controls"><div class="segmented" role="group" aria-label="额度图时间方式">${[["cycle","按周期时间"],["date","按日期"]].map(([value,label])=>`<button data-pace-view="${value}" aria-pressed="${paceView===value}" class="${paceView===value?"selected":""}">${label}</button>`).join("")}</div></div><div class="quota-pace">${windows.map(window=>paceWindow(window,q)).join('')}</div>`:`<p class="pace-panel-message">${q.busy||!quota?(q.historical?'正在读取历史周期…':'正在连接额度服务…'):problem?'额度恢复连接后会显示每日记录。':'账号服务暂未返回额度窗口。'}</p>`}<p class="insight-note" ${q.custom_range?'hidden':''}>${paceView==="cycle"?"周期视图按实际时间定位，取每个连续 24 小时段的最后记录；正式周期按接口到期时间倒推窗口长度（周额度为 168 小时），闲置不计入；虚线为正式周期内的均匀参考。":"日期视图按自然日等距排列，取每天最后记录；虚线为按日均匀参考。"} 周期内重置的首次观测额外保留，参考线从恢复后的额度重新计算；周期前的重置显示在闲置阶段。预测使用近期官方额度变化，不将 Token 数量换算成额度；连续记录至少 30 分钟且增长 ≥1 个百分点后才预测。历史保存在本机，保留 90 天。</p></section>`;
  }
  function dailyPaceSeries(daily=[]) {
    const points=[...daily].sort((a,b)=>a.at-b.at),segments=[];
    for(const point of points){
      const previous=segments.at(-1)?.at(-1);
      // Calendar dates, rather than elapsed hours, keep DST days adjacent.
      const gap=previous?Date.parse(point.date+'T00:00:00Z')-Date.parse(previous.date+'T00:00:00Z'):null;
      if(!previous || ![0,86400000].includes(gap) || point.used_percent<previous.used_percent || point.reset_before)segments.push([]);
      segments.at(-1).push(point);
    }
    return {points,segments};
  }
  function dailyPaceChart(window,p,width=500,svgOnly=false) {
    if(!window.resets_at || !window.window_minutes || window.cycle_pending)return '';
    const begin=window.resets_at-window.window_minutes*60,end=window.display_end||window.resets_at;
    const daily=(p.daily_samples||[]).filter(point=>point.at>=begin && point.at<=end);
    if(p.start_event && p.start_event.at>=begin && p.start_event.at<=end && !daily.some(point=>point.at===p.start_event.at)){
      const e=p.start_event,date=new Intl.DateTimeFormat('en-CA',{timeZone:p.daily_timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.at*1000));
      daily.push({date,at:e.at,used_percent:e.after_used,reset_before:true});
    }
    const {points,segments}=dailyPaceSeries(daily);
    if(!points.length || !window.resets_at || !window.window_minutes)return '';
    const w=width,left=44,right=26,top=16,bottom=146,referenceBegin=Math.max(begin,window.reference_started_at??p.start_event?.at??begin);
    const zone=p.daily_timezone||'UTC',zoneLabel=zone==='Asia/Shanghai'?'北京时间':zone;
    const dateAt=at=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at*1000));
    const day=date=>Date.parse(date+'T00:00:00Z')/86400000;
    const firstDay=day(dateAt(begin)),lastDay=day(dateAt(end));
    // Daily aggregates occupy calendar slots. Their capture time belongs in
    // the tooltip, otherwise 23:59 and 00:01 appear to be the same day.
    const x=date=>left+(lastDay>firstDay?(day(date)-firstDay)/(lastDay-firstDay):.5)*(w-left-right),y=used=>bottom-used/100*(bottom-top);
    const pointX=point=>x(point.date)-(point.reset_before && points.some(other=>other!==point && other.date===point.date)?10:0);
    const time=at=>new Date(at*1000).toLocaleTimeString('zh-CN',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
    const detail=point=>`${point.date} · 已用 ${number(point.used_percent)}% · 剩余 ${number(100-point.used_percent)}% · ${point.reset_before?'重置首次记录':'最后记录'} ${time(point.at)}`;
    const latest=points.at(-1),ticks=new Set([dateAt(begin),dateAt(end),...points.map(point=>point.date)]);
    for(let d=firstDay;d<=lastDay;d+=Math.max(1,Math.ceil((lastDay-firstDay)/90)))ticks.add(new Date(d*86400000).toISOString().slice(0,10));
    // Stagger narrow weekly axes instead of dropping a recorded date. Keep
    // the text at its normal size, with at least 48px between same-row labels.
    const labels=[],rows=[-Infinity,-Infinity,-Infinity];
    for(const date of [...ticks].filter(date=>day(date)>=firstDay && day(date)<=lastDay).sort()){
      const row=rows.findIndex(previous=>x(date)-previous>=48);
      if(row>=0){labels.push({date,row});rows[row]=x(date);}
    }
    const h=188+Math.max(0,...labels.map(tick=>tick.row))*18;
    const svg=`<svg viewBox="0 0 ${w} ${h}" role="group" aria-label="${esc(window.label)}每日已用百分比折线图，日期等距排列，缺失日期断线">${[0,50,100].map(v=>`<text x="${left-6}" y="${y(v)+4}" text-anchor="end">${v}%</text><line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`).join('')}<path d="M${x(dateAt(referenceBegin))},${y(window.segment_baseline||0)}L${x(dateAt(end))},${y((window.segment_baseline||0)+(end-referenceBegin)/Math.max(1,window.resets_at-referenceBegin)*(100-(window.segment_baseline||0)))}" stroke="var(--muted)" stroke-dasharray="5 4" fill="none" aria-hidden="true"/>${segments.filter(segment=>segment.length>1).map(segment=>`<path class="pace-daily-line" d="${segment.map((point,i)=>`${i?'L':'M'}${pointX(point)},${y(point.used_percent)}`).join(' ')}" stroke="var(--accent-ink)" stroke-width="2.5" stroke-linejoin="round" fill="none"/>`).join('')}${labels.map(tick=>`<line x1="${x(tick.date)}" x2="${x(tick.date)}" y1="${bottom}" y2="${bottom+5}" stroke="var(--line)"/><text class="pace-date-label" x="${x(tick.date)}" y="${174+tick.row*18}" text-anchor="middle">${tick.date.slice(5).replace('-','/')}</text>`).join('')}${points.map(point=>`<g class="pace-day" tabindex="0" role="img" data-pace-day="${point.date}" data-pace-window="${esc(window.id)}" data-pace-detail="${esc(detail(point))}" aria-label="${esc(detail(point))}"><title>${esc(detail(point))}</title><circle cx="${pointX(point)}" cy="${y(point.used_percent)}" r="11" fill="transparent"/><circle class="pace-day-dot" cx="${pointX(point)}" cy="${y(point.used_percent)}" r="4.5" fill="var(--accent-ink)" stroke="var(--surface)" stroke-width="1.5"/></g>`).join('')}</svg>`;
    if(svgOnly)return svg;
    return `<div class="pace-daily-chart"><div class="pace-chart-caption"><span>每日已用 · ${esc(zoneLabel)} · ${points.length} 个点</span><span>${daily.some(point=>point.reset_before)?'每日记录 + 重置观测点':'每天一个点'}</span></div><div class="pace-chart-host" data-pace-window="${esc(window.id)}">${svg}</div><div class="pace-chart-legend"><span><i class="pace-actual-key"></i>每日最后记录</span><span><i class="pace-reference-key"></i>按日均匀参考</span></div><p class="pace-day-detail" aria-live="polite">${esc(detail(latest))}</p><p class="pace-chart-help">日期按天等距排列，悬停或聚焦圆点查看实际采集时间；${p.status==='historical'?'历史周期展示已保存的记录。':'今天的点随刷新更新。'}${points.length===1?'目前只记录了 1 天，有连续两天记录后显示折线。':'没有记录的日期留空并断线；额度回落不会画成负消耗。'}</p></div>`;
  }
  function cyclePaceSeries(samples=[]) {
    const points=[...samples].sort((a,b)=>a.at-b.at),segments=[];
    for(const point of points){
      const previous=segments.at(-1)?.at(-1);
      if(!previous || point.interval-previous.interval>1 || point.used_percent<previous.used_percent || point.break_before || point.reset_before)segments.push([]);
      segments.at(-1).push(point);
    }
    return {points,segments};
  }
  function cyclePaceChart(window,p,width=500,svgOnly=false) {
    if(!window.resets_at || !window.window_minutes || window.cycle_pending)return '';
    const begin=window.resets_at-window.window_minutes*60,end=window.display_end||window.resets_at;
    if(end<=begin)return '';
    const zone=p.daily_timezone||'UTC',zoneLabel=zone==='Asia/Shanghai'?'北京时间':zone;
    const dateAt=at=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at*1000));
    const timeAt=at=>new Date(at*1000).toLocaleTimeString('zh-CN',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
    const stampAt=at=>dateAt(at)+' '+timeAt(at);
    const samples=[...(p.cycle_samples||[])];
    if(p.start_event && p.start_event.at>=begin && p.start_event.at<=end && !samples.some(point=>point.at===p.start_event.at)){
      const e=p.start_event,interval=Math.floor((e.at-begin)/86400);samples.push({at:e.at,date:dateAt(e.at),used_percent:e.after_used,interval,reset_before:true,since:begin+interval*86400,until:Math.min(begin+(interval+1)*86400,end)});
    }
    const {points,segments}=cyclePaceSeries(samples.filter(point=>point.at>=begin && point.at<=end));
    if(!points.length)return '';
    const w=width,left=44,right=26,top=16,bottom=146;
    const x=at=>left+(at-begin)/(end-begin)*(w-left-right),y=used=>bottom-used/100*(bottom-top);
    const tickTimes=[begin],step=end-begin>=86400?86400*Math.max(1,Math.ceil((end-begin)/86400/90)):Math.max(900,Math.ceil((end-begin)/3600/6)*3600);
    for(let at=begin+step;at<end;at+=step)tickTimes.push(at);
    tickTimes.push(end);
    // Two-line date/time labels retain the reset minute at every 24h boundary.
    const rows=[-Infinity,-Infinity,-Infinity],labels=[];
    for(const at of tickTimes){
      const row=rows.findIndex(previous=>x(at)-previous>=48);
      if(row>=0){labels.push({at,row});rows[row]=x(at);}
    }
    const h=204+Math.max(0,...labels.map(tick=>tick.row))*34;
    const detail=point=>`${stampAt(point.at)} · 已用 ${number(point.used_percent)}% · 剩余 ${number(100-point.used_percent)}% · ${point.reset_before?'重置首次记录':`第 ${point.interval+1} 个 24 小时段最后记录`}`;
    const baseline=window.segment_baseline||0,referenceBegin=Math.max(begin,window.reference_started_at??p.start_event?.at??begin),referenceEnd=baseline+(end-referenceBegin)/Math.max(1,window.resets_at-referenceBegin)*(100-baseline);
    const svg=`<svg viewBox="0 0 ${w} ${h}" role="group" aria-label="${esc(window.label)}按周期时间已用百分比折线图，从起点每隔 24 小时标记，圆点按实际采集时间定位">${[0,50,100].map(v=>`<text x="${left-6}" y="${y(v)+4}" text-anchor="end">${v}%</text><line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`).join('')}<path d="M${x(referenceBegin)},${y(baseline)}L${x(end)},${y(referenceEnd)}" stroke="var(--muted)" stroke-dasharray="5 4" fill="none" aria-hidden="true"/>${segments.filter(segment=>segment.length>1).map(segment=>`<path class="pace-daily-line" d="${segment.map((point,i)=>`${i?'L':'M'}${x(point.at)},${y(point.used_percent)}`).join(' ')}" stroke="var(--accent-ink)" stroke-width="2.5" stroke-linejoin="round" fill="none"/>`).join('')}${labels.map(tick=>`<line x1="${x(tick.at)}" x2="${x(tick.at)}" y1="${bottom}" y2="${bottom+5}" stroke="var(--line)"/><text class="pace-cycle-label" data-at="${tick.at}" x="${x(tick.at)}" y="${174+tick.row*34}" text-anchor="middle"><tspan>${dateAt(tick.at).slice(5).replace('-','/')}</tspan><tspan x="${x(tick.at)}" dy="16">${timeAt(tick.at)}</tspan></text>`).join('')}${points.map(point=>`<g class="pace-day" tabindex="0" role="img" data-pace-day="${point.date}" data-pace-at="${point.at}" data-pace-window="${esc(window.id)}" data-pace-detail="${esc(detail(point))}" aria-label="${esc(detail(point))}"><title>${esc(detail(point))}</title><circle cx="${x(point.at)}" cy="${y(point.used_percent)}" r="11" fill="transparent"/><circle class="pace-day-dot" cx="${x(point.at)}" cy="${y(point.used_percent)}" r="4.5" fill="var(--accent-ink)" stroke="var(--surface)" stroke-width="1.5"/></g>`).join('')}</svg>`;
    if(svgOnly)return svg;
    return `<div class="pace-daily-chart"><div class="pace-chart-caption"><span>周期时间 · ${esc(zoneLabel)} · ${points.length} 个点</span><span>连续 24 小时分段</span></div><p class="pace-cycle-origin">正式周期 ${stampAt(begin)} — ${stampAt(window.resets_at)}<br>${window.window_minutes===10080?'7 × 24 小时 · ':''}${number(window.window_minutes/60)} 小时${end<window.resets_at?' · 本段提前结束于 '+stampAt(end):''}</p><div class="pace-chart-host" data-pace-window="${esc(window.id)}">${svg}</div><div class="pace-chart-legend"><span><i class="pace-actual-key"></i>每 24 小时段最后记录</span><span><i class="pace-reference-key"></i>按时间均匀参考</span></div><p class="pace-day-detail" aria-live="polite">${esc(detail(points.at(-1)))}</p><p class="pace-chart-help">从起点连续划分 24 小时段，圆点按实际记录时间定位；${p.status==='historical'?'历史段只展示已保存记录。':'当前段随同步更新。'}${points.length===1?'目前仅有 1 个记录点，有连续分段记录后显示折线。':'缺失分段、采集空档和额度回落处断线。'} 悬停或聚焦圆点查看明细。</p></div>`;
  }
  function pacePhases(window) {
    const idle=window.idle_period;
    if(!idle && !window.cycle_pending)return '';
    const duration=seconds=>{const minutes=Math.floor(Math.max(0,seconds)/60);return `${Math.floor(minutes/60)} 小时 ${minutes%60} 分钟`;};
    return `<div class="pace-phases">${idle?`<div class="pace-phase"><strong>${idle.after_reset?'重置后闲置':'周期前闲置'} · ${duration(idle.until-idle.since)}</strong><span>${accountTime(idle.since*1000)} — ${idle.ongoing?'最近同步 '+accountTime(idle.until*1000):accountTime(idle.until*1000)}</span></div>`:''}<div class="pace-phase pace-phase-active"><strong>${window.cycle_pending?'等待开始使用':'正式额度周期'}${window.cycle_pending?'':` · ${window.window_minutes===10080?'7 × 24 小时':number(window.window_minutes/60)+' 小时'}`}</strong><span>${window.cycle_pending?'开始使用后按接口返回的周期更新':`${accountTime(window.cycle_started_at*1000)} — ${accountTime(window.resets_at*1000)}`}</span></div></div><p data-help>闲置段根据周期前剩余 100% 的观测与接口周期起点区分，不计入正式周期、均匀参考或耗尽预测；未采集时段不能证明没有使用。正式起点由接口到期时间减去窗口长度得到，重置首次检测时间不代表开始使用时间。</p>`;
  }
  function paceWindow(window,quota) {
    const p=quota.pace?.[window.id],old=quota.stale || quota.transportError;
    const expired=window.resets_at && window.resets_at<=Date.now()/1000;
    const status=quota.historical?'historical':old?'stale':expired?'expired':p?.status||'insufficient';
    const labels={waiting:'等待开始使用，暂不计算消耗节奏',historical:'历史周期：最后记录不一定是周期最终用量，未采集部分无法补算。',unknown:'缺少窗口信息，暂不分析',expired:'等待服务确认新周期',exhausted:'本周期额度已用尽',insufficient:'正在积累历史，暂不预测耗尽时间',flat:'近期未观察到足够变化，暂不预测',stale:'额度数据已过期，暂停预测',risk:'按近期速度，可能在重置前耗尽',sustainable:'按近期速度，预计可持续到重置'};
    const graph=p?(paceView==="cycle"?cyclePaceChart:dailyPaceChart)(window,p):'',prefix=quota.windows.some(w=>w.bucket!=='codex');
    const windowLabel=(prefix&&window.bucket_name?window.bucket_name+' · ':'')+window.label;
    return `<section class="pace-window"><h3>${esc(windowLabel)}</h3>${p?.start_event?`<p class="pace-reset-marker">↻ ${accountTime(p.start_event.at*1000)} 首次检测 · ${p.start_event.kind==='credit'?'手动重置卡重置（推断）':p.start_event.kind==='official'?'官方重置（默认）':'正常周期重置'} · 剩余 ${number(100-p.start_event.before_used)}% → ${number(100-p.start_event.after_used)}%</p>`:''}${pacePhases(window)}<div class="pace-window-layout"><div class="pace-plot">${graph||(window.cycle_pending?'<p class="pace-chart-empty">正式周期尚未开始，开始使用后显示 24 小时分段曲线。</p>':'<p class="pace-chart-empty">暂无正式周期内的额度记录，成功同步后开始绘制。</p>')}</div><div class="pace-summary"><div class="pace-reading"><div><span>${quota.historical?'最后记录已用':'已用额度'}</span><strong>${window.used_percent==null?'未知':number(window.used_percent)+'%'}</strong></div><div><span>均匀参考</span><strong>${p?.expected_percent==null?'—':number(Math.round(p.expected_percent*10)/10)+'%'}</strong></div></div><p>${quota.historical&&quota.cycle?.ends_at?`本段结束 ${accountTime(quota.cycle.ends_at*1000)}${['official','credit'].includes(quota.cycle.ended_reason)?'（重置结束）':quota.cycle.ended_reason==='configuration'?'（套餐或窗口变更）':''}<br>`:''}${window.resets_at?`${quota.historical?'原定下次重置':'下次重置'} ${accountTime(window.resets_at*1000)}`:'重置时间未知'}</p><div class="pace-forecast"><p class="${status==='risk'?'delta-up':''}">${labels[status]}</p>${['risk','sustainable'].includes(status)?`<p>近期每小时约 ${number(Math.round(p.rate_per_hour*100)/100)} 个百分点${status==='risk'?' · 预计 '+accountTime(p.estimated_exhaustion*1000)+' 耗尽':''}（估算）</p>`:''}</div>${p?.gap_count?`<details class="pace-gaps"><summary>${p.gap_count} 段采集空档（超过 15 分钟）</summary><ul>${p.gaps.map(g=>`<li>${accountTime(g.since*1000)} — ${accountTime(g.until*1000)}</li>`).join('')}</ul><p>未记录的时段不能视为零消耗${p.gap_count>20?'；仅展示最近 20 段':''}。</p></details>`:''}${p?.samples?.length?`<p>开始记录于 ${accountTime(p.samples[0].at*1000)}<br>本使用段 ${p.sample_count??p.samples.length} 次观测${window.idle_period?'（含闲置记录）':''}<br>正式周期已记录 ${p.daily_samples?.length||0} 天</p>`:''}</div></div></section>`;
  }
  function handle(button) {
    if(['cycle','date'].includes(button.dataset.paceView)){
      paceView=button.dataset.paceView;
      try{localStorage.setItem('codex-usage-pace-view',paceView);}catch(_){}
      renderQuotaPace({view:paceView});return true;
    }
    if(button.dataset.comparisonMetric){comparisonMetric=button.dataset.comparisonMetric;drawComparison(data);return true;}
    if(button.dataset.comparisonGroup){comparisonGroup=button.dataset.comparisonGroup;drawComparison(data);return true;}
    return false;
  }
  if(typeof document!=='undefined'){
    const showDay=event=>{
      const point=event.target.closest?.('.pace-day');if(!point)return;
      point.closest('.pace-daily-chart').querySelector('.pace-day-detail').textContent=point.dataset.paceDetail;
    };
    document.addEventListener('pointerover',showDay);
    document.addEventListener('focusin',showDay);
  }
  return {comparisonPanel,drawComparison,cachePanel,pacePanel,handle,waterfallRows,waterfall,cacheTrend,dailyPaceSeries,dailyPaceChart,cyclePaceSeries,cyclePaceChart,pacePhases,mountCache,mountPace,release};
})();
if(typeof module!=='undefined' && module.exports)module.exports=UsageInsights;
