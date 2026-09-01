/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('qilin-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      qilin?: { bundle?: { patch?: string } }
    }
    expect(manifest.qilin?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.qilin!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@qilin/sdk-app'],
      ['sdk-jsonrpc-server', '@qilin/sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@qilin/deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@qilin/session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@qilin/plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@qilin/llm-deepseek'],
      ['sandbox', '@qilin/sandbox-local'],
      ['session-projection', '@qilin/session-projection'],
      ['sandbox-policy', '@qilin/sandbox-policy'],
      ['subprocess', '@qilin/subprocess-local'],
      ['pty', '@qilin/terminal'],
      ['terminal-bash', '@qilin/terminal-bash'],
      ['terminal-pwsh', '@qilin/terminal-bash'],
      ['fs-local', '@qilin/fs-local'],
      ['timer', '@deepseek-ai/cordis-plugin-timer'],
      ['llm', '@qilin/llm'],
      ['session', '@qilin/session'],
      ['session-title', '@qilin/session-title'],
      ['system-prompt', '@qilin/system-prompt'],
      ['tools', '@qilin/tools'],
      ['agent', '@qilin/agent'],
      ['llm-retry', '@qilin/llm-retry'],
      ['jobs', '@qilin/jobs-local'],
      ['invariants', '@qilin/invariants'],
      ['session-invariant', '@qilin/session/invariant'],
      ['agent-invariant', '@qilin/agent/invariant'],
      ['scope-invariant', '@qilin/scope/invariant'],
      ['agent-loop-invariant', '@qilin/agent-loop/invariant'],
      ['agent-loop', '@qilin/agent-loop'],
      ['persistent-bash', '@qilin/tool-bash-persistent'],
      ['persistent-pwsh', '@qilin/tool-pwsh-persistent'],
      ['str-replace-editor', '@qilin/tool-str-replace-editor'],
      ['sessions', '@qilin/session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.QILIN_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: { __jsExpr: "process.env.QILIN_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
