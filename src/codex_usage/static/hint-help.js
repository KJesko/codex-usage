'use strict';

// Explicit explanatory blocks only: data, errors and empty states stay visible.
const HintHelp=(()=>{
  const selector=['[data-help]','#pageSubtitle','#usageBoundary','.metric-note',
    '.inset-note:not([data-help-keep])','.insight-note:not([data-help-keep])',
    '.pace-chart-help','.help-copy:not(:has(h3))','.help-copy>p',
    '.notice:not(.warning)','#activityScope','#treemapNote','#modelChartHelp',
    '#modelPricingNote','#modelSingleDay','.field>p','.notification-setting>p',
    '.insight-controls>span','.table-toolbar>.subtle','.model-chart-toolbar>.subtle',
    '.pace-chart-caption>span:last-child','.formula','.price-source',
    '.alerts-intro','.collection-details>p:first-child'].join(',');
  const groups=new Map();
  let popup,body,title,active=null,scheduled=false;
  const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6" stroke-linecap="round"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/></svg>';
  function caption(node){
    const copy=node.cloneNode(true);copy.querySelectorAll('.help-trigger,.badge').forEach(button=>button.remove());
    return copy.textContent.trim().replace(/\s+/g,' ').slice(0,60);
  }
  const helpTitle=label=>label.endsWith('说明')?label:label+'说明';
  function placement(source){
    const field=source.closest('label.field');
    if(field)return {anchor:field.querySelector(':scope>span'),label:caption(field.querySelector(':scope>span'))};
    const metric=source.closest('.metric');
    if(metric)return {anchor:metric.querySelector('.metric-label'),label:caption(metric.querySelector('.metric-label'))};
    if(source.id==='pageSubtitle')return {anchor:document.getElementById('pageTitle'),label:caption(document.getElementById('pageTitle'))};
    const popover=source.closest('[popover]');
    if(source.matches('.alerts-intro'))return {anchor:popover?.querySelector('h2'),label:'额度提醒'};
    const scope=source.closest('.pace-window,.trend-table,.panel');
    const heading=scope?.querySelector(':scope>h3,:scope>.quota-range-heading h3,:scope>.panel-head h2,:scope>.panel-head h3,:scope>.table-toolbar h2,:scope>.table-toolbar h3,:scope>.settings-body>h3,:scope>h2');
    return heading?{anchor:heading,label:caption(heading)}:{anchor:null,label:source.dataset.help||(source.id==='usageBoundary'?'统计起点':source.matches('.coverage-notice')?'统计范围':'补充说明')};
  }
  function scan(){
    scheduled=false;
    if(active && !popup.isConnected){
      (active.parent.isConnected?active.parent:document.body).append(popup);
      popup.showPopover();position();
    }
    const next=new Map();
    for(const source of document.querySelectorAll(selector)){
      if(source.closest('#hintHelpPopover') || source.matches('.is-stale,[role="alert"]') || source.querySelector('[role="alert"],.is-stale'))continue;
      // The outer explanatory block already includes its children.
      if(source.parentElement?.closest(selector))continue;
      source.classList.add('help-source');
      if(source.hidden || !source.textContent.trim())continue;
      const place=placement(source),key=place.anchor||source;
      if(!next.has(key))next.set(key,{...place,sources:[]});
      next.get(key).sources.push(source);
    }
    for(const [key,entry] of groups){
      if(!next.has(key)){entry.button.remove();groups.delete(key);}
    }
    for(const [key,entry] of next){
      const old=groups.get(key);
      const button=old?.button||document.createElement('button');
      if(!old){
        button.type='button';button.className='help-trigger';button.innerHTML=icon;
        button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','hintHelpPopover');
        button.setAttribute('aria-expanded','false');
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(key);});
      }
      const label=helpTitle(entry.label);
      if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
      if(!button.isConnected){
        if(entry.anchor)entry.anchor.append(button);
        else {button.classList.add('help-standalone');entry.sources[0].before(button);}
      }
      groups.set(key,{...entry,button});
    }
  }
  function position(){
    if(!active || !popup.matches(':popover-open'))return;
    const rect=active.button.isConnected?active.button.getBoundingClientRect():active.rect;
    const width=document.documentElement.clientWidth,height=window.innerHeight;
    popup.style.maxWidth=Math.max(0,width-24)+'px';popup.style.maxHeight=Math.max(100,height-32)+'px';
    popup.style.left=Math.max(12,Math.min(rect.left,popup.offsetWidth?width-popup.offsetWidth-12:rect.left))+'px';
    const below=rect.bottom+8,top=below+popup.offsetHeight<=height-12?below:rect.top-popup.offsetHeight-8;
    popup.style.top=Math.max(12,Math.min(top,height-popup.offsetHeight-12))+'px';
  }
  function close(restore=false){
    if(!active)return;
    const previous=active;active=null;previous.button.setAttribute('aria-expanded','false');
    if(popup.matches(':popover-open'))popup.hidePopover();
    if(restore){
      const button=previous.button.isConnected?previous.button:[...groups.values()].find(entry=>entry.label===previous.label)?.button;
      button?.focus({preventScroll:true});
    }
  }
  function open(key){
    const entry=groups.get(key);if(!entry)return;
    if(active?.button===entry.button){close(true);return;}
    close();
    // Keep help usable inside modal dialogs and existing filter popovers.
    const parent=entry.button.closest('dialog,[popover]')||document.body;
    if(popup.parentElement!==parent)parent.append(popup);
    title.textContent=helpTitle(entry.label);body.replaceChildren();
    for(const source of entry.sources){
      const block=document.createElement('div');block.className='help-text-block';block.innerHTML=source.innerHTML;
      if(source.title){const extra=document.createElement('p');extra.textContent=source.title;block.append(extra);}
      block.querySelectorAll('.help-trigger').forEach(node=>node.remove());
      block.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      block.querySelectorAll('.help-source').forEach(node=>node.classList.remove('help-source'));
      block.querySelectorAll('[data-help]').forEach(node=>node.removeAttribute('data-help'));
      if(source.matches('.notice'))block.querySelector(':scope>svg')?.remove();
      body.append(block);
    }
    active={...entry,parent,rect:entry.button.getBoundingClientRect()};
    entry.button.setAttribute('aria-expanded','true');popup.showPopover();position();
    popup.querySelector('.help-close').focus({preventScroll:true});
  }
  function init(){
    popup=document.createElement('section');popup.id='hintHelpPopover';popup.className='help-popover';
    popup.setAttribute('popover','manual');popup.setAttribute('role','dialog');popup.setAttribute('aria-labelledby','hintHelpTitle');
    popup.innerHTML='<div class="help-popover-head"><h2 id="hintHelpTitle">说明</h2><button type="button" class="icon-button help-close" aria-label="关闭说明">×</button></div><div class="help-popover-body"></div>';
    document.body.append(popup);body=popup.querySelector('.help-popover-body');title=popup.querySelector('h2');
    popup.querySelector('.help-close').addEventListener('click',()=>close(true));
    popup.addEventListener('click',event=>{if(event.target.closest('[data-view],[data-range-jump]'))close();});
    document.addEventListener('pointerdown',event=>{if(active && !popup.contains(event.target) && !active.button.contains(event.target))close();},true);
    document.addEventListener('keydown',event=>{if(active && event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}},true);
    document.addEventListener('click',event=>{if(active && event.target.closest('[data-view],[data-overview-tab]'))close();});
    window.addEventListener('popstate',()=>close());window.addEventListener('resize',position);document.addEventListener('scroll',position,true);
    new MutationObserver(changes=>{
      if(scheduled || changes.every(change=>popup.contains(change.target)))return;
      scheduled=true;queueMicrotask(scan);
    }).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
    scan();
  }
  if(typeof document!=='undefined')init();
  return {scan,close};
})();
