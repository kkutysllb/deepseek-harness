/** Browser API carrier: HTTP upstream plus one WebSocket per downstream event stream. */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@qilin/host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@qilin/host-apiproxy/api/rpc.schema'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'
import { AuthError, UnauthorizedSignal } from './auth-client.ts'

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/** WebApiClient seams: transport injection (tests) and the shared 401 signal. */
export interface WebApiClientOptions {
  /** Injected transport; defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch
  /** Shared 401 signal; every business fetch answered 401 emits here. */
  readonly unauthorized?: UnauthorizedSignal
  /** Unary timeout override passed to the abstract base. */
  readonly timeoutMs?: number
}

/** Browser platform subclass: unary/respond use fetch; mux/host use downlink-only WebSockets. */
export class WebApiClient extends AbstractApiClient {
  constructor(private readonly options: WebApiClientOptions = {}) {
    super(options.timeoutMs)
  }

  protected async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const response = await (this.options.fetch ?? globalThis.fetch)(input, init)
    // Observational tap only: the 401 body belongs to the caller; the signal
    // carries minimal facts (the precise wire code stays with the caller's
    // own error handling, e.g. AuthError from the account surface).
    if (response.status === 401 && this.options.unauthorized !== undefined) {
      this.options.unauthorized.emit(new AuthError(401, 'not_authenticated', 'the API carrier answered 401'))
    }
    return response
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readWebSocket(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
  }

  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: MessageEvent): void => {
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
