/**
 * The config-driven resource policy (contract L): role x resource kind
 * allow/deny entries over one pattern grammar, validated loudly at load so
 * an invalid document refuses the composition instead of narrowing or
 * widening anything silently. Evaluation is deny-wins; an unmatched
 * candidate is 'undecided' and falls to the caller's next layer (the role
 * baseline for routes, visibility defaults for catalogs).
 * @module @qilin/account-rbac/policy
 */

import { readFileSync } from 'node:fs'
import type { SystemRole } from '@qilin/account-core'
import {
  isPermissionString,
  isResourceKind,
  isValidResourceName,
  matchesPattern,
  RESOURCE_KINDS,
  type ResourceKind,
} from './permissions.ts'

/** The system roles a policy section may name. */
const SYSTEM_ROLES: readonly SystemRole[] = ['admin', 'user']

/** Allow/deny pattern lists for one resource kind; absent sides impose nothing. */
export interface PolicyRules {
  /** Patterns that grant; their presence turns the kind into allow-list mode for non-admin roles. */
  readonly allow?: readonly string[]
  /** Patterns that refuse; a match wins over everything (contract L deny-wins). */
  readonly deny?: readonly string[]
}

/** One role's policy section: optional rules per resource kind. */
export type RolePolicy = Partial<Record<ResourceKind, PolicyRules>>

/** A validated policy document (version 1). */
export interface ResourcePolicy {
  /** Document format version; only 1 exists. */
  readonly version: 1
  /** Per-role sections; a role with no section is governed by its baseline alone. */
  readonly roles: Partial<Record<SystemRole, RolePolicy>>
}

/** The verdict for one candidate against one policy. */
export type PolicyVerdict = 'allow' | 'deny' | 'undecided'

/** Stable refusal codes the policy loader answers with (safe to surface or log). */
export type PolicyErrorCode =
  /** The configured file cannot be read (missing, permissioned, not a file). */
  | 'policy-file-unreadable'
  /** The configured file is not valid JSON. */
  | 'policy-file-json'
  /** The document parsed but violates the policy schema. */
  | 'policy-schema'

/**
 * A policy load that refuses the composition (fail-closed boot). The
 * message is a STABLE, sanitized refusal: it never carries the configured
 * path, a raw fs error, or a JSON parser excerpt - those details survive
 * only as the non-serializable `cause` for the internal logger boundary.
 */
export class PolicyConfigError extends Error {
  /** The stable refusal code (wire- and log-safe). */
  readonly code: PolicyErrorCode

