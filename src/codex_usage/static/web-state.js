'use strict';

// Web-only state helpers. No DOM or network work, so races can be tested with a fake clock.
const WebState=(()=>{
  function validateField(id,value,systemZone){
    if(id==='sourcePaths'){
      const paths=String(value).split('\n').map(s=>s.trim()).filter(Boolean);
      if(!paths.length)return {error:'请填写至少一个日志目录。'};
      if(paths.length>20)return {error:'最多可设置 20 个日志目录。'};
      if(paths.some(path=>!(/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(path))))return {error:'请填写绝对路径，例如 C:\\Users\\you\\.codex 或 /home/you/.codex。'};
      return {patch:{sources:[...new Set(paths)]}};
    }
    if(id==='settingsAvatar'){
      const avatar=String(value).trim();
      if(!/^[A-Za-z0-9\u3400-\u9fff]{1,3}$/.test(avatar))return {error:'请填写 1 至 3 个英文字母、数字或汉字。'};
      return {patch:{avatar_initials:avatar.toUpperCase()}};
    }
    if(id==='settingsUsageSince'){
      if(value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))return {error:'请填写有效的起始日期，或留空统计全部历史。'};
      return {patch:{usage_since:value}};
    }
    if(id==='settingsTimezone'){
      const zone=value==='system'?systemZone:value;
      try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();if(!zone)throw new Error();}
      catch(_){return {error:'无法识别时区，请重新选择。'};}
      return {patch:{timezone_mode:value==='system'?'system':'manual',timezone:zone}};
    }
    return {error:'不支持的设置项。'};
  }
  function createAutosave({persist,changed=()=>{},validate=validateField,systemZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone,schedule=setTimeout,cancel=clearTimeout,delay=700}){
    const fields=new Map();let timer=null,inFlight=null,revision=0,disposed=false;
    const emit=()=>{if(!disposed)changed(snapshot());};
    const snapshot=()=>Object.fromEntries([...fields].map(([id,row])=>[id,{...row}]));
    function edit(id,value){
      const result=validate(id,value,systemZone());
      fields.set(id,{value,revision:++revision,status:result.error?'invalid':'pending',error:result.error||'',patch:result.patch});
      cancel(timer);timer=schedule(()=>{timer=null;flush();},delay);emit();
    }
    async function run(){
      while(!disposed){
        const batch=[...fields].filter(([,row])=>row.status==='pending');
        if(!batch.length)break;
        const patch=Object.assign({},...batch.map(([,row])=>row.patch));
        for(const [,row] of batch)row.status='saving';emit();
        try{
          await persist(patch);
          for(const [id,row] of batch)if(fields.get(id)?.revision===row.revision)fields.set(id,{...row,status:'saved',error:''});
        }catch(error){
          for(const [id,row] of batch)if(fields.get(id)?.revision===row.revision)fields.set(id,{...row,status:'error',error:error.message||'保存失败，请重试。'});
        }
        emit();
      }
    }
    function flush(){
      cancel(timer);timer=null;
      if(inFlight)return inFlight;
      inFlight=run().finally(()=>{inFlight=null;});return inFlight;
    }
    function retry(id){const row=fields.get(id);if(row?.status==='error'){row.status='pending';row.error='';emit();return flush();}}
    function discard(id){fields.delete(id);emit();}
    const drafts=()=>Object.fromEntries([...fields].filter(([,row])=>row.status!=='saved').map(([id,row])=>[id,row.value]));
    return {edit,flush,retry,discard,snapshot,drafts,hasUnsaved:()=>Object.keys(drafts()).length>0,dispose(){disposed=true;cancel(timer);}};
  }
  const timestamp=value=>{if(value==null||value==='')return null;const ms=typeof value==='number'?value*1000:Date.parse(value);return Number.isFinite(ms)?ms:null;};
  function sourceState({at,interval=60,busy=false,error='',paused=false,missing=false},now=Date.now()){
    const last=timestamp(at),stale=last!==null && now-last>Math.max(90,interval*3)*1000;
    const state=paused?'paused':error?'error':busy?'busy':stale?'stale':last===null?'waiting':missing?'partial':'ready';
    return {state,last,error,retained:last!==null&&['error','stale','paused','busy'].includes(state),label:{paused:'已暂停',error:'更新失败',busy:'正在更新',stale:'更新延迟',waiting:'等待首次更新',partial:'部分待补充',ready:'已更新'}[state]};
  }
  function dataRows(snapshot={},account={},options={}){
    const now=options.now??Date.now(),local=snapshot.local||{},prices=snapshot.prices||{},remote=snapshot.remotes||[];
    const rows=[{id:'local',name:'本地日志',...sourceState({at:local.last_scan,interval:local.scan_interval_seconds||30,error:local.problem,paused:local.running===false},now),action:'local',guidance:'检查日志目录、访问权限和磁盘空间。'}];
    for(const r of remote)rows.push({id:'remote:'+r.id,name:r.name||r.host,...sourceState({at:r.synced_at,interval:r.interval||120,error:r.error,busy:r.busy,paused:!r.enabled},now),action:'remote',guidance:'检查 SSH 连接、服务器状态和远程日志目录。'});
    if(!remote.length)rows.push({id:'remote',name:'远程服务器',state:'idle',label:'未配置',last:null,action:'remote-settings'});
    const signedOut=account.signed_out||account.problem?.kind==='signed_out';
    rows.push({id:'account',name:'账号额度',...sourceState({at:account.fetched_at,interval:account.collector?.interval_seconds||60,busy:account.busy,error:account.transportError||account.problem?.message},now),...(signedOut?{state:'idle',label:'未登录',last:null,retained:false,error:''}:account.stale&&!account.busy&&!account.problem&&!account.transportError?{state:'stale',label:'更新延迟',retained:Boolean(account.fetched_at)}:{}),action:signedOut?'login':'account',guidance:'检查账号连接；登录失效时重新登录。'});
    const priceMissing=Boolean(prices.missing?.length||prices.unresolved?.length);
    rows.push({id:'prices',name:'模型价格',...sourceState({at:prices.last_success,interval:prices.interval_seconds||86400,busy:prices.busy,error:prices.error,missing:priceMissing},now),...(!prices.last_success&&prices.last_check&&!prices.error&&!prices.busy?{state:priceMissing?'partial':'ready',label:priceMissing?'部分待补充':'内置单价'}:{}),action:'prices',guidance:'待定价模型可能尚未公布官方价格，可在价格页面查询或填写单价。',fallback:!prices.last_success?'使用内置或自定义单价':'',checked:timestamp(prices.last_check)});
    return rows;
  }
  return {validateField,createAutosave,sourceState,dataRows,timestamp};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=WebState;
