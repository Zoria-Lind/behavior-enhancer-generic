// behavior-enhancer — Claude Code 适配器(FULL 层)。
// 设计依据:core/audit.md + core/semantics.md + generic-skill_plan_v1.md。
// 铁律:任何状态/文件问题都不能阻断主任务(fail-open);状态只存可再生数据。
// 移植自 dsh-behavior-enhancer v1.2:hardGate 模式表+逃生、failureDetect 签名、
// failureGuard 阈值、postWriteCheck lightParse(语义同源,此后独立演进)。
// 约束(引擎校验):hook 必须是本文件顶层声明;`$` 只允许按 $.noun.event(...)
// 原样拼写、不能作为参数传给助手函数 —— 顶层助手只吃纯数据,状态读写内联。

import type { Register } from 'claude-code'
import type { Range, ReadRegistry } from '../types'

// ---- 共享语义常量(与 core/semantics.md 同源,改一处需同步) ----
const FORCE_READ_TOKEN = '/force-read'
const IMPORTANT_PATTERNS = ['package.json', '*.config.*', '*.lock', 'Dockerfile', 'Makefile', '.github/workflows/*']
const READ_TTL_MS = 60 * 60 * 1000 // 读记录会话内 1h(v1 硬编码,v2 开放配置)
const MAX_STRIKES = 3 // hardGate 逃生:同一原因连续拦截超过该次数 → 放行
const MAX_FAILURES = 2 // 同工具连续失败阈值 → 注入停手提醒
const CHECK_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ps1', 'sh', 'toml', 'xml'])
const HASH_COMMENT_EXTS = new Set(['yaml', 'yml', 'py', 'sh', 'ps1', 'toml'])
const REGISTRY = { plugin: 'behavior-enhancer', key: 'readRegistry' } as const

// ---- 统计键(与 DSH 键名对齐,跨宿主可比) ----
type Stats = {
  'hardGate.denied': number
  'hardGate.escape': number
  'postWriteCheck.rollbacks': number
  'behavior.failures': number
  'behavior.alerts': number
  'behavior.serialized': number
  'behavior.restored': number
  'readBeforeWrite.denied': number
  'readBeforeWrite.warns': number
}
const STATS_ZERO: Stats = {
  'hardGate.denied': 0,
  'hardGate.escape': 0,
  'postWriteCheck.rollbacks': 0,
  'behavior.failures': 0,
  'behavior.alerts': 0,
  'behavior.serialized': 0,
  'behavior.restored': 0,
  'readBeforeWrite.denied': 0,
  'readBeforeWrite.warns': 0,
}

// ---- F6:高风险命令模式表(DSH hardGate 移植) ----
const FORBIDDEN = [
  { re: /\bRemove-Item\b[^\n]*-(Recurse|Force)/i, label: 'Remove-Item -Recurse/-Force' },
  { re: /\bformat\b\s+[a-z]:/i, label: 'format 盘符' },
  { re: /\bdel\b[^\n]*\/[fsq]/i, label: 'del /f /s /q' },
  { re: /\brm\b\s+-[rf]{1,2}\b/i, label: 'rm -r/-f/-rf' },
  { re: /\bri\b[^\n]*-Recurse/i, label: 'ri -Recurse' },
]

