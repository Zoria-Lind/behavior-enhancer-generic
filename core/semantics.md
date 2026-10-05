# behavior-enhancer-generic:共享语义(跨宿主同源)

> 各宿主适配器/片段与本文档**同源**:改这里的值,需同步到 CC 适配器常量、各宿主片段教学文本。
> 现状(2026-10-05):CC 适配器把下列值以常量形式内置(插件运行时无法跨目录 import 仓库文件);
> v2 再考虑构建期单点注入。改一处时全仓 grep 同步。

## /force-read 标记 token

- **字面量:`/force-read`**(位于文件头前 100 行内生效)
- **2026-10-05 修正(狗粮发现 #1)**:纯子串匹配会误伤"正文提到该 token 的文档"(记忆/测试/本文档
  引用字面量即整文件被判重要)。改为**行首注释引导形态**:行首(允许空白)以注释符开头后跟 token
  才算标记,正文提及不算。注释符集合:`//`(含 `///`)、`#`(含多级)、`/*`、`*/`、`<!--`、`--`、`;`、`%`。
  正则(三适配器同源):
  `/^\s*(?:\/\/\/?|#+|\/\*|\*\/|<!--|--|;|%)\s*\/force-read\b/`
  例:`// /force-read`、`# /force-read`、`/* /force-read */`、`<!-- /force-read -->` 有效;
  「本文件说明 /force-read 的用法」无效。
- 语义:用户声明的重要文件 → 写前必须完整读完(重要文件全覆盖 veto)
- 使用方:
  - `adapters/claude-code/hooks/register.ts` — `hasForceReadMarker`
  - `adapters/codex/hooks/semantics.cjs` / `adapters/pi/extension/semantics.js` — 同函数(vendored)
  - `skill/SKILL.md` §7 + `skill/fragments/*` — 教学文本(弱宿主靠模型自觉,须写注释形态示例)

## 默认重要文件模式表(甲)

- `package.json` / `*.config.*` / `*.lock` / `Dockerfile` / `Makefile` / `.github/workflows/*`
- 匹配方式:路径(归一化 `/` 分隔)或 basename 的 glob 匹配,`*` 不跨目录段
- 用户可改:DSH 侧走插件 config;CC 侧 v1 为源码常量,v2 走 plugin options

## 高风险命令模式表(F6,移植自 DSH hardGate v1.2)

| 正则(JS) | label |
| :--- | :--- |
| `/\bRemove-Item\b[^\n]*-(Recurse\|Force)/i` | Remove-Item -Recurse/-Force |
| `/\bformat\b\s+[a-z]:/i` | format 盘符 |
| `/\bdel\b[^\n]*\/[fsq]/i` | del /f /s /q |
| `/\brm\b\s+-[rf]{1,2}\b/i` | rm -r/-f/-rf |
| `/\bri\b[^\n]*-Recurse/i` | ri -Recurse |

逃生语义:同一原因 `high-risk-command` 连续拦截超过 **maxStrikes=3** 次 → 放行并计 escape(防空转死锁)。

## 失败判定签名(F3a/F4,移植自 DSH failureDetect)

1. 工具级 `isError === true`;
2. 结果文本含 `[exit ... code ... : 非零]`(命令级失败最强信号);
3. `[stderr]` 段后 200 字符内出现典型错误签名(避开 warning 噪音)。

连续失败阈值 **maxFailures=2**;达阈值注入停手提醒后重置计数(DSH 同款防重复提醒)。

## 写后检查(F5,移植自 DSH postWriteCheck lightParse)

- 检查扩展名:json / yaml / yml / js / mjs / cjs / ts / tsx / jsx / py / ps1 / sh / toml / xml
- JSON 用 `JSON.parse`;YAML 另查 tab 缩进;代码类做字符串/注释感知的括号配对
- 有任一问题 → 自动回滚 + 报告(不做交互确认,v1 已定)

## 读覆盖 TTL(会话内)

- **1 小时**(v1 硬编码,v2 开放配置);超时视为未读(重要文件重新 veto,普通文件 warn 建议重读)

## 并行收敛(F3b)

- **档位阶梯**:失败 → **1**(一次最多 1 个并发调用);连续 3 次成功 → **3**;再 3 次成功 → **0=不限**。
  档位内失败/成功互斥重置连击;被 deny 的调用不计数(不算失败也不算成功)。
- **FULL(DSH)**:池上限 `maxParallelToolCalls` 动态改。
- **FULL(拦截等价,CC/Codex/Pi 无并行度 API 时)**:并发窗口 veto——hook 计数 in-flight,
  新调用到达时 `inFlight ≥ 档位` → deny(引擎仍派发,超档被拒而非排队);每条 deny 带档位与规则。
- **SOFT 强化(配套)**:失败时在结果 `context` 注入降档提醒(决策点);常驻纪律段每轮渲染实时档位行。
- 统计键:`behavior.serialized`(降档次数)/ `behavior.restored`(恢复不限次数)。
