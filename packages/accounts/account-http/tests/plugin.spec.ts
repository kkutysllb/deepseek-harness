import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute, WebServer } from '@qilin/host-webserver'
import { Context } from '@deepseek-ai/cordis'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_ROUTE_PREFIX } from '../src/auth-router.ts'
import { apply, name } from '../src/plugin.ts'
import { Config } from '../src/index.ts'

/** The plugin mounts the route family, provides the gate, and closes the store. */
describe('plugin apply', () => {
  const homes: string[] = []
  afterEach(async () => {
    for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
  })

  it('exposes the cordis plugin identity and schema', () => {
    expect(name).toBe('account-http')
    expect(Config).toBeTruthy()
  })

  it('registers the prefix route and provides the structural gate, then closes the store on dispose', async () => {
    const routes: WebRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', {
      register: (route: WebRoute) => {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
      registerUpgrade: () => () => {},
      tapIndex: () => () => {},
      port: 0,
    } as unknown as WebServer)
    await ctx.plugin({ inject: ['webServer'], apply }, { dbPath: ':memory:' })
    await ctx.fiber.await()
    expect(routes).toHaveLength(2)
    expect(routes.map(route => route.path)).toContain(AUTH_ROUTE_PREFIX)
    expect(routes.map(route => route.path)).toContain('/api/v1/admin/users')
    const gate = ctx.get('apiAuth') as { checkRequest: (request: IncomingMessage) => unknown; checkUpgrade: (request: IncomingMessage) => boolean }
    expect(typeof gate.checkRequest).toBe('function')
    expect(typeof gate.checkUpgrade).toBe('function')
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, { url: '/api/v1/auth/me', method: 'GET', headers: {} })
    const verdict = gate.checkRequest(request) as { allowed: boolean; status: number }
    expect(verdict).toMatchObject({ allowed: false, status: 401 })
    await ctx.fiber.dispose()
    expect(routes).toHaveLength(0)
  })

  it('derives the store and switch paths from the environment when config omits them', async () => {
    const home = await mkdtemp(join(tmpdir(), 'account-http-plugin-default-'))
    homes.push(home)
    const previousHome = process.env.OPENKYLIN_HOME
    process.env.OPENKYLIN_HOME = home
    try {
      const routes: WebRoute[] = []
      const ctx = new Context()
      ctx.provide('webServer', {
        register: (route: WebRoute) => {
          routes.push(route)
          return () => { routes.splice(routes.indexOf(route), 1) }
        },
        registerUpgrade: () => () => {},
        tapIndex: () => () => {},
        port: 0,
      } as unknown as WebServer)
      await ctx.plugin({ inject: ['webServer'], apply }, {})
      await ctx.fiber.await()
      expect(routes).toHaveLength(2)
      await ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.OPENKYLIN_HOME
      else process.env.OPENKYLIN_HOME = previousHome
    }
  })

  it('routes store faults after dispose through ctx.logger.warn', async () => {
    const routes: WebRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', {
      register: (route: WebRoute) => {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
      registerUpgrade: () => () => {},
      tapIndex: () => () => {},
      port: 0,
    } as unknown as WebServer)
    await ctx.plugin({ inject: ['webServer'], apply }, { dbPath: ':memory:' })
    await ctx.fiber.await()
    const handler = routes.find(route => route.path === AUTH_ROUTE_PREFIX)!.handler
    // Teardown closes the store first; a late request then faults inside the
    // handler and must surface through the plugin logger, not the wire.
    await ctx.fiber.dispose()
    const response = Object.assign(new (await import('node:events')).EventEmitter(), {
      headersSent: false,
      writeHead: (status: number) => { Object.assign(response, { __status: status }); return response },
      end: (payload?: string) => { Object.assign(response, { __body: payload }); return response },
      setHeader: () => response,
      destroy: () => response,
    }) as unknown as ServerResponse
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, { url: '/api/v1/auth/setup-status', method: 'GET', headers: { host: '127.0.0.1' } })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await handler(request, response)
    expect(warn).toHaveBeenCalled()
    expect((response as unknown as { __status?: number }).__status).toBe(500)
  })

  it('boots with the valve warning when OPENKYLIN_AUTH_DISABLED is set', async () => {
    const saved = process.env.OPENKYLIN_AUTH_DISABLED
    const savedProd = process.env.OPENKYLIN_ENV
    const savedEnvironment = process.env.ENVIRONMENT
    delete process.env.OPENKYLIN_ENV
    delete process.env.ENVIRONMENT
    process.env.OPENKYLIN_AUTH_DISABLED = '1'
    try {
      const routes: WebRoute[] = []
      const ctx = new Context()
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      ctx.provide('webServer', {
        register: (route: WebRoute) => {
          routes.push(route)
          return () => { routes.splice(routes.indexOf(route), 1) }
        },
        registerUpgrade: () => () => {},
        tapIndex: () => () => {},
        port: 0,
      } as unknown as WebServer)
      await ctx.plugin({ inject: ['webServer'], apply }, { dbPath: ':memory:' })
      await ctx.fiber.await()
      expect(warn).toHaveBeenCalled()
      await ctx.fiber.dispose()
    } finally {
      if (saved === undefined) delete process.env.OPENKYLIN_AUTH_DISABLED
      else process.env.OPENKYLIN_AUTH_DISABLED = saved
      if (savedProd === undefined) delete process.env.OPENKYLIN_ENV
      else process.env.OPENKYLIN_ENV = savedProd
      if (savedEnvironment === undefined) delete process.env.ENVIRONMENT
      else process.env.ENVIRONMENT = savedEnvironment
    }
  })
})

describe('plugin apply: admin route fault path', () => {
  it('routes a dispatch fault into the logger warn seam with a 500', async () => {
    process.env.OPENKYLIN_AUTH_DISABLED = '1'
    try {
      const routes: WebRoute[] = []
      const ctx = new Context()
      const warnings: unknown[] = []
      ;(ctx as unknown as { logger: { warn: (error: unknown) => void } }).logger = { warn: (error: unknown) => { warnings.push(error) } }
      ctx.provide('webServer', {
        register: (route: WebRoute) => {
          routes.push(route)
          return () => { routes.splice(routes.indexOf(route), 1) }
        },
        registerUpgrade: () => () => {},
        tapIndex: () => () => {},
        port: 0,
      } as unknown as WebServer)
      await ctx.plugin({ inject: ['webServer'], apply }, { dbPath: ':memory:' })
      await ctx.fiber.await()
      const adminRoute = routes.find(route => route.path === '/api/v1/admin/users')!
      const request = Readable.from([Buffer.from('{oops')]) as unknown as IncomingMessage
      Object.assign(request, { url: '/api/v1/admin/users/u1', method: 'PATCH', headers: {} })
      let status_: number | undefined
      let body_: string | undefined
      const response = Object.assign(new (await import('node:events')).EventEmitter(), {
        setHeader() { return response },
        writeHead(status: number) { status_ = status; return response },
        end(body?: string) { body_ = body; return response },
      }) as unknown as ServerResponse
      await (adminRoute.handler as (req: IncomingMessage, res: ServerResponse) => Promise<void>)(request, response)
      expect(status_).toBe(500)
      expect(JSON.parse(body_ ?? '{}')).toMatchObject({ error: { code: 'internal_error' } })
      expect(warnings.length).toBeGreaterThanOrEqual(1)
      await ctx.fiber.dispose()
    } finally {
      delete process.env.OPENKYLIN_AUTH_DISABLED
    }
  })
})