// ---- F1:重要文件判定(纯数据) ----
function globToRegex(pattern: string): RegExp {
  const body = pattern
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${body}$`)
}
const IMPORTANT_RES = IMPORTANT_PATTERNS.map(globToRegex)
function isImportantByPattern(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/')
  const base = norm.split('/').pop() ?? ''
  return IMPORTANT_RES.some((re) => re.test(norm) || re.test(base))
}
// 前 100 行内出现"行首注释引导形态"的 /force-read 才算标记(与 core/semantics.md 同源)。
// 2026-10-05 修正:纯子串匹配会误伤正文提到 token 的文档(狗粮发现 #1)。
// 注意:正则用字符串构造,避免自身源码里出现 /* 序列被 lightParse 误读。
const FORCE_READ_MARKER_RE = new RegExp('^\\s*(?:\\/\\/\\/?|#+|\\/\\*|\\*\\/|<!--|--|;|%)\\s*\\/force-read\\b')
function hasForceReadMarker(head: string): boolean {
  return String(head).split(/\r?\n/).slice(0, 100).some((line) => FORCE_READ_MARKER_RE.test(line))
}

// ---- 覆盖区间合并(纯数据) ----
function mergeRange(ranges: Range[], add: Range): Range[] {
  const all = [...ranges, add].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of all) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}
function gapsOf(ranges: Range[], total: number): Range[] {
  const gaps: Range[] = []
  let cur = 1
  for (const [s, e] of ranges) {
    if (s > cur) gaps.push([cur, Math.min(s - 1, total)])
    cur = Math.max(cur, e + 1)
  }
  if (cur <= total) gaps.push([cur, total])
  return gaps
}
const gapsText = (gaps: Range[]) => gaps.map(([s, t]) => `${s}-${t}`).join('、')

// ---- 注册表 TTL 修剪(纯数据) ----
function pruneAt(value: ReadRegistry | undefined, now: number): [ReadRegistry, boolean] {
  const out: ReadRegistry = {}
  let changed = false
  for (const [k, v] of Object.entries(value ?? {})) {
    if (now - v.at < READ_TTL_MS) out[k] = v
    else changed = true
  }
  return [out, changed]
}

// ---- F3a/F4:失败判定(DSH failureDetect 签名移植,纯数据) ----
function detectFailure(text: string | undefined, isError: boolean): boolean {
  if (isError) return true
  if (!text) return false
  // 非零退出码(命令级失败最强信号)
  if (/\[exit[^\]]*code[^\]]*[:：]\s*[1-9]/.test(text)) return true
  // stderr 段典型错误签名(避开 warning 类噪音)
  if (/\[stderr\][\s\S]{0,200}(error|failed|exception|cannot|can't|not found|no such file|does not exist|access denied|找不到|不存在|拒绝访问|无法)/im.test(text)) return true
  return false
}

// ---- F5:lightParse(DSH 移植:字符串/注释感知括号配对;对正常代码零误报) ----
// 2026-10-05 扩展(狗粮发现 #2,DSH 原版同缺陷):增加正则字面量识别——正则里的
// /* 与撇号(can't)不再是注释/字符串开头;启发式:前一个代码态字符是表达式起始字符
// (= ( [ { , ; : ! & | ? + - * % ^ ~ < >)或前一个词是 return/typeof 等关键字时,
// / 按正则处理(含转义与字符类)。
const REGEX_START_CHARS = '=([{,;:!&|?+-*%^~<>'
const REGEX_START_KEYWORDS = new Set(['return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'yield', 'await', 'throw', 'else', 'do'])
function lightParse(filePath: string, content: string): string[] {
  const issues: string[] = []
  const ext = (filePath.split('.').pop() ?? '').toLowerCase()
  if (!CHECK_EXTENSIONS.has(ext)) return issues
  if (ext === 'json') {
    try { JSON.parse(content) } catch (e) {
      issues.push(`JSON 解析失败: ${(e as Error).message?.slice(0, 80) ?? e}`)
    }
    return issues
  }
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
  const closes: Record<string, string> = { '}': '{', ']': '[', ')': '(' }
  const quoteClose: Record<string, string> = { single: "'", double: '"', backtick: '`' }
  const stack: string[] = []
  let state = 'code' // code | single | double | backtick | line-comment | block-comment | regex | regex-class
  let lastCodeChar = '' // 上一个代码态非空白字符(正则启发式)
  let lastWord = '' // 上一个代码态标识符词(关键字启发式)
  const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c)
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    const nxt = content[i + 1]
    if (c === '\n') {
      if (state === 'line-comment') state = 'code'
      if (state === 'regex' || state === 'regex-class') state = 'code' // 未闭合正则:fail-open 回代码态
      continue
    }
    if (state === 'line-comment' || state === 'block-comment') {
      if (state === 'block-comment' && c === '*' && nxt === '/') { state = 'code'; i++ }
      continue
    }
    if (state === 'regex') {
      if (c === '\\') { i++; continue }
      if (c === '[') { state = 'regex-class'; continue }
      if (c === '/') { state = 'code'; lastCodeChar = c; lastWord = ''; continue }
      continue
    }
    if (state === 'regex-class') {
      if (c === '\\') { i++; continue }
      if (c === ']') { state = 'regex'; continue }
      continue
    }
    if (state !== 'code') {
      if (c === '\\') { i++; continue }
      if (c === quoteClose[state]) { state = 'code'; lastCodeChar = c; lastWord = ''; continue }
      continue
    }
    // code 状态
    if (c === "'") { state = 'single'; continue }
    if (c === '"') { state = 'double'; continue }
    if (c === '`') { state = 'backtick'; continue }
    if (c === '/' && nxt === '/') { state = 'line-comment'; i++; continue }
    if (c === '/' && nxt === '*') { state = 'block-comment'; i++; continue }
    if (HASH_COMMENT_EXTS.has(ext) && c === '#') { state = 'line-comment'; continue }
    // 正则字面量启发式(除法不误判:标识符/字符串/数字后不触发)
    if (c === '/' && nxt !== '/' && nxt !== '*' &&
      (REGEX_START_CHARS.includes(lastCodeChar) || REGEX_START_KEYWORDS.has(lastWord))) {
      state = 'regex'
      continue
    }
    if (!/\s/.test(c)) {
      if (isWordChar(c)) lastWord += c
      else lastWord = ''
      lastCodeChar = c
    }
    if (pairs[c]) { stack.push(c); continue }
    if (closes[c]) {
      const top = stack.pop()
      if (!top || top !== closes[c]) {
        issues.push(`括号不配对: "${c}" 没有对应的 "${closes[c]}"`)
        if (issues.length >= 8) break
      }
    }
  }
  if (state === 'single' || state === 'double') issues.push('引号未闭合(字符串跨行)')
  if (state === 'block-comment') issues.push('块注释 /* 未闭合')
  for (let j = stack.length - 1; j >= 0 && issues.length < 8; j--) {
    issues.push(`括号未闭合: "${stack[j]}" 缺少对应的 "${pairs[stack[j]]}"`)
  }
  if (ext === 'yaml' || ext === 'yml') {
    for (const rawLine of content.split(/\r?\n/)) {
      if (/^( *\t|\t+ *)/.test(rawLine)) issues.push('YAML 缩进不允许使用 tab')
      if (issues.length >= 8) break
    }
  }
  return issues.slice(0, 8)
}

