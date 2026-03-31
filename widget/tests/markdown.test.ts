import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/utils/markdown.js';

describe('renderMarkdown', () => {
  it('renders bold text', () => {
    expect(renderMarkdown('Das ist **wichtig**.')).toContain('<strong>wichtig</strong>');
  });

  it('renders headings', () => {
    expect(renderMarkdown('# Titel')).toContain('sarah-md-heading-1');
  });

  it('renders lists', () => {
    const html = renderMarkdown('- Eins\n- Zwei');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Eins</li>');
    expect(html).toContain('<li>Zwei</li>');
  });

  it('escapes html before rendering markdown', () => {
    expect(renderMarkdown('<script>alert(1)</script> **safe**')).not.toContain('<script>');
    expect(renderMarkdown('<script>alert(1)</script> **safe**')).toContain('<strong>safe</strong>');
  });
});
