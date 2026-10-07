# behavior-enhancer — Codex 适配器(FULL 层)

behavior-enhancer-generic 的 Codex 插件适配器。协议细节全部源码查证
(Codex 源码 `codex-rs/hooks`):stdin 单行 JSON、deny/additionalContext 输出 schema、
sync handler 语义(放行 = 空 stdout;deny+additionalContext 同传;exit 2+stderr = 拦截,绝不触发)。
行为语义同源文件:[`core/semantics.md`](../../core/semantics.md);能力矩阵:[`core/audit.md`](../../core/audit.md)。

## Feature 状态

| Feature | 态 | 实现 |
| :--- | :--- | :--- |
| F1 read-before-write | **FULL** | PostToolUse 记覆盖(状态文件+TTL 1h);PreToolUse 查覆盖,重要文件未覆盖 **deny**;**0.154 实测修正:写文件的真实工具是 `apply_patch`(hook stdin `tool_name="apply_patch"`,`Write`/`Edit` 只是 matcher 别名),适配器从补丁文本提取目标路径** |
| F2 behaviorPrompt | 待实测 | Codex 原生常驻通道 = AGENTS.md(skill/fragments/codex.md 片段);hook 注入通道待实测 |
| F3a 失败检测 | **FULL** | PostToolUse 检查 tool_response,isError + 退出码 + stderr 签名 |
| F3b 并行度控制 | **FULL(拦截等价)** | PreToolUse 并发窗口 deny(跨进程 in-flight 计数 + mkdir 锁),档位阶梯与 CC 版一致 |
| F4 failureGuard | **FULL** | 同工具连续失败 ≥2 → additionalContext 注入停手提醒(模型可见,源码证实) |
| F5 postWriteCheck | **FULL** | Pre 磁盘快照 → Post lightParse → 坏则自动回滚 + 报告;**apply_patch 一次多文件逐路径快照/回滚** |
| F6 hardGate | **FULL** | Bash/PowerShell 高危命令 deny + 3 次逃生 |
| F7 verifyLoop | SOFT | AGENTS.md 片段(改完必须给验证证据) |
| F8 writeDiffVerify | v1.5 | 与方案一致 |
| F9 compliance | **FULL** | 状态文件计次(可 cat 查看;command 集成待实测) |

## 实测记录(2026-10-05,codex-cli 0.154.0 本机)

- **桌面版点火确认 ✓**:用户在桌面版批准 3 个 hook(信任哈希已持久化进 `[hooks.state]`),重启后
  SessionStart 诊断 hook 写入 `hook-marker.txt`("fired"),且 `~/.behavior-enhancer/codex/` 状态目录
  出现(state.json + inflight/snapshots)——**Pre/PostToolUse hooks 在桌面会话真实执行**。诊断 hook 已拆除。
- **`codex exec` 模式不点火 hooks**:三次实验(--enable hooks / -c features.hooks=true / SessionStart
  标记 hook)全部无效果——exec 路径与桌面路径行为不同,测试请走桌面版。
- **写文件工具 = `apply_patch`**(源码 + transcript 双证):hook stdin `tool_input = { command: 补丁文本 }`,
  格式含 `*** Update File:` / `*** Add File:` / `*** Delete File:` 标记;适配器已支持。
- 日常验证:让 Codex 改一个 `*.config.*` 文件并明确要求"不要先读",应看到
  `[behavior-enhancer] …是重要文件…` 的拒绝;或让它在测试目录跑 `rm -rf x`,应被拦;
  之后 `cat ~/.behavior-enhancer/codex/state.json` 的 stats 计数会变化。

## 安装

**方式 A(推荐,dogfood)**:直接进 `~/.codex/config.toml`(无需插件加载链路):

```toml
# 实测修正(2026-10-05,codex-cli 0.154):PreToolUse 必须是数组表 [[hooks.PreToolUse]]
[[hooks.PreToolUse]]
matcher = "^(Bash|PowerShell|Read|Write|Edit)$"
hooks = [
  { type = "command", command = 'node "<仓库目录>\adapters\codex\hooks\pre_tool_use.cjs"', timeout = 15 },
]

[[hooks.PostToolUse]]
matcher = "^(Bash|PowerShell|Read|Write|Edit)$"
hooks = [
  { type = "command", command = 'node "<仓库目录>\adapters\codex\hooks\post_tool_use.cjs"', timeout = 15 },
]
```

**方式 B**:插件形态——`.codex-plugin/plugin.json` + `hooks/hooks.json`(用
`process.env.PLUGIN_ROOT` 定位脚本,codex 对插件 hook 注入该环境变量,源码证实);
装法走 `codex plugin` 的本地/市场流程(**未实测**,codex CLI 未安装)。

## 验证(无需 codex)

```sh
node test/adapter.test.cjs   # 11 个协议级测试:stdin JSON → stdout 断言(独立临时状态目录)
```

## 诚实交底

- **桌面版端到端实测(2026-10-05)**:hooks 在桌面会话点火、工具调用经过 hook、信任已持久化;
  拦截路径(F1/F6 deny)尚未在日常会话里实际触发过(状态计数全零 = 模型行为好,没给拦截机会),
  属"通道已通、枪口未开火"——日常使用即验证。`codex exec` 模式不点火 hooks(见实测记录)。
- **跨进程一致性**:hooks 是每事件独立进程,状态落盘 `~/.behavior-enhancer/codex/`
  (mkdir 锁串行化读写,窗口计数与登记同锁内原子);进程崩溃残留的 in-flight 条目 5 分钟
  后自动失效(fail-open 方向)。
- **同一文件并发写**:pending 快照按路径登记,并发写同一文件时后写覆盖先写的快照(v1 接受,
  这正是纪律要防的行为)。
- 逃生计数共享(所有高风险命令同一 reason)、TTL/阈值/模式表为源码常量,与 CC 版一致。
- 铁律 fail-open:任何异常都不会阻断工具执行;hook 永不 exit 2。