// ---- 会话级计数(可再生,热重载清零可接受) ----
const strikes = new Map<string, number>() // hardGate reason → 已拦截次数
const streaks = new Map<string, number>() // failureGuard tool → 连续失败次数

// 文件行数(与 Read 工具的计数口径对齐:结尾换行不产生空行)
function lineCount(text: string): number {
  const n = text.split(/\r?\n/).length
  return text.length > 0 && text.endsWith('\n') ? n - 1 : n
}

// ---- F1:Read 成功 → 记覆盖(请求 offset+limit 算"至少覆盖"下界,CAS 防并行丢写) ----
const readHook = async ($: any, e: any, next: any) => {
  const ran = await next(e)
  try {
    if (ran.isError === undefined && typeof e.file_path === 'string' && e.pages === undefined) {
      const offset = typeof e.offset === 'number' ? e.offset : 1
      const limit = typeof e.limit === 'number' ? e.limit : 2000
      const range: Range = [offset, offset + limit - 1]
      for (let attempt = 0; attempt < 3; attempt++) {
        const { value, version } = await $.state.get(REGISTRY)
        const now = await $.clock.now()
        const [clean] = pruneAt(value, now)
        const cur = clean[e.file_path]?.ranges ?? []
        const nextReg: ReadRegistry = { ...clean, [e.file_path]: { ranges: mergeRange(cur, range), at: now } }
        const { isSet } = await $.state.set(REGISTRY, nextReg, { ifVersion: version })
        if (isSet) break
      }
    }
  } catch { /* fail-open */ }
  return ran
}

