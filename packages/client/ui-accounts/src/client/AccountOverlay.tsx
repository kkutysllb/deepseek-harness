import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { isAuthError } from './auth-error.ts'
import type { AuthError, IAuthClient } from '@qilin/client-connection/client'
import type { PropsLocale } from '@qilin/client-ui-slots'
import css from './AccountOverlay.module.css'

/** Registration-side face used by the overlay: the connection handle's auth surface. */
export interface AccountOverlayInjected {
  /** The account/auth surface client (probe, sign-in, initialize). */
  auth: IAuthClient
  /** Subscribe to the handle's shared 401 signal (returns the disposer). */
  onUnauthorized: (listener: (error: AuthError) => void) => () => void
}

/** Full component props assembled by the overlay slot renderer (inject face composed flat). */
export type AccountOverlayProps =
  & PropsLocale<'shell.account'>
  & AccountOverlayInjected

/** What the overlay is showing while it decides or waits. */
type OverlayState =
  | { readonly phase: 'deciding' }
  | { readonly phase: 'signed-in' }
  | { readonly phase: 'sign-in'; readonly notice: boolean; readonly error: string | null }
  | { readonly phase: 'initialize'; readonly error: string | null }

/**
 * The shell account overlay: blocks the app until a session exists. On mount
 * it probes the session (me()); a fresh installation (needsSetup) shows only
 * the deterministic administrator initialize form, an anonymous visitor sees
 * the sign-in form, and an authenticated user sees nothing. The shared 401
 * signal flips a signed-in overlay back to the sign-in form with a session-
 * ended notice.
 */
export function AccountOverlay({ auth, onUnauthorized, t }: AccountOverlayProps): ReactNode {
  const emailId = useId()
  const passwordId = useId()
  const [state, setState] = useState<OverlayState>({ phase: 'deciding' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Render-independent re-entry latch: state updates lag the click loop. */
  const pending = useRef(false)

  useEffect(() => {
    let cancelled = false
    const probe = async (): Promise<void> => {
      try {
        const status = await auth.setupStatus()
        if (cancelled) return
        if (status.needsSetup) {
          setState({ phase: 'initialize', error: null })
          return
        }
      } catch {
        // A failed status probe (transient) still lands on sign-in; the next
        // login attempt re-learns the truth from the server.
      }
      try {
        await auth.me()
        if (!cancelled) setState({ phase: 'signed-in' })
      } catch {
        if (!cancelled) setState({ phase: 'sign-in', notice: false, error: null })
      }
    }
    void probe()
    const offUnauthorized = onUnauthorized(() => {
      if (cancelled) return
      setState(current => (current.phase === 'deciding' || current.phase === 'initialize'
        ? current
        : { phase: 'sign-in', notice: current.phase === 'signed-in', error: null }))
    })
    return () => {
      cancelled = true
      offUnauthorized()
    }
  }, [auth, onUnauthorized])

  const initializing = state.phase === 'initialize'
  const submit = async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      if (initializing) {
        await auth.initialize(email, password, true)
        setState({ phase: 'signed-in' })
        return
      }
      await auth.login(email, password, rememberMe)
      setState({ phase: 'signed-in' })
    } catch (error) {
      const message = submitErrorMessage(error, initializing, t)
      setState(initializing ? { phase: 'initialize', error: message } : { phase: 'sign-in', notice: false, error: message })
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  if (state.phase === 'deciding' || state.phase === 'signed-in') return null
  const error = state.error
  return (
    <div className={css.backdrop} data-account-overlay="">
      <form
        className={css.card}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h1 className={css.title}>{initializing ? t('overlayInitializing') : t('overlayTitle')}</h1>
        {state.phase === 'sign-in' && state.notice && <p className={css.notice}>{t('signedOutNotice')}</p>}
        <label className={css.label} htmlFor={emailId}>{t('email')}</label>
        <input
          id={emailId}
          className={css.input}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => { setEmail(event.target.value) }}
        />
        <label className={css.label} htmlFor={passwordId}>{t('password')}</label>
        <input
          id={passwordId}
          className={css.input}
          type="password"
          autoComplete={initializing ? 'new-password' : 'current-password'}
          required
          minLength={8}
          value={password}
          onChange={(event) => { setPassword(event.target.value) }}
        />
        {!initializing && (
          <label className={css.checkbox}>
            <input type="checkbox" checked={rememberMe} onChange={(event) => { setRememberMe(event.target.checked) }} />
            {t('rememberMe')}
          </label>
        )}
        {error !== null && <p className={css.error}>{error}</p>}
        <button className={css.submit} type="submit" disabled={busy || email === '' || password === ''}>
          {busy ? t('signingIn') : initializing ? t('initialize') : t('signIn')}
        </button>
      </form>
    </div>
  )
}

/** Localize one submit failure; initialize prose covers every initialize-phase failure. */
function submitErrorMessage(
  error: unknown,
  initializing: boolean,
  t: (key: 'overlayError' | 'initializeError' | 'errorWeakPassword') => string,
): string {
  const code = isAuthError(error) ? error.code : 'unknown_error'
  if (code === 'weak_password') return t('errorWeakPassword')
  if (initializing) return t('initializeError')
  return t('overlayError')
}
