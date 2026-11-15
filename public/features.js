'use strict';
// v1.2：七關 Scratch/Python 教學擴充。
// 不執行 Python；後端只允許受限積木模型，這裡只負責視覺、事件及高亮。
(() => {
  const COLOR_HEX={RED:'#fa7185',BLUE:'#5caeff',GREEN:'#61e8ae',YELLOW:'#ffe18c',PURPLE:'#c69aff'};
  const NAMES={PURGE:'清除快取',VENT:'開啟散熱',SYNC:'同步能源',LOCK:'鎖定模組'};
  let hoverId=null,hoverLine=null,activeId=null,error=false,animationVersion=0;
  const originalEditor=renderEditor;
  const originalMission=renderMission;
  const originalTeacher=renderTeacher;
  const originalRender=render;
  const originalAnimate=animateResult;

  function extendedBlocks(p){
    const b=p.blocks;
    if(p.kind==='variables'){
      return '<div class="scratch-note">變數賦值：先讀 A／B 槽，再依序計算 ×、//、%，把結果存到 C。</div>'+
      '<div class="scratch-hat">🚩 當按下執行：設定 C</div><div class="scratch-stack">'+
      '<div class="block scratch-command" data-block-id="vars-source">① 讀取能源槽　'+choice('source',['A','B'],b.source)+'</div>'+
      '<div class="block scratch-command" data-block-id="vars-factor">② 乘上　'+integer('factor',b.factor,1,5)+'</div>'+
      '<div class="block scratch-command" data-block-id="vars-divisor">③ 整除 //　'+integer('divisor',b.divisor,1,5)+'</div>'+
      '<div class="block scratch-command" data-block-id="vars-modulo">④ 取餘數 %　'+integer('modulo',b.modulo,2,9)+'　→ 存到 C</div>'+
      '</div><p class="scratch-note">例如：7 // 2 = 3；7 % 2 = 1。先算乘法、整除，再取餘數。</p>';
    }
    if(p.kind==='array'){
      return '<div class="index-legend">🧮 Scratch 清單位置從 <b>1</b> 開始；Python chips 索引從 <b>0</b> 開始。'+
        'Scratch 第 1 格 → chips[0]；Scratch 第 5 格 → chips[4]。</div>'+
        '<div class="scratch-hat">🚩 當按下執行：交換兩個晶片</div><div class="scratch-stack">'+
        '<div class="block scratch-command" data-block-id="array-first">① 第一個位置（Scratch）　'+integer('first',b.first,0,6)+'</div>'+
        '<div class="block scratch-command" data-block-id="array-second">② 第二個位置（Scratch）　'+integer('second',b.second,0,6)+'</div></div>'+
        '<p class="scratch-note">正常索引為 1～5。嘗試第 6 格可觀察 IndexError 提示。</p>';
    }
    if(p.kind==='function'){
      return '<div class="function-editor-note">定義一個函式，主程式只要放一個 cool_down() 呼叫積木；上限 6 個。</div>'+
        '<div class="scratch-c purple"><div class="scratch-c-head">⬡ 定義函式 def cool_down():</div>'+
        '<div class="scratch-c-body" id="orderList">'+b.body.map((name,i)=>
          '<div class="block scratch-command" data-block-id="body-'+i+'" data-row="'+i+'" draggable="'+(canEdit()?'true':'false')+'">'+
          '<div class="block-header"><span>步驟 '+(i+1)+' · '+escapeHtml(NAMES[name])+'</span>'+
          '<span class="block-tools"><button type="button" data-fmove="'+i+':-1" '+(!canEdit()||i===0?'disabled':'')+'>↑</button>'+
          '<button type="button" data-fmove="'+i+':1" '+(!canEdit()||i===3?'disabled':'')+'>↓</button></span></div></div>').join('')+
        '</div></div>'+
        '<div class="block scratch-command" data-block-id="main-call">主程式：'+choice('mainMode',['direct','call'],b.mainMode,{
          direct:'直接執行四條指令（超量）',call:'只呼叫 cool_down()'})+'</div>';
    }
    return '';
  }
  function annotateOriginalBlocks(p){
    document.querySelectorAll('#editor [data-row]').forEach(el=>el.dataset.blockId='order-'+el.dataset.row);
    if(p.kind==='condition'||p.kind==='debug'){
      document.querySelectorAll('#editor .scratch-c.purple').forEach(el=>el.dataset.blockId='condition');
    }
    if(p.kind==='loop'||p.kind==='debug'){
      document.querySelectorAll('#editor .scratch-c.orange').forEach(el=>el.dataset.blockId='loop');
    }
  }
  function showProgram(p){
    const raw=String(p.python||'# 等待積木');
    const mask=snapshot.difficulty==='advanced'&&snapshot.stability<60;
    const code=raw.split('\n').map((line,i)=>{
      const visible=mask?line.replace(/(\/\/|%|==|!=|\band\b|\bor\b)/g,'???'):line;
      return '<span class="code-line '+(visible!==line?'logic-mask':'')+'" data-line="'+(i+1)+
        '" title="移到程式行，查看對應積木">'+escapeHtml(visible)+'</span>';
    }).join('\n');
    $('codeOutput').innerHTML=code;
    highlight();
  }
  function showWatch(p){
    const record=snapshot.step?.watch||
      (p.kind==='variables'?p.initial:p.kind==='array'?{chips:p.initial}:p.kind==='function'?{steps_completed:0,main_blocks:p.blockCount}:{});
    const items=Object.entries(record||{});
    $('watchWindow').innerHTML=items.length?items.map(([name,value])=>
      '<div class="watch-item"><span class="watch-key">'+escapeHtml(name)+'</span>'+
      '<strong class="watch-value">'+escapeHtml(typeof value==='object'?JSON.stringify(value):String(value))+'</strong></div>').join(''):
      '<span class="watch-empty">等待單步執行，將顯示變數與清單的即時數值。</span>';
    const step=snapshot.step,cur=step?.active;
    $('stepProgress').className='step-progress'+(cur&&!cur.ok?' error':'');
    $('stepProgress').textContent=cur?
      '步驟 '+step.position+'／'+step.total+'：'+cur.title+(cur.ok?'　✓':'　💡 '+cur.hint):
      '單步執行：分析員核准後，操作員一次前進一行，所有玩家同步觀看。';
    if(snapshot.difficulty==='advanced'&&snapshot.stability<60){
      $('stepProgress').textContent+='　⚠ 穩定度低於 60%，已啟用程式雜訊「???」。';
    }
  }
  function showStage(p){
    const container=$('stageVisual');
    if(!['variables','array','function'].includes(p.kind)){
      container.hidden=true;container.innerHTML='';return;
    }
    container.hidden=false;
    if(p.kind==='variables'){
      const watch={...p.initial,...(snapshot.step?.watch||{})};
      container.innerHTML='<h3>⚡ ENERGY ROUTER　A／B／C 能源槽</h3>'+
        '<div class="energy-slots">'+['A','B','C'].map(k=>
          '<div class="energy-slot"><strong>'+k+'</strong><b>'+escapeHtml(watch[k])+'</b></div>').join('')+'</div>';
    }else if(p.kind==='array'){
      const chips=snapshot.step?.watch?.chips||p.initial;
      container.innerHTML='<h3>▣ CHIP ARRAY　五色晶片陣列</h3><div class="chip-slots">'+
        chips.map((chip,i)=>'<div class="chip-slot"><i class="chip-dot" style="--chip-color:'+COLOR_HEX[chip]+'"></i>'+
          '<small>Scratch '+(i+1)+'<br>Python ['+i+']</small><b>'+chip+'</b></div>').join('')+'</div>';
    }else{
      container.innerHTML='<h3>❄ COOLING PROTOCOL　積木上限 6</h3>'+
        '<div class="program-caution">目前 '+p.blockCount+' 個積木'+(p.blockCount>6?'；已超出上限！':'；將函式定義與主程式呼叫分開。')+'</div>';
    }
  }
  function highlight(){
    document.querySelectorAll('#editor [data-block-id],#codeOutput .code-line').forEach(el=>
      el.classList.remove('logic-hover','logic-active','logic-error'));
    const mapping=snapshot?.puzzle?.lineMap||{};
    const paint=(id,type)=>{
      if(!id)return;
      const lines=(mapping[id]||[]).map(Number);
      document.querySelectorAll('#editor [data-block-id]').forEach(el=>{
        if(el.dataset.blockId===id)el.classList.add(type);
      });
      document.querySelectorAll('#codeOutput .code-line').forEach(el=>{
        if(lines.includes(Number(el.dataset.line)))el.classList.add(type);
      });
    };
    paint(activeId,error?'logic-error':'logic-active');
    paint(hoverId,'logic-hover');
    if(hoverLine!==null){
      const match=Object.keys(mapping).find(k=>(mapping[k]||[]).includes(hoverLine));
      paint(match,'logic-hover');
      const line=$('codeOutput').querySelector('[data-line="'+hoverLine+'"]');
      if(line)line.classList.add('logic-hover');
    }
  }
  function traceId(kind,i){
    if(kind==='sequence')return 'order-'+i;
    if(kind==='condition')return 'condition';
    if(kind==='loop')return 'loop';
    if(kind==='debug')return ['order-0','condition','loop'][i]||'loop';
    if(kind==='variables')return ['vars-source','vars-factor','vars-divisor','vars-modulo'][i]||'vars-modulo';
    if(kind==='array')return ['array-first','array-second'][i]||'array-second';
    if(kind==='function')return i<4?'body-'+i:'main-call';
    return null;
  }
  renderEditor=function(){
    originalEditor();
    const p=snapshot?.puzzle;
    $('stepBtn').disabled=!canEdit()||!snapshot?.approved;
    $('runBtn').disabled=!canEdit()||!snapshot?.approved||
      Boolean(snapshot?.step?.position&&!snapshot.step.finished);
    $('blockMeter').hidden=!p?.maxBlocks;
    if(!p){
      $('stageVisual').hidden=true;
      $('watchWindow').textContent='等待任務開始。';
      $('stepProgress').textContent='';
      return;
    }
    if(p.maxBlocks!=null){
      $('blockMeter').textContent='積木數量：'+p.blockCount+'／'+p.maxBlocks+
        (p.blockCount>p.maxBlocks?'　⚠ 超量，請重構為函式或迴圈。':'　✓ 未超出上限');
      $('blockMeter').className='block-meter'+(p.blockCount>p.maxBlocks?' over-budget':'');
    }
    if(['variables','array','function'].includes(p.kind))$('editor').innerHTML=extendedBlocks(p);
    else annotateOriginalBlocks(p);
    showProgram(p);
    showWatch(p);
    showStage(p);
  };
  renderMission=function(){
    originalMission();
    if(!snapshot?.puzzle)return;
    $('stageCaption').textContent=snapshot.mode==='lab'?'CREATOR LAB / 自訂挑戰':
      'MISSION '+String(snapshot.stageIndex+1).padStart(2,'0')+' / 07';
    const p=snapshot.puzzle;
    if(snapshot.difficulty==='advanced'&&(snapshot.role==='analyst'||snapshot.role==='teacher')&&
       p.briefing?.targetPython){
      const mission=$('taskInstructions');
      mission.innerHTML='<span class="mission-card-badge">🔐 進階挑戰 · 分析員讀碼</span>'+
        '<div class="mission-card-title">🐍 請讀懂目標 Python，指揮隊友排積木</div>'+
        '<p class="mission-card-explain">本模式不提供白話答案；分析員自行推理後，用口頭或作戰通訊說明。</p>'+
        '<pre class="mission-rule mission-target">'+escapeHtml(p.briefing.targetPython)+'</pre>'+
        '<div class="mission-actions"><b>📢 建議流程</b><ol>'+p.briefing.steps.map(x=>
          '<li>'+escapeHtml(x)+'</li>').join('')+'</ol></div>';
    }
  };
  renderTeacher=function(){
    originalTeacher();
    if(snapshot?.role==='teacher'&&snapshot.mode==='mission')
      document.querySelector('[data-teacher="next"]').disabled=snapshot.stageIndex>=6;
  };
  animateResult=function(result){
    originalAnimate(result);
    const version=++animationVersion;
    (result.trace||[]).forEach((row,i)=>setTimeout(()=>{
      if(version!==animationVersion)return;
      activeId=traceId(snapshot?.puzzle?.kind,i);error=!row.ok;highlight();
    },Math.min(i*320,4800)));
  };
  render=function(){
    originalRender();
    if(!snapshot?.puzzle)return;
    if(snapshot.step?.active){
      const cur=snapshot.step.active;
      activeId=cur.blockId;error=!cur.ok;
      $('tracePanel').innerHTML='<div class="trace-entry '+(cur.ok?'ok':'bad')+'">'+
        escapeHtml(cur.title)+(cur.ok?'':'　💡 '+escapeHtml(cur.hint))+'</div>';
      highlight();
    }else if(!snapshot.result&&(!snapshot.step||snapshot.step.position===0)){
      activeId=null;error=false;highlight();
    }
  };
  $('stepBtn').addEventListener('click',()=>send('puzzle:step'));
  $('editor').addEventListener('click',e=>{
    const control=e.target.closest('[data-fmove]');
    if(!control||!canEdit()||snapshot?.puzzle?.kind!=='function')return;
    e.preventDefault();e.stopImmediatePropagation();
    const [index,delta]=control.dataset.fmove.split(':').map(Number);
    queueEdit(p=>{
      if(p.kind!=='function')return null;
      const body=p.blocks.body.slice(),to=index+delta;
      if(to<0||to>=body.length)return null;
      [body[index],body[to]]=[body[to],body[index]];
      return {...p.blocks,body};
    });
  },true);
  $('editor').addEventListener('dragstart',e=>{
    if(snapshot?.puzzle?.kind!=='function')return;
    const row=e.target.closest('[data-row]');
    if(row)window.__coolDragged=Number(row.dataset.row);
  },true);
  $('editor').addEventListener('drop',e=>{
    if(snapshot?.puzzle?.kind!=='function'||!canEdit())return;
    const row=e.target.closest('[data-row]');
    if(!row||!Number.isInteger(window.__coolDragged))return;
    e.preventDefault();e.stopImmediatePropagation();
    const from=window.__coolDragged,to=Number(row.dataset.row);
    window.__coolDragged=null;
    queueEdit(p=>{
      if(p.kind!=='function')return null;
      const body=p.blocks.body.slice();
      body.splice(to,0,body.splice(from,1)[0]);
      return {...p.blocks,body};
    });
  },true);
  $('editor').addEventListener('pointerover',e=>{
    const target=e.target.closest('[data-block-id]');
    if(target){hoverId=target.dataset.blockId;hoverLine=null;highlight();}
  });
  $('editor').addEventListener('pointerout',e=>{
    const from=e.target.closest('[data-block-id]');
    const to=e.relatedTarget?.closest?.('[data-block-id]');
    if(from&&from.dataset.blockId!==to?.dataset.blockId){hoverId=null;highlight();}
  });
  $('codeOutput').addEventListener('pointerover',e=>{
    const target=e.target.closest('.code-line');
    if(target){hoverLine=Number(target.dataset.line);hoverId=null;highlight();}
  });
  $('codeOutput').addEventListener('pointerleave',()=>{
    hoverLine=null;highlight();
  });
  // 完成擴充後重新渲染目前房間，允許重新整理後恢復視覺監視器。
  if(snapshot&&self)render();
})();
