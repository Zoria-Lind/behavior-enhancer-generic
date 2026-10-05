# behavior-enhancer-generic 方案(讨论收敛版 v1,2026-10-04)

> 本文档是 2026-10-03/04 讨论的收敛结果,取代 `generic-skill_plan_pre.md` 作为后续施工依据。
> 状态:Phase 2(SOFT)已完成;Phase 3(**CC / Codex / Pi 三个适配器**)已实施并通过各自引擎级/协议级
> 验证(2026-10-05),待 Phase 4 会话实测。详见 `adapters/{claude-code,codex,pi}/README.md`。

## 1. 目标

把 `dsh-behavior-enhancer` 的行为设计做成**跨宿主双形态产品**:

- **插件形态(FULL)**:宿主提供运行时拦截能力 → 真 enforcement;
- **Skill 形态(SOFT)**:宿主只有 Agent-facing 通道 → 行为引导。

同一个行为语义,不同的 enforcement 强度。不吹 FULL,不假装 SOFT 是 FULL。

## 2. 命名与产品结构

- **项目/仓库名:`behavior-enhancer-generic`**(不叫 -generic-skill,因为它同时含插件与 skill 两种形态)
- DSH 原插件(`dsh-behavior-enhancer`)不动,是"NATIVE 宿主已达成"的产品级体现
- 仓库结构:

```
behavior-enhancer-generic/
├── core/        # 行为语义定义 + capability 矩阵(四态)
├── skill/       # SOFT 产物:SKILL.md + 各宿主常驻片段(claude-code.md / codex.md / pi.md / ...)
├── adapters/    # FULL 产物:claude-code/ 插件适配器;dsh/ 只放指针,指回原仓库
└── README       # 哪个宿主用哪一态、装哪个
```

SKILL.md 内 `name` 字段用短名 `behavior-enhancer`。

## 3. 四态激活模型

每个 feature 独立激活,状态由**宿主 capability surface** 决定,不是用户/Agent 偏好:

| 态 | 语义 | 触发条件 |
| :--- | :--- | :--- |
| **NATIVE** | 宿主已内置该行为,skill 闭嘴(最多留避让说明) | **仅限"验证过"的原生机制(Phase 4 实测);未验证的宿主声称 = 按没有处理,保持自己的 enforcement** |

**NATIVE 验证原则(2026-10-05 用户提出)**:宿主原生机制是黑盒且会变,不能靠假设——NATIVE 只认实测(verified-native);enforcement 是信任锚,原生机制是锦上添花不是地基。规则模板加一条:"宿主内置机制是否生效,由本产品的验证步骤确认;未确认前按最保守方式执行"。
| **FULL** | 插件级接管(拦截/veto/验后) | 宿主有 tool interception + veto + post-action hook |
| **SOFT** | 行为引导(指令/流程/决策树) | 只有 Agent-facing 通道 |
| **DISABLED** | 不假装具有不存在的能力 | 最低能力都不满足 |

原则:
- 不写 `if DSH / elif ClaudeCode` 的宿主名分支,只认 capability;
- feature 级独立激活,一个 DISABLED 不影响其他;
- **NATIVE 优先判断**:先问"宿主自己已经做了吗",做了就闭嘴——避免双重约束打架与重复造轮子;
- capability 的获取:检测(少数宿主可枚举)+ 用户声明(默认按最保守的 SOFT 起)。

## 4. 目标宿主(第一梯队)

| 宿主 | 拦截能力 | 预期形态 |
| :--- | :--- | :--- |
| DSH | cordis 全拦截 | 已有原插件 = FULL,generic 项目不重复实现(只放指针) |
| Claude Code | hooks(PreToolUse veto)+ 插件系统 | 插件版第二宿主,可 FULL |
| **Pi** | **beforeToolCall 可 block + afterToolCall + Extension 机制(pi-durable:tools/sections/hooks/wrappers/tasks)** | **FULL 可行(2026-10-04 源码查证,repo 在 D:\dsh\_pi-src);适配器形态 = pi extension** |
| **Codex** | **与 Claude Code 同源的 hook 协议(PreToolUse/PostToolUse + permission_decision allow/deny)+ 插件 manifest 系统** | **FULL 可行(2026-10-04 源码查证,repo 在 D:\dsh\_codex-src);适配器与 Claude Code 共用同一份 hook 实现** |

