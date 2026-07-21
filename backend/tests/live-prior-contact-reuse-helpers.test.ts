import { describe, expect, it } from 'vitest';
import {
  assertEmailRecipientCheckpoints,
  extractOpportunityCrm,
  extractServiceCrm,
  parseRetentionSchedule,
  requireOpportunityReuse,
  requireServiceReuse,
} from '../scripts/live-prior-contact-reuse-helpers.js';

describe('live prior-contact reuse helpers', () => {
  it('extracts direct opportunity IDs and requires the second session to reuse them', () => {
    const initial = extractOpportunityCrm([
      { step: 'crm', result: { outcome: 'created', personId: 101, dealId: 201, createdPerson: true } },
    ]);
    const followUp = extractOpportunityCrm([
      { step: 'crm', result: { outcome: 'reused', personId: 101, dealId: 201, createdPerson: false } },
    ]);

    expect(requireOpportunityReuse(initial, followUp)).toEqual({ personId: 101, dealId: 201 });
    expect(() => requireOpportunityReuse(initial, { ...followUp, dealId: 999 })).toThrow('same person and deal');
  });

  it('extracts nested service IDs and requires two notes on the same existing case', () => {
    const initial = extractServiceCrm([
      {
        step: 'crm',
        result: {
          sourceCase: { matchState: 'unique', personId: 301, dealId: 401, factoryNumber: 'KEEP-FN' },
          crm: { personId: 301, dealId: 501, noteId: 601, sourceDealId: 401, reused: false },
        },
      },
    ]);
    const followUp = extractServiceCrm([
      {
        step: 'crm',
        result: {
          sourceCase: { matchState: 'unique', personId: 301, dealId: 401, factoryNumber: 'KEEP-FN' },
          referenceCase: { matchState: 'unresolved', candidateCount: 0 },
          targetCase: { matchState: 'unique', personId: 301, dealId: 501, candidateCount: 1 },
          crm: { personId: 301, dealId: 501, noteId: 602, sourceDealId: 401, reused: true },
        },
      },
    ]);

    expect(requireServiceReuse(initial, followUp)).toEqual({
      personId: 301,
      sourceDealId: 401,
      dealId: 501,
      initialNoteId: 601,
      followUpNoteId: 602,
    });
    expect(() => requireServiceReuse(initial, { ...followUp, dealId: 999 })).toThrow('same service case');
    expect(() => requireServiceReuse(initial, { ...followUp, noteId: 601 })).toThrow('separate request note');
  });

  it('requires exactly one successful recipient checkpoint for every expected envelope', () => {
    const checkpoints = [
      { step: 'email_recipient:sales@lippelift.de', result: { sent: true, recipient: 'sales@lippelift.de' } },
      { step: 'email_recipient:berg@lippelift.de', result: { sent: true, recipient: 'berg@lippelift.de' } },
      { step: 'email_recipient:caechma@gmail.com', result: { sent: true, recipient: 'caechma@gmail.com' } },
      { step: 'email', result: { sent: true } },
      { step: 'completed', result: { completed: true } },
    ];

    expect(assertEmailRecipientCheckpoints(checkpoints, [
      'sales@lippelift.de', 'berg@lippelift.de', 'caechma@gmail.com',
    ])).toEqual(['berg@lippelift.de', 'caechma@gmail.com', 'sales@lippelift.de']);
    expect(() => assertEmailRecipientCheckpoints(checkpoints.slice(1), [
      'sales@lippelift.de', 'berg@lippelift.de', 'caechma@gmail.com',
    ])).toThrow('recipient checkpoints');
    expect(() => assertEmailRecipientCheckpoints([...checkpoints, checkpoints[0]], [
      'sales@lippelift.de', 'berg@lippelift.de', 'caechma@gmail.com',
    ])).toThrow('recipient checkpoints');
  });

  it('normalizes a retention readback schedule and always starts immediately', () => {
    expect(parseRetentionSchedule(undefined)).toEqual([0, 60]);
    expect(parseRetentionSchedule('180, 0,60,60')).toEqual([0, 60, 180]);
    expect(() => parseRetentionSchedule('-1,60')).toThrow('retention schedule');
    expect(() => parseRetentionSchedule('abc')).toThrow('retention schedule');
  });
});
