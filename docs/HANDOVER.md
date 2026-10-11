# Übergabe: Weiterarbeit am Windows-PC

Stand: 11.10.2026, Mac → Windows. Live-Version: https://simon23-12.github.io/SpaceWing/ (jeder Push auf `main` deployt per GitHub Actions nach GitHub Pages, ca. 40 s).

Dieses Dokument ist für Simon **und** für Claude Code auf dem Windows-PC gedacht. Claude: bitte zuerst ganz lesen, besonders „Regeln“ und „Offene Punkte“.

---

## 1. Regeln (Vorgaben von Simon)

Diese Regeln lagen bisher nur im lokalen Claude-Gedächtnis auf dem Mac und gelten weiter:

- **Assets nur aus dem lokalen Blender** über die MCP-Bridge (`tools/bl.py`, `localhost:9876`), nie Cloud-Blender. Modelle, Renders und Bakes entstehen über die Skripte in `blender/*.py`.
- **Strikt kostenlos:** keine bezahlten Assets, Abos, APIs oder Dienste. Lizenzen prüfen, CC0 bevorzugt. Gibt es kein freies Asset in guter Qualität, das offen sagen statt still ein schwächeres zu nehmen.
- **Kein billiger three.js-Look.** Primitive prozedurale Menschen wurden abgelehnt; NPCs kommen aus MakeHuman/MPFB2 (CC0) mit Quaternius-UAL-Animationen (CC0).
- **Stimmen:** Chatterbox Multilingual (MIT) klont gemeinfreie LibriVox-Sprecher, jede Zeile wird mit Whisper gegen das Skript geprüft. Piper wurde als hölzern abgelehnt.
- **`.claude/launch.json` nie committen** (enthält lokale Pfade).
- Simon steht im Spiel nur als „Von Simon“ im Hauptmenü. Kommunikation auf Deutsch.

## 2. Einrichtung am Windows-PC

```powershell
git clone https://github.com/simon23-12/SpaceWing.git
cd SpaceWing
npm install
npm run dev
```

- **Node.js 20.19 oder neuer** (für Vite 7). Danach läuft das Spiel unter http://localhost:5173.
- **Claude-Vorschau:** eine `.claude/launch.json` anlegen (wird nicht committet), z. B.:
  ```json
  { "version": "0.0.1", "configurations": [ { "name": "spacewing", "runtimeExecutable": "npx", "runtimeArgs": ["vite", "--port", "5173"], "port": 5173, "env": { "SHOT_DIR": "C:\\Temp\\spacewing-shots" } } ] }
  ```
  `SHOT_DIR` ist für Screenshots, wenn das Browserfenster verdeckt ist (siehe Abschnitt 6).

### Blender-MCP-Bridge

- Blender mit dem MCP-Add-on starten, es lauscht auf `localhost:9876`.
- Test: `python tools/bl.py -c "result = {'ok': 1}"`.
- Die Quellpakete für NPCs und Animationen (MakeHuman/MPFB2, Quaternius UAL) lagen auf dem Mac in `../SpaceWing_vendor`. Sie werden nur gebraucht, um NPCs neu zu bauen, nicht zum Spielen oder Vertonen. Die fertigen Modelle liegen im Repo unter `public/assets`.

## 3. Stimmen fertig generieren (Hauptaufgabe)

### Stand

- **Fertig:** 292 von 317 Zeilen vertont, mittlere Whisper-Übereinstimmung 0,937.
- **Fehlen 25 Zeilen:**
  - `dome_saturn` 10: Dr. Henrike Albers, Planetologin in der Aussichtskuppel
  - `dome_rhea` 11: Tarek Ohanian, Eisgeologe
  - Morgen-Szene in der Kabine 4: `comp` 2, `kix` 1, `haendler` 1
- Bis die Zeilen vertont sind, erscheinen sie im Spiel nur als Text. Details: `docs/TODO-voices.md`.
- **Schwache Takes:** 10 Zeilen liegen unter 0,8. Ein Teil davon ist nur ein Messfehler: Whisper schreibt Zahlen als Ziffern („Hangar 7“ statt „sieben“). Echt schwach ist Kix' Bandansage mit „Roche-Grenze“ und „Saffi Lindqvist“.

### Was im Repo liegt (neu)

