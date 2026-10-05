# dsh-behavior-enhancer → Capability-Adaptive Generic Skill 转换方案

## 1. 目标

将 `dsh-behavior-enhancer` 的核心行为设计迁移为一个 **generic、capability-adaptive 的 Agent Skill**。

目标不是简单地把现有 DSH plugin 改写成一份 prompt，也不是为了 generic 化而主动削弱功能。

核心目标是：

> **Skill 保留完整的行为功能集合；由宿主 Agent 架构实际提供的 capability surface 决定每项功能能够以何种 enforcement level 激活。**

同一套 Skill 可以运行在不同 Agent / harness / runtime 中：

* 宿主具备完整 runtime enforcement 能力 → `FULL`
* 宿主只能提供 Agent-facing behavioral guidance → `SOFT`
* 宿主缺乏实施该功能所需的最低能力 → `DISABLED`

因此：

```text
Generic Skill
    │
    ├── Complete Feature Definitions
    │
    └── Activation / Capability Resolution Layer
                │
                ├── FULL
                ├── SOFT
                └── DISABLED
```

其中 enforcement level **不是 Agent 的用户偏好，也不是 Agent 自己决定的策略强度**。

它完全由宿主架构允许 Skill 使用的能力决定。

---

## 2. 核心设计原则

### 2.1 功能全集与执行能力解耦

Generic Skill 应定义完整的行为能力集合，而不是只定义所有宿主都能实现的最低公共子集。

例如一个 feature 可以同时定义：

```text
Feature: read-before-write

FULL:
    可以在 runtime 层阻止未经读取的 write

SOFT:
    无法阻止 write，但可以要求 Agent 遵循
    read → inspect → write → verify 的行为流程

DISABLED:
    当前宿主无法可靠识别 read/write 或无法对相关行为施加任何有效约束
```

因此：

> **Feature definition 不随宿主改变；只有 activation level 随宿主改变。**

---

### 2.2 Enforcement level 是 capability-driven，而不是 preference-driven

不得设计成：

```text
Agent chooses:
    FULL / SOFT / DISABLED
```

正确模型是：

```text
Host Architecture
        ↓
Exposed Capability Surface
        ↓
Capability Resolution
        ↓
Activation Level
        ↓
Feature Activation
```

Agent 无权因为“我想更严格/更宽松”而改变 enforcement level。

例如：

```text
Host capability:
    tool interception = available

→ read-before-write = FULL
```

而不是：

```text
Agent:
    "I prefer soft mode."

→ read-before-write = SOFT
```

---

## 3. 三种 Activation Level

### 3.1 FULL

`FULL` 表示宿主架构提供了足够的 runtime / tool / state / interception 能力，使 Skill 能够真正执行或强制执行该行为。

典型能力包括：

* tool-call interception
* tool-call veto
* tool-call parameter inspection / mutation
* runtime state tracking
* filesystem / environment state inspection
* scheduler / concurrency control
* rollback capability
* post-action verification hooks
* deterministic enforcement points

FULL 的目标是尽可能接近原 `dsh-behavior-enhancer` 的实际 enforcement 行为。

---

### 3.2 SOFT

`SOFT` 表示宿主缺乏完整 runtime enforcement，但仍然存在足够的 Agent-facing interface，使该行为可以通过：

* Skill instructions
* structured workflow
* behavioral policy
* decision procedure
* tool-use guidance
* state-aware instructions

进行约束。

SOFT 不是“用户选择的弱模式”。

它表示：

> **当前宿主架构做不到 FULL，因此该 feature 自动降级为 soft enforcement。**

例如：

```text
FULL:
    write tool call can be intercepted
    ↓
    block write if target was not read

SOFT:
    write cannot be intercepted
    ↓
    Skill instructs Agent:
        read target
        inspect relevant content
        perform modification
        verify result
```

---

### 3.3 DISABLED

`DISABLED` 表示宿主架构连实现该 feature 所需的最低可靠能力都没有。

