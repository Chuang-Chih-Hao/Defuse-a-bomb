'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { STAGES, TITLES, makePuzzle, modify, evaluate, validateLabSpec, visiblePuzzle } = require('./engine');

const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const minutes = n => Number.isInteger(n) && n >= 2 && n <= 20 ? n : 8;
const sanitize = (s, max) => String(s || '').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, max);
const sleepClock = room => room.status === 'active' ? Math.max(0, room.deadline - Date.now()) : room.remainingMs;
const channel = code => 'game:' + code;
const rooms = new Map();

function newCode() {
  let code;
  do { code = crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase(); }
  while (rooms.has(code));
  return code;
}
function newRoom() {
  const teacherToken = newToken();
  const code = newCode();
  const room = {
    code, teacherHash: hash(teacherToken), teacherSocket: null, members: [],
    difficulty: 'basic', duration: 8, stageIndex: 0, mode: 'mission', status: 'lobby',
    remainingMs: 8*60000, deadline: null, startedAt: Date.now(), stageStartedAt: null,
    puzzle: null, revision: 0, approved: -1, stability: 100, teamScore: 0,
    stageScore: 0, hintsLeft: 2, attempts: 0, lastResult: null, resultSerial: 0,
    messages: [], history: [], labRounds: 0, designerSpec: null
  };
  rooms.set(code,room);
  return { room,teacherToken };
}
function stageName(room) {
  return room.mode === 'lab' ? 'lab' : STAGES[room.stageIndex];
}
function getAnalystSlot(room) {
  return (room.stageIndex + (room.mode === 'lab' ? room.labRounds : 0)) % 2;
}
function roleOf(room, member) {
  return member.slot === getAnalystSlot(room) ? 'analyst' : 'operator';
}
function begin(room, spec = null) {
  if (spec) room.designerSpec = spec;
  room.puzzle = room.mode === 'lab' ? (room.designerSpec ? makePuzzle('lab',false,room.designerSpec) : null)
    : makePuzzle(STAGES[room.stageIndex],room.difficulty === 'advanced');
  room.revision = 0;
  room.approved = -1;
  room.stability = 100;
  room.remainingMs = room.duration*60000;
  room.deadline = room.puzzle ? Date.now() + room.remainingMs : null;
  room.stageScore = 0;
  room.hintsLeft = 2;
  room.attempts = 0;
  room.lastResult = null;
  room.messages = [];
  room.stageStartedAt = Date.now();
  room.status = room.puzzle ? 'active' : 'paused';
}
function finish(room, success, reason) {
  if (room.status === 'won' || room.status === 'failed') return;
  room.remainingMs = sleepClock(room);
  room.deadline = null;
  room.status = success ? 'won' : 'failed';
  room.resultSerial++;
  room.lastResult = {
    ...(room.lastResult || {}),
    success, reason, serial: room.resultSerial
  };
  if (success) {
    const bonus = Math.floor(room.remainingMs / 1000 / 2) + room.stability;
    room.stageScore += 350 + Math.max(0,bonus);
    room.teamScore += room.stageScore;
  }
  room.history.push({
    stage: stageName(room), difficulty: room.difficulty, mode: room.mode, success,
    score: success ? room.stageScore : 0, attempts: room.attempts,
    durationSeconds: Math.round((Date.now() - room.stageStartedAt)/1000),
    completedAt: Date.now(), reason
  });
}
function publicState(room, member = null, teacher = false) {
  const role = teacher ? 'teacher' : member ? roleOf(room,member) : 'spectator';
  return {
    code: room.code, mode: room.mode, role,
    stage: stageName(room), stageIndex: room.stageIndex, title: TITLES[stageName(room)],
    difficulty: room.difficulty, duration: room.duration, status: room.status,
    remainingMs: sleepClock(room), serverTime: Date.now(),
    members: room.members.map(m => ({
      slot: m.slot, nickname: m.nick, online: Boolean(m.socketId),
      role: roleOf(room,m), errors: m.errors, hints: m.hints,
      edits: m.edits, runs: m.runs, messages: m.messages,
      feedback: m.feedback ? {rating:m.feedback.rating,comment:m.feedback.comment}:null
    })),
    teacherOnline: Boolean(room.teacherSocket), teamScore: room.teamScore, stageScore: room.stageScore,
    stability: room.stability, hintsLeft: room.hintsLeft, attempts: room.attempts,
    revision: room.revision, approved: room.approved === room.revision,
    messages: room.messages.slice(-10), history: room.history.slice(-20),
    result: room.lastResult, labRounds: room.labRounds,
    puzzle: room.puzzle ? visiblePuzzle(room.puzzle,teacher || role === 'analyst') : null,
    canEdit: role === 'operator' && room.status === 'active',
    canAnalyze: role === 'analyst' && room.status === 'active',
    canDesign: role === 'analyst' && room.mode === 'lab' &&
      (room.status === 'paused' || room.status === 'won' || room.status === 'failed')
  };
}
function createGameServer() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_, res) => res.json({ok:true,service:'defuse-a-bomb',rooms:rooms.size,uptime:Math.round(process.uptime())}));
  app.get('/api/info', (_, res) => res.json({name:'程式炸彈拆除專家：最後倒數',version:'1.1.0',stages:STAGES}));
  app.use(express.static(path.join(__dirname,'../public'),{maxAge:'1h'}));
  app.get('*', (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));
  const httpServer = http.createServer(app);
  const io = new Server(httpServer,{cors:{origin:false},maxHttpBufferSize:8192,pingInterval:20000,pingTimeout:15000});
  function broadcast(room) {
    if (room.teacherSocket) io.to(room.teacherSocket).emit('room:snapshot',publicState(room,null,true));
    for (const m of room.members) if (m.socketId) io.to(m.socketId).emit('room:snapshot',publicState(room,m,false));
  }
  function check(socket,room,mustPlay=false) {
    if (!room || socket.data.roomCode !== room.code) throw Error('請重新加入遊戲房間');
    if (socket.data.kind === 'teacher') {
      if (room.teacherSocket !== socket.id) throw Error('教師登入已失效');
      if (mustPlay) throw Error('此功能由學生操作');
      return {teacher:true,member:null};
    }
    const m = room.members.find(x=>x.tokenHash === socket.data.tokenHash);
    if (!m || m.socketId !== socket.id) throw Error('玩家身分已失效，請重新加入');
    return {teacher:false,member:m};
  }
  function playGuard(socket) {
    const room = rooms.get(socket.data.roomCode);
    const auth = check(socket,room,true);
    if (room.status !== 'active' || !room.puzzle) throw Error('關卡尚未開始或已結束');
    return {room,member:auth.member,role:roleOf(room,auth.member)};
  }
  function handler(socket,event,fn) {
    socket.on(event,(data,ack)=>{
      try {
        const now=Date.now();
        const rate=socket.data.rate || {time:now,count:0};
        if(now-rate.time>10000){rate.time=now;rate.count=0;}
        socket.data.rate=rate;
        if(++rate.count>100) throw Error('操作過於頻繁');
        const response=fn(data||{});
        if(typeof ack==='function') ack({ok:true,...(response||{})});
      } catch(e) {
        if(typeof ack==='function') ack({ok:false,error:e.message || '操作失敗'});
      }
    });
  }
  io.on('connection',socket=>{
    handler(socket,'room:create',({nickname})=>{
      if (socket.data.roomCode) throw Error('請先離開原有房間');
      const {room,teacherToken}=newRoom();
      socket.data.roomCode=room.code;socket.data.kind='teacher';
      room.teacherSocket=socket.id;socket.join(channel(room.code));
      broadcast(room);
      return {code:room.code,token:teacherToken,role:'teacher'};
    });
    handler(socket,'room:join',({code,token,nickname})=>{
      code=sanitize(code,6).toUpperCase();
      const room=rooms.get(code);
      if(!room) throw Error('找不到房間代碼，或伺服器已重新啟動');
      if(socket.data.roomCode && socket.data.roomCode!==code) socket.leave(channel(socket.data.roomCode));
      const hashed=token && typeof token === 'string' && token.length < 200 ? hash(token) : '';
      if(hashed && hashed===room.teacherHash) {
        room.teacherSocket=socket.id;
        socket.data={roomCode:code,kind:'teacher',rate:socket.data.rate};
        socket.join(channel(code));broadcast(room);
        return {code,role:'teacher',token};
      }
      let member=room.members.find(m=>hashed && m.tokenHash===hashed);
      let freshToken=null;
      if(!member) {
        if(token) throw Error('原有身分憑證無效，不能替換他人身分');
        if(room.members.length>=2) throw Error('此房間已經有兩位學生');
        const nick=sanitize(nickname,18);
        if(nick.length<1) throw Error('請輸入暱稱');
        freshToken=newToken();
        member={slot:room.members.length,nick,tokenHash:hash(freshToken),socketId:null,
          errors:0,hints:0,edits:0,runs:0,messages:0,feedback:null};
        room.members.push(member);
      }
      member.socketId=socket.id;
      socket.data={roomCode:code,kind:'student',tokenHash:member.tokenHash,rate:socket.data.rate};
      socket.join(channel(code));broadcast(room);
      return {code,role:'student',token:freshToken || token,slot:member.slot};
    });
    handler(socket,'teacher:action',(data)=>{
      const room=rooms.get(socket.data.roomCode);
      const auth=check(socket,room);
      if(!auth.teacher) throw Error('只有具有房主憑證的老師可操作');
      const a=data.action;
      if(a==='config'){
        if(room.status==='active') throw Error('進行中的關卡不能修改設定，請先暫停並重新開始關卡');
        if(data.duration !== undefined) {
          if (!Number.isInteger(data.duration) || data.duration<2 || data.duration>20) throw Error('關卡時間設定為 2～20 分鐘');
          room.duration=data.duration;
        }
        if(data.difficulty!==undefined) {
          if(!['basic','advanced'].includes(data.difficulty)) throw Error('難度不合法');
          room.difficulty=data.difficulty;
        }
        if(room.status==='lobby') room.remainingMs=room.duration*60000;
      } else if(a==='start'){
        if(room.members.length!==2) throw Error('需要兩位學生加入才能開始');
        if(room.status!=='lobby') throw Error('遊戲已經開始');
        begin(room);
      } else if(a==='pause'){
        if(room.status!=='active') throw Error('目前不在倒數中');
        room.remainingMs=sleepClock(room);room.deadline=null;room.status='paused';
      } else if(a==='resume'){
        if(room.status!=='paused' || !room.puzzle) throw Error('目前沒有可恢復的關卡');
        room.deadline=Date.now()+room.remainingMs;room.status='active';
      } else if(a==='next' || a==='stage'){
        if(room.members.length!==2) throw Error('需要兩位學生');
        const next=a==='stage'?data.index:room.stageIndex+1;
        if(!Number.isInteger(next) || next<0 || next>=STAGES.length) throw Error('已到最後關卡，請進入挑戰實驗室');
        room.mode='mission';room.stageIndex=next;room.designerSpec=null;begin(room);
      } else if(a==='retry'){
        if(room.members.length!==2) throw Error('需要兩位學生');
        begin(room);
      } else if(a==='lab'){
        if(room.members.length!==2) throw Error('需要兩位學生');
        room.mode='lab';room.labRounds=0;room.designerSpec=null;begin(room);
      } else if(a==='labNext'){
        if(room.mode!=='lab') throw Error('尚未進入挑戰實驗室');
        room.labRounds++;room.designerSpec=null;begin(room);
      } else if(a==='reset'){
        room.mode='mission';room.stageIndex=0;room.status='lobby';room.puzzle=null;
        room.deadline=null;room.remainingMs=room.duration*60000;room.teamScore=0;
        room.history=[];room.labRounds=0;room.messages=[];room.lastResult=null;
        for(const m of room.members) Object.assign(m,{errors:0,hints:0,edits:0,runs:0,messages:0,feedback:null});
      } else throw Error('未知教師指令');
      broadcast(room);return {status:room.status};
    });
    handler(socket,'puzzle:edit',({blocks})=>{
      const {room,member,role}=playGuard(socket);
      if(role!=='operator') throw Error('只有拆彈操作員可修改指令');
      modify(room.puzzle,{blocks});
      room.revision++;room.approved=-1;member.edits++;
      room.lastResult=null;broadcast(room);return {revision:room.revision};
    });
    handler(socket,'analysis:approve',()=>{
      const {room,role}=playGuard(socket);
      if(role!=='analyst') throw Error('只有程式分析員能核准執行');
      room.approved=room.revision;
      broadcast(room);return {approved:true};
    });
    handler(socket,'analysis:message',({message})=>{
      const {room,role,member}=playGuard(socket);
      if(role!=='analyst') throw Error('只有程式分析員可以傳送分析指令');
      const txt=sanitize(message,100);
      if(!txt) throw Error('請輸入訊息');
      room.messages.push({from:member.nick,text:txt,time:Date.now()});
      member.messages++;broadcast(room);return {};
    });
    handler(socket,'puzzle:run',()=>{
      const {room,role,member}=playGuard(socket);
      if(role!=='operator') throw Error('只有拆彈操作員可以執行');
      if(room.approved!==room.revision) throw Error('需先請分析員檢查並核准目前版本');
      room.approved=-1;room.attempts++;member.runs++;
      const result=evaluate(room.puzzle);
      room.lastResult={...result,serial:++room.resultSerial};
      if(result.success) finish(room,true,result.reason);
      else {
        member.errors++;room.stability=Math.max(0,room.stability-18);
        room.stageScore=Math.max(-200,room.stageScore-35);
        room.remainingMs=Math.max(0,sleepClock(room)-15000);
        room.deadline=Date.now()+room.remainingMs;
        if(room.stability<=0 || room.remainingMs<=0) finish(room,false,'裝置穩定度歸零或時間用完');
      }
      broadcast(room);return {success:result.success,trace:result.trace};
    });
    handler(socket,'hint:request',()=>{
      const {room,member}=playGuard(socket);
      if(room.hintsLeft<=0) throw Error('本關提示已用完');
      const index=2-room.hintsLeft;
      const hints = {
        sequence:['指令是一行一行由上往下執行。','分析員掌握真正的訊號順序，請先向對方確認。'],
        condition:['AND 要兩項都成立；OR 只要其中一項成立。','請逐一比較每一筆測試資料的正確開鎖結果。'],
        loop:['每次循環開始時先檢查 i < limit。','從起點開始，列出 i 每次增加 step 的值。'],
        debug:['把問題拆成順序、判斷、迴圈三個部分。','觀察執行結果：紅色標記代表該區塊仍有 Bug。']
      };
      const textHint=room.mode==='lab' ? '請向設計者詢問自訂目標，再逐步測試。' : hints[stageName(room)][index];
      room.hintsLeft--;member.hints++;
      room.stageScore=Math.max(-200,room.stageScore-25);
      room.messages.push({from:'系統提示',text:textHint,time:Date.now()});
      broadcast(room);return {hint:textHint};
    });
    handler(socket,'lab:publish',({spec})=>{
      const room=rooms.get(socket.data.roomCode);
      const {member}=check(socket,room,true);
      if(room.mode!=='lab' || roleOf(room,member)!=='analyst') throw Error('只有目前的設計分析員能設計挑戰');
      if(!['won','failed'].includes(room.status) && !(room.status==='paused' && !room.puzzle)) throw Error('目前挑戰尚未結束；暫停中的任務不能被覆蓋');
      const clean=validateLabSpec(spec);
      begin(room,clean);
      broadcast(room);return {kind:clean.kind};
    });
    handler(socket,'feedback:submit',({rating,comment})=>{
      const room=rooms.get(socket.data.roomCode);
      const {member}=check(socket,room,true);
      if(!Number.isInteger(rating)||rating<1||rating>5) throw Error('請選擇 1～5 分');
      member.feedback={rating,comment:sanitize(comment,180)};
      broadcast(room);return {};
    });
    socket.on('disconnect',()=>{
      const room=rooms.get(socket.data.roomCode);
      if(!room) return;
      if(socket.data.kind==='teacher' && room.teacherSocket===socket.id) room.teacherSocket=null;
      const m=room.members.find(x=>x.socketId===socket.id);
      if(m)m.socketId=null;
      broadcast(room);
    });
  });
  const tick=setInterval(()=>{
    for(const [code,room] of rooms) {
      if(Date.now()-room.startedAt > 6*60*60*1000) {rooms.delete(code);continue;}
      if(room.status==='active' && sleepClock(room)<=0) {
        room.remainingMs=0;finish(room,false,'倒數結束，數位裝置進入安全重啟');broadcast(room);
      } else if(room.status==='active') io.to(channel(code)).emit('clock:tick',{remainingMs:sleepClock(room),serverTime:Date.now()});
    }
  },1000);
  tick.unref();
  return {
    app,io,httpServer,rooms,
    listen(port=0){return new Promise(resolve=>httpServer.listen(port,'0.0.0.0',()=>resolve(httpServer.address().port)));},
    async close(){clearInterval(tick);await new Promise(resolve=>io.close(resolve));}
  };
}
if(require.main===module) {
  const game=createGameServer();
  const port=Number(process.env.PORT)||3000;
  game.listen(port).then(()=>console.log('Defuse a Bomb listening on port '+port));
}
module.exports={createGameServer,rooms};
