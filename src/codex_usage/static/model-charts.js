'use strict';

// Shared time-axis interaction for usage and model charts.
const UsageViewport=(()=>{
  const saved=new Map();
  const clamp=(v,n)=>{
    const span=Math.max(1,Math.min(n,v.end-v.start)),start=Math.max(0,Math.min(n-span,span===1?Math.round(v.start):v.start));
    return {start,end:start+span};
  };
  function mount(host,key,count,draw,geometry){
    const abort=new AbortController();
    let view=clamp(saved.get(key)||{start:0,end:count},Math.max(1,count)),drag=null,suppress=false;
    const toolbar=document.createElement('div');toolbar.className='usage-zoom-toolbar';
    toolbar.innerHTML='<span data-usage-range></span><div><button class="button small" data-usage-zoom="out" aria-label="缩小时间轴">−</button><button class="button small" data-usage-zoom="in" aria-label="放大时间轴">＋</button><button class="button small" data-usage-zoom="reset">恢复全范围</button></div>';
    host.parentNode.insertBefore(toolbar,host);
    host.classList.add('usage-zoom-host');host.tabIndex=0;
    host.setAttribute('aria-label','滚轮缩放时间轴，拖动平移；加减键缩放，左右键平移，Home 恢复全范围');
    const listen=(type,fn,options={})=>host.addEventListener(type,fn,{...options,signal:abort.signal});
    function update(next){
      view=clamp(next,Math.max(1,count));saved.set(key,view);
      if(saved.size>40)saved.delete(saved.keys().next().value);
      host.dataset.visibleStart=view.start;host.dataset.visibleEnd=view.end;
      toolbar.querySelector('[data-usage-zoom=in]').disabled=count<2||view.end-view.start<=1.001;
      toolbar.querySelector('[data-usage-zoom=out]').disabled=view.end-view.start>=count;
      toolbar.querySelector('[data-usage-zoom=reset]').disabled=view.end-view.start>=count;
      draw();
    }
    function zoom(factor,anchor=.5){
      const span=view.end-view.start,next=Math.max(1,Math.min(count,span*factor));
      update({start:view.start+anchor*(span-next),end:view.start+anchor*(span-next)+next});
    }
    const point=e=>{
      const rect=host.getBoundingClientRect(),g=geometry();
      if(!g)return null;
      const x=e.clientX-rect.left,y=e.clientY-rect.top;
      return x>=g.L&&x<=g.L+g.w&&y>=g.T&&y<=g.T+g.h?{x,w:g.w,anchor:(x-g.L)/g.w}:null;
    };
    listen('wheel',e=>{
      const p=point(e);if(!p||e.ctrlKey||count<2)return;
      e.preventDefault();zoom(Math.exp(Math.max(-400,Math.min(400,e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?host.clientHeight:1)))*.0025),p.anchor);
    },{passive:false});
    listen('pointerdown',e=>{
      const p=point(e);if(e.button!==0||!p)return;
      drag={id:e.pointerId,x:e.clientX,view:{...view},w:p.w};suppress=false;
      host.setPointerCapture(e.pointerId);
    },{capture:true});
    listen('pointermove',e=>{
      if(!drag)return;
      const dx=e.clientX-drag.x;if(Math.abs(dx)<4&&!suppress)return;
      suppress=true;e.stopImmediatePropagation();host.classList.add('is-dragging');
      const delta=-dx/drag.w*(drag.view.end-drag.view.start);
      update({start:drag.view.start+delta,end:drag.view.end+delta});
    },{capture:true});
    const stop=()=>{drag=null;host.classList.remove('is-dragging');};
    listen('pointerup',e=>{if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);stop();});
    listen('pointercancel',stop);listen('lostpointercapture',stop);
    listen('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}},{capture:true});
    listen('keydown',e=>{
      if(e.target!==host)return;
      const span=view.end-view.start;
      if(e.key==='Home')update({start:0,end:count});
      else if(e.key==='+'||e.key==='=')zoom(1/1.5);
      else if(e.key==='-')zoom(1.5);
      else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const delta=span*(e.key==='ArrowLeft'?-.2:.2);update({start:view.start+delta,end:view.end+delta});}
      else return;
      e.preventDefault();
    });
    toolbar.addEventListener('click',e=>{
      const action=e.target.closest('[data-usage-zoom]')?.dataset.usageZoom;
      if(action==='reset')update({start:0,end:count});else if(action)zoom(action==='in'?1/1.5:1.5);
    },{signal:abort.signal});
    return {
      slice(rows){const result=rows.slice(Math.floor(view.start),Math.max(Math.floor(view.start)+1,Math.ceil(view.end)));toolbar.querySelector('[data-usage-range]').textContent=result.length?result[0].date+' — '+result.at(-1).date:'';return result;},
      refresh(){update(view);},
      release(){abort.abort();toolbar.remove();}
    };
  }
  return {mount,clamp};
})();


