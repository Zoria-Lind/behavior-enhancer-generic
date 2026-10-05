# behavior-enhancer-generic

把 `dsh-behavior-enhancer` 的行为设计做成**跨宿主双形态产品**:

- **插件形态(FULL)**:宿主提供运行时拦截能力 → 真 enforcement(拦截/veto/写后校验回滚);
- **Skill 形态(SOFT)**:宿主只有 Agent-facing 通道 → 行为引导(自律规则)。

同一个行为语义,不同的 enforcement 强度。**不吹 FULL,不假装 SOFT 是 FULL。**

## 哪个宿主装哪个

| 宿主 | 形态 | 装什么 | 状态(2026-10-05) |
| :--- | :--- | :--- | :--- |
| DSH | FULL | 原插件 `dsh-behavior-enhancer`(独立仓库,generic 只放指针) | 已达成 |
| Claude Code | FULL(8 项) | [`adapters/claude-code/`](adapters/claude-code/README.md)(插件,F3b 为"并发窗口拦截"等价实现) | 引擎级测试 12/12,狗粮中 |
| Codex | FULL(8 项) | [`adapters/codex/`](adapters/codex/README.md)(config.toml hooks 或插件形态) | 协议测试 13/13,桌面版点火实测 |
| Pi | FULL(7 项 + F9 半) | [`adapters/pi/`](adapters/pi/README.md)(pi extension) | 协议测试 11/11,实机带电实测 |
| 其他宿主 | SOFT | [`skill/SKILL.md`](skill/SKILL.md) + [`skill/fragments/`](skill/fragments/) | 已发布形态 |

## 四态激活模型

每个 feature 独立激活,状态由**宿主 capability surface** 决定,不是用户/Agent 偏好:

| 态 | 语义 |
| :--- | :--- |
| NATIVE | 宿主已内置该行为(仅认**实测**),skill 闭嘴 |
| FULL | 插件级接管(拦截/veto/写后校验回滚) |
| SOFT | 行为引导(指令/流程/决策树) |
| DISABLED | 不假装具有不存在的能力 |

不写 `if DSH / elif ClaudeCode` 的宿主名分支,只认 capability。完整设计见
[`generic-skill_plan_v1.md`](generic-skill_plan_v1.md);feature × capability 矩阵见
[`core/audit.md`](core/audit.md);跨宿主共享语义(token/模式表/阈值/TTL/档位阶梯)见
[`core/semantics.md`](core/semantics.md)。

## 与 DSH 原插件的关系

两个独立仓库**各自演进,不做同步机制**:generic 版规则初稿从 DSH 版抄(起步同源),此后独立
迭代;哪边改出更好的规矩,另一边觉得值就手动抄。

## 仓库结构

```
behavior-enhancer-generic/
├── core/        # 行为语义定义 + capability 矩阵(四态)
├── skill/       # SOFT 产物:SKILL.md + 各宿主常驻片段(claude-code / codex / pi / cursor)
├── adapters/    # FULL 产物:claude-code / codex / pi(DSH 只放指针,指回原仓库)
└── README       # 本文档:哪个宿主用哪一态、装哪个
```

## 测试

```sh
cd adapters/claude-code && claude plugin validate . && claude plugin test .   # 12 个引擎级测试
cd adapters/codex && node test/adapter.test.cjs                              # 13 个协议级测试
cd adapters/pi && node test/adapter.test.cjs                                 # 11 个协议级测试
```

## License

MIT — 见 [LICENSE](LICENSE)。规则以 DSH 版为起点,此后独立演进。
