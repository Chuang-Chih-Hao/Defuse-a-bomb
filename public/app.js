'use strict';
// The browser only edits structured blocks. All authoritative checks run on the server.
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const COLORS=['BLUE','RED','GREEN','YELLOW'];
const STEPS=['VERIFY','SWEEP','SEAL','REPORT'];
const COLOR_LABEL={BLUE:'🔵 藍色',RED:'🔴 紅色',GREEN:'🟢 綠色',YELLOW:'🟡 黃色'};
const STEP_LABEL={VERIFY:'驗證晶片',SWEEP:'清除暫存',SEAL:'封存核心',REPORT:'傳送報告'};
const STAGE_HELP={
  sequence:'閱讀分析員提供的安全訊號順序，依序排列「activate」卡片。<br>一行程式代表一步；錯誤順序會讓虛擬核心失去穩定度。',
  condition:'調整 if 條件中的顏色、比較值與 AND / OR。<br>分析員可以看到測試結果與正確規則；操作員只能編輯，必須合作完成。',
  loop:'調整 for 迴圈的開始值、結束值及每次增加的數量。<br>思考哪些 i 會符合 i &lt; limit，讓模組恰好執行指定次數。',
  debug:'系統核心同時存在順序、if 判斷與 for 迴圈三類 Bug。<br>分析員負責檢查規格，操作員修改三處錯誤，再觀察追蹤結果。',
  variables:'先向分析員詢問來源 A／B、乘數、整除數與取餘數，再設定 C。',
  array:'選擇兩個晶片的位置交換。Scratch 從 1 算起，Python 索引從 0 算起。',
  function:'把四步冷卻指令排好，主程式只放一個 cool_down() 呼叫。',
  lab:'設計者自訂數位邏輯規則，另一人負責破解。<br>內建三種任務：自訂執行順序、改造布林條件、設計迴圈陷阱。'
};
const DEFUSE_UI_VERSION='1.4.0';
const socket=io({reconnection:true,reconnectionDelay:500,reconnectionDelayMax:4000});
let saved=null;
try{saved=JSON.parse(localStorage.getItem('defuse-identity')||'null');}catch{}
let snapshot=null;
let self=null;
let soundOn=localStorage.getItem('defuse-sound')!=='off';
let clock={ms:0,at:Date.now(),running:false};
let lastSerial=-1;
let animatingSerial=-1;
let toastTimer;
let audioContext=null;
let preset=0;
const labDrafts={
  sequence:{kind:'sequence',target:['BLUE','RED','GREEN']},
  condition:{kind:'condition',color:'RED',threshold:60,mode:'AND'},
  loop:{kind:'loop',target:7}
};
let dragged=null;
let lastAssignment=null;
const htmlOptions=(items,selected,labels={})=>items.map(x=>'<option value="'+escapeHtml(x)+'" '+(x===selected?'selected':'')+'>'+escapeHtml(labels[x]||x)+'</option>').join('');

