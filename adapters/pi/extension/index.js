// behavior-enhancer — Pi extension(FULL 层)。
// API 全部源码查证(packages/coding-agent/src/core/extensions/types.ts + runner.ts):
//   - tool_call handler 返回 { block, reason } → 工具不执行,reason 成为错误结果文本(模型可见)
//   - tool_result handler 返回 { content } 全量覆盖 → 追加提醒文本 = 模型可见通道
//   - before_agent_start 可改 event.systemPromptOptions.sections(每段按名字包 tag 渲染)
//   - extension 在 pi 进程内(Node 全量可用、单事件循环无跨进程竞态)
// 行为语义与 core/semantics.md 同源(vendored semantics.js)。铁律 fail-open。

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const S = require('./semantics.js')
const St = require('./state.js')

function resolvePath(cwd, p) {
  const s = String(p ?? '')
  return path.isAbsolute(s) ? s : path.resolve(cwd || '.', s)
}

// ---- F2:纪律段(带实时档位行,与 CC 版同文案) ----
function disciplineText() {
  const st = St.state
  const tierText = st.tier === 0
    ? '不限(正常)'
    : st.tier === 1
      ? '1 个(失败后串行,连 3 成功升 3 个)'
      : '3 个(恢复中,再 3 成功恢复不限)'
  return `工具调用行为纪律(behavior-enhancer 插件):
- 先读后写:修改文件前先 read 确认当前内容;文件头 100 行内有 ${S.FORCE_READ_TOKEN} 注释标记(如 // ${S.FORCE_READ_TOKEN} 或 # ${S.FORCE_READ_TOKEN})的重要文件(package.json、*.config.*、*.lock、CI 配置等)必须完整读完才许写,未读完会被拦截。
- 失败立即收敛:工具失败后停止重试、分析原因、小步重试;同工具连续失败 ${S.MAX_FAILURES} 次会被提醒停手并向用户说明原因。
- 并行收敛:并行调用前确认各调用无依赖且低风险;失败后档位降为 1(一次最多 1 个并发调用),连续 3 次成功升 3 个、再 3 次恢复不限,超档位的并发调用会被拦截。
- 写后检查:JSON/YAML/代码文件写坏会自动回滚并报告(括号配对等轻量校验)。
- 高风险命令(rm -rf、Remove-Item -Recurse、format、del /s 等)会被拦截,执行前先向用户说明影响范围并获得确认;被拒后不换写法绕过。
- 验证环:改过文件必须给出验证证据,没有就明说"尚未验证";不确定就明说,禁止编造。
- 并行档位(实时,由本插件按失败/成功自动升降):当前 ${tierText};连续成功 ${st.successStreak}/3。`
}

