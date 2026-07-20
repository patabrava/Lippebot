# Abschlussmail: Kontaktstatus und reduzierte CRM-Angaben

## Ziel

Die internen E-Mails nach abgeschlossenen Opportunity- und Case-Gesprächen sollen nur handlungsrelevante Angaben enthalten. Technische Session- und CRM-IDs entfallen. Stattdessen zeigt die E-Mail eindeutig, ob der CRM-Kontakt neu angelegt oder bereits vorhanden war.

## Darstellung

- Die Zeilen `Session` und `Modus` werden nicht mehr gerendert.
- Die Zeile `Abgeschlossen` heißt künftig `Chatende`.
- `Person-ID` und `Fall-ID` werden nicht mehr im E-Mail-Text gerendert.
- Die Zeile `Kontaktstatus` zeigt genau `Neu` oder `Bestehend`.
- Bei `Kontaktstatus: Bestehend` folgt `Kontaktname` mit dem im Gespräch bestätigten Namen.
- Bei `Kontaktstatus: Neu` wird keine zusätzliche `Kontaktname`-Zeile angezeigt, weil der normale Name beziehungsweise Kunde bereits in den strukturierten Kontaktdaten steht.
- Der validierte Pipedrive-Button bleibt bestehen, weil er die direkte Bearbeitung ermöglicht, ohne technische IDs offenzulegen.
- Zusammenfassung und vollständiges Transkript bleiben unverändert und in dieser Reihenfolge erhalten.

## Datenfluss

Die CRM-Schicht liefert mit dem Ergebnis ein explizites `createdPerson`-Boolean. Für Opportunities wird es beim Auflösen oder Erstellen der Person gesetzt. Für Support-Cases wird das bereits vorhandene Ergebnis von `createSupportCase` in das Handoff-Ergebnis übernommen; bei einem direkt gefundenen Kontakt/Fall ist der Wert `false`.

Die Chat-Route reicht das Signal an `sendCompletedChatSummary` weiter. Der Renderer leitet daraus ausschließlich die nutzerfreundlichen Werte `Neu` und `Bestehend` ab. Fehlgeschlagene oder mehrdeutige CRM-Vorgänge werden nicht fälschlich als neu oder bestehend bezeichnet; in diesen Fällen bleibt der bestehende Hinweis zur manuellen Prüfung erhalten.

## Tests

- Pipedrive-Tests beweisen `createdPerson: true` für neu angelegte Personen und `false` für wiederverwendete Personen.
- Route-Tests beweisen, dass Opportunity- und Case-Abschlussmails das Signal erhalten.
- Renderer-Tests beweisen das Entfernen von Session, Modus, Person-ID und Fall-ID sowie `Chatende`, `Kontaktstatus` und den bedingten `Kontaktname`.
- Der vollständige Backend-Testlauf und TypeScript-Build schützen bestehendes Verhalten.
- Ein realer SMTP-Test belegt die Darstellung im Postfach; nach Deployment folgen öffentliche Health-Prüfung und ein echter Gesprächsabschluss mit Inbox-Readback.

## Deployment

Die Änderung wird nach erfolgreichem lokalen Test auf `main` veröffentlicht. Da `lippebot-demo` beim Start `main` auscheckt, wird das Hostinger-Projekt anschließend neu gestartet und über `/api/health` sowie eine tatsächlich eingegangene Abschlussmail geprüft.
