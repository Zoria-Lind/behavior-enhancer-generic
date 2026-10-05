// behavior-enhancer — Codex PreToolUse hook(拦截面)。
// 协议(源码查证 codex-rs hooks):stdin = 单行 JSON;deny = stdout 输出
// hookSpecificOutput.permissionDecision=deny;放行 = 空 stdout(非 JSON 一律视为放行)。
// 铁律:任何异常 fail-open;绝不 exit 2(exit 2 + stderr 在 Codex = 拦截)。

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const S = require('./semantics.cjs')
const St = require('./state.cjs')

function deny(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })
}

function main(input) {
  const tool = String(input.tool_name ?? '')
  const toolInput = input.tool_input ?? {}
  const toolUseId = String(input.tool_use_id ?? '')
  const cwd = String(input.cwd ?? '')

  // ---- F6:hardGate(Bash + PowerShell;逃生 = 同原因超过 maxStrikes 次放行) ----
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(toolInput.command ?? '')
    const hit = S.FORBIDDEN.find((f) => f.re.test(command))
    if (hit) {
      const n = St.mutate((st) => {
        const n = (st.strikes['high-risk-command'] ?? 0) + 1
        st.strikes['high-risk-command'] = n
        if (n > S.MAX_STRIKES) {
          st.stats['hardGate.escape']++
          return null // 逃生:超过阈值放行,防空转死锁
        }
        st.stats['hardGate.denied']++
        return n
      })
      if (n !== null) {
        return deny(`[behavior-enhancer] 高风险命令已拦截(${hit.label},第 ${n} 次)。` +
          `请先向用户说明影响范围并获得确认;连续超过 ${S.MAX_STRIKES} 次将自动放行以防空转。`)
      }
    }
  }

  // ---- F3b:并发窗口 veto(计数+登记同一把锁内,跨进程原子) ----
  if (toolUseId) {
    const over = St.mutate((st) => {
      if (st.tier === 0) { St.inflightAdd(toolUseId); return null }
      if (St.inflightCount() >= st.tier) return st.tier
      St.inflightAdd(toolUseId)
      return null
    })
    if (over !== null) {
      return deny(`[behavior-enhancer] 并行收敛:当前档位 ${over}(一次最多 ${over} 个并发调用),` +
        `已有 ${over} 个在跑。请等已发出的调用全部结束、确认结果后再继续;不要在同一轮里重发被拦截的调用。`)
    }
  }

  // ---- F1:Write/Edit/apply_patch 读前检查(veto)+ F5:写前快照登记 ----
  // 0.154 实测:写文件没有 Write/Edit 工具,canonical 名是 apply_patch,
  // tool_input = { command: "*** Begin Patch\n*** Update File: <path>..." }。
  const isWriteTool = tool === 'Write' || tool === 'Edit' || tool === 'apply_patch'
  if (isWriteTool) {
    const paths = []
    if (tool === 'apply_patch') {
      // 从补丁文本提取目标文件(Update/Add/Delete File 标记)
      const patch = String(toolInput.command ?? '')
      const re = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm
      let m
      while ((m = re.exec(patch)) !== null) paths.push(m[1].trim())
    } else if (typeof toolInput.file_path === 'string' && toolInput.file_path.length > 0) {
      paths.push(toolInput.file_path)
    }
    for (const rawPath of paths) {
      const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(cwd || '.', rawPath)
      try {
        const before = fs.readFileSync(filePath, 'utf8')
        const total = S.lineCount(before)
        const important = S.isImportantByPattern(filePath) || S.hasForceReadMarker(before)
        let covered = []
        try {
          const st = St.load()
          const now = Date.now()
          const clean = {}
          for (const [k, v] of Object.entries(st.readRegistry)) {
            if (now - v.at < S.READ_TTL_MS) clean[k] = v
          }
          covered = clean[filePath]?.ranges ?? []
        } catch { covered = [] } // 状态读不到按未读处理,但绝不让检查异常阻断写入
        const gaps = S.gapsOf(covered, total)
        if (important && gaps.length > 0) {
          St.mutate((st) => { st.stats['readBeforeWrite.denied']++ })
          if (toolUseId) St.inflightRemove(toolUseId) // 被拦的调用不留 in-flight 幽灵条目
          return deny(`[behavior-enhancer] ${filePath} 是重要文件(共 ${total} 行),未读区间: ${S.gapsText(gaps)}。` +
            `请先用 Read 补读(建议从第一个未读区间 offset=${gaps[0][0]} 开始),读完再改。`)
        }
      } catch { /* 新文件或读取失败:豁免读前检查 */ }
      // F5:写前快照(新文件也登记:回滚=删除;snapshot 自带 exists 判断)
      St.mutate((st) => {
        const snap = St.snapshot(filePath)
        if (snap) {
          st.pending[filePath] = { ...snap, at: Date.now() }
          st.pendingCalls[String(toolUseId)] = [...(st.pendingCalls[String(toolUseId)] ?? []), filePath]
        }
      })
    }
  }

  return '' // 放行:空 stdout
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { buf += c })
process.stdin.on('end', () => {
  let input = {}
  try { input = JSON.parse(buf || '{}') } catch (e) { console.error('[behavior-enhancer] stdin 解析失败:', e?.message ?? e) }
  let out = ''
  try { out = main(input) } catch (e) { console.error('[behavior-enhancer] hook 异常(fail-open):', e?.stack ?? e) }
  process.stdout.write(out)
})