**Phase 0 结论(2026-10-04)**:四个宿主全部具备 FULL 级拦截能力;CC/Codex 共享 hook 实现,Pi 用 extension 形态,DSH 原插件。

**2026-10-04 修正**:FULL 形态目标宿主 = 四个(Claude Code / Codex / Pi / DSH);"哪个真能 FULL"由 Phase 0 实测拍板,不硬吹。

**② 与 DSH 原插件的关系(2026-10-04 已定)**:两个独立 repo **各自演进,不做同步机制**——generic 版规则初稿从 DSH 版抄(起步同源),此后独立迭代;哪边改出更好的规矩,另一边觉得值就手动抄。README 交底一句"规则以 DSH 版为起点,此后独立演进"。

**Phase 0 待查证项**:Claude Code hooks 文档核实、Codex/Pi 的 skills 与插件现状、Agensi 的 skill 格式要求(若决定上架)。

## 5. 第一版 SOFT 的范围

### 5.1 载体:片段包 + SKILL.md

纪律类内容必须常驻才有效。SOFT 产物 = 一份 SKILL.md(按需入口,完整手册)+ `skill/fragments/` 目录给各宿主常驻通道(CLAUDE.md / AGENTS.md / Cursor rules / pi 各自片段),内容同源。

### 5.2 规则结构模板

每条规则 = **行为语义 + 触发条件 + 宿主避让条款**:

> 若你的宿主已具备该机制(如内置写排他、approval 流),以宿主为准,本节跳过。

### 5.3 Feature 映射(8 模块预演)

| feature | SOFT 形态 | 质量 |
| :--- | :--- | :--- |
| 先读后写 | 读→查→改→验流程 | 强 |
| 失败收敛 | 决策树:停手→说明原因→问用户 | 强 |
| 同类修改串行 | 同文件修改排队指令 | 中 |
| 写后检查 | 自查清单 + 自做 .bak 回滚 | 强 |
| 高风险命令 | 破坏性操作前先确认 | 强 |
| 验证环 | 改完必须给验证证据 | 中 |
| 并行收敛 | 见 5.4 的主动化改造 | 中(改造后) |
| 遵守度统计 | — | DISABLED(无运行时) |

### 5.4 并行收敛的 SOFT 强化(四杠杆,已定进 v1)

1. **依赖前收敛**(主动):并行批之前必须确认"N 个调用无依赖且低风险",有依赖逐个来——模型擅长依赖推理,不擅长事后计数;
2. **阶梯量化**:失败后最多 1 个;连续 3 次成功升 3 个;再 3 次恢复上限;切换时写明档位;
3. **自管状态文件**:模型自己读写 `~/.behavior-enhancer/state.json`(失败计数/档位)——文件读写所有宿主都有,等于 SOFT 偷到半个 runtime;
4. **失败后结构性单步**:任何失败后下一条消息只含一个工具调用 + 先写失败原因。

诚实天花板:四招让 SOFT 从"基本不生效"到"好模型下多数生效";100% 靠插件版。

## 6. 实施阶段

- **Phase 0**:宿主能力查证(Claude Code hooks / Codex / Pi / Agensi 格式)——纯阅读;
- **Phase 1**:capability audit 矩阵——每个 feature 列出行为语义、DSH 实现、FULL 需求、SOFT 最低需求、DISABLED 条件、**宿主已内置(NATIVE)列**;同时写 SOFT 层长什么样;
- **Phase 2**:SOFT 版实施(SKILL.md + fragments),先在自己 Claude Code 里狗粮实测;
- **Phase 3**:Claude Code 插件适配器,先做 1-2 个 feature 的 veto 实验(建议 read-before-write,最能体现 FULL≠SOFT);
- **Phase 4**:验证(DH 宿主 FULL 对照 + 弱宿主降级正确性);
- **Phase 5**:打包/发布决策(Agensi 上不上架用 v1 数据说话)。

## 7. 验收标准(四层)

1. **语义覆盖**:generic 版行为原则覆盖原插件核心设计;
2. **能力正确**:capability 不足时正确降级,绝不把 SOFT 标成 FULL;
3. **Feature 隔离**:单个 DISABLED 不影响其他;
4. **Enforcement honesty**:FULL ≠ SOFT ≠ DISABLED ≠ NATIVE,文档不混写。

