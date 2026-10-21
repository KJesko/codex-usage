'use strict';

const CompactTables=(()=>{
  const expanded=new Set();
  function columns(labels) {
    const total=labels.findIndex(s=>/总\s*Tokens|^Tokens$|总 Token/.test(s));
    const cost=labels.findIndex(s=>/API 等价/.test(s));
    if(total>=0 && cost>=0)return [0,total,cost];
    if(labels.includes('未缓存输入') && labels.includes('输出'))return [0,labels.indexOf('未缓存输入'),labels.indexOf('输出')];
    if(cost>=0)return [0,1,cost];
    return [0,1,2];
  }
  function mount(root) {
    for(const wrap of root.querySelectorAll('.table-scroll')){
      const table=wrap.querySelector('table.data-table');if(!table||table.classList.contains('summary-table'))continue;
      const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      if(headers.length<4)continue;
      const key=table.closest('section')?.querySelector('h2,h3')?.textContent||'会话';
      const chosen=columns(headers),other=headers.map((_,i)=>i).filter(i=>!chosen.includes(i));
      const panel=document.createElement('div');panel.className='compact-table';
      panel.setAttribute('role','list');panel.setAttribute('aria-label',key+'紧凑列表');
      for(const row of table.querySelectorAll('tbody tr')){
        const cells=[...row.children];
        const card=document.createElement('div');card.className='compact-row';card.setAttribute('role','listitem');
        if(cells.length!==headers.length){card.textContent=row.textContent;panel.append(card);continue;}
        const rowKey=key+'|'+(row.dataset.session||row.dataset.projectDetail||cells[0].textContent);
        const primary=document.createElement('div');primary.className='compact-primary';primary.innerHTML=cells[0].innerHTML;
        card.append(primary);
        for(const i of chosen.slice(1)){
          const metric=document.createElement('div');metric.className='compact-metric'+(cells[i].classList.contains('cost')?' cost':'');
          const label=document.createElement('span');label.textContent=headers[i];
          const value=document.createElement('strong');value.innerHTML=cells[i].innerHTML;
          metric.append(label,value);card.append(metric);
        }
        const details=document.createElement('details');details.className='compact-details';details.open=expanded.has(rowKey);
        const summary=document.createElement('summary');summary.textContent='更多信息';details.append(summary);
        const list=document.createElement('dl');
        for(const i of other){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=headers[i];dd.innerHTML=cells[i].innerHTML;list.append(dt,dd);}
        details.append(list);details.addEventListener('toggle',()=>{if(details.open)expanded.add(rowKey);else expanded.delete(rowKey);});
        card.append(details);panel.append(card);
      }
      wrap.querySelector(':scope > .compact-table')?.remove();wrap.classList.add('adaptive-table');wrap.append(panel);
    }
  }
  return {mount,columns};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CompactTables;
