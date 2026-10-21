'use strict';

// Keep quota controls, disclosures and chart hosts mounted during background polls.
const QuotaDOM=(()=>{
  const cache=new WeakMap();
  const managed=node=>node.nodeType!==1 || !node.matches('.help-trigger, #hintHelpPopover');
  const key=node=>node.nodeType===1?(node.id || ['data-range-group','data-range-chart','data-event-id'].map(a=>node.getAttribute(a)||'').join('|')):'';
  function compatible(a,b){
    return a.nodeType===b.nodeType && (a.nodeType!==1 || (a.tagName===b.tagName && key(a)===key(b) &&
      (a.getAttribute('class')||'').split(' ').filter(c=>c && c!=='help-source')[0]===(b.getAttribute('class')||'').split(' ').filter(c=>c && c!=='help-source')[0]));
  }
  function children(parent,next,preserve){
    const old=[...parent.childNodes].filter(managed),fresh=[...next.childNodes].filter(managed);
    let cursor=0;
    for(const desired of fresh){
      let current=old[cursor];
      if(!current || !compatible(current,desired)){
        const index=old.findIndex((node,i)=>i>cursor && compatible(node,desired));
        if(index>=0){const [found]=old.splice(index,1);parent.insertBefore(found,current);old.splice(cursor,0,found);current=found;}
        else {current=desired.cloneNode(true);parent.insertBefore(current,old[cursor]||null);old.splice(cursor,0,current);}
      }
      if(current.nodeType===3){if(current.nodeValue!==desired.nodeValue)current.nodeValue=desired.nodeValue;}
      else if(current.nodeType===1 && !preserve?.(current,desired)){
        const keepHelp=current.classList.contains('help-source');
        for(const attribute of [...current.attributes]){
          if(attribute.name==='open' && current.tagName==='DETAILS')continue;
          if(!desired.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
        }
        for(const attribute of [...desired.attributes]){
          const value=attribute.name==='class' && keepHelp?attribute.value+' help-source':attribute.value;
          if(current.getAttribute(attribute.name)!==value)current.setAttribute(attribute.name,value);
        }
        if(keepHelp)current.classList.add('help-source');
        children(current,desired,preserve);
        if(current.tagName==='SELECT' && current.value!==desired.value)current.value=desired.value;
        if(current.tagName==='INPUT' && current.value!==desired.value)current.value=desired.value;
      }
      cursor++;
    }
    old.slice(cursor).forEach(node=>node.remove());
  }
  function patch(host,html,preserve){
    if(!host || cache.get(host)===html)return false;
    const template=document.createElement('template');template.innerHTML=html;
    children(host,template.content,preserve);cache.set(host,html);return true;
  }
  return {patch};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=QuotaDOM;
