// Run in the local app's browser via its development console/CDP. Uses detached DOM only.
(()=>{
  const checks=[];
  const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
  const root=document.createElement('div');
  const render=(value,extra='')=>`<section class="panel"><h2>Title</h2><details class="status"><summary>Status</summary><p>${value}</p></details><input id="date" value="${value}"><div class="chart" data-range-chart="g"><svg></svg></div><p data-help>Help ${value}</p>${extra}</section>`;
  const preserve=el=>el.matches('[data-range-chart]');
  QuotaDOM.patch(root,render('first'),preserve);
  const section=root.firstElementChild,chart=root.querySelector('.chart'),svg=chart.firstElementChild;
  const details=root.querySelector('details'),input=root.querySelector('input'),help=root.querySelector('[data-help]');
  const button=document.createElement('button');button.className='help-trigger';section.querySelector('h2').append(button);
  details.open=true;help.classList.add('help-source');chart.dataset.zoom='2';
  check(QuotaDOM.patch(root,render('first'),preserve)===false,'identical data performs no patch');
  QuotaDOM.patch(root,render('second','<p class="warning">New warning</p>'),preserve);
  check(root.firstElementChild===section,'panel node remains mounted');
  check(root.querySelector('input')===input && input.value==='second','input stays mounted and receives new value');
  check(root.querySelector('details')===details && details.open,'open disclosure remains open');
  check(root.querySelector('.chart')===chart && chart.firstElementChild===svg && chart.dataset.zoom==='2','interactive chart state and SVG are retained');
  check(root.querySelector('.help-trigger')===button && help.classList.contains('help-source'),'generated help controls and hidden copy are preserved');
  QuotaDOM.patch(root,render('third'),preserve);
  check(!root.querySelector('.warning') && details.textContent.includes('third'),'removed warnings disappear while data updates');
  QuotaDOM.patch(root,'<section class="panel"><div data-event-id="a">A</div><div data-event-id="b">B</div></section>');
  const a=root.querySelector('[data-event-id="a"]'),b=root.querySelector('[data-event-id="b"]');
  QuotaDOM.patch(root,'<section class="panel"><div data-event-id="b">B2</div><div data-event-id="a">A2</div></section>');
  check(root.firstElementChild.children[0]===b && root.firstElementChild.children[1]===a,'keyed events reorder without replacing existing nodes');
  QuotaDOM.patch(root,'<select><option value="one" selected>One</option><option value="two">Two</option></select>');
  const select=root.firstElementChild;
  QuotaDOM.patch(root,'<select><option value="one">One</option><option value="two" selected>Two</option></select>');
  check(root.firstElementChild===select && select.value==='two','select state updates in place');
  return {passed:checks.length,checks};
})()
