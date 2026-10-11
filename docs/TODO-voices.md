# TODO: Sprachausgabe nachgenerieren

Stand 11.10.2026. Die Generierung wurde abgebrochen und soll später am PC laufen.
Bis dahin erscheinen die folgenden Zeilen nur als Text (Untertitel bzw. Dialogfenster), ohne Stimme.

## Fehlende Zeilen

**Intro-Film – Erzähler** (`src/game/intro.js`, 12 Zeilen, Sprecher `erzaehler`)

- [ ] Alle 12 Erzählzeilen (Saturn, Titan, Enceladus, Cassini, Deck, Bar, Kabine, Flugschein, Hangar)
- `erzaehler` steht noch nicht in `CAST` und fiele auf `generic` zurück. Vorher eine ruhige, tiefe Erzählstimme aus `tools/voice/refs/` aussuchen und in `CAST` eintragen (z. B. `'erzaehler': ('<ref>', 0.35, 0.55, None)`).
- „2260.“ am Anfang schreibt Whisper als Ziffern; ein niedriger Wert dort ist nur ein Messfehler.
- Das Intro spielt eine Zeile automatisch ab, sobald sie vertont ist. Die Zeiten der Einstellungen sind fest (je 7–9 s); passt eine Aufnahme nicht hinein, in `SHOTS` das `dur` oder die Zeilenzeiten `at`/`to` anpassen.

**Aussichtskuppel – neue Guides** (`src/game/story.js`, `npcDialogue` und `BARKS`)

- [ ] `dome_saturn` – Dr. Henrike Albers, Planetologin: 10 Dialogzeilen (Saturn: Masse, Ringe, Cassini-Teilung, Sechseck, Tag/Jahr)
- [ ] `dome_rhea` – Tarek Ohanian, Eisgeologe: 11 Dialogzeilen + 2 Kurzsätze (Rhea, Inktomi, Exosphäre, Schwerkraft, Cassini)
- Schon vertont: 3 Kurzsätze von `dome_saturn`, 1 Kurzsatz von `dome_rhea`

Stimmen (bereits in `tools/voices_cbx.py` → `CAST` eingetragen):

| Sprecher | Referenz | exaggeration | cfg |
|---|---|---|---|
| `dome_saturn` | `ak_08_weihnachtsrezepte_nt` (weiblich) | 0.5 | 0.5 |
| `dome_rhea` | `gr_132_sterntaler` (männlich, ~115 Hz, bisher unbenutzt) | 0.45 | 0.5 |

**Apartment / Morgen-Szene** (abgebrochener Job `--part apartment`)

- [ ] `kix`: „Frisch gebackener Pilot, hab ich gehört. Ohne Schiff. Du siehst aus wie jemand mit vierzig Kredits …“ (Text für das Intro angepasst)
- [ ] `haendler`: „Kabine 4-117 gehört dir ja schon. Ein zweites Apartment …“
- [ ] `comp`: „Hochstation Cassini, Rhea-Orbit. 2260. Kabine 4-117 …“
- [ ] `comp`: „Guten Morgen, {name}. Kontostand: 40 Kredits. Flugschein: gültig. Schiff: keins …“ (Text für das Intro angepasst)

**Retry schwacher Takes** (`--retry-below 0.8`) wurde ebenfalls abgebrochen
- [ ] bei Bedarf erneut laufen lassen

## Ablauf

Einrichtung und Befehle für Windows (venv, CUDA, ffmpeg): **`docs/HANDOVER.md`, Abschnitt 3**.

- Referenzclips liegen jetzt in `tools/voice/refs/`, der Fortschritt in `tools/voice/progress/part*.json`. Beides ist im Repo, so dass jeder Rechner dort weitermacht.
- Der erste Lauf überspringt alles, was schon vertont ist, und erzeugt nur die fehlenden Zeilen.
- Nur bestimmte Sprecher: `--speakers dome_saturn,dome_rhea --part dome` (eigene Fortschrittsdatei, wird beim Merge mitgenommen).
- Nicht zwei Jobs gleichzeitig laufen lassen, sonst wird jede Zeile sehr langsam.
- Danach `public/assets/voice/`, `tools/voice/progress/` und `tools/lines.json` committen.
