import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_QILIN_HOME_DISPLAY,
  QILIN_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultDshHome,
  dshHomeDisplay,
  dshHomePath,
  expandHomePath,
  resolveDshHome,
} from '@qilin/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('qilin path helpers', () => {
  it('owns the shared default DSH home directory name', () => {
    expect(QILIN_HOME_DIR_NAME).toBe('.qilin')
    expect(DEFAULT_QILIN_HOME_DISPLAY).toBe('~/.qilin')
    expect(defaultDshHome()).toBe(join(homedir(), '.qilin'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.qilin')).toBe(join(homedir(), '.qilin'))
    expect(expandHomePath('~\\.qilin')).toBe(join(homedir(), '.qilin'))
    expect(expandHomePath('/tmp/.qilin')).toBe('/tmp/.qilin')
    expect(expandHomePath('~other/.qilin')).toBe('~other/.qilin')
  })

  it('resolves explicit path before QILIN_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveDshHome('/tmp/explicit-dsh', { QILIN_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveDshHome(undefined, { QILIN_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only QILIN_HOME as unset', () => {
    expect(resolveDshHome(undefined, { QILIN_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { QILIN_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved QILIN_HOME', () => {
    vi.stubEnv('QILIN_HOME', '~/env-dsh')
    expect(dshHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(dshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.qilin')
    expect(dshHomeDisplay('/some/other/root')).toBe('$QILIN_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qilin-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
