# behavior-enhancer — DSH(指针,不重复实现)

**DSH 的 FULL 实现 = 原插件 [`dsh-behavior-enhancer`](https://github.com/Zoria-Lind/dsh-behavior-enhancer)
(本地:`D:\dsh\dsh-plugins\dsh-behavior-enhancer`),本目录不放代码。**

按方案(2026-10-04 已定):两个 repo **各自演进,不做同步机制**——generic 版规则初稿从 DSH 版抄
(起步同源),此后独立迭代;哪边改出更好的规矩,另一边觉得值就手动抄。

## 已知待同步项(generic 侧先行,DSH 侧待手动抄)

| 项 | generic 状态 | DSH 状态 |
| :--- | :--- | :--- |
| `/force-read` 标记注释引导形态(防正文提及误报) | 已修(2026-10-05,三适配器+教学文本) | 未同步(DSH 版仍是纯子串匹配) |
| lightParse 正则字面量识别(`/\*` 与 `can't` 误判) | 已修(2026-10-05) | 未同步(DSH 版同缺陷) |
| F1 read-before-write 拦截级 | 三适配器 FULL | audit 表记"FULL(新)":原插件只有纪律段软约束,无拦截级读前检查 |

DSH 侧若实现 F1,参考本仓库 `core/semantics.md` 的覆盖度模型(读记区间并集 + 1h TTL + 重要文件 veto)。

## capability 对照

| 能力 | DSH(cordis) | 说明 |
| :--- | :--- | :--- |
| 工具调用前拦截/veto | `tools/pre-execute` | hardGate/写前检查等落点 |
| 工具调用后检查 | `tools/post-execute` | postWriteCheck 落点 |
| system prompt 注入 | `systemPrompt.section` | behaviorPrompt 落点 |
| 并行度控制 | `settings.update(agent-loop)` | **DSH 独有**,F3b 在此是原生 FULL(其他三宿主是并发窗口拦截等价) |
| 连续失败介入 | `agent.followup` | failureGuard 落点 |
| 统计命令 | `commands.register` | /behavior-status |
