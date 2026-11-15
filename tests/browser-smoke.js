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
    await join(a,'學員甲');await join(b,'學員乙');
    await teacher.waitForFunction(()=>document.querySelectorAll('#agents .agent .led.online').length===2);
    await teacher.locator('[data-teacher=start]').click();
    await b.waitForFunction(()=>document.querySelector('#editor .block'));
    assert.match(await b.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await a.locator('#rolePill').textContent(),/程式分析員/);
    assert.equal(await a.locator('#editor [data-move="0:1"]').isDisabled(),true,'Analyst cannot reorder cards');
    await b.locator('#editor [data-move="0:1"]').click(); // BLUE GREEN RED
    await b.locator('#editor [data-move="1:1"]').click(); // BLUE RED GREEN
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 1: sequence and synchronized team roles');

    await teacher.locator('[data-teacher=next]').click();
    await a.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('邏輯密碼鎖'));
    assert.match(await a.locator('#rolePill').textContent(),/拆彈操作員/);
    await a.locator('#editor [data-field=color]').selectOption('RED');
    await a.locator('#editor [data-field=threshold]').fill('50');
    await a.locator('#editor [data-field=threshold]').press('Tab');
    await a.locator('#editor [data-field=mode]').selectOption('AND');
    await a.waitForFunction(()=>document.querySelector('#codeOutput')?.textContent.includes('keyColor === "RED" && power > 50'),null,{timeout:10000});
    await b.waitForFunction(()=>document.querySelector('#codeOutput')?.textContent.includes('keyColor === "RED" && power > 50'),null,{timeout:10000});
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
    await b.locator('#editor [data-field=limit]').fill('4');
    await b.locator('#editor [data-field=limit]').press('Tab');
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS stage 3: counted loops and teacher pause/resume');

    await teacher.locator('[data-teacher=next]').click();
    await a.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('駭客的最終程式'));
    await a.locator('#editor [data-move="2:-1"]').click();
    await a.locator('#editor [data-move="1:-1"]').click();
    await a.locator('#editor [data-field=mode]').selectOption('AND');
    await a.locator('#editor [data-field=limit]').fill('4');
    await a.locator('#editor [data-field=limit]').press('Tab');
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
    // Three adjacent swaps transform [GREEN,RED,BLUE] to [BLUE,RED,GREEN].
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
    await a.locator('#approveBtn').click();
    await b.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await b.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS lab role swap and loop challenge');

    await b.reload({waitUntil:'domcontentloaded'});
    await b.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('挑戰實驗室'));
    assert.match(await b.locator('#rolePill').textContent(),/拆彈操作員/);
    console.log('PASS browser refresh reconnect');

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
