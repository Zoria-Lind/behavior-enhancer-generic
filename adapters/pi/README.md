# behavior-enhancer — Pi 适配器(FULL 层)

behavior-enhancer-generic 的 Pi extension。API 全部源码查证(`D:\dsh\_pi-src\packages\coding-agent`):
- `tool_call` handler 返回 `{ block, reason }` → 工具不执行,reason 成为错误结果文本(模型可见);
- `tool_result` handler 返回 `{ content }` 全量覆盖 → 追加提醒 = 模型可见通道;
- `before_agent_start` 改 `event.systemPromptOptions.sections[name]` → 每段按名字包 tag 渲染进 system prompt;
- extension 在 pi 进程内(Node 全量可用,单事件循环,无跨进程竞态);
- 工具名小写:`bash`/`powershell`/`read`/`write`/`edit`;write/edit 输入为 `{ path, ... }`(相对路径按会话 cwd 解析)。

行为语义同源文件:[`core/semantics.md`](../../core/semantics.md);能力矩阵:[`core/audit.md`](../../core/audit.md)。

## Feature 状态

| Feature | 态 | 实现 |
| :--- | :--- | :--- |
| F1 read-before-write | **FULL** | tool_result 记覆盖(状态文件+TTL 1h);tool_call 查覆盖,重要文件未覆盖 **block** |
| F2 behaviorPrompt | **FULL** | `before_agent_start` 注入纪律段(sections,含实时档位行) |
| F3a 失败检测 | **FULL** | tool_result 检查 isError + 内容失败签名 |
| F3b 并行度控制 | **FULL(拦截等价)** | 进程内 in-flight 计数 + 档位阶梯,超档位 **block** |
| F4 failureGuard | **FULL** | 同工具连续失败 ≥2 → 结果内容注入停手提醒 |
| F5 postWriteCheck | **FULL** | 写前内存快照 → 写后 lightParse → 坏则自动回滚(新文件=删除)+ 报告 |
| F6 hardGate | **FULL** | bash/powershell 高危命令 block + 3 次逃生 |
| F7 verifyLoop | SOFT | 纪律段(改完必须给验证证据) |
| F8 writeDiffVerify | v1.5 | 与方案一致 |
| F9 compliance | 半 | 状态文件计次(cat 可查);`registerCommand` 的输出 API 未在 types 中找到,v1 不注册命令,装 pi 后实测再补 |

## 安装(pi 装上后)

1. 把 `extension/` 目录放到扩展发现路径之一:
   - 项目级:`<项目>/.pi/extensions/behavior-enhancer/`(index.js + semantics.js + state.js)
   - 全局:`<agentDir>/extensions/behavior-enhancer/`(agentDir 见 pi 的 `getAgentDir()`)
   - 或 package.json 的 `"pi"` manifest 声明 extensions 路径
2. 启动 pi 即加载(discovery 规则与 `jiti.import(path, { default: true })` 均源码查证)。

## 验证(无需 pi)

```sh
node test/adapter.test.cjs   # 11 个协议级测试(mock pi API,源码查证的 ExtensionAPI 形状)
```

## 实测记录(2026-10-05,pi 1.0.2 装 D 盘实测,测后已删净)

- 安装:`npm install -g --prefix D:\pi --ignore-scripts @earendil-works/pi-coding-agent`;
  扩展装到 `~/.pi/agent/extensions/behavior-enhancer/`(pi 全局扩展发现路径);
  模型 `--provider deepseek --model deepseek-chat` + `DEEPSEEK_API_KEY`(最便宜,0.001~0.003 美元/会话)。
- **扩展真实加载 ✓**:system prompt 出现 `behavior-enhancer` 纪律段(含实时档位行);
  状态文件写入真实发生——`readRegistry` 记录了 `package.json → [[1,100]]`,即 tool_result handler
  在真实会话执行(read → 记覆盖 → write 时 F1 检查通过 → 放行),**F1 管线实机带电**。
- **SOFT 层实测 ✓**:场景 A 模型在思考里与用户指令博弈("用户的指令不能解除它")后选择先读后写,
  并主动向用户解释;场景 B 模型未执行高风险命令、先要求用户确认——纪律段与高风险确认的自律
  路径真实生效(模型太乖,F6/F1 的 deny 分支没机会开火;deny 逻辑与已带电的管线同代码路径,
  协议测试 11/11 覆盖)。
- 卸载:删 `D:\pi`、`~/.pi`、扩展副本、`~/.behavior-enhancer/pi` 即净(已执行)。

## 诚实交底

- **实机实测(2026-10-05)**:扩展加载、F2 注入、F1 覆盖管线、SOFT 自律路径全部实测 ✓;
  F1/F6 的 deny 分支与 F5 回滚未在实机会话触发(模型行为好,未给拦截机会),协议级测试覆盖;
  按 NATIVE 验证原则:管线带电=已实测,枪口未开火=待日常触发。
- **快照是内存的**(pi 进程内无跨进程问题,回滚功能完整);磁盘 .bak 历史(找回正确版本)排 v1.1。
- **状态跨会话共享**:状态文件全局一份(未按会话隔离,v1 接受,与 Codex 版一致);
  读覆盖 TTL 1h 已限界。
- F9 命令待实测(types 里没找到命令输出 API);逃生计数共享、阈值/TTL/模式表为源码常量,与另两版一致。
- 铁律 fail-open:任何异常都不会阻断工具执行。
