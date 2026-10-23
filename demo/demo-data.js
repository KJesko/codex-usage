/* Synthetic data only. This module never reads files, credentials or accounts. */
'use strict';
const DemoData = (() => {
  const DAY = 86400000;
  const numbers = ['input','uncached','cached','write','output','reasoning','total'];
  const costs = ['known_cost','input_cost','cached_cost','write_cost','output_cost','cache_savings'];
  const iso = value => new Date(value).toISOString();
  const offset = (day,n) => iso(Date.parse(day+'T12:00:00Z')+n*DAY).slice(0,10);
  const formatters = new Map();
  const dayIn = (value,zone) => {
    if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}));
    return formatters.get(zone).format(new Date(value));
  };
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&iso(Date.parse(value)).slice(0,10)===value;
  function wallClock(value,zone){
    const key='clock:'+zone;
    if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat('en-GB',{timeZone:zone,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
    const p=Object.fromEntries(formatters.get(key).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${iso(value).slice(20,23)}`;
  }
  // Resolve local calendar boundaries independently of the visitor's OS timezone.
  // At DST transitions use the first repeated time, or advance through a missing time.
  function instant(day,time,zone){
    const local=day+'T'+time,wanted=Date.parse(local+'Z');
    const offsets=[-DAY,0,DAY].map(shift=>Date.parse(wallClock(wanted+shift,zone)+'Z')-(wanted+shift));
    const candidates=[...new Set(offsets)].map(offset=>wanted-offset);
    const matches=candidates.filter(at=>wallClock(at,zone)===local);
    return matches.length?Math.min(...matches):Math.max(...candidates);
  }
  function create(catalog, now=Date.now()) {
    let seed=20261021;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const projects=[
      ['atlas-web','Atlas 商城','local','演示笔记本'],
      ['orbit-api','Orbit API','ssh:dev','演示开发机'],
      ['design-system','设计系统','local','演示笔记本'],
      ['research-notes','研究笔记','ssh:lab','演示实验机'],
      ['mobile-app','移动客户端','local','演示笔记本'],
      ['data-pipeline','数据流水线','ssh:lab','演示实验机']
    ];
    const models=['gpt-6.1-sol','gpt-6-sol','gpt-6-luna','gpt-5.3-codex'];
    const tasks=['实现搜索与筛选','修复边界条件','补充单元测试','优化缓存策略','整理接口文档','重构数据访问层','打磨响应式界面','分析性能瓶颈'];
    const events=[];
    // Use the same twelve calendar months as the default activity heatmap.
    // All cards, chart cells and exports are aggregated from these event records.
    const base=Date.parse(dayIn(now,'Asia/Shanghai')+'T00:00:00+08:00');
    const month=new Date(base+8*3600000);
    const first=Date.UTC(month.getUTCFullYear(),month.getUTCMonth()-11,1)-8*3600000;
    const scales=[1,.6,.08,.004,.025,.3],weights=[.50,.74,.81,.84,.89,1];
    for(let ago=Math.round((base-first)/DAY);ago>=0;ago--){
      const weekend=[0,6].includes(new Date(base-ago*DAY+8*3600000).getUTCDay());
      const vacation=(ago>=90&&ago<=103)||(ago>=220&&ago<=230);
      const showcase=ago<=6||ago===12;
      const active=showcase||(!vacation&&random()<(weekend?.09:.43));
      const count=active?1+Math.floor(random()*4):0;
      for(let s=0;s<count;s++){
        const pick=random(),index=s===0&&ago>=1&&ago<=6?ago-1:weights.findIndex(w=>pick<w);
        const p=projects[index];
        // Main implementation, service work and lightweight documentation use different mixes.
        const modelWeights=[[.62,.87,.90,1],[.35,.85,.90,1],[.30,.40,.90,1],
          [.15,.30,.95,1],[.25,.45,.95,1],[.65,.75,.80,1]][index];
        const modelPick=random(),model=models[modelWeights.findIndex(w=>modelPick<w)];
        const session=`demo-${dayIn(base-ago*DAY,'Asia/Shanghai')}-${s}`;
        const turns=5+Math.floor(random()*14),intensity=.35+random()*1.6;
        const start=base-ago*DAY+([9,11,14,16][s]+random()*.5)*3600000;
        for(let turn=0;turn<turns;turn++){
          const input=Math.round((150000+random()*400000)*scales[index]*intensity);
          const cached=Math.floor(input*(.92+random()*.065)),write=Math.floor(input*.005);
          const output=Math.max(120,Math.round((2500+random()*9000)*Math.sqrt(scales[index])));
          const at=start+turn*150000;
          if(at>now)continue;
          events.push({at:iso(at),session,title:tasks[(s+ago)%tasks.length]+' · '+p[1],
            project:p[0],project_name:p[1],project_path:'/demo/projects/'+p[0],source:p[2],source_name:p[3],
            account:ago%7===0?'demo-team':'demo-personal',
            model:ago===12&&s===0?'demo-experimental':s===1&&ago%3===0&&turn>=turns-2?'gpt-6-luna':model,
            input,uncached:input-cached-write,cached,write,output,reasoning:Math.floor(output*.28),total:input+output,
            context_input:input});
        }
      }
    }
    events.sort((a,b)=>a.at.localeCompare(b.at));
    const config={timezone:'Asia/Shanghai',sources:['/demo/codex'],usage_since:'',avatar_initials:'DM',prices:{},csrf:'demo-only',
      quota_alerts:{enabled:true,remaining_percent:20,predictive:true},
      remotes:[{id:'dev',name:'演示开发机',host:'dev.example.invalid',path:'/demo/codex',interval:120,enabled:true},
        {id:'lab',name:'演示实验机',host:'lab.example.invalid',path:'/demo/codex',interval:120,enabled:true}]};
    const remotes=()=>config.remotes.map(r=>({...r,busy:false,error:null,
      files:new Set(events.filter(e=>e.source==='ssh:'+r.id).map(e=>e.session)).size,synced_at:iso(now),root:r.path}));
    function priced(e){
      const rates={...catalog.models,...config.prices};
      const rate=config.prices[e.model]||rates[catalog.aliases?.[e.model]||e.model];
      if(!rate)return {...e,cost:null,input_cost:null,cached_cost:null,write_cost:null,output_cost:null,cache_savings:null};
      const long=rate.long_context&&e.context_input>rate.long_context,im=long?2:1,om=long?1.5:1;
      const parts={input_cost:e.uncached*rate.input*im/1e6,cached_cost:e.cached*rate.cached*im/1e6,
        write_cost:e.write*rate.write*im/1e6,output_cost:e.output*rate.output*om/1e6};
      return {...e,...parts,cost:Object.values(parts).reduce((a,b)=>a+b,0),cache_savings:e.cached*(rate.input-rate.cached)*im/1e6};
    }
    function sum(rows){
      const b=Object.fromEntries([...numbers,...costs].map(k=>[k,0]));
      b.events=rows.length;b.unpriced_events=0;b.unpriced_tokens=0;
      for(const e of rows){
        for(const k of numbers)b[k]+=e[k];
        if(e.cost==null){b.unpriced_events++;b.unpriced_tokens+=e.total;}
        else{b.known_cost+=e.cost;for(const k of costs.slice(1))b[k]+=e[k];}
      }
      return {...b,cost:b.unpriced_events?null:b.known_cost,cache_rate:b.input?b.cached/b.input:0,
        priced_ratio:b.total?1-b.unpriced_tokens/b.total:1,sessions:new Set(rows.map(e=>e.session)).size,projects:new Set(rows.map(e=>e.project)).size};
    }
    function grouped(rows,key,details){
      const groups=new Map();
      for(const e of rows){const k=key(e);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
      return [...groups].map(([k,values])=>({...sum(values),...details(k,values)}));
    }
    function report(query={}){
      const zone=query.timezone||config.timezone,today=dayIn(now,zone),grain=query.grain||'day';
      if(!['day','week','month'].includes(grain))throw new Error('无效的统计粒度');
      const end=query.until||today;
      if(!validDate(end)||(query.since&&!validDate(query.since)))throw new Error('日期格式无效');
      if(query.since&&query.since>end)throw new Error('开始日期不能晚于结束日期');
      const cutoff=config.usage_since?instant(config.usage_since,'00:00:00.000',config.timezone):null;
      const available=events.filter(e=>cutoff===null||Date.parse(e.at)>=cutoff);
      const start=[query.since||dayIn(available[0]?.at||now,zone),cutoff===null?'':dayIn(cutoff,zone)].sort().at(-1);
      if((Date.parse(end)-Date.parse(start))/DAY>3660)throw new Error('请缩短日期范围');
      const dimension=available.filter(e=>['project','model','session','account','source'].every(k=>!query[k]||e[k]===query[k])).map(priced);
      const rows=dimension.filter(e=>{const d=dayIn(e.at,zone);return d>=start&&d<=end;});
      const bucket=day=>grain==='month'?day.slice(0,7)+'-01':grain==='week'?offset(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7)):day;
      const days=new Map();for(let d=start;d<=end;d=offset(d,1))days.set(d,[]);
      for(const e of rows)days.get(dayIn(e.at,zone)).push(e);
      const timeline=new Map();for(const [day,es] of days){const k=bucket(day);if(!timeline.has(k))timeline.set(k,[]);timeline.get(k).push(...es);}
      const sort=rows=>rows.sort((a,b)=>b.total-a.total);
      const monday=offset(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
      const select=(since,until=today)=>sum(dimension.filter(e=>{const d=dayIn(e.at,zone);return since<=d&&d<=until;}));
      const comparisonEnd=end<today?end:today,partial=comparisonEnd===today;
      const span=query.period==='week'?7:Math.round((Date.parse(comparisonEnd)-Date.parse(start))/DAY)+1;
      const begin=instant(start,'00:00:00.000',zone);
      const stop=partial?now:instant(offset(comparisonEnd,1),'00:00:00.000',zone);
      const prevStart=offset(start,-span);
      const previousBegin=instant(prevStart,'00:00:00.000',zone);
      const previousStop=instant(offset(wallClock(stop,zone).slice(0,10),-span),wallClock(stop,zone).slice(11),zone);
      const canCompare=start<=comparisonEnd&&available.length>0&&prevStart>=dayIn(available[0].at,zone)&&(cutoff===null||previousBegin>=cutoff);
      const inWindow=(e,a,b)=>Date.parse(e.at)>=a&&Date.parse(e.at)<b;
      const prev=dimension.filter(e=>inWindow(e,previousBegin,previousStop));
      const current=dimension.filter(e=>inWindow(e,begin,stop));
      const attribution=(key,name)=>{
        const ids=new Set([...prev,...current].map(e=>e[key]));
        return [...ids].map(id=>{const a=prev.filter(e=>e[key]===id),b=current.filter(e=>e[key]===id),x=sum(a),y=sum(b),sample=b[0]||a[0];
          return {id,name:sample[name],source_name:key==='project'?sample.source_name:'',previous_total:x.total,current_total:y.total,
            previous_cost:x.known_cost,current_cost:y.known_cost,delta_total:y.total-x.total,delta_cost:y.known_cost-x.known_cost};});
      };
      const comparison=start>comparisonEnd?{available:false,reason:'当前范围尚未开始，没有可比较的用量。'}:{
        available:canCompare,reason:canCompare?null:'模拟数据未覆盖完整上期，请选择较近的日期。',current:sum(current),previous:canCompare?sum(prev):null,
        current_range:{since:iso(begin),until:iso(stop)},previous_range:{since:iso(previousBegin),until:iso(previousStop)},
        basis:query.period==='week'?'上周同期':'上一等长时段',partial_day:partial,
        projects:canCompare?attribution('project','project_name'):[],models:canCompare?attribution('model','model'):[]};
      return {summary:sum(rows),today:select(today),week:select(monday),month:select(today.slice(0,7)+'-01'),
        timeline:[...timeline].map(([date,es])=>({date,...sum(es)})),
        model_timeline:[...days].map(([date,es])=>({date,models:grouped(es,e=>e.model,name=>({name}))})),
        projects:sort(grouped(rows,e=>e.project,(id,es)=>({id,name:es[0].project_name,path:es[0].project_path,source:es[0].source,source_name:es[0].source_name}))),
        sessions:sort(grouped(rows,e=>e.session,(id,es)=>({id,title:es[0].title,first_at:es[0].at,last_at:es.at(-1).at,
          model_names:[...new Set(es.map(e=>e.model))],project_names:[...new Set(es.map(e=>e.project_name))],source_names:[...new Set(es.map(e=>e.source_name))]}))),
        models:sort(grouped(rows,e=>e.model,name=>({name}))),
        options:{projects:projects.map(([id,name,source])=>({id,name,source,path:'/demo/projects/'+id})),models:[...new Set(available.map(e=>e.model))].sort(),
          accounts:[...new Set(available.map(e=>e.account))].sort(),sources:[{id:'local',name:'演示笔记本'},...config.remotes.map(r=>({id:'ssh:'+r.id,name:r.name}))]},
        comparison,
        coverage:{sessions:new Set(events.map(e=>e.session)).size,metadata_sessions:new Set(events.map(e=>e.session)).size,files:new Set(events.map(e=>e.session)).size,
          missing_sessions:0,retained_files:0,scan_ms:0,warnings:{},issues:[]},limits:[],missing_projects:[],scanned_at:iso(now),timezone:zone,
        usage_start:config.usage_since?{date:config.usage_since,timezone:config.timezone,at:iso(cutoff)}:null,range:{since:start,until:end,today,grain},
        pricing:{...catalog,models:{...catalog.models,...config.prices},overrides:Object.keys(config.prices),unknown_models:[...new Set(rows.filter(e=>e.cost==null).map(e=>e.model))]},
        remotes:remotes(),collector:{running:false,last_scan:iso(now),scan_interval_seconds:30}};
    }
    const quotaNow=now/1000,anchor=base/1000,day=DAY/1000;
    const begin=anchor-13*day,end=anchor+day,scheduled=begin+7*day,deadline=scheduled+7*day;
    const resetEvents=[['scheduled',scheduled],['official',anchor-4*day],['credit',anchor-2*day]].map(([kind,at],i)=>({
      id:'demo-reset-'+i,kind,label:'每周额度',at,since:at-60,confirmed_at:at,
      before_used:0,after_used:0,old_reset:i===0?at:deadline,new_reset:deadline,
      ...(kind==='credit'?{before_count:3,after_count:2}:{})}));
    const boundaries=[begin,...resetEvents.map(e=>e.at),end],samples=[],references=[];
    // Work in bursts, sleep from 23:00 to 09:00, and take a lunch break.
    // Daily weights deliberately show both slower and faster use than the reference.
    const dailyWeights=[[.2,1.7,.4,2.4,.3,1,0],[.05,1],[1,.15],[.2,1,.4]];
    const missing=[{since:anchor-5*day+10*3600,until:anchor-5*day+17*3600},
      {since:anchor-day+14*3600,until:anchor-day+20*3600}];
    for(let part=0;part<boundaries.length-1;part++){
      const since=boundaries[part],until=boundaries[part+1],target=[100,68,82,46][part];
      const steps=[];
      for(let at=since;at<until;at+=1800){
        const hour=((at+8*3600)%day)/3600,d=Math.floor((at-since)/day);
        const work=hour>=9&&hour<12?1:hour>=14&&hour<18?2.2:hour>=20&&hour<22?.35:0;
        const burst=1+Math.sin((at-since)/1800*1.7)*.65;
        steps.push({at,weight:work*burst*(dailyWeights[part][d]||0)});
      }
      const totalWeight=steps.reduce((s,p)=>s+p.weight,0);let consumed=0,lastAt=null;
      for(const step of steps){
        if(step.at>quotaNow)break;
        if(!missing.some(g=>step.at>g.since&&step.at<g.until)){
          samples.push({at:step.at,used_percent:Math.round(target*consumed/totalWeight),
            break_before:lastAt===null||step.at-lastAt>1800});lastAt=step.at;
        }
        consumed+=step.weight;
      }
      const last=Math.min(until-1,quotaNow);
      // Preserve the exact pre-reset endpoint and latest card observation.
      if(last>samples.at(-1).at&&!missing.some(g=>last>g.since&&last<g.until)){
        const fraction=last===quotaNow?(last-steps.findLast(s=>s.at<=last).at)/1800:1;
        const current=steps.findLast(s=>s.at<=last);
        const used=consumed-current.weight*(1-fraction);
        samples.push({at:last,used_percent:Math.round(target*used/totalWeight),break_before:last-lastAt>1800});
      }
      if(part<resetEvents.length)resetEvents[part].before_used=samples.at(-1).used_percent;
      // Reference derives from the reset deadline, never from actual consumption.
      const cycleEnd=part===0?scheduled:deadline;
      references.push({since,until:Math.min(until,cycleEnd),before:0,
        after:100*(Math.min(until,cycleEnd)-since)/(cycleEnd-since),cycle_end:cycleEnd});
    }
    const acknowledged=new Set();
    function quota(){return {account:{label:'演示账号 · 非真实数据',plan:'pro'},windows:[
      {id:'codex:primary',bucket:'codex',label:'每周额度',used_percent:samples.at(-1).used_percent,
        remaining_percent:100-samples.at(-1).used_percent,resets_at:deadline,window_minutes:10080},
      {id:'codex:secondary',bucket:'codex',label:'5 小时额度',used_percent:28,remaining_percent:72,resets_at:quotaNow+7200,window_minutes:300}],
      reset_credits:{available_count:2,details:[{expires_at:quotaNow+15*86400},{expires_at:quotaNow+28*86400}]},reset_events:resetEvents,
      fetched_at:iso(now),busy:false,stale:false,history_scope:'demo-account:'+config.timezone,history_available:true,
      collector:{running:false,interval_seconds:60,failures:0,last_success:iso(now)},alerts:[{id:'demo-alert',at:resetEvents.at(-1).at-3600,active:false,
        acknowledged:acknowledged.has('demo-alert'),message:'模拟历史提醒：上一使用段剩余额度低于 20%。'}]};}
    function quotaRange(){
      const ticks=[],firstDay=dayIn(begin*1000,config.timezone),lastDay=offset(dayIn(now,config.timezone),1);
      for(let date=firstDay;date<=lastDay;date=offset(date,1))ticks.push({at:instant(date,'00:00:00.000',config.timezone)/1000,date});
      return {custom_range:true,history_scope:'demo-account:'+config.timezone,timezone:config.timezone,grain:'auto',
        range:{since:ticks[0].at,until:ticks.at(-1).at,since_date:ticks[0].date,until_date:ticks.at(-2).date},ticks,
        groups:[{id:'demo-week',label:'每周额度（模拟）',plan:'pro',window:'codex:primary',sample_count:samples.length,segment_count:4,
          samples,references,idle:[],events:resetEvents}]};
    }
    function settings(next){
      if(next){
        new Intl.DateTimeFormat('en',{timeZone:next.timezone});
        if(next.usage_since&&!validDate(next.usage_since))throw new Error('日期格式无效');
        for(const p of Object.values(next.prices||{})){
          for(const k of ['input','cached','write','output'])if(!Number.isFinite(p[k])||p[k]<0)throw new Error('价格必须为非负数');
          if(p.long_context!=null&&(!Number.isFinite(p.long_context)||p.long_context<=0))throw new Error('长上下文阈值必须为正数');
        }
        for(const k of ['timezone','timezone_mode','usage_since','avatar_initials','prices','quota_alerts'])if(k in next)config[k]=structuredClone(next[k]);
      }
      return structuredClone(config);
    }
    function csv(query={}){
      const r=report(query),dimension=query.dimension||'timeline';
      if(!['timeline','projects','sessions','models'].includes(dimension))throw new Error('无效的导出维度');
      let rows=r[dimension];
      if(dimension==='sessions'){
        if(query.sort&&!['total','known_cost','last_at'].includes(query.sort))throw new Error('无效的会话排序');
        const search=(query.search||'').toLowerCase();rows=rows.filter(s=>[s.title,s.id,...s.model_names,...s.project_names].some(v=>v.toLowerCase().includes(search)));
        rows.sort((a,b)=>query.sort==='last_at'?b.last_at.localeCompare(a.last_at):(b[query.sort||'total']||0)-(a[query.sort||'total']||0));
      }
      const identity={timeline:['date'],projects:['name','id','path','source','source_name'],
        sessions:['title','id','first_at','last_at','model_names','project_names','source_names'],models:['name']}[dimension];
      const keys=[...identity,...numbers,'cost',...costs,'cache_rate','priced_ratio','unpriced_tokens','unpriced_events','sessions','events'];
      const meta=['timezone','range_since','range_until','grain','price_basis','price_verified_at','usage_start'];
      const cell=v=>{let s=Array.isArray(v)?v.join(' / '):String(v??'');if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
      const values=[r.timezone,r.range.since,r.range.until,r.range.grain,'current_standard_api_equivalent',r.pricing.verified_at,r.usage_start?.at||''];
      return '\ufeff'+[['data_type',...keys,...meta],...rows.map(row=>['SIMULATED',...keys.map(k=>row[k]),...values])].map(row=>row.map(cell).join(',')).join('\r\n');
    }
    return {events,report,settings,quota,quotaRange,remotes,csv,acknowledge:id=>{acknowledged.add(id);return quota();}};
  }
  return {create};
})();
if(typeof module!=='undefined')module.exports=DemoData;
