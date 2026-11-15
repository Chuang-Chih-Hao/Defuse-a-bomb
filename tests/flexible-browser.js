'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createGameServer}=require('../src/server');
const game=process.env.TARGET_URL?null:createGameServer();
const failures=[];
async function main(){
  const port=game?await game.listen(0):null;
  const url=process.env.TARGET_URL||('http://127.0.0.1:'+port);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const pages=[];
    for(let i=0;i<5;i++){
      const context=await browser.newContext({viewport:{width:1280,height:900}});
      const page=await context.newPage();
      page.on('pageerror',e=>failures.push(e.message));
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#network')?.classList.contains('online'),null,{timeout:30000});
      pages.push(page);
    }
    const [teacher,a,b,c,over]=pages;
    await teacher.locator('#createBtn').click();
    await teacher.waitForFunction(()=>/^[A-F0-9]{6}$/.test(document.querySelector('#roomLabel')?.textContent||''),null,{timeout:15000});
    const room=await teacher.locator('#roomLabel').textContent();
    async function join(page,name){
      await page.locator('#nickname').fill(name);
      await page.locator('#roomCode').fill(room);
      await page.locator('#joinBtn').click();
      await page.locator('#gameScreen').waitFor({state:'visible'});
      await page.waitForFunction(()=>document.querySelector('#rolePill')?.textContent?.length>0);
    }
    await join(a,'學員甲');
    await teacher.waitForFunction(()=>!document.querySelector('[data-teacher="start"]')?.disabled);
    await teacher.locator('[data-teacher="start"]').click();
    await Promise.all([teacher,a].map(p=>p.waitForFunction(()=>document.querySelector('#stageHeading')?.textContent.includes('數位線路'))));
    assert.match(await a.locator('#rolePill').textContent(),/拆彈操作員/);
    assert.match(await teacher.locator('#turnTitle').textContent(),/老師兼分析員/);
    assert.equal(await teacher.locator('#approveBtn').isDisabled(),false);
    assert.equal(await a.locator('#approveBtn').isDisabled(),true);
    console.log('PASS teacher + one student can start, teacher acts as analyst');

    await a.locator('[data-move="0:1"]').click();
    await a.locator('[data-move="1:1"]').click();
    await teacher.waitForFunction(()=>document.querySelector('#codeOutput')?.textContent==='activate("BLUE")\nactivate("RED")\nactivate("GREEN")');
    await teacher.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS teacher approves student program without second student');

    await teacher.locator('[data-teacher=retry]').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('已啟動'));
    await join(b,'學員乙');
    await b.waitForFunction(()=>document.querySelector('#rolePill')?.textContent.includes('觀察'));
    assert.equal(await b.locator('#runBtn').isDisabled(),true);
    assert.equal(await b.locator('#approveBtn').isDisabled(),true);
    await join(c,'學員丙');
    await c.waitForFunction(()=>document.querySelector('#rolePill')?.textContent.includes('觀察'));
    assert.match(await teacher.locator('#teacherSummary').textContent(),/3\/3/);
    console.log('PASS late joiners do not seize roles mid-stage');

    await over.locator('#nickname').fill('第四位');
    await over.locator('#roomCode').fill(room);
    await over.locator('#joinBtn').click();
    await over.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('最多可加入三位'));
    assert.equal(await over.locator('#gameScreen').isVisible(),false);
    console.log('PASS fourth student is rejected');

    async function jump(stage){
      await teacher.locator('#stageSelect').selectOption(String(stage));
      await teacher.locator('#jumpStage').click();
      await Promise.all([a,b,c].map(p=>p.waitForFunction(n=>document.querySelector('#stageCaption')?.textContent.includes('0'+(n+1)+' / 07'),stage,{timeout:12000})));
    }
    await jump(0);
    assert.match(await a.locator('#rolePill').textContent(),/分析員/);
    assert.match(await b.locator('#rolePill').textContent(),/操作員/);
    assert.match(await c.locator('#rolePill').textContent(),/觀察/);
    assert.equal(await c.locator('#runBtn').isDisabled(),true);

    await jump(1);
    assert.match(await a.locator('#rolePill').textContent(),/觀察/);
    assert.match(await b.locator('#rolePill').textContent(),/分析員/);
    assert.match(await c.locator('#rolePill').textContent(),/操作員/);

    await jump(2);
    assert.match(await a.locator('#rolePill').textContent(),/操作員/);
    assert.match(await b.locator('#rolePill').textContent(),/觀察/);
    assert.match(await c.locator('#rolePill').textContent(),/分析員/);
    assert.equal(await b.locator('#approveBtn').isDisabled(),true);
    console.log('PASS three-student round-robin roles across stages');

    await a.locator('#editor [data-field=limit]').fill('4');
    await a.locator('#editor [data-field=limit]').press('Tab');
    await Promise.all([a,c].map(p=>p.waitForFunction(()=>document.querySelector('#codeOutput')?.textContent.includes('range(0, 4, 1)'))));
    await c.locator('#approveBtn').click();
    await a.waitForFunction(()=>!document.querySelector('#runBtn')?.disabled);
    await a.locator('#runBtn').click();
    await teacher.waitForFunction(()=>document.querySelector('#systemStatus')?.textContent.includes('安全解除'));
    console.log('PASS three-student team still executes genuine puzzle');

    await c.reload({waitUntil:'domcontentloaded'});
    await c.waitForFunction(()=>document.querySelector('#rolePill')?.textContent.includes('分析員'),null,{timeout:15000});
    console.log('PASS analyst identity survives refresh');
    assert.deepEqual(failures,[]);
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(game)await game.close();});
