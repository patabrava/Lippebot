function escapeHtml(text: string): string {
  const replacements: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return text.replace(/[&<>"']/g, (char) => replacements[char]);
}

function applyInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);

  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderList(items: { type: 'ul' | 'ol'; text: string }[]): string {
  if (items.length === 0) return '';
  const tag = items[0].type;
  const body = items.map((item) => `<li>${applyInlineMarkdown(item.text)}</li>`).join('');
  return `<${tag}>${body}</${tag}>`;
}

export function renderMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const blocks: string[] = [];
  const lines = normalized.split('\n');
  let paragraphLines: string[] = [];
  let listItems: { type: 'ul' | 'ol'; text: string }[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push(`<p>${applyInlineMarkdown(paragraphLines.join(' '))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(renderList(listItems));
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      blocks.push(`<div class="sarah-md-heading sarah-md-heading-${level}">${applyInlineMarkdown(headingMatch[2])}</div>`);
      continue;
    }

    const unorderedMatch = /^[-*•]\s+(.*)$/.exec(line);
    if (unorderedMatch) {
      flushParagraph();
      if (listItems.length > 0 && listItems[0].type !== 'ul') {
        flushList();
      }
      listItems.push({ type: 'ul', text: unorderedMatch[1] });
      continue;
    }

    const orderedMatch = /^\d+[.)]\s+(.*)$/.exec(line);
    if (orderedMatch) {
      flushParagraph();
      if (listItems.length > 0 && listItems[0].type !== 'ol') {
        flushList();
      }
      listItems.push({ type: 'ol', text: orderedMatch[1] });
      continue;
    }

    if (listItems.length > 0) {
      flushList();
    }
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join('');
}
