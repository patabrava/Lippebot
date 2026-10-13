import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/types/index.js';
import { currentRequestHistory, reconcileIntakeContext } from '../src/request/intake-context.js';
import { buildNextMissingQuestion, type IntakeState } from '../src/request/intake-verification.js';
import { stl300Inquiry, stl300Clarification } from './fixtures/stl300-inquiry.js';

const emptyState: IntakeState = { mode: 'undetermined', collectedData: {}, awaitingVerification: false, completed: false };
const user = (content: string): ChatMessage => ({ role: 'user', content, timestamp: 1 });

describe('customer intake context', () => {
  it.each([
    ['draußen', { stairLocation: 'aussen' }],
    ['Mehrfamilienhaus', { buildingType: 'mehrfamilienhaus' }],
    ['rollstuhlgeeignet', { liftType: 'rollstuhlgeeignet' }],
    ['geschäftlich', { customerSegment: 'firma' }],
    ['08:00–12:00', { availability: '08:00 - 12:00' }],
    ['Musterstraße 4 80331 München', { street: 'Musterstraße 4', postalCode: '80331', city: 'München' }],
  ])('records the explicit answer %s even without a model state update', (reply, fields) => {
    expect(reconcileIntakeContext(emptyState, [], reply as string).collectedData).toMatchObject(fields);
  });

  it('recovers a full name from its question-and-answer pair', () => {
    const history: ChatMessage[] = [{ role: 'assistant', content: 'Wie ist dein vollständiger Name?', timestamp: 1 }, user('Alex Beispiel')];
    expect(reconcileIntakeContext(emptyState, history, 'test@example.de').collectedData).toMatchObject({ firstName: 'Alex', lastName: 'Beispiel', customerName: 'Alex Beispiel' });
  });

  it('accepts a free-text inquiry answer but does not store a clarification question as the inquiry', () => {
    const history: ChatMessage[] = [{ role: 'assistant', content: 'Beschreibe mir bitte kurz, worum es bei deiner Anfrage geht.', timestamp: 1 }];
    expect(reconcileIntakeContext(emptyState, history, 'Für ein Projekt in München').collectedData.message).toBe('Für ein Projekt in München');
    expect(reconcileIntakeContext(emptyState, history, 'was meinen Sie?').collectedData.message).toBeUndefined();
  });
  it('recognizes the planned new STL300 and preserves the complete technical request', () => {
    const state = reconcileIntakeContext(emptyState, [], stl300Inquiry);
    expect(state.mode).toBe('anfrage');
    expect(state.collectedData).toMatchObject({ requestSituation: 'new_lift', ownsLift: 'no', message: stl300Inquiry, stairType: 'keine_treppe' });
    expect(state.collectedData.message).toContain('1.820 × 1.450');
  });

  it.each(['Ich plane einen neuen Hublift STL300.', 'Ich hätte gerne einen Lift.', 'Ich will einen neuen Sitzlift.'])('recognizes the purchase request %s', (message) => {
    expect(reconcileIntakeContext(emptyState, [], message).collectedData).toMatchObject({ requestSituation: 'new_lift', message });
  });

  it.each(['einen neuen lift', 'Es geht um einen neuen Lift', 'Neuer Lift'])('transfers a technical inquiry to sales on the reply %s', (message) => {
    const state = reconcileIntakeContext({ ...emptyState, mode: 'service', collectedData: { issueDescription: stl300Clarification } }, [], message);
    expect(state.mode).toBe('anfrage');
    expect(state.collectedData.message).toBe(stl300Clarification);
  });

  it('recovers the initial request and email-only preference after state loss', () => {
    const state = reconcileIntakeContext(emptyState, [user(stl300Inquiry), user('einen neuen lift'), user('test@example.de'), user('nur per email bitte')], 'was meinen Sie?');
    expect(state.collectedData).toMatchObject({ message: stl300Inquiry, email: 'test@example.de', phoneContactStatus: 'declined', requestSituation: 'new_lift' });
  });

  it('does not ask for an inquiry already stored under the service description key', () => {
    const state = reconcileIntakeContext({ ...emptyState, mode: 'anfrage', collectedData: {
      requestSituation: 'new_lift', ownsLift: 'no', firstName: 'Tina', lastName: 'Beispiel', email: 'test@example.de', phoneContactStatus: 'declined', issueDescription: stl300Clarification,
    } }, [], 'was meinen Sie?');
    expect(buildNextMissingQuestion(state.mode, state.collectedData)).toBe('Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?');
  });

  it('keeps later engineering wording in the confirmed new-lift branch', () => {
    const state = reconcileIntakeContext({ ...emptyState, mode: 'service', collectedData: { requestSituation: 'installed_lift' } }, [user(stl300Inquiry), user('einen neuen lift')], stl300Clarification);
    expect(state.mode).toBe('anfrage');
    expect(state.collectedData.message).toContain('STL300');
    expect(state.collectedData.message).toContain('DWG');
    expect(state.collectedData.ownsLift).toBe('no');
  });

  it('respects a correction to an ordered or installed lift', () => {
    const ordered = reconcileIntakeContext(emptyState, [user(stl300Inquiry)], 'Der Lift ist bereits bestellt');
    expect(ordered.mode).toBe('service');
    expect(ordered.collectedData.requestSituation).toBe('ordered_not_installed');
    const installed = reconcileIntakeContext(ordered, [], 'Der Lift ist schon eingebaut');
    expect(installed.collectedData.ownsLift).toBe('yes');
  });

  it('does not turn a product information question into a new purchase', () => {
    expect(reconcileIntakeContext({ ...emptyState, mode: 'berater' }, [], 'Was kostet der STL300?').mode).toBe('berater');
  });

  it('does not reuse concerns from a completed request', () => {
    const history: ChatMessage[] = [user(stl300Inquiry), { role: 'assistant', content: 'Gerne. Beschreibe mir bitte kurz dein weiteres Anliegen.', timestamp: 2 }, user('Meine Rechnung ist falsch.')];
    expect(currentRequestHistory(history)).toHaveLength(1);
    expect(reconcileIntakeContext(emptyState, history, 'Bitte helfen').collectedData.message).not.toContain('STL300');
  });
});
