# Verbindliche Abschluss-E-Mails für Sarah-Chats

## Ziel

Nach jeder erfolgreich abgeschlossenen Sarah-Unterhaltung wird genau eine interne E-Mail verschickt. Sie enthält oben eine kurze Zusammenfassung und darunter das vollständige chronologische Transkript einschließlich Sarahs finaler Antwort. Das gilt für allgemeine Chats, Pipedrive-Opportunities und Pipedrive-Cases.

## Bestehendes Problem

Opportunity- und Support-E-Mails werden derzeit bereits beim jeweiligen Gemini-Tool-Aufruf verschickt. Zu diesem Zeitpunkt ist der Antwort-Stream noch nicht beendet, sodass weder Sarahs finale Antwort noch das vollständige Transkript vorliegen. Der nach Stream-Ende erzeugte Inhalt wird ausschließlich als Pipedrive-Notiz gespeichert. Allgemeine abgeschlossene Chats lösen keine Abschluss-E-Mail aus. Dadurch existieren E-Mail-Benachrichtigung und vollständiger Chat-Abschluss als getrennte, zeitlich unvereinbare Abläufe.

## Architektur

Der E-Mail-Versand wird aus den frühen Lead- und Support-Aktionen entfernt und in einen gemeinsamen Post-Stream-Abschlussschritt in `backend/src/routes/chat.ts` verschoben. Der Abschluss hat dann zwei verpflichtende externe Seiteneffekte:

1. Wenn ein konkreter Pipedrive-Kontakt vorliegt, wird die vollständige Transkript-Notiz am zugehörigen Deal gespeichert.
2. Für jede abgeschlossene Session wird eine Abschluss-E-Mail verschickt.

Erst wenn alle für die Session erforderlichen Abschlussaktionen erfolgreich waren, sendet die Route das SSE-Ereignis `done`. Ein endgültiger Fehler erzeugt stattdessen das bestehende SSE-Fehlerereignis und wird im Conversation Tracking dokumentiert.

## E-Mail-Inhalt

Eine neue, einheitliche Abschluss-Mail-Nutzlast enthält:

- Session-ID und Abschlusszeitpunkt,
- Chat-Modus,
- eine kurze Zusammenfassung,
- optional strukturierte Opportunity- oder Case-Daten,
- optional den validierten exakten Pipedrive-Deal-Link,
- das vollständige chronologische Transkript.

Die Zusammenfassung wird ohne zusätzlichen Modellaufruf aus den bereits vorliegenden Abschlussdaten erstellt, damit ein weiterer KI-Aufruf den verpflichtenden Versand nicht unnötig fehleranfällig macht:

- Opportunity: Name, Anliegen beziehungsweise Nachricht, Standort und Erreichbarkeit sowie CRM-Ergebnis.
- Case: Kunde, Kategorie und Problembeschreibung sowie CRM-Zuordnung.
- Allgemeiner Chat: letzte inhaltliche Nutzernachricht und Sarahs finale Antwort.

Alle dynamischen Inhalte werden vor dem Einfügen in HTML escaped. Das Transkript verwendet Berlin-Zeit, eindeutige Sprecherbezeichnungen und erhält sämtliche Nachrichten aus `history`, die aktuelle Nutzernachricht und Sarahs vollständige finale Antwort.

## Empfängerregeln

- Opportunity: `NOTIFICATION_EMAIL_TO`.
- Case: `SERVICE_EMAIL_TO`.
- Allgemeiner Chat: `SERVICE_EMAIL_TO`.
- Wenn die jeweils erforderliche Variable leer ist, wird `berg@lippelift.de` verwendet.

Die Empfängeradresse aus dem Chat selbst ist niemals Ziel dieser internen Abschluss-E-Mail.

## Opportunity- und Case-Verhalten