- **`tools/voice/refs/*.wav`:** die 12-s-Referenzclips der LibriVox-Sprecher (gemeinfrei, 15 MB).
- **`tools/voice/progress/part*.json`:** der Fortschritt, also welche Zeile mit welchem Whisper-Wert fertig ist. Dadurch macht der PC genau dort weiter.
- **`tools/voice/requirements.txt`:** die gepinnten Python-Pakete.
- **`tools/voices_cbx.py`** ist Windows-fest gemacht: UTF-8 überall, Temp-Dateien, Option `--cuda` für NVIDIA-GPUs.

### Einrichtung (einmalig)

1. **Python 3.12** (python.org oder `winget install Python.Python.3.12`) und **ffmpeg** (`winget install Gyan.FFmpeg`, danach neues Terminal öffnen).
2. venv neben dem Repo anlegen:
   ```powershell
   py -3.12 -m venv ..\SpaceWing_vendor\cbx\venv
   ..\SpaceWing_vendor\cbx\venv\Scripts\python -m pip install --upgrade pip
   ```
3. **Mit NVIDIA-Grafikkarte** (sehr viel schneller als CPU): zuerst Torch mit CUDA installieren:
   ```powershell
   ..\SpaceWing_vendor\cbx\venv\Scripts\python -m pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
   ```
   Ohne NVIDIA-Karte diesen Schritt weglassen.
4. Danach in beiden Fällen:
   ```powershell
   ..\SpaceWing_vendor\cbx\venv\Scripts\python -m pip install -r tools\voice\requirements.txt
   ```
5. **Beim ersten Lauf** lädt Chatterbox sein Modell (einige GB) und Whisper „small“ von Hugging Face. Das ist kostenlos, ohne Konto.

### Ablauf

```powershell
node tools/extract_lines.mjs tools/lines.json
..\SpaceWing_vendor\cbx\venv\Scripts\python tools\voices_cbx.py 0 1 --cuda
..\SpaceWing_vendor\cbx\venv\Scripts\python tools\voices_cbx.py --merge
git add public/assets/voice tools/voice/progress tools/lines.json
git commit -m "Voice-over: dome guides and morning scene"
git push
```

- **Zeilen extrahieren:** `extract_lines.mjs` mit Dateipfad aufrufen, **nicht** `> tools/lines.json`. Windows PowerShell 5 würde sonst UTF-16 schreiben.
- **Generieren:** Ohne NVIDIA `--cuda` weglassen. Auf der CPU dauert eine Zeile etwa eine Minute. Bereits vertonte Zeilen werden übersprungen. Die Ausgabe zeigt pro Zeile den Whisper-Wert und was Whisper gehört hat.
- **Merge:** schreibt `index.json` mit den Längen und löscht mp3s, die zu keiner Zeile mehr gehören.
- **Schwache Takes verbessern (optional):** `voices_cbx.py 0 1 --retry-below 0.8 --cuda`. Jede schwache Zeile bekommt bis zu 8 neue Versuche. Ist keiner besser, bleibt der alte Take. Danach wieder `--merge`.
- **Nie zwei Generator-Jobs gleichzeitig laufen lassen.** Beide werden dann sehr langsam. Nur bestimmte Sprecher: `--speakers dome_saturn,dome_rhea --part dome`.
- **Wenn Text sich ändert:** Der Schlüssel jeder Zeile ist ein FNV-1a-Hash des Textes, `{name}` steht für das Rufzeichen. Ändert sich ein gesprochener Satz in `src/game/story.js`, `missions.js`, `game.js`, `flight.js` (oder in den `BARKS`), braucht er eine neue Aufnahme.
- **Besetzung:** `CAST` in `tools/voices_cbx.py`, Sprechername → Referenzclip, Ausdruck und cfg.

## 4. Was in dieser Sitzung gebaut wurde (alles committet und live)

- **Zielen:**
  - Die Zielhilfe greift großzügiger, und eigene Schüsse lenken leicht zum Ziel nach.
  - Grünes „IM ZIEL“ und die Zielhilfe nutzen dieselbe Prüfung.
  - Die Trefferzone eigener Schüsse ist etwas größer.
- **Gefechtssimulator:**
  - 14 Szenarien in 5 Stufen, die mit den Mondsystemen freigeschaltet werden: Abschuss, Überleben, Geleitschutz.
  - Medaillen Bronze/Silber/Gold mit einmaliger Prämie, Tipps pro Szenario.
  - Schiffswahl: eigene Schiffe oder Probeflug-Profile.
  - Code: `SIM_SCENARIOS`/`SIM_TIERS` in `src/game/missions.js`, UI in `src/ui/ui.js` (`openSim`, `simReport`).
