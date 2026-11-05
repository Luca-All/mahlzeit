# Mahlzeit

Web-App fürs Handy, mit der zwei Personen ihre Lieblingsgerichte speichern, im Kalender festhalten, wann sie was gekocht haben, und sich gegenseitig Gerichte wünschen.

Reines HTML/CSS/JS ohne Build-Schritt. Firebase (Firestore und anonyme Anmeldung) übernimmt den Sync.

## Firebase einrichten

1. Auf [console.firebase.google.com](https://console.firebase.google.com) ein neues Projekt anlegen. Google Analytics wird nicht gebraucht.
2. **Authentication** öffnen, „Get started“ wählen und unter „Sign-in method“ **Anonymous** aktivieren.
3. **Firestore Database** anlegen: Standort `eur3` oder `europe-west3`, Production Mode.
4. Dort unter **Rules** den Inhalt von `firestore.rules` einfügen und veröffentlichen.
5. In den **Project settings** unter „Your apps“ eine Web-App (`</>`) registrieren und das `firebaseConfig`-Objekt nach `js/config.js` kopieren.

Solange `firebaseConfig` in `js/config.js` auf `null` steht, läuft die App im Demo-Modus: Die Daten bleiben dann auf dem Gerät. Mit `?demo` in der URL lässt sich der Demo-Modus auch später erzwingen, ohne echte Daten anzufassen.

## Zutaten und Ernährung

`js/nutrition.js` enthält den Katalog der wichtigen Lebensmittel mit ihren Nährstoffen. Ein Gericht ohne eigene Auswahl bekommt seine Zutaten aus Name, Notiz und weiteren Zutaten angenommen (gestrichelte Abzeichen). Sobald jemand die Auswahl ändert oder bestätigt, gilt sie fest. Der Ernährungs-Tab wertet die gekochten Gerichte der letzten 7 Tage aus. Erfasst wird nur, ob etwas vorkommt, nicht wie viel.

## Löffel und Level

`js/points.js` berechnet Punkte und Level bei jedem Rendern aus den Einträgen, gespeichert wird davon nichts. Grundlage sind die [WHO-Empfehlungen](https://www.who.int/news-room/fact-sheets/detail/healthy-diet), die [DGE-Empfehlungen](https://www.dge.de/gesunde-ernaehrung/gut-essen-und-trinken/dge-empfehlungen/) und das [EU Health Promotion Knowledge Gateway](https://knowledge-for-policy.ec.europa.eu/health-promotion-knowledge-gateway/whole-grain_en). Die Punktzahlen sind eine eigene Gewichtung.

## Einstellungen

Die Ernährungsweise (`diet` im Küchen-Dokument) gilt für die ganze Küche und blendet in `js/nutrition.js` Bereiche aus, die dann auch keine Punkte mehr geben. Die Darstellung (Automatisch, Hell, Dunkel) gilt pro Gerät und liegt im `localStorage`.

## Lokal starten

```bash
python3 -m http.server 8650
```

Liegt der Ordner in iCloud Drive, kann Python ihn eventuell nicht lesen. Dann den Ordner vorher an einen anderen Ort kopieren.

## Aufbau

- `js/app.js`: Oberfläche und Abläufe
- `js/store.js`: Datenschicht mit den Backends Firebase und Demo
- `js/util.js`: Datum, Escaping, Emoji-Vorschläge
- `js/nutrition.js`: Zutatenkatalog, Annahmen und Auswertung
- `js/points.js`: Löffel, Wochenziele und Level
- `sw.js`: Offline-Cache für die App-Dateien
- `firestore.rules`: Zugriffsregeln

Der 16-stellige Küchen-Code ist gleichzeitig der Schlüssel zu den Daten: Wer ihn kennt, kann mitlesen und mitschreiben.
