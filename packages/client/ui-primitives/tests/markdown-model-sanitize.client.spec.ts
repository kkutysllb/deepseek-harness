// Product-layer fallback for the two most common model-output markdown
// malformations: `**` strong emphasis or backtick code spans that close on
// a later line. Both end up rendering as broken DOM (a stray strong open
// loses its body across the break; an inline code with a literal newline
// cannot even be a CommonMark code span). Joining the broken fragments
// onto one line yields the same DOM as if the model had authored them on a
// single line. Fenced code blocks are skipped so a code sample that happens
// to contain `**foo\nbar**` keeps its original bytes.
import { describe, expect, it } from 'vitest'
import { sanitizeModelMarkdown } from '../src/markdown/modelSanitize.ts'

describe('sanitizeModelMarkdown', () => {
  it('passes text without newlines through unchanged', () => {
    const text = '**foo** and `bar` and `**baz qux**`.'
    expect(sanitizeModelMarkdown(text)).toBe(text)
  })

  it('joins strong emphasis split across exactly one line break', () => {
    expect(sanitizeModelMarkdown('**foo\nbar**')).toBe('**foo bar**')
  })

  it('joins inline code split across exactly one line break', () => {
    expect(sanitizeModelMarkdown('`foo\nbar`')).toBe('`foo bar`')
  })

  it('leaves multi-line emphasis alone (too pathological to guess)', () => {
    const text = '**foo\nbar\nbaz**'
    expect(sanitizeModelMarkdown(text)).toBe(text)
  })

  it('leaves emphasis with a blank line in between alone', () => {
    const text = '**foo**\n\n**bar**'
    expect(sanitizeModelMarkdown(text)).toBe(text)
  })

  it('leaves single-line emphasis alone', () => {
    const text = 'a **strong** word and `inline` here'
    expect(sanitizeModelMarkdown(text)).toBe(text)
  })

  it('joins one broken emphasis and leaves an unrelated correct emphasis alone', () => {
    expect(sanitizeModelMarkdown('**correct** and **broken\nemphasis**')).toBe('**correct** and **broken emphasis**')
  })

  it('reaches the markdown inside a fenced code block but never rewrites it', () => {
    const fenced = ['```', '**foo', 'bar**', '`baz', 'qux`', '```'].join('\n')
    expect(sanitizeModelMarkdown(fenced)).toBe(fenced)
  })

  it('handles a leading fenced code block before broken markdown', () => {
    const fenced = ['```js', 'const x = 1', '```', '', '**broken', 'emphasis**'].join('\n')
    const expected = ['```js', 'const x = 1', '```', '', '**broken emphasis**'].join('\n')
    expect(sanitizeModelMarkdown(fenced)).toBe(expected)
  })

  it('matches a tilde-fenced code block and skips its content', () => {
    const fenced = ['~~~md', '**foo', 'bar**', '~~~', '', '`broken', 'code`'].join('\n')
    const expected = ['~~~md', '**foo', 'bar**', '~~~', '', '`broken code`'].join('\n')
    expect(sanitizeModelMarkdown(fenced)).toBe(expected)
  })

  it('does not treat a shorter same-char fence as a closer', () => {
    const fenced = ['````', '**foo', 'bar**', '```', 'still inside', '````'].join('\n')
    // The 3-backtick line is content inside the 4-backtick fence, not a close.
    expect(sanitizeModelMarkdown(fenced)).toBe(fenced)
  })

  it('handles a closing fence that has the same char but is longer than the opener', () => {
    const fenced = ['```', 'inside', '````', '**broken', 'emphasis**'].join('\n')
    const expected = ['```', 'inside', '````', '**broken emphasis**'].join('\n')
    expect(sanitizeModelMarkdown(fenced)).toBe(expected)
  })
})
