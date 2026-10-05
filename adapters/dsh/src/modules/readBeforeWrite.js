// F1 先读后写(read-before-write;generic 独有,2026-10-05,原插件无此模块)。
// 机制:read 成功 → 记覆盖区间(请求 offset+limit 算"至少覆盖"下界,会话内 TTL);
// write/edit 前 → 查覆盖:重要文件(默认模式表 ∪ 文件头 100 行内行首注释形态
// /force-read 标记)未读完 → deny(强制分页读满);普通文件有洞 → 计数提醒
// (DSH pre-execute 无"放行+模型可见提醒"通道,console 记录,v1 只计数)。
// 铁律:任何状态/文件问题都不能阻断主任务(fail-open)。

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const FORCE_READ_TOKEN = '/force-read'
// 行首注释引导形态(与 core/semantics.md 同源;字符串构造避免自身源码触发 lightParse)
const FORCE_READ_MARKER_RE = new RegExp('^\\s*(?:\\/\\/\\/?|#+|\\/\\*|\\*\\/|<!--|--|;|%)\\s*\\/force-read\\b')

function globToRegex(pattern) {
  const body = pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')
  return new RegExp(`^${body}$`)
}
function isImportantByPattern(filePath, patterns) {
  const norm = String(filePath).replace(/\\/g, '/')
  const base = norm.split('/').pop() ?? ''
  return patterns.some((p) => {
    const re = globToRegex(p)
    return re.test(norm) || re.test(base)
  })
}
function hasForceReadMarker(head) {
  return String(head).split(/\r?\n/).slice(0, 100).some((line) => FORCE_READ_MARKER_RE.test(line))
}
// 文件行数(与 read 工具计数口径对齐:结尾换行不产生空行)
function lineCount(text) {
  const n = text.split(/\r?\n/).length
  return text.length > 0 && text.endsWith('\n') ? n - 1 : n
}
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

export function createReadBeforeWriteModule(ctx, config, stats) {
  if (!config?.enabled) return () => {}
  if (!ctx || typeof ctx.on !== 'function') return () => {}

  const ttlMs = Number.isFinite(config.ttlMs) ? config.ttlMs : 3600000
  const patterns = Array.isArray(config.importantPatterns) && config.importantPatterns.length > 0
    ? config.importantPatterns
    : ['package.json', '*.config.*', '*.lock', 'Dockerfile', 'Makefile', '.github/workflows/*']
  const writeTools = new Set(['write', 'edit'])

  // 会话级读覆盖注册表:absPath → { ranges: [[s,e],...], at }
  const registry = new Map()
  const prune = (now) => {
    for (const [k, v] of registry) if (now - v.at >= ttlMs) registry.delete(k)
  }

  // 路径解析(与 postWriteCheck 的 resolveCheckPath 同口径:会话 cwd,禁 process.cwd)
  const resolveCheckPath = (exec, p) => {
    if (isAbsolute(p)) return resolve(p)
    const headerCwd = exec?.agent?.session?.header?.cwd
    if (typeof headerCwd === 'string' && headerCwd.length > 0) return resolve(headerCwd, p)
    return null
  }

  // read 成功 → 记覆盖
  const onResult = (exec, result) => {
    try {
      if (exec?.name !== 'read' || result?.isError) return
      const args = exec?.arguments ?? {}
      const p = typeof args.path === 'string' ? args.path : (typeof args.file_path === 'string' ? args.file_path : null)
      if (!p) return
      const absPath = resolveCheckPath(exec, p)
      if (!absPath) return
      const offset = typeof args.offset === 'number' ? args.offset : 1
      const limit = typeof args.limit === 'number' ? args.limit : 2000
      const now = Date.now()
      prune(now)
      const cur = registry.get(absPath)?.ranges ?? []
      registry.set(absPath, { ranges: mergeRange(cur, [offset, offset + limit - 1]), at: now })
    } catch { /* fail-open */ }
  }

  // write/edit 前 → 查覆盖(重要文件未读完 → deny)
  const onPre = async (exec, next) => {
    try {
      const name = exec?.name
      if (!writeTools.has(name)) return next()
      const args = exec?.arguments ?? {}
      const p = typeof args.file_path === 'string' && args.file_path.trim().length > 0
        ? args.file_path.trim()
        : (typeof args.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : null)
      if (!p) return next()
      const absPath = resolveCheckPath(exec, p)
      if (!absPath) return next() // 相对路径无法解析:豁免(与 postWriteCheck 同口径)
      let before
      try { before = readFileSync(absPath, 'utf8') } catch { return next() } // 新文件/读失败:豁免
      const total = lineCount(before)
      const important = isImportantByPattern(absPath, patterns) || hasForceReadMarker(before)
      const now = Date.now()
      prune(now)
      const gaps = gapsOf(registry.get(absPath)?.ranges ?? [], total)
      if (important && gaps.length > 0) {
        stats?.bump('readBeforeWrite.denied', 1)
        return {
          kind: 'deny',
          reason: `[behavior-enhancer] ${absPath} 是重要文件(共 ${total} 行),未读区间: ${gapsText(gaps)}。` +
            `请先用 read 补读(建议从第一个未读区间 offset=${gaps[0][0]} 开始),读完再写。`,
        }
      }
      if (gaps.length > 0) {
        stats?.bump('readBeforeWrite.warns', 1)
        console.log(`[behavior-enhancer] 提醒:${absPath} 共 ${total} 行,未读区间 ${gapsText(gaps)};建议补读后再确认写入内容。(仅提醒,不拦截)`)
      }
    } catch { /* fail-open */ }
    return next()
  }

  ctx.on('tools/result', onResult)
  ctx.on('tools/pre-execute', onPre)

  return () => {
    try { ctx.off?.('tools/result', onResult) } catch { /* noop */ }
    try { ctx.off?.('tools/pre-execute', onPre) } catch { /* noop */ }
  }
}
