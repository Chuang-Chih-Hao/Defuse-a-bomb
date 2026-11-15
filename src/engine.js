'use strict';

// The trusted, server-side instructional VM. Never eval or run user JavaScript.
const COLORS = ['BLUE', 'RED', 'GREEN', 'YELLOW'];
const STEPS = ['VERIFY', 'SWEEP', 'SEAL', 'REPORT'];
const STAGES = ['sequence', 'condition', 'loop', 'debug'];
const TITLES = {
  sequence: '數位線路危機',
  condition: '邏輯密碼鎖',
  loop: '無限倒數陷阱',
  debug: '駭客的最終程式',
  lab: '挑戰實驗室'
};
const int = (v, a, b, fallback) => Number.isInteger(Number(v)) && Number(v) >= a && Number(v) <= b ? Number(v) : fallback;
const isColor = x => COLORS.includes(x);
const isStep = x => STEPS.includes(x);
const safeMode = x => x === 'AND' || x === 'OR';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makePuzzle(stage, advanced = false, spec = null) {
  if (stage === 'lab') {
    if (!spec) throw Error('missing lab spec');
    if (spec.kind === 'sequence') {
      const target = spec.target.slice();
      return { kind: 'sequence', target, blocks: target.slice().reverse(), scenarios: [], label: '自訂訊號路徑' };
    }
    if (spec.kind === 'condition') {
      const answer = { color: spec.color, threshold: spec.threshold, mode: spec.mode, secondColor: 'BLUE', secondThreshold: 70, useSecond: false };
      const scenarios = [
        { color: spec.color, power: spec.threshold + 15 },
        { color: spec.color, power: spec.threshold - 10 },
        { color: spec.color === 'RED' ? 'BLUE' : 'RED', power: spec.threshold + 15 },
        { color: spec.color === 'RED' ? 'BLUE' : 'RED', power: spec.threshold - 10 }
      ].map(x => ({ ...x, expected: truth(x, answer) }));
      return { kind: 'condition', answer, blocks: { color: 'BLUE', threshold: 50, mode: 'OR', secondColor: 'BLUE', secondThreshold: 70, useSecond: false }, scenarios, label: '自訂權限鎖' };
    }
    return { kind: 'loop', target: spec.target, blocks: { start: 0, limit: 3, step: 1 }, scenarios: [], label: '自訂能源陣列' };
  }
  if (stage === 'sequence') {
    const target = advanced ? ['BLUE', 'RED', 'GREEN', 'YELLOW'] : ['BLUE', 'RED', 'GREEN'];
    return { kind: stage, target, blocks: advanced ? ['GREEN', 'YELLOW', 'RED', 'BLUE'] : ['GREEN', 'BLUE', 'RED'], scenarios: [], label: '安全訊號次序' };
  }
  if (stage === 'condition') {
    const answer = { color: 'RED', threshold: 50, mode: 'AND', secondColor: 'BLUE', secondThreshold: 70, useSecond: advanced };
    const cases = [
      { color: 'RED', power: 90 }, { color: 'RED', power: 40 },
      { color: 'BLUE', power: 85 }, { color: 'BLUE', power: 30 },
      { color: 'RED', power: 55 }, { color: 'GREEN', power: 95 },
      { color: 'BLUE', power: 65 }
    ];
    return { kind: stage, answer, blocks: { color: 'BLUE', threshold: 60, mode: 'OR', secondColor: 'GREEN', secondThreshold: 60, useSecond: advanced }, scenarios: cases.map(x => ({ ...x, expected: truth(x, answer) })), label: '權限驗證演算' };
  }
  if (stage === 'loop') {
    return { kind: stage, target: advanced ? 6 : 4, blocks: { start: 0, limit: 3, step: 1 }, scenarios: [], label: '虛擬模組清除' };
  }
  if (stage === 'debug') {
    return {
      kind: stage,
      target: advanced ? ['VERIFY', 'SWEEP', 'SEAL', 'REPORT'] : ['VERIFY', 'SWEEP', 'SEAL'],
      expectedMode: 'AND',
      expectedLimit: advanced ? 6 : 4,
      blocks: {
        order: advanced ? ['SEAL', 'REPORT', 'SWEEP', 'VERIFY'] : ['SWEEP', 'SEAL', 'VERIFY'],
        mode: 'OR', color: 'RED', threshold: 50, start: 0, limit: 3, step: 1
      },
      scenarios: [{ color: 'RED', power: 80 }, { color: 'RED', power: 35 }, { color: 'BLUE', power: 80 }],
      label: '核心除錯終端'
    };
  }
  throw Error('invalid stage');
}

