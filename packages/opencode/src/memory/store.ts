/**
 * Memory store — packages/opencode/src/memory/store.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.1
 *
 * Public storage operations. P2.1 ships an in-memory Map-based placeholder
 * so the wire-up is verifiable end-to-end (the cli-fusion ledger's P2 done-
 * state requires `memory list` to return cleanly). The SQLite + FTS5 impl
 * lands in the follow-up commit on `fused-cli` (delegated to opencode@
 * undercity — see spec §P2.1 build order).
 *
 * The chassis already provides storage primitives in
 *   packages/opencode/src/storage/    (#db conditional: bun-sqlite | node)
 *   packages/opencode/src/sql.d.ts    (declares the chassis's SQL types)
 * — the follow-up wires this store onto those.
 *
 * Stability contract: the function signatures here MUST NOT change as the
 * impl swaps from Map → SQLite. Callers (agent/, command/) import from
 * ./index.ts and stay agnostic.
 */
import type {
  MemoryEntry,
  MemoryAddInput,
  MemoryQuery,
  RecallContext,
  MemoryKind,
} from "./types";

// ─── placeholder in-memory store ────────────────────────────────────────
// Module-scoped — reset on process restart. Acceptable for P2.1 scaffold;
// the SQLite-backed impl preserves identity-of-operations not identity-of-
// instance, so swapping is transparent.

const MEM = new Map<string, MemoryEntry>();

function ulid(): string {
  // Lazy ulid until the real impl pulls in the ulid package via catalog.
  // 26-char base32 timestamp + randomness — monotonic enough for placeholder.
  const t = Date.now().toString(36).padStart(10, "0");
  const r = Math.random().toString(36).slice(2, 18).padStart(16, "0");
  return (t + r).slice(0, 26).toUpperCase();
}

function applyQuery(entries: MemoryEntry[], q: MemoryQuery): MemoryEntry[] {
  let out = entries;
  if (q.kind !== undefined) out = out.filter((e) => e.kind === q.kind);
  if (q.projectId === null) out = out.filter((e) => e.projectId === undefined);
  else if (q.projectId !== undefined) out = out.filter((e) => e.projectId === q.projectId);
  if (q.q) {
    const needle = q.q.toLowerCase();
    out = out.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle) ||
        e.content.toLowerCase().includes(needle),
    );
  }
  out = [...out].sort((a, b) => b.updatedAt - a.updatedAt);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 20;
  return out.slice(offset, offset + limit);
}

// ─── public operations ───────────────────────────────────────────────────

export async function add(input: MemoryAddInput): Promise<MemoryEntry> {
  const now = Date.now();
  const id = input.id ?? ulid();
  const entry: MemoryEntry = {
    id,
    kind: input.kind,
    name: input.name,
    description: input.description,
    content: input.content,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    projectId: input.projectId,
    metadata: input.metadata,
  };
  MEM.set(id, entry);
  return entry;
}

export async function get(id: string): Promise<MemoryEntry | null> {
  return MEM.get(id) ?? null;
}

export async function list(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
  return applyQuery([...MEM.values()], query);
}

export async function search(query: MemoryQuery): Promise<MemoryEntry[]> {
  // Same as list() for the placeholder; SQLite impl will use FTS5 ranking.
  return applyQuery([...MEM.values()], query);
}

export async function recall(ctx: RecallContext): Promise<MemoryEntry[]> {
  const limit = ctx.limit ?? 12;
  return applyQuery([...MEM.values()], { projectId: ctx.projectId, limit });
}

export async function forget(id: string): Promise<void> {
  MEM.delete(id);
}

export async function count(kind?: MemoryKind): Promise<number> {
  if (kind === undefined) return MEM.size;
  let n = 0;
  for (const e of MEM.values()) if (e.kind === kind) n++;
  return n;
}
