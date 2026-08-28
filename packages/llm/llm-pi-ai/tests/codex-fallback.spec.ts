/**
 * Codex-protocol routes pointed at gateways without a Codex channel
 * (translation relays, new-api-style gateways) must transparently fall back to
 * the standard OpenAI Responses protocol: the codex path is answered with the
 * gateway's HTML front page or a 404, and the standard channel lives at the
 * configured base or under the conventional /v1 prefix.
 */

import { createServer } from 'node:http'
import type { Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** One complete text turn in the shared Responses wire format (both protocols). */
const RESPONSES_EVENTS = [
  '{"type":"response.created","response":{"id":"resp_1"}}',
  '{"type":"response.output_item.added","output_index":0,"item":{"type":"message"}}',
  '{"type":"response.output_text.delta","output_index":0,"delta":"hello"}',
  '{"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
]

function writeSse(response: ServerResponse, events: string[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events) response.write(`data: ${event}\n\n`)
  response.end()
}

interface Relay {
  url: string
  paths: string[]
}

/**
 * new-api-style gateway stand-in: the codex path gets the HTML front page (or
 * a working codex channel when `codex` is true), the standard channel lives
 * under /v1/responses, and everything else 404s. Bodies are drained, never
 * parsed: the codex protocol may zstd-compress them.
 */
async function relayServer(options: { codex?: boolean } = {}): Promise<Relay> {
  const paths: string[] = []
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const path = request.url ?? ''
      paths.push(path)
      if (path.endsWith('/codex/responses')) {
        if (options.codex === true) {
          writeSse(response, RESPONSES_EVENTS)
          return
        }
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<!DOCTYPE html><html><head><title>gateway</title></head><body>home</body></html>')
        return
      }
      if (path === '/v1/responses') {
        writeSse(response, RESPONSES_EVENTS)
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":{"message":"404 Not Found"}}')
    })
  })
  servers.push(server)
  // The codex protocol probes WebSocket first; a gateway without a Codex
  // channel never upgrades. Destroying the socket on upgrade keeps the
  // handshake out of the recorded request paths.
  server.on('upgrade', (_request, socket) => { socket.destroy() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths }
}

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

const CODEX_MODELS = [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 272000, maxTokens: 128000 }]

describe('codex route protocol fallback', () => {
  it('falls back to /v1/responses when the gateway has no codex channel', async () => {
    const relay = await relayServer()
    const ctx = await harness({ 'openai-codex': { apiKeyEnv: 'PI_TEST_KEY', baseURL: relay.url, models: CODEX_MODELS } })
    const result = await assemble(ctx, { provider: 'openai-codex', model: 'gpt-5.5', messages: [userMessage()] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1, totalTokens: 4 })
    expect(relay.paths).toEqual(['/codex/responses', '/responses', '/v1/responses'])
  })

  it('falls back directly when the configured base already carries /v1', async () => {
    const relay = await relayServer()
    const ctx = await harness({ 'openai-codex': { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${relay.url}/v1`, models: CODEX_MODELS } })
    const result = await assemble(ctx, { provider: 'openai-codex', model: 'gpt-5.5', messages: [userMessage()] })
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(relay.paths).toEqual(['/v1/codex/responses', '/v1/responses'])
  })

  it('keeps the codex protocol when the channel works', async () => {
    const relay = await relayServer({ codex: true })
    const ctx = await harness({ 'openai-codex': { apiKeyEnv: 'PI_TEST_KEY', baseURL: relay.url, models: CODEX_MODELS } })
    const result = await assemble(ctx, { provider: 'openai-codex', model: 'gpt-5.5', messages: [userMessage()] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(relay.paths).toEqual(['/codex/responses'])
  })

  it('never falls back on non-codex routes', async () => {
    const relay = await relayServer()
    const ctx = await harness({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: relay.url } })
    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-v4-flash', messages: [userMessage()] })
    expect(result.finish.kind).toBe('error')
    expect(relay.paths).toEqual(['/chat/completions'])
  })
})
