# Advanced: building an enforcement adapter for your host(ADAPTIVE mode)

> For power users. The main SKILL.md is guidance-only; if your host has hook/plugin APIs,
> you (or your agent) can build a hard-enforcement adapter that intercepts tool calls.
> **Conservative principle: when in doubt, stay SOFT. SOFT is a good product form — never
> fake FULL.** The reference implementations are open source:
> [github.com/Zoria-Lind/behavior-enhancer-generic](https://github.com/Zoria-Lind/behavior-enhancer-generic)
> (`adapters/` — one per host, each with protocol tests).

## 1. Capability audit — only verified facts count

Check, per channel: does the host have a way to **veto a tool call before it runs**? To **observe
results after a call**? To **inject text the model reads**? To **keep state**?

- **Unverified host claims count as absent.** Use at least two of: docs, source code, a minimal
  live probe.
- Record the verdict per feature: FULL feasible / SOFT only / DISABLED.

## 2. Semantics — copy, never invent

All behavior semantics (pattern tables, thresholds, TTL, tier ladder, marker rule) come from the
open-source project's `core/semantics.md`. Implementations to copy:
`adapters/codex/hooks/semantics.cjs` or `adapters/pi/extension/semantics.js`.
You only write the **transport and state access** — never restate the rules.

## 3. Transport — three hooks, fill what exists

**Hook 1 — before a tool call (veto channel):**
- F6 hard gate: command matches the high-risk pattern table → veto (escape counter: same reason
  blocked more than 3 times → let through, to avoid deadlock);
- F3b parallel window: in-flight count ≥ current tier → veto (denied calls don't count);
- F1 read-before-write: target is an important file (pattern table ∪ comment-form `/force-read`
  marker) with uncovered ranges → veto (message gives the first gap's offset);
- F5 pre-write snapshot: content or disk, whatever the host allows (new files too: rollback = delete).

**Hook 2 — after a tool call (observe channel):**
- F1: successful read → record covered range (offset+limit lower bound, union, 1h TTL);
- F5: post-write `lightParse` → broken? roll back + report honestly;
- F3a/F4: failure signatures (isError, exit codes, stderr keywords) → consecutive-failure counter →
  at threshold inject a stop-and-ask reminder;
- F3b: success streak → tier ladder recovery (1 → 3 successes → 3 → 3 more → unlimited).

**Hook 3 — prompt injection (persistent or per-request channel):**
- The discipline section (with a live tier line). Copy the text from the reference adapters and
  swap in your host's tool names. A persistent file channel (AGENTS.md style) is also a valid SOFT
  channel.

**State:** session-level — read coverage registry, in-flight set, tier, streak; cross-session
(optional) — counters. Access via in-process memory / files (atomic write or lock) / host state
API. **Everything fail-open: state or IO errors must never block tool execution.**

## 4. Known host pitfalls (silent failure = fake FULL)

1. Static-validator constraints (Claude Code style): hook functions must be top-level declarations;
   the engine interface must only be spelled `$.noun.event(...)`, never passed to helpers; only one
   matcher-less `tool.call` hook; `next` is reserved.
2. Subprocess hook protocols (Codex style): stdin is one JSON line; exit code 2 + stderr means
   BLOCK; a sync handler must output an empty stdout to allow (outputting "allow" is an error).
3. In-process factories (Pi style): the loader imports the default export; only returning a block
   stops execution; result rewrites replace content wholesale.
4. Rollback honesty: if the host has no delete API, a broken new file can only be cleared to empty —
   report exactly that.
5. Subprocess hooks have cross-process races: counting and registration must happen under one lock;
   in-process hooks don't have this problem.

## 5. Conservative testing — green before delivery

Cover at least (copy the structure of `adapters/{codex,pi}/test/adapter.test.cjs`):
1. important file unread → blocked;
2. fully read then write → allowed;
3. high-risk command → blocked + escape after 3;
4. failure → tier drops to 1 + reminder injected;
5. broken write → auto-rollback + report;
6. prose mention of `/force-read` → not blocked (false-positive guard).

If you can run the real host, add one minimal live session; otherwise protocol tests only — and say
so in the report.

## 6. Conservative FULL and honest delivery

- Features your tests didn't cover must not be labeled FULL — write "SOFT / unverified".
- Don't force upgrades: the only accepted mechanism invention is the "parallel window veto"
  (it has a negative-feedback loop and was live-tested on three hosts).
- When done, give the user a short report:
  1. host + capability audit summary (per channel: live-tested / docs / source);
  2. feature × tier table (FULL / SOFT / DISABLED / unverified, one reason each);
  3. test results: N passed of M, which cases;
  4. known limits and honest caveats (which channel never ran in a live session).