此时不应该假装该 feature 仍然有效。

例如：

```text
Feature:
    automatic rollback

Required:
    rollback-capable runtime state

Host:
    no rollback API
    no recoverable snapshot
    no equivalent mechanism

→ DISABLED
```

DISABLED 的意义不是“放弃安全”，而是：

> **该 Skill 不对当前宿主声称自己具有不存在的能力。**

其他独立 feature 仍然可以正常运行。

---

# 4. 推荐总体架构

```text
                    Generic Behavior Skill
                             │
             ┌───────────────┴───────────────┐
             │                               │
       Feature Definitions             Activation Layer
             │                               │
             │                     Host Capability Surface
             │                               │
             └───────────────┬───────────────┘
                             ↓
                    Capability Resolution
                             │
            ┌────────────────┼────────────────┐
            ↓                ↓                ↓
          FULL             SOFT            DISABLED
            │                │                │
     Runtime enforcement   Soft policy      Not activated
            │                │
            └────────────────┘
                     ↓
                Agent behavior
```

---

# 5. Capability Surface

Activation layer 不应该通过猜测当前 Agent 的名字来判断能力。

不要采用：

```text
if DSH:
    ...
elif ClaudeCode:
    ...
elif OtherAgent:
    ...
```

而应该面向 capability。

例如：

```yaml
capabilities:
  tool_observation: true
  tool_interception: true
  tool_veto: true
  tool_parameter_mutation: false
  filesystem_state: true
  runtime_state: true
  rollback: false
  concurrency_control: false
  post_action_hook: true
  user_escalation: true
```

实际 schema 可以根据目标 Skill / host 能力模型调整。

核心原则：

> **Skill 依赖 capability，而不是依赖具体 harness 名称。**

---

# 6. Capability Resolution

每一个 feature 应定义自己的 capability requirements。

例如：

```yaml
feature:
  id: read_before_write

requirements:
  minimum:
    - tool_observation

  full:
    - tool_interception
    - tool_veto
    - filesystem_state

activation:
  if full_requirements_available:
    level: FULL

  elif minimum_requirements_available:
    level: SOFT

  else:
    level: DISABLED
```

这里的具体格式只是概念示例，最终 schema 不应在设计阶段过早固定。

关键是建立：

```text
Feature
    ↓
Required capabilities
    ↓
Capability surface
    ↓
FULL / SOFT / DISABLED
```

---

# 7. Feature Independence

一个 feature 被 DISABLED 后，不应该导致整个 Skill 无法使用。

例如：

```text
read-before-write      FULL
failure-convergence    SOFT
parallelism-control    DISABLED
post-write-check       FULL
user-escalation        SOFT
```

Skill 仍然正常运行。

因此 generic Skill 应尽可能采用：

> **feature-level activation，而不是 all-or-nothing activation。**

不要设计成：

```text
if any capability missing:
    disable entire skill
```

而应该：

```text
for each feature:
    resolve activation level independently
```

---

# 8. 从 dsh-behavior-enhancer 迁移时的分类方式

迁移前，不应该直接改代码。

首先对现有 `dsh-behavior-enhancer` 的每一项功能进行 capability audit。

建议建立以下矩阵：

| Feature                 | 原始 DSH 行为               | Required Capability             | FULL                         | SOFT                          | DISABLED            |
| ----------------------- | ----------------------- | ------------------------------- | ---------------------------- | ----------------------------- | ------------------- |
| Read-before-write       | DSH runtime enforcement | tool observation + interception | 强制 read 后才能 write            | 行为规则要求先 read                  | 无法可靠识别              |
| Failure convergence     | runtime / behavioral    | failure observation             | runtime enforcement          | behavioral guidance           | 无法观察 failure        |
| Parallelism discipline  | scheduler / behavioral  | concurrency visibility/control  | 控制实际并发                       | 要求 Agent 自行降低并发               | 无法观察相关状态            |
| Post-write verification | post-action capability  | action observation              | 自动检查 / gate                  | 要求 Agent 检查                   | 无法观察结果              |
| Escalation              | user interaction        | user communication              | runtime-triggered escalation | instruction-driven escalation | 无用户交互能力             |
| Rollback                | runtime state           | snapshot / rollback             | 自动 rollback                  | 指导 Agent 使用已有恢复机制             | 无 rollback/recovery |
| Tool-call restriction   | interception            | tool interception               | 直接 veto                      | 行为约束                          | 无法干预                |

