/**
 * The markdown renderer's two mdast grammars, one per rendering arm. Each
 * arm is internally consistent — the incremental tail parses, the one-shot
 * parses, and the plain-text projection of a given grammar always agree on
 * where blocks start and end — and the settled grammar is the streaming one
 * plus the math extensions, so the arms differ only where TeX delimiters
 * begin a math construct (a `$$` block is a paragraph while streaming and a
 * math block once settled, by design).
 *
 * Both arms feed their source through {@link sanitizeModelMarkdown} first,
 * a product-layer repair for model output that closes `**` or backticks on
 * a later line; the fix is in the parser pipeline (not at the message
 * boundary) so plain-text extraction and the streaming parser see the same
 * post-repair text the renderer paints.
 */

import type { Root } from 'mdast'
import { recoverLocalImages } from './local-image-syntax.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'
import { sanitizeModelMarkdown } from './modelSanitize.ts'

/**
 * Parse GFM markdown (the streaming arm's grammar: no math, so incomplete
 * TeX never flashes KaTeX errors mid-stream).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  // KCoder 合并：两侧各自包了一层，取并集且次序有语义——
  // 先 sanitizeModelMarkdown（我方：文本级修复模型输出的跨行 ** / 反引号），
  // 再 fromMarkdown 解析，最后 recoverLocalImages（上游 rc.1：树级恢复带空格的
  // 本地图片引用）。recoverLocalImages 要求 source 与解析树逐字对应（它用
  // source.slice(...) === child.value 来区分「作者原写」与「转义示例」），
  // 故必须传 sanitize 之后的文本——sanitize 会跨行合并、改变偏移。
  const source = sanitizeModelMarkdown(text)
  return recoverLocalImages(fromMarkdown(source, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  }), source)
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters
 * (the settled arm's grammar).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  // 同 parseGfm：sanitize → 解析 → recoverLocalImages，source 传 sanitize 后的文本。
  const source = sanitizeModelMarkdown(text)
  return recoverLocalImages(fromMarkdown(source, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  }), source)
}
