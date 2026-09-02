/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const OPENKYLIN_ROOT = '/dsh'

/** `$OPENKYLIN_HOME`: durable-state directory inside the image. */
export const OPENKYLIN_HOME = `${OPENKYLIN_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const OPENKYLIN_NODE_MODULES = `${OPENKYLIN_ROOT}/node_modules`

/** Directory holding the composed cordis.yml and the agent-preset tree. */
export const OPENKYLIN_CONFIG = `${OPENKYLIN_ROOT}/config`

/** Default (empty) workspace directory. */
export const OPENKYLIN_WORKSPACE = `${OPENKYLIN_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const OPENKYLIN_TMP = `${OPENKYLIN_ROOT}/tmp`
