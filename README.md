# SpaceWing Saturn

Ein Söldner-Weltraumspiel im Saturnsystem des Jahres 2260. Du startest pleite auf der Hochstation Cassini im Rhea-Orbit, fliegst deine erste Tour als Aushilfe auf einem rostigen Eisfrachter und bekommst danach einen alten Kurierjäger geschenkt: die SW-2 „Spacewing“. Von da an verdienst du Kredits mit Frachtaufträgen, Kopfgeldern und Eskorten, rüstest dein Schiff auf und gerätst in einen Handelskrieg zwischen den Saturnmonden, in dem es um eine Zukunftsprognose im Stil von Asimovs *Foundation* geht.

**Spielen:** https://simon23-12.github.io/SpaceWing/

![Titelbild](public/assets/ui/title.jpg)

| Kommandodeck (Übersicht) | Bar „Cassini-Spalt“ |
|---|---|
| ![Übersicht](public/assets/ui/overview.jpg) | ![Bar](public/assets/ui/bar.jpg) |
| **Hangar 7** | **Titan-Orbit** |
| ![Hangar](public/assets/ui/hangar.jpg) | ![Titan](public/assets/ui/kraken.jpg) |

## Features

- **Brückenübersicht im Stil von X-Wing Alliance:** ein in Cycles gerendertes Bild des Kommandodecks mit anklickbaren Bereichen (Bar, Hangar, Quartiere, Aussichtsplattform, Söldnerbörse, Werft, Systemkarte).
- **Begehbare Station in der Ich-Perspektive:** Deck 4 der Hochstation Cassini ist ein zusammenhängendes Level. Vom Kommandodeck läuft man durch Schiebetüren in den Ringgang (Bar „Cassini-Spalt“, Kabinen), durch den Hangar-Zugang zu Hangar 7 und fährt mit dem Glaslift hinauf in die Aussichtskuppel. Die Beleuchtung ist in Blender als Global Illumination gebacken, durch die Fenster sieht man den echten Saturn.
- **Menschen statt Puppen:** Alle Stationsbewohner sind geriggte MakeHuman-Figuren mit echten Hauttexturen, Kleidung und Frisuren (CC0) und retargeteten Quaternius-Animationen (CC0): Atmen und Gewichtsverlagerung im Stand, natürliches Sitzen, Gesten beim Reden, Trinken, Gehen. Wer in der Nähe ist, dreht den Kopf zum Spieler. Jede Figur hat einen kleinen Dialogbaum.
- **Fünf Monde als Level:** Rhea, Enceladus, Mimas, Titan und Iapetus, jeder mit eigener Station, eigener Stimmung und eigener Rolle im Handelskrieg. Monde werden im Lauf der Karriere freigeschaltet und per **Hyperraumsprung** erreicht. Dafür braucht das Schiff ein Sprungtriebwerk (Klasse I bis III) aus der Werft. Saturn ist überall sichtbar und im HUD als Fixpunkt markiert.
- **Apartments:** Auf jeder Mondstation kann man eine Wohnung kaufen. Zwischen eigenen Apartments reist man per Transit-Kapsel ohne Flug.
- **Flug mit Verfolgerkamera oder Cockpit:** Das 3D-Cockpit hat Live-Anzeigen für Radar, Ziel und Systeme. Dazu kommen Flughilfe mit Newton-Modus, Nachbrenner, Laser, Raketen mit Zielerfassung, KI-Gegner, Eskorten und Andock-Autopilot.
- **Realistischer Saturn:** abgeplatteter Planet mit Wolkenbändern und Polarhexagon, Ringe mit realer Radialstruktur (C-, B- und A-Ring, Cassini-Teilung, Encke-Lücke, F-Ring), gegenseitige Schatten von Planet und Ringen sowie die Monde Mimas, Enceladus, Tethys, Dione, Rhea, Titan (mit Atmosphäre), Iapetus (zweifarbig, mit Äquatorgrat) und Phoebe.
- **Reisen:** Hyperraumsprung zwischen den Monden, Fusionsbrand innerhalb eines Mondsystems (Mimas ↔ Ringrand, Iapetus ↔ Phoebe).
- **Wirtschaft:** neun Handelswaren, deren Preise auf Story-Ereignisse reagieren (Saturnzoll, Embargo, Krieg), generierte Aufträge, sieben Upgrade-Bereiche pro Schiff, Lackierungen, Schiffskauf und -verkauf.
- **Story:** acht Storymissionen mit drei Enden, siehe [docs/STORY.md](docs/STORY.md).
- **Audio komplett prozedural:** Laser, Explosionen, Triebwerk, Ambient-Score und ein improvisierendes Jazztrio (räumlich, mit Lichtverzögerung aus Kraken-Hafen).

