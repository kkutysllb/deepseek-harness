/**
 * Browse backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `browse` capability — one-level directory listing and child-directory
 * creation for the **mounted execution world**. With no `fs` service mounted
 * (standalone use, unit tests) that world is the host filesystem, served by
 * Node's stdlib as before. When a world IS mounted — an SSH profile, for
 * instance — every listing, probe and creation addresses that world instead,
 * so the dialog browses the machine the tools actually run on rather than this
 * one. Nothing renders on the host display, so this backend serves remote
 * clients the dialog backend cannot. Policy decisions (hidden entries flagged
 * but returned, symlinks followed, whole-filesystem scope) are recorded in the
 * directory-picker seam Agent Note.
 * @module @deepseek-ai/dsh-host-directory-picker-browse
 */

import { mkdir, opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsDirEntry, FileSystem } from '@deepseek-ai/dsh-fs'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import z from '@deepseek-ai/schemastery'
import {
  DirectoryPicker, DirectoryPickerError,
} from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryEntry, DirectoryListing, DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'

/**
 * Ancestor chain from the filesystem root to `target` inclusive — the
 * breadcrumb rows of a listing, every one a jump target.
 */
function ancestryCrumbs(target: string): DirectoryEntry[] {
  const crumbs: DirectoryEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    // basename of a root is '' — label the root crumb by its full path ('/', 'C:\').
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, hidden: false })
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/** One streamed listing candidate: the dirent facts a row needs, nothing else retained. */
export interface ListingCandidate {
  /** Base name within the streamed level. */
  name: string
  /** Dirent says directory (no probe needed). */
  isDirectory: boolean
  /** Dirent says symlink (enterability needs a stat probe). */
  isSymbolicLink: boolean
}

/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting
 * the name-largest candidate when the window exceeds `keep`. Memory over an
 * arbitrarily large level therefore stays O(keep) regardless of how many
 * children the directory holds.
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export function boundedInsert(window: ListingCandidate[], candidate: ListingCandidate, keep: number): boolean {
  // Full window, name at or beyond the tail: one comparison rejects, so an
  // oversized level costs O(1) per candidate past the head instead of a
  // window scan (100k children against a 1,001 window must not approach
  // 10^8 comparisons).
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a full window (length === keep >= 1) has a tail
  if (window.length === keep && candidate.name.localeCompare(window[window.length - 1]!.name) >= 0) return true
  // Binary insertion keeps a retained candidate at O(log keep) comparisons.
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    if (candidate.name.localeCompare(window[mid]!.name) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation
 * itself keeps running against a handle the caller then closes — its late
 * settlement is swallowed here so an abandoned read cannot surface as an
 * unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller,
        // and the abort reason already carried the outcome.
      })
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/** The thrown value as an Error (wire/abort reasons may be anything). */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/* v8 ignore start -- a close failure of an abandoned handle has no consumer, and forcing one needs a filesystem torn down mid-request. */
/** Swallow the close failure of a handle its caller already departed. */
function swallowCloseFailure(): void {}
/* v8 ignore stop */

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
  return error instanceof Error ? error.message : String(error)
}

/**
 * Quote one path as a single POSIX shell word, for the world-shell commands
 * this backend runs. Every world that reaches this arm is POSIX: the host
 * non-POSIX platforms are served by the host path above.
 * @param value - the literal path.
 * @returns the path wrapped so a POSIX shell reproduces it verbatim.
 */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", '\'\\\'\'')}'`
}

/**
 * One listing row for a dirent, following symlinks to directories; null for
 * non-directories and broken/cyclic links (skipped silently — the browser
 * shows what can be entered, and a broken link cannot).
 */
async function directoryRow(
  parent: string, name: string, isDirectory: boolean, isSymbolicLink: boolean, signal: AbortSignal | undefined,
): Promise<DirectoryEntry | null> {
  const path = join(parent, name)
  let enterable = isDirectory
  if (!enterable && isSymbolicLink) {
    try {
      // The probe races the caller too: a symlink target on a stalled
      // network filesystem must not keep a departed caller's request alive.
      enterable = (await raceAbort(stat(path), signal)).isDirectory()
    } catch {
      /* v8 ignore next 2 -- an abort landing mid-probe needs a stalled stat; the per-candidate check in list covers the settled path. */
      if (signal?.aborted) throw asError(signal.reason)
      // Broken or cyclic symlink: stat is the probe, failure means "not enterable".
      return null
    }
  }
  if (!enterable) return null
  // POSIX hidden convention; Windows' hidden attribute is not exposed by
  // dirents (Known Limitations). The client owns whether hidden rows show.
  return { name, path, hidden: name.startsWith('.') }
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link BrowseDirectoryPicker.Config}. */
  maxEntries: number
}