- **Flugbericht nach dem Andocken:** Zeit, Trümmer, Verdienst, Abschüsse, Schaden, Schrott direkt verkaufen. Code: `game.sortie`, `ui.debrief`.
- **Esc-Menü:**
  - Speichern, JSON-Spielstand herunterladen und laden (auch im Hauptmenü), Vollbild, Tastenbelegung.
  - Esc öffnet das Menü auch dann, wenn der Browser die Maus freigibt.
  - Im Vollbild hält Chrome/Edge Esc per Keyboard Lock fürs Menü; F12 schaltet das Vollbild.
- **Börse:** Aufträge, die das Schiff nicht fliegen kann (Sprungklasse, gesperrter Mond, Frachtraum), sind ausgegraut (`jobBlocker`).
- **Bergungsnetz im HUD** (Füllstand, Wert, VOLL). Das Trümmerfeld um Cassini wächst ständig nach (30 Teile, dazu ab und zu Trümmergruppen).
- **Steuerung frei belegbar** (`src/core/bindings.js`):
  - Zwei Tasten pro Aktion, Anzeige im eigenen Tastaturlayout.
  - Joystick/Gamepad pro Gerät mit Live-Anzeige von Achsen und Knöpfen, Achsen „bewegen…“ zum Lernen, Knöpfe und Coolie-Hat bindbar.
  - Meldung „JOYSTICK ERKANNT“, sobald ein Gerät verbunden ist.
  - R = vorheriges Ziel, G = Ziel am Fadenkreuz. Seitlicher Schub nach oben und unten jetzt auf Bild ↑ / Bild ↓.
  - Texte mit Tasten nutzen Platzhalter `{k:aktion}` (`withKeys`) und zeigen die aktuell belegte Taste.

## 5. Offene Punkte

1. **Stimmen fertig generieren** (Abschnitt 3).
2. **TCA Sidestick Airbus Edition am echten Gerät testen.** Getestet wurde nur mit einem simulierten Gerät.
   - Unter Esc → Tastenbelegung → Joystick / Gamepad prüfen, welche Achse welche ist, und Knöpfe belegen.
   - Standard: X = Gieren, Y = Nicken, Drehachse = Rollen. Wer es wie im Flugzeug mag, stellt X auf Rollen und die Drehachse auf Gieren.
   - Der Browser meldet den Stick erst nach dem ersten Knopfdruck.
3. **Esc-Menü mit gefangener Maus und im Vollbild am echten Rechner prüfen.** Getestet wurde nur simuliert.
4. **Unfertige Arbeit einer parallelen Sitzung lag auf dem Mac noch uncommittet:**
   - Espresso-Maschine als Modell: `public/assets/ships/prop_espresso/`, `blender/ships.py`, `src/station/room.js`, `src/station/gadgets.js`.
   - Wenn sie mitkommen soll: auf dem Mac committen und pushen, bevor gewechselt wird. Sonst fehlt sie am PC.

## 6. Arbeitsweise und Tests (für Claude)

- **Dev-Helfer in der Browser-Konsole** (nur im Dev-Server):
  - `__dev.flight('rhea')` startet einen Flug, `__dev.room('bruecke')` öffnet einen Raum, `__dev.setup()` legt einen Testspielstand an.
  - `__game` ist das Spielobjekt, `__game.ui.openSim()` usw. öffnen Panels direkt.
- **Wenn das Browserfenster verdeckt ist,** stoppt `requestAnimationFrame`. Dann helfen:
  - Updates selbst ausführen (`__game.mode.update(1/30)` in einer Schleife).
  - Screenshots per `await __dev.shot('name', 960)`. Das Bild landet in `SHOT_DIR`.
- **Joystick ohne Gerät testen:** `navigator.getGamepads = () => [fakePad]` mit `{ id, mapping: '', connected: true, axes: [...], buttons: [{pressed, value}] }`. Chrome unter Windows legt den Coolie-Hat meist auf Achse 10 (Index 9). Ruhewert ≈ 1,29, Richtungen −1 … 1 in 8 Schritten. Beim echten Gerät in der Live-Anzeige nachsehen.
- **Build-Check:** `npx vite build`. Deploy läuft automatisch beim Push.
- **Story und Figuren:** `docs/STORY.md`. Lizenzen der Musik, Geräusche und Stimmen: Tabelle in `README.md`.
