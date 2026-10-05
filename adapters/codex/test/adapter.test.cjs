// behavior-enhancer — Codex 适配器测试(无需 codex CLI)。
// 模拟 Codex 的 hook 调用协议:stdin 单行 JSON → stdout 输出;每个测试用独立
// 临时状态目录(BEHAVIOR_ENHANCER_STATE_DIR)。运行:node test/adapter.test.cjs

'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const HOOKS = path.join(__dirname, '..', 'hooks')
const PRE = path.join(HOOKS, 'pre_tool_use.cjs')
const POST = path.join(HOOKS, 'post_tool_use.cjs')

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

function makeEnv(stateDir) {
  return { ...process.env, BEHAVIOR_ENHANCER_STATE_DIR: stateDir }
}
function run(script, input, stateDir) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: makeEnv(stateDir),
    timeout: 30000,
  })
  assert(r.status === 0, `hook 进程异常退出(${r.status}): ${r.stderr}`)
  const out = r.stdout.trim()
  return out === '' ? null : JSON.parse(out)
}
function readState(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'))
}
function callInput(tool, toolInput, toolUseId) {
  return {
    session_id: 's1', turn_id: 't1', tool_name: tool,
    tool_input: toolInput, tool_use_id: toolUseId ?? `${tool}-${Math.random().toString(36).slice(2)}`,
    cwd: process.cwd(), model: 'gpt-test', permission_mode: 'default',
  }
}
function postInput(tool, toolInput, toolResponse, toolUseId) {
  return { ...callInput(tool, toolInput, toolUseId), tool_response: toolResponse }
}
const BASH_OK = { stdout: 'ok', stderr: '', exit_code: 0 }
const BASH_FAIL = { stdout: '', stderr: 'boom: no such file or directory', exit_code: 1 }

test('F1:重要文件未读 → PreToolUse deny', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export const a = 1\n')
  const f = path.join(dir, 'app.config.ts')
  const out = run(PRE, callInput('Write', { file_path: f, content: 'x\n' }), dir)
  assert(out && out.hookSpecificOutput?.permissionDecision === 'deny', '应输出 deny JSON')
  assert(out.hookSpecificOutput.permissionDecisionReason.includes('重要文件'), 'deny 原因应含"重要文件"')
  assert(readState(dir).stats['readBeforeWrite.denied'] === 1, 'denied 计数应为 1')
})

test('F1:/force-read 标记(注释形态)未读 → deny', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  fs.writeFileSync(path.join(dir, 'important.md'), '<!-- /force-read -->\n\n正文。\n')
  const out = run(PRE, callInput('Write', { file_path: path.join(dir, 'important.md'), content: 'x\n' }), dir)
  assert(out && out.hookSpecificOutput?.permissionDecision === 'deny', '应 deny')
})

test('F1:正文提到 /force-read 不算标记 → 不拦截(狗粮发现 #1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  fs.writeFileSync(path.join(dir, 'notes.md'), '本文档说明 /force-read 标记的用法:行首注释形式才生效。\n')
  const out = run(PRE, callInput('Write', { file_path: path.join(dir, 'notes.md'), content: 'x\n' }), dir)
  assert(out === null, '正文提及不应被拦')
  assert((readState(dir).stats['readBeforeWrite.denied'] ?? 0) === 0, 'denied 计数应为 0')
})

test('F5:含正则字面量的 .ts 写后不被误回滚(狗粮发现 #2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const f = path.join(dir, 're-literal.ts')
  const content = 'const re = /\\[stderr\\][\\s\\S]{0,200}(error|can\'t)/im\nconst ok = (x: string) => x.match(re)\n'
  fs.writeFileSync(f, 'export const a = 1\n')
  run(POST, postInput('Read', { file_path: f, offset: 1, limit: 1 }, { content: 'export const a = 1\n' }, 'R1'), dir)
  assert(run(PRE, callInput('Write', { file_path: f, content }, 'R2'), dir) === null, 'pre 应放行')
  fs.writeFileSync(f, content) // 模拟引擎落盘
  const out = run(POST, postInput('Write', { file_path: f, content }, { ok: true }, 'R2'), dir)
  assert(!(out?.hookSpecificOutput?.additionalContext ?? '').includes('回滚'), '正则字面量不应触发误回滚')
  assert(fs.readFileSync(f, 'utf8') === content, '文件内容应保留')
})

