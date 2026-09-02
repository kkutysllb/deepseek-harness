import { useEffect, useState, type ReactNode } from 'react'
import { isAuthError } from './auth-error.ts'
import type { AccountUpdate, AccountView, IAuthClient } from '@qilin/client-connection/client'
import type { PropsLocale } from '@qilin/client-ui-slots'
import css from './AccountsSettingsSection.module.css'

/** Registration-side face used by the section: the connection handle's auth client. */
export interface AccountsSettingsSectionInjected {
  /** The account/auth surface client (list and management calls). */
  auth: IAuthClient
}

/** Full component props assembled by the Settings section renderer (inject face composed flat). */
export type AccountsSettingsSectionProps =
  & PropsLocale<'settings.accounts'>
  & AccountsSettingsSectionInjected

/** What the section is showing. */
type SectionState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'forbidden' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly users: AccountView[] }

/** One row with a pending reset form. */
type ResetTarget = { readonly id: string } | null

/** Wire error code -> localized prose for management actions. */
function localizeActionError(error: unknown, t: AccountsSettingsSectionProps['t']): string {
  const code = isAuthError(error) ? error.code : 'unknown_error'
  if (code === 'self_protected') return t('errorSelfProtected')
  if (code === 'last_admin_protected') return t('errorLastAdmin')
  if (code === 'weak_password') return t('errorWeakPassword')
  if (code === 'forbidden') return t('adminRequired')
  return t('errorGeneric')
}

/**
 * The administrator account-management section: the account table plus the
 * per-row role/enable/reset actions. The server enforces every protection;
 * failures surface inline through the same localized codes.
 */
export function AccountsSettingsSection({ auth, t }: AccountsSettingsSectionProps): ReactNode {
  const [state, setState] = useState<SectionState>({ phase: 'loading' })
  const [resetTarget, setResetTarget] = useState<ResetTarget>(null)
  const [resetValue, setResetValue] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setState({ phase: 'loading' })
      try {
        const users = await auth.listUsers()
        if (!cancelled) setState({ phase: 'ready', users })
      } catch (error) {
        if (cancelled) return
        setState(isAuthError(error) && error.status === 403 ? { phase: 'forbidden' } : { phase: 'error' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [auth, attempt])

  const apply = async (id: string, update: AccountUpdate): Promise<void> => {
    /* v8 ignore next -- both invoking buttons are disabled while busy and browsers never deliver clicks to disabled controls */
    if (busy) return
    setBusy(true)
    setErrorText(null)
    try {
      const updated = await auth.updateUser(id, update)
      setState(current => (current.phase === 'ready'
        ? { phase: 'ready', users: current.users.map(user => (user.id === id ? updated : user)) }
        : current))
    } catch (error) {
      setErrorText(localizeActionError(error, t))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (id: string): Promise<void> => {
    /* v8 ignore next -- the confirm button is disabled while busy or empty, so the browser never dispatches that click */
    if (busy || resetValue === '') return
    setBusy(true)
    setErrorText(null)
    try {
      await auth.resetPassword(id, resetValue)
      setResetTarget(null)
      setResetValue('')
    } catch (error) {
      setErrorText(localizeActionError(error, t))
    } finally {
      setBusy(false)
    }
  }

  if (state.phase === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.phase === 'forbidden') return <p className={css.status}>{t('adminRequired')}</p>
  if (state.phase === 'error') {
    return (
      <div className={css.status}>
        <p>{t('errorGeneric')}</p>
        <button type="button" onClick={() => { setAttempt(attempt => attempt + 1) }}>{t('retry')}</button>
      </div>
    )
  }

  return (
    <div className={css.section}>
      {errorText !== null && <p className={css.error}>{errorText}</p>}
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('users')}</th>
            <th>{t('role')}</th>
            <th>{t('status')}</th>
            <th>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {state.users.map(user => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{user.systemRole === 'admin' ? t('roleAdmin') : t('roleUser')}</td>
              <td>{user.disabledAt === null ? t('enabled') : t('disabled')}</td>
              <td className={css.actions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void apply(user.id, { systemRole: user.systemRole === 'admin' ? 'user' : 'admin' }) }}
                >
                  {user.systemRole === 'admin' ? t('demote') : t('promote')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void apply(user.id, { disabled: user.disabledAt === null }) }}
                >
                  {user.disabledAt === null ? t('disable') : t('enable')}
                </button>
                <button type="button" disabled={busy} onClick={() => { setResetTarget(resetTarget?.id === user.id ? null : { id: user.id }) }}>
                  {t('resetPassword')}
                </button>
                {resetTarget?.id === user.id && (
                  <span className={css.resetRow}>
                    <input
                      className={css.resetInput}
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      placeholder={t('newPassword')}
                      value={resetValue}
                      onChange={(event) => { setResetValue(event.target.value) }}
                    />
                    <button type="button" disabled={busy || resetValue === ''} onClick={() => { void reset(user.id) }}>
                      {t('confirmReset')}
                    </button>
                    <button type="button" onClick={() => { setResetTarget(null); setResetValue('') }}>
                      {t('cancel')}
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.users.length === 0 && <p className={css.status}>{t('empty')}</p>}
    </div>
  )
}
