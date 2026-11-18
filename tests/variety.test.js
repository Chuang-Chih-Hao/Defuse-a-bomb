'use strict';
// v1.4.0：驗證七類題型的重抽不重複、可解、權限隔離。
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {io:Client}=require('socket.io-client');
const {createGameServer,rooms}=require('../src/server');
const {STAGES,variants,makePuzzle,objective,modify,evaluate,visiblePuzzle,targetPython}=require('../src/engine');
const game=createGameServer(),clients=[];
let url;
async function connect(){
  if(!url)url='http://127.0.0.1:'+await game.listen(0);
  const s=Client(url,{transports:['websocket'],reconnection:false});
  await new Promise((ok,fail)=>{s.once('connect',ok);s.once('connect_error',fail);});
  clients.push(s);return s;
}
const send=(s,action,data={})=>new Promise(resolve=>s.emit(action,data,resolve));
after(async()=>{clients.forEach(s=>s.disconnect());await game.close();});
function correctBlocks(p){
  switch(p.kind){
    case 'sequence':return p.target.slice();
    case 'condition':return {...p.answer};
    case 'loop':return {start:0,limit:p.target,step:1};
    case 'debug':return {...p.blocks,order:p.target.slice(),color:p.expectedColor,
      mode:p.expectedMode,threshold:p.expectedThreshold,start:0,limit:p.expectedLimit,step:1};
    case 'variables':return {...p.answer};
    case 'array':return {...p.answer};
    case 'function':return {body:p.target.slice(),mainMode:'call'};
    default:throw Error('not recognized '+p.kind);
  }
}
for(const advanced of [false,true]){
  test('七關 '+(advanced?'進階':'基礎')+' 模式題庫：不同版本有不同目標且皆可解',()=>{
    for(const stage of STAGES){
      const total=variants(stage);
      const goals=new Set();
      for(let variant=0;variant<total;variant++){
        const puzzle=makePuzzle(stage,advanced,null,variant);
        const question=objective(puzzle);
        assert.ok(!goals.has(question),'重複題型 '+stage+' 版本 '+variant+': '+question);
        goals.add(question);
        // 操作員不應取得解題規則、目標 Python 或正確答案。
        const student=visiblePuzzle(puzzle,false);
        assert.equal(student.briefing,undefined);
        assert.equal(student.objective,undefined);
        assert.equal(student.answer,undefined);
        assert.ok(student.python);
        assert.ok(targetPython(puzzle));
        modify(puzzle,{blocks:correctBlocks(puzzle)});
        assert.equal(evaluate(puzzle).success,true,
          '無法用提供的積木通關 '+stage+' variant '+variant+' '+question);
      }
      assert.equal(goals.size,total);
    }
  });
}
test('相同房間重試與指定同類型關卡：題目不會連續重複',async()=>{
  const teacher=await connect(),student=await connect();
  const {code}=await send(teacher,'room:create');
  assert.equal((await send(student,'room:join',{code,nickname:'解題學員'})).ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
  const room=rooms.get(code);
  const questions=new Set();
  for(let n=1;n<=18;n++){
    assert.equal(room.questionNumber,n);
    const q=objective(room.puzzle);
    assert.equal(questions.has(q),false,'第 '+n+' 題重複：'+q);
    questions.add(q);
    assert.equal(room.variantHistory['sequence:basic'].length,n);
    if(n<18)assert.equal((await send(teacher,'teacher:action',{action:'retry'})).ok,true);
  }
  // 重設整場不清除同房間的出題紀錄，避免剛重設又看到完全相同的題目。
  assert.equal((await send(teacher,'teacher:action',{action:'reset'})).ok,true);
  assert.equal((await send(teacher,'teacher:action',{action:'start'})).ok,true);
  assert.equal(room.questionNumber,19);
  assert.equal(questions.has(objective(room.puzzle)),false);
  assert.equal((await send(teacher,'teacher:action',{action:'stage',index:2})).ok,true);
  const first=objective(room.puzzle);
  assert.equal((await send(teacher,'teacher:action',{action:'retry'})).ok,true);
  assert.notEqual(objective(room.puzzle),first,'迴圈題目重試須改變實際執行目標');
  assert.equal(room.questionNumber,2);
});
