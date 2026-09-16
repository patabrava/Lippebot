import { describe, expect, it } from 'vitest';
import { hasContactMethod, hasRequiredContactDetails } from '../src/contact/contact-method.js';

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

describe('hasRequiredContactDetails', () => {
  it.each([
    { email: 'max@example.de', phone: '05261 96660' },
    { email: 'max@example.de', phoneContactStatus: 'declined' },
  ])('accepts email plus a phone or explicit phone refusal', (data) => {
    expect(hasRequiredContactDetails(data)).toBe(true);
  });

  it.each([
    { email: 'max@example.de' },
    { phone: '05261 96660' },
    { phone: '05261 96660', phoneContactStatus: 'provided' },
    { email: 'invalid', phoneContactStatus: 'declined' },
  ])('rejects incomplete required contact details', (data) => {
    expect(hasRequiredContactDetails(data)).toBe(false);
  });
});
