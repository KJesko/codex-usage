'use strict';

// One shared popup. Only select mutations are observed; visible options stay bounded.
const ThemedSelect=(()=>{
  function mount(root=document){
    const controls=new Map(),abort=new AbortController();let queued=false,active=null,page=0,query='';
    const listen=(node,type,callback,options={})=>node.addEventListener(type,callback,{...options,signal:abort.signal});
    const menu=document.createElement('div');menu.className='font-menu select-menu';menu.id='sharedSelectMenu';menu.setAttribute('popover','auto');menu.setAttribute('role','dialog');document.body.append(menu);
    const check='<svg class="rounded-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';
    const arrow='<svg class="rounded-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    function cleanup(){active?.button.setAttribute('aria-expanded','false');active=null;menu.replaceChildren();}
    function close(){if(menu.matches(':popover-open'))menu.hidePopover();cleanup();}
    function update(select,button){
      select.classList.add('custom-select-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
      if(select.nextElementSibling!==button)select.after(button);
      const label=select.selectedOptions[0]?.textContent||'';
      if(button.dataset.label!==label){button.dataset.label=label;const text=document.createElement('span');text.textContent=label;button.replaceChildren(text);button.insertAdjacentHTML('beforeend',arrow);}
      if(button.disabled!==select.disabled)button.disabled=select.disabled;
      if(button.hidden!==select.hidden)button.hidden=select.hidden;
      const name=select.getAttribute('aria-label')||select.closest('label')?.querySelector('span')?.textContent||select.labels?.[0]?.textContent?.trim()||select.id;
      if(button.getAttribute('aria-label')!==name)button.setAttribute('aria-label',name);
      for(const name of ['aria-describedby','aria-invalid']){const value=select.getAttribute(name);if(value!==button.getAttribute(name)){if(value===null)button.removeAttribute(name);else button.setAttribute(name,value);}}
    }
    function sync(){
      queued=false;
      for(const [select,button] of controls){if(!select.isConnected){if(active?.select===select)close();button.remove();controls.delete(select);}}
      root.querySelectorAll('select').forEach(select=>{
        if(select.id==='language'||select.multiple||select.size>1)return;
        let button=controls.get(select);
        if(!button){
          button=document.createElement('button');button.type='button';button.className='select-trigger';button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','sharedSelectOptions');controls.set(select,button);
          // Listeners belong to the nodes. Detached controls are collectible after Map cleanup.
          button.addEventListener('click',()=>open(select,button));
          button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(select,button);const options=menu.querySelectorAll('[role=option]:not(:disabled)');(event.key==='End'?options[options.length-1]:options[0])?.focus();}});
          select.addEventListener('change',()=>{update(select,button);});
        }
        update(select,button);
      });
      if(active){if(active.select.disabled||active.select.hidden||!active.button.getClientRects().length)close();else draw();}
    }
    function place(){
      if(!active)return;
      const rect=active.button.getBoundingClientRect();menu.style.width=Math.min(Math.max(rect.width,220),innerWidth-24)+'px';
      menu.style.maxHeight=Math.max(80,Math.min(420,innerHeight-24))+'px';
      menu.style.left=Math.max(12,Math.min(rect.left,innerWidth-menu.offsetWidth-12))+'px';
      menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,rect.bottom+menu.offsetHeight+8>innerHeight?rect.top-menu.offsetHeight-6:rect.bottom+6))+'px';
    }
    function draw(){
      if(!active)return;
      const {select,button}=active,all=Array.from(select.options).filter(option=>!option.hidden && !option.parentElement.hidden);
      const rows=all.filter(option=>option.textContent.toLocaleLowerCase().includes(query.toLocaleLowerCase())),size=100;
      page=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));
      let list=menu.querySelector('[role=listbox]');
      if(!list){
        if(all.length>size){const search=document.createElement('input');search.type='search';search.className='select-search';search.setAttribute('aria-label','搜索选项');search.placeholder='搜索选项';search.value=query;search.addEventListener('input',()=>{query=search.value;page=0;draw();});menu.append(search);}
        list=document.createElement('div');list.id='sharedSelectOptions';list.setAttribute('role','listbox');menu.append(list);
      }
      list.setAttribute('aria-label',button.getAttribute('aria-label'));list.replaceChildren();
      for(const [offset,option] of rows.slice(page*size,(page+1)*size).entries()){
        const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.setAttribute('aria-setsize',String(rows.length));item.setAttribute('aria-posinset',String(page*size+offset+1));item.disabled=option.disabled||option.parentElement.disabled;
        const label=document.createElement('span');label.textContent=option.textContent;item.append(label);if(option.selected)item.insertAdjacentHTML('beforeend',check);
        item.addEventListener('click',()=>{select.value=option.value;close();select.dispatchEvent(new Event('change',{bubbles:true}));update(select,button);button.focus();});list.append(item);
      }
      if(!rows.length){const empty=document.createElement('div');empty.className='select-empty';empty.textContent='没有匹配的选项';list.append(empty);}
      menu.querySelector('.select-pagination')?.remove();
      if(rows.length>size){const footer=document.createElement('div');footer.className='select-pagination';const text=document.createElement('span');text.textContent=(page*size+1)+'–'+Math.min((page+1)*size,rows.length)+' / '+rows.length;footer.append(text);for(const [delta,label] of [[-1,'上一页'],[1,'下一页']]){const control=document.createElement('button');control.type='button';control.textContent=label;control.disabled=page+delta<0||(page+delta)*size>=rows.length;control.addEventListener('click',()=>{page+=delta;draw();menu.querySelector('[role=option]')?.focus();});footer.append(control);}menu.append(footer);}
      place();
    }
    function open(select,button){
      close();active={select,button};query='';page=Math.max(0,Math.floor(select.selectedIndex/100));draw();menu.setAttribute('aria-label',button.getAttribute('aria-label'));menu.showPopover();button.setAttribute('aria-expanded','true');place();
      (menu.querySelector('[aria-selected=true]')||menu.querySelector('[role=option]'))?.focus();
    }
    listen(menu,'toggle',()=>{if(!menu.matches(':popover-open'))cleanup();});
    listen(menu,'keydown',event=>{
      const items=[...menu.querySelectorAll('[role=option]:not(:disabled)')],index=items.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&(!event.target.matches('input')||event.key.startsWith('Arrow'))){event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
      else if(event.key==='Escape'||event.key==='Tab'){const button=active?.button;close();if(event.key==='Escape'){event.preventDefault();button?.focus();}}
      else if(event.key.length===1&&!event.target.matches('input'))items.find(item=>item.textContent.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))?.focus();
    });
    const hasSelect=node=>node.nodeType===1&&(node.matches('select')||node.querySelector('select'));
    const observer=new MutationObserver(records=>{
      if(records.some(record=>record.target.closest?.('select')||record.type==='childList'&&[...record.addedNodes,...record.removedNodes].some(hasSelect))&&!queued){queued=true;queueMicrotask(sync);}
    });
    observer.observe(root.body||root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','selected','label']});
    listen(window,'resize',close);listen(document,'scroll',event=>{if(active&&!menu.contains(event.target))close();},{capture:true});sync();
    return {sync,close,inspect:()=>({controls:controls.size,open:Boolean(active),options:menu.querySelectorAll('[role=option]').length}),dispose(){observer.disconnect();abort.abort();close();for(const [select,button] of controls){button.remove();select.classList.remove('custom-select-native');select.removeAttribute('tabindex');select.removeAttribute('aria-hidden');}controls.clear();menu.remove();}};
  }
  return {mount};
})();
document.addEventListener('DOMContentLoaded',()=>ThemedSelect.mount());