以上表格只是迁移分析的起始模板。

**不要假定上述分类一定正确。应根据当前 `dsh-behavior-enhancer` 的真实实现逐项审计。**

---

# 9. 原始 DSH 能力与 Generic Skill 的关系

迁移后的关系应该是：

```text
                         Generic Skill
                              │
                 complete behavior semantics
                              │
                     capability resolution
                              │
                  ┌───────────┴───────────┐
                  ↓                       ↓
          DSH-capable host          weaker host
                  │                       │
              FULL / SOFT            SOFT / DISABLED
```

因此 DSH 并不是 generic Skill 的特殊逻辑分支。

更准确地说：

> **DSH 是一个 capability surface 较丰富的宿主。**

如果 DSH 提供了：

```text
tool interception
tool veto
runtime state
filesystem state
rollback
scheduler control
```

那么 generic Skill 在 DSH 中自然可以获得更多 FULL feature。

---

# 10. Hard Enforcement 不应被伪装成 Soft Enforcement

迁移过程中必须明确区分：

```text
hard enforcement
```

与：

```text
behavioral recommendation
```

例如原 DSH plugin：

```text
write_without_read
        ↓
runtime interception
        ↓
BLOCK
```

generic soft implementation：

```text
write_without_read
        ↓
Skill instruction
        ↓
Agent should reconsider / read first
```

两者不能声称功能强度相同。

因此文档、README 和 feature metadata 应明确说明：

> Generic Skill 保留行为语义，但 enforcement strength 取决于宿主 capability。

---

# 11. Activation Layer 的职责边界

Activation Layer 应负责：

1. 获取或识别宿主 capability surface。
2. 将 capability 与 feature requirements 匹配。
3. 为每个 feature 计算 `FULL / SOFT / DISABLED`。
4. 只激活当前宿主能够可靠支持的实现。
5. 防止 feature 因单项 capability 缺失而影响其他 feature。
6. 避免声明宿主不存在的 enforcement 能力。

Activation Layer 不应该负责：

* 让 Agent 自己选择 enforcement level；
* 根据 Agent “喜好”改变强制程度；
* 修改 feature 的核心行为语义；
* 把不同 harness 写成大量 hard-coded 分支；
* 为缺少 runtime capability 的宿主伪造 FULL enforcement。

---

# 12. 一个完整运行示例

假设 Generic Skill 定义：

```text
F1 = read-before-write
F2 = failure-convergence
F3 = parallelism-discipline
F4 = post-write-verification
F5 = rollback
```

宿主 A：

```text
tool observation       ✓
tool interception      ✓
tool veto              ✓
filesystem state       ✓
post-action hook       ✓
scheduler control      ✗
rollback               ✗
user escalation        ✓
```

Activation：

```text
F1 → FULL
F2 → FULL
F3 → SOFT
F4 → FULL
F5 → DISABLED
```

宿主 B：

```text
tool observation       ✓
tool interception      ✗
filesystem state       ✓
post-action hook       ✗
user escalation        ✓
```

Activation：

```text
F1 → SOFT
F2 → SOFT
F3 → SOFT
F4 → SOFT
F5 → DISABLED
```

宿主 C：

```text
tool observation       ✗
filesystem state       ✗
user escalation        ✓
```

Activation：

```text
F1 → DISABLED
F2 → DISABLED
F3 → DISABLED
F4 → DISABLED
F5 → DISABLED
```

