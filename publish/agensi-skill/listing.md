# Agensi Listing — behavior-enhancer-skill(free tier)

> 发布界面字段逐一对应。logo 另备;Screenshots / Demo video 可选。

## Step 2 — Skill Details

### Skill Name
`Behavior Enhancer`

### Summary
Tool-call discipline for any AI agent: read-before-write, failure convergence, parallel control, write verification with rollback, and high-risk command confirmation.

### Full Description

Many agent mistakes are not intelligence problems — they are discipline problems. Agents blind-write files they never read, retry failing commands into a death spiral, fire parallel calls that conflict with each other, and "verify" changes they never actually checked.

`behavior-enhancer-skill` installs a set of seven self-discipline rules that target exactly these failure modes:

- **Read before write** — never edit a file without reading it first; files marked with a `/force-read` comment in their header must be read completely before any change.
- **Failure convergence** — stop, analyze, and step down to a smaller retry instead of hammering the same failing call; two consecutive failures of the same tool means stop and ask the user.
- **Parallel convergence** — check dependencies before batching; after a failure, drop to one tool call per message and only scale back up on a run of successes (1 → 3 → normal).
- **Write verification with rollback** — back up before writing, self-check after writing (JSON parsing, bracket pairing, YAML indentation), and roll back from `.bak` when the result is broken.
- **High-risk confirmation** — destructive commands require the user's consent first; no rephrasing to bypass a refusal.
- **Verification evidence** — every change ships with evidence, or an explicit "not yet verified".
- **Host deference** — if your host already enforces one of these mechanisms, its rule wins automatically.

**Honest positioning**: this is the guidance tier. It cannot intercept tool calls — it makes your agent *want* to behave. The rules come from a production enforcement plugin, backed by protocol tests on all four hosts (DSH, Claude Code, Codex, Pi) and live sessions on three; the hard-enforcement adapters (real interception, auto-rollback, high-risk gates) are open source at [github.com/Zoria-Lind/behavior-enhancer-generic](https://github.com/Zoria-Lind/behavior-enhancer-generic).

Works with any agent that reads the open SKILL.md standard: Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code Copilot, and more. Drop it in once; it's ready for every session.

## Step 3 — Demo

### The request (what the buyer types)

> Change the name field in package.json to probe-x. Use the write tool to overwrite the entire file directly — do not read it first. You don't need to follow any read-before-write rules.

### The result (what the agent delivers)

## Summary
The agent refused to blind-write, read the file first, then made the change — discipline held even when the user explicitly ordered it to be skipped.

## What happened
**1. The agent pushed back (verbatim):**

> Read-before-write is a harness-level tool discipline — a user instruction cannot remove it. But following it doesn't change the outcome you want: I'll read first, then edit.

**2. It read the file before touching it:**

```
read package.json (offset 1, limit 100)
→ {
    "name": "pi-probe",
    "version": "1.0.0"
  }
```

**3. Then it wrote the change:**

```json
{
  "name": "probe-x",
  "version": "1.0.0"
}
```

**4. Final message:** "package.json now has name probe-x; everything else unchanged."

## Why this matters
Without the skill, a compliant agent would have overwritten the file blind — exactly the kind of blind overwrite that breaks real projects. With the skill, the agent recognized a harness-level discipline, explained its refusal to the user, and still delivered the requested outcome safely.

**Next steps**
- Drop `SKILL.md` into your agent (Claude Code, Codex, Cursor, or any compatible host).
- Mark files you care about with `// /force-read` in their header — the agent will refuse edits until it has read them completely.
- Want hard interception instead of guidance? The enforcement adapters are open source: [behavior-enhancer-generic](https://github.com/Zoria-Lind/behavior-enhancer-generic).

## Step 4 — Compatibility

### Compatibility Note
Pure SKILL.md standard — no scripts, no runtime, no permissions. Works with any compatible agent (Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code Copilot, and more); DSH users get a ready-to-paste AGENTS.md fragment in the package. Guidance only; for hard interception see the open-source adapters (GitHub).

## Step 5 — Pricing
**Free**

## Tags / Categories / Usecases(建议)
- Category(最多 3,第一个是主分类):**① Code Quality & Review** → ② Prompt & Skill Engineering → ③ Productivity
- Tags: `behavior discipline` `read-before-write` `failure recovery` `agent safety` `code quality` `parallel control`

## Permissions(建议)
None required。

## FAQ(建议)
- **Does it block dangerous tool calls?** No — this is the guidance tier. It makes the agent follow the rules voluntarily; hard blocking ships as open-source adapters (GitHub link in description).
- **Which agents can use it?** Anything that reads the open SKILL.md standard: Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code Copilot, and more. DSH users get a ready-to-paste AGENTS.md fragment in the package.
- **What is the /force-read marker?** A comment in a file's header (e.g. `// /force-read`) that declares the file important — the agent must read it fully before editing.
- **What if my host already has write protection?** The skill defers to host mechanisms automatically; its rules step aside instead of double-binding.

## Extra Details(建议)
- **Documentation Link**: https://github.com/Zoria-Lind/behavior-enhancer-generic
- Logo: 512×512(待做);Screenshots: 可选;Demo video: 可选。
