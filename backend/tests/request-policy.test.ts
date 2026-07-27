import { describe, expect, it } from 'vitest';
import {
  classifyRequestPolicy,
  detectEmergency,
  getServiceRecipient,
} from '../src/request/request-policy.js';

describe('request policy', () => {
  it('routes a customer without a lift to the opportunity workflow', () => {
    expect(classifyRequestPolicy({ ownsLift: 'no' })).toEqual({
      kind: 'opportunity',
      crm: 'sales_opportunity',
      needsFactoryNumber: false,
    });
  });

  it('routes an ordered but not installed lift to Sales without factory-number handling', () => {
    expect(classifyRequestPolicy({
      requestSituation: 'ordered_not_installed',
      ownsLift: 'no',
      serviceRequestType: 'sales_contract_order',
    })).toEqual({
      kind: 'service',
      crm: 'forbidden',
      recipient: 'sales@lippelift.de',
      needsFactoryNumber: false,
    });
  });

  it('keeps a third-party lift service request email-only', () => {
    expect(classifyRequestPolicy({
      ownsLift: 'yes',
      liftManufacturer: 'other',
      serviceRequestType: 'technical',
    })).toEqual({
      kind: 'service',
      crm: 'forbidden',
      recipient: 'technik@lippelift.de',
      needsFactoryNumber: false,
    });
  });

  it.each(['maintenance', 'repair'] as const)(
    'keeps a uniquely matched LIPPE %s request CRM-read-only',
    (serviceRequestType) => {
      expect(classifyRequestPolicy({
        ownsLift: 'yes',
        liftManufacturer: 'lippe',
        factoryNumberStatus: 'provided',
        serviceRequestType,
      })).toEqual({
        kind: 'service',
        crm: 'read_only',
        recipient: 'technik@lippelift.de',
        needsFactoryNumber: false,
      });
    },
  );

  it('requires factory-number collection before routing an owned LIPPE lift', () => {
    expect(classifyRequestPolicy({
      ownsLift: 'yes',
      liftManufacturer: 'lippe',
      factoryNumberStatus: 'unknown',
      serviceRequestType: 'technical',
    })).toEqual({
      kind: 'service',
      crm: 'forbidden',
      recipient: 'technik@lippelift.de',
      needsFactoryNumber: true,
    });
  });

  it('keeps an unavailable LIPPE factory number email-only', () => {
    expect(classifyRequestPolicy({
      ownsLift: 'yes',
      liftManufacturer: 'lippe',
      factoryNumberStatus: 'unavailable',
      serviceRequestType: 'technical',
    })).toEqual({
      kind: 'service',
      crm: 'forbidden',
      recipient: 'technik@lippelift.de',
      needsFactoryNumber: false,
    });
  });

  it.each([
    ['technical', 'technik@lippelift.de'],
    ['invoice_payment', 'finance@lippelift.de'],
    ['sales_contract_order', 'sales@lippelift.de'],
    ['spare_parts_installation_warranty', 'lossau@lippelift.de'],
  ] as const)(
    'creates a Serviceanfrage for an exact LIPPE %s match and routes it to %s',
    (serviceRequestType, recipient) => {
      expect(classifyRequestPolicy({
        ownsLift: 'yes',
        liftManufacturer: 'lippe',
        factoryNumberStatus: 'provided',
        serviceRequestType,
      })).toEqual({
        kind: 'service',
        crm: 'create_service_request',
        recipient,
        needsFactoryNumber: false,
      });
    },
  );
});

describe('service recipients', () => {
  it.each([
    ['maintenance', 'technik@lippelift.de'],
    ['repair', 'technik@lippelift.de'],
    ['technical', 'technik@lippelift.de'],
    ['invoice_payment', 'finance@lippelift.de'],
    ['sales_contract_order', 'sales@lippelift.de'],
    ['spare_parts_installation_warranty', 'lossau@lippelift.de'],
  ] as const)('maps %s to %s', (serviceRequestType, expected) => {
    expect(getServiceRecipient(serviceRequestType)).toBe(expected);
  });
});

describe('emergency interruption', () => {
  it.each([
    'Eine Person steckt im Lift fest.',
    'Meine Mutter ist im Lift eingeschlossen.',
    'Jemand wurde verletzt.',
    'Es riecht verbrannt und Rauch kommt aus dem Lift.',
    'Der Lift stellt eine akute Gefahr dar.',
  ])('interrupts for emergency wording: %s', (message) => {
    expect(detectEmergency(message)).toEqual({ emergency: true, show112: true });
  });

  it.each([
    'Der Lift piept manchmal.',
    'Ich möchte eine Wartung vereinbaren.',
    'Der Lift fährt nicht mehr.',
    'Ich brauche eine Rechnungskopie.',
  ])('does not classify an ordinary request as an emergency: %s', (message) => {
    expect(detectEmergency(message)).toEqual({ emergency: false, show112: false });
  });
});
