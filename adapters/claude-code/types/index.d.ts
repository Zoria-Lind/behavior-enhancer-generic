// behavior-enhancer 的 $.state 类型契约。
// 每项值都声明在 PluginState 下,claude plugin validate 按此核对模块里的 $.state 键。

/** 行区间 [start, end],闭区间,1 起。 */
export type Range = [number, number]

/** 会话级读覆盖注册表:绝对路径 → 已读行区间并集 + 最后读取时间(ms)+ 内容哈希(F1:TTL 过期后判未变)。 */
export type ReadRegistry = Record<string, { ranges: Range[]; at: number; hash?: string }>

declare module 'claude-code' {
  interface PluginState {
    'behavior-enhancer': {
      readRegistry: ReadRegistry
    }
  }
}
