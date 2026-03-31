import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/prompts/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('includes Sarah personality', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Du bist Sarah');
  });

  it('includes knowledge base content', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('LIPPE Lift GmbH');
    expect(prompt).toContain('VARIO PLUS');
    expect(prompt).toContain('STL300');
  });

  it('includes all three modes', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Berater-Modus');
    expect(prompt).toContain('Anfrage-Modus');
    expect(prompt).toContain('Service-Modus');
  });

  it('includes boundary rules', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Preise nennen');
    expect(prompt).toContain('LL12');
    expect(prompt).toContain('Konstanz');
  });
});