## Technik

| Bereich | Umsetzung |
|---|---|
| Assets | Alle Modelle, Texturen und Renderings entstehen per Python-Skript in **Blender 5** (`blender/`), gesteuert über die lokale MCP-Bridge (`tools/bl.py`). |
| Himmel & Planeten | Prozedurale Shader, als Equirect-Texturen gerendert (Milchstraße 8K, Saturn 4K, Monde mit Höhenkarten). |
| Schiffe & Stationen | Prozedurale Hard-Surface-Modelle mit gebackenen PBR-Texturen (Basisfarbe, AO/Rauheit/Metall, Normalen, Lackmaske). |
| Räume | Cycles-Lightmaps (direktes und indirektes Licht), BVH-Kapselkollision im Browser. |
| Engine | three.js mit zwei Render-Ebenen (Kilometer für den Weltraum, Meter für Schiffe), logarithmischem Tiefenpuffer, Bloom und ACES-Tonemapping. |

```bash
npm install
npm run dev
```

Assets neu erzeugen (Blender muss mit aktivem MCP-Add-on laufen):

```bash
python3 tools/bl.py blender/ships.py spacewing
```

## Steuerung

**Im All:** Maus lenken · W/S Schub · A/D rollen · Shift Nachbrenner · Linksklick/Leertaste Laser · Rechtsklick/F Rakete · T Ziel · C Kamera · L andocken · M Systemkarte · Esc Pause

**Auf der Station:** WASD gehen · Shift laufen · Maus umsehen · E benutzen/sprechen · Tab Deckplan

## Asset-Lizenzen

Alles ist kostenlos und frei lizenziert. Es gibt keine bezahlten Assets, Abos oder Dienste.

| Was | Quelle | Lizenz |
|---|---|---|
| Körper, Hauttexturen, Augen, Brauen, Wimpern, Haare, Kleidung der NPCs | [MakeHuman System Assets, Skins 01/02](https://static.makehumancommunity.org/assets/assetpacks/index.html) | CC0 1.0 |
| Werkzeug zum Zusammenbauen (Rig „game_engine“) | [MPFB 2](https://extensions.blender.org/add-ons/mpfb/) (Blender-Erweiterung) | Code GPL 3, erzeugte Figuren CC0 |
| Animationen (Idle, Sitzen, Reden, Gehen, Trinken, …) | [Quaternius Universal Animation Library 1 + 2, Standard](https://opengameart.org/content/universal-animation-library-2) | CC0 1.0 |
| Alles andere (Schiffe, Stationen, Räume, Planeten, Himmel, Renderings, Audio) | eigene Blender-Skripte in `blender/`, prozedurales WebAudio | Projekt |

Die heruntergeladenen Pakete liegen außerhalb des Repos (`../SpaceWing_vendor`); `blender/humans.py` baut daraus die GLB-Dateien in `public/assets/npcs/` und retargetet die Animationen auf das MakeHuman-Rig.

**Grenze:** Fotorealistische, frei lizenzierte Menschen in Spielqualität gibt es kostenlos praktisch nicht. Scans und MetaHumans sind entweder lizenzgebunden oder an Dienste und Accounts gekoppelt. MakeHuman ist die realistischste wirklich freie Quelle. Die Figuren sind halbrealistisch, mit echten Fotohaut-Texturen, aber vereinfachten Haaren (Polygonschalen statt Strähnen) und ohne Gesichtsanimation.
