# behavior-enhancer-generic:Feature × Capability Audit(Phase 1)

> 依据:DSH 原插件 8 模块的真实实现 + Phase 0 四宿主源码查证(CC 插件 API / Codex hooks / Pi extension)。
> 状态:2026-10-05 初版。NATIVE 列全部为"待实测"(verified-native 原则)。

## 宿主能力速查(Phase 0 结论)

| 能力 | DSH | Claude Code | Codex | Pi |
| :--- | :--- | :--- | :--- | :--- |
| 工具调用前拦截/veto | cordis pre-execute | `tool.call` 返回 `{deny}` | PreToolUse allow/deny | beforeToolCall block |
| 工具调用后检查结果 | cordis post-execute | `await next(e)` 后处理 | PostToolUse | afterToolCall |
| system prompt 注入 | systemPrompt.section | `prompt.compose` sections | 待实测(AGENTS.md 为 NATIVE 通道) | extension sections |
| 常驻指令通道 | cordis patch | CLAUDE.md(片段) | AGENTS.md(片段) | extension sections |
| 斜杠命令 | commands.register | `$.command.register` | 待实测 | 待实测 |
| 会话级状态 | 模块内存+文件 | `$.state` | 文件自管 | extension 状态 |
| 跨会话状态 | 文件 | `$.store` | 文件自管 | 待实测 |
| 文件系统 | node fs | `$.fs` | hook 可 fs | extension 可 fs |
| **并行度控制** | settings.update(agent-loop) | **无 API** | 无 API | 无 API |

## Feature 矩阵

### F1 read-before-write(新增,设计已定)
- **语义**:写文件前必须先读过;重要文件必须全覆盖。
- **DSH 实现**:无(原插件未做拦截级,靠纪律段软约束)。
- **FULL 需求**:tool 前拦截 + fs 读覆盖记录。**CC/Codex/Pi 全具备 → 四宿主 FULL**(实现=共享 hook 核心)。
- **SOFT 形态**:SKILL.md 规则(读→查→改→验)。
- **NATIVE 待实测**:各宿主是否自带写保护。

### F2 behaviorPrompt(行为约束段)
- **语义**:静态纪律文本常驻 system prompt。
- **DSH 实现**:systemPrompt.section(order -98)。
- **FULL**:CC=prompt.compose section ✓;Pi=extension section ✓;Codex 待实测(否则用 AGENTS.md 片段=SOFT)。
- **SOFT 形态**:常驻片段(CLAUDE.md / AGENTS.md / pi)。
- **NATIVE 待实测**:Codex 原生 section 注入。

### F3 parallelConvergence(失败→并行收敛)**【拆分】**
- **F3a 失败检测**:DSH=tools/result 监听。FULL:CC/Codex/Pi 的 post-hook 均可看结果 ✓ 四宿主 FULL。
- **F3b 并行度控制**:DSH=settings.update。**CC/Codex/Pi 均无并行度 API → 只能 SOFT**(四杠杆:依赖前收敛/阶梯量化/自管状态/失败后单步);DSH 保持 FULL(原插件)。
- **F3c 压力降档**:依赖 tokenMeter,无宿主通用 → SOFT/DSH FULL。
- **NATIVE 待实测**:各宿主自带并行策略。

### F4 failureGuard(连续失败介入)
- **语义**:同工具连续失败 ≥2 → 提醒模型停手。
- **DSH 实现**:agent.followup。
- **FULL 近似**:CC=deny/结果改写带消息(模型可见)→ 计次用 $.state ✓;Codex/Pi 同构(待实测消息通道)。
- **SOFT 形态**:决策树指令。
- **NATIVE**:无。

### F5 postWriteCheck(写后检查 + .bak 回滚)
- **语义**:写前快照、写后轻量校验、坏了自动回滚+报告。
- **DSH 实现**:tools/execute+post-execute,lightParse,.bak 快照。
- **FULL**:四宿主 hook+fs 全具备 → 全 FULL;校验逻辑移植 lightParse。
- **SOFT 形态**:四步自查清单(尽力而为)。
- **NATIVE 待实测**:各宿主自带写保护/checkpoint。

### F6 hardGate(高风险命令闸门)
- **语义**:破坏性命令模式 → deny/ask,连续拦截有逃生。
- **DSH 实现**:tools/pre-execute 模式匹配。
- **FULL**:CC/Codex/Pi 的 pre-hook deny 全具备 → 四宿主 FULL(模式表移植)。
- **SOFT 形态**:指令(破坏性操作前先确认)。
- **NATIVE 待实测**:Codex sandbox approval。

