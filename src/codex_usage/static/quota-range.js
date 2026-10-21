'use strict';

const QuotaRange=(()=>{
  const title=e=>e.kind==='credit'?'重置卡重置（推断）':e.kind==='official'?'官方重置（默认）':'正常周期重置';
  const markerTitles={official:'官方重置',scheduled:'周期重置',credit:'重置卡重置'};
  const stamp=(at,zone)=>new Date(at*1000).toLocaleString('zh-CN',{timeZone:zone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const geometry={left:44,right:26,top:70,bottom:266,height:328};
  const controllers=new Map(),viewports=new Map();
  let viewportScope;
  function constrain(view,bounds) {
    const span=clamp(view.until-view.since,Math.min(3600,bounds.until-bounds.since),bounds.until-bounds.since);
    const since=clamp(view.since,bounds.since,bounds.until-span);
    return {since,until:since+span};
  }
  function zoom(view,bounds,factor,anchor=.5) {
    const ratio=clamp(anchor,0,1),duration=view.until-view.since;
    const span=clamp(duration*factor,Math.min(3600,bounds.until-bounds.since),bounds.until-bounds.since);
    const since=view.since+ratio*(duration-span);
    return constrain({since,until:since+span},bounds);
  }
  const viewportKey=(g,q)=>JSON.stringify([q.history_scope,g.window,g.plan,g.label]);
  function initialView(q) {
    return {since:Math.max(q.range.since,q.ticks?.at(-8)?.at ?? q.range.until-7*86400),until:q.range.until};
  }
  function adaptive(samples,begin,end,width) {
    const step=(end-begin)/Math.max(24,Math.floor(width/4));
    const buckets=new Map(),selected=new Set([samples[0],samples.at(-1)]);
    for(let i=0;i<samples.length;i++){
      const p=samples[i];
      if(p.at<begin){if(samples[i+1]?.at>=begin)selected.add(p);continue;}
      if(p.at>end){selected.add(p);break;}
      const key=Math.floor((p.at-begin)/step),bucket=buckets.get(key)||[];
      bucket.push(p);buckets.set(key,bucket);
    }
    for(const bucket of buckets.values()){
      selected.add(bucket[0]);selected.add(bucket.at(-1));
      selected.add(bucket.reduce((a,b)=>a.used_percent<b.used_percent?a:b));
      selected.add(bucket.reduce((a,b)=>a.used_percent>b.used_percent?a:b));
    }
    return [...selected].filter(Boolean).sort((a,b)=>a.at-b.at);
  }
  // Screen-space simplification removes sub-pixel steps without changing stored observations.
  function simplify(samples,x,y,tolerance=1) {
    if(samples.length<3)return samples;
    const keep=new Set([0,samples.length-1]),stack=[[0,samples.length-1]];
    while(stack.length){
      const [a,b]=stack.pop(),dx=x(samples[b].at)-x(samples[a].at),dy=y(samples[b].used_percent)-y(samples[a].used_percent);
      let maximum=tolerance,index=-1;
      for(let i=a+1;i<b;i++){
        const px=x(samples[i].at)-x(samples[a].at),py=y(samples[i].used_percent)-y(samples[a].used_percent);
        const t=clamp((px*dx+py*dy)/(dx*dx+dy*dy||1),0,1);
        const distance=Math.hypot(px-t*dx,py-t*dy);
        if(distance>maximum){maximum=distance;index=i;}
      }
      if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
    }
    return [...keep].sort((a,b)=>a-b).map(i=>samples[i]);
  }
  function gaps(group) {
    return group.samples.slice(1).flatMap((b,i)=>{
      const a=group.samples[i];
      return b.break_before && b.at-a.at>900 && b.used_percent>=a.used_percent
        && !group.events.some(e=>e.at>a.at && e.since<=b.at) ? [[a,b]] : [];
    });
  }
  // Monotone cubic interpolation: flat observations remain flat; no overshoot.
  function smoothPath(samples,x,y) {
    if(samples.length<2)return '';
    const h=samples.slice(1).map((p,i)=>p.at-samples[i].at);
    const d=h.map((dx,i)=>(samples[i+1].used_percent-samples[i].used_percent)/dx);
    const tangents=samples.map((_,i)=>{
      if(!i)return d[0];
      if(i===samples.length-1)return d.at(-1);
      if(d[i-1]*d[i]<=0)return 0;
      const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
      return (w1+w2)/(w1/d[i-1]+w2/d[i]);
    });
    const value=n=>Number(n.toFixed(3));
    let path=`M${value(x(samples[0].at))},${value(y(samples[0].used_percent))}`;
    for(let i=0;i<h.length;i++){
      const a=samples[i],b=samples[i+1],dx=h[i]/3;
      path+=` C${value(x(a.at+dx))},${value(y(a.used_percent+dx*tangents[i]))} ${value(x(b.at-dx))},${value(y(b.used_percent-dx*tangents[i+1]))} ${value(x(b.at))},${value(y(b.used_percent))}`;
    }
    return path;
  }
  function series(samples) {
    const segments=[];
    for(const p of samples){
      const last=segments.at(-1)?.at(-1);
      if(!last || p.break_before || p.at<=last.at || p.used_percent<last.used_percent)segments.push([]);
      segments.at(-1).push(p);
    }
    return segments;
  }
  function eventDetail(e,zone) {
    return `${title(e)} · ${stamp(e.at,zone)} 首次检测 · 剩余 ${number(100-e.before_used)}% → ${number(100-e.after_used)}% · 发生区间 ${stamp(e.since,zone)} — ${stamp(e.at,zone)}`;
  }
  function mount(host,group,q) {
    if(viewportScope!==q.history_scope){viewports.clear();viewportScope=q.history_scope;}
    const key=viewportKey(group,q),previous=controllers.get(host);
    if(previous?.key===key){previous.refresh(group,q);return;}
    previous?.release();
    const section=host.closest('.quota-range-window'),canvas=host.querySelector('.quota-range-canvas'),tooltip=host.querySelector('.quota-range-tooltip');
    const abort=new AbortController();let runs=series(group.samples);
    const state={key,view:constrain(viewports.get(key)||initialView(q),q.range),width:host.clientWidth,drag:null,frame:0,activeUntil:0,hover:null};
    controllers.set(host,state);
    let bounds=q.range;
    const listen=(target,type,fn,options={})=>target.addEventListener(type,fn,{...options,signal:abort.signal});
    function draw() {
      state.frame=0;
      const focus=host.querySelector('[data-reset-ids]:focus')?.dataset.resetIds;
      const html=chart(group,q,state.width,state.view);
      if(state.html!==html){canvas.innerHTML=html;state.html=html;}
      host.dataset.visibleSince=state.view.since;host.dataset.visibleUntil=state.view.until;
      const label=`${stamp(state.view.since,q.timezone)} — ${stamp(state.view.until,q.timezone)}`;
      const viewportLabel=section.querySelector('[data-range-viewport]');
      if(viewportLabel.textContent!==label)viewportLabel.textContent=label;
      host.setAttribute('aria-label',`${group.label}，${label}。滚轮缩放，拖动平移；加减键缩放，左右键平移，Home 恢复全范围。`);
      const full=state.view.until-state.view.since>=bounds.until-bounds.since-1;
      section.querySelector('[data-range-action="reset"]').disabled=full;
      section.querySelector('[data-range-action="out"]').disabled=full;
      section.querySelector('[data-range-action="in"]').disabled=state.view.until-state.view.since<=3600;
      host.classList.toggle('is-zoomed',!full);
      if(focus)[...host.querySelectorAll('[data-reset-ids]')].find(el=>el.dataset.resetIds===focus)?.focus({preventScroll:true});
      const date=at=>new Intl.DateTimeFormat('en-CA',{timeZone:q.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at*1000));
      for(const input of section.querySelectorAll('[data-range-date]')){
        input.min=q.range.since_date;input.max=q.range.until_date;
        if(document.activeElement!==input)input.value=date(input.dataset.rangeDate==='since'?state.view.since:state.view.until-1);
      }
      if(state.hover)showHover(state.hover);
    }
    function update(view,immediate=false) {
      state.view=constrain(view,bounds);state.activeUntil=Date.now()+250;
      viewports.set(key,state.view);
      if(viewports.size>24)viewports.delete(viewports.keys().next().value);
      if(immediate){cancelAnimationFrame(state.frame);draw();}
      else if(!state.frame)state.frame=requestAnimationFrame(draw);
    }
    const position=e=>{
      const rect=host.getBoundingClientRect(),scale=state.width/rect.width;
      return {x:(e.clientX-rect.left)*scale,y:(e.clientY-rect.top)*scale};
    };
    const inPlot=p=>p.x>=geometry.left && p.x<=state.width-geometry.right && p.y>=geometry.top && p.y<=geometry.bottom;
    function hideHover(){
      state.hover=null;host.querySelector('.quota-range-crosshair')?.setAttribute('hidden','');
      tooltip.hidden=true;host.removeAttribute('aria-describedby');
    }
    function showTooltip(text,p){
      if(tooltip.textContent!==text)tooltip.textContent=text;
      tooltip.hidden=false;host.setAttribute('aria-describedby',tooltip.id);
      const width=tooltip.offsetWidth,height=tooltip.offsetHeight;
      const x=p.x+14+width<=state.width-8?p.x+14:p.x-width-14;
      const y=p.y-height-14>=8?p.y-height-14:p.y+14;
      tooltip.style.left=clamp(x,8,Math.max(8,state.width-width-8))+'px';
      tooltip.style.top=clamp(y,8,Math.max(8,geometry.height-height-8))+'px';
    }
    function showHover(hover){
      state.hover=hover;
      const cross=host.querySelector('.quota-range-crosshair');cross?.setAttribute('hidden','');
      if(hover.ids){
        const events=group.events.filter(e=>hover.ids.includes(e.id));
        if(!events.length){hideHover();return;}
        showTooltip(events.map(e=>eventDetail(e,q.timezone)).join('\n'),hover);return;
      }
      const p=hover;
      if(!inPlot(p)){hideHover();return;}
      const at=state.view.since+(p.x-geometry.left)/(state.width-geometry.left-geometry.right)*(state.view.until-state.view.since);
      const gap=gaps(group).find(([a,b])=>at>a.at && at<b.at);
      if(gap){showTooltip(`采集中断 · ${stamp(gap[0].at,q.timezone)} — ${stamp(gap[1].at,q.timezone)}\n缺失区间连线仅供参考，不代表实际用量\n两端剩余 ${number(100-gap[0].used_percent)}% → ${number(100-gap[1].used_percent)}%`,p);return;}
      const tolerance=(state.view.until-state.view.since)*8/(state.width-geometry.left-geometry.right);
      const run=runs.find(s=>at>=s[0].at-tolerance && at<=s.at(-1).at+tolerance);
      const visible=run?.filter(s=>s.at>=state.view.since && s.at<=state.view.until);
      if(!visible?.length){showTooltip(`${stamp(at,q.timezone)}\n此处没有已保存的观测记录`,p);return;}
      const nearest=visible.reduce((a,b)=>Math.abs(a.at-at)<Math.abs(b.at-at)?a:b);
      const x=geometry.left+(nearest.at-state.view.since)/(state.view.until-state.view.since)*(state.width-geometry.left-geometry.right);
      cross?.setAttribute('x1',x);cross?.setAttribute('x2',x);cross?.removeAttribute('hidden');
      showTooltip(`${stamp(nearest.at,q.timezone)}\n已用 ${number(nearest.used_percent)}% · 剩余 ${number(100-nearest.used_percent)}%\n实际观测`,p);
    }
    state.refresh=(nextGroup,nextQuota)=>{
      group=nextGroup;q=nextQuota;runs=series(group.samples);bounds=q.range;state.view=constrain(state.view,bounds);
      if(state.drag)return;
      draw();
    };
    listen(host,'wheel',e=>{
      const p=position(e);if(!inPlot(p) || e.ctrlKey || !e.deltaY)return;
      e.preventDefault();
      const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?geometry.height:1);
      update(zoom(state.view,bounds,Math.exp(clamp(delta,-400,400)*.0025),(p.x-geometry.left)/(state.width-geometry.left-geometry.right)));
    },{passive:false});
    listen(host,'pointerdown',e=>{
      const p=position(e);if(e.button!==0 || !inPlot(p) || e.target.closest('[data-reset-ids]'))return;
      if(e.pointerType==='mouse')e.preventDefault();
      host.focus({preventScroll:true});host.setPointerCapture(e.pointerId);
      state.drag={id:e.pointerId,x:e.clientX,view:{...state.view}};
      host.classList.add('is-dragging');hideHover();
    });
    listen(host,'pointermove',e=>{
      if(state.drag){
        const span=state.drag.view.until-state.drag.view.since,rect=host.getBoundingClientRect();
        const delta=(state.drag.x-e.clientX)*state.width/rect.width/(state.width-geometry.left-geometry.right)*span;
        update({since:state.drag.view.since+delta,until:state.drag.view.until+delta});return;
      }
      const p=position(e),marker=e.target.closest('[data-reset-ids]');
      showHover(marker?{...p,ids:marker.dataset.resetIds.split(' ')}:p);
    });
    const stopDrag=()=>{state.drag=null;host.classList.remove('is-dragging');};
    listen(host,'pointerup',e=>{if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);stopDrag();});
    listen(host,'pointercancel',stopDrag);listen(host,'lostpointercapture',stopDrag);
    listen(host,'pointerleave',()=>{if(!state.drag)hideHover();});
    listen(host,'focusin',e=>{
      const marker=e.target.closest('[data-reset-ids]');if(!marker)return;
      const rect=marker.getBoundingClientRect(),p=position({clientX:rect.left+rect.width/2,clientY:rect.bottom});
      showHover({...p,ids:marker.dataset.resetIds.split(' ')});
    });
    listen(host,'focusout',e=>{if(!host.contains(e.relatedTarget))hideHover();});
    listen(host,'keydown',e=>{
      if(e.key==='Escape'){hideHover();return;}
      if(e.target!==host)return;
      const span=state.view.until-state.view.since;
      if(['+','=','-','ArrowLeft','ArrowRight','Home'].includes(e.key))e.preventDefault();else return;
      if(e.key==='Home')update(bounds,true);
      else if(e.key==='ArrowLeft' || e.key==='ArrowRight'){
        const delta=span*(e.key==='ArrowLeft'?-.2:.2);
        update({since:state.view.since+delta,until:state.view.until+delta},true);
      }else update(zoom(state.view,bounds,e.key==='-'?1.5:1/1.5),true);
    });
    listen(section,'click',e=>{
      const action=e.target.closest('[data-range-action]')?.dataset.rangeAction;
      if(action)update(action==='reset'?bounds:action==='recent'?initialView(q):zoom(state.view,bounds,action==='in'?1/1.5:1.5),true);
    });
    listen(section,'change',e=>{
      if(!e.target.matches('[data-range-date]'))return;
      const first=section.querySelector('[data-range-date="since"]'),last=section.querySelector('[data-range-date="until"]');
      const since=q.ticks.find(t=>t.date===first.value)?.at;
      const index=q.ticks.findIndex(t=>t.date===last.value),until=q.ticks[index+1]?.at;
      const valid=first.value<=last.value && Number.isFinite(since) && Number.isFinite(until);
      e.target.setCustomValidity(valid?'':'请选择有效的起止日期，开始日期不能晚于结束日期');
      if(valid){first.setCustomValidity('');last.setCustomValidity('');update({since,until},true);}
      else e.target.reportValidity();
    });
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
      const width=entries[0].contentRect.width;if(width<=0 || Math.abs(width-state.width)<.5)return;
      state.width=width;update(state.view);
    });
    state.release=()=>{abort.abort();observer?.disconnect();cancelAnimationFrame(state.frame);};
    hideHover();observer?.observe(host);draw();
  }
  function release(root) {
    for(const [host,state] of controllers)if(root.contains(host)){state.release();controllers.delete(host);}
  }
  function releaseDetached(){
    for(const [host,state] of controllers)if(!host.isConnected){state.release();controllers.delete(host);}
  }
  function interacting(root) {
    return [...controllers].some(([host,state])=>root.contains(host) && (state.drag || state.activeUntil>Date.now()));
  }
  function chart(group,q,width=800,viewport=q.range) {
    const {since:begin,until:end}=constrain(viewport,q.range),zone=q.timezone||'UTC';
    const {left,right,top,bottom,height}=geometry,plot=Math.max(1,width-left-right);
    const x=at=>left+(at-begin)/(end-begin)*plot,y=value=>bottom-value/100*(bottom-top);
    const paths=series(group.samples).filter(s=>s.at(-1).at>=begin && s[0].at<=end).map(s=>simplify(adaptive(s,begin,end,plot),x,y));
    const ticks=Math.max(1,Math.min(10,Math.floor(plot/90))),singleDay=end-begin<=25*3600;
    const step=Math.max(1,Math.ceil(((q.ticks?.length||1)-1)/ticks));
    const full=begin===q.range.since && end===q.range.until;
    const interval=[60,300,900,1800,3600,7200,10800,21600,43200,86400,172800,604800,1209600].find(n=>n>=(end-begin)/ticks)||2592000;
    const origin=q.ticks?.[0]?.at??q.range.since,aligned=origin+Math.ceil((begin-origin)/interval)*interval;
    const tickTimes=full && !singleDay && q.ticks?.length?q.ticks.filter((t,i)=>i%step===0 || i===q.ticks.length-1).map(t=>t.at):[begin,...Array.from({length:Math.max(0,Math.ceil((end-aligned)/interval))},(_,i)=>aligned+i*interval).filter(at=>at>begin && at<end),end];
    // Reserve the final label before drawing interior labels at narrow widths.
    const visibleTicks=tickTimes.filter((at,i)=>i===0 || i===tickTimes.length-1 || (x(at)-x(begin)>=65 && x(end)-x(at)>=65));
    const labels=visibleTicks.map((at,i)=>{
      const parts=stamp(at,zone).split(' ');
      return `<text x="${x(at)}" y="${bottom+25}" text-anchor="${i===0?'start':i===visibleTicks.length-1?'end':'middle'}">${parts[0]}${singleDay || !full?`<tspan x="${x(at)}" dy="19">${parts.at(-1)}</tspan>`:''}</text>`;
    }).join('');
    const markerBox=events=>{
      const labels=Object.entries(markerTitles).flatMap(([kind,label])=>{
        const count=events.filter(e=>e.kind===kind).length;
        return count?[label+(count>1?' ×'+count:'')]:[];
      });
      const size=Math.min(plot,24+Math.max(...labels.map(label=>Array.from(label).reduce((n,c)=>n+(/[^\x00-\x7f]/.test(c)?14:8),0))));
      const height=26+(labels.length-1)*18,y=Math.min(24,top-6-height);
      const center=clamp(x((events[0].at+events.at(-1).at)/2),left+size/2,width-right-size/2);
      return {labels,size,height,y,center,left:center-size/2,right:center+size/2};
    };
    const clusters=[];
    for(const e of group.events.filter(e=>e.at>=begin && e.at<=end).sort((a,b)=>a.at-b.at)){
      let current={events:[e],...markerBox([e])};
      // Merge labels that would overlap, including labels clamped at either edge.
      while(clusters.length && clusters.at(-1).right+8>current.left){
        const events=[...clusters.pop().events,...current.events];
        current={events,...markerBox(events)};
      }
      clusters.push(current);
    }
    const markers=clusters.map(c=>{
      const detail=c.events.map(e=>eventDetail(e,zone)).join('；');
      return `${c.events.map(e=>`<line class="quota-reset-guide" x1="${x(e.at)}" x2="${x(e.at)}" y1="${top-5}" y2="${bottom}"/>`).join('')}<g class="quota-range-event" tabindex="0" role="img" data-reset-ids="${esc(c.events.map(e=>e.id).join(' '))}" data-range-detail="${esc(detail)}" aria-label="${esc(detail)}"><rect x="${c.left}" y="${c.y}" width="${c.size}" height="${c.height}" rx="6"/>${c.labels.map((label,i)=>`<text x="${c.center}" y="${c.y+18+i*18}" text-anchor="middle">${label}</text>`).join('')}</g>`;
    }).join('');
    // Clip full paths instead of clamping their vertices: zoom preserves slopes at both edges.
    const clip='quota-range-clip-'+Array.from(String(group.id)).map(c=>c.codePointAt(0).toString(16)).join('-');
    return `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(group.label)}自定义范围额度曲线，重置处分段，含各周期均匀参考虚线"><defs><clipPath id="${clip}"><rect x="${left}" y="${top-3}" width="${plot}" height="${bottom-top+6}"/></clipPath></defs><g clip-path="url(#${clip})">${group.idle.filter(p=>p.until>begin && p.since<end).map(p=>`<rect class="quota-idle-band" x="${x(Math.max(begin,p.since))}" y="${top}" width="${x(Math.min(end,p.until))-x(Math.max(begin,p.since))}" height="${bottom-top}"/>`).join('')}${group.references.filter(r=>r.until>begin && r.since<end).map(r=>`<path class="quota-range-reference" d="M${x(r.since)},${y(r.before)} L${x(r.until)},${y(r.after)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/>`).join('')}</g>${[0,50,100].map(value=>`<text x="${left-6}" y="${y(value)+4}" text-anchor="end">${value}%</text><line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" stroke="var(--line)"/>`).join('')}<g clip-path="url(#${clip})">${gaps(group).filter(([a,b])=>b.at>=begin && a.at<=end).map(s=>`<path class="quota-range-gap" d="${smoothPath(s,x,y)}" fill="none" stroke="var(--quota-gap)" stroke-width="2" stroke-dasharray="5 4"/>`).join('')}${paths.map(s=>s.length>1?`<path class="quota-range-line" d="${smoothPath(s,x,y)}" fill="none" stroke="var(--accent-ink)" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"/>`:`<path class="quota-range-isolated" d="M${x(s[0].at)},${y(s[0].used_percent)-3} v6" stroke="var(--accent-ink)" stroke-width="2"/>`).join('')}<line class="quota-range-crosshair" hidden y1="${top}" y2="${bottom}" stroke="var(--accent-ink)" stroke-width="1" stroke-dasharray="2 3"/></g>${markers}${labels}</svg>`;
  }
  function panel(q) {
    if(q.busy && !q.groups)return '<p class="pace-panel-message" role="status">正在读取所选范围…</p>';
    if(!q.groups?.length)return `<p class="pace-panel-message">${q.problem?'请调整日期或重试。':'所选范围没有已保存的额度记录。'}</p>`;
    return q.groups.map(g=>`<section class="pace-window quota-range-window" data-range-group="${esc(g.id)}"><div class="quota-range-heading"><h3>${esc(g.label)}${q.groups.length>1?' · '+esc(g.plan)+' · '+esc(g.window):''}</h3><span>${q.timezone==='Asia/Shanghai'?'北京时间':esc(q.timezone)}</span></div><div class="quota-range-stats"><span>已保存历史 · ${g.segment_count} 个使用段</span><span>${g.events.length} 次重置</span><span>${number(g.sample_count)} 次观测</span><span>显示精度自动调整</span></div><div class="quota-range-toolbar"><span data-range-viewport></span><div role="group" aria-label="时间范围缩放"><button class="button small" data-range-action="out" aria-label="缩小时间轴">−</button><button class="button small" data-range-action="in" aria-label="放大时间轴">＋</button><button class="button small" data-range-action="reset">全部历史</button><button class="button small" data-range-action="recent">最近 7 天</button></div></div><details class="quota-range-dates"><summary>选择时间范围</summary><div class="quota-range-form"><label>开始日期<input type="date" data-range-date="since" required></label><label>结束日期<input type="date" data-range-date="until" required></label></div></details><div class="quota-range-chart" data-range-chart="${esc(g.id)}" tabindex="0" role="group"><div class="quota-range-canvas">${chart(g,q)}</div><div class="quota-range-tooltip" id="quota-tooltip-${esc(g.id)}" role="tooltip" hidden></div></div><div class="pace-chart-legend"><span><i class="pace-actual-key"></i>已用额度</span><span><i class="quota-gap-key"></i>采集中断（参考连线）</span><span><i class="pace-reference-key"></i>各周期均匀参考</span><span><i class="quota-idle-key"></i>闲置阶段</span><span>↻ 重置事件</span></div><p data-help>在绘图区滚动滚轮，以鼠标位置为中心缩放时间轴；左右拖动平移，“全部历史”显示保留期内的所有记录，默认显示最近 7 天，日期选择修改后立即生效。聚焦图表后可用加减键缩放、左右键平移、Home 恢复。最小显示 1 小时；自动同步不会改变当前视野。曲线按当前缩放自动简化细小阶梯并平滑显示已有观测，悬停显示最近的实际记录，孤立记录用短刻线保留，不补造中间用量。显示精度随时间范围和图表宽度自动调整；每段首尾及重置、采集空档两侧的记录始终保留。重置处断线；超过 15 分钟的采集空档使用蓝色虚线连接两端，连线仅供参考，不代表实际观测；不将恢复额度画成消耗。图中标注官方重置、周期重置或重置卡重置；悬停或聚焦查看事件详情，移开即隐藏。邻近标记按类型合并显示次数，官方与重置卡类型仍为规则推断。虚线按每个接口周期计算，提前重置处分段；阴影为周期前满额闲置，未采集部分不能证明没有使用。</p></section>`).join('');
  }
  return {panel,chart,series,eventDetail,mount,release,releaseDetached,interacting,constrain,zoom,smoothPath,viewportKey,initialView,adaptive,simplify,gaps};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=QuotaRange;
