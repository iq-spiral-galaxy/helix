/**
 * Small, dependency-free Markdown renderer for Helix note bodies.
 *
 * Raw HTML is treated as text, except for the exact, attribute-free legacy
 * details/summary and centered-wrapper shapes emitted by older Helix notes.
 * Those shapes are rebuilt from safe elements below; all of their text still
 * passes through the Markdown escaper. Links are protocol-checked before an
 * href is emitted, so callers can safely place the result in innerHTML.
 */

const CODE_TOKEN_RE = new RegExp(
  [
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/,
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/,
    /((?<=^|[\s(])#[^\n]*)/,
    /(@[A-Za-z_]\w*)/,
    /(\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?[fFLdD]?)\b)/,
    /(\b(?:abstract|async|await|boolean|break|byte|case|catch|char|class|const|continue|def|delete|do|double|else|enum|extends|final|finally|float|for|from|fun|function|if|implements|import|in|instanceof|int|interface|is|lambda|let|long|new|not|null|of|or|and|package|print|private|protected|public|record|return|select|short|static|super|switch|this|throw|throws|try|typeof|val|var|void|when|where|while|yield|true|false|None|True|False)\b)/,
    /(\b[A-Z]\w*\b)/,
    /(\b[a-z_]\w*(?=\s*\())/,
  ]
    .map((pattern) => pattern.source)
    .join("|"),
  "gm",
);

const CODE_TOKEN_CLASS = [
  "tk-c",
  "tk-s",
  "tk-c",
  "tk-a",
  "tk-n",
  "tk-k",
  "tk-t",
  "tk-f",
];

const CALLOUT_LABELS = {
  abstract: "요약",
  info: "정보",
  note: "노트",
  quote: "인용",
  question: "질문",
  tip: "팁",
  warning: "주의",
};

const CALLOUT_ICONS = {
  abstract: "≡",
  info: "i",
  note: "•",
  quote: "“",
  question: "?",
  tip: "✦",
  warning: "!",
};

export function escapeHtml(raw) {
  return String(raw).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function safeHref(raw) {
  const href = String(raw).trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^(?:https?:|mailto:|#|\/(?!\/)|\.\.?\/)/i.test(href)) return href;
  return null;
}

function findClosingRun(source, marker, from) {
  const at = source.indexOf(marker, from);
  return at < 0 ? null : at;
}

function renderInlineSegment(source, depth = 0) {
  if (depth > 12) return escapeHtml(source);
  let out = "";
  let index = 0;

  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      const escaped = source[index + 1];
      if (/^[\\`*_[\]{}()#+.!|>~-]$/.test(escaped)) {
        out += escapeHtml(escaped);
        index += 2;
        continue;
      }
    }

    if (source[index] === "`") {
      const run = source.slice(index).match(/^`+/)?.[0] ?? "`";
      const close = findClosingRun(source, run, index + run.length);
      if (close != null) {
        let value = source.slice(index + run.length, close).replace(/\n/g, " ");
        if (/^\s.*\s$/.test(value) && /\S/.test(value)) value = value.slice(1, -1);
        out += `<code>${escapeHtml(value)}</code>`;
        index = close + run.length;
        continue;
      }
    }

    const strongMarker = source.startsWith("**", index)
      ? "**"
      : source.startsWith("__", index)
        ? "__"
        : null;
    if (strongMarker && !/\s/.test(source[index + 2] ?? "")) {
      const close = findClosingRun(source, strongMarker, index + 2);
      if (close != null && close > index + 2) {
        out += `<strong>${renderInlineSegment(source.slice(index + 2, close), depth + 1)}</strong>`;
        index = close + 2;
        continue;
      }
    }

    if (source.startsWith("~~", index) && !/\s/.test(source[index + 2] ?? "")) {
      const close = findClosingRun(source, "~~", index + 2);
      if (close != null && close > index + 2) {
        out += `<del>${renderInlineSegment(source.slice(index + 2, close), depth + 1)}</del>`;
        index = close + 2;
        continue;
      }
    }

    if (source[index] === "[") {
      const labelEnd = source.indexOf("](", index + 1);
      const hrefEnd = labelEnd < 0 ? -1 : source.indexOf(")", labelEnd + 2);
      if (labelEnd > index + 1 && hrefEnd > labelEnd + 2) {
        const label = source.slice(index + 1, labelEnd);
        const rawHref = source.slice(labelEnd + 2, hrefEnd);
        const href = safeHref(rawHref);
        if (href) {
          out += `<a href="${escapeHtml(href)}">${renderInlineSegment(label, depth + 1)}</a>`;
        } else {
          out += `${renderInlineSegment(label, depth + 1)} <span class="md-unsafe-link">(${escapeHtml(rawHref)})</span>`;
        }
        index = hrefEnd + 1;
        continue;
      }
    }

    const emphasisMarker = source[index] === "*" || source[index] === "_"
      ? source[index]
      : null;
    if (
      emphasisMarker &&
      !/\s/.test(source[index + 1] ?? "") &&
      (emphasisMarker !== "_" || !/[\p{L}\p{N}]/u.test(source[index - 1] ?? ""))
    ) {
      const close = findClosingRun(source, emphasisMarker, index + 1);
      if (
        close != null &&
        close > index + 1 &&
        !/\s/.test(source[close - 1]) &&
        (emphasisMarker !== "_" || !/[\p{L}\p{N}]/u.test(source[close + 1] ?? ""))
      ) {
        out += `<em>${renderInlineSegment(source.slice(index + 1, close), depth + 1)}</em>`;
        index = close + 1;
        continue;
      }
    }

    out += escapeHtml(source[index]);
    index += 1;
  }

  return out;
}

export function renderMarkdownInline(raw) {
  return renderInlineSegment(String(raw));
}

function highlightCode(source) {
  let out = "";
  let last = 0;
  let match;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((match = CODE_TOKEN_RE.exec(source))) {
    out += escapeHtml(source.slice(last, match.index));
    const groupIndex = match.slice(1).findIndex((group) => group !== undefined);
    out += `<span class="${CODE_TOKEN_CLASS[groupIndex]}">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return out + escapeHtml(source.slice(last));
}

function renderCodeBlock(lines, language = "") {
  const safeLanguage = language.toLowerCase().replace(/[^a-z0-9_+-]/g, "").slice(0, 32);
  const languageAttribute = safeLanguage
    ? ` data-language="${escapeHtml(safeLanguage)}"`
    : "";
  return `<pre class="codeblock"${languageAttribute}><code>${highlightCode(lines.join("\n"))}</code></pre>`;
}

function fenceAt(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
  if (!match) return null;
  return {
    marker: match[1][0],
    length: match[1].length,
    language: match[2] ?? "",
  };
}

function closesFence(line, fence) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return Boolean(
    match &&
      match[1][0] === fence.marker &&
      match[1].length >= fence.length,
  );
}

function splitTableRow(line) {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  const cells = [];
  let cell = "";
  let codeRun = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (character === "`") {
      const run = source.slice(index).match(/^`+/)?.[0].length ?? 1;
      codeRun = codeRun === run ? 0 : codeRun || run;
      cell += "`".repeat(run);
      index += run - 1;
      continue;
    }
    if (character === "|" && codeRun === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function tableDelimiter(line) {
  const cells = splitTableRow(line);
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) =>
    cell.startsWith(":") && cell.endsWith(":")
      ? "center"
      : cell.endsWith(":")
        ? "right"
        : "left",
  );
}

function looksLikeTable(lines, index) {
  return (
    index + 1 < lines.length &&
    /(^|[^\\])\|/.test(lines[index]) &&
    tableDelimiter(lines[index + 1]) != null
  );
}

function renderTable(lines, start) {
  const headers = splitTableRow(lines[start]);
  const alignments = tableDelimiter(lines[start + 1]);
  let index = start + 2;
  const rows = [];
  while (index < lines.length && lines[index].trim() && /(^|[^\\])\|/.test(lines[index])) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }
  const cell = (tag, value, column) => {
    const alignment = alignments[column] ?? "left";
    return `<${tag} class="align-${alignment}">${renderMarkdownInline(value ?? "")}</${tag}>`;
  };
  return {
    html:
      `<div class="md-table-wrap" role="region" aria-label="표"><table>` +
      `<thead><tr>${headers.map((value, column) => cell("th", value, column)).join("")}</tr></thead>` +
      (rows.length
        ? `<tbody>${rows
            .map(
              (row) =>
                `<tr>${headers.map((_, column) => cell("td", row[column], column)).join("")}</tr>`,
            )
            .join("")}</tbody>`
        : "") +
      `</table></div>`,
    next: index,
  };
}

function listItemAt(line) {
  const match = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  const indentation = match[1].replace(/\t/g, "    ").length;
  return {
    indentation,
    ordered: /^\d/.test(match[2]),
    number: /^\d/.test(match[2]) ? Number.parseInt(match[2], 10) : null,
    text: match[3],
  };
}

function indentationOf(line) {
  return (line.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function stripIndentation(line, width) {
  let consumed = 0;
  let index = 0;
  while (index < line.length && consumed < width) {
    if (line[index] === " ") {
      consumed += 1;
      index += 1;
    } else if (line[index] === "\t") {
      consumed += 4;
      index += 1;
    } else {
      break;
    }
  }
  return line.slice(index);
}

function renderList(lines, start, indentation) {
  const first = listItemAt(lines[start]);
  const ordered = first.ordered;
  const items = [];
  let index = start;

  while (index < lines.length) {
    const current = listItemAt(lines[index]);
    if (!current || current.indentation !== indentation || current.ordered !== ordered) break;
    index += 1;
    const textParts = [current.text];
    let children = "";

    while (index < lines.length) {
      const nested = listItemAt(lines[index]);
      if (nested && nested.indentation > indentation) {
        const rendered = renderList(lines, index, nested.indentation);
        children += rendered.html;
        index = rendered.next;
        continue;
      }
      if (nested || !lines[index].trim()) break;
      const leading = indentationOf(lines[index]);
      if (leading <= indentation) break;

      // A fenced block may be indented under a list marker by up to the
      // marker's content column (the WAL note uses three spaces). Treat it as
      // a child block instead of flattening its backticks into inline text.
      const continuationLine = stripIndentation(lines[index], leading);
      const continuationFence = fenceAt(continuationLine);
      if (continuationFence) {
        index += 1;
        const code = [];
        while (
          index < lines.length &&
          !closesFence(stripIndentation(lines[index], leading), continuationFence)
        ) {
          code.push(stripIndentation(lines[index], leading));
          index += 1;
        }
        if (index < lines.length) index += 1;
        children += renderCodeBlock(code, continuationFence.language);
        continue;
      }

      textParts.push(lines[index].trim());
      index += 1;
    }

    const task = textParts.join(" ").match(/^\[([ xX])\]\s+(.+)$/);
    const content = task
      ? `<span class="md-task"><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""} aria-hidden="true">${renderMarkdownInline(task[2])}</span>`
      : renderMarkdownInline(textParts.join(" "));
    items.push(`<li>${content}${children}</li>`);
    if (!lines[index]?.trim()) break;
  }

  const tag = ordered ? "ol" : "ul";
  const startAttribute = ordered && first.number !== 1 ? ` start="${first.number}"` : "";
  return {
    html: `<${tag}${startAttribute}>${items.join("")}</${tag}>`,
    next: index,
  };
}

function quoteLine(line) {
  const match = line.match(/^ {0,3}> ?(.*)$/);
  return match ? match[1] : null;
}

function renderCallout(lines, callout, depth) {
  const type = callout[1].toLowerCase();
  const fold = callout[2] ?? "";
  const title = callout[3].trim() || CALLOUT_LABELS[type] || "노트";
  const icon = CALLOUT_ICONS[type] || "•";
  const body = renderBlocks(lines.slice(1), depth + 1);
  const heading =
    `<span class="md-callout-icon" aria-hidden="true">${escapeHtml(icon)}</span>` +
    `<span>${renderMarkdownInline(title)}</span>`;
  const className = `md-callout md-callout-${type.replace(/[^a-z0-9_-]/g, "")}`;

  if (fold) {
    return (
      `<details class="${className}"${fold === "+" ? " open" : ""}>` +
      `<summary>${heading}</summary>` +
      `<div class="md-callout-body">${body}</div>` +
      `</details>`
    );
  }
  return (
    `<aside class="${className}">` +
    `<div class="md-callout-title">${heading}</div>` +
    `<div class="md-callout-body">${body}</div>` +
    `</aside>`
  );
}

function renderQuote(lines, depth) {
  const callout = lines[0]?.match(/^\[!([A-Za-z0-9_-]+)\]([+-])?\s*(.*)$/);
  if (callout) return renderCallout(lines, callout, depth);
  return `<blockquote>${renderBlocks(lines, depth + 1)}</blockquote>`;
}

function legacySummaryAt(line) {
  return line.match(/^\s*<summary>(.*)<\/summary>\s*$/)?.[1] ?? null;
}

function renderLegacySummary(raw) {
  const tag = /<(strong|em)>([\s\S]*?)<\/\1>/gi;
  let out = "";
  let last = 0;
  let match;
  while ((match = tag.exec(raw))) {
    out += renderMarkdownInline(raw.slice(last, match.index));
    const element = match[1].toLowerCase();
    out += `<${element}>${renderMarkdownInline(match[2])}</${element}>`;
    last = match.index + match[0].length;
  }
  return out + renderMarkdownInline(raw.slice(last));
}

function matchingLegacyClose(lines, start, open, close) {
  let nesting = 0;
  for (let index = start; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (value === open) nesting += 1;
    if (value !== close) continue;
    nesting -= 1;
    if (nesting === 0) return index;
  }
  return null;
}

function truncatedFenceRecovery(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() !== "... (truncated)") continue;
    if (lines[index + 1]?.trim()) continue;
    let next = index + 2;
    while (next < lines.length && !lines[next].trim()) next += 1;
    if (/^ {0,3}#{1,6}[ \t]+\S/.test(lines[next] ?? "")) return next;
  }
  return lines.length;
}

function renderBlocks(lines, depth = 0) {
  if (depth > 16) return `<p>${renderMarkdownInline(lines.join(" "))}</p>`;
  const out = [];
  const paragraph = [];
  let index = 0;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderMarkdownInline(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = fenceAt(line);
    if (fence) {
      flushParagraph();
      index += 1;
      let close = index;
      while (close < lines.length && !closesFence(lines[close], fence)) close += 1;
      const recovery = close < lines.length
        ? close
        : truncatedFenceRecovery(lines, index);
      const code = [];
      while (index < recovery) {
        code.push(lines[index]);
        index += 1;
      }
      if (close < lines.length) index += 1;
      out.push(renderCodeBlock(code, fence.language));
      continue;
    }

    if (line.trim() === "<details>") {
      flushParagraph();
      const close = matchingLegacyClose(lines, index, "<details>", "</details>");
      const summary = legacySummaryAt(lines[index + 1] ?? "");
      if (close != null && summary != null) {
        const body = renderBlocks(lines.slice(index + 2, close), depth + 1);
        out.push(
          `<details class="md-legacy-details">` +
          `<summary>${renderLegacySummary(summary)}</summary>` +
          `<div class="md-legacy-details-body">${body}</div>` +
          `</details>`,
        );
        index = close + 1;
      } else {
        // Some imported notes were split at an inner ### heading, leaving the
        // safe opener/summary in one section and the body in the next. Keep
        // the title visible without emitting an unbalanced HTML element.
        if (summary != null) {
          out.push(`<p class="md-legacy-summary">${renderLegacySummary(summary)}</p>`);
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }

    const legacySummary = legacySummaryAt(line);
    if (legacySummary != null) {
      flushParagraph();
      out.push(`<p class="md-legacy-summary">${renderLegacySummary(legacySummary)}</p>`);
      index += 1;
      continue;
    }

    if (line.trim() === "</details>") {
      flushParagraph();
      index += 1;
      continue;
    }

    if (line.trim() === '<div align="center">') {
      flushParagraph();
      const close = matchingLegacyClose(
        lines,
        index,
        '<div align="center">',
        "</div>",
      );
      if (close != null) {
        out.push(
          `<div class="md-align-center">${renderBlocks(lines.slice(index + 1, close), depth + 1)}</div>`,
        );
        index = close + 1;
      } else {
        index += 1;
      }
      continue;
    }

    if (line.trim() === "</div>") {
      flushParagraph();
      index += 1;
      continue;
    }

    const quoted = quoteLine(line);
    if (quoted != null) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length) {
        const value = quoteLine(lines[index]);
        if (value == null) break;
        quoteLines.push(value);
        index += 1;
      }
      out.push(renderQuote(quoteLines, depth));
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      out.push("<hr>");
      index += 1;
      continue;
    }

    if (looksLikeTable(lines, index)) {
      flushParagraph();
      const table = renderTable(lines, index);
      out.push(table.html);
      index = table.next;
      continue;
    }

    const listItem = listItemAt(line);
    if (listItem) {
      flushParagraph();
      const list = renderList(lines, index, listItem.indentation);
      out.push(list.html);
      index = list.next;
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      flushParagraph();
      const code = [];
      while (index < lines.length && (/^(?: {4}|\t)/.test(lines[index]) || !lines[index].trim())) {
        code.push(lines[index].replace(/^(?: {4}|\t)/, ""));
        index += 1;
      }
      while (code.at(-1) === "") code.pop();
      out.push(renderCodeBlock(code));
      continue;
    }

    if (
      index + 1 < lines.length &&
      /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1])
    ) {
      flushParagraph();
      const level = lines[index + 1].trim().startsWith("=") ? 1 : 2;
      out.push(`<h${level}>${renderMarkdownInline(line.trim())}</h${level}>`);
      index += 2;
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }

  flushParagraph();
  return out.join("");
}

export function renderMarkdown(raw) {
  const lines = String(raw).replace(/\r\n?/g, "\n").split("\n");
  return renderBlocks(lines);
}
