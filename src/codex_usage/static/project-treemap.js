'use strict';

const ProjectTreemap = (() => {
  const hiddenProjects=new Map();
  const storageKey='codex-usage.treemap-hidden.v1';
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');
    if(Array.isArray(saved))for(const entry of saved){
      if(Array.isArray(entry) && typeof entry[0]==='string' && entry[1] && typeof entry[1].name==='string' && typeof entry[1].source==='string')
        hiddenProjects.set(entry[0],{name:entry[1].name,source:entry[1].source});
    }
  } catch { /* Unavailable storage must not prevent the chart from rendering. */ }
  let saveFailed=false;
  function saveHidden() {
    try { localStorage.setItem(storageKey,JSON.stringify([...hiddenProjects]));saveFailed=false; }
    catch { saveFailed=true; }
  }
  const visibleProjects=projects=>projects.filter(p=>!hiddenProjects.has(String(p.id)));
  const positive=value=>Number.isFinite(value) && value>0?value:0;

  function summarize(projects, metric='tokens') {
    const entries=projects.map(project=>({project,value:positive(metric==='cost'?project.known_cost:project.total)}))
      .filter(entry=>entry.value>0)
      .sort((a,b)=>b.value-a.value || String(a.project.id).localeCompare(String(b.project.id)));
    const total=entries.reduce((sum,entry)=>sum+entry.value,0);
    return {entries:entries.map(entry=>({...entry,share:entry.value/total})),total,
      excluded:projects.length-entries.length,unpriced:projects.filter(project=>project.unpriced_events>0).length};
  }

  // Squarify descending weights into strips along the shorter remaining edge.
  // Geometry has no minimum tile size: even a tiny project keeps its true share.
  function layout(entries, width, height) {
    if(!Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0)return [];
    const items=entries.filter(entry=>positive(entry.value)>0).sort((a,b)=>b.value-a.value);
    const total=items.reduce((sum,entry)=>sum+entry.value,0);
    if(!total || !Number.isFinite(total))return [];
    const pending=items.map(entry=>({...entry,area:entry.value/total*width*height}));
    const tiles=[];
    let x=0,y=0,w=width,h=height,index=0;
    const worst=(sum,min,max,side)=>Math.max(side*side*max/(sum*sum),sum*sum/(side*side*min));
    while(index<pending.length) {
      const start=index,side=Math.min(w,h);
      let sum=pending[index].area,min=sum,max=sum;
      index++;
      while(index<pending.length) {
        const next=pending[index].area;
        if(worst(sum+next,Math.min(min,next),Math.max(max,next),side)>worst(sum,min,max,side))break;
        sum+=next;min=Math.min(min,next);max=Math.max(max,next);index++;
      }
      const vertical=w>=h,edge=vertical?h:w;
      const thickness=index===pending.length?(vertical?w:h):sum/edge;
      let offset=0;
      for(let i=start;i<index;i++) {
        const length=i===index-1?edge-offset:pending[i].area/thickness;
        tiles.push({...pending[i],x:vertical?x:x+offset,y:vertical?y+offset:y,
          width:vertical?thickness:length,height:vertical?length:thickness});
        offset+=length;
      }
      if(vertical){x+=thickness;w=Math.max(0,width-x);}
      else {y+=thickness;h=Math.max(0,height-y);}
    }
    return tiles;
  }

  let root=null,report=null,observer=null,metric='tokens',summary=null,active=null;
  const get=id=>root.querySelector('#'+id);
  function panel() {
    return `<section class="panel project-treemap" id="projectTreemap" aria-labelledby="projectTreemapTitle">
      <div class="panel-head"><div><h2 id="projectTreemapTitle">项目用量分布</h2><p data-help>方块越大，用量越高。点击项目查看每日趋势；右键隐藏项目，下方点击 × 恢复。隐藏仅影响此图，面积和占比按剩余项目重新计算。</p></div>
      <div class="metric-switch" role="group" aria-label="项目分块图指标"><button data-treemap-metric="tokens">Tokens</button><button data-treemap-metric="cost">API 等价 USD</button></div></div>
      <div class="treemap-summary" id="treemapSummary"></div>
      <div class="treemap-board" id="treemapBoard" role="group" aria-label="项目用量矩形树图" aria-describedby="treemapNote"></div>
      <div class="treemap-hidden" id="treemapHidden" aria-label="已隐藏项目" hidden></div>
      <div class="treemap-footer" id="treemapNote"></div>
      <div class="treemap-tooltip" id="treemapTooltip" role="tooltip" hidden></div>
    </section>`;
  }
  function mount(element,nextReport) {
    root=element;report=nextReport;
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-treemap-restore-all')){
        hiddenProjects.clear();saveHidden();draw();
        root.querySelector('[data-treemap-metric]')?.focus({preventScroll:true});
      }
      else if(button.dataset.treemapRestore!==undefined){
        const id=button.dataset.treemapRestore;hiddenProjects.delete(id);saveHidden();draw();
        const tile=[...get('treemapBoard').querySelectorAll('[data-project-detail]')].find(el=>el.dataset.projectDetail===id);
        (tile||root.querySelector('[data-treemap-metric]'))?.focus({preventScroll:true});
      }
      else if(button.dataset.treemapMetric){metric=button.dataset.treemapMetric;draw();}
      else if(button.dataset.treemapIndex!==undefined)hide();
    });
    const hideProject=event=>{
      const tile=event.target.closest('[data-treemap-index]');if(!tile)return;
      const entry=summary.entries[Number(tile.dataset.treemapIndex)];if(!entry)return;
      event.preventDefault();event.stopPropagation();
      const p=entry.project;hiddenProjects.set(String(p.id),{name:p.name,source:p.source_name});saveHidden();draw();
      if(event.type==='keydown')get('treemapHidden').querySelector('button')?.focus({preventScroll:true});
    };
    root.addEventListener('contextmenu',hideProject);
    root.addEventListener('keydown',event=>{
      if(event.key==='ContextMenu' || (event.shiftKey && event.key==='F10'))hideProject(event);
    });
    root.addEventListener('pointerover',event=>{
      const tile=event.target.closest('[data-treemap-index]');if(tile)show(tile,event);
    });
    root.addEventListener('pointermove',event=>{
      const tile=event.target.closest('[data-treemap-index]');if(tile)position(tile,event);
    });
    get('treemapBoard').addEventListener('pointerleave',hide);
    root.addEventListener('focusin',event=>{if(event.target.dataset.treemapIndex!==undefined)show(event.target);});
    root.addEventListener('focusout',hide);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
    observer=new ResizeObserver(draw);
    observer.observe(get('treemapBoard'));
    draw();
  }
  function draw() {
    if(!root)return;
    hide();summary=summarize(visibleProjects(report.projects),metric);
    const hidden=get('treemapHidden');hidden.hidden=!hiddenProjects.size && !saveFailed;
    hidden.innerHTML=(hiddenProjects.size?'<span>已隐藏：</span>'+[...hiddenProjects].map(([id,p])=>`<span class="treemap-hidden-chip"><span>${esc(p.name)} · ${esc(p.source)}</span><button class="treemap-restore" data-treemap-restore="${esc(id)}" aria-label="恢复项目 ${esc(p.name)} · ${esc(p.source)}" title="恢复项目">×</button></span>`).join('')+'<button class="button small" data-treemap-restore-all>全部恢复</button>':'')+(saveFailed?'<span role="status">浏览器未能保存设置，本次修改仅在当前页面有效。</span>':'');
    root.querySelectorAll('[data-treemap-metric]').forEach(button=>{
      const selected=button.dataset.treemapMetric===metric;
      button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    });
    get('treemapSummary').innerHTML=`<span><strong>${summary.entries.length}</strong> 个项目 · ${esc(report.range.since)} — ${esc(report.range.until)}</span><span>${hiddenProjects.size?'可见项目 · ':''}${metric==='cost'?'已定价合计':'Token 合计'} <strong class="treemap-total">${metric==='cost'?usd(summary.total):compact(summary.total)}</strong></span>`;
    get('treemapNote').textContent=(metric==='cost'?'面积按 API 等价成本计算'+(summary.unpriced?`；${summary.unpriced} 个项目含未定价用量，仅绘制已定价部分`:''):'面积按总 Tokens 计算，包含输入与输出')+
      (summary.excluded?`。${summary.excluded} 个项目在此指标下无可绘制数值，仍可在下表查看`:'')+'。悬停或键盘聚焦查看明细。';
    const board=get('treemapBoard'),{width,height}=board.getBoundingClientRect();
    const focusedIndex=board.contains(document.activeElement)?document.activeElement.dataset.treemapIndex:null;
    const colors=new Map([...report.projects].sort((a,b)=>a.id.localeCompare(b.id)).map((project,index)=>[project.id,index%6]));
    board.innerHTML=layout(summary.entries,width,height).map((tile,index)=>{
      const p=tile.project,small=tile.width<155 || tile.height<165,tiny=tile.width<72 || tile.height<76;
      const label=`${p.name}，${p.source_name}，${number(p.total)} tokens，${metric==='cost'?'成本':'用量'}占比 ${percent(tile.share)}，点击查看每日趋势`;
      return `<button class="treemap-tile${small?' small-tile':''}${tile.height<96?' short-tile':''}${tile.height>=120 && tile.width>=110?' with-source':''}${tiny?' tiny-tile':''}${tile.width<36 || tile.height<28?' micro-tile':''}" data-treemap-index="${index}" data-project-detail="${esc(p.id)}" data-color="${colors.get(p.id)}" aria-label="${esc(label)}" aria-haspopup="dialog"
        style="left:${tile.x}px;top:${tile.y}px;width:${tile.width}px;height:${tile.height}px">
        <span class="treemap-tile-copy" aria-hidden="true"><strong class="treemap-name">${esc(p.name)}</strong><span class="treemap-source">${esc(p.source_name)}</span><span class="treemap-value">${metric==='cost'?usd(tile.value):compact(tile.value)}</span><span class="treemap-share">${percent(tile.share)}${metric==='cost' && p.unpriced_events?' · 部分已定价':''}</span></span></button>`;
    }).join('') || (hiddenProjects.size && !visibleProjects(report.projects).length ? '<div class="empty"><h3>当前项目已全部隐藏</h3><p>点击下方项目旁的 × 恢复显示。</p></div>' : `<div class="empty"><h3>${metric==='cost'?'暂无可绘制的 API 等价成本':'当前范围内没有项目用量'}</h3><p>${metric==='cost' && summary.unpriced?'模型价格尚未配置，可切换 Tokens 查看用量。':'试试调整日期或机器筛选。'}</p></div>`);
    if(focusedIndex!==null)board.querySelector(`[data-treemap-index="${focusedIndex}"]`)?.focus({preventScroll:true});
  }
  function show(tile,event) {
    const entry=summary.entries[Number(tile.dataset.treemapIndex)];if(!entry)return;
    if(active!==tile){hide();active=tile;tile.classList.add('is-active');}
    const p=entry.project,tooltip=get('treemapTooltip');
    tooltip.innerHTML=`<strong>${esc(p.name)}</strong><span class="treemap-tooltip-path">${esc(p.source_name)} · ${esc(p.path)}</span><dl><dt>总 Tokens</dt><dd>${number(p.total)}</dd><dt>API 等价</dt><dd>${usd(p.known_cost)}${p.unpriced_events?' + 待定价':''}</dd><dt>${metric==='cost'?'已定价成本':'Token 用量'}占比</dt><dd>${percent(entry.share)}</dd><dt>活跃会话</dt><dd>${number(p.sessions)}</dd></dl>${p.unpriced_events?`<p>${compact(p.unpriced_tokens)} tokens 尚未定价</p>`:''}<p>点击查看每日趋势 ↗ · 右键隐藏</p>`;
    tooltip.hidden=false;tile.setAttribute('aria-describedby','treemapTooltip');position(tile,event);
  }
  function position(tile,event) {
    const tooltip=get('treemapTooltip');if(tooltip.hidden)return;
    const bounds=root.getBoundingClientRect(),rect=tile.getBoundingClientRect();
    const x=(event?.clientX ?? rect.x+rect.width/2)-bounds.x,y=(event?.clientY ?? rect.y+rect.height/2)-bounds.y;
    let top=y+18;if(top+tooltip.offsetHeight>bounds.height-8)top=y-tooltip.offsetHeight-18;
    tooltip.style.left=Math.max(8,Math.min(x+18,bounds.width-tooltip.offsetWidth-8))+'px';
    tooltip.style.top=Math.max(8,top)+'px';
  }
  function hide() {
    if(!root)return;
    get('treemapTooltip').hidden=true;
    if(active){active.classList.remove('is-active');active.removeAttribute('aria-describedby');active=null;}
  }
  function release() {observer?.disconnect();observer=null;root=null;report=null;summary=null;active=null;}
  return {panel,mount,release,summarize,layout};
})();

if(typeof module!=='undefined' && module.exports)module.exports=ProjectTreemap;
