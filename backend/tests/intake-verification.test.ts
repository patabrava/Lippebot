import { describe, expect, it } from 'vitest';
import {
  buildVerificationMessage,
  isExplicitVerificationConfirmation,
  isFurtherConcernConfirmation,
  isNoFurtherConcern,
  isRequestReady,
  mergeCollectedData,
} from '../src/request/intake-verification.js';

describe('intake verification', () => {
  it.each([
    'ja',
    'Ja, stimmt.',
    'Ja, alles stimmt',
    'Ja, alles korrekt',
    'Ja alles richtig',
    'Ja, die Angaben stimmen',
    'Ja, die Daten sind korrekt',
    'Ja, das passt so',
    'korrekt',
    'alles richtig',
    'die Angaben stimmen',
    'sieht gut aus',
  ])(
    'accepts an explicit confirmation: %s',
    (message) => {
      expect(isExplicitVerificationConfirmation(message)).toBe(true);
    },
  );

  it.each(['okay', 'weiter', 'danke', 'nein', 'ja, aber die E-Mail ist falsch'])(
    'does not mistake an ambiguous or corrective reply for confirmation: %s',
    (message) => {
      expect(isExplicitVerificationConfirmation(message)).toBe(false);
    },
  );

  it.each(['nein', 'nien', 'Nien danke.', 'Nein danke.', 'das war alles', 'kein weiteres Anliegen'])(
    'recognizes that there is no further concern: %s',
    (message) => {
      expect(isNoFurtherConcern(message)).toBe(true);
    },
  );

  it.each(['ja', 'Ja bitte.', 'ja gerne', 'ich habe noch eine Frage', 'noch ein Anliegen'])(
    'recognizes an explicit additional concern confirmation: %s',
    (message) => {
      expect(isFurtherConcernConfirmation(message)).toBe(true);
    },
  );

  it.each(['vielleicht', 'okay', 'danke', 'mein lift'])(
    'does not start another request from an ambiguous reply: %s',
    (message) => {
      expect(isFurtherConcernConfirmation(message)).toBe(false);
    },
  );

  it('merges partial state without dropping previously collected values', () => {
    expect(mergeCollectedData(
      { firstName: 'Patrick', lastName: 'Berg', email: 'old@example.de' },
      { email: 'new@example.de' },
    )).toEqual({
      firstName: 'Patrick',
      lastName: 'Berg',
      email: 'new@example.de',
    });
  });

  it('recognizes a complete ordered-but-not-installed request without factory data', () => {
    expect(isRequestReady('service', {
      requestSituation: 'ordered_not_installed',
      ownsLift: 'no',
      serviceRequestType: 'sales_contract_order',
      customerName: 'Patrick Berg',
      email: 'patrick@example.de',
      category: 'sales',
      issueDescription: 'Wartet auf seinen bestellten Treppenlift.',
      priorContact: 'yes',
      priorContactReference: 'PB-318654',
    })).toBe(true);
  });

  it('shows all collected ordered-lift data and asks for explicit verification', () => {
    const message = buildVerificationMessage('service', {
      requestSituation: 'ordered_not_installed',
      ownsLift: 'no',
      serviceRequestType: 'sales_contract_order',
      customerName: 'Patrick Berg',
      email: 'patrick@example.de',
      category: 'sales',
      issueDescription: 'Wartet auf seinen bestellten Treppenlift.',
      priorContact: 'yes',
      priorContactReference: 'PB-318654',
    });

    expect(message).toContain('alle erfassten Angaben');
    expect(message).toContain('Patrick Berg');
    expect(message).toContain('patrick@example.de');
    expect(message).toContain('PB-318654');
    expect(message).toContain('noch nicht eingebaut');
    expect(message).not.toContain('Fabriknummer');
    expect(message).toContain('Sind alle Angaben korrekt?');
  });

  it('shows both contact methods when the customer provided both', () => {
    const message = buildVerificationMessage('anfrage', {
      firstName: 'LIPPEBOT',
      lastName: 'QA',
      email: 'qa@example.de',
      phone: '+49 151 00000000',
    });

    expect(message).toContain('• E-Mail: qa@example.de');
    expect(message).toContain('• Telefon: +49 151 00000000');
  });
});