Die frühen `sendLeadNotification`- und `sendSupportNotification`-Aufrufe entfallen. Lead- und Support-Aktionen führen weiterhin ihre Pipedrive-Operationen aus und liefern ihre internen Ergebnisse an den gemeinsamen Abschlussschritt zurück. So entsteht pro Session nur eine E-Mail, die sowohl die bisherigen strukturierten Benachrichtigungsdaten als auch Zusammenfassung und Transkript enthält.

Ein konkreter positiver Deal-ID-Wert wird zentral über die bestehende Pipedrive-Link-Hilfe in einen sicheren Link umgewandelt. Bei fehlender oder mehrdeutiger Zuordnung enthält die Mail keinen geratenen CRM-Link und weist auf manuelle Prüfung hin.

## Zuverlässigkeit und Idempotenz

Der Abschluss-Mailversand erhält dieselbe Art von Schutz wie die vorhandene Transkript-Persistenz:

- stabiler Schlüssel pro Session,
- In-Flight-Promise gegen parallele Doppelversände,
- Prozess-lokale Markierung nach bestätigtem Erfolg,
- bis zu drei synchrone Versuche bei Versandfehlern,
- kein `done`, wenn alle Versuche scheitern.

Ein bereits bestätigter Versand wird bei einer Wiederholung derselben Session nicht erneut ausgeführt. Die SMTP-Sendeoperation muss erfolgreich auflösen; bloße Konfiguration gilt nicht als Versandnachweis.

## Abgebrochene Chats

Der vorhandene `/api/chat/abandoned`-Pfad bleibt bestehen. Er nutzt weiterhin seine eigene Idempotenz, wird aber auf denselben Fallback-Empfänger und dieselben sicheren Summary-/Transkript-Darstellungsbausteine ausgerichtet. Er zählt nicht als erfolgreich abgeschlossener Chat und sendet deshalb weiterhin eine entsprechend bezeichnete Abbruchmail.

## Fehlerbehandlung und Tracking

Conversation Tracking wird um eindeutige Ereignisse für erfolgreiche und fehlgeschlagene Abschluss-E-Mails ergänzt. Die Ereignisse enthalten keine vollständigen Chat-Inhalte, sondern nur Session-ID, Empfänger, Modus, Versuchsergebnis und gegebenenfalls eine Fehlermeldung. SMTP-Fehler dürfen nicht als erfolgreicher Chatabschluss dargestellt werden.

## Tests und Abnahme

Die Umsetzung erfolgt testgetrieben. Regressionstests müssen zunächst nachweisen, dass der aktuelle Code folgende Anforderungen verletzt:

- allgemeiner Chat versendet nach Stream-Ende Summary plus vollständiges Transkript,
- Opportunity-Mail enthält strukturierte Daten, exakten Deal-Link, Summary und finales Transkript,
- Case-Mail enthält strukturierte Daten, exakten Deal-Link, Summary und finales Transkript,
- die Mail wird erst nach Sarahs finalem Token verschickt,
- pro Session wird trotz Wiederholung beziehungsweise Parallelität nur einmal versendet,
- temporäre SMTP-Fehler werden wiederholt,
- endgültiger SMTP-Fehler verhindert `done`,
- fehlende Empfängervariablen fallen auf `berg@lippelift.de` zurück,
- HTML-Inhalte sind escaped,
- bestehende Pipedrive-Transkript- und Abbruchmailfunktionen bleiben intakt.

Nach den fokussierten Tests werden die vollständige Backend-Testsuite und der TypeScript-Build ausgeführt. Vor einer Produktionsfreigabe folgen Deployment, Health-Check und ein live markierter Test je für allgemeinen Chat, Opportunity und Case mit Prüfung der tatsächlich empfangenen E-Mail sowie Pipedrive-Readback für Opportunity und Case.

## Nicht im Umfang

- E-Mails an Chat-Nutzer,
- geratenes Verknüpfen mehrdeutiger Pipedrive-Fälle,
- Änderungen an Sarahs Gesprächsführung,
- Ersetzen des bestehenden SMTP-Anbieters,
- nachträgliches Versenden historischer Chats.
