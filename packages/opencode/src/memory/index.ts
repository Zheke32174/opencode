/**
 * Memory subsystem public API — packages/opencode/src/memory/index.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.1
 *
 * Re-exports the types + the small operation set every other opencode
 * subsystem imports. Keep this surface small; never import from store.ts
 * directly — that file is the storage detail and may swap impls.
 *
 * Wire targets (per spec §P2.1 integration plan):
 *   agent/   recall() on session start; the post-turn learn-loop (P2.4)
 *            calls add() with extracted patterns
 *   command/ slash commands /memory list|add|search|forget
 *   bridge.ts (P2.1 follow-up) periodic export → mega:underhall-snapshots/
 *            agent-memory/  per spec invariant 6 + open Q#2
 */
export {
  MemoryKind,
  type MemoryEntry,
  type MemoryAddInput,
  type MemoryQuery,
  type RecallContext,
} from "./types";

export { add, get, list, search, recall, forget, count } from "./store";
