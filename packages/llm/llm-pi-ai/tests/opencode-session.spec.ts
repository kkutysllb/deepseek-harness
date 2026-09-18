/**
 * OpenCode Go/Zen gateways route one conversation's requests to the same
 * upstream so prompt caches hit, and now require the routing id up front: a
 * request without `x-opencode-session` is answered 400 MissingSessionID.
 * pi-ai never adds the header — the pi client injects it in its coding-agent
 * SDK layer, which the pi-ai library path does not go through — so the
 * adapter supplies it from the Harness session id when the seam stamped one
 * on the call and from a stable per-adapter fallback otherwise. A header the
 * deployment configured always wins.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { withOpencodeSessionHeader } from '../src/adapter.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

/** The resolved descriptor of an OpenCode Go route (provider or base URL marks it). */
const OPENCODE_GO_MODEL = { provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' }

describe('withOpencodeSessionHeader', () => {
  it('injects the conversation session id on an opencode-go route', () => {
    const headers = withOpencodeSessionHeader(OPENCODE_GO_MODEL, 'conv-1', 'fallback', {})
    expect(headers).toEqual({ 'x-opencode-session': 'conv-1' })
  })

  it('recognizes every spelling pi-ai catalogs an opencode route under', () => {
    expect(withOpencodeSessionHeader({ provider: 'opencode', baseUrl: 'https://ln/zen/v1' }, 'c1', 'fb', {})['x-opencode-session']).toBe('c1')
    expect(withOpencodeSessionHeader({ provider: 'ln', baseUrl: 'https://ln/zen/go/v1' }, 'c2', 'fb', {})['x-opencode-session']).toBe('c2')
    expect(withOpencodeSessionHeader({ provider: 'acme-gateway', baseUrl: 'https://opencode.ai/zen/v1' }, 'c3', 'fb', {})['x-opencode-session']).toBe('c3')
  })

  it('leaves non-opencode routes untouched', () => {
    const headers = { authorization: 'Bearer x' }
    const out = withOpencodeSessionHeader({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }, 'conv', 'fb', headers)
    expect(out).toBe(headers)
  })

  it('keeps an explicitly configured session header in any casing', () => {
    const given = { 'X-OPENCODE-SESSION': 'deployment' }
    const out = withOpencodeSessionHeader(OPENCODE_GO_MODEL, 'conv', 'fb', given)
    expect(out).toBe(given)
    expect(out['X-OPENCODE-SESSION']).toBe('deployment')
  })

  it('falls back to the stable id when the seam stamped no session id', () => {
    expect(withOpencodeSessionHeader(OPENCODE_GO_MODEL, undefined, 'stable-fallback', {})['x-opencode-session']).toBe('stable-fallback')
  })

  it('preserves pre-existing headers when injecting', () => {
    const out = withOpencodeSessionHeader(OPENCODE_GO_MODEL, 'conv', 'fb', { authorization: 'Bearer x' })
    expect(out).toEqual({ authorization: 'Bearer x', 'x-opencode-session': 'conv' })
  })
})

async function harness(providers: Record<string, Record<string, unknown>>): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers })
  return ctx
}

const userMessage = (): ReturnType<typeof createUserMessage> => createUserMessage({
  content: [{ type: 'text', text: 'hi' }],
  source: { kind: 'plugin', plugin: 'test' },
})

describe('opencode session header on the wire', () => {
  it('sends the Harness session id on every opencode-go request', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({ 'opencode-go': { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const result = await assemble(ctx, {
      provider: 'opencode-go',
      model: 'deepseek-v4-flash',
      sessionId: 'conversation-42' as never,
      messages: [userMessage()],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.headers[0]?.['x-opencode-session']).toBe('conversation-42')
  })

  it('keeps one stable fallback session id across calls without a seam id', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = await harness({ 'opencode-go': { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    await assemble(ctx, { provider: 'opencode-go', model: 'deepseek-v4-flash', messages: [userMessage()] })
    await assemble(ctx, { provider: 'opencode-go', model: 'deepseek-v4-flash', messages: [userMessage()] })
    const first = server.headers[0]?.['x-opencode-session']
    const second = server.headers[1]?.['x-opencode-session']
    expect(first).toBeDefined()
    expect(first).toMatch(/^[0-9a-f-]{8,}$/)
    expect(second).toBe(first)
  })

  it('lets a deployment-configured session header win over the default', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({
      'opencode-go': {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: server.url,
        headers: { 'x-opencode-session': 'deployment-pinned' },
      },
    })
    await assemble(ctx, { provider: 'opencode-go', model: 'deepseek-v4-flash', messages: [userMessage()] })
    expect(server.headers[0]?.['x-opencode-session']).toBe('deployment-pinned')
  })

  it('does not touch non-opencode routes', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    await assemble(ctx, { provider: 'deepseek', model: 'deepseek-v4-flash', messages: [userMessage()] })
    expect(server.headers[0]?.['x-opencode-session']).toBeUndefined()
  })
})
