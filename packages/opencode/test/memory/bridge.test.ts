/**
 * Memory bridge tests — packages/opencode/test/memory/bridge.test.ts
 *
 * Smoke tests for P2.2 closeout. Exercises exportOnce() against the live
 * memory store: a seed row is added so the DB has nonzero size, then
 * exports are produced into a temp dir with no remote configured (so the
 * push path is skipped and the archive remains for inspection).
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { exportOnce } from "@/memory/bridge"
import * as Memory from "@/memory"
import { MemoryKind } from "@/memory"

let tmp: string

beforeAll(async () => {
  await Memory.add({
    kind: MemoryKind.User,
    name: "bridge-test-seed",
    description: "test seed for bridge.ts smoke",
    content: "bridge.ts test fixture",
    metadata: {},
  })
  tmp = mkdtempSync(path.join(tmpdir(), "bridge-test-"))
})

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

test("exportOnce produces a file when no remote is configured", async () => {
  const r = await exportOnce({ exportDir: tmp })
  expect(r.pushed).toBe(false)
  expect(existsSync(r.archivePath)).toBe(true)
  const sz = statSync(r.archivePath).size
  expect(sz).toBeGreaterThan(0)
  expect(r.bytes).toBe(sz)
})

test("exportOnce honors a custom exportDir", async () => {
  const r = await exportOnce({ exportDir: tmp })
  expect(r.archivePath.startsWith(tmp)).toBe(true)
  expect(existsSync(r.archivePath)).toBe(true)
  // Note: filenames embed UTC seconds, so consecutive sub-second calls
  // share a filename and overwrite — assert path-correctness, not file count.
})

test("exportOnce returns pushed=false when no remote is configured", async () => {
  const savedRemote = process.env.OPENCODE_MEMORY_REMOTE
  delete process.env.OPENCODE_MEMORY_REMOTE
  try {
    const r = await exportOnce({ exportDir: tmp })
    expect(r.pushed).toBe(false)
  } finally {
    if (savedRemote !== undefined) process.env.OPENCODE_MEMORY_REMOTE = savedRemote
  }
})

test("exportOnce filename matches memory-export-<UTC>.sqlite(.zst)? pattern", async () => {
  const r = await exportOnce({ exportDir: tmp })
  const base = path.basename(r.archivePath)
  expect(base).toMatch(/^memory-export-\d{8}T\d{6}Z\.sqlite(\.zst)?$/)
})
