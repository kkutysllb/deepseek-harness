/** Account surface: shell sign-in/initialize overlay and the accounts settings section. */

import type {} from '@qilin/client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@qilin/client-connection/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots) merge through the Client assembly boundary.
import type {} from '@qilin/client-ui-renderer/client'
import type {} from '@qilin/client-ui-layout/client'
import type {} from '@qilin/client-ui-settings/client'
import { AccountOverlay, type AccountOverlayInjected } from './AccountOverlay.tsx'
import { AccountsSettingsSection, type AccountsSettingsSectionInjected } from './AccountsSettingsSection.tsx'
import { en, zh, type AccountsLocaleKey } from './locales.ts'

export type { AccountOverlayInjected, AccountOverlayProps } from './AccountOverlay.tsx'
export type { AccountsSettingsSectionInjected, AccountsSettingsSectionProps } from './AccountsSettingsSection.tsx'
export type { AccountsLocaleKey } from './locales.ts'

declare module '@qilin/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell account overlay copy. */
    'shell.account': AccountsLocaleKey
    /** Administrator account-management section copy. */
    'settings.accounts': AccountsLocaleKey
  }
}

/** Dictionary namespaces owned by this plugin. */
export const NS_OVERLAY = 'shell.account'
export const NS_SECTION = 'settings.accounts'

/** Services required by the overlay and Settings registration. */
export const inject = ['slots', 'locale', 'connection']

/** Contribute the account overlay and the accounts settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS_OVERLAY, { zh, en }), 'ui-accounts: overlay dictionaries')
  ctx.effect(() => ctx.locale.register(NS_SECTION, { zh, en }), 'ui-accounts: section dictionaries')

  const handleOf = (): ConnectionHandle => ctx.get('connection') as ConnectionHandle
  const overlayInjected = (): AccountOverlayInjected => ({
    auth: handleOf().auth,
    onUnauthorized: (listener: Parameters<ConnectionHandle['onUnauthorized']>[0]) => handleOf().onUnauthorized(listener),
  })
  const sectionInjected = (): AccountsSettingsSectionInjected => ({ auth: handleOf().auth })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'account',
    order: -100,
    label: 'account',
    locale: NS_OVERLAY,
    inject: overlayInjected,
  }, AccountOverlay))

  const sectionT = ctx.locale.bind(NS_SECTION)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'accounts',
    order: 90,
    label: () => sectionT('tab'),
    locale: NS_SECTION,
    inject: sectionInjected,
  }, AccountsSettingsSection))
}