// ---- F1 + F5:Write/Edit 读前检查(veto/warn)+ 内存快照 + 写后校验回滚 ----
const fileToolHook = async ($: any, e: any, next: any) => {
  const bump = async (key: keyof Stats) => {
    try {
      const cur = ((await $.store.get('stats')) ?? {}) as Partial<Stats>
      await $.store.set('stats', { ...STATS_ZERO, ...cur, [key]: (cur[key] ?? 0) + 1 })
    } catch { /* 统计失败不致命 */ }
  }
  const path = e.file_path
  const verb = e.tool === 'Write' ? '写' : '改'
  const notes: string[] = []

  // F1:读前检查(任何一步失败 → 豁免,不阻断写入)
  let snap: string | null = null
  let existed = false
  try {
    const before = await $.fs.read(path)
    existed = true
    const total = lineCount(before)
    const important = isImportantByPattern(path) || hasForceReadMarker(before)
    let covered: Range[] = []
    try {
      const { value } = await $.state.get(REGISTRY)
      const now = await $.clock.now()
      const [clean, changed] = pruneAt(value, now)
      if (changed) await $.state.set(REGISTRY, clean)
      covered = clean[path]?.ranges ?? []
    } catch { covered = [] } // 状态读不到按未读处理,但绝不让检查异常阻断写入
    const gaps = gapsOf(covered, total)
    if (important && gaps.length > 0) {
      await bump('readBeforeWrite.denied')
      return {
        deny: `[behavior-enhancer] ${path} 是重要文件(共 ${total} 行),未读区间: ${gapsText(gaps)}。` +
          `请先用 Read 补读(建议从第一个未读区间 offset=${gaps[0][0]} 开始),读完再${verb}。`,
      }
    }
    if (gaps.length > 0) {
      await bump('readBeforeWrite.warns')
      notes.push(`[behavior-enhancer] 提醒:${path} 共 ${total} 行,未读区间 ${gapsText(gaps)};建议补读后再确认${verb}内容。(仅提醒,不拦截)`)
    }
    snap = before // 快照(内存;插件环境无 delete/homedir API,不做磁盘 .bak,v1.1 再议)
  } catch { /* 新文件或读取失败(>4MiB 等):豁免 */ }

  const ran = await next(e)

  // F5:写后校验 + 自动回滚(写入被 deny/失败 → 文件未变,跳过)
  if (existed && snap !== null && ran.deny === undefined && ran.isError === undefined) {
    try {
      const after = await $.fs.read(path)
      const issues = lightParse(path, after)
      if (issues.length > 0) {
        await bump('postWriteCheck.rollbacks')
        await $.fs.write(path, snap)
        notes.push(`[behavior-enhancer] ${verb}后校验发现 ${issues.length} 个问题,已自动回滚到写入前版本。` +
          `问题:${issues.slice(0, 3).join('; ')}。` +
          `注意:检查的是整个文件,问题可能包含写入前就有的旧问题;请修正后重新${verb}。`)
      }
    } catch { /* fail-open */ }
  }
  // 新文件写坏:插件环境无删除 API,清空为空白文件并诚实报告
  if (!existed && snap === null && ran.deny === undefined && ran.isError === undefined) {
    try {
      const after = await $.fs.read(path)
      const issues = lightParse(path, after)
      if (issues.length > 0) {
        await bump('postWriteCheck.rollbacks')
        await $.fs.write(path, '')
        notes.push(`[behavior-enhancer] ${verb}的新文件校验发现 ${issues.length} 个问题;插件环境无删除 API,已清空为空白文件。` +
          `问题:${issues.slice(0, 3).join('; ')}。请修正后重新${verb}。`)
      }
    } catch { /* fail-open */ }
  }

  if (notes.length > 0) return { ...ran, context: [...(ran.context ?? []), ...notes] }
  return ran
}