test('F1:Read 后写 → 放行(空 stdout)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export const a = 1\n')
  const f = path.join(dir, 'app.config.ts')
  const readOut = run(POST, postInput('Read', { file_path: f, offset: 1, limit: 1 }, { content: 'export const a = 1\n' }), dir)
  assert(readOut === null, 'Read 后记覆盖应无输出')
  const out = run(PRE, callInput('Write', { file_path: f, content: 'x\n' }), dir)
  assert(out === null, '读满后写应放行')
})

test('F6:rm -rf 拦截 3 次,第 4 次逃生', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  for (let i = 1; i <= 3; i++) {
    const out = run(PRE, callInput('Bash', { command: 'rm -rf x' }), dir)
    assert(out && out.hookSpecificOutput?.permissionDecision === 'deny', `第 ${i} 次应 deny`)
    assert(out.hookSpecificOutput.permissionDecisionReason.includes(`第 ${i} 次`), `第 ${i} 次 deny 文案`)
  }
  const escaped = run(PRE, callInput('Bash', { command: 'rm -rf x' }), dir)
  assert(escaped === null, '第 4 次应逃生放行')
  const s = readState(dir).stats
  assert(s['hardGate.denied'] === 3 && s['hardGate.escape'] === 1, `统计 ${JSON.stringify(s)}`)
})

test('F3b:失败后档位 1,并发第 2 个被 deny;post 后恢复计数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const failOut = run(POST, postInput('Bash', { command: 'ls /nonexistent' }, BASH_FAIL, 'A0'), dir)
  assert(failOut?.hookSpecificOutput?.additionalContext?.includes('档位已降为 1'), '失败应注入降档提醒')
  // 调用 A 进入 in-flight
  assert(run(PRE, callInput('Bash', { command: 'ls' }, 'A1'), dir) === null, 'A1 应放行(档位 1,当前 0 在飞)')
  // 调用 B:窗口 veto
  const denied = run(PRE, callInput('Bash', { command: 'ls' }, 'B1'), dir)
  assert(denied?.hookSpecificOutput?.permissionDecision === 'deny', 'B1 应被窗口拦截')
  assert(denied.hookSpecificOutput.permissionDecisionReason.includes('档位 1'), '拦截文案应含档位')
  // A1 完成:post 移除 in-flight;成功连击 1
  assert(run(POST, postInput('Bash', { command: 'ls' }, BASH_OK, 'A1'), dir) === null, 'A1 post 应无输出')
  assert(run(PRE, callInput('Bash', { command: 'ls' }, 'C1'), dir) === null, 'A1 结束后 C1 应放行')
  assert(run(POST, postInput('Bash', { command: 'ls' }, BASH_OK, 'C1'), dir) === null, 'C1 post 无输出')
  const s = readState(dir).stats
  assert(s['behavior.serialized'] === 1, `serialized=${s['behavior.serialized']}`)
})

test('F4:同工具连续失败 2 次 → 停手提醒;成功后重置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const first = run(POST, postInput('Bash', { command: 'x' }, BASH_FAIL, 'F1'), dir)
  assert(!(first?.hookSpecificOutput?.additionalContext ?? '').includes('连续失败'), '第 1 次只计数')
  const second = run(POST, postInput('Bash', { command: 'x' }, BASH_FAIL, 'F2'), dir)
  assert(second?.hookSpecificOutput?.additionalContext?.includes('Bash 已连续失败 2 次'), '第 2 次应注入停手提醒')
  const third = run(POST, postInput('Bash', { command: 'x' }, BASH_OK, 'F3'), dir)
  assert(!(third?.hookSpecificOutput?.additionalContext ?? '').includes('连续失败'), '成功后不再提醒')
  const s = readState(dir).stats
  assert(s['behavior.failures'] === 2 && s['behavior.alerts'] === 1, `统计 ${JSON.stringify(s)}`)
})

