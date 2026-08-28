/**
 * Account domain core: user and session entities, durable storage, and
 * password hashing. No HTTP surface lives here; routing and transport
 * belong to later account packages.
 * @module @qilin/account-core
 */

/* v8 ignore start -- a pure re-export barrel executes no branching logic;
   each symbol's own module carries the coverage. */

export { AccountConflictError } from './errors.ts'
export {
  SCRYPT_ENCODING_PREFIX,
  SCRYPT_PARAMS,
  hashPassword,
  verifyPassword,
  type RandomBytes,
} from './password.ts'
export {
  ACCOUNTS_DB_FILENAME,
  ACCOUNTS_DIRECTORY,
  ACCOUNTS_SCHEMA_VERSION,
  SqliteAccountStore,
  defaultAccountsDbPath,
  type SqliteAccountStoreOptions,
} from './sqlite-store.ts'
export type {
  AccountConflictKind,
  AccountStore,
  NewSession,
  NewUser,
  Session,
  SystemRole,
  User,
} from './types.ts'
