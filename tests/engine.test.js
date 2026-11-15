const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makePuzzle,modify,evaluate,validateLabSpec,visiblePuzzle,countLoop,toCode,toPython,objective,briefing } = require('../src/engine');

test('stage 1 sequence: rejects shortcut and accepts correct order',()=>{
  const p=makePuzzle('sequence'); assert.equal(evaluate(p).success,false);
  assert.throws(()=>modify(p,{blocks:['BLUE']}),/只能排列/);
  modify(p,{blocks:['BLUE','RED','GREEN']}); assert.equal(evaluate(p).success,true);
});
test('stage 2 AND / OR and truth tables',()=>{
  const p=makePuzzle('condition'); assert.equal(evaluate(p).success,false);
  modify(p,{blocks:{color:'RED',threshold:50,mode:'AND',secondColor:'BLUE',secondThreshold:70,useSecond:false}});
  assert.equal(evaluate(p).success,true);
  p.blocks.mode='OR';assert.equal(evaluate(p).success,false);
});
test('advanced condition has two groups and cannot disable one',()=>{
  const p=makePuzzle('condition',true);
  assert.throws(()=>modify(p,{blocks:{...p.blocks,useSecond:false}}),/允許/);
  modify(p,{blocks:{color:'RED',threshold:50,mode:'AND',secondColor:'BLUE',secondThreshold:70,useSecond:true}});
  assert.equal(evaluate(p).success,true);
});
test('loop counts bounded and stage 3 passes',()=>{
  const p=makePuzzle('loop'); assert.equal(countLoop({start:0,limit:12,step:0}),-1);
  modify(p,{blocks:{start:0,limit:4,step:1}});
  assert.equal(evaluate(p).success,true);
  assert.match(toCode(p),/for /);
});
test('debug must satisfy all three checks',()=>{
  const p=makePuzzle('debug'); assert.equal(evaluate(p).success,false);
  modify(p,{blocks:{order:['VERIFY','SWEEP','SEAL'],mode:'AND',color:'RED',threshold:50,start:0,limit:4,step:1}});
  assert.equal(evaluate(p).success,true);
});
test('lab goals validated and hidden from operator',()=>{
  const cfg=validateLabSpec({kind:'loop',target:7});
  const p=makePuzzle('lab',false,cfg);
  assert.equal(visiblePuzzle(p,false).objective,undefined);
  assert.match(visiblePuzzle(p,true).objective,/7/);
  assert.throws(()=>validateLabSpec({kind:'loop',target:999}),/2～10/);
});
test('blocked injection / invalid controls',()=>{
  const p=makePuzzle('condition');
  assert.throws(()=>modify(p,{blocks:{...p.blocks,color:'RED"); process.exit(); //'}}),/不合法|允許/);
  assert.doesNotMatch(toCode(p),/process.exit/);
});

test('lab OR wording never incorrectly says AND and analyst has explicit directions',()=>{
  const p=makePuzzle('lab',false,validateLabSpec({kind:'condition',color:'YELLOW',threshold:80,mode:'OR'}));
  const analyst=visiblePuzzle(p,true),operator=visiblePuzzle(p,false);
  assert.match(analyst.objective,/YELLOW/);
  assert.match(analyst.objective,/或（OR/);
  assert.doesNotMatch(analyst.objective,/且能源/);
  assert.equal(operator.objective,undefined);
  assert.equal(operator.briefing,undefined);
  assert.match(analyst.briefing.rule,/或（OR/);
  assert.match(analyst.briefing.steps[0],/YELLOW/);
  assert.match(analyst.briefing.steps[0],/OR/);
  assert.equal(analyst.briefing.steps.length>=3,true);
  assert.equal(analyst.python,operator.python);
  assert.match(analyst.python,/key_color == "BLUE" or power > 50/);
  assert.doesNotMatch(analyst.python,/===|&&|;/);
  assert.equal(objective(p),analyst.objective);
  assert.equal(briefing(p).rule,analyst.objective);
});
test('lab AND wording correct and exact settings are required beyond truth-table coincidences',()=>{
  const p=makePuzzle('lab',false,validateLabSpec({kind:'condition',color:'YELLOW',threshold:80,mode:'AND'}));
  assert.match(objective(p),/且（AND/);
  assert.doesNotMatch(objective(p),/或（OR/);
  // One-unit change may not affect any sampled input, but should still fail.
  modify(p,{blocks:{color:'YELLOW',threshold:79,mode:'AND',secondColor:'BLUE',secondThreshold:70,useSecond:false}});
  assert.equal(evaluate(p).success,false);
  assert.equal(evaluate(p).trace.at(-1).ok,false);
  modify(p,{blocks:{color:'YELLOW',threshold:80,mode:'AND',secondColor:'BLUE',secondThreshold:70,useSecond:false}});
  assert.equal(evaluate(p).success,true);
});
test('Python generated from Scratch blocks, no JavaScript syntax is exposed',()=>{
  const seq=toPython(makePuzzle('sequence'));assert.match(seq,/activate\("GREEN"\)/);assert.doesNotMatch(seq,/;/);
  const cond=toPython(makePuzzle('condition'));assert.match(cond,/if \(key_color == "BLUE" or power > 60\):/);
  const loop=toPython(makePuzzle('loop'));assert.match(loop,/for i in range\(0, 3, 1\):/);
  const debug=toPython(makePuzzle('debug'));assert.match(debug,/if \(key_color == "RED" or power > 50\):/);
  assert.equal(toCode(makePuzzle('sequence')).includes(';'),false);
});
