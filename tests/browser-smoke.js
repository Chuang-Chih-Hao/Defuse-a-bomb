'use strict';
// Real Chromium test: 1 teacher + 2 isolated devices, four stages, pause, lab, reconnect.
const assert=require('node:assert/strict');
const { chromium }=require('playwright');
const { createGameServer }=require('../src/server');

const game=process.env.TARGET_URL ? null : createGameServer();
const problems=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const port=game ? await game.listen(0) : null;
  const url=process.env.TARGET_URL || 'http://127.0.0.1:'+port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  let browserPages=[];
  try {
    const contextTeacher=await browser.newContext({viewport:{width:1440,height:900}});
    const contextA=await browser.newContext({viewport:{width:1250,height:950}});
    const contextB=await browser.newContext({viewport:{width:1250,height:950}});
    const teacher=await contextTeacher.newPage();
    const a=await contextA.newPage();
    const b=await contextB.newPage();
    browserPages=[teacher,a,b];
    for(const [index,page] of browserPages.entries()){
      page.on('pageerror',e=>{problems.push(e.stack||e.message);console.error('BROWSER PAGE ERROR',index,e.message);});
      page.on('console',msg=>{if(msg.type()==='error')console.error('BROWSER CONSOLE',index,msg.text());});
      page.on('requestfailed',req=>console.error('BROWSER REQUEST FAILED',index,req.url(),req.failure()?.errorText));
    }
    await Promise.all([teacher.goto(url,{waitUntil:'domcontentloaded'}),a.goto(url,{waitUntil:'domcontentloaded'}),b.goto(url,{waitUntil:'domcontentloaded'})]);
    await Promise.all(browserPages.map(page=>page.waitForFunction(()=>document.querySelector('#network')?.classList.contains('online'),null,{timeout:30000})));
    console.log('PASS all 3 public browser sockets connected to '+url);
    await teacher.locator('#createBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#roomLabel')?.textContent?.length===6&&document.querySelector('#roomLabel')?.textContent!=='------');
    const code=await teacher.locator('#roomLabel').textContent();
    assert.match(code,/^[0-9A-F]{6}$/);
    async function join(page,name){
      await page.locator('#nickname').fill(name);
      await page.locator('#roomCode').fill(code);
      await page.locator('#joinBtn').click();
      await page.locator('#gameScreen').waitFor({state:'visible'});
      await page.waitForFunction(()=>document.querySelector('#roomLabel')?.textContent!=='------');
    }

    // Genuine Render runs generate unpredictable goals. Read only the analyst's
    // on-screen briefing; operator still cannot access private correct answers.
    const matchColors=text=>[...text.matchAll(/\b(BLUE|RED|GREEN|YELLOW)\b/g)].map(m=>m[1]);
    async function waitBothCode(fragment){
      await Promise.all([a,b].map(p=>p.waitForFunction(value=>
        document.querySelector('#codeOutput')?.textContent.includes(value),fragment,{timeout:15000})));
    }
    async function setField(page,field,value){
      const control=page.locator('#editor [data-field='+field+']');
      if(await control.evaluate(el=>el.tagName==='SELECT'))await control.selectOption(String(value));
      else {await control.fill(String(value));await control.press('Tab');}
      await page.waitForFunction(({field,value})=>
        String(snapshot?.puzzle?.blocks?.[field])===String(value),{field,value:String(value)},{timeout:15000});
    }
    async function reorderRows(operator,goal,kind='sequence'){
      const tokenOfCode=code=>kind==='function'?
        [...code.matchAll(/^    (purge|vent|sync|lock)\(\)$/gm)].map(x=>x[1]):
        kind==='debug'?
        code.split('\n').filter(x=>/^(verify|sweep|seal|report)\(\)$/.test(x)).map(x=>x.slice(0,-2)):
        [...code.matchAll(/activate\("(BLUE|RED|GREEN|YELLOW)"\)/g)].map(x=>x[1]);
      let order=tokenOfCode(await operator.locator('#codeOutput').textContent());
      assert.equal(order.length,goal.length);
      for(let i=0;i<goal.length;i++){
        let j=order.indexOf(goal[i],i);
        assert.ok(j>=i,'goal command missing: '+goal[i]);
        while(j>i){
          const attr=kind==='function'?'data-fmove':'data-move';
          await operator.locator('#editor ['+attr+'="'+j+':-1"]').click();
          [order[j],order[j-1]]=[order[j-1],order[j]];
          const expected=order.join(',');
          await operator.waitForFunction(({expected,kind})=>{
            const text=document.querySelector('#codeOutput')?.textContent||'';
            const rows=kind==='function'?
              [...text.matchAll(/^    (purge|vent|sync|lock)\(\)$/gm)].map(x=>x[1]):
              kind==='debug'?
              text.split('\n').filter(x=>/^(verify|sweep|seal|report)\(\)$/.test(x)).map(x=>x.slice(0,-2)):
              [...text.matchAll(/activate\("(BLUE|RED|GREEN|YELLOW)"\)/g)].map(x=>x[1]);
            return rows.join(',')===expected;
          },{expected,kind},{timeout:15000});
          j--;
        }
      }
      return order;
    }
    const parseCondition=text=>{
      const m=text.match(/\b(BLUE|RED|GREEN|YELLOW)\b[\s\S]*?\b(AND|OR)\b[\s\S]*?能源\s*>\s*(\d+)/);
      assert.ok(m,'cannot parse analyst condition '+text);
      return {color:m[1],mode:m[2],threshold:Number(m[3])};
    };
    await join(a,'學員甲');await join(b,'學員乙');
    await teacher.waitForFunction(()=>document.querySelectorAll('#agents .agent .led.online').length===2);
    await teacher.locator('[data-teacher=start]').click();
    await b.waitForFunction(()=>document.querySelector('#editor .block'));
    assert.match(await b.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await a.locator('#rolePill').textContent(),/程式分析員/);
    assert.match(await a.locator('#missionPanel').textContent(),/機密|僅分析員/);
    const startGoal=await a.locator('.mission-rule').textContent();
    const firstTarget=matchColors(startGoal);
    assert.ok(firstTarget.length>=3,'Analyst must see the current private color order');
    assert.match(await a.locator('#turnTitle').textContent(),/你是程式分析員/);
    assert.match(await b.locator('#turnTitle').textContent(),/你是拆彈操作員/);
    assert.equal(await b.locator('.mission-rule').count(),0,'Operator must not see analyst answer');
    assert.equal(await b.locator('#editor .scratch-hat').count(),1,'Scratch hat should be rendered');
    assert.match(await b.locator('#codeOutput').textContent(),/activate\("(GREEN|BLUE|RED|YELLOW)"\)/);
    assert.doesNotMatch(await b.locator('#codeOutput').textContent(),/;|\bfunction\b/);
    console.log('PASS analyst task card, private instructions, roles, Scratch/Python interface');
    assert.equal(await a.locator('#editor [data-move="0:1"]').isDisabled(),true,'Analyst cannot reorder cards');
    await reorderRows(b,firstTarget);
    const orderedSignal=firstTarget.map(c=>'activate("'+c+'")').join('\n');
    await Promise.all([a,b].map(page=>page.waitForFunction(expected=>document.querySelector('#codeOutput')?.textContent===expected,orderedSignal,{timeout:12000})));
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 1: sequence and synchronized team roles');

    await teacher.locator('[data-teacher=next]').click();
    await a.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('邏輯密碼鎖'));
    assert.match(await a.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await a.locator('#turnTitle').textContent(),/你是拆彈操作員/);
    await b.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('邏輯密碼鎖') && document.querySelector('.mission-rule'));
    const conditionGoal=parseCondition(await b.locator('.mission-rule').textContent());
    assert.equal(await a.locator('.mission-rule').count(),0);
    await setField(a,'color',conditionGoal.color);
    await setField(a,'threshold',conditionGoal.threshold);
    await setField(a,'mode',conditionGoal.mode);
    await waitBothCode('key_color == "'+conditionGoal.color+'" '+
      conditionGoal.mode.toLowerCase()+' power > '+conditionGoal.threshold);
    await b.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    console.log('STAGE2 CODE',await a.locator('#codeOutput').textContent());
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#attempts')?.textContent==='01',null,{timeout:10000});
    const stage2Status=await teacher.locator('#systemStatus').textContent();
    console.log('STAGE2 STATE',stage2Status,await teacher.locator('#tracePanel').textContent());
    assert.match(stage2Status,/安全解除/,'Condition puzzle did not pass');
    console.log('PASS stage 2: if/else, multi-case Boolean evaluation');

    await teacher.locator('[data-teacher=next]').click();
    await b.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('無限倒數陷阱'));
    await teacher.locator('[data-teacher=pause]').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('暫停'));
    const frozen=await teacher.locator('#timer').textContent();
    await wait(1200);
    assert.equal(await teacher.locator('#timer').textContent(),frozen);
    await teacher.locator('[data-teacher=resume]').click();
    const loopGoal=await a.locator('.mission-rule').textContent();
    const loopCount=Number(loopGoal.match(/執行 (d+) 次/)?.[1]);
    assert.ok(loopCount>=2&&loopCount<=10);
    await setField(b,'limit',loopCount);
    await waitBothCode('range(0, '+loopCount+', 1)');
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 3: counted loops and teacher pause/resume');

    await teacher.locator('[data-teacher=next]').click();
    await Promise.all([a,b].map(page=>page.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('駭客的最終程式'))));
    // Each edit is synchronized before the next one; rapid re-rendering otherwise
    // can replace an input before its pending change event has been emitted.
    const waitBoth=async(fragment)=>Promise.all([a,b].map(page=>page.waitForFunction(text=>
      document.querySelector('#codeOutput')?.textContent.includes(text),fragment,{timeout:15000})));
    const debugGoal=await b.locator('.mission-rule').textContent();
    const cmdName={驗證:'verify',清除:'sweep',封存:'seal',報告:'report'};
    const debugOrder=debugGoal.split('正確順序：')[1].split('；')[0].split('→').map(x=>cmdName[x.trim()]);
    assert.ok(debugOrder.every(Boolean));
    await reorderRows(a,debugOrder,'debug');
    const debugCondition=parseCondition(debugGoal);
    const debugRepeat=Number(debugGoal.match(/迴圈需執行 (d+) 次/)?.[1]);
    assert.ok(debugRepeat>=2);
    await setField(a,'color',debugCondition.color);
    await setField(a,'threshold',debugCondition.threshold);
    await setField(a,'mode',debugCondition.mode);
    await waitBoth('key_color == "'+debugCondition.color+'" '+
      debugCondition.mode.toLowerCase()+' power > '+debugCondition.threshold);
    await setField(a,'limit',debugRepeat);
    await waitBoth('for i in range(0, '+debugRepeat+', 1)');
    await b.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 4: compound Debug');

    await teacher.locator('[data-teacher=lab]').click();
    await b.waitForFunction(()=>document.querySelector('#labPanel')&&!document.querySelector('#labPanel').hidden);
    await b.locator('#labForm button[type=submit]').click();
    await a.waitForFunction(()=>document.querySelectorAll('#editor [data-row]').length===3);
    await a.locator('#editor [data-move="0:1"]').click();
    await a.locator('#editor [data-move="1:1"]').click();
    await a.locator('#editor [data-move="0:1"]').click();
    // 等待所有方塊版本在兩台電腦同步完成，否則舊核准會被最新編輯撤銷。
    const expectedLab='activate("BLUE")\nactivate("RED")\nactivate("GREEN")';
    await Promise.all([a,b].map(page=>page.waitForFunction(expected=>
      document.querySelector('#codeOutput')?.textContent===expected,expectedLab,{timeout:15000})));
    await b.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS challenge laboratory publication');

    await teacher.locator('[data-teacher=labNext]').click();
    await a.waitForFunction(()=>document.querySelector('#labForm')&&!document.querySelector('#labPanel').hidden);
    await a.locator('[data-preset="2"]').click();
    await a.locator('#labCount').fill('7');
    await a.locator('#labForm button[type=submit]').click();
    await b.waitForFunction(()=>document.querySelector('#editor [data-field=limit]'));
    await b.locator('#editor [data-field=limit]').fill('7');
    await b.locator('#editor [data-field=limit]').press('Tab');
    await Promise.all([a,b].map(page=>page.waitForFunction(()=>
      document.querySelector('#codeOutput')?.textContent.includes('range(0, 7, 1)'),null,{timeout:15000})));
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS lab role swap and loop challenge');
    await teacher.locator('[data-teacher=labNext]').click();
    await b.waitForFunction(()=>document.querySelector('#labForm')&&!document.querySelector('#labPanel').hidden);
    await b.locator('[data-preset="1"]').click();
    await b.locator('#labColor').selectOption('YELLOW');
    await b.locator('#labThreshold').fill('80');
    await b.locator('#labThreshold').press('Tab');
    await b.locator('#labMode').selectOption('OR');
    assert.match(await b.locator('#labPreview').textContent(),/YELLOW/);
    assert.match(await b.locator('#labPreview').textContent(),/或（OR/);
    assert.doesNotMatch(await b.locator('#labPreview').textContent(),/且（AND/);
    // Teacher broadcast while drafting must preserve all unsent input settings.
    await teacher.locator('#saveConfig').click();
    await b.waitForFunction(()=>document.querySelector('#labThreshold')?.value==='80'&&document.querySelector('#labColor')?.value==='YELLOW'&&document.querySelector('#labMode')?.value==='OR');
    assert.equal(await b.locator('#labMode').inputValue(),'OR');
    await b.locator('#labPublish').click();
    await b.waitForFunction(()=>document.querySelector('.mission-rule')?.textContent.includes('YELLOW'));
    assert.match(await b.locator('.mission-rule').textContent(),/或（OR/);
    assert.doesNotMatch(await b.locator('.mission-rule').textContent(),/且能源/);
    await a.waitForFunction(()=>document.querySelector('#editor [data-field=color]')?.value==='BLUE');
    assert.equal(await a.locator('.mission-rule').count(),0);
    await a.locator('#editor [data-field=color]').selectOption('YELLOW');
    await a.locator('#editor [data-field=threshold]').fill('80');
    await a.locator('#editor [data-field=threshold]').press('Tab');
    await a.waitForFunction(()=>document.querySelector('#codeOutput')?.textContent.includes('key_color == "YELLOW" or power > 80'));
    await b.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS lab OR challenge: YELLOW/80 wording, publish, input persistence, Python, correct grading');


    await a.reload({waitUntil:'domcontentloaded'});
    await a.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('挑戰實驗室'));
    assert.match(await a.locator('#rolePill').textContent(),/拆彈操作員/);
    console.log('PASS browser refresh reconnect');

    // Regression: mobile devices must display real Python, not an empty box.
    // The original issue occurred when a fresh HTML page reused stale cached JS.
    for(const width of [390,585]){
      await a.setViewportSize({width,height:844});
      await a.waitForFunction(()=>document.querySelector('#codeOutput')?.textContent.includes('key_color == "YELLOW" or power > 80'),null,{timeout:12000});
      const mobile=await a.evaluate(()=>{
        const node=document.querySelector('#codeOutput');
        const python=document.querySelector('#pythonPanel');
        const banner=document.querySelector('#turnPartner');
        const rect=node.getBoundingClientRect();
        const panel=python.getBoundingClientRect();
        const team=banner.getBoundingClientRect();
        const style=getComputedStyle(node);
        return {code:node.textContent,display:style.display,visibility:style.visibility,
          width:rect.width,height:rect.height,right:rect.right,panelWidth:panel.width,
          panelRight:panel.right,teamRight:team.right,viewportWidth:window.innerWidth,
          overflow:document.documentElement.scrollWidth-window.innerWidth,
          versionScript:document.querySelector('script[src*="/app.js"]')?.src};
      });
      assert.match(mobile.code,/if \(key_color == "YELLOW" or power > 80\):/);
      assert.equal(mobile.display,'block');
      assert.notEqual(mobile.visibility,'hidden');
      assert.ok(mobile.height>=90,'Python code panel must have visible height on '+width+'px phone');
      assert.ok(mobile.width>=width*.75,'Python code panel is unexpectedly narrow');
      assert.ok(mobile.right<=mobile.viewportWidth+2,'Python code clipped off screen');
      assert.ok(mobile.teamRight<=mobile.viewportWidth+2,'Team roster clipped off screen');
      assert.ok(mobile.versionScript.includes('v=1.4.0'),'Browser is not using versioned JavaScript');
      await a.locator('#codeOutput').scrollIntoViewIfNeeded();
      await a.screenshot({path:(process.env.TARGET_URL?'render-':'')+'phone-'+width+'.png',fullPage:true});
      console.log('PASS mobile Python visibility and roster at '+width+'px: code height '+Math.round(mobile.height)+'px');
    }
    await a.setViewportSize({width:1250,height:950});
    const desktop=await a.evaluate(()=>{
      const box=document.querySelector('#turnPartner'),parent=document.querySelector('#turnBanner');
      return {boxRight:box.getBoundingClientRect().right,parentRight:parent.getBoundingClientRect().right,
        rows:box.querySelectorAll('.team-roster-line').length};
    });
    assert.equal(desktop.rows,2,'Desktop team roster must display two distinct role/name rows');
    assert.ok(desktop.boxRight<=desktop.parentRight+2,'Desktop team roster must stay inside the banner');
    console.log('PASS desktop roster grid layout');


    // 關卡 05：由分析員指揮操作員修改變數運算，單步 Watch 三端同步。
    await teacher.locator('#stageSelect').selectOption('4');
    await teacher.locator('#jumpStage').click();
    await Promise.all([a,b].map(page=>page.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('能量分配站'))));
    assert.match(await a.locator('.mission-rule').textContent(),/C = /);
    assert.equal(await b.locator('#codeOutput').textContent(),await a.locator('#codeOutput').textContent());
    // 依次等待每次編輯傳送完畢，避免 Socket.IO 更新導致編輯表單重新渲染。
    const waitPythonBoth=async(code)=>Promise.all([a,b].map(page=>
      page.waitForFunction(part=>document.querySelector('#codeOutput')?.textContent.includes(part),code,{timeout:12000})));
    const varTask=await a.locator('.mission-rule').textContent();
    const vars=varTask.match(/C = \(([AB]) × (\d+) \/\/ (\d+)\) % (\d+)/);
    assert.ok(vars,'Analyst should see full variable formula: '+varTask);
    const [source,factor,divisor,modulo]=[vars[1],Number(vars[2]),Number(vars[3]),Number(vars[4])];
    await setField(b,'source',source);
    await setField(b,'factor',factor);
    await setField(b,'divisor',divisor);
    await setField(b,'modulo',modulo);
    await waitPythonBoth('C = ('+source+' * '+factor+' // '+divisor+') % '+modulo);
    await b.locator('[data-block-id=vars-modulo]').hover();
    await b.waitForFunction(()=>document.querySelector('#codeOutput .code-line.logic-hover'));
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#stepBtn')?.disabled);
    for(let i=0;i<4;i++){
      await b.locator('#stepBtn').click();
      await b.waitForFunction(n=>document.querySelector('#stepProgress')?.textContent.includes('步驟 '+n+'／'),i+1);
    }
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    assert.match(await b.locator('#watchWindow').textContent(),/source_value|temp|C/);
    console.log('PASS stage 5: variables, Python hover pairing, synchronized single-step Watch Window');

    // 關卡 06：Scratch 第一格對應 Python chips[0]。
    await teacher.locator('[data-teacher=next]').click();
    await Promise.all([a,b].map(page=>page.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('晶片陣列鎖'))));
    assert.match(await a.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await a.locator('#editor').textContent(),/Scratch/);
    const arrayTask=await b.locator('.mission-rule').textContent();
    assert.match(arrayTask,/交換前：/);
    assert.match(arrayTask,/交換後應為：/);
    assert.match(arrayTask,/Scratch 清單位置從 1 起算/);
    const pair=arrayTask.match(/任務：交換 Scratch 第 (\d+) 格[^\n]+與第 (\d+) 格/);
    assert.ok(pair,'Cannot find array swap coordinates: '+arrayTask);
    // Intentionally reverse the pair. Transposition must grade equivalently.
    await setField(a,'first',Number(pair[2]));
    await setField(a,'second',Number(pair[1]));
    await waitBothCode('chips['+(Number(pair[2])-1)+'], chips['+(Number(pair[1])-1)+']');
    await b.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 6: chip list swapping and Scratch/Python index difference');

    // 關卡 07：函式內四步驟，主程式只呼叫一次 cool_down()。
    await teacher.locator('[data-teacher=next]').click();
    await Promise.all([a,b].map(page=>page.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('緊急冷卻協議'))));
    assert.match(await b.locator('#blockMeter').textContent(),/8／6/);
    const fnGoal=await a.locator('.mission-rule').textContent();
    const fnName={'清除快取':'purge','開啟散熱':'vent','同步能源':'sync','鎖定模組':'lock'};
    const fnOrder=fnGoal.split('定義 ')[1].split('，主程式')[0].split('→').map(x=>fnName[x.trim()]);
    assert.equal(fnOrder.length,4);
    assert.ok(fnOrder.every(Boolean),'Function sequence not readable: '+fnGoal);
    await reorderRows(b,fnOrder,'function');
    await setField(b,'mainMode','call');
    const fnCode='def cool_down():\n'+fnOrder.map(x=>'    '+x+'()').join('\n')+'\n\ncool_down()';
    await Promise.all([a,b].map(page=>page.waitForFunction(value=>
      document.querySelector('#codeOutput')?.textContent.includes(value),fnCode,{timeout:15000})));
    assert.match(await b.locator('#blockMeter').textContent(),/5／6/);
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 7: function definition, block budget and main call');

    // 進階模式：不依年級區分；分析員只收到 Python 目標，操作員沒有答案。
    await teacher.locator('#difficultySelect').selectOption('advanced');
    await teacher.locator('#saveConfig').click();
    // The config request is asynchronous. Wait for the server snapshot before
    // starting the next mission or the new puzzle can be created in basic mode.
    await Promise.all([teacher,a,b].map(page=>page.waitForFunction(()=>
      document.querySelector('#difficultyPill')?.textContent.includes('進階模式'),null,{timeout:15000})));
    await teacher.locator('#stageSelect').selectOption('4');
    await teacher.locator('#jumpStage').click();
    await Promise.all([teacher,a,b].map(page=>page.waitForFunction(()=>
      document.querySelector('#stageHeading')?.textContent.includes('能量分配站'),null,{timeout:15000})));
    await a.waitForFunction(()=>document.querySelector('.mission-target')?.textContent.includes('C ='),null,{timeout:15000});
    assert.match(await a.locator('.mission-target').textContent(),/C = \([AB] \* [1-5] \/\/ [1-5]\) % [2-9]/);
    assert.equal(await b.locator('.mission-target').count(),0);
    console.log('PASS advanced analyst code-only rule and private target Python');

    // 再換同關新題：確認不只是背景改色，真正的 Python 目標也會不同。
    const priorTarget=await a.locator('.mission-target').textContent();
    await teacher.locator('[data-teacher=retry]').click();
    await a.waitForFunction(old=>document.querySelector('.mission-target')?.textContent!==old &&
      document.querySelector('#stageCaption')?.textContent.includes('第 2 題'),priorTarget,{timeout:15000});
    const nextTarget=await a.locator('.mission-target').textContent();
    assert.notEqual(nextTarget,priorTarget);
    assert.equal(await b.locator('.mission-target').count(),0,'解題操作員仍不能收到新題目答案');
    const focus=await b.evaluate(()=>{
      const mission=document.querySelector('#missionPanel').getBoundingClientRect();
      const editor=document.querySelector('#editor').getBoundingClientRect();
      const core=document.querySelector('#core').getBoundingClientRect();
      const drawer=document.querySelector('#teamDrawer');
      const all=document.querySelectorAll('#missionTrack span');
      return {mission:mission.width,editor:editor.width,core:core.width,
        teamCollapsed:!drawer.open,visibleStages:[...all].filter(x=>getComputedStyle(x).display!=='none').length,
        pythonVisible:getComputedStyle(document.querySelector('#codeOutput')).display!=='none'};
    });
    assert.ok(focus.mission>=200&&focus.editor>=240);
    assert.ok(focus.core<=140,'裝置動畫應縮小，保留主要畫面給題目及積木');
    assert.equal(focus.teamCollapsed,true);
    assert.equal(focus.visibleStages,1);
    assert.equal(focus.pythonVisible,true);
    console.log('PASS randomized repeat challenge and compact question-answer-defuse UI');

    await teacher.screenshot({path:process.env.TARGET_URL?'render-teacher-screenshot.png':'teacher-screenshot.png',fullPage:true});
    assert.deepEqual(problems,[],'No browser runtime exceptions');
    console.log('PASS browser: teacher dashboard, students, room and visual UI');
  }catch(error){
    for(const [index,page] of browserPages.entries()){
      try{
        console.error('BROWSER STATUS',index,'network',await page.locator('#network').textContent(),'toast',await page.locator('#toast').textContent());
        if(process.env.TARGET_URL)await page.screenshot({path:'render-debug-'+index+'.png',fullPage:true});
      }catch(e){console.error('Failed to collect browser diagnostic',index,e.message);}
    }
    throw error;
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(game)await game.close();});
