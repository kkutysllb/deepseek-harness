/**
 * `ensureDirectoryInWorld` must not route a host-backed world through the
 * world's shell.
 *
 * Regression guard for a defect that shipped past a green suite: every real
 * deployment mounts an `fs`, so "is a world mounted?" is never the question —
 * and treating a mounted `fs` as remote ran `mkdir` through the sandboxed shell
 * for LOCAL workspaces too, where the sandbox confines it to its workspace root
 * and denies everything else. The existing specs never mounted an `fs`, so they
 * exercised the branch production never takes.
 *
 * Here the world is host-backed and no shell exists at all, so creation can only
 * succeed through this process's own filesystem.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { ensureDirectoryInWorld } from '../src/index.ts'

/** A host-backed world: the paths it resolves are this process's own. */
class HostBackedFs extends FileSystem {
  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(path), displayPath: path }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  /** Host-backed: this world can reach host paths, unlike a remote one. */
  override processPathFromHostPath(hostPath: string): string | undefined { return hostPath }

  override fileUrl(target: FsTarget): string { return `file://${this.processPath(target)}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return this.processPath(child).startsWith(this.processPath(parent))
  }

  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const info = await stat(this.processPath(target)).catch(() => undefined)
    if (info === undefined) return undefined
    return { version: FsVersion('v1'), type: info.isDirectory() ? 'directory' : 'file' }
  }

  override lstat(): Promise<FsPathInfo | undefined> { throw new FsError('not used', 'FS_IO_ERROR') }
  override readText(): Promise<string> { throw new FsError('not used', 'FS_IO_ERROR') }
  override streamText(): Promise<AsyncIterable<string>> { throw new FsError('not used', 'FS_IO_ERROR') }
  override readBytes(): Promise<Uint8Array> { throw new FsError('not used', 'FS_IO_ERROR') }
  override readByteRange(): Promise<Uint8Array> { throw new FsError('not used', 'FS_IO_ERROR') }
  override listDir(): Promise<FsDirEntry[]> { throw new FsError('not used', 'FS_IO_ERROR') }
  override writeText(_t: FsTarget, _c: string, _e?: FsWriteIntent): Promise<FsWriteOutcome> { throw new FsError('not used', 'FS_IO_ERROR') }
  override editText(): Promise<never> { throw new FsError('not used', 'FS_IO_ERROR') }
}

let created: string | undefined

afterEach(async () => {
  if (created !== undefined) await rm(created, { recursive: true, force: true })
  created = undefined
})

describe('ensureDirectoryInWorld', () => {
  it('creates through this host with a world mounted and no shell available', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-ensure-'))
    created = base
    const ctx = new Context()
    const fiber = ctx.plugin(HostBackedFs)
    await fiber.await()
    try {
      const target = join(base, 'nested', 'project')
      await ensureDirectoryInWorld(ctx, target)
      expect((await stat(target)).isDirectory()).toBe(true)
      // Idempotent: the existing-directory check short-circuits the second call.
      await ensureDirectoryInWorld(ctx, target)
    } finally {
      await fiber.dispose()
    }
  })
})
