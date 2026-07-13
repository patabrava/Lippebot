import { describe, expect, it } from 'vitest';
import { hasContactMethod } from '../src/contact/contact-method.js';

describe('hasContactMethod', () => {
  it.each([
    { phone: '05261 96660' },
    { phone: '+49 (0) 5261 9666-0' },
    { email: 'max@example.de' },
    { phone: 'invalid', email: 'max@example.de' },
  ])('accepts a usable phone or email: $phone $email', (data) => {
    expect(hasContactMethod(data)).toBe(true);
  });

  it.each([
    {},
    { phone: '   ', email: '   ' },
    { phone: '0' },
    { phone: 'call me' },
    { phone: '000000' },
    { phone: '......123456' },
    { email: 'foo' },
    { email: 'max@example' },
    { email: 'max@example..de' },
  ])('rejects missing or unusable contact data: $phone $email', (data) => {
    expect(hasContactMethod(data)).toBe(false);
  });
});
