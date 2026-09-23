/**
 * Plugin manager, browser half: the **Plugins** entry of the sidebar and the
 * management page it opens in the main column. The page installs, enables,
 * disables, and removes the bundles of the Host's profile through the
 * `pluginManager` Remote and switches their rows in the profile's user layer.
 * A plugin that carries its own configuration renders it on this page through
 * the slots the page declares (`slot-contract.ts`).
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the root `main` keyed slot the page registers into, declared by
// ui-layout with the panel id brand, and the `sidebar.panellist` list the
// entry registers into, declared by ui-sidebar.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the forwarded events' own declaration (`$on`'s key face resolves
// through the owning package's client-safe types subpath).
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { PluginManagerPage } from './PluginManagerPage.tsx'
import { PluginsPanelIcon } from './PluginsPanelIcon.tsx'
import { configLedgerSource } from './config-ledger.ts'
import { PluginManagerController } from './manager-store.ts'
import { en, zh, type PluginManagerLocaleKey } from './locales.ts'
import type {} from './slot-contract.ts'

export type { PluginManagerPageProps } from './PluginManagerPage.tsx'
export type { ConfigLedger, OfficialItem } from './config-ledger.ts'
export type { PluginManagerFace } from './manager-store.ts'
export type { PluginManagerLocaleKey } from './locales.ts'
export type {
  ConfigPageForm, PluginActivationOwnerProps, PluginConfigViewProps, PluginDetailProps, PluginPackageRef, PluginRowRef, PluginsSubject,
} from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin manager tab copy. */
    'pluginManager': PluginManagerLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginManager'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'plugins' as MainPanelId

/** Services required by the sidebar registration and the Remote methods; the inventory says whether the Host manages a profile. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'remote.pluginInventory', 'remote.pluginRegistryProbe', 'configForms']

/**
 * Contribute the Plugins entry to the sidebar with the management page it
 * opens, and keep it current on the Host's change events.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new PluginManagerController(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-plugin-manager: controller')
  // The Host says when what is installed, enabled, or composed changed — from
  // this page, the CLI, or another browser — and streams install output.
  ctx.effect(() => {
    // A page never rendered holds no snapshot to refresh.
    const refresh = (): void => {
      if (controller.getSnapshot().status !== 'idle') void controller.load()
    }
    const disposers = [
      ctx.remote.$on('plugin-manager/changed', refresh),
      ctx.remote.$on('plugin-manager/install-log', (chunk) => { controller.appendLog(chunk) }),
      ctx.remote.$on('plugin-manager/install-state', (progress) => { controller.installProgress(progress) }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-plugin-manager: host invalidations')

  // The page is a global panel: it belongs to the profile, not to a Session,
  // and the sidebar's entry selects it. What is installed and switched on is
  // the page's own; a plugin's configuration arrives through the slots the
  // page declares here, so the page never names a configurable plugin.
  const configLedger = configLedgerSource(ctx)
  // KCoder: the page renders in two places (the sidebar panel and a Plugins
  // settings tab), so its child table is declared once here and reused.
  const pageChildren = {
    'plugins.item': { kind: 'list', scope: 'root' },
    'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    'plugins.row.config': { kind: 'keyed', scope: 'root' },
    'plugins.detail.actions': { kind: 'list', scope: 'root' },
    'plugins.detail.badge': { kind: 'list', scope: 'root' },
    'plugins.detail.section': { kind: 'list', scope: 'root' },
  } as const
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => controller.inject(configLedger, text => ctx.locale.resolveText(text)),
    children: pageChildren,
  }, PluginManagerPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 0,
    label: () => t('panel'),
    locale: NS,
  }, PluginsPanelIcon))
  // KCoder product decision (2026-09-18): the Plugins settings section carries
  // two tabs — the read-only inventory and this management page. The page is
  // the component the sidebar panel above renders, so the official-plugin
  // configuration cards appear in Settings exactly as they do in the panel.
  //
  // The settings tab SHARES the panel's child table rather than declaring its
  // own: `rendersExistingChildren` grants this entry the render face for the
  // same keys while the panel's entry stays their lifecycle owner — one slot,
  // one declarer, the invariant ui-slots keeps. Repeating the table without
  // that option throws "already declared"; omitting the table leaves the
  // component without its `renderSlot` share, which is why the type layer
  // insists on it. The cast below only erases the children-tuple identity the
  // type layer derives from the literal: the options and the component are
  // exactly what the sidebar entry registers.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
    {
      name: 'settings.plugins.tab',
      id: 'manage',
      order: 20,
      label: () => t('settingsTab'),
      locale: NS,
      inject: () => controller.inject(configLedger, text => ctx.locale.resolveText(text)),
      children: pageChildren,
      rendersExistingChildren: true,
    } as never,
    PluginManagerPage as never,
  ))
}
