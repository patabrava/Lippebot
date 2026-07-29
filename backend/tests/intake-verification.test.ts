import { describe, expect, it } from 'vitest';
import {
  buildAuthoritativeStateContext,
  buildNextMissingQuestion,
  buildVerificationMessage,
  containsVerificationQuestion,
  ensureNextMissingQuestion,
  inferExplicitServiceContext,
  isExplicitVerificationConfirmation,
  isFurtherConcernConfirmation,
  isNoFurtherConcern,
  isRequestReady,
  mergeCollectedData,
  needsPriorContactReferenceQuestion,
  normalizeCollectedData,
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

  it('extracts a clear repair issue from a pasted conversation', () => {
    const pastedConversation = [
      'Hi mein Sitzlift ist kaputt',
      '**S**',
      'Verstehe, das ist ärgerlich.',
      'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?',
    ].join('\n');

    expect(inferExplicitServiceContext(pastedConversation)).toEqual({
      mode: 'service',
      collectedData: {
        serviceRequestType: 'repair',
        category: 'technik',
        issueDescription: 'Hi mein Sitzlift ist kaputt',
      },
    });
  });

  it('does not infer a service category from an unclear generic message', () => {
    expect(inferExplicitServiceContext('Ich brauche Hilfe und möchte etwas melden.')).toBeUndefined();
  });

  it('does not mistake a pasted category menu for the customer issue', () => {
    expect(inferExplicitServiceContext(
      'Geht es eher um Technik, Rechnung, Vertrag oder Ersatzteile und Montage?',
    )).toBeUndefined();
  });

  it('respects an explicit negation before classifying an invoice issue', () => {
    expect(inferExplicitServiceContext(
      'Mein Lift ist nicht kaputt. Ich habe eine Frage zur Rechnung.',
    )).toEqual({
      mode: 'service',
      collectedData: {
        serviceRequestType: 'invoice_payment',
        category: 'finance',
        issueDescription: 'Ich habe eine Frage zur Rechnung.',
      },
    });
  });

  it('marks an already classified pasted issue as authoritative context', () => {
    const context = buildAuthoritativeStateContext({
      mode: 'service',
      collectedData: {
        serviceRequestType: 'repair',
        category: 'technik',
        issueDescription: 'Mein Sitzlift ist kaputt.',
      },
      awaitingVerification: false,
      completed: false,
    });

    expect(context).toContain('"serviceRequestType":"repair"');
    expect(context).toContain('"category":"technik"');
    expect(context).toContain('frage NICHT erneut');
  });

  it('marks a supplied factory number as provided without relying on model state', () => {
    expect(normalizeCollectedData({
      factoryNumber: ' FBRK123456 ',
      factoryNumberStatus: 'unknown',
    })).toEqual({
      factoryNumber: ' FBRK123456 ',
      factoryNumberStatus: 'provided',
    });
  });

  it('preserves an explicit unavailable correction even if an older number remains', () => {
    expect(mergeCollectedData({
      factoryNumber: 'FBRK123456',
      factoryNumberStatus: 'provided',
    }, {
      factoryNumberStatus: 'unavailable',
    })).toEqual({
      factoryNumber: 'FBRK123456',
      factoryNumberStatus: 'unavailable',
    });
  });

  it.each([
    'Ist das alles so korrekt?',
    'Sind alle Angaben korrekt?',
    '**Name:** Patrick Berg\n\nStimmt das so?',
  ])('detects a model-generated verification question: %s', (message) => {
    expect(containsVerificationQuestion(message)).toBe(true);
  });

  it('replaces a premature review with the genuinely missing service question', () => {
    expect(buildNextMissingQuestion('service', {
      requestSituation: 'installed_lift',
      ownsLift: 'yes',
      customerName: 'Patrick Berg',
      email: 'patrick@example.de',
      issueDescription: 'Lift ist kaputt.',
    })).toBe('Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?');
  });

  it('adds the required next question when the model only acknowledges a field', () => {
    expect(ensureNextMissingQuestion(
      'Verstanden, die E-Mail-Adresse ist patrick-berg@online.de.',
      'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?',
    )).toBe([
      'Verstanden, die E-Mail-Adresse ist patrick-berg@online.de.',
      '',
      'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?',
    ].join('\n'));
  });

  it('uses the required next question when the model emits no visible text', () => {
    expect(ensureNextMissingQuestion(
      '',
      'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?',
    )).toBe('Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?');
  });

  it('asks for a prior-contact reference exactly until that question has been shown', () => {
    const collectedData = {
      requestSituation: 'ordered_not_installed' as const,
      ownsLift: 'no' as const,
      serviceRequestType: 'sales_contract_order' as const,
      priorContact: 'yes' as const,
      customerName: 'Patrick Berg',
      email: 'patrick-berg@online.de',
      category: 'sales' as const,
      issueDescription: 'Ich höre nichts mehr zum Status.',
    };

    expect(needsPriorContactReferenceQuestion({
      mode: 'service',
      collectedData,
      awaitingVerification: false,
      completed: false,
      priorContactReferenceAsked: false,
    })).toBe(true);
    expect(buildNextMissingQuestion('service', collectedData, {
      priorContactReferenceAsked: false,
    })).toBe('Hast du dazu eine Angebots-, Auftrags- oder Vorgangsnummer zur Hand?');
    expect(needsPriorContactReferenceQuestion({
      mode: 'service',
      collectedData,
      awaitingVerification: false,
      completed: false,
      priorContactReferenceAsked: true,
    })).toBe(false);
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
