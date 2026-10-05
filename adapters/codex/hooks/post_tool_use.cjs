// behavior-enhancer — Codex PostToolUse hook(观察面 + 报告面)。
// 协议(源码查证):stdout 输出 hookSpecificOutput.additionalContext = 模型可见
// 上下文(PostToolUse 的 sync handler 已实测支持);放行 = 空 stdout。
// 铁律:任何异常 fail-open;绝不 exit 2。

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const S = require('./semantics.cjs')
const St = require('./state.cjs')

function main(input) {
  const tool = String(input.tool_name ?? '')
  const toolInput = input.tool_input ?? {}
  const toolUseId = String(input.tool_use_id ?? '')
  const cwd = String(input.cwd ?? '')
  const response = input.tool_response
  const isError = !!response && typeof response === 'object'
    && (response.is_error === true || response.isError === true || !!response.error)
  const responseText = typeof response === 'string' ? response : JSON.stringify(response ?? '')

  if (toolUseId) St.inflightRemove(toolUseId)
  const notes = []

  // 本插件自己的 deny 文本进了 tool_response 时不算失败(被拦 ≠ 失败)
  const isOwnDeny = responseText.includes('[behavior-enhancer]')

  // ---- F1:Read 成功 → 记覆盖(offset+limit 算"至少覆盖"下界) ----
  if (tool === 'Read' && !isError && typeof toolInput.file_path === 'string' && toolInput.pages === undefined) {
    const offset = typeof toolInput.offset === 'number' ? toolInput.offset : 1
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : 2000
    St.mutate((st) => {
      const now = Date.now()
      const clean = {}
      for (const [k, v] of Object.entries(st.readRegistry)) {
        if (now - v.at < S.READ_TTL_MS) clean[k] = v
      }
      const cur = clean[toolInput.file_path]?.ranges ?? []
      clean[toolInput.file_path] = { ranges: S.mergeRange(cur, [offset, offset + limit - 1]), at: now }
      st.readRegistry = clean
    })
  }

  // ---- F5:Write/Edit/apply_patch 写后校验 + 自动回滚(DSH postWriteCheck 语义) ----
  const isWriteTool = tool === 'Write' || tool === 'Edit' || tool === 'apply_patch'
  if (isWriteTool && !isError) {
    // apply_patch 一次可改多个文件:路径从 pendingCalls 取;Write/Edit 走 file_path
    const paths = St.mutate((st) => {
      const calls = st.pendingCalls[String(toolUseId)] ?? []
      delete st.pendingCalls[String(toolUseId)]
      return calls.length > 0 ? calls : (typeof toolInput.file_path === 'string' ? [toolInput.file_path] : [])
    })
    for (const rawPath of paths) {
      const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(cwd || '.', rawPath)
      const snap = St.mutate((st) => {
        const p = st.pending[filePath]
        if (p) delete st.pending[filePath]
        return p ?? null
      })
      if (!snap) continue
      try {
        const after = fs.readFileSync(filePath, 'utf8')
        const issues = S.lightParse(filePath, after)
        if (issues.length > 0) {
          const ok = St.rollback(snap, filePath)
          St.mutate((st) => { st.stats['postWriteCheck.rollbacks']++ })
          notes.push(`[behavior-enhancer] 写后校验发现 ${issues.length} 个问题,` +
            `${ok ? '已自动回滚到写入前版本' : '回滚失败,文件保持写入后状态'}。` +
            `问题:${issues.slice(0, 3).join('; ')}。` +
            `注意:检查的是整个文件,问题可能包含写入前就有的旧问题;请修正后重新写入。`)
        } else if (!snap.existed) {
          try { fs.unlinkSync(snap.snapPath) } catch { /* 新文件写对:清占位快照,失败不致命 */ }
        }
      } catch { /* 读取失败:跳过(快照保留为历史) */ }
    }
  }

  // ---- F3a + F4 + F3b:失败检测 / 连续失败介入 / 档位升降 ----
  if (!isOwnDeny) {
    const r = St.mutate((st) => {
      const out = { tierNote: null, alert: null }
      if (S.detectFailure(responseText, isError)) {
        const n = (st.streaks[tool] ?? 0) + 1
        st.streaks[tool] = n
        st.stats['behavior.failures']++
        if (st.tier !== 1) {
          st.tier = 1
          st.stats['behavior.serialized']++
          out.tierNote = '[behavior-enhancer] 并行收敛:检测到失败,档位已降为 1。下一条消息只发 1 个工具调用,先写失败原因;连续 3 次成功升 3 个、再 3 次恢复不限。'
        }
        st.successStreak = 0
        if (n >= S.MAX_FAILURES) {
          delete st.streaks[tool] // 提醒后重置,避免每轮重复(DSH 同款)
          st.stats['behavior.alerts']++
          out.alert = `[behavior-enhancer] 工具 ${tool} 已连续失败 ${n} 次。请停止重试,向用户说明失败原因并询问下一步(或切换方案)。`
        }
      } else {
        delete st.streaks[tool]
        // 阶梯恢复(被 deny 的调用不走这里)
        if (st.tier !== 0) {
          st.successStreak++
          if (st.tier === 1 && st.successStreak >= 3) {
            st.tier = 3
            st.successStreak = 0
          } else if (st.tier === 3 && st.successStreak >= 3) {
            st.tier = 0
            st.successStreak = 0
            st.stats['behavior.restored']++
          }
        }
      }
      return out
    })
    if (r.tierNote) notes.push(r.tierNote)
    if (r.alert) notes.push(r.alert)
  }

  if (notes.length > 0) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: notes.join('\n'),
      },
    })
  }
  return '' // 放行/无提醒:空 stdout
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