module.exports = function behaviorEnhancer(pi) {
  // ---- F2:每次请求前把纪律段写进 system prompt sections ----
  pi.on('before_agent_start', (event) => {
    try {
      event.systemPromptOptions.sections['behavior-enhancer'] = disciplineText()
    } catch { /* fail-open */ }
  })

  // ---- 拦截面:tool_call ----
  pi.on('tool_call', (event, ctx) => {
    const tool = event.toolName
    const input = event.input ?? {}

    // F6:hardGate(bash/powershell;逃生 = 同原因超过 maxStrikes 次放行)
    if (tool === 'bash' || tool === 'powershell') {
      const command = String(input.command ?? '')
      const hit = S.FORBIDDEN.find((f) => f.re.test(command))
      if (hit) {
        const st = St.state
        const n = (st.strikes['high-risk-command'] ?? 0) + 1
        st.strikes['high-risk-command'] = n
        if (n > S.MAX_STRIKES) {
          St.bump('hardGate.escape')
          // 逃生:放行(继续走窗口/快照逻辑)
        } else {
          St.bump('hardGate.denied')
          St.save()
          return {
            block: true,
            reason: `[behavior-enhancer] 高风险命令已拦截(${hit.label},第 ${n} 次)。` +
              `请先向用户说明影响范围并获得确认;连续超过 ${S.MAX_STRIKES} 次将自动放行以防空转。`,
          }
        }
      }
    }

    // F3b:并发窗口 veto(进程内计数,天然原子;block 不登记 in-flight)
    if (St.state.tier !== 0 && St.inflightCount() >= St.state.tier) {
      return {
        block: true,
        reason: `[behavior-enhancer] 并行收敛:当前档位 ${St.state.tier}(一次最多 ${St.state.tier} 个并发调用),` +
          `已有 ${St.inflightCount()} 个在跑。请等已发出的调用全部结束、确认结果后再继续;不要在同一轮里重发被拦截的调用。`,
      }
    }
    St.inflightAdd(event.toolCallId)

    // F1 + F5-pre:write/edit 读前检查 + 写前快照
    if ((tool === 'write' || tool === 'edit') && typeof input.path === 'string') {
      const filePath = resolvePath(ctx.cwd, input.path)
      let before = null
      try { before = fs.readFileSync(filePath, 'utf8') } catch { /* 新文件 */ }
      if (before !== null) {
        const total = S.lineCount(before)
        const important = S.isImportantByPattern(filePath) || S.hasForceReadMarker(before)
        let covered = []
        try {
          const st = St.state
          const now = Date.now()
          const clean = {}
          for (const [k, v] of Object.entries(st.readRegistry)) {
            if (now - v.at < S.READ_TTL_MS) clean[k] = v
          }
          covered = clean[filePath]?.ranges ?? []
        } catch { covered = [] } // 状态读不到按未读处理,但绝不让检查异常阻断写入
        const gaps = S.gapsOf(covered, total)
        if (important && gaps.length > 0) {
          St.bump('readBeforeWrite.denied')
          St.inflightRemove(event.toolCallId) // 被拦的调用不留 in-flight 条目
          return {
            block: true,
            reason: `[behavior-enhancer] ${filePath} 是重要文件(共 ${total} 行),未读区间: ${S.gapsText(gaps)}。` +
              `请先用 read 补读(建议从第一个未读区间 offset=${gaps[0][0]} 开始),读完再写。`,
          }
        }
        St.snapshotRegister(event.toolCallId, filePath, before)
      } else {
        St.snapshotRegisterNew(event.toolCallId, filePath) // 新文件:回滚=删除
      }
    }
    return undefined // 放行
  })

  // ---- 观察面 + 报告面:tool_result ----
  pi.on('tool_result', (event, ctx) => {
    St.inflightRemove(event.toolCallId)
    const tool = event.toolName
    const input = event.input ?? {}
    const notes = []
    const text = (event.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
    const isOwnDeny = text.includes('[behavior-enhancer]')

    // F1:read 成功 → 记覆盖(offset 1-indexed,limit 默认与 CC 一致取 2000)
    if (tool === 'read' && !event.isError && typeof input.path === 'string') {
      try {
        const filePath = resolvePath(ctx.cwd, input.path)
        const offset = typeof input.offset === 'number' ? input.offset : 1
        const limit = typeof input.limit === 'number' ? input.limit : 2000
        const st = St.state
        const now = Date.now()
        const clean = {}
        for (const [k, v] of Object.entries(st.readRegistry)) {
          if (now - v.at < S.READ_TTL_MS) clean[k] = v
        }
        const cur = clean[filePath]?.ranges ?? []
        clean[filePath] = { ranges: S.mergeRange(cur, [offset, offset + limit - 1]), at: now }
        st.readRegistry = clean
        St.save()
      } catch { /* fail-open */ }
    }

    // F5:write/edit 写后校验 + 自动回滚(DSH postWriteCheck 语义)
    if ((tool === 'write' || tool === 'edit') && !event.isError && typeof input.path === 'string') {
      const filePath = resolvePath(ctx.cwd, input.path)
      const snap = St.snapshotTake(event.toolCallId)
      if (snap) {
        try {
          const after = fs.readFileSync(filePath, 'utf8')
          const issues = S.lightParse(filePath, after)
          if (issues.length > 0) {
            let ok
            try {
              if (snap.existed) fs.writeFileSync(filePath, snap.content)
              else fs.rmSync(filePath, { force: true })
              ok = true
            } catch { ok = false }
            St.bump('postWriteCheck.rollbacks')
            notes.push(`[behavior-enhancer] 写后校验发现 ${issues.length} 个问题,` +
              `${ok ? '已自动回滚到写入前版本' : '回滚失败,文件保持写入后状态'}。` +
              `问题:${issues.slice(0, 3).join('; ')}。` +
              `注意:检查的是整个文件,问题可能包含写入前就有的旧问题;请修正后重新写入。`)
          }
        } catch { /* 读取失败:跳过 */ }
      }
    }

    // F3a + F4 + F3b:失败检测 / 连续失败介入 / 档位升降(被 deny 的不算失败)
    if (!isOwnDeny) {
      const st = St.state
      if (S.detectFailure(text, event.isError)) {
        const n = (st.streaks[tool] ?? 0) + 1
        st.streaks[tool] = n
        St.bump('behavior.failures')
        if (st.tier !== 1) {
          st.tier = 1
          St.bump('behavior.serialized')
          notes.push('[behavior-enhancer] 并行收敛:检测到失败,档位已降为 1。下一条消息只发 1 个工具调用,先写失败原因;连续 3 次成功升 3 个、再 3 次恢复不限。')
        }
        st.successStreak = 0
        if (n >= S.MAX_FAILURES) {
          delete st.streaks[tool] // 提醒后重置,避免每轮重复(DSH 同款)
          St.bump('behavior.alerts')
          notes.push(`[behavior-enhancer] 工具 ${tool} 已连续失败 ${n} 次。请停止重试,向用户说明失败原因并询问下一步(或切换方案)。`)
        }
        St.save()
      } else {
        if (st.streaks[tool] !== undefined) {
          delete st.streaks[tool]
          St.save()
        }
        // 阶梯恢复(被 deny 的调用不走这里)
        if (st.tier !== 0) {
          st.successStreak++
          if (st.tier === 1 && st.successStreak >= 3) {
            st.tier = 3
            st.successStreak = 0
          } else if (st.tier === 3 && st.successStreak >= 3) {
            st.tier = 0
            st.successStreak = 0
            St.bump('behavior.restored')
          }
          St.save()
        }
      }
    }

    if (notes.length > 0) {
      return { content: [...(event.content ?? []), { type: 'text', text: notes.join('\n') }] }
    }
    return undefined
  })
}
