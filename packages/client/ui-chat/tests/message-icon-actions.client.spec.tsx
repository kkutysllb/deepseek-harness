// @vitest-environment jsdom
/**
 * The message icon row's optional edit control: present only when the owner
 * supplies an edit callback, and it invokes that callback with the message
 * text when clicked (the transcript bubble "edit and resend" entry).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

const renderActions = (props: Partial<Parameters<typeof MessageIconActions>[0]> = {}) => render(
  <MessageIconActions text="hello world" clock="start" t={t} {...props} />,
)

describe('MessageIconActions edit control', () => {
  it('renders no edit button without an edit callback', () => {
    const view = renderActions()
    expect(view.queryByRole('button', { name: t('message.edit') })).toBeNull()
  })

  it('renders an edit button when an edit callback is supplied and invokes it on click', () => {
    const onEdit = vi.fn()
    const view = renderActions({ onEdit })
    const edit = view.getByRole('button', { name: t('message.edit') })
    expect(edit.querySelector('svg')).not.toBeNull()
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps copy available beside the edit control', () => {
    const view = renderActions({ onEdit: vi.fn() })
    expect(view.getByRole('button', { name: t('copy') })).not.toBeNull()
  })
})
