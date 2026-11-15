const {test,after} = require('node:test');
const assert=require('node:assert/strict');
const {io:Client}=require('socket.io-client');
const {createGameServer}=require('../src/server');
const game=createGameServer();
const clients=[];
let address;
const send=(socket,event,data={})=>new Promise(resolve=>socket.emit(event,data,resolve));
async function connect(){
  if(!address)address='http://127.0.0.1:'+await game.listen(0);
  const s=Client(address,{reconnection:false,transports:['websocket']});
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
  clients.push(s);return s;
}
after(async()=>{clients.forEach(s=>s.disconnect());await game.close();});
test('teacher authentication, room membership, role isolation, full stage lifecycle, reconnect',async()=>{
  const teacher=await connect(),a=await connect(),b=await connect();
  const c=await send(teacher,'room:create',{});
  assert.equal(c.ok,true);
  const code=c.code;
  let r=await send(a,'room:join',{code,nickname:'分析員'});
  assert.equal(r.ok,true);const tokenA=r.token;
  r=await send(b,'room:join',{code,nickname:'操作員'});assert.equal(r.ok,true);
  assert.equal((await send(a,'teacher:action',{action:'pause'})).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
  assert.equal((await send(a,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,false);
  assert.equal((await send(b,'puzzle:run')).ok,false);
  assert.equal((await send(a,'analysis:approve')).ok,true);
  assert.equal((await send(b,'puzzle:edit',{blocks:['BLUE','RED','GREEN']})).ok,true);
  assert.equal((await send(b,'puzzle:run')).ok,false);
  assert.equal((await send(a,'analysis:approve')).ok,true);
  r=await send(b,'puzzle:run');assert.equal(r.success,true);
  assert.equal((await send(teacher,'teacher:action',{action:'next'})).ok,true);
  // In stage 2, player A becomes the operator.
  assert.equal((await send(b,'puzzle:edit',{blocks:{}})).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'pause'})).ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'resume'})).ok,true);
  a.disconnect();
  const nextA=await connect();
  assert.equal((await send(nextA,'room:join',{code,token:tokenA})).ok,true);
  assert.equal((await send(nextA,'teacher:action',{action:'reset'})).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'lab'})).ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'labNext'})).ok,true);
  // stage 2 index=1 + labRounds=1 => analyst A again.
  assert.equal((await send(nextA,'lab:publish',{spec:{kind:'loop',target:7}})).ok,true);
  assert.equal((await send(b,'puzzle:run')).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'reset'})).ok,true);
});
test('health endpoint reports 200 and JSON',async()=>{
  const response=await fetch(address+'/health');assert.equal(response.status,200);
  assert.equal((await response.json()).ok,true);
});
