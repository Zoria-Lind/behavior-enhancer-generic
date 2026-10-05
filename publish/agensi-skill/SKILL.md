---
name: behavior-enhancer-skill
description: Behavior discipline for agent tool calls: read files before editing, converge after failures, cap parallel calls after errors, verify writes with rollback, confirm destructive commands, and back every change with verification evidence. Use before modifying files or invoking tools, or whenever an agent should follow tool-call discipline. For hard interception, prefer the behavior-enhancer plugin on hosts that have one.
---

# Behavior Discipline (behavior-enhancer-skill)

> This skill is **behavior guidance with no runtime enforcement**. If your host has a plugin/hook
> version of behavior-enhancer available, install it for hard interception; this skill only carries
> self-discipline rules.
> **Host deference**: if your host already enforces any mechanism below (write protection, approval
> flows, checkpoint/undo, parallel scheduling), the host takes precedence and that rule is
> automatically void. Verify by observing actual behavior; if you cannot confirm, follow the most
> conservative path.
> **SOFT is a legitimate product form, not a downgrade**: when your host only has an agent-facing
> channel, self-discipline rules are the correct answer. Do not invent unreliable mechanisms to fake
> enforcement.

## 1. Read before write

- Read a file and confirm its current content before writing or editing it. Never blind-write.
- For large files beyond the default read limit, page with offset/limit until your change region is fully covered.
- A file with a comment-form `/force-read` marker at line start within its first 100 lines
  (e.g. `// /force-read`, `# /force-read`, `/* /force-read */`, `<!-- /force-read -->`) is a
  user-declared important file: read it completely before writing. Merely mentioning the token in
  prose does not count.
- New files (which do not exist yet) are exempt.

## 2. Failure convergence (decision tree)

- After any tool failure: stop retrying, analyze the cause, retry with a smaller single step. Never launch new calls based on a wrong premise.
- Same tool failing twice in a row: stop, explain the failure to the user, and ask how to proceed. Do not blindly retry with different parameters.
- Command-level failures count too: non-zero exit codes and stderr error keywords are failures (plain warnings are not).

## 3. Parallel convergence (four levers)

1. **Pre-dependency check**: before firing N parallel calls, ask yourself — are they independent of each other, and is each one low-risk? If dependent or high-risk, run them one at a time.
2. **Tiered quantization**: after a failure, send at most 1 tool call in the next message; after 3 consecutive successes raise to 3; after 3 more, restore your normal cap. State the current tier in your reply when it changes.
3. **Self-managed state file**: read `~/.behavior-enhancer/state.json` (failure count and current tier) at the start of each round and write it back after each batch. A missing or unreadable file means zero state; never block the main task on it.
4. **Single-step after failure**: after any failure, your next message contains exactly one tool call and starts with one line stating the failure cause.

## 4. Write verification and rollback

- **Before writing**: copy the target file to a sibling `.bak` (skip for new files).
- **After writing**: self-check — JSON with a parser; code for bracket/quote pairing; YAML for indentation and tabs.
- **Broken?** Restore from `.bak` and say in your reply: "rolled back, reason: ...".
- 1–2 issues: roll back and explain. 3 or more: roll back, explain in detail, and let the user decide the next step.

## 5. High-risk command confirmation

- Before destructive operations (deletion or recursive removal, overwriting critical config, permission changes): confirm with the user first, state the blast radius, and proceed only after consent.
- If the user refuses, do not rephrase the command to bypass. Ask what they intend instead.

## 6. Verification evidence

- If you modified files this turn, provide verification evidence in the same turn (tests passed / content check results). If you have none, say "not yet verified" explicitly.
- Confirm referenced paths and facts exist before citing them. If unsure, say so. Never fabricate.

## 7. The /force-read marker

- A comment-form `/force-read` at line start within the first 100 lines (e.g. `// /force-read`,
  `# /force-read`, `/* /force-read */`, `<!-- /force-read -->`; language-agnostic) marks an
  important file.
- This skill cannot intercept; compliance is on you. Hosts with the plugin version enforce it
  (unread = write rejected) using matching rules.
