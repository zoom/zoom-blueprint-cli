// Convert standard/Claude Markdown into the subset Zoom Chat actually renders.
//
// Zoom supports (with is_markdown_support: true at the root of the send body):
//   **bold**, _italic_, ~strike~, `code`, > blockquote, <https://url> links.
// Zoom does NOT support:
//   # / ## headers, -/*/1. list markers, ``` code fences.
//
// This converter rewrites the unsupported constructs into supported ones so an
// LLM response formatted in normal Markdown still reads well in a Zoom card.

/**
 * @param {string} input - Markdown text (e.g. an LLM response)
 * @returns {string} text using only Zoom-supported markdown
 */
export function toZoomMarkdown(input = '') {
  const lines = String(input).replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  const out = [];

  for (let line of lines) {
    // Drop ``` code-fence lines (Zoom has no code blocks); keep the inner text.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    // Headers (# … ######) → a bold line, since Zoom renders no headers.
    const header = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (header) {
      out.push(`**${header[1].trim().replace(/\s*#+\s*$/, '')}**`);
      continue;
    }

    // Unordered list markers (-, *, +) → a bullet glyph, preserving indent.
    line = line.replace(/^(\s*)[-*+]\s+/, '$1• ');

    out.push(line);
  }

  let text = out.join('\n');

  // Markdown links [label](url) → Zoom link form: "label <url>".
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 <$2>');

  // Collapse 3+ blank lines that can result from stripped fences/headers.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
