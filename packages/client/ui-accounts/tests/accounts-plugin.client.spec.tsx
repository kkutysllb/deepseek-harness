// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@qilin/client-locale/client'
import { SlotRegistry } from '@qilin/client-runtime/client'
import { resolveSlotLabel } from '@qilin/client-ui-slots'
import { usePinnedBrowserLanguages } from '@qilin/client-test-runtime'
import type { IAuthClient } from '@qilin/client-connection/client'
import { apply, inject, NS_OVERLAY, NS_SECTION } from '../src/client/index.ts'
import { AccountOverlay } from '../src/client/AccountOverlay.tsx'
import { AccountsSettingsSection } from '../src/client/AccountsSettingsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const auth: IAuthClient = {
  me: () => Promise.reject(new Error('unused')),
  setupStatus: () => Promise.reject(new Error('unused')),
  login: () => Promise.reject(new Error('unused')),
  initialize: () => Promise.reject(new Error('unused')),
  logout: () => Promise.reject(new Error('unused')),
  changePassword: () => Promise.reject(new Error('unused')),
  listUsers: () => Promise.reject(new Error('unused')),
  updateUser: () => Promise.reject(new Error('unused')),
  resetPassword: () => Promise.reject(new Error('unused')),
  onUnauthorized: () => () => {},
}

async function bench(): Promise<{ ctx: Context; slots: SlotRegistry; locale: LocaleRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('connection', { auth, onUnauthorized: () => () => {} })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-accounts browser plugin', () => {
  it('declares only the services the account surface consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the overlay and the localized accounts section without touching auth eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const overlay = b.slots.entries('shell.overlay')[0]!
    expect(overlay.component).toBe(AccountOverlay)
    expect(overlay.options).toMatchObject({ id: 'account', order: -100 })
    type OverlayFace = { auth: IAuthClient; onUnauthorized: (listener: () => void) => () => void }
    const overlayInjected = (overlay.inject as unknown as () => OverlayFace)()
    expect(overlayInjected.auth).toBe(auth)
    expect(overlayInjected.onUnauthorized(() => {})).toBeTypeOf('function')

    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(AccountsSettingsSection)
    expect(section.options).toMatchObject({ id: 'accounts' })
    expect(resolveSlotLabel(section.options.label)).toBe('账户管理')
    const sectionInjected = (section.inject as unknown as () => { auth: IAuthClient })()
    expect(sectionInjected.auth).toBe(auth)
    expect(section.locale).toBe(NS_SECTION)
    expect(overlay.locale).toBe(NS_OVERLAY)
    expect(NS_OVERLAY).toBe('shell.account')
    await b.ctx.fiber.dispose()
  })
})
