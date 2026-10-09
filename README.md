# SpaceWing – Die Ringe des Kronos

Ein Söldner-Weltraumspiel im Saturnsystem des Jahres 2260. Du startest pleite auf der Hochstation Cassini im Rhea-Orbit, fliegst deine erste Tour als Aushilfe auf einem rostigen Eisfrachter und bekommst danach einen alten Kurierjäger geschenkt: die SW-2 „Spacewing“. Von da an verdienst du Kredits mit Frachtaufträgen, Kopfgeldern und Eskorten, rüstest dein Schiff auf und gerätst in einen Handelskrieg zwischen den Saturnmonden, in dem es um eine Zukunftsprognose im Stil von Asimovs *Foundation* geht.

**Spielen:** https://simon23-12.github.io/SpaceWing/

## Features

- **Brückenübersicht im Stil von X-Wing Alliance:** ein in Cycles gerendertes Bild des Kommandodecks mit anklickbaren Bereichen (Bar, Hangar, Quartiere, Aussichtsplattform, Söldnerbörse, Werft, Systemkarte).
- **Begehbare Station in der Ich-Perspektive:** Kommandodeck, Bar „Cassini-Spalt“ mit live gespielter Hologramm-Jazzband, Hangar 7, Kabine und Aussichtsplattform. Die Beleuchtung jedes Raums ist in Blender als Global Illumination gebacken, durch die Fenster sieht man den echten Saturn.
- **Flug mit Verfolgerkamera oder Cockpit:** Das 3D-Cockpit hat Live-Anzeigen für Radar, Ziel und Systeme. Dazu kommen Flughilfe mit Newton-Modus, Nachbrenner, Laser, Raketen mit Zielerfassung, KI-Gegner, Eskorten und Andock-Autopilot.
- **Realistischer Saturn:** abgeplatteter Planet mit Wolkenbändern und Polarhexagon, Ringe mit realer Radialstruktur (C-, B- und A-Ring, Cassini-Teilung, Encke-Lücke, F-Ring), gegenseitige Schatten von Planet und Ringen sowie die Monde Mimas, Enceladus, Tethys, Dione, Rhea, Titan (mit Atmosphäre), Iapetus (zweifarbig, mit Äquatorgrat) und Phoebe.
- **Reisen per Fusionsbrand:** Bei der Fahrt zwischen den Monden zieht das Saturnsystem in Echtzeit vorbei.
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

**Auf der Station:** WASD gehen · Maus umsehen · E benutzen · Tab Brückenübersicht