  /**
   * Construct the refusal.
   * @param message - the sanitized, stable refusal text.
   * @param options - the stable code (default schema) and the internal cause.
   */
  constructor(message: string, options?: { code?: PolicyErrorCode; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'PolicyConfigError'
    this.code = options?.code ?? 'policy-schema'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSystemRole(raw: unknown): raw is SystemRole {
  return typeof raw === 'string' && SYSTEM_ROLES.includes(raw as SystemRole)
}

function isCandidateForKind(candidate: unknown, kind: ResourceKind): candidate is string {
  return kind === 'route' ? isPermissionString(candidate) : isValidResourceName(candidate)
}

/**
 * Validate one pattern for one resource kind. Route patterns name
 * permissions ('session:list'); every other kind names bare resource names
 * where a colon is a typo worth refusing. At most one '*' is allowed and
 * only as a trailing wildcard.
 * @param pattern - the raw pattern.
 * @param kind - the resource kind the pattern is written under.
 * @throws {PolicyConfigError} on any malformed pattern.
 */
function validatePattern(pattern: unknown, kind: ResourceKind): void {
  if (typeof pattern !== 'string' || pattern === '' || /\s/.test(pattern)) {
    throw new PolicyConfigError(`policy pattern must be a non-empty string without whitespace, got ${JSON.stringify(pattern)} under ${kind}`)
  }
  const colons = pattern.match(/:/g)?.length ?? 0
  if (kind === 'route') {
    const parts = pattern.split(':')
    if (colons !== 1 || parts[0] === '' || parts[1] === '') {
      throw new PolicyConfigError(`route policy pattern ${JSON.stringify(pattern)} must be a 'resource:action' pair`)
    }
  } else if (colons > 0) {
    throw new PolicyConfigError(`policy pattern ${JSON.stringify(pattern)} under ${kind} must not contain ':' (that grammar belongs to route patterns)`)
  }
  for (const segment of pattern.split(':')) {
    // The colon rules above already refuse every empty segment (an empty
    // pattern, '::', or a trailing colon), so only '*', literal, and
    // trailing-wildcard segments reach here.
    if (segment === '*') continue
    const stars = segment.match(/\*/g)?.length ?? 0
    if (stars > 1 || (stars === 1 && !segment.endsWith('*'))) {
      throw new PolicyConfigError(`policy pattern ${JSON.stringify(pattern)} must place at most one '*' per segment and only as a trailing wildcard`)
    }
  }
}

/**
 * Validate one rules object ({allow, deny}) for one resource kind.
 * @param rules - the raw value.
 * @param kind - the resource kind the rules are written under.
 * @returns the validated rules.
 * @throws {PolicyConfigError} on any malformed side or entry.
 */
function validateRules(rules: unknown, kind: ResourceKind): PolicyRules {
  if (!isPlainObject(rules)) {
    throw new PolicyConfigError(`policy rules for ${kind} must be an object with optional allow/deny arrays`)
  }
  for (const key of Object.keys(rules)) {
    if (key !== 'allow' && key !== 'deny') {
      throw new PolicyConfigError(`unknown policy key ${JSON.stringify(key)} under ${kind}; expected allow/deny arrays`)
    }
  }
  const out: { allow?: string[]; deny?: string[] } = {}
  for (const side of ['allow', 'deny'] as const) {
    const value = rules[side]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.length === 0) {
      throw new PolicyConfigError(`policy ${side} for ${kind} must be a non-empty array of patterns`)
    }
    for (const entry of value) validatePattern(entry, kind)
    out[side] = (value as string[]).slice()
  }
  return out
}

/**
 * Validate one raw policy document.
 * @param input - the parsed JSON value.
 * @returns the validated policy.
 * @throws {PolicyConfigError} on any structural deviation; callers must
 * refuse the composition rather than degrade (contract L fail-closed).
 */
export function validatePolicyDocument(input: unknown): ResourcePolicy {
  if (!isPlainObject(input)) throw new PolicyConfigError('policy document must be a JSON object')
  for (const key of Object.keys(input)) {
    if (key !== 'version' && key !== 'roles') {
      throw new PolicyConfigError(`unknown policy document key ${JSON.stringify(key)}; expected version and roles`)
    }
  }
  if (input['version'] !== 1) throw new PolicyConfigError('policy document version must be the number 1')
  const roles = input['roles']
  if (!isPlainObject(roles)) throw new PolicyConfigError('policy roles must be an object keyed by system role')
  const out: Partial<Record<SystemRole, RolePolicy>> = {}
  for (const [role, section] of Object.entries(roles)) {
    if (!SYSTEM_ROLES.includes(role as SystemRole)) {
      throw new PolicyConfigError(`unknown policy role ${JSON.stringify(role)}; expected admin or user`)
    }
    if (!isPlainObject(section)) {
      throw new PolicyConfigError(`policy section for role ${role} must be an object keyed by resource kind`)
    }
    const rolePolicy: RolePolicy = {}
    for (const [kind, rules] of Object.entries(section)) {
      if (!RESOURCE_KINDS.includes(kind as ResourceKind)) {
        throw new PolicyConfigError(`unknown resource kind ${JSON.stringify(kind)} for role ${role}; expected ${RESOURCE_KINDS.join('/')}`)
      }
      rolePolicy[kind as ResourceKind] = validateRules(rules, kind as ResourceKind)
    }
    out[role as SystemRole] = rolePolicy
  }
  return { version: 1, roles: out }
}

/**
 * Read and validate one policy file from disk (the assembly-time read; the
 * policy never reloads while the process lives - restart to apply edits).
 * @param path - the policy file path.
 * @returns the validated policy.
 * @throws {PolicyConfigError} when the file is unreadable, unparseable, or invalid.
 */
export function loadPolicyFileSync(path: string): ResourcePolicy {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    // Sanitized on purpose: the message names the KIND of failure only;
    // the configured path, the errno, and the raw fs error stay on the
    // non-serializable cause for the internal logger boundary.
    throw new PolicyConfigError('the configured resource policy file cannot be read', {
      code: 'policy-file-unreadable',
      cause,
    })
  }
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch (cause) {
    throw new PolicyConfigError('the resource policy file is not valid JSON', {
      code: 'policy-file-json',
      cause,
    })
  }
  // validatePolicyDocument only ever refuses with a PolicyConfigError, so
  // the reason surfaces untouched under the caller's boot failure.
  return validatePolicyDocument(document)
}

/**
 * Look up one role's rules for one resource kind.
 * @param policy - the validated policy.
 * @param role - the system role; an unknown runtime role returns undefined.
 * @param kind - the resource kind; an unknown runtime kind returns undefined.
 * @returns the rules, or undefined when the inputs are invalid or neither the role nor the kind has any.
 */
export function resourceRulesFor(policy: ResourcePolicy, role: unknown, kind: unknown): PolicyRules | undefined {
  if (!isSystemRole(role) || !isResourceKind(kind)) return undefined
  return policy.roles[role]?.[kind]
}

/**
 * Evaluate one candidate against one policy (contract L deny-wins).
 * @param policy - the validated policy.
 * @param role - the system role; an unknown role has no section.
 * @param kind - the resource kind to evaluate under.
 * @param candidate - the resource name or route permission string.
 * @returns 'deny' on any deny match, 'allow' on an allow match, 'undecided' otherwise; invalid runtime inputs are undecided.
 */
export function evaluatePolicy(policy: ResourcePolicy, role: unknown, kind: unknown, candidate: unknown): PolicyVerdict {
  if (!isSystemRole(role) || !isResourceKind(kind) || !isCandidateForKind(candidate, kind)) return 'undecided'
  const rules = resourceRulesFor(policy, role, kind)
  if (rules === undefined) return 'undecided'
  if (rules.deny?.some(pattern => matchesPattern(pattern, candidate))) return 'deny'
  if (rules.allow?.some(pattern => matchesPattern(pattern, candidate))) return 'allow'
  return 'undecided'
}

/**
 * The one predicate both catalog filtering and runtime resource decisions
 * share: a deny match removes the entry for every role; explicit admin
 * denies bind the admin; allow lists narrow non-admin roles only (the admin
 * baseline stays full); a kind with no rules keeps its entries.
 * @param candidate - the resource name or route permission string.
 * @param role - the system role.
 * @param policy - the validated policy.
 * @param kind - the resource kind to evaluate under.
 * @returns whether the resource stays visible to the role; invalid runtime inputs are hidden.
 */
export function resourceVisible(candidate: unknown, role: unknown, policy: ResourcePolicy, kind: unknown): boolean {
  if (!isSystemRole(role) || !isResourceKind(kind) || !isCandidateForKind(candidate, kind)) return false
  const rules = resourceRulesFor(policy, role, kind)
  if (rules === undefined) return true
  if (rules.deny?.some(pattern => matchesPattern(pattern, candidate))) return false
  if (role === 'admin') return true
  if (rules.allow === undefined) return true
  return rules.allow.some(pattern => matchesPattern(pattern, candidate))
}
