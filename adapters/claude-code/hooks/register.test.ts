// behavior-enhancer(CC 适配器)引擎级测试。
// 测试环境的 $ 只有 agent/command/prompt/session/tool/turn/ui 等名词;插件 hook 里
// 的 $.fs/$.state/$.store/$.clock 调用会沿链下到本文件的 bottom hooks(它们"代表
// 引擎"),这里用 Map 实现一套虚拟 fs/state/store/clock,并把 engine 侧事件
// (session.start / command.register / tool.call 各工具)一并答掉。
// 注意:bottom hooks 必须在第一次 $ 调用前全部注册(与插件 register() 同规则)。

import { test, expect } from 'claude-code/testing'

// 归一化路径:fs 层会把 '/pkg/x' 解析为 '<盘符>:\pkg\x',统一回 '/pkg/x'
const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// bottom 基础设施:虚拟 fs + 插件私有 store + 会话 state + 固定时钟 + 工具行为
const setup = (on: any) => {
  const vfs = new Map<string, string>()
  const store = new Map<string, unknown>()
  const state = new Map<string, unknown>() // `${plugin}:${key}` → value
  const knob = { bashIsError: false, holdNext: false }
  let version = 0
  let holdStarted = () => {}
  let holdRelease = () => {}
  const holdStartedP = new Promise<void>((r) => { holdStarted = r })
  const holdReleaseP = new Promise<void>((r) => { holdRelease = r })

  on('fs.read', (_$: any, e: any) => {
    const p = norm(e.path)
    if (!vfs.has(p)) throw new Error(`ENOENT: ${p}`)
    return { value: vfs.get(p) }
  })
  on('fs.write', (_$: any, e: any) => { vfs.set(norm(e.path), e.text); return { value: undefined } })
  on('fs.stat', (_$: any, e: any) => {
    const p = norm(e.path)
    if (!vfs.has(p)) throw new Error(`ENOENT: ${p}`)
    return { value: { kind: 'file', size: (vfs.get(p) ?? '').length, mtimeMs: 1, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }
  })
  on('fs.exists', (_$: any, e: any) => ({ value: vfs.has(norm(e.path)) }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('state.get', (_$: any, e: any) => {
    const v = state.get(`${e.plugin}:${e.key}`)
    return { value: { value: v, version } }
  })
  on('state.set', (_$: any, e: any) => {
    if (typeof e.ifVersion === 'number' && e.ifVersion !== version) return { value: { isSet: false, version } }
    state.set(`${e.plugin}:${e.key}`, e.value)
    version += 1
    return { value: { isSet: true, version } }
  })
  on('clock.now', () => ({ value: 1000 }))

  // 引擎侧事件 bottom(全部先注册)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.command } }))
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.call', { tool: 'Read' }, (_$: any, e: any) => {
    const p = norm(e.file_path)
    const content = vfs.get(p)
    if (content === undefined) return { isError: true, result: null, text: `ENOENT: ${p}` }
    const lines = content.split(/\r?\n/)
    return { result: { type: 'text', file: { filePath: e.file_path, content, numLines: lines.length, startLine: 1, totalLines: lines.length } } }
  })
  on('tool.call', { tool: ['Write', 'Edit'] }, (_$: any, e: any) => {
    const p = norm(e.file_path)
    const existed = vfs.has(p)
    const originalFile = existed ? vfs.get(p)! : null
    vfs.set(p, e.content) // 模拟引擎落盘
    return { result: { type: existed ? 'update' : 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile } }
  })
  on('tool.call', { tool: 'Bash' }, async (_$: any, e: any) => {
    if (knob.holdNext) {
      knob.holdNext = false
      holdStarted()
      await holdReleaseP // 保持该调用在飞,直到测试放行
    }
    return knob.bashIsError
      ? { isError: true, result: { stdout: '', stderr: 'boom', interrupted: false }, text: `Failed: ${e.command}` }
      : { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('tool.call', { tool: 'PowerShell' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  return { vfs, store, state, knob, holdStartedP, holdRelease }
}

test('重要文件(默认模式 *.config.*)未读 → Write 被拦截', async ($, on) => {
  const b = setup(on)
  b.vfs.set('/pkg/app.config.ts', 'export const a = 1\n')
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/app.config.ts', content: 'export const b = 2\n' })
  expect(ran.deny).toMatch(/重要文件/)
  expect(ran.deny).toMatch(/offset=1/)
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['readBeforeWrite.denied']).toBe(1)
})

test('/force-read 标记(注释形态)未读 → Write 被拦截', async ($, on) => {
  const b = setup(on)
  b.vfs.set('/pkg/important.md', '<!-- /force-read -->\n\n正文内容。\n')
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/important.md', content: '覆盖内容\n' })
  expect(ran.deny).toMatch(/重要文件/)
})

test('正文提到 /force-read 不算标记 → 不拦截(狗粮发现 #1)', async ($, on) => {
  const b = setup(on)
  b.vfs.set('/pkg/notes.md', '本文档说明 /force-read 标记的用法:行首注释形式才生效。\n')
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/notes.md', content: '正文内容\n' })
  expect(ran.deny).toBeUndefined()
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['readBeforeWrite.denied'] ?? 0).toBe(0)
})

test('含正则字面量的 .ts 写后不被误回滚(狗粮发现 #2)', async ($, on) => {
  const b = setup(on)
  const content = 'const re = /\\[stderr\\][\\s\\S]{0,200}(error|can\'t)/im\nconst ok = (x: string) => x.match(re)\n'
  b.vfs.set('/pkg/re-literal.ts', 'export const a = 1\n')
  await $.tool.call({ tool: 'Read', file_path: '/pkg/re-literal.ts', offset: 1, limit: 1 })
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/re-literal.ts', content })
  expect(ran.deny).toBeUndefined()
  expect(ran.context?.join('\n') ?? '').not.toMatch(/回滚/)
  expect(b.vfs.get('/pkg/re-literal.ts')).toBe(content)
})

test('读满重要文件后 → Write 放行', async ($, on) => {
  const b = setup(on)
  b.vfs.set('/pkg/app.config.ts', 'export const a = 1\n')
  await $.tool.call({ tool: 'Read', file_path: '/pkg/app.config.ts', offset: 1, limit: 1 })
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/app.config.ts', content: 'export const b = 2\n' })
  expect(ran.deny).toBeUndefined()
  expect(ran.context).toBeUndefined() // 全覆盖:无提醒、无回滚
})

test('写坏文件 → 自动回滚并报告', async ($, on) => {
  const b = setup(on)
  const original = 'export const a = 1\n'
  b.vfs.set('/pkg/app.config.ts', original)
  await $.tool.call({ tool: 'Read', file_path: '/pkg/app.config.ts', offset: 1, limit: 1 })
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/app.config.ts', content: 'export const a = { broken\n' })
  expect(b.vfs.get('/pkg/app.config.ts')).toBe(original) // 已回滚
  expect(ran.context?.join('\n')).toMatch(/已自动回滚/)
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['postWriteCheck.rollbacks']).toBe(1)
})

test('新文件写坏 → 无法删除,清空并诚实报告', async ($, on) => {
  const b = setup(on)
  const ran = await $.tool.call({ tool: 'Write', file_path: '/pkg/new-file.json', content: '{"a":' })
  expect(b.vfs.get('/pkg/new-file.json')).toBe('') // 插件环境无删除 API → 清空
  expect(ran.context?.join('\n')).toMatch(/清空/)
})

test('F3b 并发窗口:失败后档位 1,并发第 2 个被 deny', async ($, on) => {
  const b = setup(on)
  b.knob.bashIsError = true
  await $.tool.call({ tool: 'Bash', command: 'fail-once' }) // 失败 → 档位 1
  b.knob.bashIsError = false
  b.knob.holdNext = true
  const pA = $.tool.call({ tool: 'Bash', command: 'slow' }) // 保持一个调用在飞
  await b.holdStartedP
  const denied = await $.tool.call({ tool: 'Bash', command: 'fast' })
  expect(denied.deny).toMatch(/并行收敛/)
  expect(denied.deny).toMatch(/档位 1/)
  b.holdRelease()
  const a = await pA
  expect(a.deny).toBeUndefined()
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['behavior.serialized']).toBe(1)
})

test('F3b 阶梯恢复:1 → 连 3 成功 → 3 → 再 3 成功 → 不限', async ($, on) => {
  const b = setup(on)
  const tierLine = async () => {
    const out = await $.prompt.compose({ model: 'test-model', promptModel: 'test-model', outputStyle: null, surfaces: ['terminal'], tools: ['Bash'], traits: [] })
    return out.sections.find((s: any) => s.id === 'behavior-enhancer:discipline')?.text ?? ''
  }
  b.knob.bashIsError = true
  await $.tool.call({ tool: 'Bash', command: 'fail' }) // 档位 1(可能已在上一个测试降过)
  b.knob.bashIsError = false
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: `ok${i}` })
  expect(await tierLine()).toMatch(/当前 3 个/) // 连 3 成功 → 档位 3
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: `more${i}` })
  expect(await tierLine()).toMatch(/当前 不限/) // 再 3 成功 → 恢复
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['behavior.restored']).toBe(1)
})

