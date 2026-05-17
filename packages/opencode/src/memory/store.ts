/**
 * Memory store — packages/opencode/src/memory/store.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.1
 *
 * SQLite-backed via bun:sqlite + drizzle, matching the chassis storage
 * convention (see src/storage/db.bun.ts, src/session/session.sql.ts).
 *
 * P2.1 closes done-state criterion #1 with this commit: `memory list`
 * sees entries added in a prior process invocation (cross-process
 * persistence works). The Map-based placeholder is gone.
 *
 * Schema: see memory.sql.ts.
 * DB location: ~/.opencode/memory.db (single global store; per-project
 * sharding is deferred — project_id field segregates rows for now per
 * spec open Q#1).
 *
 * Search is LIKE-based for MVP; an FTS5 virtual table + ranking is the
 * P2.1 follow-up commit (no behaviour change required at the API layer).
 *
 * Stability contract: public function signatures match index.ts re-exports
 * exactly. Callers (agent/, command/) stay agnostic of storage.
 */
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { and, desc, eq, sql } from "drizzle-orm"
import { mkdirSync } from "fs"
import path from "path"
import type {
  MemoryEntry,
  MemoryAddInput,
  MemoryQuery,
  RecallContext,
  MemoryKind,
} from "./types"
import { MemoryTable } from "./memory.sql"

let _db: ReturnType<typeof drizzle> | null = null

function ulid(): string {
  // 26-char base32 timestamp + random tail — sortable, monotonic enough.
  // Real ulid (catalog dep) lands when this module starts caring about
  // distributed uniqueness; for a single-host store this is fine.
  const t = Date.now().toString(36).padStart(10, "0")
  const r = Math.random().toString(36).slice(2, 18).padStart(16, "0")
  return (t + r).slice(0, 26).toUpperCase()
}

function getDb() {
  if (_db) return _db
  const dir = path.join(process.env.HOME || ".", ".opencode")
  mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, "memory.db")
  const sqlite = new Database(dbPath, { create: true })

  // Idempotent first-init. Mirrors memory.sql.ts MemoryTable + indexes.
  // (drizzle's migration generator is a separate per-package concern;
  // for the MVP this raw DDL is the source of truth alongside the
  // typed schema — kept in lockstep manually until the chassis-wide
  // migration story stabilises.)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      project_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_kind_idx ON memory(kind);
    CREATE INDEX IF NOT EXISTS memory_project_idx ON memory(project_id);
  `)

  _db = drizzle({ client: sqlite })
  return _db
}

interface MemoryRow {
  id: string
  kind: string
  name: string
  description: string | null
  content: string
  project_id: string | null
  metadata: Record<string, unknown> | string
  time_created: number
  time_updated: number
}

function rowToEntry(r: MemoryRow): MemoryEntry {
  const md =
    typeof r.metadata === "string"
      ? (JSON.parse(r.metadata) as Record<string, unknown>)
      : r.metadata
  return {
    id: r.id,
    kind: r.kind as MemoryKind,
    name: r.name,
    description: r.description ?? "",
    content: r.content,
    createdAt: r.time_created,
    updatedAt: r.time_updated,
    projectId: r.project_id ?? undefined,
    metadata: md ?? {},
  }
}

// ─── public operations ───────────────────────────────────────────────────

export async function add(input: MemoryAddInput): Promise<MemoryEntry> {
  const db = getDb()
  const id = input.id ?? ulid()
  const now = Date.now()
  db.insert(MemoryTable)
    .values({
      id,
      kind: input.kind,
      name: input.name,
      description: input.description,
      content: input.content,
      project_id: input.projectId ?? null,
      metadata: input.metadata,
      time_created: input.createdAt ?? now,
      time_updated: now,
    } as never)
    .run()
  const row = db.select().from(MemoryTable).where(eq(MemoryTable.id, id)).get() as
    | MemoryRow
    | undefined
  if (!row) throw new Error(`memory.add: row vanished after insert (id=${id})`)
  return rowToEntry(row)
}

export async function get(id: string): Promise<MemoryEntry | null> {
  const db = getDb()
  const row = db.select().from(MemoryTable).where(eq(MemoryTable.id, id)).get() as
    | MemoryRow
    | undefined
  return row ? rowToEntry(row) : null
}

function buildWhere(query: MemoryQuery) {
  const cond = []
  if (query.kind !== undefined) cond.push(eq(MemoryTable.kind, query.kind))
  if (query.projectId === null)
    cond.push(sql`${MemoryTable.project_id} IS NULL`)
  else if (query.projectId !== undefined)
    cond.push(eq(MemoryTable.project_id, query.projectId))
  if (query.q) {
    const needle = `%${query.q}%`
    cond.push(
      sql`(${MemoryTable.name} LIKE ${needle} OR ${MemoryTable.description} LIKE ${needle} OR ${MemoryTable.content} LIKE ${needle})`,
    )
  }
  return cond.length ? and(...cond) : undefined
}

export async function list(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
  const db = getDb()
  const where = buildWhere(query)
  const rows = (
    where
      ? db
          .select()
          .from(MemoryTable)
          .where(where)
          .orderBy(desc(MemoryTable.time_updated))
          .limit(query.limit ?? 20)
          .offset(query.offset ?? 0)
          .all()
      : db
          .select()
          .from(MemoryTable)
          .orderBy(desc(MemoryTable.time_updated))
          .limit(query.limit ?? 20)
          .offset(query.offset ?? 0)
          .all()
  ) as MemoryRow[]
  return rows.map(rowToEntry)
}

export async function search(query: MemoryQuery): Promise<MemoryEntry[]> {
  // LIKE-based for now; FTS5 ranking is the next P2.1 commit. No API change
  // when that lands — callers stay on this entrypoint.
  return list(query)
}

export async function recall(ctx: RecallContext): Promise<MemoryEntry[]> {
  return list({
    projectId: ctx.projectId,
    limit: ctx.limit ?? 12,
  })
}

export async function forget(id: string): Promise<void> {
  const db = getDb()
  db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()
}

export async function count(kind?: MemoryKind): Promise<number> {
  const db = getDb()
  const row = db
    .select({ n: sql<number>`COUNT(*)`.as("n") })
    .from(MemoryTable)
    .where(kind !== undefined ? eq(MemoryTable.kind, kind) : undefined)
    .get() as { n: number } | undefined
  return row?.n ?? 0
}
