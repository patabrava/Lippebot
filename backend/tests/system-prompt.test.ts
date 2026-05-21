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

  it('asks for customer segment in lead capture', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Kundensegment');
    expect(prompt).toContain('Privatperson oder Firmenkunde');
    expect(prompt).toContain('spätestens vor den Kontaktdaten');
    expect(prompt).toContain('in einer einzelnen Frage');
  });

  it('instructs Sarah to use du by default and switch to Sie only on request', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Du duzt die Kunden standardmaessig');
    expect(prompt).toContain('Wechsle nur dann zu Sie');
  });

  it('instructs Sarah to ask exactly one lead question at a time', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Frage immer nur eine einzige neue Information pro Antwort ab');
    expect(prompt).toContain('Stelle niemals mehrere Fragen auf einmal');
    expect(prompt).toContain('Deine Antwort darf maximal ein Fragezeichen enthalten');
    expect(prompt).toContain('beginne mit: "Ist der Lift für drinnen oder draußen?"');
    expect(prompt).toContain('Wenn du nach dem Namen fragst, formuliere: "Wie ist dein Name?"');
    expect(prompt).toContain('An welcher Adresse brauchst du den Lift?');
  });

  it('includes boundary rules', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Preise nennen');
    expect(prompt).toContain('LL12');
    expect(prompt).toContain('Konstanz');
  });

  it('declares a Gesprächsstil section before the modes', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('## Gesprächsstil');
    const styleIdx = prompt.indexOf('## Gesprächsstil');
    const modesIdx = prompt.indexOf('## Deine drei Modi');
    expect(styleIdx).toBeGreaterThan(-1);
    expect(modesIdx).toBeGreaterThan(styleIdx);
  });

  it('caps response length and forbids bullet lists in advisor replies', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('maximal 2–3 Sätze');
    expect(prompt).toContain('Keine Bulletpoints');
  });

  it('requires every reply to end with a question or short handoff', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Beende jede Antwort mit einer kurzen Frage');
  });

  it('tells Sarah to ask instead of guessing when uncertain', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Wenn etwas unklar ist, frag nach');
  });

  it('limits advisor answers to one knowledge-base fact per turn', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('maximal einen Fakt aus der Wissensdatenbank pro Turn');
    expect(prompt).toContain('Lade den Nutzer ein, nachzufragen');
  });

  it('lists varied micro-acknowledgements Sarah may rotate', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Klar.');
    expect(prompt).toContain('Verstehe.');
    expect(prompt).toContain('Gute Frage.');
    expect(prompt).toContain('Sehr gerne.');
    expect(prompt).toContain('Macht Sinn.');
  });

  it('restricts "Gute Frage." to actual questions and offers data-reply alternatives', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('nur, wenn der Nutzer wirklich eine Frage gestellt hat');
    expect(prompt).toContain('nicht nach Datenangaben');
    expect(prompt).toContain('Nach Datenangaben passt eher');
    expect(prompt).toContain('Danke.');
    expect(prompt).toContain('Verstanden.');
  });

  it('includes few-shot examples of the desired Sarah register', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('## Beispiele für Sarahs Tonfall');
    expect(prompt).toContain('Beispiel 1');
    expect(prompt).toContain('Beispiel 2');
    expect(prompt).toContain('Beispiel 3');
  });

  it('defines support mode as existing-customer routing and keeps sales flow separate', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('bestehender Kunde');
    expect(prompt).toContain('neue Anfrage');
    expect(prompt).toContain('bestehendes Anliegen zu einem bereits gekauften Lift oder um eine neue Anfrage');
    expect(prompt).toContain('Der Anfrage-Modus bleibt fuer neue Beratungs- und Angebotsanfragen unveraendert');
  });

  it('requires one-inbox support routing with precedence rules', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Waehle genau eine primaere Kategorie');
    expect(prompt).toContain('Technik gewinnt bei Stoerungen');
    expect(prompt).toContain('Lossau gewinnt bei Ersatzteilen');
    expect(prompt).toContain('Finance gewinnt bei Rechnungen');
    expect(prompt).toContain('Sales gewinnt bei Vertragsbestaetigungen');
    expect(prompt).not.toContain('technik@lippelift.de');
    expect(prompt).not.toContain('finance@lippelift.de');
    expect(prompt).not.toContain('sales@lippelift.de');
    expect(prompt).not.toContain('lossau@lippelift.de');
  });

  it('keeps CRM matching internal and limits support questions', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Erwaehne niemals Pipedrive');
    expect(prompt).toContain('Erwaehne niemals CRM');
    expect(prompt).toContain('Frage nach dem Kundennamen');
    expect(prompt).toContain('Wenn der Name nicht eindeutig reicht, frage nach Telefon oder E-Mail');
    expect(prompt).toContain('Stelle keine unnoetigen Zusatzfragen');
  });

  it('scopes free-consultation wording to advisor and inquiry modes', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Im Berater- und Anfrage-Modus passend erwähnen, dass die Erstberatung kostenlos und unverbindlich ist');
    expect(prompt).not.toContain('Bei jeder Gelegenheit erwähnen, dass die Erstberatung kostenlos und unverbindlich ist');
  });
});
