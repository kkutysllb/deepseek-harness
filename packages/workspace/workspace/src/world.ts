/**
 * Execution-world resolution for Workspace paths.
 *
 * A Workspace path names a directory in the deployment's **mounted execution
 * world**: this process's own filesystem when the local providers are mounted,
 * or a remote filesystem when the deployment mounts an SSH world. Workspace
 * identity (canonicalization), existence checks, and directory creation must
 * therefore resolve against that world rather than against `node:fs` — a
 * remote world's paths exist on the remote host, and `node:fs` would answer
 * about the wrong machine.
 *
 * Every helper falls back to this process's own filesystem when no `fs`
 * service is mounted, which is the honest answer for standalone use and unit
 * tests: with no other world mounted, the host filesystem IS the world.
 *
 * @module @deepseek-ai/dsh-workspace/src/world
 */

import { mkdir, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import { realpathNormalize } from './paths.ts'

/**
 * The mounted world filesystem.
 * @param ctx - the registry's context.
 * @returns the mounted `ctx.fs`, or undefined when the host filesystem is the world.
 */
function worldFs(ctx: Context): FileSystem | undefined {
  return ctx.get('fs') as FileSystem | undefined
}

/**
 * Canonicalize one path in the mounted execution world. The world's
 * `resolve` + `processPath` pair is the canon: a local backend realpaths the
 * path, and a remote backend asks the remote helper for the same stable
 * identity. With no world mounted this is the host's own `fs.realpath`, which
 * is what the module did before worlds were addressable — a path that does
 * not exist rejects there, and a remote backend rejects through its own
 * not-found error.
 * @param ctx - the registry's context.
 * @param path - the path to canonicalize.
 * @param signal - caller lifetime.
 * @returns the canonical path spelling in that world.
 */
export async function canonicalizeInWorld(
  ctx: Context,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const fs = worldFs(ctx)
  if (fs === undefined) return await realpathNormalize(path)
  return fs.processPath(await fs.resolve(path, signal === undefined ? undefined : { signal }))
}

/**
 * Whether the path names an existing directory in the mounted execution
 * world. An absent path is `false` rather than a throw: both callers use this
 * to reject a candidate Workspace, and "not a directory" already covers
 * "nothing there".
 * @param ctx - the registry's context.
 * @param path - the path to probe.
 * @param signal - caller lifetime.
 * @returns whether the world holds a directory at this path.
 */
export async function isDirectoryInWorld(
  ctx: Context,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const fs = worldFs(ctx)
  if (fs === undefined) {
    return await stat(path).then(entry => entry.isDirectory(), () => false)
  }
  const info = await fs.stat(await fs.resolve(path, signal === undefined ? undefined : { signal }), signal)
  return info?.type === 'directory'
}

/**
 * Quote one path as a single POSIX shell word.
 * @param value - the literal path.
 * @returns the path wrapped so the shell reproduces it verbatim.
 */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", '\'\\\'\'')}'`
}

/**
 * Create `path` and its ancestors in the mounted execution world.
 *
 * `FileSystem` deliberately carries no directory creation, so a mounted world
 * creates the level through its own shell — the same seam `bash` uses, which
 * is already pointed at that world. The host filesystem keeps Node's
 * recursive `mkdir`, so the no-world path is unchanged.
 * @param ctx - the registry's context.
 * @param path - the directory to ensure exists.
 * @param signal - caller lifetime.
 * @throws when a mounted world offers neither directory creation nor a shell,
 * or when the world's shell reports a non-zero exit.
 */
export async function ensureDirectoryInWorld(
  ctx: Context,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  // Already there: the common case, and the only one a remote world can
  // satisfy without a directory-creation primitive. Checking first also keeps
  // the sandboxed shell out of the ordinary path.
  if (await isDirectoryInWorld(ctx, path, signal)) return

  // Create with this process's own filesystem first. That is the accurate
  // answer for a host-backed world, and it matters beyond speed: running
  // `mkdir` through the world's shell would be confined by the sandbox policy
  // to its workspace root, so any workspace outside that root is denied — a
  // failure that has nothing to do with the directory being creatable.
  try {
    await mkdir(path, { recursive: true })
    return
  } catch (hostFailure: unknown) {
    // A remote world is unreachable from this process, so the host's failure is
    // the signal to create in the world instead.
    const fs = worldFs(ctx)
    const shell = ctx.get('shell') as ShellExecutor | undefined
    if (fs === undefined || shell === undefined) throw hostFailure
    const execution = await shell.execute(shell.resolve({
      command: `mkdir -p -- ${posixQuote(path)}`,
      // The command runs IN the mounted world, so its working directory must be
      // a path that exists there. Omitting `workdir` falls back to the
      // executor's configured default — this process's own cwd — which a remote
      // world does not have, and a spawn against a missing cwd fails with
      // ENOENT naming the command rather than the directory.
      workdir: fs.processPath(await fs.resolve('.', signal === undefined ? undefined : { signal })),
      signal,
    }))
    const result = await execution.result()
    if (result.exitCode !== 0) {
      throw new Error(
        `cannot create the directory '${path}' in the mounted world: the world's shell exited ${String(result.exitCode)}`,
        { cause: hostFailure },
      )
    }
  }
}
