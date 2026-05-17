/**
 * Memory subsystem types — packages/opencode/src/memory/types.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.1
 *
 * The fused CLI persists agent memory across sessions. Four memory kinds
 * mirror hermes-agent's lifecycle taxonomy AND underhall's existing
 * auto-memory schema (~/.claude/projects/<repo>/memory/*.md):
 *
 *   user       facts about the user (role, preferences, knowledge depth)
 *   feedback   guidance the user has given — corrections + validations
 *   project    in-flight project state (deadlines, decisions, who's doing
 *              what); decays fast — prune aggressively
 *   reference  pointers to where info lives in external systems
 *
 * Wire shape is stable; the storage layer in store.ts is what swaps later
 * (P2.1 ships an in-memory placeholder; the SQLite + FTS5 impl follows).
 */
export enum MemoryKind {
  User = "user",
  Feedback = "feedback",
  Project = "project",
  Reference = "reference",
}

/**
 * One memory entry. Persisted to SQLite (drizzle) in the final impl, with
 * an FTS5 virtual table over `content` + `description` for full-text recall.
 */
export interface MemoryEntry {
  readonly id: string;             // ulid (sortable, monotonic, 26 chars)
  readonly kind: MemoryKind;
  readonly name: string;           // short slug, unique per (kind, projectId)
  readonly description: string;    // one-line hook used by recall ranking
  readonly content: string;        // full markdown body
  readonly createdAt: number;      // unix ms
  readonly updatedAt: number;
  readonly projectId?: string;     // null = global; else absolute project path
  readonly metadata: Record<string, unknown>;
}

/**
 * Input to add(). System assigns id + timestamps unless caller overrides
 * (useful for imports / migrations from ~/.claude/projects/.../memory/*.md).
 */
export type MemoryAddInput = Omit<MemoryEntry, "id" | "createdAt" | "updatedAt"> & {
  readonly id?: string;
  readonly createdAt?: number;
};

/**
 * Query for search() / list(). All fields optional; combine with AND.
 * For `projectId`, pass `null` to constrain to globals only, omit for
 * "any project including global".
 */
export interface MemoryQuery {
  readonly kind?: MemoryKind;
  readonly projectId?: string | null;
  readonly q?: string;             // FTS5 query string (when impl supports it)
  readonly limit?: number;         // default 20
  readonly offset?: number;        // default 0
}

/**
 * Recall context — used at session start to seed the agent's prompt with
 * relevant prior memory. Implementation ranks across kinds; the agent layer
 * decides how many tokens to spend rendering them into the system prompt.
 */
export interface RecallContext {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly limit?: number;         // default 12
}
