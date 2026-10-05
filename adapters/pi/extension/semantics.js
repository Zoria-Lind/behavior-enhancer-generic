// behavior-enhancer — 共享行为语义(Codex 适配器 vendored 版)。
// 与 core/semantics.md 同源;CC 适配器(adapters/claude-code)另有一份内置常量。
// 改语义时两处同步。铁律:任何异常 fail-open,绝不阻断工具执行。

'use strict'

const FORCE_READ_TOKEN = '/force-read'
const IMPORTANT_PATTERNS = ['package.json', '*.config.*', '*.lock', 'Dockerfile', 'Makefile', '.github/workflows/*']
const READ_TTL_MS = 60 * 60 * 1000 // 读记录 1h(v1 硬编码)
const MAX_STRIKES = 3 // hardGate 逃生:同一原因连续拦截超过该次数 → 放行
const MAX_FAILURES = 2 // 同工具连续失败阈值 → 注入停手提醒
const CHECK_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ps1', 'sh', 'toml', 'xml'])
const HASH_COMMENT_EXTS = new Set(['yaml', 'yml', 'py', 'sh', 'ps1', 'toml'])
const INFLIGHT_STALE_MS = 5 * 60 * 1000 // in-flight 条目超过该年龄视为死进程残留

// F6:高风险命令模式表(DSH hardGate v1.2 移植)
const FORBIDDEN = [
  { re: /\bRemove-Item\b[^\n]*-(Recurse|Force)/i, label: 'Remove-Item -Recurse/-Force' },
  { re: /\bformat\b\s+[a-z]:/i, label: 'format 盘符' },
  { re: /\bdel\b[^\n]*\/[fsq]/i, label: 'del /f /s /q' },
  { re: /\brm\b\s+-[rf]{1,2}\b/i, label: 'rm -r/-f/-rf' },
  { re: /\bri\b[^\n]*-Recurse/i, label: 'ri -Recurse' },
]

// F1:重要文件判定
function globToRegex(pattern) {
  const body = pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')
  return new RegExp(`^${body}$`)
}
const IMPORTANT_RES = IMPORTANT_PATTERNS.map(globToRegex)
function isImportantByPattern(filePath) {
  const norm = String(filePath).replace(/\\/g, '/')
  const base = norm.split('/').pop() ?? ''
  return IMPORTANT_RES.some((re) => re.test(norm) || re.test(base))
}
// 前 100 行内出现"行首注释引导形态"的 /force-read 才算标记(与 core/semantics.md 同源)。
// 2026-10-05 修正:纯子串匹配会误伤正文提到 token 的文档(狗粮发现 #1)。
const FORCE_READ_MARKER_RE = new RegExp('^\\s*(?:\\/\\/\\/?|#+|\\/\\*|\\*\\/|<!--|--|;|%)\\s*\\/force-read\\b')
function hasForceReadMarker(head) {
  return String(head).split(/\r?\n/).slice(0, 100).some((line) => FORCE_READ_MARKER_RE.test(line))
}

// 覆盖区间合并
function mergeRange(ranges, add) {
  const all = [...ranges, add].sort((a, b) => a[0] - b[0])
  const out = []
  for (const r of all) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}
function gapsOf(ranges, total) {
  const gaps = []
  let cur = 1
  for (const [s, e] of ranges) {
    if (s > cur) gaps.push([cur, Math.min(s - 1, total)])
    cur = Math.max(cur, e + 1)
  }
  if (cur <= total) gaps.push([cur, total])
  return gaps
}
const gapsText = (gaps) => gaps.map(([s, t]) => `${s}-${t}`).join('、')

// 文件行数(与 Read 工具计数口径对齐:结尾换行不产生空行)
function lineCount(text) {
  const n = text.split(/\r?\n/).length
  return text.length > 0 && text.endsWith('\n') ? n - 1 : n
}

// F3a/F4:失败判定(DSH failureDetect 签名移植,面向 Codex 响应格式泛化)
function detectFailure(responseText, isError) {
  if (isError === true) return true
  const text = String(responseText ?? '')
  if (!text) return false
  if (/\[exit[^\]]*code[^\]]*[:：]\s*[1-9]/.test(text)) return true
  if (/"exit_?code"\s*:\s*[1-9]/.test(text)) return true
  if (/"is_?error"\s*:\s*true/i.test(text)) return true
  if (/\bexit code [1-9]/.test(text)) return true
  if (/\[stderr\][\s\S]{0,200}(error|failed|exception|cannot|can't|not found|no such file|does not exist|access denied|找不到|不存在|拒绝访问|无法)/im.test(text)) return true
  if (/"stderr"\s*:\s*"[^"]{0,200}(error|failed|exception|cannot|not found|no such file|does not exist|access denied)/im.test(text)) return true
  return false
}

// F5:lightParse(DSH 移植:字符串/注释感知括号配对;对正常代码零误报)
// 2026-10-05 扩展(狗粮发现 #2,DSH 原版同缺陷):增加正则字面量识别。
const REGEX_START_CHARS = '=([{,;:!&|?+-*%^~<>'
const REGEX_START_KEYWORDS = new Set(['return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'yield', 'await', 'throw', 'else', 'do'])
function lightParse(filePath, content) {
  const issues = []
  const ext = (String(filePath).split('.').pop() ?? '').toLowerCase()
  if (!CHECK_EXTENSIONS.has(ext)) return issues
  if (ext === 'json') {
    try { JSON.parse(content) } catch (e) {
      issues.push(`JSON 解析失败: ${String(e?.message ?? e).slice(0, 80)}`)
    }
    return issues
  }
  const pairs = { '{': '}', '[': ']', '(': ')' }
  const closes = { '}': '{', ']': '[', ')': '(' }
  const quoteClose = { single: "'", double: '"', backtick: '`' }
  const stack = []
  let state = 'code' // code | single | double | backtick | line-comment | block-comment | regex | regex-class
  let lastCodeChar = ''
  let lastWord = ''
  const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c)
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    const nxt = content[i + 1]
    if (c === '\n') {
      if (state === 'line-comment') state = 'code'
      if (state === 'regex' || state === 'regex-class') state = 'code' // 未闭合正则:fail-open
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

module.exports = {
  FORCE_READ_TOKEN, IMPORTANT_PATTERNS, READ_TTL_MS, MAX_STRIKES, MAX_FAILURES,
  CHECK_EXTENSIONS, INFLIGHT_STALE_MS, FORBIDDEN,
  isImportantByPattern, hasForceReadMarker, mergeRange, gapsOf, gapsText,
  lineCount, detectFailure, lightParse,
}
