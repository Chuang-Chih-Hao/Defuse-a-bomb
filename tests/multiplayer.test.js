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
  assert.equal((await send(teacher,'teacher:action',{action:'pause'})).ok,true);
  assert.equal((await send(nextA,'lab:publish',{spec:{kind:'condition',color:'YELLOW',threshold:80,mode:'OR'}})).ok,false,'Paused active puzzles must not be overwritten');
  assert.equal((await send(teacher,'teacher:action',{action:'resume'})).ok,true);
  assert.equal((await send(b,'puzzle:run')).ok,false);
  assert.equal((await send(teacher,'teacher:action',{action:'reset'})).ok,true);
});

test('failed attempts, hints, retry, feedback, and restricted teacher controls',async()=>{
  const t=await connect(),a=await connect(),b=await connect(),outsider=await connect(),extra=await connect();
  const created=await send(t,'room:create');
  assert.equal(created.ok,true);
  const code=created.code;
  let latest;
  a.on('room:snapshot',s=>latest=s);
  const untilStatus=async(expected)=>{
    if(latest?.status===expected)return;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{a.off('room:snapshot',on);reject(new Error('Timed out waiting for '+expected));},2000);
      function on(update){
        if(update.status===expected){clearTimeout(timeout);a.off('room:snapshot',on);resolve();}
      }
      a.on('room:snapshot',on);
    });
  };
  const first=await send(a,'room:join',{code,nickname:'偵測員'});
  const second=await send(b,'room:join',{code,nickname:'執行員'});
  assert.equal(first.ok,true);assert.equal(second.ok,true);
  assert.equal((await send(outsider,'room:join',{code,nickname:'第三位'})).ok,true);
  assert.equal((await send(extra,'room:join',{code,nickname:'第四位'})).ok,false);
  assert.equal((await send(outsider,'room:join',{code,token:'invalid-token'})).ok,false);
  assert.equal((await send(a,'teacher:action',{action:'start'})).ok,false);
  assert.equal((await send(t,'teacher:action',{action:'config',difficulty:'advanced',duration:2})).ok,true);
  assert.equal((await send(t,'teacher:action',{action:'start'})).ok,true);
  assert.equal((await send(t,'teacher:action',{action:'config',duration:10})).ok,false);
  assert.equal((await send(a,'hint:request')).ok,true);
  assert.equal((await send(b,'hint:request')).ok,true);
  assert.equal((await send(a,'hint:request')).ok,false);
  assert.equal(latest.hintsLeft,0);
  assert.equal((await send(b,'feedback:submit',{rating:5,comment:'學會了逐步測試'})).ok,true);
  assert.equal((await send(a,'feedback:submit',{rating:0,comment:'invalid'})).ok,false);
  assert.equal((await send(a,'puzzle:run')).ok,false);
  for(let i=0;i<6;i++){
    assert.equal((await send(a,'analysis:approve')).ok,true);
    const response=await send(b,'puzzle:run');
    assert.equal(response.ok,true);
    assert.equal(response.success,false);
  }
  assert.equal(latest.status,'failed');
  assert.equal(latest.stability,0);
  assert.equal(latest.members[1].errors,6);
  assert.equal(latest.members[1].feedback.rating,5);
  assert.equal((await send(t,'teacher:action',{action:'retry'})).ok,true);
  await untilStatus('active');
  assert.equal(latest.status,'active');
  assert.equal(latest.stability,100);
  assert.equal(latest.hintsLeft,2);
  assert.equal((await send(t,'teacher:action',{action:'reset'})).ok,true);
  await untilStatus('lobby');
  assert.equal(latest.status,'lobby');
  assert.equal(latest.history.length,0);
});

test('health endpoint reports 200 and JSON',async()=>{
  const response=await fetch(address+'/health');assert.equal(response.status,200);
  assert.equal((await response.json()).ok,true);
});
