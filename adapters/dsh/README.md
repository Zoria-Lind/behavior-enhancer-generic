# behavior-enhancer-generic — DSH 适配器(可安装插件)

**不是指针,是完整可安装的 DSH 插件**(用户 2026-10-05 拍板:generic 装到 DSH 上就能直接用)。
基于原插件 `dsh-behavior-enhancer` v1.2.3 全部模块,叠加 generic 侧独有增量:

| 模块 | 来源 | 说明 |
| :--- | :--- | :--- |
| **F1 readBeforeWrite** | **generic 新增** | read 成功记覆盖区间(会话内 1h TTL);write/edit 前 veto 重要文件(模式表 ∪ 行首注释形态 `/force-read` 标记),普通文件有洞计数提醒 |
| F2 behaviorPrompt | 原插件 | 纪律段(含标记规则教学);generic 版恢复了"先读后写"条目 |
| F3b parallelConvergence | 原插件 | **DSH 原生 FULL**:`settings.update(agent-loop)` 改并行池上限(其他宿主是拦截等价) |
| F3a+F4 failureGuard | 原插件 | 连续失败 ≥2 → agent.followup 停手提醒 |
| F5 postWriteCheck | 原插件 + **generic 修复** | 写后 lightParse + .bak 回滚;**lightParse 增加正则字面量识别**(原版误判 `/\*` 与 `can't`) |
| F6 hardGate | 原插件 | 高危命令 deny/ask + 3 次逃生 |
| F7 verifyLoop / F8 writeDiffVerify | 原插件 | 验证环 / git diff 报告 |
| F9 compliance | 原插件 | 统计落盘 + /behavior-status |

## 安装

```sh
# 本地路径安装(DSH 插件加载器)
dsh plugin add <本目录绝对路径>
# 或发布 npm 后:
dsh plugin add @zoria-lind/dsh-behavior-enhancer-generic
```

loader 契约与配置覆盖规则与原插件一致(id-targeted config 整体浅替换,覆盖时带全量 config)。

## 与原插件的关系

- **二选一安装**:两者都是行为纪律插件,同时装会双重拦截。generic 版 = 原版全部能力 +
  F1 读前拦截 + lightParse 正则修复 + 标记注释形态规则;装 generic 版即可。
- 内核 `dsh-fs-observation-policy` 声称的"edit requires reading first"未经本产品实测
  (verified-native 原则),故 F1 保留自己的硬闸;实测确认内核机制有效后可把
  `readBeforeWrite.enabled` 关掉(NATIVE 避让)。

## 验证

```sh
node test/smoke.mjs   # mock-ctx 协议级测试,覆盖全部 9 个模块 + F1 专属用例
```

## 诚实交底

- F1 的"放行+模型可见提醒"通道在 DSH pre-execute 不存在(只有 deny/放行),普通文件有洞
  目前只计数 + console 记录(v1);升级候选:借道 agent.followup。
- 读覆盖注册表为插件实例内存(会话级),重启清零——与方案"仅同会话有效"一致。
- 尚未在真实 DSH 会话实测:安装后日常使用即验证。
