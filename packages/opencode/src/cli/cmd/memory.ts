/**
 * Memory CLI — packages/opencode/src/cli/cmd/memory.ts
 *
 * Spec: underhall:nlspec/cli-fusion.md §P2.1
 *
 * Surfaces the memory subsystem as four subcommands:
 *   opencode memory list    [--kind <k>] [--q <fts>] [--limit N]
 *   opencode memory add     --kind <k> --name <n> --content <body> [--description <d>]
 *   opencode memory search  <query> [--limit N]
 *   opencode memory forget  <id>
 *
 * Storage backs onto packages/opencode/src/memory/store.ts (in-memory Map
 * placeholder in this commit; SQLite + FTS5 swap is the next commit on
 * fused-cli per spec §P2.1 build order).
 *
 * Pattern mirrors src/cli/cmd/stats.ts (effectCmd) + src/cli/cmd/agent.ts
 * (multi-subcommand container).
 */
import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { MemoryKind } from "@/memory"
import * as Memory from "@/memory"

const KIND_CHOICES = [
  MemoryKind.User,
  MemoryKind.Feedback,
  MemoryKind.Project,
  MemoryKind.Reference,
] as const

const MemoryListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list memory entries",
  builder: (yargs: Argv) =>
    yargs
      .option("kind", {
        type: "string",
        choices: KIND_CHOICES,
        describe: "filter by memory kind",
      })
      .option("q", {
        type: "string",
        describe: "full-text query (matches name + description + content)",
      })
      .option("limit", { type: "number", default: 20 })
      .option("project", { type: "string", describe: "filter by project id (omit for all)" }),
  handler: Effect.fn("Cli.memory.list")(function* (args) {
    const entries = yield* Effect.promise(() =>
      Memory.list({
        kind: args.kind as MemoryKind | undefined,
        q: args.q,
        limit: args.limit,
        projectId: args.project,
      }),
    )
    if (entries.length === 0) {
      console.log("(no memory entries)")
      return
    }
    for (const e of entries) {
      console.log(`${e.id}  ${e.kind.padEnd(10)}  ${e.name}`)
      if (e.description) console.log(`  ${e.description}`)
    }
  }),
})

const MemoryAddCommand = effectCmd({
  command: "add",
  describe: "add a memory entry",
  builder: (yargs: Argv) =>
    yargs
      .option("kind", {
        type: "string",
        choices: KIND_CHOICES,
        demandOption: true,
        describe: "memory kind",
      })
      .option("name", {
        type: "string",
        demandOption: true,
        describe: "short slug (unique per kind+project)",
      })
      .option("description", {
        type: "string",
        default: "",
        describe: "one-line hook for recall ranking",
      })
      .option("content", {
        type: "string",
        demandOption: true,
        describe: "full markdown body",
      })
      .option("project", {
        type: "string",
        describe: "project id (omit for global)",
      }),
  handler: Effect.fn("Cli.memory.add")(function* (args) {
    const entry = yield* Effect.promise(() =>
      Memory.add({
        kind: args.kind as MemoryKind,
        name: args.name,
        description: args.description,
        content: args.content,
        projectId: args.project,
        metadata: {},
      }),
    )
    console.log(`added ${entry.id}  ${entry.kind}  ${entry.name}`)
  }),
})

const MemorySearchCommand = effectCmd({
  command: "search <q>",
  describe: "full-text search memory",
  builder: (yargs: Argv) =>
    yargs
      .positional("q", { type: "string", demandOption: true, describe: "FTS query" })
      .option("kind", { type: "string", choices: KIND_CHOICES })
      .option("limit", { type: "number", default: 20 }),
  handler: Effect.fn("Cli.memory.search")(function* (args) {
    const entries = yield* Effect.promise(() =>
      Memory.search({
        q: args.q,
        kind: args.kind as MemoryKind | undefined,
        limit: args.limit,
      }),
    )
    if (entries.length === 0) {
      console.log(`(no matches for "${args.q}")`)
      return
    }
    for (const e of entries) {
      console.log(`${e.id}  ${e.kind.padEnd(10)}  ${e.name}  — ${e.description}`)
    }
  }),
})

const MemoryForgetCommand = effectCmd({
  command: "forget <id>",
  describe: "remove a memory entry by id",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      demandOption: true,
      describe: "memory entry id (ulid)",
    }),
  handler: Effect.fn("Cli.memory.forget")(function* (args) {
    yield* Effect.promise(() => Memory.forget(args.id))
    console.log(`forgot ${args.id}`)
  }),
})

const MemoryExportCommand = effectCmd({
  command: "export",
  describe: "export memory DB to a compressed snapshot",
  builder: (yargs: Argv) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "export directory (default ~/.local/share/opencode)",
      })
      .option("remote", {
        type: "string",
        describe: "rclone remote (e.g. mega:underhall-snapshots/agent-memory/)",
      })
      .option("daemon", {
        type: "boolean",
        default: false,
        describe: "run as periodic daemon",
      })
      .option("interval", {
        type: "number",
        describe: "daemon interval in seconds (default 3600)",
      }),
  handler: Effect.fn("Cli.memory.export")(function* (args) {
    const Bridge = yield* Effect.promise(() => import("@/memory/bridge"))
    if (args.daemon) {
      const handle = Bridge.startDaemon({
        exportDir: args.dir,
        remotePath: args.remote,
        intervalSeconds: args.interval,
      })
      const intervalMsg = args.interval ?? 3600
      process.stderr.write(`memory bridge daemon started (interval=${intervalMsg}s)\n`)
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            const onExit = () => {
              handle.stop()
              resolve()
            }
            process.once("SIGTERM", onExit)
            process.once("SIGINT", onExit)
          }),
      )
      return
    }
    const r = yield* Effect.promise(() =>
      Bridge.exportOnce({
        exportDir: args.dir,
        remotePath: args.remote,
      }),
    )
    console.log(`exported ${r.archivePath} (${r.bytes} bytes, pushed=${r.pushed})`)
  }),
})

export const MemoryCommand = {
  command: "memory",
  describe: "manage agent memory (cross-session recall)",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryListCommand)
      .command(MemoryAddCommand)
      .command(MemorySearchCommand)
      .command(MemoryForgetCommand)
      .command(MemoryExportCommand)
      .demandCommand(1, "Specify a subcommand: list | add | search | forget"),
  handler: () => {},
}
