import { describe, it, expect } from 'vitest';
import { GREETINGS, OPENING_MESSAGES, pickGreeting } from '../src/sarah-widget.js';

describe('pickGreeting', () => {
  it('returns one of the configured bubble greetings', () => {
    const result = pickGreeting(GREETINGS, () => 0);
    expect(GREETINGS).toContain(result);
  });

  it('uses the rng to pick by index', () => {
    const result = pickGreeting(['a', 'b', 'c'], () => 2);
    expect(result).toBe('c');
  });

  it('clamps an rng value of 1 to the last entry', () => {
    const result = pickGreeting(['a', 'b', 'c'], () => 1);
    expect(result).toBe('c');
  });

  it('exports at least 3 bubble greetings and 3 opening messages', () => {
    expect(GREETINGS.length).toBeGreaterThanOrEqual(3);
    expect(OPENING_MESSAGES.length).toBeGreaterThanOrEqual(3);
  });
});
