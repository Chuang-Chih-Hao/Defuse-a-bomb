'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {io:Client}=require('socket.io-client');
const {createGameServer,rooms}=require('../src/server');
const game=createGameServer();
const clients=[];
let url;
async function joinSocket(){
  if(!url)url='http://127.0.0.1:'+await game.listen(0);
  const s=Client(url,{reconnection:false,transports:['websocket']});
  await new Promise((resolve,reject)=>{
    s.once('connect',resolve);s.once('connect_error',reject);
  });
  clients.push(s);return s;
}
const emit=(socket,name,data={})=>new Promise(resolve=>socket.emit(name,data,resolve));
after(async()=>{clients.forEach(s=>s.disconnect());await game.close();});

test('老師＋一名學生即可開始；老師兼分析員並能核准、傳送訊息與設計挑戰',async()=>{
  const teacher=await joinSocket(),student=await joinSocket(),outsider=await joinSocket();
  const created=await emit(teacher,'room:create');
  assert.equal(created.ok,true);
  const code=created.code;
  assert.equal((await emit(teacher,'teacher:action',{action:'start'})).ok,false,'0 位學生仍不能開始');
  const joined=await emit(student,'room:join',{code,nickname:'學生甲'});
  assert.equal(joined.ok,true);
  assert.equal((await emit(teacher,'teacher:action',{action:'start'})).ok,true);
  let room=rooms.get(code);
  assert.deepEqual(room.assignment,{analystSlot:null,operatorSlot:0});
  assert.equal((await emit(student,'analysis:approve')).ok,false);
  assert.equal((await emit(teacher,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false);
  assert.equal((await emit(student,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await emit(teacher,'analysis:message',{message:'順序是藍紅綠'})).ok,true);
  assert.equal((await emit(teacher,'analysis:approve')).ok,true);
  assert.equal((await emit(student,'puzzle:run')).success,true);
  assert.equal(room.status,'won');
  assert.equal((await emit(teacher,'teacher:action',{action:'lab'})).ok,true);
  assert.equal(room.status,'paused');
  const publish=await emit(teacher,'lab:publish',{spec:{kind:'loop',target:6}});
  assert.equal(publish.ok,true,JSON.stringify(publish));
  assert.equal(room.status,'active');
  assert.equal((await emit(outsider,'room:join',{code,token:'invalid-token'})).ok,false);
});

test('老師房間可容納三位學生；中途加入不插隊；下一關三角色輪換且第四位被阻擋',async()=>{
  const t=await joinSocket(),a=await joinSocket(),b=await joinSocket(),c=await joinSocket(),fourth=await joinSocket();
  const created=await emit(t,'room:create');
  const code=created.code;
  const aToken=(await emit(a,'room:join',{code,nickname:'甲'})).token;
  assert.ok(aToken);
  assert.equal((await emit(t,'teacher:action',{action:'start'})).ok,true);
  const room=rooms.get(code);
  assert.deepEqual(room.assignment,{analystSlot:null,operatorSlot:0});
  assert.equal((await emit(b,'room:join',{code,nickname:'乙'})).ok,true);
  assert.equal(room.members.length,2);
  assert.deepEqual(room.assignment,{analystSlot:null,operatorSlot:0},'一關進行中角色不能突然改變');
  assert.equal((await emit(b,'analysis:approve')).ok,false,'中途加入的乙只能觀察');
  assert.equal((await emit(b,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false);
  assert.equal((await emit(a,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await emit(t,'analysis:approve')).ok,true);
  assert.equal((await emit(a,'puzzle:run')).success,true);

  assert.equal((await emit(t,'teacher:action',{action:'next'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:1,operatorSlot:0},'兩名學生的第二關由乙分析、甲操作');
  assert.equal((await emit(t,'analysis:approve')).ok,false,'已有學生分析員時老師不應接管核准');
  assert.equal((await emit(c,'room:join',{code,nickname:'丙'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:1,operatorSlot:0},'第三人加入不能奪走目前角色');
  assert.equal((await emit(c,'analysis:approve')).ok,false);
  assert.equal((await emit(c,'puzzle:edit',{blocks:{}})).ok,false);
  assert.equal((await emit(fourth,'room:join',{code,nickname:'丁'})).ok,false,'最多三名學生');

  // 由老師指定下一關時，三名學生按輪次 A/B/C 循環任職。
  assert.equal((await emit(t,'teacher:action',{action:'stage',index:2})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:2,operatorSlot:0});
  assert.equal((await emit(b,'analysis:approve')).ok,false,'上一關分析員現在為觀察員');
  assert.equal((await emit(c,'analysis:approve')).ok,true);
  assert.equal((await emit(a,'puzzle:edit',{blocks:{start:0,limit:4,step:1}})).ok,true);
  assert.equal((await emit(c,'analysis:approve')).ok,true);
  assert.equal((await emit(a,'puzzle:run')).success,true);
  assert.equal((await emit(t,'teacher:action',{action:'next'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:0,operatorSlot:1});
  assert.equal((await emit(t,'teacher:action',{action:'next'})).ok,true);
  assert.deepEqual(room.assignment,{analystSlot:1,operatorSlot:2});

  a.disconnect();
  const rejoined=await joinSocket();
  assert.equal((await emit(rejoined,'room:join',{code,token:aToken})).ok,true);
  assert.equal(room.members.length,3);
  assert.deepEqual(room.assignment,{analystSlot:1,operatorSlot:2});
  assert.equal((await emit(rejoined,'teacher:action',{action:'reset'})).ok,false);
});