/** The `ctx.directoryPicker` browse implementation (stable capability object per service life). */
export default class BrowseDirectoryPicker extends DirectoryPicker {
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may
   * materialize and put on the wire: at most this many child-directory rows
   * (hidden rows included), with `truncated` flagging a cut level. The
   * default follows GitHub's web UI, which truncates directory listings at
   * 1,000 entries.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
  })

  private readonly browseCapability: DirectoryPickerCapability = {
    kind: 'browse',
    list: (path, signal) => this.list(path, signal),
    createDirectory: (path, name) => this.createDirectory(path, name),
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  /**
   * The browse interaction capability.
   * @returns the stable `browse` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.browseCapability
  }

  /**
   * The mounted execution world's filesystem, or undefined when this process's
   * own filesystem is the world. Read per call: a deployment composes the
   * world's `fs` row independently of this backend, so the answer can change
   * between activation and the first listing.
   * @returns the mounted `ctx.fs`, when there is one.
   */
  private get world(): FileSystem | undefined {
    return this.ctx.get('fs') as FileSystem | undefined
  }

  private async list(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const world = this.world
    return world === undefined ? await this.listOnHost(path, signal) : await this.listInWorld(world, path, signal)
  }

  private async createDirectory(path: string, name: string): Promise<string> {
    const world = this.world
    return world === undefined
      ? await this.createDirectoryOnHost(path, name)
      : await this.createDirectoryInWorld(world, path, name)
  }

  /**
   * The world's notion of the account's home, for the breadcrumb's "Home"
   * root. This process's home directory is only the account's home when the
   * world can actually see it; a remote world cannot, and answers with its own
   * default directory (the remote helper's cwd, which is the login account's
   * home on that machine).
   * @param world - the mounted filesystem.
   * @param signal - caller lifetime.
   * @returns the home path in that world.
   */
  private async worldHome(world: FileSystem, signal?: AbortSignal): Promise<string> {
    const hostHome = homedir()
    const opts = signal === undefined ? undefined : { signal }
    const info = await world.stat(await world.resolve(hostHome, opts), signal).catch(() => undefined)
    if (info?.type === 'directory') return hostHome
    return world.processPath(await world.resolve('.', opts))
  }

  /**
   * One listing level in the mounted execution world. `listDir` already
   * answers name-sorted with symlinks followed and a type per row, so the
   * world path needs none of the host path's streaming window: the seam's
   * complete-result bound is applied to the resolved rows instead.
   * @param world - the mounted filesystem.
   * @param path - absolute directory in that world; absent lists its home.
   * @param signal - caller lifetime.
   * @returns the level's listing with ancestry.
   */
  private async listInWorld(world: FileSystem, path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const opts = signal === undefined ? undefined : { signal }
    const home = await this.worldHome(world, signal)
    if (path !== undefined && !fullyQualified(path)) {
      throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = await world.resolve(path ?? home, opts)
    const listed = world.processPath(target)
    let level: FsDirEntry[]
    try {
      level = await world.listDir(target, signal)
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal?.throwIfAborted()
      throw new DirectoryPickerError('directory-unreadable', listed, `cannot list ${listed}: ${messageOf(error)}`)
    }
    signal?.throwIfAborted()
    const rows = level.filter(entry => entry.type === 'directory')
    const truncated = rows.length > this.config.maxEntries
    return {
      path: listed,
      home,
      crumbs: ancestryCrumbs(listed),
      entries: rows.slice(0, this.config.maxEntries).map(entry => ({
        name: entry.name,
        path: world.processPath(entry.target),
        hidden: entry.name.startsWith('.'),
      })),
      truncated,
    }
  }

  /**
   * Create one child directory in the mounted execution world. `FileSystem`
   * carries no directory creation, so the world's own shell performs it —
   * the same seam `bash` uses, already pointed at that world.
   * @param world - the mounted filesystem.
   * @param path - absolute existing parent in that world.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path in that world.
   */
  private async createDirectoryInWorld(world: FileSystem, path: string, name: string): Promise<string> {
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
    }
    if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new DirectoryPickerError('directory-create-failed', join(path, name), `"${name}" is not a single path segment`)
    }
    const parent = world.processPath(await world.resolve(path))
    const target = join(parent, name)
    // Same existence fence as the host path: the child either was not there
    // (create) or already is (directory-exists); a missing parent must fail
    // rather than be invented, which is why the command below is not `-p`.
    const existing = await world.stat(await world.resolve(target)).catch(() => undefined)
    if (existing !== undefined) {
      throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
    }
    const shell = this.ctx.get('shell') as ShellExecutor | undefined
    if (shell === undefined) {
      throw new DirectoryPickerError(
        'directory-create-failed', target,
        `cannot create ${target}: the mounted world provides no directory creation and no shell executor is available`,
      )
    }
    // The command runs in the mounted world: its working directory must be a
    // path that exists there, and the parent the browser is showing is exactly
    // that. (Omitting it falls back to this process's cwd, which a remote
    // world does not have — a spawn against a missing cwd reports ENOENT.)
    const execution = await shell.execute(shell.resolve({ command: `mkdir -- ${posixQuote(target)}`, workdir: parent }))
    const result = await execution.result()
    if (result.exitCode !== 0) {
      throw new DirectoryPickerError(
        'directory-create-failed', target,
        `cannot create ${target}: the world's shell exited ${String(result.exitCode)}`,
      )
    }
    return target
  }

  private async listOnHost(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const home = homedir()
    // The seam contract takes fully qualified paths only; resolve() would
    // silently rebase a relative or empty wire value under the host process
    // cwd (or, for rooted drive-less Windows forms, its current drive).
    if (path !== undefined && !fullyQualified(path)) {
      throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path ?? home)
    // Stream the level (opendir, one dirent at a time) into a name-sorted
    // window of maxEntries + 1 candidates: memory stays bounded no matter how
    // many children the directory holds, the window keeps the name-sorted
    // head, and the +1 slot lets an in-window extra row prove the cut. A
    // window candidate that turns out non-enterable (broken symlink) is not
    // backfilled from beyond the window — an eviction already marks the
    // level truncated, which stays the honest answer.
    const keep = this.config.maxEntries + 1
    const window: ListingCandidate[] = []
    let evicted = false
    try {
      // Every filesystem await races the caller's signal: a stalled
      // opendir/read on a network filesystem must not keep a departed
      // caller's scan alive, and an already-aborted request rejects even
      // when the level is empty.
      const opening = opendir(target)
      const level = await raceAbort(opening, signal).catch((error: unknown) => {
        // The abandoned open can still mint a handle after the abort won;
        // close it so a departed caller cannot leak a descriptor. (A lost
        // race against opendir's own rejection has nothing to close, and
        // the close's own failure is swallowed — the request already
        // returned, so a cleanup error has no consumer.)
        void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
          // Already rejected: raceAbort surfaced or swallowed it.
        })
        throw error
      })
      try {
        for (;;) {
          const dirent = await raceAbort(level.read(), signal)
          if (dirent === null) break
          // Only rows a browser could enter contend for the window; dirent
          // says "directory" outright, a symlink needs the later stat probe.
          if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
          const candidate = { name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() }
          if (boundedInsert(window, candidate, keep)) evicted = true
        }
      } finally {
        // Manual read() never auto-closes; close on every exit. The aborted
        // exit must not await it — Node queues close behind any in-flight
        // read, so awaiting would chain the departed caller back onto the
        // very stall the abort escaped (the abandoned read's settlement is
        // already swallowed by raceAbort).
        const closing = level.close()
        /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
        if (signal?.aborted) {
          closing.catch(swallowCloseFailure)
        } else {
          await closing
        }
      }
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal?.throwIfAborted()
      throw new DirectoryPickerError('directory-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
    }
    const entries: DirectoryEntry[] = []
    let truncated = evicted
    for (const candidate of window) {
      // A caller that departed between reads and probes stops before the
      // next probe (each probe's own await is raced inside directoryRow).
      signal?.throwIfAborted()
      const row = await directoryRow(target, candidate.name, candidate.isDirectory, candidate.isSymbolicLink, signal)
      if (row === null) continue
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      entries.push(row)
    }
    return { path: target, home, crumbs: ancestryCrumbs(target), entries, truncated }
  }

  private async createDirectoryOnHost(path: string, name: string): Promise<string> {
    // Same fully-qualified fence as list: never rebase a parent under the
    // cwd or the current drive.
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`)
    }
    const parent = resolve(path)
    // The backend owns segment validation; the Remote controller also refuses
    // invalid wire input, but direct service consumers must hit the same fence.
    if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new DirectoryPickerError('directory-create-failed', join(parent, name), `"${name}" is not a single path segment`)
    }
    const target = join(parent, name)
    try {
      // Non-recursive: the parent is the directory the browser is showing, so
      // a missing parent is a real failure, not a level to invent.
      await mkdir(target)
      return target
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        throw new DirectoryPickerError('directory-exists', target, `${target} already exists`)
      }
      throw new DirectoryPickerError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`)
    }
  }
}
