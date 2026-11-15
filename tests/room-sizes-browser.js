'use strict';
// Genuine browser coverage for teacher rooms with one or three students.
// TARGET_URL tests Render, otherwise the test starts an isolated local server.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createGameServer}=require('../src/server');
const game=process.env.TARGET_URL?null:createGameServer();
const errors=[];
const prefix=process.env.TARGET_URL?'render-':'local-';

async function run(){
  const port=game?await game.listen(0):0;
  const origin=process.env.TARGET_URL||'http://127.0.0.1:'+port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const contexts=[];
  async function page(){
    const context=await browser.newContext({viewport:{width:1280,height:920}});
    contexts.push(context);
    const p=await context.newPage();
    p.on('pageerror',err=>{errors.push(err.message);console.error('PAGE ERROR',err);});
    await p.goto(origin,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>document.querySelector('#network')?.classList.contains('online'),null,{timeout:30000});
    return p;
  }
  async function create(t){
    await t.locator('#createBtn').click();
    await t.waitForFunction(()=>/^[0-9A-F]{6}$/.test(document.querySelector('#roomLabel')?.textContent||''),null,{timeout:15000});
    return await t.locator('#roomLabel').textContent();
  }
  async function join(p,code,name){
    await p.locator('#nickname').fill(name);
    await p.locator('#roomCode').fill(code);
    await p.locator('#joinBtn').click();
    await p.locator('#gameScreen').waitFor({state:'visible'});
    await p.waitForFunction(code=>document.querySelector('#roomLabel')?.textContent===code,code,{timeout:15000});
  }
  async function bothPython(pages,fragment){
    await Promise.all(pages.map(p=>p.waitForFunction(fragment=>
      document.querySelector('#codeOutput')?.textContent.includes(fragment),fragment,{timeout:15000})));
  }
  try{
    // Case A: one student + teacher. Teacher plays a real participant
    // while preserving the room owner controls and private role isolation.
    const t=await page(),a=await page();
    const code=await create(t);
    await join(a,code,'唯一學生');
    await t.waitForFunction(()=>document.querySelector('[data-teacher=start]')?.disabled===false);
    await t.locator('[data-teacher=start]').click();
    await Promise.all([t,a].map(p=>p.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('數位線路危機'))));
    assert.match(await t.locator('#rolePill').textContent(),/程式分析員.*教師兼任/);
    assert.match(await a.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.equal(await t.locator('#teacherPanel').isVisible(),true);
    assert.equal(await a.locator('.mission-rule').count(),0);
    await a.locator('#editor [data-move="0:1"]').click();
    await a.locator('#editor [data-move="1:1"]').click();
    await bothPython([t,a],'activate("BLUE")\nactivate("RED")\nactivate("GREEN")');
    await t.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await t.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    await t.locator('[data-teacher=next]').click();
    await Promise.all([t,a].map(p=>p.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('邏輯密碼鎖'))));
    assert.match(await t.locator('#rolePill').textContent(),/拆彈操作員.*教師兼任/);
    assert.match(await a.locator('#rolePill').textContent(),/程式分析員/);
    assert.equal(await t.locator('.mission-rule').count(),0,'Teacher as operator must not see analyst answer');
    assert.equal(await t.locator('#teacherPanel').isVisible(),true);
    await t.locator('#editor [data-field=color]').selectOption('RED');
    await bothPython([t,a],'key_color == "RED"');
    await t.locator('#editor [data-field=threshold]').fill('50');
    await t.locator('#editor [data-field=threshold]').press('Tab');
    await bothPython([t,a],'power > 50');
    await t.locator('#editor [data-field=mode]').selectOption('AND');
    await bothPython([t,a],'key_color == "RED" and power > 50');
    await a.locator('#approveBtn').click();
    await t.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await t.locator('#runBtn').click();
    await t.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS teacher + one student: 2-person real-browser round, swapped roles, teacher controls, privacy');

    // Case B: three students + teacher (four distinct browser profiles).
    const host=await page(),p0=await page(),p1=await page(),p2=await page();
    const room=await create(host);
    await join(p0,room,'第一位');
    await join(p1,room,'第二位');
    await join(p2,room,'第三位');
    await host.waitForFunction(()=>document.querySelectorAll('#agents .agent').length===3);
    await host.locator('[data-teacher=start]').click();
    await Promise.all([p0,p1,p2].map(p=>p.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('數位線路危機'))));
    assert.match(await p0.locator('#rolePill').textContent(),/程式分析員/);
    assert.match(await p1.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await p2.locator('#rolePill').textContent(),/情報支援員/);
    assert.equal(await p2.locator('.mission-rule').count(),0);
    assert.equal(await p2.locator('#runBtn').isDisabled(),true);
    assert.equal(await p2.locator('#approveBtn').isDisabled(),true);
    await p2.locator('#messageInput').fill('觀察積木的執行順序！');
    await p2.locator('#messageForm button[type=submit]').click();
    await p0.waitForFunction(()=>document.querySelector('#comms')?.textContent.includes('觀察積木'));
    await p1.locator('#editor [data-move="0:1"]').click();
    await p1.locator('#editor [data-move="1:1"]').click();
    await bothPython([p0,p1,p2],'activate("BLUE")\nactivate("RED")\nactivate("GREEN")');
    await p0.locator('#approveBtn').click();
    await p1.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await p1.locator('#runBtn').click();
    await host.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    await host.locator('[data-teacher=next]').click();
    await Promise.all([p0,p1,p2].map(p=>p.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('邏輯密碼鎖'))));
    assert.match(await p0.locator('#rolePill').textContent(),/情報支援員/);
    assert.match(await p1.locator('#rolePill').textContent(),/程式分析員/);
    assert.match(await p2.locator('#rolePill').textContent(),/拆彈操作員/);
    await p2.locator('#editor [data-field=color]').selectOption('RED');
    await bothPython([p1,p2],'key_color == "RED"');
    await p2.locator('#editor [data-field=threshold]').fill('50');
    await p2.locator('#editor [data-field=threshold]').press('Tab');
    await bothPython([p1,p2],'power > 50');
    await p2.locator('#editor [data-field=mode]').selectOption('AND');
    await bothPython([p1,p2],'key_color == "RED" and power > 50');
    await p1.locator('#approveBtn').click();
    await p2.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await p2.locator('#runBtn').click();
    await host.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    await host.locator('[data-teacher=next]').click();
    await Promise.all([p0,p1,p2].map(p=>p.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('無限倒數陷阱'))));
    assert.match(await p0.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await p1.locator('#rolePill').textContent(),/情報支援員/);
    assert.match(await p2.locator('#rolePill').textContent(),/程式分析員/);
    assert.equal(await host.locator('#teacherPanel').isVisible(),true);
    console.log('PASS teacher + three students: 4 real browsers, observer isolation and 3-way role rotation');
    assert.deepEqual(errors,[]);
    await host.screenshot({path:prefix+'three-student-roster.png',fullPage:true});
  }catch(err){console.error('Roster browser check failed',err);throw err;}
  finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{if(game)await game.close();});
