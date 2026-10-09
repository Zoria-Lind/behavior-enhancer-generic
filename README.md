# behavior-enhancer-generic

**English** · [中文](README.zh-CN.md)

The behaviour design of `dsh-behavior-enhancer`, shipped as a **cross-host dual-form product**:

- **Plugin form (FULL)**: where the host exposes runtime interception, you get real enforcement — vetoes, write verification, auto-rollback;
- **Skill form (SOFT)**: where the host only gives an agent-facing channel, you get behavioural guidance (self-discipline rules).

Same semantics, different enforcement strength. **No FULL claims we cannot back, and no pretending SOFT is FULL.**

## Which host gets which form

| Host | Form | What to install | Status |
| :--- | :--- | :--- | :--- |
| Claude Code | FULL (8 features) | [`adapters/claude-code/`](adapters/claude-code/README.md) — plugin (F3b is implemented as a concurrency-window veto) | engine-level tests **14/14**, dogfooding |
| Codex | FULL (8 features) | [`adapters/codex/`](adapters/codex/README.md) — `config.toml` hooks or plugin manifest | protocol tests 13/13, ignition-tested on the desktop build |
| Pi | FULL (7 features + half of F9) | [`adapters/pi/`](adapters/pi/README.md) — pi extension | protocol tests 11/11, live-tested on a real install |
| DSH | FULL | [`adapters/dsh/`](adapters/dsh/README.md) — installable plugin (all modules of the original, plus F1 read-before-write and two fixes) | all-module mock-ctx tests pass, real-install test pending |
| Any other host | SOFT + ADAPTIVE | [`skill/SKILL.md`](skill/SKILL.md) §8: the agent self-builds an adapter from `core/adapter-template.md` (conservative testing, conservative FULL, written report) | published form |

**Install on Claude Code (one command)**:

```sh
/plugin marketplace add Zoria-Lind/behavior-enhancer-generic
/plugin install behavior-enhancer@zoria-behavior
```

For local development you can instead use `claude --plugin-dir "<repo>\adapters\claude-code"` or
`CLAUDE_CODE_PLUGIN_DIRS=...\adapters\claude-code` (see
[`adapters/claude-code/README.md`](adapters/claude-code/README.md)) — **pick one, never both.**

## The four-state activation model

Every feature activates independently, and its state is decided by the **host's capability surface** — never by user or agent preference:

| State | Meaning |
| :--- | :--- |
| NATIVE | The host already does this (only claimed when **measured**); the skill stays quiet |
| FULL | Plugin-level takeover (veto / write verification / rollback) |
| SOFT | Behavioural guidance (instructions, flow, decision trees) |
| DISABLED | We do not pretend a capability exists |

There are no `if DSH / elif ClaudeCode` branches — only capabilities. Full design in
[`generic-skill_plan_v1.md`](generic-skill_plan_v1.md); the feature × capability matrix in
[`core/audit.md`](core/audit.md); cross-host shared semantics (tokens, pattern tables, thresholds, TTL, tier ladder) in
[`core/semantics.md`](core/semantics.md).

> Note: those design documents (`core/`, `generic-skill_plan_v1.md`) are **Chinese-only** for now. English readers can work from this README plus the per-adapter READMEs.

## Relationship to the DSH plugin

The DSH adapter started from the original plugin `dsh-behavior-enhancer` (a separate repo) and then added the generic work. From there the two **evolve independently — there is no sync mechanism**: when one side produces a better rule, the other copies it by hand if it is worth it. **Install one or the other, never both**
(see [`adapters/dsh/README.md`](adapters/dsh/README.md)).

## Repository layout

```
behavior-enhancer-generic/
├── .claude-plugin/  # Claude Code marketplace manifest (marketplace.json, name: zoria-behavior)
├── core/            # behaviour semantics + capability matrix (four states) + generic adapter template (ADAPTIVE mode)
├── skill/           # SOFT artifact: SKILL.md + per-host resident fragments (claude-code / codex / pi / cursor)
├── adapters/        # FULL artifacts: claude-code / codex / pi (DSH is only a pointer back to the original repo)
├── publish/         # Agensi publishing artifacts (the SOFT skill package)
└── README.md / README.zh-CN.md   # English (this file) / Chinese
```

## Tests

```sh
cd adapters/claude-code && claude plugin validate . && claude plugin test .   # 14 engine-level tests
cd adapters/codex && node test/adapter.test.cjs                              # 13 protocol tests
cd adapters/pi && node test/adapter.test.cjs                                 # 11 protocol tests
```

## Links

- **Free SOFT version** (pure SKILL.md, works with any compatible host, no executable code): [Agensi — Behavior Enhancer](https://www.agensi.io/skills/behavior-enhancer-skill). The FULL version in this repo remains the only complete form; the two feed each other.
- [Claude Market](https://www.claudemarket.ai/plugins) — Claude Code plugin directory.

## License

MIT — see [LICENSE](LICENSE). The rules started from the DSH version and have evolved independently since.