test('hardGate:拦截 3 次后逃生放行(Bash 与 PowerShell 共享同一计数,DSH 同款)', async ($, on) => {
  const b = setup(on)
  const pwsh = await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse -Force x' })
  expect(pwsh.deny).toMatch(/高风险命令/)
  expect(pwsh.deny).toMatch(/第 1 次/)
  for (let i = 2; i <= 3; i++) {
    const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf x' })
    expect(ran.deny).toMatch(new RegExp(`第 ${i} 次`))
  }
  const escaped = await $.tool.call({ tool: 'Bash', command: 'rm -rf x' })
  expect(escaped.deny).toBeUndefined()
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['hardGate.denied']).toBe(3)
  expect(stats['hardGate.escape']).toBe(1)
})

test('failureGuard:同工具连续失败 2 次 → 停手提醒;成功后重置', async ($, on) => {
  const b = setup(on)
  b.knob.bashIsError = true
  const first = await $.tool.call({ tool: 'Bash', command: 'ls /nonexistent' })
  expect(first.context?.join('\n') ?? '').not.toMatch(/连续失败/) // 第 1 次只计数
  const second = await $.tool.call({ tool: 'Bash', command: 'ls /nonexistent' })
  expect(second.context?.join('\n')).toMatch(/Bash 已连续失败 2 次/)
  b.knob.bashIsError = false
  const third = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(third.context?.join('\n') ?? '').not.toMatch(/连续失败/)
  const stats = (b.store.get('stats') ?? {}) as Record<string, number>
  expect(stats['behavior.failures']).toBe(2)
  expect(stats['behavior.alerts']).toBe(1)
})

test('/behavior-status 命令输出统计', async ($, on) => {
  const b = setup(on)
  await $.session.start({ cwd: '/pkg', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'behavior-status' })
  expect(out.text).toMatch(/behavior-enhancer 统计/)
  expect(out.text).toMatch(/写后自动回滚/)
  expect(out.text).toMatch(/并行收敛/)
})