// ---- F6:hardGate(Bash + PowerShell;逃生 = 同原因超过 maxStrikes 次放行) ----
const gateHook = async ($: any, e: any, next: any) => {
  const bump = async (key: keyof Stats) => {
    try {
      const cur = ((await $.store.get('stats')) ?? {}) as Partial<Stats>
      await $.store.set('stats', { ...STATS_ZERO, ...cur, [key]: (cur[key] ?? 0) + 1 })
    } catch { /* 统计失败不致命 */ }
  }
  const command = String(e.command ?? '')
  const hit = FORBIDDEN.find((f) => f.re.test(command))
  if (!hit) return next(e)
  const reason = 'high-risk-command'
  const n = (strikes.get(reason) ?? 0) + 1
  strikes.set(reason, n)
  if (n > MAX_STRIKES) {
    await bump('hardGate.escape')
    return next(e) // 逃生:超过阈值放行,防空转死锁(DSH 同款语义)
  }
  await bump('hardGate.denied')
  return {
    deny: `[behavior-enhancer] 高风险命令已拦截(${hit.label},第 ${n} 次)。` +
      `请先向用户说明影响范围并获得确认;连续超过 ${MAX_STRIKES} 次将自动放行以防空转。`,
  }
}

// ---- F3b:并行档位(阶梯:失败 → 1;连 3 成功 → 3;再 3 成功 → 0=不限) ----
// 无并行度 API 的宿主用"并发窗口 veto"实现拦截等价(DSH 池上限的替代机制):
// 引擎照常派发,超档位的并发调用当场 deny,模型收到负反馈闭环。
// 热重载清零 = 恢复不限(fail-open,可再生)。
let parallelTier = 0 // 0=不限;1=失败串行档;3=恢复档
let successStreak = 0 // 当前档位内的连续成功数
let inFlight = 0 // 正在执行的工具调用数(hook 的 await 生命周期 = 调用执行期)

// ---- F3b(拦截等价):并发窗口 veto + F3a/F4:失败检测/连续失败介入/档位升降 ----
// 无 matcher 的 tool.call hook 只能注册一个,窗口与失败逻辑合并在此。
const disciplineHook = async ($: any, e: any, next: any) => {
  const bump = async (key: keyof Stats) => {
    try {
      const cur = ((await $.store.get('stats')) ?? {}) as Partial<Stats>
      await $.store.set('stats', { ...STATS_ZERO, ...cur, [key]: (cur[key] ?? 0) + 1 })
    } catch { /* 统计失败不致命 */ }
  }
  // F3b 并发窗口:超档位当场 deny(负反馈闭环)
  if (parallelTier !== 0 && inFlight >= parallelTier) {
    return {
      deny: `[behavior-enhancer] 并行收敛:当前档位 ${parallelTier}(一次最多 ${parallelTier} 个并发调用),已有 ${inFlight} 个在跑。` +
        `请等已发出的调用全部结束、确认结果后再继续;不要在同一轮里重发被拦截的调用。`,
    }
  }
  inFlight++
  let ran
  try {
    ran = await next(e)
  } finally {
    inFlight--
  }
  try {
    if (ran.deny !== undefined) return ran // 拦截不算失败
    if (detectFailure(ran.text, ran.isError === true)) {
      const n = (streaks.get(e.tool) ?? 0) + 1
      streaks.set(e.tool, n)
      await bump('behavior.failures')
      const notes: string[] = []
      // F3b:失败 → 串行档(DSH serialize 语义:已在串行档则只重置连击)
      if (parallelTier !== 1) {
        parallelTier = 1
        await bump('behavior.serialized')
        notes.push('[behavior-enhancer] 并行收敛:检测到失败,档位已降为 1。下一条消息只发 1 个工具调用,先写失败原因;连续 3 次成功升 3 个、再 3 次恢复不限。')
      }
      successStreak = 0
      if (n >= MAX_FAILURES) {
        streaks.delete(e.tool) // 提醒后重置,避免每轮重复(DSH 同款)
        await bump('behavior.alerts')
        notes.push(`[behavior-enhancer] 工具 ${e.tool} 已连续失败 ${n} 次。请停止重试,向用户说明失败原因并询问下一步(或切换方案)。`)
      }
      if (notes.length > 0) return { ...ran, context: [...(ran.context ?? []), ...notes] }
    } else {
      streaks.delete(e.tool)
      // F3b:阶梯恢复(成功连击;被 deny 的调用不走这里)
      if (parallelTier !== 0) {
        successStreak++
        if (parallelTier === 1 && successStreak >= 3) {
          parallelTier = 3
          successStreak = 0
        } else if (parallelTier === 3 && successStreak >= 3) {
          parallelTier = 0
          successStreak = 0
          await bump('behavior.restored')
        }
      }
    }
  } catch { /* fail-open */ }
  return ran
}