function toast(message,error=false){
  const target=$('toast');
  target.textContent=message;target.className='toast show'+(error?' error':'');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>target.className='toast',3400);
}
function beep(type='click'){
  if(!soundOn)return;
  try{
    audioContext=audioContext||new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended') audioContext.resume();
    const now=audioContext.currentTime;
    const notes=type==='success'?[523,659,784,1046]:type==='error'?[280,180]:[640];
    notes.forEach((pitch,i)=>{
      const osc=audioContext.createOscillator(),gain=audioContext.createGain();
      const start=now+i*.12;
      osc.type='sine';osc.frequency.setValueAtTime(pitch,start);
      gain.gain.setValueAtTime(.0001,start);
      gain.gain.exponentialRampToValueAtTime(type==='click'?.025:.065,start+.02);
      gain.gain.exponentialRampToValueAtTime(.0001,start+.11);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(start);osc.stop(start+.12);
    });
  }catch{}
}
function saveIdentity(identity){
  saved=identity;
  localStorage.setItem('defuse-identity',JSON.stringify(identity));
  self=identity;
}
function send(event,detail={},quiet=false){
  return new Promise(resolve=>{
    if(!socket.connected){if(!quiet)toast('尚未連線，正在嘗試重新連接',true);resolve({ok:false});return;}
    socket.timeout(8000).emit(event,detail,(err,response)=>{
      if(err){if(!quiet)toast('伺服器回應逾時，請再試一次',true);resolve({ok:false});return;}
      if(!response?.ok){if(!quiet){toast(response?.error||'操作無法完成',true);beep('error');}}
      else if(!quiet)beep();
      resolve(response||{ok:false});
    });
  });
}
function updateConnection(){
  $('createBtn').disabled=!socket.connected;
  $('joinBtn').disabled=!socket.connected;
  $('network').classList.toggle('online',socket.connected);
  $('network').innerHTML='<i></i> '+(socket.connected?'已連線':'連線中斷');
}
socket.on('connect',async()=>{
  updateConnection();
  if(saved?.code&&saved?.token){
    const r=await send('room:join',{code:saved.code,token:saved.token},true);
    if(r.ok){self={...saved,role:r.role,slot:r.slot};saveIdentity(self);$('lobbyScreen').hidden=true;$('gameScreen').hidden=false;$('leaveBtn').hidden=false;await send('room:join',{code:saved.code,token:saved.token},true);}
    else {localStorage.removeItem('defuse-identity');saved=null;self=null;$('gameScreen').hidden=true;$('lobbyScreen').hidden=false;toast('原有房間已失效，可重新建立或加入',true);}
  }
});
socket.on('disconnect',()=>{updateConnection();toast('網路斷線：已啟用自動重新連線',true);});
socket.on('connect_error',()=>updateConnection());
socket.on('room:snapshot',data=>{
  if(!self){ // create/join acknowledgement may arrive after first snapshot
    return;
  }
  const assignment=[data.mode,data.stageIndex,data.labRounds,data.role].join(':');
  if(lastAssignment && assignment!==lastAssignment && self.role==='student'){
    toast('🔄 角色已交換！你現在是'+(data.role==='analyst'?'程式分析員：先讀任務卡並向隊友說明。':'拆彈操作員：依隊友說明修改積木。'));
    beep('success');
  }
  lastAssignment=assignment;
  snapshot=data;
  clock={ms:data.remainingMs,at:Date.now(),running:data.status==='active'};
  $('lobbyScreen').hidden=true;
  $('gameScreen').hidden=false;
  $('leaveBtn').hidden=false;
  render();
});
socket.on('clock:tick',data=>{
  if(snapshot?.status==='active')clock={ms:data.remainingMs,at:Date.now(),running:true};
});
function updateClock(){
  if(!snapshot)return;
  const n=Math.max(0,clock.ms-(clock.running?Date.now()-clock.at:0));
  $('timer').textContent=String(Math.floor(n/60000)).padStart(2,'0')+':'+String(Math.floor((n%60000)/1000)).padStart(2,'0');
  $('timer').classList.toggle('danger',n<60000&&snapshot.status==='active');
}
setInterval(updateClock,180);
function you(){return self?.role==='student' ? snapshot?.members.find(x=>x.slot===self.slot):null;}
function roleName(x){return x==='analyst'?'程式分析員':x==='operator'?'拆彈操作員':x==='teacher'?'教師監控':'情報支援員';}
function canEdit(){return snapshot?.role==='operator'&&snapshot?.status==='active';}
function canAnalyze(){return snapshot?.role==='analyst'&&snapshot?.status==='active';}
function canMessage(){return ['analyst','observer'].includes(snapshot?.role)&&snapshot?.status==='active';}
function teamActors(){
  return [...(snapshot?.members||[]),...(snapshot?.teacherActor?[snapshot.teacherActor]:[])];
}
function colorCard(v,i,kind){
  const name=kind==='sequence' ? (COLOR_LABEL[v]||v) : (STEP_LABEL[v]||v);
  const length=kind==='debug'?snapshot.puzzle.blocks.order.length:snapshot.puzzle.blocks.length;
  return '<div class="block scratch-command" draggable="'+(canEdit()?'true':'false')+'" data-row="'+i+'" role="listitem">'+
    '<div class="block-header"><div class="block-left"><span class="block-dot"></span><div><b>'+String(i+1).padStart(2,'0')+'　啟動 '+escapeHtml(name)+'</b></div></div>'+
    '<div class="block-tools"><button type="button" data-move="'+i+':-1" '+(!canEdit()||i===0?'disabled':'')+' aria-label="上移一個方塊">↑</button>'+
    '<button type="button" data-move="'+i+':1" '+(!canEdit()||i===length-1?'disabled':'')+' aria-label="下移一個方塊">↓</button></div></div></div>';
}
function choice(field,values,selected,labels={}){
  return '<select aria-label="'+escapeHtml(field)+'" data-field="'+escapeHtml(field)+'" '+(!canEdit()?'disabled':'')+'>'+htmlOptions(values,selected,labels)+'</select>';
}
function integer(field,selected,min,max){
  return '<input type="number" inputmode="numeric" aria-label="'+escapeHtml(field)+'" data-field="'+escapeHtml(field)+'" value="'+escapeHtml(selected)+'" min="'+min+'" max="'+max+'" step="1" '+(!canEdit()?'disabled':'')+'>';
}
function sequenceEditor(blocks,kind){
  return '<div class="scratch-note">積木由上往下執行；按 ↑ ↓ 或拖曳積木調整順序。真正的目標由分析員提供。</div>'+
    '<div class="scratch-hat">🚩 當按下「執行程式」</div>'+
    '<div id="orderList" class="scratch-stack" role="list">'+blocks.map((v,i)=>colorCard(v,i,kind)).join('')+'</div>';
}
function conditionEditor(blocks,standalone=true){
  return '<div class="scratch-c purple"><div class="scratch-c-head">⬡ 如果 IF</div>'+
    '<div class="scratch-c-controls">顏色是 '+choice('color',COLORS,blocks.color,COLOR_LABEL)+
    choice('mode',['AND','OR'],blocks.mode,{AND:'且 AND',OR:'或 OR'})+' 能源 &gt; '+
    integer('threshold',blocks.threshold,0,100)+'</div>'+
    (blocks.useSecond?'<div class="scratch-c-controls">或（OR）顏色是 '+choice('secondColor',COLORS,blocks.secondColor,COLOR_LABEL)+
      ' 且能源 &gt; '+integer('secondThreshold',blocks.secondThreshold,0,100)+'</div>':'')+
    '<div class="scratch-c-body"><span class="scratch-inner green">✓ 那麼 → 解鎖數位模組</span></div>'+
    (standalone?'<div class="scratch-c-else">否則 ELSE<div class="scratch-c-body"><span class="scratch-inner">保持鎖定</span></div></div>':'')+
    '<div class="scratch-c-footer"></div></div>';
}
function loopEditor(blocks){
  return '<div class="scratch-c orange"><div class="scratch-c-head">↺ 重複執行 FOR</div>'+
    '<div class="scratch-c-controls">從 i = '+integer('start',blocks.start,0,11)+' 開始</div>'+
    '<div class="scratch-c-controls">當 i &lt; '+integer('limit',blocks.limit,1,12)+' 持續重複</div>'+
    '<div class="scratch-c-controls">每次 i 增加 '+integer('step',blocks.step,1,6)+'</div>'+
    '<div class="scratch-c-body"><span class="scratch-inner green">清除一個數位模組</span></div>'+
    '<div class="scratch-c-footer"></div></div>';
}
function renderEditor(){
  const p=snapshot.puzzle;
  $('editorMode').textContent=canEdit()?'你可以修改':'等待操作員';
  $('approveBtn').disabled=!canAnalyze()||snapshot.approved;
  $('runBtn').disabled=!canEdit()||!snapshot.approved;
  $('hintBtn').disabled=snapshot.status!=='active'||snapshot.role==='teacher'||snapshot.hintsLeft===0;
  $('editorTip').textContent=snapshot.status!=='active'?'關卡目前無法操作。':
    snapshot.role==='analyst'?'檢查右側積木後，點「③ 分析員核准」。每次修改後都要重新核准。':
    snapshot.role==='operator'?(snapshot.approved?'分析員已核准！現在請點「④ 操作員執行」。':'修改積木後，請分析員按「③ 核准」，才能執行。'):
    '教師可監看積木與 Python，實際修改由操作員進行。';
  if(!p){
    $('editor').innerHTML='<div class="empty">等待老師開始任務，或分析員發布實驗挑戰。</div>';
    $('codeOutput').textContent='# 等待程式積木';
    return;
  }
  let output='';
  if(p.kind==='sequence')output=sequenceEditor(p.blocks,'sequence');
  if(p.kind==='condition')output=conditionEditor(p.blocks);
  if(p.kind==='loop')output=loopEditor(p.blocks);
  if(p.kind==='debug'){
    output='<div class="scratch-group-title">① 修正執行順序</div>'+sequenceEditor(p.blocks.order,'debug')+
      '<div class="scratch-group-title">② 修正 IF 條件</div>'+conditionEditor(p.blocks,false)+
      '<div class="scratch-group-title">③ 修正 FOR 迴圈</div>'+loopEditor(p.blocks);
  }
  $('editor').innerHTML=output;
  $('codeOutput').textContent=p.python || '# 等待程式積木';
}
function currentPhase(){
  if(!snapshot?.puzzle || snapshot.status==='lobby')return 'brief';
  if(snapshot.status==='won'||snapshot.status==='failed')return 'done';
  if(snapshot.status==='paused')return 'paused';
  if(snapshot.approved)return 'run';
  if(snapshot.revision>0||snapshot.attempts>0)return 'approve';
  return 'edit';
}
function renderTurn(){
  const phase=currentPhase();
  const banner=$('turnBanner');
  banner.dataset.role=snapshot.role;
  banner.dataset.phase=phase;
  const actors=teamActors();
  const analyst=actors.find(m=>m.role==='analyst');
  const operator=actors.find(m=>m.role==='operator');
  const observer=actors.find(m=>m.role==='observer');
  const analystName=analyst?.nickname||'分析員';
  const operatorName=operator?.nickname||'操作員';
  const activeName=phase==='approve'||phase==='brief'?analystName:operatorName;
  const actionTexts={
    brief:'① 分析員先閱讀任務卡、準備向隊友說明',
    edit:'② 操作員修改積木，分析員從旁引導',
    approve:'③ 分析員檢查修改後的積木並核准',
    run:'④ 操作員執行目前已核准的程式',
    done:'本回合已結束 · 等老師切換關卡',
    paused:'倒數暫停中 · 等老師恢復'
  };
  $('turnEyebrow').textContent=snapshot.mode==='lab'?'挑戰實驗室 · CO-OP CREATOR':'雙人合作流程 · 角色分工';
  const aRole=snapshot.role;
  if(snapshot.status==='lobby'){
    $('turnSymbol').textContent='⌛';
    $('turnTitle').textContent='等待老師開始任務';
    $('turnDescription').textContent='老師與至少一位學生即可開局，最多三名學生；不足兩位學生時由老師補位。';
  }else if(snapshot.mode==='lab'&&!snapshot.puzzle){
    $('turnSymbol').textContent='🧪';
    $('turnTitle').textContent=aRole==='analyst'?'你是設計分析員：現在請製作並發布題目':aRole==='operator'?'等待分析員發布新挑戰':'實驗室準備中：請分析員發布題目';
    $('turnDescription').textContent=aRole==='analyst'?'選擇任務類型 → 修改規則 → 查看預覽 → 按發布。操作員會收到同步題目。':
      '分析員還在設計題目，發布後就能操作 Scratch 積木。';
  }else if(aRole==='observer' && phase!=='done' && phase!=='paused'){
    $('turnSymbol').textContent='👀';
    $('turnTitle').textContent='你是情報支援員：觀察程式、協助隊友思考';
    $('turnDescription').textContent='本關由另外兩名學生操作；你可以使用作戰通訊提出建議。下一關角色自動輪換。';
  }else if(phase==='done'){
    $('turnSymbol').textContent=snapshot.status==='won'?'🏆':'↺';
    $('turnTitle').textContent=snapshot.status==='won'?'數位核心已解除！':'任務失敗，可重新挑戰';
    $('turnDescription').textContent=snapshot.status==='won'?'請與隊友一起回顧程式執行結果，等待老師下一關或實驗室換手。':'請分析失敗原因，老師可以重新開始這一關。';
  }else if(phase==='paused'){
    $('turnSymbol').textContent='Ⅱ';
    $('turnTitle').textContent='老師已暫停計時';
    $('turnDescription').textContent='操作暫停，倒數已凍結；等待老師恢復遊戲。';
  }else{
    $('turnSymbol').textContent=aRole==='analyst'?'🔎':aRole==='operator'?'🧩':'🎓';
    if(aRole==='analyst'){
      $('turnTitle').textContent=phase==='approve'?'現在輪到你：確認隊友的程式並按「③ 核准」':
        phase==='run'?'你已核准：等操作員按「④ 執行」':
        '你是程式分析員：先讀左側任務卡，告訴隊友規則';
      $('turnDescription').textContent=phase==='approve'?'右側積木已修改；檢查是否符合機密規則。任何再次修改都需要重新核准。':
        phase==='run'?'操作員已取得這個版本的執行權限，請觀察程式結果。':
        '本關正確答案只有分析員可見，請用語音或左側「作戰通訊」一步一步引導操作員。';
    }else if(aRole==='operator'){
      $('turnTitle').textContent=phase==='approve'?'已修改！現在請分析員按「③ 核准」':
        phase==='run'?'輪到你執行！請按「④ 操作員執行」':
        '你是拆彈操作員：依分析員的說明修改積木';
      $('turnDescription').textContent=phase==='approve'?'你目前還不能執行，請請隊友先檢查並核准你的程式。':
        phase==='run'?'已收到核准。按下執行後觀察動畫，若錯誤再與隊友討論修正。':
        '使用右側的 Scratch 積木：拖曳排序、選擇 AND/OR、調整數字；不要猜答案。';
    }else{
      $('turnTitle').textContent='教師監控：'+actionTexts[phase];
      $('turnDescription').textContent='分析員 '+analystName+' ／ 操作員 '+operatorName+'；每關會交換角色。';
    }
  }
  const doing=phase==='done'?'已結算':phase==='paused'?'已暫停':(snapshot.mode==='lab'&&!snapshot.puzzle)?'設計中':actionTexts[phase];
  $('turnPartner').innerHTML=
    '<div class="team-roster-title">本關隊伍配置</div>'+
    '<div class="team-roster-line"><span class="team-role analyst">🔎 分析員</span><strong title="'+escapeHtml(analystName)+'">'+escapeHtml(analystName)+'</strong></div>'+
    '<div class="team-roster-line"><span class="team-role operator">🧩 操作員</span><strong title="'+escapeHtml(operatorName)+'">'+escapeHtml(operatorName)+'</strong></div>'+
    (observer?'<div class="team-roster-line"><span class="team-role observer">👀 情報支援</span><strong>'+escapeHtml(observer.nickname)+'</strong></div>':'')+
    '<div class="team-step-caption" title="'+escapeHtml(doing)+'">'+escapeHtml(doing)+'</div>';
  const order=['brief','edit','approve','run'];
  const current=order.indexOf(phase);
  document.querySelectorAll('#workflowSteps [data-phase]').forEach((el,i)=>{
    el.className=(phase==='done'||(current>=0&&i<current))?'completed':((current===i)||(phase==='edit'&&i===0))?'current':'';
  });
}
function renderAgents(){
  const phase=currentPhase();
  const current=phase==='approve'?'analyst':phase==='run'||phase==='edit'?'operator':null;
  const actors=teamActors();
  const display=actors.length?actors:[
    {slot:0,nickname:'等待學生 A',role:'observer',online:false},
    {slot:1,nickname:'可加入學生 B',role:'observer',online:false},
    {slot:2,nickname:'可加入學生 C',role:'observer',online:false}];
  $('agents').innerHTML=display.map(m=>
    '<div class="agent '+(self?.role==='student'&&self.slot===m.slot?'self ':'')+(current===m.role?'active-agent':'')+'">'+
    '<div class="avatar">'+(m.isTeacher?'🎓':m.slot===0?'⌘':'◇')+'</div><div class="agent-info"><b>'+
    escapeHtml(m.nickname)+(self?.role==='student'&&self.slot===m.slot?' · 你':'')+'</b><small>'+escapeHtml(roleName(m.role))+
    '</small>'+(current===m.role?'<span class="agent-acting">● 目前需要行動</span>':'')+
    (m.role==='observer'&&snapshot.status!=='lobby'?'<span class="agent-acting">● 下一關可輪換</span>':'')+
    '<div class="stats-micro">修改 '+(m.edits||0)+' · 執行 '+(m.runs||0)+' · 失誤 '+(m.errors||0)+' · 提示 '+(m.hints||0)+'</div></div><i class="led '+(m.online?'online':'')+'"></i></div>'
  ).join('');
  $('teacherConn').textContent='教師：'+(snapshot.teacherOnline?'● 在線':'○ 暫時離線')+
    '｜學生 '+snapshot.members.filter(m=>m.online).length+' / 3 在線（至少 1 位即可開局）';
}
function renderMission(){
  const stage=snapshot.stage;
  $('roomLabel').textContent=snapshot.code;
  $('rolePill').textContent=roleName(snapshot.role)+
    (self?.role==='student'?' / 玩家 '+['A','B','C'][self.slot]:
      snapshot.isTeacher&&snapshot.role!=='teacher'?' / 教師兼任':'');
  $('rolePill').className='pill role-pill '+snapshot.role;
  $('stageCaption').textContent=snapshot.mode==='lab'?'CREATOR LAB / 自訂挑戰':
    '第 '+(snapshot.stageIndex+1)+' 關 · '+(snapshot.questionNumber>1?'本題型第 '+snapshot.questionNumber+' 題':'首次挑戰');
  $('stageHeading').textContent=snapshot.title;
  $('score').textContent=String(snapshot.teamScore).padStart(4,'0');
  $('difficultyPill').textContent=snapshot.difficulty==='advanced'?'進階模式':'基礎模式';
  document.querySelectorAll('#missionTrack span').forEach(x=>{
    const index=Number(x.dataset.stage);
    x.className=snapshot.mode==='lab'?'passed':index===snapshot.stageIndex?'active':index<snapshot.stageIndex?'passed':'';
  });
  const statusTitles={lobby:'等待老師開啟任務',active:'數位裝置已啟動',paused:'教師已暫停倒數',won:'✓ 虛擬核心安全解除',failed:'⚠ 裝置進入安全重啟'};
  $('systemStatus').textContent=statusTitles[snapshot.status]||'同步中';
  $('timerSub').textContent=statusTitles[snapshot.status]||'';
  $('coreStatus').textContent=snapshot.status==='won'?'CLEARED':snapshot.status==='failed'?'REBOOT':snapshot.status==='active'?'ACTIVE':snapshot.status==='paused'?'PAUSED':'STANDBY';
  $('coreLabel').textContent=snapshot.mode==='lab'?'CREATOR LAB':'DIGITAL CORE';
  $('core').classList.toggle('won',snapshot.status==='won');
  $('core').classList.toggle('failed',snapshot.status==='failed');
  $('stabilityValue').textContent=snapshot.stability+'%';
  $('stabilityFill').style.width=snapshot.stability+'%';
  $('stabilityFill').style.background=snapshot.stability<40?'linear-gradient(90deg,#c44b6b,#fa8793)':'linear-gradient(90deg,#14bba7,#75f3cf)';
  $('revision').textContent='R'+String(snapshot.revision).padStart(2,'0');
  $('hintLeft').textContent=String(snapshot.hintsLeft).padStart(2,'0');
  $('attempts').textContent=String(snapshot.attempts).padStart(2,'0');
  $('approval').textContent=snapshot.approved?'已核准':'待檢查';
  const p=snapshot.puzzle;
  const analyst=snapshot.role==='analyst'||(snapshot.isTeacher&&snapshot.role==='teacher');
  $('missionPanel').dataset.view=analyst?'analyst':'operator';
  if(snapshot.status==='lobby'){
    $('taskInstructions').innerHTML='<div class="mission-card-title">任務即將開始</div><p class="mission-card-explain">至少一位學生加入後老師即可開始；如有兩位學生則雙人分工，三位學生每關輪換情報支援員。</p>';
  }else if(snapshot.mode==='lab'&&!p){
    $('taskInstructions').innerHTML=analyst?
      '<div class="mission-card-title">設計專屬程式挑戰</div><div class="mission-rule">到右側「挑戰實驗室」挑選任務，設定正確規則並確認預覽，再發布給隊友。</div><p>注意：任務發布前不會開始倒數。</p>':
      '<div class="mission-card-title">等待新挑戰</div><div class="mission-hidden">分析員正在設計題目。發布後將在右側出現可操作積木。</div>';
  }else if(analyst&&p?.briefing){
    const br=p.briefing;
    const cases=p.kind==='condition'&&p.scenarios.length?
      '<div class="mission-actions"><b>🔬 測試資料與預期結果</b><ol>'+
      p.scenarios.slice(0,7).map(c=>'<li>'+escapeHtml(c.color)+' ／ 能源 '+escapeHtml(c.power)+' → '+(c.expected?'應解鎖':'應保持鎖定')+'</li>').join('')+'</ol></div>':'';
    $('taskInstructions').innerHTML='<span class="mission-card-badge">🔐 僅分析員與教師可見</span>'+
      '<div class="mission-card-title">🎯 '+escapeHtml(br.title)+'</div>'+
      '<p class="mission-card-explain">請先看懂以下「正確規則」，並將操作方法說給另一位同學。</p>'+
      '<div class="mission-rule"><span class="mission-rule-label">本關正確規則 · 請讀給操作員</span>'+escapeHtml(br.rule)+'</div>'+
      '<details class="task-hints"><summary>需要提示？展開操作步驟與測試</summary>'+
      '<div class="mission-actions"><b>操作步驟</b><ol>'+br.steps.map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ol></div>'+
      cases+'</details>';
  }else if(snapshot.role==='observer'){
    $('taskInstructions').innerHTML='<span class="mission-card-badge">👀 情報支援員</span>'+
      '<div class="mission-card-title">觀察隊友的程式與執行結果</div>'+
      '<div class="mission-hidden"><h3>你這一關負責支援</h3>不能替分析員核准，也不能替操作員修改或執行。'+
      '請用作戰通訊提出建議，下一關就有機會換成正式操作角色。</div>';
  }else{
    $('taskInstructions').innerHTML='<span class="mission-card-badge">🧩 操作員專用</span>'+
      '<div class="mission-card-title">依分析員提供的規則完成程式</div>'+
      '<div class="mission-hidden">先向分析員詢問這題的規則，使用右側積木完成答案。'+
      '<strong>分析員核准後，你就能按「解除核心」。</strong></div>'+
      '<p class="mission-card-explain">'+STAGE_HELP[stage]+'</p>';
  }
  renderTurn();
}
function renderComms(){
  $('comms').innerHTML=snapshot.messages.length?snapshot.messages.map(m=>'<div class="message"><strong>'+escapeHtml(m.from)+'</strong>'+escapeHtml(m.text)+'</div>').join(''):'<div class="empty">分析員可在此傳送簡短提示。</div>';
  $('messageInput').disabled=!canMessage();
  $('messageForm').querySelector('button').disabled=!canMessage();
}
function renderTeacher(){
  $('teacherPanel').hidden=!snapshot.isTeacher;
  if(!snapshot.isTeacher)return;
  const duration=$('durationSelect');
  if(document.activeElement!==duration)duration.value=String(snapshot.duration);
  if(document.activeElement!==$('difficultySelect'))$('difficultySelect').value=snapshot.difficulty;
  $('stageSelect').value=String(snapshot.stageIndex);
  const ready=snapshot.members.some(m=>m.online);
  const actionAvailable={
    start:snapshot.status==='lobby'&&ready,
    pause:snapshot.status==='active',resume:snapshot.status==='paused'&&Boolean(snapshot.puzzle),
    retry:ready,
    next:ready&&snapshot.mode==='mission'&&snapshot.stageIndex<6,
    lab:ready,
    labNext:ready&&snapshot.mode==='lab',reset:true
  };
  document.querySelectorAll('[data-teacher]').forEach(btn=>btn.disabled=!actionAvailable[btn.dataset.teacher]);
  $('teacherSummary').innerHTML='<strong>課堂即時監控：</strong> 本題型第 '+(snapshot.questionNumber||1)+' 題 · 學生 '+snapshot.members.filter(m=>m.online).length+'/3 在線 · 已加入 '+snapshot.members.length+' 人 · '+'本關 '+snapshot.attempts+' 次執行 · 累積 '+snapshot.history.length+
    ' 次結算 · '+(snapshot.status==='active'?'關卡倒數中':'倒數已停止')+
    ' · 請在 40 分鐘課程與 10 分鐘休息時自行使用「暫停」。';
}
function renderHistory(){
  const items=snapshot.history;
  $('historyContent').innerHTML='<div><strong>全隊合作積分：'+snapshot.teamScore+'</strong> · 已結算 '+items.length+' 回合</div>'+
    (items.length?'<div class="history-items">'+items.slice(-8).reverse().map(h=>'<div class="history-item '+(h.success?'success':'')+'">'+escapeHtml({
      sequence:'執行順序',condition:'條件判斷',loop:'迴圈',debug:'綜合除錯',lab:'實驗室'
    }[h.stage]||h.stage)+'<br>'+(h.success?'✓ 成功':'× 重試')+' · '+h.score+' 分 · '+h.attempts+' 次</div>').join('')+'</div>':'<div class="empty">完成關卡後在此顯示隊伍成績。</div>')+
    '<p>學習目標：掌握順序、布林邏輯、迴圈，並透過執行追蹤逐步 Debug。</p>';
  const canFeedback=self?.role==='student';
  $('feedbackForm').hidden=!canFeedback;
}
function labSpec(){
  return structuredClone(labDrafts[['sequence','condition','loop'][preset]]);
}
function labPreview(spec){
  if(spec.kind==='sequence'){
    const good=spec.target.length===3&&spec.target.every(x=>COLORS.includes(x))&&new Set(spec.target).size===3;
    return {ok:good,title:'執行順序挑戰',rule:good?'必須依序啟動 '+spec.target.map(x=>COLOR_LABEL[x]+'（'+x+'）').join(' → '):'三個顏色必須不同，請重新選擇。',hint:'操作員需把虛擬訊號積木排成這個順序。'};
  }
  if(spec.kind==='condition'){
    const good=COLORS.includes(spec.color)&&['AND','OR'].includes(spec.mode)&&Number.isInteger(spec.threshold)&&spec.threshold>=20&&spec.threshold<=80;
    const connective=spec.mode==='AND'?'且（AND：兩個條件皆成立）':'或（OR：符合任一條件即可）';
    return {ok:good,title:'條件邏輯挑戰',rule:good?'顏色為 '+COLOR_LABEL[spec.color]+'（'+spec.color+'） '+connective+' 能源 > '+spec.threshold:'條件不合法；請選擇顏色、AND／OR，能源門檻需為 20～80。',
      hint:'請注意 OR 是「或」，AND 才是「且」。操作員的條件積木需與預覽一致。'};
  }
  const good=Number.isInteger(spec.target)&&spec.target>=2&&spec.target<=10;
  return {ok:good,title:'迴圈次數挑戰',rule:good?'數位模組剛好重複執行 '+spec.target+' 次':'迴圈目標次數應介於 2～10。',hint:'操作員需要設定起點、終點、增加值，讓實際迴圈次數符合目標。'};
}
function refreshLabPreview(){
  const box=$('labPreview');
  if(!box)return;
  const info=labPreview(labSpec());
  box.classList.toggle('lab-preview-invalid',!info.ok);
  box.innerHTML='<b>📋 發布前題目預覽：'+escapeHtml(info.title)+'</b>'+
    '<div class="lab-preview-rule">'+escapeHtml(info.rule)+'</div>'+
    '<div class="lab-preview-tip">'+escapeHtml(info.hint)+'</div>';
  const submit=$('labPublish');
  if(submit)submit.disabled=!info.ok;
}
function renderLab(){
  const active=snapshot.mode==='lab';
  $('labPanel').hidden=!active;
  if(!active)return;
  const designing=(snapshot.role==='analyst') &&
    (snapshot.status==='won'||snapshot.status==='failed'||(snapshot.status==='paused'&&!snapshot.puzzle));
  const target=$('labDesigner');
  if(!designing){
    const launched=Boolean(snapshot.puzzle);
    const isAnalyst=snapshot.role==='analyst';
    target.innerHTML='<div class="lab-status">'+(launched?
      '✅ 已發布挑戰：'+escapeHtml(snapshot.puzzle.label)+
      '。'+(snapshot.status==='active'?'目前正在進行，不能修改已發布的題目。':'本回合已結束，等待老師或分析員安排下一題。'):
      (snapshot.role==='teacher'?'等待分析員在此設計並發布題目。':'等待分析員發布新挑戰。'))+
      (snapshot.status==='paused'&&launched?'　⏸ 老師暫停中，請勿重新發布。':'')+
      (launched&&isAnalyst?' 現在請向操作員說明任務規則並核准。':'')+'</div>';
    return;
  }
  const draft=labSpec();
  const title=['任務 1：訊號順序','任務 2：布林密碼','任務 3：迴圈陷阱'];
  target.innerHTML='<div class="lab-status">🔎 你目前是挑戰設計者。發布後就不能在解題過程中改題；請先閱讀下方預覽。</div>'+
    '<div class="lab-presets">'+title.map((t,i)=>'<button type="button" class="'+(preset===i?'selected':'')+'" data-preset="'+i+'">'+(preset===i?'▶ ':'')+t+'</button>').join('')+'</div>'+
    '<form id="labForm">'+(preset===0?
      '<label for="labS1">第一個訊號</label><select id="labS1">'+htmlOptions(COLORS,draft.target[0],COLOR_LABEL)+'</select>'+
      '<label for="labS2">第二個訊號</label><select id="labS2">'+htmlOptions(COLORS,draft.target[1],COLOR_LABEL)+'</select>'+
      '<label for="labS3">第三個訊號</label><select id="labS3">'+htmlOptions(COLORS,draft.target[2],COLOR_LABEL)+'</select><div class="stats-micro">三種顏色必須不同。</div>':
      preset===1?'<label for="labColor">正確顏色</label><select id="labColor">'+htmlOptions(COLORS,draft.color,COLOR_LABEL)+'</select>'+
      '<label for="labThreshold">能源門檻（20～80）</label><input type="number" id="labThreshold" min="20" max="80" step="1" value="'+escapeHtml(draft.threshold)+'">'+
      '<label for="labMode">兩個條件的關係</label><select id="labMode">'+htmlOptions(['AND','OR'],draft.mode,{AND:'且 AND',OR:'或 OR'})+'</select>':
      '<label for="labCount">要重複執行幾次？（2～10）</label><input type="number" id="labCount" min="2" max="10" step="1" value="'+escapeHtml(draft.target)+'">')+
    '<div id="labPreview" class="lab-preview" aria-live="polite"></div>'+
    '<button class="primary-btn small-btn" type="submit" id="labPublish">🚀 確認預覽，發布給操作員</button></form>';
  refreshLabPreview();
}
function animateResult(result){
  if(!result||result.serial===lastSerial)return;
  lastSerial=result.serial;
  animatingSerial=result.serial;
  const panel=$('tracePanel');
  panel.innerHTML='<b>'+ (result.success?'✓ MISSION CLEAR':'▶ EXECUTION TRACE')+'</b>';
  if(result.success)beep('success');
  else beep('error');
  $('coreStatus').textContent=result.success?'CLEARED':snapshot.status==='failed'?'REBOOT':'ERROR';
  document.querySelectorAll('.circuit-node').forEach(x=>x.classList.remove('active','bad'));
  const rows=result.trace||[];
  rows.forEach((t,i)=>{
    setTimeout(()=>{
      if(animatingSerial!==result.serial)return;
      panel.insertAdjacentHTML('beforeend','<div class="trace-entry '+(t.ok?'ok':'bad')+'">'+(t.ok?'✓ ':'✕ ')+escapeHtml(t.title)+(t.actual?' → '+escapeHtml(t.actual):'')+'</div>');
      const node=$('node'+(i%4));
      node.classList.add(t.ok?'active':'bad');
    },Math.min(i*320,4800));
  });
  setTimeout(()=>{
    if(animatingSerial!==result.serial)return;
    panel.insertAdjacentHTML('beforeend','<div class="trace-entry">'+escapeHtml(result.reason||'')+'</div>');
    if(result.success)toast('解除成功！老師可繼續下一關。');
    if(snapshot?.status==='failed')toast('裝置安全重啟，可請老師重試。',true);
  },Math.min(rows.length*320,5000)+180);
}
function render(){
  if(!snapshot||!self)return;
  $('gameScreen').dataset.status=snapshot.status;
  $('gameScreen').dataset.teacher=String(snapshot.isTeacher);
  renderMission();renderAgents();renderComms();renderEditor();renderTeacher();renderHistory();renderLab();
  updateClock();
  if(snapshot.result?.serial!==undefined && snapshot.result?.serial!==lastSerial)animateResult(snapshot.result);
  if(!snapshot.result && snapshot.status==='active'){
    $('tracePanel').innerHTML='<span class="empty">執行後將逐步顯示每一條指令的執行追蹤。</span>';
    document.querySelectorAll('.circuit-node').forEach(x=>x.classList.remove('active','bad'));
  }
}
$('createBtn').addEventListener('click',async()=>{
  const r=await send('room:create');
  if(!r.ok)return;
  saveIdentity({code:r.code,token:r.token,role:'teacher'});
  $('lobbyScreen').hidden=true;$('gameScreen').hidden=false;$('leaveBtn').hidden=false;
  $('roomCode').value=r.code;toast('房間 '+r.code+' 已建立，可邀請 1～3 位學生。');
  // A snapshot sent during create might precede the acknowledgement.
  await send('teacher:action',{action:'config',duration:8,difficulty:'basic'},true);
});
$('joinBtn').addEventListener('click',async()=>{
  const code=$('roomCode').value.trim().toUpperCase();
  const nickname=$('nickname').value.trim();
  if(code.length!==6){toast('請填入六碼房間代碼',true);return;}
  if(!nickname){toast('請填入學生暱稱',true);return;}
  const r=await send('room:join',{code,nickname});
  if(!r.ok)return;
  saveIdentity({code:r.code,token:r.token,role:'student',slot:r.slot});
  $('lobbyScreen').hidden=true;$('gameScreen').hidden=false;$('leaveBtn').hidden=false;
  toast('加入成功！老師可在至少一名學生在線時開始遊戲。');
  // Request a fresh snapshot through an idempotent rejoin.
  await send('room:join',{code:r.code,token:r.token},true);
});
$('soundBtn').textContent=soundOn?'🔊':'🔇';
$('soundBtn').addEventListener('click',()=>{
  soundOn=!soundOn;localStorage.setItem('defuse-sound',soundOn?'on':'off');
  $('soundBtn').textContent=soundOn?'🔊':'🔇';if(soundOn)beep();
});
$('leaveBtn').addEventListener('click',()=>{
  if(!window.confirm('要離開這個房間並清除本機登入資訊嗎？'))return;
  localStorage.removeItem('defuse-identity');
  window.location.reload();
});
$('copyRoom').addEventListener('click',async()=>{
  if(!snapshot)return;
  try{await navigator.clipboard.writeText(snapshot.code);toast('已複製房間代碼：'+snapshot.code);}
  catch{toast('請手動複製代碼：'+snapshot.code);}
});
$('approveBtn').addEventListener('click',()=>send('analysis:approve'));
$('runBtn').addEventListener('click',()=>send('puzzle:run'));
$('hintBtn').addEventListener('click',()=>send('hint:request'));
$('messageForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=$('messageInput').value.trim();
  if(!msg)return;
  if((await send('analysis:message',{message:msg})).ok)$('messageInput').value='';
});
// Each editor event queues a single authoritative update. Rebuilding a form while
// earlier socket responses are still in flight must never revert previous fields.
let editQueue=Promise.resolve();
function queueEdit(transform){
  editQueue=editQueue.catch(()=>{}).then(async()=>{
    if(!canEdit() || !snapshot?.puzzle)return;
    const changed=transform(snapshot.puzzle);
    if(changed!==null) await send('puzzle:edit',{blocks:changed});
  });
  return editQueue;
}
$('editor').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-move]');
  if(!btn||!canEdit())return;
  const [idx,shift]=btn.dataset.move.split(':').map(Number);
  await queueEdit(p=>{
    if(!['sequence','debug'].includes(p.kind))return null;
    const blocks=p.kind==='debug'?p.blocks.order.slice():p.blocks.slice();
    const dest=idx+shift;if(dest<0||dest>=blocks.length)return null;
    [blocks[idx],blocks[dest]]=[blocks[dest],blocks[idx]];
    return p.kind==='debug'?{...p.blocks,order:blocks}:blocks;
  });
});
$('editor').addEventListener('change',async e=>{
  const el=e.target.closest('[data-field]');
  if(!el||!canEdit())return;
  // Capture immediately; the editor may be rerendered before this edit is sent.
  const field=el.dataset.field;
  const value=el.type==='number'?Number(el.value):el.value;
  await queueEdit(p=>{
    const blocks={...p.blocks};
    if(!Object.prototype.hasOwnProperty.call(blocks,field))return null;
    blocks[field]=value;
    return blocks;
  });
});
$('editor').addEventListener('dragstart',e=>{
  if(!canEdit())return;
  const row=e.target.closest('[data-row]');
  if(row){dragged=Number(row.dataset.row);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';}
});
$('editor').addEventListener('dragover',e=>{if(dragged!==null&&e.target.closest('[data-row]'))e.preventDefault();});
$('editor').addEventListener('drop',async e=>{
  const row=e.target.closest('[data-row]');
  if(!row||dragged===null||!canEdit())return;
  e.preventDefault();
  const from=dragged,to=Number(row.dataset.row);
  dragged=null;
  await queueEdit(p=>{
    if(!['sequence','debug'].includes(p.kind))return null;
    const blocks=p.kind==='debug'?p.blocks.order.slice():p.blocks.slice();
    if(from<0||from>=blocks.length||to<0||to>=blocks.length)return null;
    const item=blocks.splice(from,1)[0];blocks.splice(to,0,item);
    return p.kind==='debug'?{...p.blocks,order:blocks}:blocks;
  });
});
$('editor').addEventListener('dragend',()=>{dragged=null;});
document.querySelectorAll('[data-teacher]').forEach(b=>b.addEventListener('click',async()=>{
  const action=b.dataset.teacher;
  if(action==='reset'&&!window.confirm('確定要重設整場遊戲、積分與學習紀錄嗎？'))return;
  await send('teacher:action',{action});
}));
$('saveConfig').addEventListener('click',()=>send('teacher:action',{
  action:'config',duration:Number($('durationSelect').value),difficulty:$('difficultySelect').value
}));
$('jumpStage').addEventListener('click',()=>send('teacher:action',{action:'stage',index:Number($('stageSelect').value)}));
$('labDesigner').addEventListener('click',e=>{
  const btn=e.target.closest('[data-preset]');
  if(!btn)return;
  preset=Number(btn.dataset.preset);
  renderLab();
});
function saveLabInputs(){
  if(!$('labForm'))return;
  if(preset===0)labDrafts.sequence.target=[$('labS1').value,$('labS2').value,$('labS3').value];
  if(preset===1)labDrafts.condition={kind:'condition',color:$('labColor').value,threshold:Number($('labThreshold').value),mode:$('labMode').value};
  if(preset===2)labDrafts.loop={kind:'loop',target:Number($('labCount').value)};
  refreshLabPreview();
}
$('labDesigner').addEventListener('input',e=>{if(e.target.closest('#labForm'))saveLabInputs();});
$('labDesigner').addEventListener('change',e=>{if(e.target.closest('#labForm'))saveLabInputs();});
$('labDesigner').addEventListener('submit',async e=>{
  if(e.target.id!=='labForm')return;
  e.preventDefault();
  saveLabInputs();
  const spec=labSpec(),preview=labPreview(spec);
  if(!preview.ok){toast('請先修正題目設定：'+preview.rule,true);return;}
  const button=$('labPublish');
  if(button)button.disabled=true;
  const r=await send('lab:publish',{spec});
  if(r.ok){
    toast('✅ 挑戰發布成功！現在請向操作員說明規則並核准。');
  }else if(button)button.disabled=false;
});
$('feedbackForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const r=await send('feedback:submit',{rating:Number($('rating').value),comment:$('feedbackText').value});
  if(r.ok)toast('學習回饋已儲存到目前房間。');
});
updateConnection();
