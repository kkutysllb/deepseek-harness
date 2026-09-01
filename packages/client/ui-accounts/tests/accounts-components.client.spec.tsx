// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError, UnauthorizedSignal, type AccountView, type IAuthClient } from '@qilin/client-connection/client'
import { en as commonEn } from '@qilin/client-locale/src/locales/en.ts'
import { makeTranslate } from '@qilin/client-test-runtime'
import { AccountOverlay } from '../src/client/AccountOverlay.tsx'
import { AccountsSettingsSection } from '../src/client/AccountsSettingsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: Parameters<typeof AccountOverlay>[0]['t'] = makeTranslate(en, commonEn)
const sectionT: Parameters<typeof AccountsSettingsSection>[0]['t'] = makeTranslate(en, commonEn)

function user(id: string, email: string, systemRole: 'admin' | 'user', disabledAt: number | null = null): AccountView {
  return {
    id,
    email,
    systemRole,
    needsSetup: false,
    oauthProvider: null,
    oauthId: null,
    sessionVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    disabledAt,
  }
}

/** One fake auth client over plain vi.fn properties plus a live 401 signal. */
function fakeAuth(overrides: Partial<IAuthClient> = {}) {
  const signal = new UnauthorizedSignal()
  return {
    me: vi.fn(async () => user('a1', 'admin@qilin.dev', 'admin')),
    setupStatus: vi.fn(async () => ({ needsSetup: false, registrationEnabled: false })),
    login: vi.fn(async () => ({ user: user('a1', 'admin@qilin.dev', 'admin'), accessToken: 'tok' })),
    initialize: vi.fn(async () => ({ user: user('a1', 'admin@qilin.dev', 'admin'), accessToken: 'tok' })),
    logout: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    listUsers: vi.fn(async () => [] as AccountView[]),
    updateUser: vi.fn(async () => user('u1', 'user@qilin.dev', 'user')),
    resetPassword: vi.fn(async () => user('u1', 'user@qilin.dev', 'user')),
    onUnauthorized: (listener: (error: AuthError) => void) => signal.subscribe(listener),
    signal,
    ...overrides,
  }
}

