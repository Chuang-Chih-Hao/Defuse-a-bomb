'use strict';

// 進階關卡採用受限指令模型，不呼叫 eval、Function 或外部 Python。
// 分析員持有規則，操作員只收到起始狀態與可修改的積木。
// 每一步由伺服器產生「監視器快照」，三個瀏覽器同步觀察。
const EXTENDED = ['variables', 'array', 'function'];
const EXTENDED_TITLES = {
  variables: '能量分配站 · 變數運算',
  array: '晶片陣列鎖 · 清單索引',
  function: '緊急冷卻協議 · 自訂函式'
};
const CHIPS = ['RED', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE'];
const COOL = ['PURGE','VENT','SYNC','LOCK'];
const stepNames = {PURGE:'清除快取',VENT:'開啟散熱',SYNC:'同步能源',LOCK:'鎖定模組'};
const choose = (n,random)=>Math.floor(random()*n);

function make(stage,advanced=false,random=Math.random) {
  if(stage==='variables'){
    return {
      kind:'variables', label:'能源槽運算終端', advanced,
      initial:{A:choose(5,random)+2,B:choose(5,random)+2,C:0},
      answer:{source:advanced?'B':'A',factor:advanced?3:2,divisor:advanced?2:1,modulo:5},
      blocks:{source:advanced?'A':'B',factor:1,divisor:1,modulo:4},
      scenarios:[]
    };
  }
  if(stage==='array'){
    const rotation=choose(5,random);
    const initial=CHIPS.map((_,i)=>CHIPS[(i+rotation)%5]);
    return {
      kind:'array', label:'五色晶片陣列', advanced, initial,
      answer:{first:advanced?2:1,second:advanced?4:5},
      blocks:{first:2,second:3}, scenarios:[]
    };
  }
  if(stage==='function'){
    return {
      kind:'function',label:'冷卻程序重構',advanced,
      target:COOL.slice(), maxBlocks:6,
      blocks:{body:['SYNC','PURGE','VENT','LOCK'],mainMode:'direct'},
      scenarios:[]
    };
  }
  throw Error('未知擴充關卡');
}
function validInt(x,min,max){return Number.isInteger(x)&&x>=min&&x<=max;}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function permutation(a,b){
  return Array.isArray(a)&&a.length===b.length&&same(a.slice().sort(),b.slice().sort());
}
function modify(p,b){
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('積木格式錯誤');
  if(p.kind==='variables'){
    if(!['A','B'].includes(b.source)||![b.factor,b.divisor,b.modulo].every((n,i)=>validInt(n,[1,1,2][i],[5,5,9][i])))
      throw Error('變數運算積木只能使用允許的數字與來源');
    p.blocks={source:b.source,factor:b.factor,divisor:b.divisor,modulo:b.modulo};
  }else if(p.kind==='array'){
    // 允許選到不存在的第六格，以安全 VM 示範 IndexError。
    if(!validInt(b.first,0,6)||!validInt(b.second,0,6))
      throw Error('晶片編號請設定 0～6（合法範圍是 1～5）');
    p.blocks={first:b.first,second:b.second};
  }else if(p.kind==='function'){
    if(!permutation(b.body,COOL)||!['direct','call'].includes(b.mainMode))
      throw Error('函式積木只可調整四個步驟順序與主程式呼叫方式');
    p.blocks={body:b.body.slice(),mainMode:b.mainMode};
  }else throw Error('未知進階積木');
}
function size(p){
  if(p.kind==='function')return p.blocks.body.length+(p.blocks.mainMode==='call'?1:4);
  if(p.kind==='variables')return 4;
  if(p.kind==='array')return 2;
  return 0;
}
function valueOf(p,b=p.blocks){
  const v=p.initial[b.source];
  return Math.floor(v*b.factor/b.divisor)%b.modulo;
}
function getPython(p){
  const b=p.blocks;
  if(p.kind==='variables'){
    const {A,B,C}=p.initial;
    return 'A = '+A+'\nB = '+B+'\nC = '+C+
      '\nC = ('+b.source+' * '+b.factor+' // '+b.divisor+') % '+b.modulo;
  }
  if(p.kind==='array'){
    return 'chips = ['+p.initial.map(x=>'"'+x+'"').join(', ')+']\n'+
      'chips['+(b.first-1)+'], chips['+(b.second-1)+'] = '+
      'chips['+(b.second-1)+'], chips['+(b.first-1)+']';
  }
  const body=b.body.map(x=>'    '+x.toLowerCase()+'()').join('\n');
  const main=b.mainMode==='call'?'cool_down()':COOL.map(x=>x.toLowerCase()+'()').join('\n');
  return 'def cool_down():\n'+body+'\n\n'+main;
}
function goal(p){
  if(p.kind==='variables'){
    const r=p.answer;
    return '使用 '+r.source+' 槽，設定 C = ('+r.source+' × '+r.factor+' // '+r.divisor+') % '+r.modulo+
      '；// 代表整除、% 代表取餘數。';
  }
  if(p.kind==='array'){
    const a=p.answer;
    return '請交換第 '+a.first+' 與第 '+a.second+' 個晶片。Scratch 從 1 算起；Python 對應 chips['+(a.first-1)+'] 與 chips['+(a.second-1)+']。';
  }
  return '請依序在 def cool_down(): 定義 '+p.target.map(x=>stepNames[x]).join(' → ')+
    '，主程式只呼叫 cool_down()；總積木不得超過 6 個。';
}
function targetPython(p){
  const target=structuredClone(p);
  if(p.kind==='variables')target.blocks={...p.answer};
  if(p.kind==='array')target.blocks={...p.answer};
  if(p.kind==='function')target.blocks={body:COOL.slice(),mainMode:'call'};
  return getPython(target);
}
function briefing(p){
  const steps={
    variables:['先觀察 A、B、C 初始值，確認要讀哪個能源槽。','把來源、乘數、整除數、餘數門檻依序說給操作員。','確認最後寫入 C，再核准執行。'],
    array:['先辨認 5 個晶片位置。','向隊友說明 Scratch 第一格等於 Python 的 chips[0]。','請隊友選兩個位置並交換，確認後核准。'],
    function:['先看完正確的四步冷卻順序。','要求操作員在函式內排好四個積木。','主程式選「呼叫 cool_down()」，而非直接放四個步驟。']
  };
  return {
    title:EXTENDED_TITLES[p.kind], rule:goal(p), steps:steps[p.kind]
  };
}
function inspect(p) {
  const b=p.blocks;
  if(p.kind==='variables'){
    const v=valueOf(p);
    const expected=valueOf(p,p.answer);
    const exact=same(b,p.answer);
    return {success:exact&&v===expected,trace:[
      {title:'讀取 '+b.source+' 能源槽',ok:b.source===p.answer.source},
      {title:'乘數設定 × '+b.factor,ok:b.factor===p.answer.factor},
      {title:'整除運算 // '+b.divisor,ok:b.divisor===p.answer.divisor},
      {title:'取餘數 % '+b.modulo+' → C = '+v,ok:b.modulo===p.answer.modulo&&v===expected}
    ],reason:exact&&v===expected?'能量分配正確':'請核對來源槽、乘數、整除與取餘數的每一步。'};
  }
  if(p.kind==='array'){
    const valid=validInt(b.first,1,5)&&validInt(b.second,1,5);
    if(!valid){
      const wrong=validInt(b.first,1,5)?b.second:b.first;
      return {success:false,trace:[{title:'IndexError：你選了 Scratch 第 '+wrong+' 格，但晶片只有第 1～5 格（Python 索引 0～4）！',ok:false}],
        reason:'IndexError：你讀取了第 '+wrong+' 個位置，請改成 1～5；Python 索引是位置減 1。'};
    }
    const chips=p.initial.slice();
    [chips[b.first-1],chips[b.second-1]]=[chips[b.second-1],chips[b.first-1]];
    const wanted=p.initial.slice();
    [wanted[p.answer.first-1],wanted[p.answer.second-1]]=[wanted[p.answer.second-1],wanted[p.answer.first-1]];
    const ok=same(chips,wanted)&&same(b,p.answer);
    return {success:ok,trace:[
      {title:'讀取 chips['+(b.first-1)+']',ok:true},
      {title:'讀取 chips['+(b.second-1)+'] 並交換',ok}
    ],reason:ok?'已成功交換指定晶片':'交換後的晶片位置與任務不符，請核對 Scratch 與 Python 索引。'};
  }
  const body=same(b.body,COOL);
  const called=b.mainMode==='call';
  const budget=size(p)<=p.maxBlocks;
  const good=body&&called&&budget;
  return {success:good,trace:[
    ...b.body.map((x,i)=>({title:'函式步驟 '+(i+1)+'：'+stepNames[x],ok:x===COOL[i]})),
    {title:'主程式 '+(called?'呼叫 cool_down()':'重複放入四個指令'),ok:called},
    {title:'積木數量 '+size(p)+' / '+p.maxBlocks,ok:budget}
  ],reason:good?'函式定義與呼叫成功':'必須先依序定義函式，再只用一個 cool_down() 積木呼叫。'};
}
function lineMap(p){
  if(p.kind==='variables')return {'vars-source':[4],'vars-factor':[4],'vars-divisor':[4],'vars-modulo':[4]};
  if(p.kind==='array')return {'array-first':[2],'array-second':[2]};
  const out={};
  p.blocks.body.forEach((_,i)=>{out['body-'+i]=[i+2];});
  out['main-call']=p.blocks.mainMode==='call'?[7]:[7,8,9,10];
  return out;
}
function initialWatch(p){
  if(p.kind==='variables')return {...p.initial};
  if(p.kind==='array')return {chips:p.initial.slice()};
  return {steps_completed:0,main_blocks:size(p)};
}
// 每次執行只回傳當前步驟與安全快照；未執行的預期答案永不傳送給操作員。
function steps(p){
  const result=inspect(p);
  if(p.kind==='variables'){
    const b=p.blocks,watch=initialWatch(p);
    const initial=watch[b.source];
    const first={...watch,source_value:initial};
    const second={...first,temp:initial*b.factor};
    const third={...second,temp:Math.floor(second.temp/b.divisor)};
    const last={...third,C:third.temp%b.modulo};
    const watches=[first,second,third,last],ids=['vars-source','vars-factor','vars-divisor','vars-modulo'];
    return result.trace.map((x,i)=>({...x,line:4,blockId:ids[i],watch:watches[i],
      hint:x.ok?'執行完成':'請核對分析員提供的 '+['來源變數','乘數','整除數','餘數門檻'][i]}));
  }
  if(p.kind==='array'){
    const b=p.blocks,valid=validInt(b.first,1,5)&&validInt(b.second,1,5);
    if(!valid)return [{...result.trace[0],line:2,blockId:'array-first',watch:initialWatch(p),
      hint:result.reason}];
    const chips=p.initial.slice();
    [chips[b.first-1],chips[b.second-1]]=[chips[b.second-1],chips[b.first-1]];
    return result.trace.map((x,i)=>({...x,line:2,blockId:i===0?'array-first':'array-second',
      watch:i===0?{chips:p.initial.slice(),index:b.first-1}:{chips,index:b.second-1},
      hint:x.ok?'晶片索引已讀取':'交換後的位置不符，Scratch 第 1 格對應 Python chips[0]。'}));
  }
  return result.trace.map((x,i)=>({...x,line:i<4?i+2:(p.blocks.mainMode==='call'?7:i===4?7:8),
    blockId:i<4?'body-'+i:'main-call',
    watch:{steps_completed:Math.min(i+1,4),main_blocks:size(p)},
    hint:x.ok?'此步驟已完成':i>=4?'請用一個 cool_down() 呼叫代替四個重複步驟。':'請依分析員順序排列函式裡的四個指令。'}));
}
module.exports={EXTENDED,EXTENDED_TITLES,CHIPS,COOL,stepNames,make,modify,inspect,getPython,goal,targetPython,briefing,lineMap,steps,initialWatch,size};