function truth(input, b) {
  const a = input.color === b.color;
  const p = input.power > b.threshold;
  const primary = b.mode === 'AND' ? (a && p) : (a || p);
  const secondary = Boolean(b.useSecond) && input.color === b.secondColor && input.power > b.secondThreshold;
  return primary || secondary;
}
function countLoop(b) {
  if (b.step < 1 || b.start < 0 || b.limit < 1 || b.limit > 12 || b.start > 11) return -1;
  let n = 0;
  for (let i = b.start; i < b.limit && n < 13; i += b.step) n++;
  return n;
}
function validPermutation(value, reference) {
  return Array.isArray(value) && value.length === reference.length &&
    equal(value.slice().sort(), reference.slice().sort());
}
function modify(puzzle, update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw Error('指令格式錯誤');
  if (puzzle.kind === 'sequence') {
    if (!validPermutation(update.blocks, puzzle.target) || !update.blocks.every(isColor)) throw Error('只能排列既有訊號卡');
    puzzle.blocks = update.blocks.slice();
  } else if (puzzle.kind === 'condition') {
    const b = update.blocks;
    if (!b || !isColor(b.color) || !safeMode(b.mode) || !isColor(b.secondColor) ||
        !Number.isInteger(b.threshold) || b.threshold < 0 || b.threshold > 100 ||
        !Number.isInteger(b.secondThreshold) || b.secondThreshold < 0 || b.secondThreshold > 100 ||
        typeof b.useSecond !== 'boolean' || b.useSecond !== Boolean(puzzle.answer.useSecond)) throw Error('條件參數超出允許範圍');
    puzzle.blocks = { ...b };
  } else if (puzzle.kind === 'loop') {
    const b = update.blocks;
    if (!b || ![b.start, b.limit, b.step].every(Number.isInteger) ||
        b.start < 0 || b.start > 11 || b.limit < 1 || b.limit > 12 || b.step < 1 || b.step > 6) throw Error('迴圈數值需在允許範圍');
    puzzle.blocks = { ...b };
  } else if (puzzle.kind === 'debug') {
    const b = update.blocks;
    if (!b || !validPermutation(b.order, puzzle.target) || !b.order.every(isStep) ||
        !safeMode(b.mode) || !isColor(b.color) || ![b.threshold,b.start,b.limit,b.step].every(Number.isInteger) ||
        b.threshold < 0 || b.threshold > 100 || b.start < 0 || b.start > 11 ||
        b.limit < 1 || b.limit > 12 || b.step < 1 || b.step > 6) throw Error('除錯參數不合法');
    puzzle.blocks = { ...b, order: b.order.slice() };
  } else throw Error('未知指令');
}
function evaluate(p) {
  const b = p.blocks;
  if (p.kind === 'sequence') {
    const trace = b.map((v, i) => ({ title: '啟動 ' + v + ' 訊號', ok: v === p.target[i] }));
    return { success: trace.every(x => x.ok), trace, reason: trace.every(x => x.ok) ? '順序完全正確' : '模組順序與控制規則不符' };
  }
  if (p.kind === 'condition') {
    const trace = p.scenarios.map((c, i) => ({
      title: '測試 ' + (i + 1) + '：' + c.color + '／能源 ' + c.power,
      ok: truth(c, b) === c.expected,
      actual: truth(c,b) ? '開啟' : '鎖定'
    }));
    // Matching a small truth table is not enough: an unintended threshold
    // can pass samples while still changing the actual access rule.
    const exact = b.color === p.answer.color && b.mode === p.answer.mode &&
      b.threshold === p.answer.threshold && Boolean(b.useSecond) === Boolean(p.answer.useSecond) &&
      (!p.answer.useSecond ||
        (b.secondColor === p.answer.secondColor && b.secondThreshold === p.answer.secondThreshold));
    trace.push({title:'設定參數與任務規格相符',ok:exact});
    const success = exact && trace.every(x => x.ok);
    return {success,trace,reason:success ? '條件設定與所有測試情境均正確' : '條件參數或邏輯仍有錯誤，請與分析員核對任務卡' };
  }
  if (p.kind === 'loop') {
    const count = countLoop(b);
    const trace = Array.from({ length: Math.max(0,count) }, (_, i) => ({ title: '解除模組 #' + (i+1), ok: i < p.target }));
    const success = count === p.target;
    return { success, trace, reason: '執行 ' + count + ' 次；所需次數由分析員掌握' };
  }
  const seq = equal(b.order, p.target);
  const flag = b.mode === p.expectedMode && b.color === 'RED' && b.threshold === 50;
  const count = countLoop(b);
  const loop = count === p.expectedLimit;
  const trace = [
    { title: '執行順序檢查', ok: seq },
    { title: '條件式邏輯檢查', ok: flag },
    { title: '重複指令檢查（' + count + ' 次）', ok: loop }
  ];
  return { success: seq && flag && loop, trace, reason: seq && flag && loop ? '系統完整修復' : '找到錯誤模組後修正並重新執行' };
}
function toPython(p) {
  // Read-only teaching representation. The game never runs arbitrary Python.
  const b = p.blocks;
  const condition = (b, advanced = false) => {
    const op = b.mode === 'AND' ? 'and' : 'or';
    const first = '(key_color == "' + b.color + '" ' + op + ' power > ' + b.threshold + ')';
    return advanced && b.useSecond
      ? first + ' or (key_color == "' + b.secondColor + '" and power > ' + b.secondThreshold + ')'
      : first;
  };
  if (p.kind === 'sequence') return b.map(c => 'activate("' + c + '")').join('\n');
  if (p.kind === 'condition') return 'if ' + condition(b, true) + ':\n    unlock()\nelse:\n    keep_locked()';
  if (p.kind === 'loop') return 'for i in range(' + b.start + ', ' + b.limit + ', ' + b.step + '):\n    disable_module()';
  return b.order.map(x => x.toLowerCase() + '()').join('\n') +
    '\nif ' + condition(b) + ':\n    unlock()' +
    '\nfor i in range(' + b.start + ', ' + b.limit + ', ' + b.step + '):\n    disable_module()';
}
// Backwards-compatible API name for tests. Both now return Python, not JS.
const toCode = toPython;
function validateLabSpec(s) {
  if (!s || !['sequence','condition','loop'].includes(s.kind)) throw Error('請選擇實驗類型');
  if (s.kind === 'sequence') {
    if (!Array.isArray(s.target) || s.target.length < 3 || s.target.length > 4 ||
        new Set(s.target).size !== s.target.length || !s.target.every(isColor)) throw Error('訊號需為 3 至 4 種不同顏色');
    return { kind: 'sequence', target: s.target.slice() };
  }
  if (s.kind === 'condition') {
    if (!isColor(s.color) || !safeMode(s.mode) || !Number.isInteger(s.threshold) ||
        s.threshold < 20 || s.threshold > 80) throw Error('條件參數不合法');
    return { kind: 'condition', color: s.color, mode: s.mode, threshold: s.threshold };
  }
  if (!Number.isInteger(s.target) || s.target < 2 || s.target > 10) throw Error('目標次數必須介於 2～10');
  return { kind: 'loop', target: s.target };
}
const colorName = {BLUE:'藍色 BLUE', RED:'紅色 RED', GREEN:'綠色 GREEN', YELLOW:'黃色 YELLOW'};
const stepName = {VERIFY:'驗證', SWEEP:'清除', SEAL:'封存', REPORT:'報告'};
function objective(p) {
  if (p.kind === 'sequence') return '依照 ' + p.target.map(x => colorName[x]).join(' → ') + ' 的順序啟動模組';
  if (p.kind === 'condition') {
    const op = p.answer.mode === 'AND' ? '且（AND，兩項都要成立）' : '或（OR，任一項成立即可）';
    const first = '顏色為 ' + colorName[p.answer.color] + ' ' + op + ' 能源 > ' + p.answer.threshold;
    return first + (p.answer.useSecond ?
      '；或額外符合「顏色為 ' + colorName[p.answer.secondColor] + ' 且能源 > ' + p.answer.secondThreshold + '」' : '');
  }
  if (p.kind === 'loop') return '讓虛擬模組剛好執行 ' + p.target + ' 次';
  return '正確順序：' + p.target.map(x=>stepName[x]).join(' → ') +
    '；條件為顏色 RED 且能源 > 50（AND）；迴圈需執行 ' + p.expectedLimit + ' 次';
}
function briefing(p) {
  if(p.kind === 'sequence')return {
    title:'依序啟動安全訊號',
    rule:objective(p),
    steps:['請把顏色順序逐一告訴操作員。','請操作員用箭頭或拖曳排好訊號積木。','確認程式順序正確後，按「核准」讓隊友執行。']
  };
  if(p.kind === 'condition')return {
    title:'修正 IF 條件，讓數位密碼鎖正確工作',
    rule:objective(p),
    steps:[
      '先告訴操作員：顏色選「' + colorName[p.answer.color] + '」、運算子選「'+p.answer.mode+'」、能源門檻為「'+p.answer.threshold+'」。',
      ...(p.answer.useSecond ? ['進階規則：第二組顏色為「'+colorName[p.answer.secondColor]+'」，能源門檻「'+p.answer.secondThreshold+'」。']:[]),
      'AND 是兩項都要成立；OR 是只要其中一項成立。請用測試情境檢查判斷。',
      '操作員調整後，請按「核准」，再請對方執行。'
    ]
  };
  if(p.kind === 'loop')return {
    title:'設定正確的重複次數',
    rule:objective(p),
    steps:['告訴操作員這次要執行「'+p.target+' 次」。','引導隊友調整起點、終點、每次增加值，使 i 迭代次數剛好符合目標。','確認後按「核准」，請操作員執行並觀察動畫。']
  };
  return {
    title:'修復三個程式錯誤',
    rule:objective(p),
    steps:['先說出正確的訊號執行順序。','請操作員修正 if 條件：「RED 且能源 > 50」。','請操作員調整 for 迴圈，使模組執行 '+p.expectedLimit+' 次。','全部完成後按「核准」，觀察結果定位未修正的 Bug。']
  };
}
function visiblePuzzle(p, isAnalyst) {
  return {
    kind: p.kind, label: p.label, blocks: structuredClone(p.blocks), python: toPython(p),
    scenarios: p.scenarios.map(c => ({ color: c.color, power: c.power, ...(isAnalyst ? { expected: c.expected } : {}) })),
    ...(isAnalyst ? { objective: objective(p), briefing: briefing(p) } : {})
  };
}
module.exports = { COLORS,STEPS,STAGES,TITLES,int,makePuzzle,modify,evaluate,toCode,toPython,objective,briefing,validateLabSpec,visiblePuzzle,truth,countLoop };
