# behavior-enhancer-generic

[English](README.md) · **中文**

把 `dsh-behavior-enhancer` 的行为设计做成**跨宿主双形态产品**:

- **插件形态(FULL)**:宿主提供运行时拦截能力 → 真 enforcement(拦截/veto/写后校验回滚);
- **Skill 形态(SOFT)**:宿主只有 Agent-facing 通道 → 行为引导(自律规则)。

同一个行为语义,不同的 enforcement 强度。**不吹 FULL,不假装 SOFT 是 FULL。**

## 哪个宿主装哪个

| 宿主 | 形态 | 装什么 | 状态 |
| :--- | :--- | :--- | :--- |
| DSH | FULL | [`adapters/dsh/`](adapters/dsh/README.md)(**可安装插件**:原插件全部模块 + F1 读前拦截 + 两个修复) | mock-ctx 全模块测试通过,待装机实测 |
| Claude Code | FULL(8 项) | [`adapters/claude-code/`](adapters/claude-code/README.md)(插件,F3b 为"并发窗口拦截"等价实现) | 引擎级测试 **14/14**,狗粮中 |
| Codex | FULL(8 项) | [`adapters/codex/`](adapters/codex/README.md)(config.toml hooks 或插件形态) | 协议测试 13/13,桌面版点火实测 |
| Pi | FULL(7 项 + F9 半) | [`adapters/pi/`](adapters/pi/README.md)(pi extension) | 协议测试 11/11,实机带电实测 |
| 其他宿主 | SOFT + ADAPTIVE | [`skill/SKILL.md`](skill/SKILL.md) §8 引导:Agent 首次使用时按 `core/adapter-template.md` 自建适配器(保守测试、保守 FULL、交付报告) | 已发布形态 |

**Claude Code 装法(一条命令)**:

```sh
/plugin marketplace add Zoria-Lind/behavior-enhancer-generic
/plugin install behavior-enhancer@zoria-behavior
```

开发者本机也可以用 `claude --plugin-dir "<仓库目录>\adapters\claude-code"` 或
`CLAUDE_CODE_PLUGIN_DIRS=...\adapters\claude-code`(详见
[`adapters/claude-code/README.md`](adapters/claude-code/README.md))——**二选一,别同时装**。

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

> 说明:上面这些设计文档(`core/`、`generic-skill_plan_v1.md`)目前只有中文;英文读者看本文档 + 各 `adapters/*/README.md` 即可。

## 与 DSH 原插件的关系

DSH 适配器基于原插件 `dsh-behavior-enhancer`(独立仓库)起步并叠加 generic 增量,此后**各自演进,
不做同步机制**:哪边改出更好的规矩,另一边觉得值就手动抄。**二选一安装,不要同时装两个**
(见 [`adapters/dsh/README.md`](adapters/dsh/README.md))。

## 仓库结构

```
behavior-enhancer-generic/
├── .claude-plugin/  # Claude Code 市场清单(marketplace.json,市场名 zoria-behavior)
├── core/        # 行为语义定义 + capability 矩阵(四态)+ 通用适配器模板(ADAPTIVE 模式)
├── skill/       # SOFT 产物:SKILL.md + 各宿主常驻片段(claude-code / codex / pi / cursor)
├── adapters/    # FULL 产物:claude-code / codex / pi(DSH 只放指针,指回原仓库)
├── publish/     # Agensi 上架产物(SOFT skill 包)
└── README.md / README.zh-CN.md   # 英文主文档 / 中文(本文)
```

## 测试

```sh
cd adapters/claude-code && claude plugin validate . && claude plugin test .   # 14 个引擎级测试
cd adapters/codex && node test/adapter.test.cjs                              # 13 个协议级测试
cd adapters/pi && node test/adapter.test.cjs                                 # 11 个协议级测试
```

## 相关链接

- **免费 SOFT 版**(纯 SKILL.md,任何兼容宿主可用,不含可执行代码):[Agensi — Behavior Enhancer](https://www.agensi.io/skills/behavior-enhancer-skill)(本仓库的 FULL 版仍是唯一完整形态,两者互为引流)

## License

MIT — 见 [LICENSE](LICENSE)。规则以 DSH 版为起点,此后独立演进。
