'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {io:Client}=require('socket.io-client');
const {createGameServer,rooms}=require('../src/server');
const game=createGameServer(),connections=[],state=new WeakMap();
let url;
async function connect(){
  if(!url)url='http://127.0.0.1:'+await game.listen(0);
  const s=Client(url,{transports:['websocket'],reconnection:false});
  await new Promise((res,rej)=>{s.once('connect',res);s.once('connect_error',rej);});
  connections.push(s);
  s.on('room:snapshot',value=>state.set(s,value));
  return s;
}
const send=(s,event,data={})=>new Promise(resolve=>s.emit(event,data,resolve));
async function until(s,match){
  if(match(state.get(s)))return state.get(s);
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{s.off('room:snapshot',on);reject(Error('等待房間同步逾時'));},4000);
    function on(next){if(match(next)){clearTimeout(timeout);s.off('room:snapshot',on);resolve(next);}}
    s.on('room:snapshot',on);
  });
}
after(async()=>{connections.forEach(s=>s.disconnect());await game.close();});

test('教師＋1 位學生：教師能輪流補位且保留管理權限',async()=>{
  const t=await connect(),a=await connect();
  const {code}=await send(t,'room:create');
  assert.equal((await send(t,'teacher:action',{action:'start'})).ok,false);
  assert.equal((await send(a,'room:join',{code,nickname:'學生甲'})).ok,true);
  assert.equal((await send(t,'teacher:action',{action:'start'})).ok,true);
  const room=rooms.get(code);
  assert.deepEqual(room.assignment,{analystSlot:null,operatorSlot:0});
  const ts=await until(t,s=>s?.status==='active'&&s?.role==='analyst');
  const as=await until(a,s=>s?.status==='active'&&s?.role==='operator');
  assert.equal(ts.isTeacher,true);assert.equal(ts.teacherActor.role,'analyst');
  assert.equal(as.puzzle.objective,undefined,'操作員不能取得機密答案');
  assert.equal((await send(t,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false);
  assert.equal((await send(a,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await send(t,'analysis:approve')).ok,true);
  assert.equal((await send(a,'puzzle:run')).success,true);
  assert.equal((await send(t,'teacher:action',{action:'next'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:0,operatorSlot:null});
  const nextTeacher=await until(t,s=>s?.stageIndex===1&&s?.role==='operator');
  const nextStudent=await until(a,s=>s?.stageIndex===1&&s?.role==='analyst');
  assert.equal(nextTeacher.isTeacher,true);
  assert.equal(nextTeacher.puzzle.objective,undefined);
  assert.ok(nextStudent.puzzle.briefing);
  assert.equal((await send(a,'puzzle:edit',{blocks:room.puzzle.answer})).ok,false);
  assert.equal((await send(t,'puzzle:edit',{blocks:{...room.puzzle.answer}})).ok,true);
  assert.equal((await send(a,'analysis:approve')).ok,true);
  assert.equal((await send(t,'puzzle:run')).success,true);
  assert.equal(room.teacherPlayer.runs,1);
  assert.equal((await send(t,'teacher:action',{action:'reset'})).ok,true);
  assert.equal(room.assignment,null);
});

test('教師＋2 位學生：保留互換；後加入者只能下一關輪換',async()=>{
  const t=await connect(),a=await connect(),b=await connect(),c=await connect(),fourth=await connect();
  const {code}=await send(t,'room:create');
  const tokenA=(await send(a,'room:join',{code,nickname:'甲'})).token;
  assert.equal((await send(b,'room:join',{code,nickname:'乙'})).ok,true);
  assert.equal((await send(t,'teacher:action',{action:'start'})).ok,true);
  const room=rooms.get(code);
  assert.deepEqual(room.assignment,{analystSlot:0,operatorSlot:1});
  assert.equal((await send(t,'analysis:approve')).ok,false);
  assert.equal((await send(t,'puzzle:run')).ok,false);
  assert.equal((await send(c,'room:join',{code,nickname:'丙'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:0,operatorSlot:1},'中途加入不應更換現有角色');
  const observer=await until(c,s=>s?.role==='observer'&&s?.status==='active');
  assert.equal(observer.puzzle.objective,undefined);
  assert.equal((await send(c,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false);
  assert.equal((await send(c,'analysis:approve')).ok,false);
  assert.equal((await send(c,'analysis:message',{message:'請核對積木順序'})).ok,true);
  assert.equal((await send(fourth,'room:join',{code,nickname:'丁'})).ok,false);
  assert.equal((await send(t,'teacher:action',{action:'next'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:1,operatorSlot:2});
  assert.equal((await send(t,'teacher:action',{action:'next'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:2,operatorSlot:0});
  a.disconnect();
  const reconnect=await connect();
  assert.equal((await send(reconnect,'room:join',{code,token:tokenA})).ok,true);
  assert.equal((await until(reconnect,s=>s?.stageIndex===2)).role,'operator');
});

test('教師＋3 位學生：每關分析／操作／情報支援三角輪換',async()=>{
  const t=await connect(),players=[await connect(),await connect(),await connect()];
  const {code}=await send(t,'room:create');
  for(let i=0;i<3;i++)assert.equal((await send(players[i],'room:join',{code,nickname:'學生'+i})).ok,true);
  const room=rooms.get(code);
  assert.equal((await send(t,'teacher:action',{action:'start'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:0,operatorSlot:1});
  await Promise.all(players.map((p,i)=>until(p,s=>s?.role===['analyst','operator','observer'][i]&&s?.status==='active')));
  assert.equal((await send(t,'teacher:action',{action:'stage',index:1})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:1,operatorSlot:2});
  await Promise.all(players.map((p,i)=>until(p,s=>s?.role===['observer','analyst','operator'][i]&&s?.stageIndex===1)));
  assert.equal((await send(t,'teacher:action',{action:'stage',index:2})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:2,operatorSlot:0});
  await Promise.all(players.map((p,i)=>until(p,s=>s?.role===['operator','observer','analyst'][i]&&s?.stageIndex===2)));
  assert.equal((await send(t,'teacher:action',{action:'pause'})).ok,true);
  assert.equal((await send(t,'teacher:action',{action:'resume'})).ok,true);
});
