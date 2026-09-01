/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const QILIN_ROOT = '/dsh'

/** `$QILIN_HOME`: durable-state directory inside the image. */
export const QILIN_HOME = `${QILIN_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const QILIN_NODE_MODULES = `${QILIN_ROOT}/node_modules`

/** Directory holding the composed cordis.yml and the agent-preset tree. */
export const QILIN_CONFIG = `${QILIN_ROOT}/config`

/** Default (empty) workspace directory. */
export const QILIN_WORKSPACE = `${QILIN_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const QILIN_TMP = `${QILIN_ROOT}/tmp`
