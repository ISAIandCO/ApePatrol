function safeLink(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function appendInline(parent, source, documentRef) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|!?\[[^\]\n]*\]\([^\s)]+(?:\s+"[^"]*")?\)|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  for (const match of String(source).matchAll(pattern)) {
    if (match.index > cursor) parent.append(documentRef.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    let element;
    if (token.startsWith("`")) {
      element = documentRef.createElement("code");
      element.textContent = token.slice(1, -1);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      element = documentRef.createElement("strong");
      appendInline(element, token.slice(2, -2), documentRef);
    } else if (token.startsWith("~~")) {
      element = documentRef.createElement("del");
      appendInline(element, token.slice(2, -2), documentRef);
    } else if (token.startsWith("![") || token.startsWith("[")) {
      const image = token.startsWith("!");
      const parts = token.match(/^!?\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/);
      const href = safeLink(parts?.[2]);
      if (href) {
        element = documentRef.createElement("a");
        element.href = href;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
        element.textContent = image ? `[Изображение: ${parts[1] || href}]` : (parts[1] || href);
      } else {
        element = documentRef.createTextNode(parts?.[1] ?? token);
      }
    } else {
      element = documentRef.createElement("em");
      appendInline(element, token.slice(1, -1), documentRef);
    }
    parent.append(element);
    cursor = match.index + token.length;
  }
  if (cursor < source.length) parent.append(documentRef.createTextNode(source.slice(cursor)));
}

function tableCells(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

function startsBlock(lines, index) {
  const line = lines[index] ?? "";
  return !line.trim()
    || /^\s*```/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)
    || /^\s{0,3}>\s?/.test(line)
    || /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)
    || (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]));
}

export function createMarkdownFragment(source, documentRef = document) {
  const fragment = documentRef.createDocumentFragment();
  const lines = String(source ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = documentRef.createElement("pre");
      const code = documentRef.createElement("code");
      if (fence[1]) code.className = `language-${fence[1]}`;
      code.textContent = body.join("\n");
      pre.append(code); fragment.append(pre); continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const element = documentRef.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2], documentRef);
      fragment.append(element); index += 1; continue;
    }

    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      fragment.append(documentRef.createElement("hr")); index += 1; continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^\s{0,3}>\s?/, ""));
      const blockquote = documentRef.createElement("blockquote");
      blockquote.append(createMarkdownFragment(quoted.join("\n"), documentRef));
      fragment.append(blockquote); continue;
    }

    const listMatch = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const list = documentRef.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
        const item = documentRef.createElement("li");
        appendInline(item, itemMatch[2], documentRef);
        list.append(item); index += 1;
      }
      fragment.append(list); continue;
    }

    if (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const headers = tableCells(line);
      const separators = tableCells(lines[index + 1]);
      if (headers.length === separators.length && separators.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        const table = documentRef.createElement("table");
        const thead = documentRef.createElement("thead");
        const headerRow = documentRef.createElement("tr");
        headers.forEach((value) => { const cell = documentRef.createElement("th"); appendInline(cell, value, documentRef); headerRow.append(cell); });
        thead.append(headerRow); table.append(thead);
        const tbody = documentRef.createElement("tbody");
        index += 2;
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
          const row = documentRef.createElement("tr");
          const values = tableCells(lines[index]);
          headers.forEach((_header, cellIndex) => { const cell = documentRef.createElement("td"); appendInline(cell, values[cellIndex] ?? "", documentRef); row.append(cell); });
          tbody.append(row); index += 1;
        }
        table.append(tbody); fragment.append(table); continue;
      }
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) paragraphLines.push(lines[index++].trim());
    const paragraph = documentRef.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "), documentRef);
    fragment.append(paragraph);
  }
  return fragment;
}

export function renderMarkdown(target, source) {
  target.replaceChildren(createMarkdownFragment(source, target.ownerDocument));
  return target;
}
