'use strict';
// Regression: Scratch lists are 1-based, Python lists 0-based, and swapping has no direction.
// The correct solution is the resulting state, not a remembered first/second field order.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {makePuzzle,modify,evaluate,objective,toPython,visiblePuzzle,variants}=require('../src/engine');
const {createGameServer,rooms}=require('../src/server');
const {io:Client}=require('socket.io-client');

test('all ten unordered swaps are distinct, clearly explained, and reversible',()=>{
  const seen=new Set();
  for(let variant=0;variant<variants('array');variant++){
    const p=makePuzzle('array',false,null,variant);
    const {first,second}=p.answer;
    assert.ok(first>=1&&second<=5&&first<second);
    const unordered=[first,second].join('-');
    assert.equal(seen.has(unordered),false,'duplicate swap: '+unordered);
    seen.add(unordered);
    const task=objective(p);
    assert.match(task,/交換前：/);
    assert.match(task,/交換後應為：/);
    assert.match(task,/Scratch/);
    assert.match(task,/Python/);
    assert.ok(p.initial.length===5);
    assert.equal(new Set(p.initial).size,5);
    const expected=p.initial.slice();
    [expected[first-1],expected[second-1]]=[expected[second-1],expected[first-1]];
    for(let i=0;i<5;i++){
      assert.match(task,new RegExp((i+1)+'='+({RED:'紅',BLUE:'藍',GREEN:'綠',YELLOW:'黃',PURPLE:'紫'})[expected[i]]+'色'));
    }
    assert.equal(visiblePuzzle(p,false).objective,undefined);
    assert.equal(visiblePuzzle(p,false).briefing,undefined);

    // Reverse order is an equally valid answer and must receive the same grade.
    modify(p,{blocks:{first:second,second:first}});
    assert.equal(evaluate(p).success,true,'reverse order incorrectly rejected for '+unordered);
    assert.match(toPython(p),new RegExp('chips\\['+(second-1)+'\\], chips\\['+(first-1)+'\\]'));
    modify(p,{blocks:{first,second}});
    assert.equal(evaluate(p).success,true);
    // The same slot is not a swap.
    modify(p,{blocks:{first,second:first}});
    assert.equal(evaluate(p).success,false);
    modify(p,{blocks:{first:0,second}});
    assert.equal(evaluate(p).success,false);
    assert.match(toPython(p),/raise IndexError/);
    modify(p,{blocks:{first:6,second}});
    assert.equal(evaluate(p).success,false);
    assert.match(toPython(p),/raise IndexError/);
    const wrong=[1,2,3,4,5].filter(x=>x!==first&&x!==second)[0];
    modify(p,{blocks:{first,second:wrong}});
    assert.equal(evaluate(p).success,false);
  }
  assert.equal(seen.size,10);
});

const server=createGameServer();
const connections=[];
let address;
async function connect(){
  if(!address)address='http://127.0.0.1:'+await server.listen(0);
  const s=Client(address,{reconnection:false,transports:['websocket']});
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
  connections.push(s);return s;
}
const send=(s,event,data={})=>new Promise(resolve=>s.emit(event,data,resolve));
after(async()=>{connections.forEach(s=>s.disconnect());await server.close();});
test('different new rooms do not always start with the memorized canonical answer',async()=>{
  const starts=[];
  for(let i=0;i<12;i++){
    const teacher=await connect(),student=await connect();
    const {code}=await send(teacher,'room:create');
    assert.equal((await send(student,'room:join',{code,nickname:'學員'+i})).ok,true);
    assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
    const room=rooms.get(code);
    assert.equal(room.questionNumber,1);
    assert.equal(room.puzzle.kind,'sequence');
    starts.push(room.puzzle.target.join('/'));
  }
  assert.ok(new Set(starts).size>1,'all new rooms repeated the exact same starting puzzle');
  for(let i=1;i<starts.length;i++)
    assert.notEqual(starts[i],starts[i-1],'consecutive room openings repeated the same answer');
});