### F7 verifyLoop(改完必须给验证证据)
- **语义**:改过文件且当轮无验证 → 注入提醒。
- **DSH 实现**:agent/turn-stopping。
- **FULL**:CC 有 Stop 事件但注入通道受限 → **以 SOFT 为主**;CC 可做"结果消息提醒"(待实测)。
- **SOFT 形态**:指令(改完必须验证并说明证据)。
- **NATIVE**:无。

### F8 writeDiffVerify(pwsh diff 报告)
- **语义**:shell 命令前后 git diff 报告(回滚排 v1.5)。
- **DSH 实现**:Pre/Post git status。
- **FULL**:CC/Codex/Pi hook+git 可行 → v1.5。
- **SOFT**:DISABLED(模型自报不靠谱,不做)。

### F9 compliance(/behavior-status 统计)
- **语义**:拦截/回滚/提醒计次 + 状态命令。
- **DSH 实现**:stats + commands.register。
- **FULL**:CC=$.store 计次 + $.command.register ✓;**Pi/Codex 待实测**,可退化成状态文件 + 查询提示。
- **SOFT**:DISABLED(无运行时)。
- **NATIVE**:无。

## 汇总:FULL 覆盖

| Host | F1 | F2 | F3a | F3b | F4 | F5 | F6 | F7 | F8 | F9 |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| DSH | FULL(新) | FULL | FULL | FULL | FULL | FULL | FULL | FULL | FULL(v1.5) | FULL |
| Claude Code | FULL | FULL | FULL | SOFT | 近FULL | FULL | FULL | SOFT+ | v1.5 | FULL |
| Codex | FULL | 待实测→SOFT | FULL | SOFT | 待实测 | FULL | FULL | SOFT | v1.5 | 待实测 |
| Pi | FULL | FULL | FULL | SOFT | 待实测 | FULL | FULL | SOFT | v1.5 | 待实测 |

> **2026-10-05 更新**:Claude Code 行的 F1/F2/F3a/F4/F5/F6/F9 已实施并通过引擎级测试
> (`adapters/claude-code`,validate ✔ + 10/10 test ✔);F3b 无并行度 API 属实,但以**并发窗口 veto**
> 实现"FULL(拦截等价)":in-flight 计数 + 档位阶梯(失败→1 →连3成功→3 →再3成功→不限),
> 超档位并发调用 deny(负反馈闭环),失败时 context 注入降档提醒、prompt.compose 渲染实时档位行——
> 机制 ≠ DSH 池上限(引擎仍派发、超档被拒而非排队),命名与 README 均如实标注;
> F4 在 CC 的落地 = 结果 `context` 注入停手提醒(与 DSH followup 同构,已实测)。
>
> **2026-10-05 Codex 行**:适配器已实施(`adapters/codex`),协议细节对照 Codex 源码查证
> (stdin 单行 JSON / deny + additionalContext schema / sync 放行=空 stdout / exit2+stderr=拦截),
> Node 协议级测试 9/9 ✔;**未在真实 codex 会话实测(本机未装 codex CLI)**——按 NATIVE 验证原则,
> 装机后 Phase 4 实测才升级为已验证。F1/F3a/F3b(拦截等价,跨进程 mkdir 锁)/F4/F5/F6/F9(状态文件)
> 已实现;F5 磁盘 .bak 快照 Codex 直接能做(CC 排 v1.1 的差异不存在);F2 待实测(AGENTS.md 为
> NATIVE 常驻通道,片段已有)。
>
> **2026-10-05 Pi 行**:适配器已实施(`adapters/pi`,pi extension 形态),ExtensionAPI 全部对照
> Pi 源码查证(tool_call block+reason 进错误结果、tool_result content 覆盖、sections 渲染、
> 进程内 Node/无跨进程竞态),mock-pi 协议级测试 9/9 ✔;**未在真实 pi 会话实测(本机未装 pi)**。
> F1/F2(sections)/F3a/F3b(拦截等价,进程内计数)/F4/F5/F6 已实现;F5 快照为内存(回滚完整,磁盘
> 历史 v1.1);F9 半(状态文件计次,registerCommand 输出 API 未查得,v1 不注册命令)。

## 拆分结论(写进实现)

1. **F3 必须拆**:F3a 失败检测进 FULL 共享核心;F3b/F3c 在无并行 API 的宿主上只做 SOFT(四杠杆);
2. **F7 以 SOFT 为主**,CC 的"结果消息提醒"待实测后升级;
3. **F9 在 CC 先 FULL**,其余宿主等实测;
4. 所有"待实测"格 = NATIVE 验证原则的检查点,Phase 4 逐个落实。
