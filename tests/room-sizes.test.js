'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {io:Client}=require('socket.io-client');
const {createGameServer,rooms}=require('../src/server');
const game=createGameServer();
const connections=[];
let base;
async function connect(){
  if(!base)base='http://127.0.0.1:'+await game.listen(0);
  const socket=Client(base,{transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{
    socket.once('connect',resolve);socket.once('connect_error',reject);
  });
  connections.push(socket);
  return socket;
}
const send=(socket,event,data={})=>new Promise(resolve=>socket.emit(event,data,resolve));
function waitForState(socket,read,condition){
  const current=read();
  if(current&&condition(current))return Promise.resolve(current);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('room:snapshot',on);reject(new Error('Room snapshot did not reach expected role/stage'));},3000);
    function on(state){
      if(condition(state)){clearTimeout(timer);socket.off('room:snapshot',on);resolve(state);}
    }
    socket.on('room:snapshot',on);
  });
}
after(async()=>{
  connections.forEach(socket=>socket.disconnect());
  await game.close();
});

test('老師＋一位學生：一樣能開局，老師補位並在下一關換角',async()=>{
  const teacher=await connect(),student=await connect();
  let teacherSnapshot,studentSnapshot;
  teacher.on('room:snapshot',state=>teacherSnapshot=state);
  student.on('room:snapshot',state=>studentSnapshot=state);
  const creation=await send(teacher,'room:create');
  const code=creation.code;
  assert.equal(creation.ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,false,
    '只有老師一人時不可以開始');
  const joined=await send(student,'room:join',{code,nickname:'唯一學員'});
  assert.equal(joined.ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
  await Promise.all([
    waitForState(teacher,()=>teacherSnapshot,x=>x.status==='active'&&x.role==='analyst'&&Boolean(x.puzzle)),
    waitForState(student,()=>studentSnapshot,x=>x.status==='active'&&x.role==='operator'&&Boolean(x.puzzle))
  ]);
  assert.equal(teacherSnapshot.isTeacher,true);
  assert.equal(teacherSnapshot.role,'analyst');
  assert.equal(studentSnapshot.role,'operator');
  assert.equal(studentSnapshot.puzzle.objective,undefined,'操作員不能收到機密目標');
  assert.equal(teacherSnapshot.teacherActor.role,'analyst');
  assert.equal(teacherSnapshot.connectedStudents,1);
  assert.equal((await send(student,'teacher:action',{action:'next'})).ok,false);
  assert.equal((await send(teacher,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false,
    '教師分析員不可越權修改操作員積木');
  assert.equal((await send(student,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await send(teacher,'analysis:approve')).ok,true);
  const stage1=await send(student,'puzzle:run');
  assert.equal(stage1.success,true,JSON.stringify(stage1));
  assert.equal((await send(teacher,'teacher:action',{action:'next'})).ok,true);
  await Promise.all([
    waitForState(teacher,()=>teacherSnapshot,x=>x.stageIndex===1&&x.role==='operator'&&Boolean(x.puzzle)),
    waitForState(student,()=>studentSnapshot,x=>x.stageIndex===1&&x.role==='analyst'&&Boolean(x.puzzle))
  ]);
  assert.equal(studentSnapshot.role,'analyst');
  assert.equal(teacherSnapshot.role,'operator');
  assert.equal(teacherSnapshot.isTeacher,true);
  assert.equal(teacherSnapshot.puzzle.briefing,undefined,'教師補位操作員不應看到機密規則');
  assert.equal(studentSnapshot.puzzle.briefing.title.includes('條件'),true);
  assert.equal((await send(student,'puzzle:edit',{blocks:rooms.get(code).puzzle.answer})).ok,false,
    '學生分析員不能替教師操作');
  assert.equal((await send(teacher,'puzzle:edit',{blocks:{...rooms.get(code).puzzle.answer}})).ok,true);
  assert.equal((await send(student,'analysis:approve')).ok,true);
  const stage2=await send(teacher,'puzzle:run');
  assert.equal(stage2.success,true,JSON.stringify(stage2));
  assert.equal(teacherSnapshot.teacherActor.runs,1);
  assert.equal((await send(teacher,'teacher:action',{action:'lab'})).ok,true,
    '教師兼任遊戲角色仍持有房主控制權');
  await waitForState(teacher,()=>teacherSnapshot,x=>x.mode==='lab'&&x.status==='paused');
  assert.equal(teacherSnapshot.role,'operator','實驗室起始回合沿用角色輪替');
});

test('老師＋兩位學生：舊版非對稱玩法維持，老師僅監控',async()=>{
  const t=await connect(),a=await connect(),b=await connect();
  const code=(await send(t,'room:create')).code;
  let teacherState,first,second;
  t.on('room:snapshot',state=>teacherState=state);
  a.on('room:snapshot',state=>first=state);
  b.on('room:snapshot',state=>second=state);
  assert.equal((await send(a,'room:join',{code,nickname:'A'})).ok,true);
  assert.equal((await send(b,'room:join',{code,nickname:'B'})).ok,true);
  assert.equal((await send(t,'teacher:action',{action:'start'})).ok,true);
  await Promise.all([
    waitForState(t,()=>teacherState,x=>x.status==='active'&&x.role==='teacher'),
    waitForState(a,()=>first,x=>x.status==='active'&&x.role==='analyst'),
    waitForState(b,()=>second,x=>x.status==='active'&&x.role==='operator')
  ]);
  assert.equal(teacherState.role,'teacher');
  assert.equal(teacherState.teacherActor,null);
  assert.equal(first.role,'analyst');
  assert.equal(second.role,'operator');
  assert.equal((await send(t,'analysis:approve')).ok,false);
  assert.equal((await send(t,'puzzle:run')).ok,false);
  assert.equal((await send(a,'analysis:approve')).ok,true);
  assert.equal((await send(b,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await send(a,'analysis:approve')).ok,true);
  assert.equal((await send(b,'puzzle:run')).success,true);
  assert.equal((await send(t,'teacher:action',{action:'next'})).ok,true);
  await Promise.all([
    waitForState(a,()=>first,x=>x.stageIndex===1&&x.role==='operator'),
    waitForState(b,()=>second,x=>x.stageIndex===1&&x.role==='analyst')
  ]);
  assert.equal(first.role,'operator');
  assert.equal(second.role,'analyst');
});

test('老師＋三位學生：三角輪換；情報支援員只能觀察與傳訊',async()=>{
  const teacher=await connect();
  const players=[await connect(),await connect(),await connect()];
  const outsider=await connect();
  const code=(await send(teacher,'room:create')).code;
  const state=[];
  for(let i=0;i<3;i++){
    players[i].on('room:snapshot',data=>state[i]=data);
    assert.equal((await send(players[i],'room:join',{code,nickname:'學員'+(i+1)})).ok,true);
  }
  assert.equal((await send(outsider,'room:join',{code,nickname:'學員4'})).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
  await Promise.all(players.map((p,i)=>waitForState(p,()=>state[i],
    x=>x.status==='active'&&x.role===['analyst','operator','observer'][i])));
  assert.deepEqual(state.map(s=>s.role),['analyst','operator','observer']);
  assert.equal(state[2].puzzle.objective,undefined);
  assert.equal(state[2].puzzle.briefing,undefined);
  assert.equal((await send(players[2],'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false);
  assert.equal((await send(players[2],'analysis:approve')).ok,false);
  assert.equal((await send(players[2],'puzzle:run')).ok,false);
  assert.equal((await send(players[2],'analysis:message',{message:'可以再看一下 Python 的順序！'})).ok,true);
  assert.match(state[0].messages.at(-1).from,/支援/);
  assert.equal((await send(players[1],'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await send(players[0],'analysis:approve')).ok,true);
  assert.equal((await send(players[1],'puzzle:run')).success,true);
  assert.equal((await send(teacher,'teacher:action',{action:'next'})).ok,true);
  await Promise.all(players.map((p,i)=>waitForState(p,()=>state[i],
    x=>x.stageIndex===1&&x.role===['observer','analyst','operator'][i])));
  assert.deepEqual(state.map(s=>s.role),['observer','analyst','operator']);
  const target=rooms.get(code).puzzle.answer;
  assert.equal((await send(players[2],'puzzle:edit',{blocks:{...target}})).ok,true);
  assert.equal((await send(players[1],'analysis:approve')).ok,true);
  assert.equal((await send(players[2],'puzzle:run')).success,true);
  assert.equal((await send(teacher,'teacher:action',{action:'next'})).ok,true);
  await Promise.all(players.map((p,i)=>waitForState(p,()=>state[i],
    x=>x.stageIndex===2&&x.role===['operator','observer','analyst'][i])));
  assert.deepEqual(state.map(s=>s.role),['operator','observer','analyst']);
  assert.equal((await send(players[1],'puzzle:edit',{blocks:{}})).ok,false);
  assert.equal((await send(players[1],'analysis:approve')).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'pause'})).ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'resume'})).ok,true);
});

test('正在進行時第三人加入只能旁觀；下一回合才重新分配',async()=>{
  const teacher=await connect(),a=await connect(),b=await connect();
  const code=(await send(teacher,'room:create')).code;
  let studentA,studentB,teacherState;
  a.on('room:snapshot',state=>studentA=state);
  b.on('room:snapshot',state=>studentB=state);
  teacher.on('room:snapshot',state=>teacherState=state);
  const tokenA=(await send(a,'room:join',{code,nickname:'先行者'})).token;
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
  await Promise.all([
    waitForState(a,()=>studentA,x=>x.status==='active'&&x.role==='operator'),
    waitForState(teacher,()=>teacherState,x=>x.status==='active'&&x.role==='analyst')
  ]);
  assert.equal(studentA.role,'operator');
  assert.equal(teacherState.role,'analyst');
  assert.equal((await send(b,'room:join',{code,nickname:'中途加入者'})).ok,true);
  await waitForState(b,()=>studentB,x=>x.role==='observer'&&x.status==='active');
  assert.equal(studentB.role,'observer');
  assert.equal(studentA.role,'operator','第三人加入不應使正在進行的學生突然變成分析員');
  assert.equal(teacherState.role,'analyst');
  assert.equal((await send(teacher,'analysis:approve')).ok,true);
  assert.equal((await send(a,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await send(teacher,'analysis:approve')).ok,true);
  assert.equal((await send(a,'puzzle:run')).success,true);
  assert.equal((await send(teacher,'teacher:action',{action:'next'})).ok,true);
  await Promise.all([
    waitForState(teacher,()=>teacherState,x=>x.stageIndex===1&&x.role==='teacher'),
    waitForState(a,()=>studentA,x=>x.stageIndex===1&&x.role==='operator'),
    waitForState(b,()=>studentB,x=>x.stageIndex===1&&x.role==='analyst')
  ]);
  assert.equal(teacherState.role,'teacher');
  assert.equal(studentA.role,'operator');
  assert.equal(studentB.role,'analyst');
  a.disconnect();
  const reconnect=await connect();
  let rejoinedSnapshot;
  reconnect.on('room:snapshot',state=>rejoinedSnapshot=state);
  assert.equal((await send(reconnect,'room:join',{code,token:tokenA})).ok,true);
  assert.equal(rejoinedSnapshot.role,'operator','短暫斷線再加入不可以奪走別人的角色');
});
