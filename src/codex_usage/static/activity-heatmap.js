'use strict';

const ActivityHeatmap = (() => {
  const dayMs=86400000;
  const fields=['total','input','uncached','cached','write','output','known_cost','unpriced_tokens','events'];
  const blank=()=>Object.fromEntries(fields.map(key=>[key,0]));
  const date=s=>new Date(s+'T00:00:00Z');
  const iso=d=>d.toISOString().slice(0,10);
  const shift=(s,n)=>iso(new Date(date(s).getTime()+n*dayMs));
  const monday=s=>shift(s,-((date(s).getUTCDay()+6)%7));
  const monthStart=(s,delta=0)=>iso(new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7))-1+delta,1)));
  const monthEnd=s=>shift(monthStart(s,1),-1);
  const add=(target,source)=>{for(const key of fields)target[key]+=source[key]||0;return target;};

  // Date strings already represent the report timezone. UTC arithmetic only lays
  // out calendar days; it must not reinterpret the timestamps in the browser zone.
  function build(report, mode='day', offset=0) {
    const until=report.range.until<report.range.today?report.range.until:report.range.today;
    const since=report.range.since;
    let endMonth=monthStart(until,offset*12);
    if(endMonth>monthStart(until) || monthEnd(endMonth)<since){endMonth=monthStart(until);offset=0;}
    const start=monthStart(endMonth,-11),end=monthEnd(endMonth),gridStart=monday(start);
    const gridEnd=shift(monday(end),6),weeks=(date(gridEnd)-date(gridStart)+dayMs)/(7*dayMs);
    const daily=new Map(),cumulative=new Map(),running=blank(),summary={...blank(),activeDays:0};
    for(const row of report.model_timeline) {
      if(row.date<since || row.date>until)continue;
      const value=row.models.reduce((sum,cell)=>add(sum,cell),blank());
      // Daily sessions are deduplicated across models by the report.
      if(Number.isFinite(row.sessions))value.sessions=row.sessions;
      daily.set(row.date,value);
      add(running,value);cumulative.set(row.date,{...running});
      if(row.date>=start && row.date<=end){add(summary,value);if(value.total>0)summary.activeDays++;}
    }
    const cells=[];
    if(mode==='week') {
      for(let col=0;col<weeks;col++) {
        const key=shift(gridStart,col*7),last=shift(key,6);
        const from=[key,start,since].sort().at(-1),to=[last,end,until].sort()[0];
        // Clip boundary weeks to this calendar window as well as the filters.
        const value=blank();
        for(let d=from;d<=to;d=shift(d,1))add(value,daily.get(d)||blank());
        cells.push({key,from,to,column:col,row:0,included:from<=to,value,dayValue:value});
      }
    } else {
      for(let key=gridStart;key<=gridEnd;key=shift(key,1)) {
        const index=(date(key)-date(gridStart))/dayMs;
        const included=key>=start && key<=end && key>=since && key<=until;
        const dayValue=daily.get(key)||blank();
        cells.push({key,from:key,to:key,column:Math.floor(index/7),row:index%7,included,
          padding:key<start||key>end,value:mode==='cumulative'?(cumulative.get(key)||blank()):dayValue,dayValue});
      }
    }
    const peak=Math.max(0,...cells.filter(c=>c.included).map(c=>c.value.total));
    for(const cell of cells)cell.level=cell.included && cell.value.total>0?Math.max(1,Math.ceil(Math.sqrt(cell.value.total/peak)*4)):0;
    const months=Array.from({length:12},(_,i)=>{
      const key=monthStart(start,i);
      return {key,label:globalThis.WebLanguage?.month(key) ?? Number(key.slice(5,7))+'月',column:Math.floor((date(key)-date(gridStart))/(7*dayMs))};
    });
    return {mode,offset,start,end,until,since,weeks,cells,months,summary,
      canPrevious:monthEnd(monthStart(endMonth,-12))>=since,canNext:endMonth<monthStart(until)};
  }

  let root=null,report=null,calendar=null,mode='day',offset=0,active=null;
  const labels={day:'每天',week:'每周',cumulative:'累计总量'};
  function panel() {
    return `<section class="panel activity-panel" id="tokenActivity" aria-labelledby="activityTitle">
      <div class="panel-head"><h2 id="activityTitle">Token 活动</h2><div class="segmented" role="group" aria-label="Token 活动视图">${Object.entries(labels).map(([key,label])=>`<button data-activity-mode="${key}">${label}</button>`).join('')}</div></div>
      <div class="activity-meta"><div class="activity-window"><button class="icon-button" data-activity-window="-1" aria-label="查看更早十二个月">‹</button><span id="activityWindow"></span><button class="icon-button" data-activity-window="1" aria-label="查看更新十二个月">›</button></div><span id="activitySummary"></span></div>
      <div class="activity-grid-wrap"><div class="activity-calendar" id="activityCalendar" role="group" aria-label="Token 活动日历"></div></div>
      <div class="activity-footer"><p id="activityScope"></p><div class="activity-scale" aria-label="用量颜色由浅到深"><span>少</span>${[0,1,2,3,4].map(level=>`<i data-level="${level}" aria-hidden="true"></i>`).join('')}<span>多</span></div></div>
      <div class="activity-detail" id="activityDetail" role="status" aria-live="polite" hidden></div>
    </section>`;
  }
  const get=id=>root.querySelector('#'+id);
  function mount(element,nextReport) {
    root=element;report=nextReport;
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.activityMode){mode=button.dataset.activityMode;active=null;draw();return;}
      if(button.dataset.activityWindow){offset+=Number(button.dataset.activityWindow);active=null;draw();return;}
      if(button.dataset.activityKey && !button.disabled)show(button.dataset.activityKey);
    });
    root.addEventListener('pointerover',event=>{
      const cell=event.target.closest('[data-activity-key]');if(cell && !cell.disabled)show(cell.dataset.activityKey);
    });
    root.addEventListener('pointerout',event=>{
      const cell=event.target.closest('[data-activity-key]');
      if(cell && !cell.contains(event.relatedTarget))hide();
    });
    root.addEventListener('focusin',event=>{if(event.target.dataset.activityKey)show(event.target.dataset.activityKey);});
    root.addEventListener('focusout',event=>{if(event.target.dataset.activityKey)hide();});
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){hide();return;}
      const key=event.target.dataset.activityKey;if(!key)return;
      const enabled=calendar.cells.filter(c=>!c.padding),index=enabled.findIndex(c=>c.key===key);
      let target=index;
      if(event.key==='Home')target=0;
      else if(event.key==='End')target=enabled.length-1;
      else if(event.key==='ArrowLeft')target-=mode==='week'?1:7;
      else if(event.key==='ArrowRight')target+=mode==='week'?1:7;
      else if(event.key==='ArrowUp')target--;
      else if(event.key==='ArrowDown')target++;
      else return;
      event.preventDefault();
      const cell=enabled[Math.max(0,Math.min(enabled.length-1,target))];
      root.querySelector(`[data-activity-key="${cell.key}"]`).focus();
    });
    draw();
  }
  function draw() {
    calendar=build(report,mode,offset);
    // A new filter may move the available dates into a different calendar window.
    offset=calendar.offset;
    root.querySelectorAll('[data-activity-mode]').forEach(button=>{
      const selected=button.dataset.activityMode===mode;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    });
    root.querySelector('[data-activity-window="-1"]').disabled=!calendar.canPrevious;
    root.querySelector('[data-activity-window="1"]').disabled=!calendar.canNext;
    get('activityWindow').textContent=calendar.start.slice(0,7).replace('-','/')+' — '+calendar.end.slice(0,7).replace('-','/');
    get('activitySummary').innerHTML=`<strong>${number(calendar.summary.activeDays)}</strong> 个活跃日 · <strong>${compact(calendar.summary.total)}</strong> tokens`;
    get('activityScope').textContent=(mode==='week'?'每格一周，周一开始。':mode==='cumulative'?`每格为 ${calendar.since} 起截至当天的累计量。`:'每格一天。')+'空白格未纳入统计，浅色格为零用量；颜色按当前视窗相对用量划分。';
    const valid=calendar.cells.filter(c=>!c.padding),focusKey=valid.some(c=>c.key===active)?active:valid.filter(c=>c.included).at(-1)?.key||valid[0]?.key;
    const host=get('activityCalendar');host.style.setProperty('--activity-weeks',calendar.weeks);
    host.classList.toggle('is-weekly',mode==='week');
    host.innerHTML=calendar.cells.map(c=>{
      const range=mode==='week'?`${c.from} 至 ${c.to}`:c.key;
      const label=c.included?`${range}，${mode==='cumulative'?'累计 ':''}${number(c.value.total)} tokens，API 等价 ${usd(c.value.known_cost)}${c.value.unpriced_tokens?'，另有待定价用量':''}`:`${c.key}，未纳入当前统计`;
      return `<button class="activity-cell${c.padding?' is-padding':''}${!c.included?' is-excluded':''}" data-activity-key="${c.key}" data-level="${c.level}" style="grid-column:${c.column+1};grid-row:${mode==='week'?'1 / 8':c.row+1}" aria-label="${esc(label)}" ${c.padding?'disabled aria-hidden="true"':''} tabindex="${c.key===focusKey?'0':'-1'}"></button>`;
    }).join('')+calendar.months.map(m=>`<span class="activity-month" style="grid-column:${m.column+1} / span 3;grid-row:8" aria-hidden="true">${m.label.slice(0,-1)}<span class="activity-month-suffix">月</span></span>`).join('');
    hide();
  }
  function show(key) {
    const cell=calendar.cells.find(c=>c.key===key);if(!cell || cell.padding)return;
    active=key;
    const button=root.querySelector(`[data-activity-key="${key}"]`),tip=get('activityDetail');
    root.querySelectorAll('[data-activity-key]').forEach(el=>{el.tabIndex=el===button?0:-1;el.classList.toggle('is-active',el===button);el.removeAttribute('aria-describedby');});
    button.setAttribute('aria-describedby','activityDetail');
    const label=mode==='week'?(cell.included?cell.from+' — '+cell.to:key+' — '+shift(key,6)):key;
    const details=[['输入',cell.value.input],['其中缓存读取',cell.value.cached],['输出',cell.value.output]];
    if(mode==='day' && Number.isFinite(cell.value.sessions))details.push(['会话数',cell.value.sessions]);
    tip.innerHTML=`<strong>${label}</strong>${cell.included?`<div class="activity-detail-total">${number(cell.value.total)} <span>${mode==='cumulative'?'累计 Token':'个 Token'}</span></div><dl class="activity-detail-breakdown">${details.map(([name,value])=>`<div><dt>${name}</dt><dd>${number(value)}</dd></div>`).join('')}<div><dt>API 等价</dt><dd>${usd(cell.value.known_cost)}${cell.value.unpriced_tokens?' + 待定价':''}</dd></div></dl>`:`<p>${key>report.range.today?'尚未到来':'未纳入当前统计'}</p>`}`;
    tip.hidden=false;
    const box=button.getBoundingClientRect(),base=root.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(root.clientWidth-tip.offsetWidth-8,box.left-base.left+box.width/2-tip.offsetWidth/2))+'px';
    tip.style.top=(box.top-tip.offsetHeight-8>=0?box.top-base.top-tip.offsetHeight-8:box.bottom-base.top+8)+'px';
  }
  function hide(){if(root){get('activityDetail').hidden=true;root.querySelectorAll('.activity-cell.is-active').forEach(el=>{el.classList.remove('is-active');el.removeAttribute('aria-describedby');});}}
  function release(){root=null;report=null;calendar=null;}
  if(typeof document!=='undefined')document.addEventListener('pointerdown',event=>{if(root && !root.contains(event.target))hide();});
  return {panel,mount,release,build};
})();
if(typeof module!=='undefined')module.exports=ActivityHeatmap;
