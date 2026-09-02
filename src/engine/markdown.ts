import {
  NodeHtmlMarkdown,
  type NodeHtmlMarkdownOptions,
} from "node-html-markdown";

/**
 * HTML→Markdown options tuned for LLM retrieval rather than for rendering.
 *
 * - `useInlineLinks` / no `useLinkReferenceDefinitions`: keep links inline as
 *   `[text](url)`. Reference-style links park every URL at the bottom of the
 *   document, which is fine for a whole page but breaks once we split into
 *   chunks — a middle chunk would carry `[text][3]` with its definition stranded
 *   in a different chunk. Inline links keep every chunk self-contained.
 * - `keepDataImages: false`: drop `data:` URIs. A single inlined image can be
 *   ~1MB of base64 that carries no semantic signal and would wreck embeddings.
 * - `ignore`: strip non-content tags outright so their noise never reaches the
 *   Markdown (script/style are skipped by default; svg/symbol/iframe/noscript are
 *   not). `svg` drops SVG subtrees, but `symbol` is listed too so stray sprite
 *   definitions hoisted out of an `<svg>` are still dropped.
 * - No `preferNativeParser`: leave it at the default (`false`) so parsing always
 *   uses `node-html-parser`. Setting it `true` asks the library to parse with the
 *   browser DOM first, but server-side there is no `window.DOMParser`; the
 *   library's native-parser probe then returns `undefined` without throwing and
 *   never wires up the fallback, so the very next call crashes with
 *   `nodeHtmlParse is not a function`. The default parser honours `ignore` fully.
 * - `bulletMarker: '-'`: the conventional Markdown list marker LLMs expect.
 * - `maxConsecutiveNewlines: 2`: at most one blank line between blocks.
 */
const HTML_TO_MARKDOWN_OPTIONS: Partial<NodeHtmlMarkdownOptions> = {
  useInlineLinks: true,
  useLinkReferenceDefinitions: false,
  keepDataImages: false,
  bulletMarker: "-",
  maxConsecutiveNewlines: 2,
  ignore: ["script", "style", "noscript", "iframe", "svg", "symbol", "form"],
};

/**
 * A single reusable translator instance. The library's docs are explicit that
 * constructing an instance once and reusing it is markedly faster than the
 * static `NodeHtmlMarkdown.translate()` (which rebuilds the translator tables on
 * every call) — and the scraper converts a page on every invocation.
 */
const translator = new NodeHtmlMarkdown(HTML_TO_MARKDOWN_OPTIONS);

/**
 * Convert raw HTML into clean Markdown tuned for embedding. Non-content tags are
 * dropped, tags become Markdown structure, links stay inline, and trailing
 * whitespace is trimmed. Plain text (no tags) passes through unchanged.
 */
export function htmlToMarkdown(html: string): string {
  return translator.translate(html).trim();
}
