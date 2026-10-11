# TODO: Sprachausgabe nachgenerieren

Stand 11.10.2026. Die Generierung wurde abgebrochen und soll später am PC laufen.
Bis dahin erscheinen die folgenden Zeilen nur als Text (Untertitel bzw. Dialogfenster), ohne Stimme.

## Fehlende Zeilen

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

- [ ] `kix`: „Neu hier? Du siehst aus wie jemand mit vierzig Kredits …“
- [ ] `haendler`: „Kabine 4-117 gehört dir ja schon. Ein zweites Apartment …“
- [ ] `comp`: „Hochstation Cassini, Rhea-Orbit. 2260. Kabine 4-117 …“
- [ ] `comp`: „Guten Morgen, {name}. Kontostand: 40 Kredits …“

**Retry schwacher Takes** (`--retry-below 0.8`) wurde ebenfalls abgebrochen
- [ ] bei Bedarf erneut laufen lassen

## Ablauf

```bash
node tools/extract_lines.mjs > tools/lines.json
../SpaceWing_vendor/cbx/venv/bin/python tools/voices_cbx.py 0 1
../SpaceWing_vendor/cbx/venv/bin/python tools/voices_cbx.py --merge
```

- Der erste Lauf überspringt alles, was schon vertont ist (Fortschritt in `../SpaceWing_vendor/voice_tmp/part*.json`), und erzeugt nur die fehlenden Zeilen.
- Nur bestimmte Sprecher: `--speakers dome_saturn,dome_rhea --part dome` (eigene Fortschrittsdatei, wird beim Merge mitgenommen).
- Nicht zwei Jobs gleichzeitig laufen lassen, sonst wird jede Zeile sehr langsam (~1 Zeile/min auf CPU allein).
- Danach `public/assets/voice/*.mp3` und `index.json` committen.