// UI choices stay independent of report filters and survive polling/navigation.
const ModelCharts = (() => {
  const hidden = new Set();
  const categories = [
    {key:'uncached', cost:'input_cost', label:'未缓存输入'},
    {key:'cached', cost:'cached_cost', label:'缓存读取'},
    {key:'write', cost:'write_cost', label:'缓存写入'},
    {key:'output', cost:'output_cost', label:'输出'}
  ];
  const zero = {total:0, known_cost:0, cost:0, unpriced_events:0};
  const visible = {stack:true, line:true};
  const chart = {geometry:null, activeDate:null, pinned:false};
  let metric='tokens', root=null, report=null, available=[], selected=[], days=[],allDays=[],viewport=null;
  const observer = new ResizeObserver(() => draw());
  const color = name => {
    const known = {'gpt-6-astra':'#da7756', 'gpt-6.1-sol':'#7d9f91', 'gpt-5.6-sol':'#829cc4'};
    if (known[name]) return known[name];
    let hash=0;
    for (const c of name) hash=(hash*31+c.charCodeAt(0))>>>0;
    return `hsl(${hash%360} 35% 56%)`;
  };
  const value = cell => metric==='cost' ? cell.known_cost : cell.total;
  const byId = id => root.querySelector('#'+id);
  const host = () => byId('modelDailyChart');
  const tooltip = () => byId('modelChartTooltip');
  const chartName = () => visible.stack && visible.line ? '模型每日用量组合图' : visible.stack ? '用量类别堆叠图' : '模型用量折线图';

  function panel() {
    return `<section class="panel model-explorer" id="modelExplorer" aria-labelledby="modelChartTitle">
      <div class="panel-head"><div><h2 id="modelChartTitle">模型每日用量</h2><p data-help>堆叠柱展示用量类别，折线叠加各模型趋势。</p></div>
        <div class="model-visibility" role="group" aria-label="显示内容"><span>显示</span><label><input type="checkbox" data-model-visible="stack" checked>堆叠柱</label><label><input type="checkbox" data-model-visible="line" checked>折线</label></div></div>
      <div class="model-chart-toolbar"><div class="metric-switch" role="group" aria-label="模型图表指标"><button data-model-metric="tokens">Tokens</button><button data-model-metric="cost">API 等价 USD</button></div><span class="subtle">按天统计 · 含零用量日期</span></div>
      <fieldset class="model-picker"><legend>图表显示模型</legend><div class="model-picker-actions"><span id="modelSelectionCount" aria-live="polite"></span><button class="text-button" data-model-selection="all">全选</button><button class="text-button" data-model-selection="none">清空</button></div><div id="modelChoices" class="model-choices"></div></fieldset>
      <div class="model-chart-frame"><div class="model-chart-host" id="modelDailyChart"></div><div id="modelChartTooltip" class="model-chart-tooltip" role="status" aria-live="polite" hidden></div></div>
      <div class="model-combined-legend"><div class="model-legend-row" id="modelCategoryLegend"></div><div class="model-legend-row" id="modelLineLegend"></div></div>
      <div class="model-chart-footer"><p id="modelChartHelp">滚轮缩放、拖动平移，恢复全范围查看当前筛选的全部日期。悬停查看明细，点击固定；← → 切换日期，Esc 收起。</p><p id="modelPricingNote" hidden>API 等价仅绘制已定价部分，待定价用量不视为零成本。</p><p id="modelSingleDay" hidden>当前范围只有一天，折线显示单个数据点。<button class="text-button" data-range-jump="all">查看起点以来 →</button></p></div>
    </section>`;
  }

  function mount(element, nextReport) {
    root=element; report=nextReport; available=report.models.map(m=>m.name);
    byId('modelChoices').innerHTML=available.map(name=>`<label class="model-choice" style="--model-color:${color(name)}"><input type="checkbox" data-chart-model="${esc(name)}" ${hidden.has(name)?'':'checked'}><i aria-hidden="true"></i><span>${esc(name)}</span></label>`).join('') || '<span class="subtle">当前范围没有模型用量</span>';
    root.addEventListener('change', e => {
      if (e.target.matches('[data-model-visible]')) {
        visible[e.target.dataset.modelVisible]=e.target.checked;chart.pinned=false;
        update();return;
      }
      if (!e.target.matches('[data-chart-model]')) return;
      const name=e.target.dataset.chartModel;
      if (e.target.checked) hidden.delete(name); else hidden.add(name);
      resetPins();update();
    });
    root.addEventListener('click', e => {
      const button=e.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-model-dismiss')) {
        chart.pinned=false;hideDetail();return;
      }
      if (button.dataset.modelMetric) metric=button.dataset.modelMetric;
      else if (button.dataset.modelSelection) {
        for (const name of available) {
          if (button.dataset.modelSelection==='all') hidden.delete(name); else hidden.add(name);
        }
      } else return;
      resetPins();update();
    });
    const el=host();
    viewport?.release();
    viewport=UsageViewport.mount(el,JSON.stringify(['models',report.range,typeof state==='undefined'?null:[state.source,state.project,state.model,state.account]]),report.model_timeline.length,()=>{chart.pinned=false;draw();},()=>chart.geometry);
      el.addEventListener('pointermove', e => {
        if (chart.pinned) return;
        const index=pointerIndex(e);
        if(index==null)hideDetail();else showDetail(index);
      });
      el.addEventListener('pointerleave', () => { if (!chart.pinned) hideDetail(); });
      el.addEventListener('click', e => {
        const index=pointerIndex(e);
        if (index==null) return;
        chart.pinned=!(chart.pinned && chart.activeDate===days[index].date);
        showDetail(index);
      });
      el.addEventListener('focusin', e => {
        if (e.target.matches('.model-hit-area')) showDetail(Math.max(0, days.findIndex(d=>d.date===chart.activeDate)));
      });
      el.addEventListener('focusout', () => { if (!chart.pinned) hideDetail(); });
      el.addEventListener('keydown', e => {
        if (!chart.geometry || !e.target.matches('.model-hit-area')) return;
        let index=Math.max(0,days.findIndex(d=>d.date===chart.activeDate));
        if (e.key==='Escape') { chart.pinned=false;hideDetail();e.preventDefault();return; }
        if (e.key==='ArrowLeft') index--;
        else if (e.key==='ArrowRight') index++;
        else if (e.key==='Home') index=0;
        else if (e.key==='End') index=days.length-1;
        else if (e.key==='Enter' || e.key===' ') chart.pinned=!chart.pinned;
        else return;
        e.preventDefault();showDetail(Math.max(0,Math.min(days.length-1,index)));
      });
    observer.observe(el);
    update();viewport.refresh();
  }

  function update() {
    selected=available.filter(name=>!hidden.has(name));
    allDays=report.model_timeline.map(day=>{
      const cells=new Map(day.models.map(m=>[m.name,m]));
      const chosen=selected.map(name=>cells.get(name) || zero);
      return {date:day.date,cells:chosen,categories:categories.map(category=>({
        ...category,
        total:chosen.reduce((sum,c)=>sum+(c[category.key]||0),0),
        known_cost:chosen.reduce((sum,c)=>sum+(c[category.cost]||0),0),
        unpriced:chosen.some(c=>c.unpriced_events && c[category.key]>0)
      }))};
    });
    days=allDays;
    byId('modelSelectionCount').textContent=`已选 ${selected.length} / ${available.length}`;
    root.querySelectorAll('[data-chart-model]').forEach(input=>input.checked=!hidden.has(input.dataset.chartModel));
    root.querySelectorAll('[data-model-metric]').forEach(button=>{
      button.classList.toggle('selected',button.dataset.modelMetric===metric);
      button.setAttribute('aria-pressed',String(button.dataset.modelMetric===metric));
    });
    const visibleCount=Object.values(visible).filter(Boolean).length;
    root.querySelectorAll('[data-model-visible]').forEach(input=>{
      input.checked=visible[input.dataset.modelVisible];
      input.disabled=visibleCount===1 && input.checked;
      input.title=input.disabled?'至少显示一种内容':'';
    });
    byId('modelSingleDay').hidden=days.length!==1 || !selected.length;
    byId('modelPricingNote').hidden=metric!=='cost' || !report.models.some(m=>selected.includes(m.name) && m.unpriced_events);
    byId('modelCategoryLegend').hidden=!visible.stack;
    byId('modelCategoryLegend').innerHTML='<span class="model-legend-title">堆叠类别</span>'+categories.map(c=>`<span class="legend-item"><i style="background:${colors[c.key]}"></i>${c.label}</span>`).join('');
    byId('modelLineLegend').hidden=!visible.line;
    byId('modelLineLegend').innerHTML='<span class="model-legend-title">模型折线</span>'+selected.map(name=>`<span class="legend-item"><i class="legend-line" style="background:${color(name)}"></i>${esc(name)}</span>`).join('');
    draw();
  }

  function draw() {
    if (!root?.isConnected) return;
    days=viewport?viewport.slice(allDays):allDays;
    chart.geometry=null;
    tooltip().hidden=true;
    const el=host(),W=el.clientWidth,H=el.clientHeight;
    if (!W || !H) return;
    if (!available.length || !days.length) { el.innerHTML=empty();return; }
    if (!selected.length) { el.innerHTML='<div class="empty"><h3>选择要查看的模型</h3>点击上方模型名称，或点击“全选”恢复图表。</div>';return; }
    const unknownOnly=metric==='cost' && days.some(d=>d.cells.some(c=>c.unpriced_events)) && !days.some(d=>d.cells.some(c=>c.known_cost));
    if (unknownOnly) { el.innerHTML='<div class="empty"><h3>所选模型尚未定价</h3>切换到 Tokens 查看用量，或在“价格与计费”中补充单价。</div>';return; }
    const totals=days.map(d=>d.categories.reduce((sum,c)=>sum+value(c),0));
    // Both layers share the same dates, coordinates, and vertical scale.
    const peak=Math.max(visible.stack?Math.max(...totals):0,visible.line?Math.max(...days.map(d=>Math.max(...d.cells.map(value)))):0);
    const max=peak?peak*1.15:1;
    const ticks=Array.from({length:5},(_,i)=>metric==='cost'?usd(max*i/4):compact(max*i/4));
    const L=Math.max(70,...ticks.map(t=>t.length*8.4+14)),R=36,T=20,B=42,w=Math.max(1,W-L-R),h=H-T-B,step=w/days.length;
    const x=i=>L+step*(i+.5),y=n=>T+h-n/max*h;
    chart.geometry={L,R,T,w,h,step,W,H,x};
    let svg=`<svg class="chart model-daily-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${chartName()}">`;
    ticks.forEach((tick,i)=>{const yy=y(max*i/4);svg+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-12}" y="${yy+5}" text-anchor="end">${esc(tick)}</text>`;});
    const labelStep=Math.max(1,Math.ceil(days.length/Math.max(1,Math.floor(w/85)+1)));
    days.forEach((d,i)=>{if(i%labelStep===0)svg+=`<text x="${Math.max(36,Math.min(W-36,x(i)))}" y="${H-10}" text-anchor="middle">${d.date.slice(days[0].date.slice(0,4)===days.at(-1).date.slice(0,4)?5:2).replaceAll('-','/')}</text>`;});
    if (visible.stack) {
      svg+='<g class="model-stack-layer">';
      const bar=Math.max(.5,Math.min(28,step*.64));
      days.forEach((d,i)=>{
        let base=0;
        // Match the overview's category colors and stacking order.
        for (const key of ['cached','uncached','write','output']) {
          const category=d.categories.find(c=>c.key===key),n=value(category);base+=n;
          svg+=`<rect class="model-series" data-category="${key}" data-date="${d.date}" data-value="${n}" x="${x(i)-bar/2}" y="${y(base)}" width="${bar}" height="${n/max*h}" fill="${colors[key]}"/>`;
        }
      });
      svg+='</g>';
    }
    if (visible.line) {
      svg+='<g class="model-line-layer">';
      selected.forEach((name,j)=>{
        const points=days.map((d,i)=>`${x(i)},${y(value(d.cells[j]))}`).join(' ');
        svg+=`<polyline points="${points}" fill="none" stroke="var(--surface)" stroke-width="5.5" stroke-linejoin="round" aria-hidden="true"/><polyline class="model-series" data-series="${esc(name)}" points="${points}" fill="none" stroke="${color(name)}" stroke-width="2.5" stroke-linejoin="round"/>`;
        if(days.length<=90)days.forEach((d,i)=>{svg+=`<circle cx="${x(i)}" cy="${y(value(d.cells[j]))}" r="${days.length===1?5:3.5}" fill="${color(name)}" stroke="var(--surface)" stroke-width="1.5"/>`;});
      });
      svg+='</g>';
    }
    svg+=`<line class="model-crosshair" x1="0" x2="0" y1="${T}" y2="${T+h}" hidden/><rect class="model-hit-area" x="${L}" y="${T}" width="${w}" height="${h}" fill="transparent" tabindex="0" role="slider" aria-label="查看模型每日用量明细" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="${days.length}" aria-valuenow="1" aria-valuetext="${days[0].date}" aria-describedby="modelChartHelp"/></svg>`;
    const focused=el.contains(document.activeElement) && document.activeElement.matches('.model-hit-area');
    el.innerHTML=svg;
    if(focused)el.querySelector('.model-hit-area').focus({preventScroll:true});
    const active=days.findIndex(d=>d.date===chart.activeDate);
    if(chart.pinned && active>=0)showDetail(active);
    else if(active<0)chart.pinned=false;
  }

  function pointerIndex(event) {
    if(!chart.geometry)return null;
    const rect=host().getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,g=chart.geometry;
    if(x<g.L || x>g.L+g.w || y<g.T || y>g.T+g.h)return null;
    return Math.min(days.length-1,Math.floor((x-g.L)/g.step));
  }
  function hideDetail() {
    if(!root)return;
    tooltip().hidden=true;
    root.querySelector('.model-crosshair')?.setAttribute('hidden','');
  }
  function showDetail(index) {
    if(!chart.geometry || !days[index])return;
    const day=days[index],tip=tooltip(),x=chart.geometry.x(index);
    if(chart.activeDate===day.date && !tip.hidden && tip.dataset.pinned===String(chart.pinned))return;
    const total=day.cells.reduce((sum,c)=>sum+c.total,0),known=day.cells.reduce((sum,c)=>sum+c.known_cost,0),unknown=day.cells.some(c=>c.unpriced_events);
    chart.activeDate=day.date;tip.dataset.pinned=String(chart.pinned);
    const categoryRows=day.categories.map(c=>({name:c.label,color:colors[c.key],tokens:c.total,cost:usd(c.known_cost)+(c.unpriced?' + 待定价':'')}));
    const modelRows=day.cells.map((c,j)=>({name:selected[j],color:color(selected[j]),tokens:c.total,cost:costLabel(c)}));
    const section=(label,rows)=>`<tr class="model-tooltip-section"><th colspan="3">${label}</th></tr>`+rows.map(row=>`<tr><td><i class="dot" style="background:${row.color}"></i>${esc(row.name)}</td><td>${number(row.tokens)}</td><td>${row.cost}</td></tr>`).join('');
    tip.innerHTML=`<div class="model-tooltip-heading"><strong>${day.date}</strong><span>${chart.pinned?'已固定':'每日明细'}</span>${chart.pinned?'<button class="icon-button" data-model-dismiss aria-label="收起每日明细">×</button>':''}</div><table><thead><tr><th>明细</th><th>Tokens</th><th>API 等价</th></tr></thead><tbody>${visible.stack?section('按用量类别',categoryRows):''}${visible.line?section('按模型',modelRows):''}</tbody><tfoot><tr><th>所选合计</th><td>${number(total)}</td><td>${usd(known)}${unknown?' + 待定价':''}</td></tr></tfoot></table>`;
    tip.hidden=false;
    const frame=root.querySelector('.model-chart-frame'),px=host().offsetLeft+x;
    tip.style.left=Math.max(12,Math.min(frame.clientWidth-tip.offsetWidth-12,px+18))+'px';
    const line=root.querySelector('.model-crosshair');
    line.removeAttribute('hidden');line.setAttribute('x1',x);line.setAttribute('x2',x);
    const slider=root.querySelector('.model-hit-area');
    slider.setAttribute('aria-valuenow',index+1);
    slider.setAttribute('aria-valuetext',`${day.date}，所选模型合计 ${number(total)} tokens`);
  }
  function resetPins() { chart.pinned=false; }
  function release() {
    observer.disconnect();viewport?.release();viewport=null;root=null;
    chart.geometry=null;
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && root) { resetPins();hideDetail(); }
  });
  return {panel,mount,release};
})();
