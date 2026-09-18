/**
 * Product-layer fallback for the two most common model-output markdown
 * malformations. Both repairs are safe: a `**` emphasis that closes on a
 * later line is invalid CommonMark anyway (the second `**` then renders as
 * literal asterisks), and an inline code span that contains a literal
 * newline cannot exist under the CommonMark grammar (the first newline ends
 * the code span, the rest is text). Joining the broken fragments onto one
 * line produces the same DOM as if the model had authored them on a single
 * line, without touching any correct markdown.
 *
 * The fix is scoped to a single inter-line newline on each side — a
 * pathological multi-newline split is left alone (the model almost never
 * writes one, and a narrower rule keeps false positives down).
 *
 * Fenced code blocks (``` or ~~~) are skipped so a code sample that happens
 * to contain `**foo\nbar**` keeps its original bytes. Indented (4-space)
 * code blocks are not specially tracked; model output rarely uses them and
 * the regex cannot match a 4-space-indented opener.
 */
export function sanitizeModelMarkdown(text: string): string {
  if (!text.includes('\n')) return text
  const lines = text.split('\n')
  const out: string[] = []
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let outside: string[] = []

  const flushOutside = (): void => {
    if (outside.length === 0) return
    out.push(sanitizeSegment(outside.join('\n')))
    outside = []
  }

  for (const line of lines) {
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)
    const marker = fenceMatch?.[1] ?? ''
    if (marker !== '') {
      const ch = marker[0] ?? '`'
      const len = marker.length
      if (!inFence) {
        flushOutside()
        out.push(line)
        inFence = true
        fenceChar = ch
        fenceLen = len
      } else if (ch === fenceChar && len >= fenceLen) {
        out.push(line)
        inFence = false
        fenceChar = ''
        fenceLen = 0
      } else {
        // Different fence char (or shorter same char) inside an open fence:
        // belongs to the code sample.
        out.push(line)
      }
    } else if (inFence) {
      out.push(line)
    } else {
      outside.push(line)
    }
  }
  flushOutside()
  return out.join('\n')
}

function sanitizeSegment(text: string): string {
  return text
    // Strong emphasis split across exactly one line break: **foo\nbar** -> **foo bar**
    .replace(/\*\*([^*\n]+)\n([^*\n]+)\*\*/g, '**$1 $2**')
    // Inline code split across exactly one line break: `foo\nbar` -> `foo bar`
    .replace(/`([^`\n]+)\n([^`\n]+)`/g, '`$1 $2`')
}