但 Skill 本身仍然可以加载，因为 feature-level degradation 不应该等价于 Skill-level failure。

---

# 13. 与原 DSH Plugin 的兼容策略

不建议第一阶段直接删除现有 DSH implementation。

建议采用：

```text
Phase 1:
    Audit existing behavior-enhancer
        ↓
    Separate behavior semantics from DSH enforcement
        ↓
    Define generic feature model
        ↓
    Define capability requirements
        ↓
    Define activation levels

Phase 2:
    Implement generic Skill
        ↓
    Preserve DSH implementation as reference
        ↓
    Compare behavior parity

Phase 3:
    Add DSH capability adapter / host integration
        ↓
    Verify which features remain FULL

Phase 4:
    Test against weaker / generic hosts
        ↓
    Verify SOFT / DISABLED degradation

Phase 5:
    Decide packaging / distribution
```

是否最终作为独立 generic skill 发布，不影响前面的技术价值。

---

# 14. 验证标准

Generic 化不能只验证：

> “Skill 能不能加载。”

至少需要验证四个层面。

### 14.1 Semantic parity

Generic Skill 的行为原则是否覆盖原 `dsh-behavior-enhancer` 的核心设计。

### 14.2 Capability correctness

当宿主 capability 不足时，是否正确降级。

例如：

```text
interception = false
```

绝不能仍然宣称：

```text
read-before-write = FULL
```

### 14.3 Feature isolation

某一个 feature DISABLED 时，其他 feature 是否继续工作。

### 14.4 Enforcement honesty

必须保证：

```text
FULL ≠ SOFT
SOFT ≠ DISABLED
```

并且 README / metadata 不得把 SOFT 描述成 FULL。

---

# 15. 一个重要的设计原则：优先保留行为语义，而不是实现形式

迁移过程中不应要求：

```text
Generic implementation == DSH implementation
```

真正应该保持的是：

```text
Generic behavior semantics
        ≈
Original behavior semantics
```

而：

```text
Enforcement mechanism
```

允许根据宿主改变。

也就是说：

```text
same policy
different enforcement
```

是预期结果，而不是迁移失败。

---

# 16. 最终目标模型

最终希望得到：

```text
                    Behavior Skill
                         │
                 Complete Feature Set
                         │
                 Capability Resolver
                         │
        ┌────────────────┼────────────────┐
        │                │                │
       FULL             SOFT           DISABLED
        │                │                │
   Runtime-level     Agent-level      Not activated
   enforcement       guidance
        │                │
        └────────────────┴────────────────┘
                         │
                  Agent execution
```

因此，最终的 generic Skill 并不是：

> “DSH behavior-enhancer 的弱化版。”

而应该是：

> **“具有完整行为语义，并根据宿主 Agent architecture 的 capability surface 自动选择 enforcement level 的通用 Agent behavior skill。”**

DSH 只是其中一个能够提供较高 enforcement capability 的宿主。

---

# 17. 当前建议的下一步

暂时不要开始重写。

先对现有 `dsh-behavior-enhancer` 做一次 **Feature × Capability Audit**：

1. 列出当前所有独立行为 feature。
2. 对每个 feature 找出它当前依赖的 DSH API / runtime mechanism。
3. 区分“行为语义”和“DSH enforcement implementation”。
4. 确定该 feature 的：

   * FULL requirements
   * SOFT minimum requirements
   * DISABLED condition
5. 检查不同 feature 之间是否存在不可拆分的依赖。
6. 最后再确定 generic Skill 的 activation layer schema。

**只有完成这张 capability matrix 后，才开始实际迁移。**

因为真正需要回答的问题不是：

> “能不能把 dsh-behavior-enhancer 改成 generic skill？”

而是：

> **“原 behavior-enhancer 的每个行为 feature，在失去 DSH runtime 后，最低还能保留到什么程度；以及什么宿主 capability 可以让它重新恢复到 FULL？”**

这才是本次 generic 化的核心工程问题。