test('F5:写坏文件 → 自动回滚 + 报告', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const f = path.join(dir, 'app.config.ts')
  const original = 'export const a = 1\n'
  fs.writeFileSync(f, original)
  run(POST, postInput('Read', { file_path: f, offset: 1, limit: 1 }, { content: original }, 'R1'), dir) // 先读满(重要文件)
  assert(run(PRE, callInput('Write', { file_path: f, content: 'x\n' }, 'W1'), dir) === null, 'pre 应放行并拍快照')
  fs.writeFileSync(f, 'export const a = { broken\n') // 模拟引擎落盘写坏
  const out = run(POST, postInput('Write', { file_path: f, content: 'x\n' }, { ok: true }, 'W1'), dir)
  assert(out?.hookSpecificOutput?.additionalContext?.includes('已自动回滚'), '应报告回滚')
  assert(fs.readFileSync(f, 'utf8') === original, '文件应恢复到写入前内容')
  assert(readState(dir).stats['postWriteCheck.rollbacks'] === 1, 'rollbacks 计数应为 1')
})

test('F5:新文件写坏 → 删除(Codex 有 Node,新文件可删)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const f = path.join(dir, 'new-file.json')
  assert(run(PRE, callInput('Write', { file_path: f, content: '{"a":' }, 'W2'), dir) === null, 'pre 应放行')
  fs.writeFileSync(f, '{"a":') // 模拟引擎落盘(新文件)
  const out = run(POST, postInput('Write', { file_path: f, content: '{"a":' }, { ok: true }, 'W2'), dir)
  assert(out?.hookSpecificOutput?.additionalContext?.includes('回滚'), '应报告回滚')
  assert(!fs.existsSync(f), '新文件写坏应被删除(与 CC 不同,这里无删除 API 限制)')
})

test('F3b:阶梯恢复 1 → 连3成功 → 3 → 再3成功 → 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  run(POST, postInput('Bash', { command: 'x' }, BASH_FAIL, 'L0'), dir)
  assert(readState(dir).tier === 1, '失败后档位应为 1')
  for (let i = 0; i < 3; i++) run(POST, postInput('Bash', { command: 'x' }, BASH_OK, `L${i + 1}`), dir)
  assert(readState(dir).tier === 3, '连 3 成功后档位应为 3')
  for (let i = 0; i < 3; i++) run(POST, postInput('Bash', { command: 'x' }, BASH_OK, `M${i}`), dir)
  assert(readState(dir).tier === 0, '再 3 成功后档位应恢复不限')
  assert(readState(dir).stats['behavior.restored'] === 1, 'restored 计数应为 1')
})

test('F1:apply_patch 未读重要文件 → deny(0.154 真实工具名)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const f = path.join(dir, 'app.config.ts')
  fs.writeFileSync(f, 'export const a = 1\n')
  const patch = `*** Begin Patch\n*** Update File: ${f}\n@@\n-export const a = 1\n+export const b = 2\n*** End Patch`
  const out = run(PRE, callInput('apply_patch', { command: patch }), dir)
  assert(out && out.hookSpecificOutput?.permissionDecision === 'deny', '应 deny')
  assert(out.hookSpecificOutput.permissionDecisionReason.includes('app.config.ts'), 'reason 应含文件路径')
})

test('F5:apply_patch 读后改两个文件,写坏自动回滚', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be-codex-'))
  const f1 = path.join(dir, 'app.config.ts')
  const f2 = path.join(dir, 'notes.md')
  const original = 'export const a = 1\n'
  fs.writeFileSync(f1, original)
  fs.writeFileSync(f2, 'note\n')
  run(POST, postInput('Read', { file_path: f1, offset: 1, limit: 1 }, { content: original }, 'R1'), dir)
  const patch = `*** Begin Patch\n*** Update File: ${f1}\n@@\n-export const a = 1\n+export const b = 2\n*** Update File: ${f2}\n@@\n-note\n+note2\n*** End Patch`
  assert(run(PRE, callInput('apply_patch', { command: patch }, 'P1'), dir) === null, 'pre 应放行并拍两个快照')
  fs.writeFileSync(f1, 'export const a = { broken\n') // 模拟执行写坏其中一个
  const out = run(POST, postInput('apply_patch', { command: patch }, { ok: true }, 'P1'), dir)
  assert(out?.hookSpecificOutput?.additionalContext?.includes('已自动回滚'), '应报告回滚')
  assert(fs.readFileSync(f1, 'utf8') === original, '被写坏的文件应恢复')
  assert(fs.readFileSync(f2, 'utf8') === 'note\n', '未执行的文件不应被误改')
})

console.log(`\n${passed} pass, ${failed} fail`)
process.exit(failed > 0 ? 1 : 0)
