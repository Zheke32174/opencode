/**
 * Memory bridge — packages/opencode/src/memory/bridge.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.2 (closeout)
 *
 * Periodic export of the SQLite memory DB to a compressed snapshot, with
 * optional rclone push to a remote. Mirrors the underhall agent-state
 * backup loop:
 *   - staging in $exportDir (default ~/.local/share/opencode)
 *   - trap-style cleanup: when pushing to a remote, the local archive
 *     is ALWAYS removed after the push attempt (success OR failure) —
 *     staging-on-failure is forbidden, matching backup-agent-state.sh's
 *     "remote is the system of record" invariant.
 *   - tiered System-Restore-style retention on the remote
 *
 * The local-only mode (no remote) leaves the archive on disk: in that
 * case the local file IS the durable copy.
 */
import { mkdirSync, statSync, rmSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export interface BridgeConfig {
  exportDir?: string
  remotePath?: string
  intervalSeconds?: number
  retentionMax?: number
}

export interface ExportResult {
  archivePath: string
  pushed: boolean
  bytes: number
}

const DEFAULT_EXPORT_DIR = path.join(homedir(), ".local", "share", "opencode")
const DEFAULT_INTERVAL = 3600
const DEFAULT_RETAIN = 30

function ts(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  )
}

function memoryDbPath(): string {
  return path.join(process.env.HOME || ".", ".opencode", "memory.db")
}

async function which(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "ignore" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function exportOnce(cfg: BridgeConfig = {}): Promise<ExportResult> {
  const exportDir = cfg.exportDir ?? DEFAULT_EXPORT_DIR
  const remotePath = cfg.remotePath ?? process.env.OPENCODE_MEMORY_REMOTE
  const retentionMax =
    cfg.retentionMax ?? Number(process.env.OPENCODE_MEMORY_RETAIN_MAX) ?? DEFAULT_RETAIN

  mkdirSync(exportDir, { recursive: true })
  const stamp = ts()
  const dbPath = memoryDbPath()

  // Build the archive. zstd is preferred; fallback is a raw .sqlite copy
  // so the export is still usable on minimal hosts.
  let archivePath: string
  let bytes = 0
  if (!existsSync(dbPath)) {
    archivePath = path.join(exportDir, `memory-export-${stamp}.sqlite.zst`)
    await Bun.write(archivePath, new Uint8Array())
    bytes = 0
  } else if (await which("zstd")) {
    archivePath = path.join(exportDir, `memory-export-${stamp}.sqlite.zst`)
    const proc = Bun.spawn(
      ["zstd", "-T0", "-6", "-q", "-f", "-o", archivePath, dbPath],
      { stdout: "ignore", stderr: "pipe" },
    )
    await proc.exited
    if (proc.exitCode !== 0) {
      throw new Error(`zstd exit ${proc.exitCode}`)
    }
    bytes = statSync(archivePath).size
  } else {
    archivePath = path.join(exportDir, `memory-export-${stamp}.sqlite`)
    const data = await Bun.file(dbPath).bytes()
    await Bun.write(archivePath, data)
    bytes = data.byteLength
  }

  // Optional rclone push. ALWAYS remove the local archive after the push
  // attempt — backup-agent-state.sh's trap-cleanup invariant. The remote
  // is the system of record; staging is ephemeral.
  let pushed = false
  if (remotePath) {
    if (await which("rclone")) {
      const proc = Bun.spawn(
        [
          "rclone",
          "copy",
          "--transfers=4",
          "--checkers=8",
          archivePath,
          remotePath,
        ],
        { stdout: "ignore", stderr: "pipe" },
      )
      await proc.exited
      pushed = proc.exitCode === 0
    }
    rmSync(archivePath, { force: true })
    if (pushed) {
      await pruneRemote(remotePath, retentionMax).catch(() => {
        // pruning is best-effort; failure does not invalidate the push
      })
    }
  }

  return { archivePath, pushed, bytes }
}

async function pruneRemote(remotePath: string, hardMax: number): Promise<void> {
  const proc = Bun.spawn(["rclone", "lsf", remotePath], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  if (proc.exitCode !== 0) return

  const names = text
    .split("\n")
    .map((s) => s.trim())
    .filter((n) => /^memory-export-\d{8}T\d{6}Z\.sqlite(\.zst)?$/.test(n))
    .sort()
    .reverse()
  if (names.length === 0) return

  const now = Date.now()
  const parseTs = (n: string): number => {
    const m = /memory-export-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(n)
    if (!m) return 0
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  }

  // Tier 1: keep newest 4 unconditionally.
  const keep = new Set<string>(names.slice(0, 4))

  // Tier 2-5: newest per hour (24h) / day (7d) / week (28d) / month (180d).
  const seen = new Set<string>()
  for (const n of names.slice(4)) {
    const t = parseTs(n)
    if (!t) continue
    const ageH = (now - t) / 3600000
    const d = new Date(t)
    let bucket: string
    if (ageH < 24) bucket = "h" + d.toISOString().slice(0, 13)
    else if (ageH < 24 * 7) bucket = "d" + d.toISOString().slice(0, 10)
    else if (ageH < 24 * 28) {
      const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
      const week = Math.floor((t - yearStart) / (7 * 86400000))
      bucket = "w" + d.getUTCFullYear() + "-" + week
    } else if (ageH < 24 * 180) {
      bucket = "m" + d.toISOString().slice(0, 7)
    } else {
      continue
    }
    if (!seen.has(bucket)) {
      seen.add(bucket)
      keep.add(n)
    }
  }

  // Hard ceiling.
  if (keep.size > hardMax) {
    const ranked = [...keep].sort().reverse().slice(0, hardMax)
    keep.clear()
    for (const r of ranked) keep.add(r)
  }

  const base = remotePath.replace(/\/$/, "")
  for (const n of names) {
    if (keep.has(n)) continue
    const proc = Bun.spawn(["rclone", "delete", `${base}/${n}`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await proc.exited
  }
}

export function startDaemon(cfg: BridgeConfig = {}): { stop(): void } {
  const intervalSec =
    cfg.intervalSeconds ??
    Number(process.env.OPENCODE_MEMORY_EXPORT_INTERVAL_SECONDS) ??
    DEFAULT_INTERVAL

  const fire = (): void => {
    exportOnce(cfg).catch((err) => {
      process.stderr.write(`memory bridge export failed: ${String(err)}\n`)
    })
  }

  const handle = setInterval(fire, intervalSec * 1000)
  fire()

  return {
    stop() {
      clearInterval(handle)
    },
  }
}