// ---- F2:行为约束段(prompt.compose;F3b/F7 的 SOFT 载体同在此) ----
const composeHook = async ($: any, _e: any, next: any) => {
  const out = await next(_e)
  const tierText = parallelTier === 0
    ? '不限(正常)'
    : parallelTier === 1
      ? '1 个(失败后串行,连 3 成功升 3 个)'
      : '3 个(恢复中,再 3 成功恢复不限)'
  const section = {
    id: 'behavior-enhancer:discipline',
    scope: 'session' as const,
    text: `工具调用行为纪律(behavior-enhancer 插件):
- 先读后写:修改文件前先 Read 确认当前内容;文件头 100 行内有 ${FORCE_READ_TOKEN} 注释标记(如 // ${FORCE_READ_TOKEN} 或 # ${FORCE_READ_TOKEN})的重要文件(package.json、*.config.*、*.lock、CI 配置等)必须完整读完才许写,未读完会被拦截。
- 失败立即收敛:工具失败后停止重试、分析原因、小步重试;同工具连续失败 ${MAX_FAILURES} 次会被提醒停手并向用户说明原因。
- 并行收敛:并行调用前确认各调用无依赖且低风险;失败后档位降为 1(一次最多 1 个并发调用),连续 3 次成功升 3 个、再 3 次恢复不限,超档位的并发调用会被拦截。
- 写后检查:JSON/YAML/代码文件写坏会自动回滚并报告(括号配对等轻量校验)。
- 高风险命令(rm -rf、Remove-Item -Recurse、format、del /s 等)会被拦截,执行前先向用户说明影响范围并获得确认;被拒后不换写法绕过。
- 验证环:改过文件必须给出验证证据,没有就明说"尚未验证";不确定就明说,禁止编造。
- 并行档位(实时,由本插件按失败/成功自动升降):当前 ${tierText};连续成功 ${successStreak}/3。`,
  }
  return { ...out, sections: [...out.sections, section] }
}

// ---- F9:/behavior-status 统计命令 ----
const sessionStartHook = async ($: any, e: any, next: any) => {
  await $.command.register({
    name: 'behavior-status',
    description: '查看 behavior-enhancer 统计(拦截/回滚/失败/提醒次数)',
  })
  return next(e)
}
const statusHook = async ($: any) => {
  const s = { ...STATS_ZERO, ...((await $.store.get('stats')) as Partial<Stats> | undefined ?? {}) }
  return {
    text: `behavior-enhancer 统计(仅统计,可再生):
- 读前拦截(重要文件未读完): ${s['readBeforeWrite.denied']} 次
- 读前提醒(普通文件有未读区间): ${s['readBeforeWrite.warns']} 次
- 高风险命令拦截: ${s['hardGate.denied']} 次(逃生放行 ${s['hardGate.escape']} 次)
- 检测到的工具失败: ${s['behavior.failures']} 次(连续失败停手提醒 ${s['behavior.alerts']} 次)
- 并行收敛:串行化 ${s['behavior.serialized']} 次、恢复 ${s['behavior.restored']} 次(当前档位 ${parallelTier === 0 ? '不限' : parallelTier},连续成功 ${successStreak}/3)
- 写后自动回滚: ${s['postWriteCheck.rollbacks']} 次`,
  }
}

export const register: Register = (on) => {
  on('tool.call', { tool: 'Read' }, readHook)
  on('tool.call', { tool: ['Write', 'Edit'] }, fileToolHook)
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, gateHook)
  on('tool.call', disciplineHook)
  on('prompt.compose', composeHook)
  on('session.start', sessionStartHook)
  on('command.run', { command: 'behavior-status' }, statusHook)
}
