/**
 * The registration switch (legacy contract J under the D5 decision): POST
 * /register and GET /setup-status read the switch fresh on every request, so
 * editing the config file takes effect immediately — the legacy
 * "config is re-read per request" semantic. Missing file means open (the
 * legacy default when no configuration exists; the D5 baseline is open
 * registration); a malformed or wrong-typed file fails loud instead of
 * silently re-opening a deployment an operator tried to close.
 * @module @qilin/account-http/registration-config
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultAccountsDbPath } from '@qilin/account-core'

/** Config file name beside the account database. */
export const AUTH_CONFIG_FILENAME = 'auth-config.json'

/** The one documented key of the auth config file. */
export interface AuthConfigFile {
  /** Self-registration switch; absent or true is open, false closes /register. */
  readonly registrationEnabled?: unknown
}

/**
 * Resolve the default auth-config location: beside the account database in
 * the accounts directory of the harness home.
 * @param env - environment consulted for `QILIN_HOME`; defaults to `process.env`.
 * @returns the default config file path.
 */
export function defaultAuthConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(defaultAccountsDbPath(env)), AUTH_CONFIG_FILENAME)
}

/**
 * Read the registration switch from one config file, fresh per call.
 * @param path - the config file path.
 * @returns false only when an existing, well-formed file explicitly holds
 * `"registrationEnabled": false`; every well-formed other shape is open.
 * @throws when the file exists but is not valid JSON, or holds a
 * non-boolean `registrationEnabled` — a broken file never re-opens a
 * closed deployment, the error surfaces as a 500.
 */
export function readRegistrationEnabled(path: string): boolean {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`account-http: auth config ${path} is not valid JSON`, { cause: error })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`account-http: auth config ${path} must hold a JSON object`)
  }
  const value = (parsed as AuthConfigFile).registrationEnabled
  if (value === undefined) return true
  if (typeof value !== 'boolean') {
    throw new Error(`account-http: auth config ${path} holds a non-boolean registrationEnabled`)
  }
  return value
}
