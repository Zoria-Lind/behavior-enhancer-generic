// 纪律条目数据层(B2)。结构:{ id, level:'hard'|'soft', scope:'global'|'preset'|'project', text, tags?, check? }
// 铁律(30 B2):与内核重复的条目不收——
//   "同类修改串行"由 edit/write/pwsh 的 exclusive 屏障硬保证,删除。
// generic 版恢复"先读后写"条目:内核 dsh-fs-observation-policy 的"edit requires reading first"
// 未经本产品实测(verified-native 原则),F1 模块保留自己的硬闸,提示词需教模型
// /force-read 标记规则(注释形态)供自觉补读。
// check? 为硬约束校验函数预留(B3 类闸门的未来挂点);本版无消费者,保留形状。
// level 约定:hard=将来必须配 check(内核可强制);soft=提示词软约束。
// 段名纪律:渲染段的 section 名固定 'behavior-discipline',避开 dsh-better-edit
// 已占用的 tool:read(130) / tool:edit(131) / tool:undo_last_edit(133)。

export const DISCIPLINE_ENTRIES = [
  {
    id: 'read-before-write',
    level: 'soft',
    scope: 'global',
    tags: ['quality'],
    text: '先读后写:修改任何文件前先 read 确认当前内容,禁止盲写;文件头 100 行内有 /force-read 注释标记(如 // /force-read 或 # /force-read)的重要文件(package.json、*.config.*、*.lock、CI 配置等)必须完整读完才许写,未读完会被拦截。',
  },
  {
    id: 'verify-before-batch',
    level: 'soft',
    scope: 'global',
    tags: ['quality'],
    text: '批量操作前先验证:对多个目标做同类操作时,先对其中一个试做并确认结果,再批量执行。',
  },
  {
    id: 'fail-fast-converge',
    level: 'soft',
    scope: 'global',
    tags: ['quality'],
    text: '失败立即收敛:任何工具调用失败后,停下分析原因,不要基于错误前提继续发起新调用;用更小的单步重试。',
  },
  {
    id: 'evidence-honesty',
    level: 'soft',
    scope: 'global',
    tags: ['quality'],
    text: '证据与诚实:回答用户前核实证据;引用文件路径前先确认文件存在;不确定就明说不知道,禁止编造或臆想。',
  },
  {
    id: 'post-compaction-log',
    level: 'soft',
    scope: 'global',
    tags: ['quality'],
    text: '上下文已压缩时:若历史被压缩为摘要(compacted-summary),对细节有疑问先查日志或重新获取,不要臆造。',
  },
  {
    id: 'token-economy',
    level: 'soft',
    scope: 'global',
    tags: ['efficiency'],
    text: '省 token:大范围搜索/多文件阅读用 subagent 汇总返回;长任务中段主动 compact 或新开会话;纯机械活用 fast 模型。',
  },
]

// strict 预设增量(仍为 soft;硬约束需要 check 实现,一期不承诺)
export const STRICT_EXTRA_ENTRIES = [
  {
    id: 'confirm-destructive',
    level: 'soft',
    scope: 'preset',
    tags: ['safety'],
    text: '删除/覆盖重要数据前,先向用户确认再动手。',
  },
  {
    id: 'dry-run-first',
    level: 'soft',
    scope: 'preset',
    tags: ['safety'],
    text: '影响面大的命令先做只读预演(--help / --list / dry-run),确认效果再执行。',
  },
]
