# fused-cli — the underhall cli-fusion factory line

This is a fork of [`anomalyco/opencode`](https://github.com/anomalyco/opencode) (formerly `sst/opencode`), opened on branch **`fused-cli`** as the chassis for the **underhall cli-fusion factory track**.

> **Spec lives upstream.** The *why* — invariants, the six-source feature catalog, the auth model, the P0–P5 phased build — is in the [underhall](https://github.com/Zheke32174/underhall) repo at [`nlspec/cli-fusion.md`](https://github.com/Zheke32174/underhall/blob/master/nlspec/cli-fusion.md) and the cross-source synthesis at [`docs/teardowns/tool-matrix.md`](https://github.com/Zheke32174/underhall/blob/master/docs/teardowns/tool-matrix.md). This README documents the fork's *current state* and *where the fusion happens*.

## Why fork opencode

Per `nlspec/cli-fusion.md` §"The six sources", opencode is one of **two MIT-licensed bases** we build *on directly* (the other is [`nousresearch/hermes-agent`](https://github.com/nousresearch/hermes-agent), fused as the engine layer). Every other source — gemini-cli, qwen-code, codex, claude-code — contributes **re-implemented features**, never core code. claude-code in particular is **observed + driven**, never forked (the Claudia/opcode precedent — wrap the user's installed binary, ship zero proprietary bytes).

This is invariant 1: *"opencode is the only forked core."*

## Lineage

| | |
|---|---|
| Upstream | `anomalyco/opencode` v1.15.3 (MIT) — formerly `sst/opencode`, repo handed off |
| Fork root | `dev` branch at clone time |
| Our branch | `fused-cli` — long-running, target of every fusion commit; rebased against upstream as it evolves |

## Build (P1 — works today)

```
git clone https://github.com/Zheke32174/opencode underforge && cd underforge
git checkout fused-cli
bun install                                 # ~3 min, ~468 packages
bun run --cwd packages/opencode build       # builds the CLI
./packages/opencode/bin/opencode --help     # smoke
```

## Phased build (per `nlspec/cli-fusion.md`)

- **P0** — feature teardowns (done — under `underhall/docs/teardowns/` on master).
- **P1** — this commit: clean fork, builds, README. **[done at the first build-green commit]**
- **P2** — Engine fuse (hermes-agent): learn-loop, FTS5 memory, scheduler, agentskills.io skill runtime.
- **P3** — Tool plane: enhance `tool/`+`pty/` with gemini/qwen live-shell ergonomics + codex sandbox/apply-patch; MCP fill-ins.
- **P4** — `[HUMAN GATE]` claude-code driven-backend (Claudia pattern) + subscription-OAuth auth plugins.
- **P5** — `[HUMAN GATE]` "ours" features (gundam, colab-bridge, llm-tier, MEGA durable state) + license hygiene + name + public release.

## Where the fusion happens

The underhall spec maps cleanly onto opencode's *existing* subsystem folders — **almost everything is incremental enhancement, not greenfield**:

| Spec target | opencode location | Status |
|---|---|---|
| **Auth plugins** (subscription OAuth) | `packages/opencode/src/auth/` | exists, extend |
| **Tool plane** (PTY shell, apply-patch, sandbox) | `packages/opencode/src/tool/` + `pty/` + `patch/` | all exist, extend |
| **Skill runtime** (agentskills.io + claude-code grammar) | `packages/opencode/src/skill/` | exists (3 files), extend to superset |
| **Slash commands** | `packages/opencode/src/command/` | exists, extend |
| **Provider plane** (incl. claude-code driven) | `packages/opencode/src/provider/` (7 files) | exists, extend with claude-driven backend at P4 |
| **MCP client + server** | `packages/opencode/src/mcp/` | exists, fill gaps per tool-matrix |
| **Agent loop / sub-agents** | `packages/opencode/src/agent/`, `acp/` | exists, extend per qwen/claude-code patterns |
| **Background jobs / scheduler** | `packages/opencode/src/background/` | exists, extend toward hermes cron |
| **Session checkpoint/fork** | `packages/opencode/src/session/`, `snapshot/` | exists |
| **Memory** (hermes FTS5) | `packages/opencode/src/memory/` | **absent — new subsystem at P2** |

Only one new top-level subsystem (`memory/`). The rest is extension of what's already there.

## License + attribution (invariant 4)

opencode upstream is MIT (see `LICENSE`). Every module re-implementing or vendoring from a different upstream (gemini-cli / qwen-code / codex Apache-2.0) will carry its own LICENSE+NOTICE in-tree, with a top-level `THIRD_PARTY.md` mapping path → upstream → license. CI must fail on missing attribution (P2 deliverable).

claude-code (proprietary): **zero bytes in this repo, ever.** All claude-code value comes from observed design + driving the user's own installed binary as a backend (P4).

## See also

Upstream underhall docs (read in this order to onboard):
- [`nlspec/underhall.md`](https://github.com/Zheke32174/underhall/blob/master/nlspec/underhall.md) — the substrate.
- [`nlspec/cli-fusion.md`](https://github.com/Zheke32174/underhall/blob/master/nlspec/cli-fusion.md) — the spec this fork derives from.
- [`docs/teardowns/`](https://github.com/Zheke32174/underhall/tree/master/docs/teardowns) — the six source feature catalogs + cross-source `tool-matrix.md`.
- [`nlspec/ralph-factory.md`](https://github.com/Zheke32174/underhall/blob/master/nlspec/ralph-factory.md) — the autonomous-execution substrate that *drives* this work track-to-track.
