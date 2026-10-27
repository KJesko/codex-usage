'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({Intl,Date});
vm.runInContext(fs.readFileSync('src/codex_usage/desktop_assets/companion.js','utf8'),context);
const view=context.CompanionView;
test('companion quota values are bounded and missing data never reads as full quota',()=>{
  assert.equal(view.percent(-20),0);assert.equal(view.percent(150),100);assert.equal(view.percent(null),null);
  const html=view.quotaMarkup({windows:[{label:'Weekly',remaining_percent:null},{label:'<script>',remaining_percent:150,resets_at:1793200000}]},true);
  assert.match(html,/aria-valuetext="未知"/);assert.match(html,/width:100%/);assert.match(html,/上次记录/);
  assert.doesNotMatch(html,/<script>|NaN/);
});
test('companion message content is escaped and long histories have bounded rendered items',()=>{
  const html=view.messageMarkup(Array.from({length:1000},()=>({message:'<img onerror="oops">',id:'" onclick="bad',at:1793200000})));
  assert.equal((html.match(/<article/g)||[]).length,50);assert.doesNotMatch(html,/<img|data-value=""/);
});
