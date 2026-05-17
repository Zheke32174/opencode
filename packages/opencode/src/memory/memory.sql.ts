/**
 * Memory drizzle schema — packages/opencode/src/memory/memory.sql.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.1
 *
 * Mirrors the chassis's <name>.sql.ts convention (see session/session.sql.ts,
 * share/share.sql.ts). Defines the MemoryTable for the SQLite-backed store
 * in store.ts. The sibling FTS5 virtual table "memory_fts" (for full-text
 * search with ranking) cannot be declared as a drizzle sqliteTable; it is
 * managed by raw DDL in store.ts getDb().
 */
import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { MemoryKind } from "./types"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    kind: text().$type<MemoryKind>().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    content: text().notNull(),
    project_id: text(),
    metadata: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...Timestamps,
  },
  (table) => [
    index("memory_kind_idx").on(table.kind),
    index("memory_project_idx").on(table.project_id),
  ],
)