describe('AccountOverlay', () => {
  it('renders nothing while deciding and after a signed-in probe', async () => {
    const auth = fakeAuth()
    const view = render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    expect(screen.queryByRole('heading')).toBeNull()
    await waitFor(() => { expect(auth.me).toHaveBeenCalledTimes(1) })
    expect(view.container.querySelector('[data-account-overlay]')).toBeNull()
  })

  it('shows only the initialize form on a fresh installation', async () => {
    const auth = fakeAuth({ setupStatus: vi.fn(async () => ({ needsSetup: true, registrationEnabled: false })) })
    render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    const heading = await screen.findByRole('heading', { name: en.overlayInitializing })
    expect(heading).toBeTruthy()
    expect(screen.queryByText(en.rememberMe)).toBeNull()
    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'boot-strap-1' } })
    fireEvent.input(screen.getByLabelText(en.email), { target: { value: 'root@qilin.dev' } })
    fireEvent.click(screen.getByRole('button', { name: en.initialize }))
    await waitFor(() => { expect(auth.initialize).toHaveBeenCalledWith('root@qilin.dev', 'boot-strap-1', true) })
  })

  it('shows the sign-in form when anonymous and hides it after login', async () => {
    const auth = fakeAuth({ me: vi.fn(async () => { throw new AuthError(401, 'not_authenticated', 'no') }) })
    const view = render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await screen.findByRole('heading', { name: en.overlayTitle })
    fireEvent.input(screen.getByLabelText(en.email), { target: { value: 'admin@qilin.dev' } })
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    await waitFor(() => { expect(auth.login).toHaveBeenCalledWith('admin@qilin.dev', 'password-1', false) })
    expect(view.container.querySelector('[data-account-overlay]')).toBeNull()
  })

  it('flips back to sign-in with a notice when the 401 signal fires', async () => {
    const auth = fakeAuth()
    render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await waitFor(() => { expect(auth.me).toHaveBeenCalledTimes(1) })
    act(() => { auth.signal.emit(new AuthError(401, 'not_authenticated', 'expired')) })
    expect(await screen.findByRole('heading', { name: en.overlayTitle })).toBeTruthy()
    expect(screen.getByText(en.signedOutNotice)).toBeTruthy()
  })

  it('lands on sign-in when the status probe fails but the session probe succeeds', async () => {
    const auth = fakeAuth({ setupStatus: vi.fn(async () => { throw new AuthError(500, 'internal_error', 'down') }) })
    const view = render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await waitFor(() => { expect(view.container.querySelector('[data-account-overlay]')).toBeNull() })
    expect(auth.setupStatus).toHaveBeenCalledTimes(1)
    expect(auth.me).toHaveBeenCalledTimes(1)
  })

  it('keeps the initialize form when the 401 signal fires before any session', async () => {
    const auth = fakeAuth({ setupStatus: vi.fn(async () => ({ needsSetup: true, registrationEnabled: false })) })
    render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await screen.findByRole('heading', { name: en.overlayInitializing })
    act(() => { auth.signal.emit(new AuthError(401, 'not_authenticated', 'no')) })
    expect(screen.getByRole('heading', { name: en.overlayInitializing })).toBeTruthy()
  })

  it('maps weak passwords and initialize failures to their localized prose', async () => {
    const auth = fakeAuth({
      setupStatus: vi.fn(async () => ({ needsSetup: true, registrationEnabled: false })),
      initialize: vi.fn(async (_email: string, password: string) => {
        if (password.length < 8) throw new AuthError(400, 'weak_password', 'short')
        throw new AuthError(500, 'system_already_initialized', 'done')
      }),
    })
    render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await screen.findByRole('heading', { name: en.overlayInitializing })
    fireEvent.input(screen.getByLabelText(en.email), { target: { value: 'root@qilin.dev' } })
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: en.initialize }))
    expect(await screen.findByText(en.errorWeakPassword)).toBeTruthy()
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'long-enough-1' } })
    fireEvent.click(screen.getByRole('button', { name: en.initialize }))
    expect(await screen.findByText(en.initializeError)).toBeTruthy()
  })

  it('stays quiet when unmounted mid-probe and on post-unmount 401', async () => {
    const deferred = Promise.withResolvers<{ needsSetup: boolean; registrationEnabled: boolean }>()
    const listeners: Array<(error: AuthError) => void> = []
    const auth = fakeAuth({ setupStatus: () => deferred.promise })
    const view = render(<AccountOverlay auth={auth} onUnauthorized={(listener) => { listeners.push(listener); return () => {} }} t={t} />)
    view.unmount()
    await act(async () => {
      deferred.resolve({ needsSetup: true, registrationEnabled: false })
      listeners.forEach(listener => listener(new AuthError(401, 'not_authenticated', 'late')))
    })
    expect(view.container.querySelector('[data-account-overlay]')).toBeNull()
  })

  it('latches re-entry within one submit and toggles rememberMe through to login', async () => {
    const deferred = Promise.withResolvers<{ user: AccountView; accessToken: string }>()
    const login = vi.fn(() => deferred.promise)
    const auth = fakeAuth({ me: vi.fn(async () => { throw new AuthError(401, 'not_authenticated', 'no') }), login })
    const view = render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await screen.findByRole('heading', { name: en.overlayTitle })
    fireEvent.input(screen.getByLabelText(en.email), { target: { value: 'admin@qilin.dev' } })
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('checkbox'))
    const form = view.container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => { expect(auth.login).toHaveBeenCalledTimes(1) })
    expect(auth.login).toHaveBeenCalledWith('admin@qilin.dev', 'password-1', true)
    await waitFor(() => { expect(screen.getByText(en.signingIn)).toBeTruthy() })
    await act(async () => { deferred.resolve({ user: user('a1', 'admin@qilin.dev', 'admin'), accessToken: 'tok' }) })
  })

  it('maps a weak password on sign-in and ignores a second submit while busy', async () => {
    const deferred = Promise.withResolvers<{ user: AccountView; accessToken: string }>()
    const login = vi.fn(async (_email: string, password: string) => {
      if (password.length < 8) throw new AuthError(400, 'weak_password', 'short')
      return deferred.promise
    })
    const auth = fakeAuth({ me: vi.fn(async () => { throw new AuthError(401, 'not_authenticated', 'no') }), login })
    render(<AccountOverlay auth={auth} onUnauthorized={listener => auth.signal.subscribe(listener)} t={t} />)
    await screen.findByRole('heading', { name: en.overlayTitle })
    fireEvent.input(screen.getByLabelText(en.email), { target: { value: 'admin@qilin.dev' } })
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(await screen.findByText(en.errorWeakPassword)).toBeTruthy()
    fireEvent.input(screen.getByLabelText(en.password), { target: { value: 'password-1' } })
    const button = screen.getByRole('button', { name: en.signIn })
    login.mockClear()
    fireEvent.click(button)
    await waitFor(() => { expect(button.hasAttribute('disabled')).toBe(true) })
    fireEvent.click(button)
    await act(async () => { deferred.resolve({ user: user('a1', 'admin@qilin.dev', 'admin'), accessToken: 'tok' }) })
    expect(login).toHaveBeenCalledTimes(1)
    expect(auth.login).toHaveBeenCalledTimes(1)
  })
})

