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
  lab:'設計者自訂數位邏輯規則，另一人負責破解。<br>內建三種任務：自訂執行順序、改造布林條件、設計迴圈陷阱。'
};
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
let dragged=null;
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
function roleName(x){return x==='analyst'?'程式分析員':x==='operator'?'拆彈操作員':'任務觀察員';}
function canEdit(){return snapshot?.role==='operator'&&snapshot?.status==='active';}
function canAnalyze(){return snapshot?.role==='analyst'&&snapshot?.status==='active';}
function colorCard(v,i,kind){
  const name=kind==='sequence' ? (COLOR_LABEL[v]||v) : (STEP_LABEL[v]||v);
  return '<div class="block '+(kind==='debug'?'purple':'')+'" draggable="'+(canEdit()?'true':'false')+'" data-row="'+i+'" role="listitem">'+
    '<div class="block-header"><div class="block-left"><span class="block-dot"></span><div><b>'+String(i+1).padStart(2,'0')+' / '+escapeHtml(name)+'</b><div class="stats-micro mono">'+(kind==='sequence'?'activate("'+escapeHtml(v)+'")':escapeHtml(v.toLowerCase())+'()')+'</div></div></div>'+
    '<div class="block-tools"><button type="button" data-move="'+i+':-1" '+(!canEdit()||i===0?'disabled':'')+' aria-label="上移">↑</button><button type="button" data-move="'+i+':1" '+(!canEdit()||i===(kind==='debug'?snapshot.puzzle.blocks.order.length:snapshot.puzzle.blocks.length)-1?'disabled':'')+' aria-label="下移">↓</button></div></div></div>';
}
function choice(field,values,selected,labels={}){
  return '<select data-field="'+escapeHtml(field)+'" '+(!canEdit()?'disabled':'')+'>'+htmlOptions(values,selected,labels)+'</select>';
}
function integer(field,selected,min,max){
  return '<input type="number" inputmode="numeric" data-field="'+escapeHtml(field)+'" value="'+escapeHtml(selected)+'" min="'+min+'" max="'+max+'" step="1" '+(!canEdit()?'disabled':'')+'>';
}
function sequenceEditor(blocks,kind){
  return '<div class="block-label">點擊 ↑ ↓ 調整順序，或拖曳卡片重新排列。分析員能看見目標順序。</div><div id="orderList" role="list">'+blocks.map((v,i)=>colorCard(v,i,kind)).join('')+'</div>';
}
function conditionEditor(blocks,standalone=true){
  return '<div class="block purple"><b>⬡ IF / ELSE · 布林邏輯</b><div class="block-options">如果 顏色 = '+
    choice('color',COLORS,blocks.color,COLOR_LABEL)+
    ' <span> '+choice('mode',['AND','OR'],blocks.mode,{AND:'且 AND',OR:'或 OR'})+' </span>能源 &gt; '+
    integer('threshold',blocks.threshold,0,100)+'</div></div>'+
    (blocks.useSecond?'<div class="block purple"><b>＋ 進階 OR 判斷</b><div class="block-options">或 顏色 = '+
      choice('secondColor',COLORS,blocks.secondColor,COLOR_LABEL)+
      ' 且能源 &gt; '+integer('secondThreshold',blocks.secondThreshold,0,100)+'</div></div>':'')+
    (standalone?'<div class="block green">✓ 條件成立 → unlock()</div><div class="block orange">✕ 否則 → keepLocked()</div>':'');
}
function loopEditor(blocks){
  return '<div class="block orange"><b>∞ FOR / 重複執行</b><div class="block-options">從 i = '+integer('start',blocks.start,0,11)+' 開始</div>'+
    '<div class="block-options">當 i &lt; '+integer('limit',blocks.limit,1,12)+' 時執行</div>'+
    '<div class="block-options">每次讓 i 增加 '+integer('step',blocks.step,1,6)+'</div></div>'+
    '<div class="block green">↳ disableModule() · 清除一個數位模組</div>';
}
function renderEditor(){
  const p=snapshot.puzzle;
  $('editorMode').textContent=canEdit()?'可編輯 · 操作員':'只讀 · '+roleName(snapshot.role);
  $('approveBtn').disabled=!canAnalyze()||snapshot.approved;
  $('runBtn').disabled=!canEdit()||!snapshot.approved;
  $('hintBtn').disabled=snapshot.status!=='active'||snapshot.role==='teacher'||snapshot.hintsLeft===0;
  if(!p){
    $('editor').innerHTML='<div class="empty">等待老師開始任務，或分析員發布實驗挑戰。</div>';
    $('codeOutput').textContent='// 等待指令載入';
    return;
  }
  let output='';
  if(p.kind==='sequence')output=sequenceEditor(p.blocks,'sequence');
  if(p.kind==='condition')output=conditionEditor(p.blocks);
  if(p.kind==='loop')output=loopEditor(p.blocks);
  if(p.kind==='debug'){
    output='<div class="block-label">① 修正執行順序</div>'+sequenceEditor(p.blocks.order,'debug')+
      '<div class="block-label">② 修正條件判斷</div>'+conditionEditor(p.blocks,false)+
      '<div class="block-label">③ 修正迴圈次數</div>'+loopEditor(p.blocks);
  }
  $('editor').innerHTML=output;
  $('codeOutput').textContent=p.code;
}
function renderAgents(){
  $('agents').innerHTML=(snapshot.members.length ? snapshot.members : [{slot:0,nickname:'等待學生 A',role:'analyst',online:false},{slot:1,nickname:'等待學生 B',role:'operator',online:false}]).map(m=>
    '<div class="agent '+(self?.role==='student'&&self.slot===m.slot?'self':'')+'"><div class="avatar">'+(m.slot===0?'⌘':'◇')+'</div><div class="agent-info"><b>'+
    escapeHtml(m.nickname)+(self?.role==='student'&&self.slot===m.slot?' · 你':'')+'</b><small>'+escapeHtml(roleName(m.role))+
    '</small><div class="stats-micro">修改 '+(m.edits||0)+' · 執行 '+(m.runs||0)+' · 失誤 '+(m.errors||0)+' · 提示 '+(m.hints||0)+'</div></div><i class="led '+(m.online?'online':'')+'"></i></div>'
  ).join('');
  $('teacherConn').textContent='教師控制台：'+(snapshot.teacherOnline?'● 在線':'○ 暫時離線');
}
function renderMission(){
  const stage=snapshot.stage;
  $('roomLabel').textContent=snapshot.code;
  $('rolePill').textContent=roleName(snapshot.role)+(self?.role==='student'?' / 玩家 '+(self.slot===0?'A':'B'):'');
  $('stageCaption').textContent=snapshot.mode==='lab'?'CREATOR LAB / 自訂挑戰':'MISSION '+String(snapshot.stageIndex+1).padStart(2,'0')+' / 04';
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
  $('taskInstructions').innerHTML='<strong>'+escapeHtml(snapshot.title)+'</strong><p>'+STAGE_HELP[stage]+'</p>'+
    (snapshot.role==='analyst'&&snapshot.puzzle?.objective?'<div class="objective"><em>機密分析資料：</em><br>'+escapeHtml(snapshot.puzzle.objective)+'</div>':'')+
    (snapshot.role==='operator'?'<div class="objective">操作員無法讀取完整規則。請向分析員詢問，等待對方核准後再執行。</div>':'')+
    (snapshot.status==='lobby'?'<div class="objective">待兩位學生進入房間，老師按下「開始任務」。</div>':'');
}
function renderComms(){
  $('comms').innerHTML=snapshot.messages.length?snapshot.messages.map(m=>'<div class="message"><strong>'+escapeHtml(m.from)+'</strong>'+escapeHtml(m.text)+'</div>').join(''):'<div class="empty">分析員可在此傳送簡短提示。</div>';
  $('messageInput').disabled=!canAnalyze();
  $('messageForm').querySelector('button').disabled=!canAnalyze();
}
function renderTeacher(){
  $('teacherPanel').hidden=snapshot.role!=='teacher';
  if(snapshot.role!=='teacher')return;
  const duration=$('durationSelect');
  if(document.activeElement!==duration)duration.value=String(snapshot.duration);
  if(document.activeElement!==$('difficultySelect'))$('difficultySelect').value=snapshot.difficulty;
  $('stageSelect').value=String(snapshot.stageIndex);
  const actionAvailable={
    start:snapshot.status==='lobby'&&snapshot.members.length===2,
    pause:snapshot.status==='active',resume:snapshot.status==='paused'&&Boolean(snapshot.puzzle),
    retry:snapshot.members.length===2,
    next:snapshot.members.length===2&&snapshot.mode==='mission'&&snapshot.stageIndex<3,
    lab:snapshot.members.length===2,
    labNext:snapshot.mode==='lab',reset:true
  };
  document.querySelectorAll('[data-teacher]').forEach(btn=>btn.disabled=!actionAvailable[btn.dataset.teacher]);
  $('teacherSummary').innerHTML='<strong>課堂即時監控：</strong> 玩家 '+snapshot.members.length+'/2 人 · '+'本關 '+snapshot.attempts+' 次執行 · 累積 '+snapshot.history.length+
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
  const canFeedback=snapshot.role==='analyst'||snapshot.role==='operator';
  $('feedbackForm').hidden=!canFeedback;
}
function renderLab(){
  const active=snapshot.mode==='lab';
  $('labPanel').hidden=!active;
  if(!active)return;
  const designing=snapshot.role==='analyst'&&['paused','won','failed'].includes(snapshot.status);
  const target=$('labDesigner');
  if(!designing){
    target.innerHTML='<p class="empty">'+(snapshot.role==='analyst'?'請等待目前關卡結束或老師按「實驗室換手」。':'等待分析員設計並發布挑戰；如需交換設計者，請老師按「實驗室換手」。')+'</p>';
    return;
  }
  const title=['任務 1：訊號順序','任務 2：布林密碼','任務 3：迴圈陷阱'];
  target.innerHTML='<div class="lab-presets">'+title.map((t,i)=>'<button type="button" data-preset="'+i+'">'+(preset===i?'▶ ':'')+t+'</button>').join('')+'</div>'+
    '<form id="labForm">'+(preset===0?
      '<label>選擇四種訊號的前三個</label><select id="labS1">'+htmlOptions(COLORS,'BLUE',COLOR_LABEL)+'</select><select id="labS2">'+htmlOptions(COLORS,'RED',COLOR_LABEL)+'</select><select id="labS3">'+htmlOptions(COLORS,'GREEN',COLOR_LABEL)+'</select><div class="stats-micro">三種訊號不能重複</div>':
      preset===1?'<label>指定正確顏色</label><select id="labColor">'+htmlOptions(COLORS,'RED',COLOR_LABEL)+'</select>'+
      '<label>電力比較門檻</label><input type="number" id="labThreshold" min="20" max="80" value="60">'+
      '<label>布林運算子</label><select id="labMode"><option value="AND">AND 且</option><option value="OR">OR 或</option></select>':
      '<label>需要解除幾個模組？</label><input type="number" id="labCount" min="2" max="10" value="7">')+
    '<button class="primary-btn small-btn" type="submit">發布給操作員挑戰 →</button></form>';
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
  $('roomCode').value=r.code;toast('房間 '+r.code+' 已建立，請分享代碼給兩位學生。');
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
  toast('加入成功！請等待老師與另一位同學。');
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
  const btn=e.target.closest('[data-preset]');if(!btn)return;
  preset=Number(btn.dataset.preset);renderLab();
});
$('labDesigner').addEventListener('submit',async e=>{
  if(e.target.id!=='labForm')return;
  e.preventDefault();
  let spec;
  if(preset===0)spec={kind:'sequence',target:[$('labS1').value,$('labS2').value,$('labS3').value]};
  if(preset===1)spec={kind:'condition',color:$('labColor').value,threshold:Number($('labThreshold').value),mode:$('labMode').value};
  if(preset===2)spec={kind:'loop',target:Number($('labCount').value)};
  const r=await send('lab:publish',{spec});
  if(r.ok)toast('自訂挑戰已發布！請另一位學生進行除錯。');
});
$('feedbackForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const r=await send('feedback:submit',{rating:Number($('rating').value),comment:$('feedbackText').value});
  if(r.ok)toast('學習回饋已儲存到目前房間。');
});
updateConnection();
