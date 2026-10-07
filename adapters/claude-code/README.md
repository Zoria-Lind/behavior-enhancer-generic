# behavior-enhancer — Claude Code 适配器(FULL 层)

behavior-enhancer-generic 的 Claude Code 插件适配器。行为语义同源文件:[`core/semantics.md`](../../core/semantics.md)(规则以 DSH 版为起点,此后独立演进);能力矩阵:[`core/audit.md`](../../core/audit.md)。

## Feature 状态

| Feature | 态 | 实现 |
| :--- | :--- | :--- |
| F1 read-before-write | **FULL** | Read 成功记覆盖(`$.state`+TTL 1h);Write/Edit 前查覆盖,重要文件未覆盖 **veto**、普通文件有洞 **warn** |
| F2 behaviorPrompt | **FULL** | `prompt.compose` 注入纪律段(静态文本,缓存友好) |
| F3a 失败检测 | **FULL** | 全工具 post 检查,isError + DSH 失败签名,计次 |
| F3b 并行度控制 | **FULL(拦截等价)** | 无并行度 API → 并发窗口 veto:in-flight 计数,超档位调用当场 deny;档位阶梯 失败→1 →连3成功→3 →再3成功→不限,失败时 context 注入降档提醒,`prompt.compose` 每轮渲染实时档位行 |
| F4 failureGuard | **FULL** | 同工具连续失败 ≥2 → 结果 context 注入停手提醒,重置计数 |
| F5 postWriteCheck | **FULL** | 写前内存快照 → 写后 lightParse(DSH 移植)→ 坏则自动回滚 + 报告 |
| F6 hardGate | **FULL** | Bash/PowerShell 高危命令 deny + 3 次逃生(DSH 同款) |
| F7 verifyLoop | SOFT | 纪律段(改完必须给验证证据);结果消息提醒待实测 |
| F8 writeDiffVerify | v1.5 | shell 前后 diff 报告排 v1.5(与方案一致) |
| F9 compliance | **FULL** | `$.store` 计次 + `/behavior-status` 命令 |

## 安装 / 启用

```sh
# 单会话试用
claude --plugin-dir "<仓库目录>\adapters\claude-code"

# 常驻:环境变量(desktop/SDK 启动也能读;路径用平台分隔符)
# CLAUDE_CODE_PLUGIN_DIRS=...\adapters\claude-code
```

交互式会话里该目录被 watch,改代码热重载;`$.state`/`$.store` 由宿主保存,重载不清零。

## 验证

```sh
cd adapters/claude-code
claude plugin validate .   # 引擎静态校验(manifest + hooks 源码)
claude plugin test .       # 14 个引擎级测试(虚拟 fs/state/store 全链)
```

## 诚实交底(v1 与方案/DSH 的差异)

- **快照是内存的**:CC 插件环境无 Node、无 home 目录 API、`$.fs` 无删除 API,方案里的
  `~/.behavior-enhancer/snapshots/` 磁盘 .bak 历史(每文件 5 份)排 v1.1;自动回滚功能完整
  (写前内存快照 → 写后恢复)。
- **新文件写坏**:无法删除,回滚 = 清空为空白文件,报告如实说明。
- **hardGate 无 ask 模式**:DSH 默认 ask(无审批服务时降级 deny);CC v1 直接 deny,
  逃生语义一致(同一原因连续 >3 次放行);CC 的 `tool.check` 'ask' 决策是 v1.1 补
  ask 模式的候选通道。
- **逃生计数共享**:所有高风险命令共享同一个 reason 计数(与 DSH 一致,不是按命令)。
- **F3b 是"拦截等价"不是"并行度控制"**:引擎仍会派发全部并发调用,超档位的被 deny——
  效果等同 DSH 池上限,但模型收到的是错误结果而非静默排队,每条 deny 都带档位与规则
  (负反馈闭环);代价是超发时多耗一轮错误+重试 token。subagent 的调用与主循环共享同一窗口(v1)。
- **并行档位为模块级状态**:热重载清零 = 恢复不限(fail-open);会话内跨消息有效。
- **重要文件模式表/阈值/TTL 为源码常量**:v2 走 plugin options 开放配置。
- **铁律 fail-open**:任何状态/文件/统计异常都不阻断主任务,最多失去一次提醒。
- **NATIVE 待实测**:CC 原生机制(内置写保护等)按"未验证 = 没有"处理,Phase 4 实测。
