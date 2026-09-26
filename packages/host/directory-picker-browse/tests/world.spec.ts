/**
 * The browse backend's world-aware path: with an `fs` service mounted, every
 * listing resolves in THAT world rather than on this process's filesystem.
 *
 * The sibling `service.spec.ts` covers the no-world (host filesystem) path, so
 * these cases exist to pin the behaviour that only appears once a world is
 * mounted: remote spellings in the listing, the world-home fallback for the
 * breadcrumb root, and the seam's complete-result bound applied to the level
 * the world returned.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { DirectoryPickerBrowseCapability } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '../src/index.ts'

/** A remote-world stand-in: POSIX paths that exist only in the stub's tables. */
class StubRemoteFs extends FileSystem {
  /** Directories the world knows, mapped to their child directory names. */
  readonly levels = new Map<string, string[]>()
  /** Paths the world holds as directories. */
  readonly directories = new Set<string>(['/', '/home', '/home/kkutys'])

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const base = opts?.cwd ?? '/home/kkutys'
    const absolute = path.startsWith('/')
      ? path
      : path === '.' ? base : `${base.replace(/\/+$/, '')}/${path}`
    return { targetKey: FsTargetKey(absolute.replace(/\/+$/, '') || '/'), displayPath: absolute }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${this.processPath(target)}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return this.processPath(child).startsWith(this.processPath(parent))
  }

  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const path = this.processPath(target)
    if (!this.directories.has(path) && !this.levels.has(path)) return undefined
    return { version: FsVersion('v1'), type: 'directory' }
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const path = this.processPath(target)
    const children = this.levels.get(path)
    if (children === undefined) throw new FsError(`cannot list ${path}`, 'FS_NOT_FOUND')
    return children.map(name => ({
      name,
      type: 'directory' as const,
      target: { targetKey: FsTargetKey(`${path === '/' ? '' : path}/${name}`), displayPath: `${path}/${name}` },
    }))
  }

  /* Unused by the browse path; the abstract base still requires them. */
  override lstat(): Promise<FsPathInfo | undefined> { throw new Error('not used') }
  override readText(): Promise<string> { throw new Error('not used') }
  override streamText(): Promise<AsyncIterable<string>> { throw new Error('not used') }
  override readBytes(): Promise<Uint8Array> { throw new Error('not used') }
  override readByteRange(): Promise<Uint8Array> { throw new Error('not used') }
  override writeText(_t: FsTarget, _c: string, _e?: FsWriteIntent): Promise<FsWriteOutcome> { throw new Error('not used') }
  override editText(): Promise<never> { throw new Error('not used') }
}

let capability: DirectoryPickerBrowseCapability
let dispose: () => Promise<void>
let world: StubRemoteFs

beforeAll(async () => {
  const ctx = new Context()
  const fsFiber = ctx.plugin(StubRemoteFs)
  await fsFiber.await()
  // Bound of two keeps the truncation case to a readable fixture level.
  const fiber = ctx.plugin(BrowseDirectoryPicker, { maxEntries: 2 })
  await fiber.await()
  world = ctx.get('fs') as StubRemoteFs
  const picked = ctx.get('directoryPicker')!.capability()
  if (picked.kind !== 'browse') throw new Error('browse backend must advertise the browse capability')
  capability = picked
  dispose = async () => { await fiber.dispose(); await fsFiber.dispose() }
})

afterAll(async () => { await dispose() })

describe('BrowseDirectoryPicker over a mounted execution world', () => {
  it('lists the world default directory when no path is given, not this host\'s home', async () => {
    world.levels.set('/home/kkutys', ['dsh-ws', 'miniconda3'])
    const listing = await capability.list()
    // `home` is the world's own default (the remote login account's home):
    // this process's home directory is not a directory in this world.
    expect(listing.home).toBe('/home/kkutys')
    expect(listing.path).toBe('/home/kkutys')
    expect(listing.entries.map(entry => entry.name)).toEqual(['dsh-ws', 'miniconda3'])
    // Every row path is spelled by the world, never joined by the client.
    expect(listing.entries.every(entry => entry.path.startsWith('/home/kkutys/'))).toBe(true)
  })

  it('uses this host\'s home when the world can see it, so a host-backed world is unchanged', async () => {
    const hostHome = (await import('node:os')).homedir()
    world.directories.add(hostHome)
    world.levels.set(hostHome, [])
    const listing = await capability.list()
    expect(listing.home).toBe(hostHome)
  })

  it('cuts a remote level at maxEntries and flags the cut', async () => {
    world.levels.set('/home/kkutys/big', ['a', 'b', 'c', 'd'])
    const listing = await capability.list('/home/kkutys/big')
    // Name-sorted head, bounded, and honest about the tail it withheld.
    expect(listing.entries.map(entry => entry.name)).toEqual(['a', 'b'])
    expect(listing.truncated).toBe(true)
    world.levels.set('/home/kkutys/exact', ['a', 'b'])
    const exact = await capability.list('/home/kkutys/exact')
    expect(exact.entries.map(entry => entry.name)).toEqual(['a', 'b'])
    expect(exact.truncated).toBe(false)
  })

  it('reports the world\'s ancestry as crumbs', async () => {
    world.levels.set('/home/kkutys/crumbed', [])
    const listing = await capability.list('/home/kkutys/crumbed')
    expect(listing.crumbs.map(crumb => crumb.path)).toEqual(['/', '/home', '/home/kkutys', '/home/kkutys/crumbed'])
    expect(listing.crumbs[0]!.name).toBe('/')
  })

  it('reports a world listing failure as directory-unreadable, never as a host error', async () => {
    const failure = await capability.list('/home/kkutys/absent').catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'directory-unreadable', path: '/home/kkutys/absent' })
  })
})
