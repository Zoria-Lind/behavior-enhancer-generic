// behavior-enhancer — Pi 适配器测试(无需 pi 安装)。
// 用 mock pi API(on 捕获 handler)按源码查证的 ExtensionAPI 形状合成事件,
// 断言 block/reason、content 覆盖、sections 注入、状态文件。运行:
//   node test/adapter.test.cjs

'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`(pass) ${name}`)
  } catch (e) {
    failed++
    console.log(`(fail) ${name}`)
    console.log(`  ${e.message}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// 每个测试用独立状态目录,重新 require 适配器(清空进程内状态)
function loadAdapter(stateDir) {
  process.env.BEHAVIOR_ENHANCER_STATE_DIR = stateDir
  for (const key of Object.keys(require.cache)) {
    if (key.includes('adapters' + path.sep + 'pi')) delete require.cache[key]
  }
  const factory = require('../extension/index.js')
  const handlers = new Map() // event → handler[]
  const pi = {
    on: (event, handler) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    sendMessage: (..._a) => {},
    registerCommand: (..._a) => {},
  }
  factory(pi)
  const emit = (event, payload, ctx = { cwd: stateDir }) => {
    let last
    for (const h of handlers.get(event) ?? []) {
      const r = h(payload, ctx)
      if (r !== undefined) last = r
    }
    return last
  }
  return { emit, handlers }
}
function callEvt(tool, input, id) {
  return { type: 'tool_call', toolName: tool, toolCallId: id, input }
}
function resultEvt(tool, input, content, isError, id) {
  return { type: 'tool_result', toolName: tool, toolCallId: id, input, content, isError }
}
const txt = (s) => [{ type: 'text', text: s }]
function readState(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'))
}

test('F1:重要文件未读 → tool_call block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export const a = 1\n')
  const ad = loadAdapter(dir)
  const r = ad.emit('tool_call', callEvt('write', { path: 'app.config.ts', content: 'x\n' }, 'w1'))
  assert(r?.block === true, '应 block')
  assert(r.reason.includes('重要文件'), `reason 应含"重要文件": ${r.reason}`)
  assert(readState(dir).stats['readBeforeWrite.denied'] === 1, 'denied 计数应为 1')
})

test('F1:read 后写 → 放行;覆盖按相对路径解析进注册表', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export const a = 1\n')
  const ad = loadAdapter(dir)
  const post = ad.emit('tool_result', resultEvt('read', { path: 'app.config.ts', offset: 1, limit: 1 }, txt('export const a = 1\n'), false, 'r1'))
  assert(post === undefined, 'read 结果不应被改写')
  const r = ad.emit('tool_call', callEvt('write', { path: 'app.config.ts', content: 'x\n' }, 'w1'))
  assert(r === undefined, '读满后写应放行')
  const st = readState(dir)
  const key = Object.keys(st.readRegistry)[0]
  assert(key.endsWith('app.config.ts'), `注册表键应为绝对路径: ${key}`)
})

test('F6:rm -rf 拦截 3 次,第 4 次逃生', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  const ad = loadAdapter(dir)
  for (let i = 1; i <= 3; i++) {
    const r = ad.emit('tool_call', callEvt('bash', { command: 'rm -rf x' }, `b${i}`))
    assert(r?.block === true, `第 ${i} 次应 block`)
    assert(r.reason.includes(`第 ${i} 次`), `第 ${i} 次文案`)
  }
  const r = ad.emit('tool_call', callEvt('bash', { command: 'rm -rf x' }, 'b4'))
  assert(r === undefined, '第 4 次应逃生放行')
  const s = readState(dir).stats
  assert(s['hardGate.denied'] === 3 && s['hardGate.escape'] === 1, `统计 ${JSON.stringify(s)}`)
})

test('F3b:失败后档位 1,并发第 2 个被 block;结果回来释放', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  const ad = loadAdapter(dir)
  const fail = ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('boom: not found'), true, 'f1'))
  assert(fail?.content?.slice(-1)[0]?.text.includes('档位已降为 1'), '失败应注入降档提醒')
  assert(ad.emit('tool_call', callEvt('bash', { command: 'ls' }, 'a1')) === undefined, 'A1 应放行')
  const b = ad.emit('tool_call', callEvt('bash', { command: 'ls' }, 'b1'))
  assert(b?.block === true && b.reason.includes('档位 1'), 'B1 应被窗口拦截')
  assert(ad.emit('tool_result', resultEvt('bash', { command: 'ls' }, txt('ok'), false, 'a1')) === undefined, 'A1 结果释放窗口')
  assert(ad.emit('tool_call', callEvt('bash', { command: 'ls' }, 'c1')) === undefined, '释放后 C1 应放行')
  const s = readState(dir).stats
  assert(s['behavior.serialized'] === 1, `serialized=${s['behavior.serialized']}`)
})

test('F4:同工具连续失败 2 次 → 停手提醒注入结果内容;成功后重置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  const ad = loadAdapter(dir)
  const first = ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('boom'), true, 'f1'))
  assert(!(first?.content?.slice(-1)[0]?.text ?? '').includes('连续失败'), '第 1 次只计数')
  const second = ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('boom'), true, 'f2'))
  assert(second?.content?.slice(-1)[0]?.text.includes('bash 已连续失败 2 次'), '第 2 次应注入停手提醒')
  const third = ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('ok'), false, 'f3'))
  assert(!(third?.content?.slice(-1)[0]?.text ?? '').includes('连续失败'), '成功后不再提醒')
  const s = readState(dir).stats
  assert(s['behavior.failures'] === 2 && s['behavior.alerts'] === 1, `统计 ${JSON.stringify(s)}`)
})

test('F5:写坏文件 → 自动回滚 + 结果内容报告', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export const a = 1\n')
  const ad = loadAdapter(dir)
  ad.emit('tool_result', resultEvt('read', { path: 'app.config.ts', offset: 1, limit: 1 }, txt('x'), false, 'r1'))
  assert(ad.emit('tool_call', callEvt('write', { path: 'app.config.ts', content: 'x\n' }, 'w1')) === undefined, 'pre 应放行并拍快照')
  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export const a = { broken\n') // 模拟执行落盘写坏
  const out = ad.emit('tool_result', resultEvt('write', { path: 'app.config.ts', content: 'x\n' }, txt('wrote'), false, 'w1'))
  assert(out?.content?.slice(-1)[0]?.text.includes('已自动回滚'), '应报告回滚')
  assert(fs.readFileSync(path.join(dir, 'app.config.ts'), 'utf8') === 'export const a = 1\n', '文件应恢复')
  assert(readState(dir).stats['postWriteCheck.rollbacks'] === 1, 'rollbacks 计数应为 1')
})

test('F5:新文件写坏 → 删除文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  const ad = loadAdapter(dir)
  assert(ad.emit('tool_call', callEvt('write', { path: 'new-file.json', content: '{"a":' }, 'w2')) === undefined, 'pre 应放行')
  fs.writeFileSync(path.join(dir, 'new-file.json'), '{"a":')
  const out = ad.emit('tool_result', resultEvt('write', { path: 'new-file.json', content: '{"a":' }, txt('wrote'), false, 'w2'))
  assert(out?.content?.slice(-1)[0]?.text.includes('回滚'), '应报告回滚')
  assert(!fs.existsSync(path.join(dir, 'new-file.json')), '新文件写坏应被删除')
})

test('F3b:阶梯恢复 1 → 连3成功 → 3 → 再3成功 → 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  const ad = loadAdapter(dir)
  ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('boom'), true, 'f0'))
  assert(readState(dir).tier === 1, '失败后档位应为 1')
  for (let i = 0; i < 3; i++) ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('ok'), false, `l${i}`))
  assert(readState(dir).tier === 3, '连 3 成功后档位应为 3')
  for (let i = 0; i < 3; i++) ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('ok'), false, `m${i}`))
  assert(readState(dir).tier === 0, '再 3 成功后档位应恢复不限')
  assert(readState(dir).stats['behavior.restored'] === 1, 'restored 计数应为 1')
})

test('F2:before_agent_start 注入纪律段(含实时档位行)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  const ad = loadAdapter(dir)
  const e = { type: 'before_agent_start', prompt: 'hi', systemPrompt: '', systemPromptOptions: { sections: {} } }
  ad.emit('before_agent_start', e)
  const sec = e.systemPromptOptions.sections['behavior-enhancer']
  assert(typeof sec === 'string' && sec.includes('先读后写'), '应注入纪律段')
  assert(sec.includes('当前 不限'), '应含实时档位行')
  ad.emit('tool_result', resultEvt('bash', { command: 'x' }, txt('boom'), true, 't1'))
  const e2 = { type: 'before_agent_start', prompt: 'hi', systemPrompt: '', systemPromptOptions: { sections: {} } }
  ad.emit('before_agent_start', e2)
  assert(e2.systemPromptOptions.sections['behavior-enhancer'].includes('当前 1 个'), '失败后档位行应实时变为 1 个')
})

test('F1:/force-read 标记(注释形态)未读 → block;正文提及不算(狗粮发现 #1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  fs.writeFileSync(path.join(dir, 'important.md'), '<!-- /force-read -->\n\n正文。\n')
  fs.writeFileSync(path.join(dir, 'notes.md'), '本文档说明 /force-read 标记的用法:行首注释形式才生效。\n')
  const ad = loadAdapter(dir)
  const r = ad.emit('tool_call', callEvt('write', { path: 'important.md', content: 'x\n' }, 'w1'))
  assert(r?.block === true && r.reason.includes('重要文件'), '注释形态标记应 block')
  const r2 = ad.emit('tool_call', callEvt('write', { path: 'notes.md', content: 'x\n' }, 'w2'))
  assert(r2 === undefined, '正文提及不应被拦')
  assert((readState(dir).stats['readBeforeWrite.denied'] ?? 0) === 1, 'denied 计数应为 1')
})

test('F5:含正则字面量的 .ts 写后不被误回滚(狗粮发现 #2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-pi-'))
  fs.writeFileSync(path.join(dir, 're-literal.ts'), 'export const a = 1\n')
  const ad = loadAdapter(dir)
  const content = 'const re = /\\[stderr\\][\\s\\S]{0,200}(error|can\'t)/im\nconst ok = (x: string) => x.match(re)\n'
  ad.emit('tool_result', resultEvt('read', { path: 're-literal.ts', offset: 1, limit: 1 }, txt('x'), false, 'r1'))
  assert(ad.emit('tool_call', callEvt('write', { path: 're-literal.ts', content }, 'w3')) === undefined, 'pre 应放行')
  fs.writeFileSync(path.join(dir, 're-literal.ts'), content) // 模拟执行落盘
  const out = ad.emit('tool_result', resultEvt('write', { path: 're-literal.ts', content }, txt('wrote'), false, 'w3'))
  assert(!(out?.content?.slice(-1)[0]?.text ?? '').includes('回滚'), '正则字面量不应触发误回滚')
  assert(fs.readFileSync(path.join(dir, 're-literal.ts'), 'utf8') === content, '文件内容应保留')
})

console.log(`\n${passed} pass, ${failed} fail`)
process.exit(failed > 0 ? 1 : 0)