## 8. 开放问题

- [ ] Phase 0 查证结果(Claude Code hooks 细节、Codex/Pi 现状)
- [ ] NATIVE 态在各宿主的具体清单(哪些 feature 该闭嘴)
- [ ] 状态文件路径约定(~/.behavior-enhancer/ vs 各宿主惯例)
- [ ] Agensi 上架与否(v1 数据决定)
- [ ] DSH 侧是否做"generic 项目指回原插件"的 README 互链
- [ ] 读过的"新鲜度/会话作用域"(倾向:会话内、不限时;外部修改检测留给写后检查 feature 的 mtime 对比)

## 9. read-before-write 的 FULL 级详细设计(2026-10-04 二次讨论,已定)

**机制骨架(Claude Code hooks)**:
- PostToolUse:Read 成功 → 把覆盖区间记入状态文件(用请求的 offset+limit 算"至少覆盖"下界,不解析返回内容);
- PreToolUse:Write/Edit 前 → 查状态文件。

**覆盖度模型**:
- readRegistry 记行区间并集:`ranges: [[1,2000],[3001,4000]]`,再次 Read 自动合并;任意 offset 起点;
- 总行数由 hook 用 node fs 自己数(不靠模型报告),warn 才能精确报"未读区间";
- warn 文案模板:`目标文件共 Y 行,未读区间:A-B、C-D。写入前请补读:Read 该文件 offset=A,读完再写。(仅提醒,不拦截)`——"尽量读多点"的引导 = 给第一个洞的 offset。

**重要性分层(用户拍板:甲+丙)**:
- 重要文件 = `/force-read` 文件内标记(文件头前 100 行子串匹配,语言无关;重要性随文件走,git 分享不丢)∪ 默认模式表(甲,内置五六个,如 package.json/*.config.*/CI 文件;用户可改)∪ 中央配置 glob 列表(丙①)→ **未覆盖即 veto**(强制分页读满);
- 普通文件 = 任何 Read 放行,有洞 warn;
- 新文件 = 豁免(hook 用 fs.existsSync 判断)。

**标记 token = `/force-read`**:SKILL.md 教学文本与 hook 子串匹配**同源**(存 core/ 语义文件,改 token 只改一处);弱宿主上靠模型看到标记自觉补读。
**2026-10-05 修正(狗粮发现 #1)**:纯子串匹配误伤"正文提到 token 的文档"(记忆/测试文件引用字面量即被判重要)。
改为**行首注释引导形态**才生效:`/^\s*(?:\/\/\/?|#+|\/\*|\*\/|<!--|--|;|%)\s*\/force-read\b/`
(正则见 core/semantics.md,三适配器同源);lightParse 同轮修正(狗粮发现 #2):增加正则字面量识别,
`/\*` 与 `can't` 不再误触发注释/字符串态。

**Edit v1 策略 = 甲**:与 Write 同款泛化提示(未读完整个文件就 warn),不解析 old_string;old_string 区域匹配(乙)放 v2,其转义/多匹配边角单独排一版。

**失败回滚(2026-10-04/05 已定)**:FULL = hook 内实现(PreToolUse 快照 → PostToolUse 校验+恢复,校验逻辑 port DSH lightParse,与 read-before-write 同脚本同状态目录);SOFT = 四步自查清单(备份→写→自查→恢复),定位"尽力而为";**v1 统一自动回滚 + hook 消息报告,不做交互确认**;**shell 命令改文件的回滚排 v1.5**(机制=移植 DSH 的 findGitRootsFromCommand 路径解析,覆盖路径显式的命令,通配符/脚本间接修改诚实跳过);快照目录 ~/.behavior-enhancer/snapshots/,每文件 5 份。

**v1 明确不做**:覆盖度对 Edit 的精确判定、外部修改检测(mtime 对比,留给写后检查 feature)、跨会话读记录持久化。

**新鲜度/作用域(2026-10-04 已定)**:读记录**仅同会话有效**;同会话内限时 **1 小时**(v1 硬编码;v2 开放用户配置)。超时 = 视为未读(重要文件重新 veto 补读,普通文件 warn"上次读取已超过 1 小时,建议重读")。副作用:限时强制重读顺带兜住"文件被外部修改"的部分风险,不必单独做 mtime 对比。