describe('AccountsSettingsSection', () => {
  it('renders the users table and applies a role toggle through updateUser', async () => {
    const users = [user('a1', 'admin@qilin.dev', 'admin'), user('u1', 'user@qilin.dev', 'user')]
    const auth = fakeAuth({ listUsers: vi.fn(async () => users), updateUser: vi.fn(async () => user('u1', 'user@qilin.dev', 'admin')) })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    await screen.findByText('user@qilin.dev')
    const promote = screen.getAllByRole('button', { name: en.promote })[0]!
    fireEvent.click(promote)
    await waitFor(() => { expect(auth.updateUser).toHaveBeenCalledWith('u1', { systemRole: 'admin' }) })
  })

  it('surfaces localized protection failures inline', async () => {
    const users = [user('a1', 'admin@qilin.dev', 'admin')]
    const auth = fakeAuth({
      listUsers: vi.fn(async () => users),
      updateUser: vi.fn(async () => { throw new AuthError(409, 'last_admin_protected', 'no') }),
    })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    await screen.findByText('admin@qilin.dev')
    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    await screen.findByText(en.errorLastAdmin)
  })

  it('resets a password through the inline confirm row', async () => {
    const users = [user('u1', 'user@qilin.dev', 'user')]
    const auth = fakeAuth({ listUsers: vi.fn(async () => users), resetPassword: vi.fn(async () => users[0]!) })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    await screen.findByText('user@qilin.dev')
    fireEvent.click(screen.getByRole('button', { name: en.resetPassword }))
    fireEvent.input(screen.getByPlaceholderText(en.newPassword), { target: { value: 'fresh-pass-99' } })
    fireEvent.click(screen.getByRole('button', { name: en.confirmReset }))
    await waitFor(() => { expect(auth.resetPassword).toHaveBeenCalledWith('u1', 'fresh-pass-99') })
  })

  it('shows the administrator-required state on 403', async () => {
    const auth = fakeAuth({ listUsers: vi.fn(async () => { throw new AuthError(403, 'forbidden', 'no') }) })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    expect(await screen.findByText(en.adminRequired)).toBeTruthy()
  })

  it('re-enables a disabled account and renders the empty table state', async () => {
    const disabled = user('u2', 'off@qilin.dev', 'user', Date.now())
    const auth = fakeAuth({
      listUsers: vi.fn(async () => [disabled]),
      updateUser: vi.fn(async () => user('u2', 'off@qilin.dev', 'user', null)),
    })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    await screen.findByText('off@qilin.dev')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    await waitFor(() => { expect(auth.updateUser).toHaveBeenCalledWith('u2', { disabled: false }) })
    const empty = fakeAuth({ listUsers: vi.fn(async () => []) })
    render(<AccountsSettingsSection auth={empty} t={sectionT} />)
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('surfaces generic update failures and retries after a transient list failure', async () => {
    const users = [user('u1', 'user@qilin.dev', 'user')]
    const listUsers = vi.fn()
      .mockRejectedValueOnce(new AuthError(500, 'internal_error', 'down'))
      .mockResolvedValueOnce(users)
    const auth = fakeAuth({
      listUsers,
      updateUser: vi.fn(async () => { throw new AuthError(500, 'internal_error', 'boom') }),
    })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    expect(await screen.findByText(en.errorGeneric)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByText('user@qilin.dev')
    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    expect(await screen.findByText(en.errorGeneric)).toBeTruthy()
  })

  it('maps reset failures inline and clears the confirm row on cancel', async () => {
    const users = [user('u1', 'user@qilin.dev', 'user')]
    const auth = fakeAuth({
      listUsers: vi.fn(async () => users),
      resetPassword: vi.fn(async () => { throw new AuthError(400, 'weak_password', 'short') }),
    })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    await screen.findByText('user@qilin.dev')
    fireEvent.click(screen.getByRole('button', { name: en.resetPassword }))
    fireEvent.input(screen.getByPlaceholderText(en.newPassword), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: en.confirmReset }))
    expect(await screen.findByText(en.errorWeakPassword)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByPlaceholderText(en.newPassword)).toBeNull()
  })

  it('lands on the generic error state for non-auth failures and stays quiet after unmount', async () => {
    const deferred = Promise.withResolvers<AccountView[]>()
    const auth = fakeAuth({ listUsers: () => deferred.promise })
    const view = render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    view.unmount()
    await act(async () => { deferred.reject(new Error('transport down')) })
    expect(view.container.querySelector('table')).toBeNull()
  })

  it('guards the confirm row against an empty value and double-submits while busy', async () => {
    const deferred = Promise.withResolvers<AccountView>()
    const users = [user('u1', 'user@qilin.dev', 'user')]
    const resetPassword = vi.fn((_id: string, password: string) => password.length < 8
      ? Promise.reject(new AuthError(400, 'weak_password', 'short'))
      : deferred.promise)
    const auth = fakeAuth({ listUsers: vi.fn(async () => users), resetPassword })
    render(<AccountsSettingsSection auth={auth} t={sectionT} />)
    await screen.findByText('user@qilin.dev')
    fireEvent.click(screen.getByRole('button', { name: en.resetPassword }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmReset }))
    expect(resetPassword).not.toHaveBeenCalled()
    fireEvent.input(screen.getByPlaceholderText(en.newPassword), { target: { value: 'fresh-pass-99' } })
    fireEvent.click(screen.getByRole('button', { name: en.confirmReset }))
    await waitFor(() => { expect(resetPassword).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: en.confirmReset }))
    await act(async () => { deferred.resolve(users[0]!) })
    expect(resetPassword).toHaveBeenCalledTimes(1)
  })
})
