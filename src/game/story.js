import * as THREE from 'three';
import { addCredits, logEntry, addShip, fmt } from './state.js';

/*
 * Story missions. Each entry:
 *  title, giver, brief          – shown on the mission card
 *  available(g)                 – whether it can be offered now
 *  zone / anyZone               – where the flight script runs
 *  flight(c, game)              – async script (see missions.scriptContext)
 *  onDock(game, station)        – returns a dialogue (array) or null; may complete the mission
 *  ship                         – optional temporary ship record for this mission
 */

const MAGS = 'mags', KIX = 'kix', ODUYA = 'oduya', JUNO = 'juno', VARGA = 'varga', BRANDT = 'brandt', MORROW = 'morrow', NOOR = 'noor', VESPER = 'vesper', ROOK = 'rook', SAFFI = 'saffi';

export const PEOPLE = {
  mags:   { name: 'Mags Okafor', role: 'Eisfrachterpilotin · Ringgilde', color: '#ffcf7a', ini: 'MO' },
  kix:    { name: 'KX-9 „Kix“', role: 'Barkeeper · Cassini-Spalt', color: '#7fd4ff', ini: 'K9' },
  oduya:  { name: 'Femi Oduya', role: 'Dispatcher · Söldnerbörse', color: '#8fd18f', ini: 'FO' },
  haendler: { name: 'Lenka Brandvold', role: 'Werft & Markt', color: '#d39a6a', ini: 'LB' },
  juno:   { name: 'Dr. Juno Vesper', role: 'Archivarin · Iapetus', color: '#d7b8ff', ini: 'JV' },
  varga:  { name: 'Konsulin Aurelia Varga', role: 'Titan-Konsortium', color: '#f2c35a', ini: 'AV' },
  morrow: { name: 'Kapitän Dax Morrow', role: 'Goldene Lanzen', color: '#f2c35a', ini: 'DM' },
  brandt: { name: 'Kommodore Elias Brandt', role: 'Liga-Zollflotte', color: '#9fb4ff', ini: 'EB' },
  noor:   { name: 'Noor Haddad-Lund', role: 'Sprecherin · Enceladus-Kollektiv', color: '#6fc3ff', ini: 'NH' },
  vesper: { name: 'Prof. Lior Vesper', role: 'Aufzeichnung · 2241', color: '#d7b8ff', ini: 'LV' },
  rook:   { name: 'Silas Rook', role: 'Schakale von Phoebe', color: '#ff5a4a', ini: 'SR' },
  saffi:  { name: 'Saffi Lindqvist', role: 'Sängerin · Roche-Grenze', color: '#ff8ad8', ini: 'SL' },
  gast_kesh:  { name: 'Ol’ Kesh', role: 'Ringschürfer im Ruhestand · Ringgilde', color: '#9fd18f', ini: 'OK' },
  gast_rana:  { name: 'Rana Okonjo-Weiß', role: 'Reporterin · Saturn-Kurier', color: '#c8a0ff', ini: 'RO' },
  gast_tomas: { name: 'Tomas Reyes', role: 'Dockarbeiter · Hangar 7', color: '#d8b07a', ini: 'TR' },
  gast_ilse:  { name: 'Ilse Marangoni', role: 'Kurierpilotin', color: '#7fe0d8', ini: 'IM' },
  crew_a: { name: 'Deckwart Halvorsen', role: 'Stationsdienst · Deck 4', color: '#9fc4ff', ini: 'DH' },
  crew_b: { name: 'Sorrel Ndiaye', role: 'Lebenserhaltung · Deck 4', color: '#9fc4ff', ini: 'SN' },
  crew_c: { name: 'Ama Quist', role: 'Eisfrachterin aus Enceladus', color: '#bfe6ff', ini: 'AQ' },
  crew_d: { name: 'Yara Benedek', role: 'Mechanikerin · Werkstatt Hangar 7', color: '#ffd36a', ini: 'YB' },
  crew_e: { name: 'Jun Takeda', role: 'Liga-Zollbeamter (außer Dienst)', color: '#9fb4ff', ini: 'JT' },
  self:   { name: 'Du', role: '', color: '#7fd4ff', ini: '··' },
  comp:   { name: 'Bordcomputer', role: '', color: '#9fd6ff', ini: '>_' },
};

const say = (who, text, extra = {}) => ({ who, text, ...extra });

// ============================================================================ NPC conversations in the station

/**
 * Small dialogue tree: an opening line with topics, every topic returns to the menu.
 * topics: [{ q: question, a: [text | [who, text]], act?, if? }]
 */
function tree(who, intro, topics, bye = 'Bis dann.') {
  topics = topics.filter(t => t.if === undefined || t.if);
  const choices = topics.map((t, i) => ({ t: t.q, go: 't' + i })).concat([{ t: bye, end: true }]);
  const steps = [say(who, intro, { choices })];
  topics.forEach((t, i) => {
    t.a.forEach((line, k) => {
      const [w, text] = Array.isArray(line) ? line : [who, line];
      const last = k === t.a.length - 1;
      steps.push(say(w, text, { label: k === 0 ? 't' + i : undefined, ...(last ? { go: 'menu', act: t.act } : {}) }));
    });
  });
  steps.push(say(who, ['Sonst noch was?', 'Noch eine Frage?', 'Was noch?'][topics.length % 3], { label: 'menu', choices }));
  return steps;
}

const jumpHint = 'Für einen anderen Mond brauchst du ein Sprungtriebwerk. Klasse I reicht für Enceladus und Mimas, Titan braucht II, Iapetus III. Lenka baut dir eins ein.';

/** Short lines people say when you stop right in front of them (voiced, no dialogue box). */
export const BARKS = {
  mags: ['Na, Pilot. Setz dich, wenn du was willst.', 'Steh nicht so rum, du machst mich nervös.', 'Der Whisky hier ist schlecht. Ich trink ihn trotzdem.'],
  kix: ['Willkommen im Cassini-Spalt. Vier Arme, null Mitleid.', 'Noch einen? Ich zähle nicht mit. Doch, tue ich.', 'Bestellungen an der Theke, Beschwerden an die Wand.'],
  oduya: ['Neue Aufträge sind im Netz. Komm, schau sie dir an.', 'Fracht nach Inktomi wird immer gesucht.', 'Na, Pilot? Hunger auf Arbeit?'],
  haendler: ['Schiffe, Teile, Fracht. Was darf es sein?', 'Ehrliche Preise. Mehr oder weniger.', 'Fass nichts an, was du nicht kaufen willst.'],
  juno: ['Die Zahlen lügen nicht. Menschen schon.', 'Hast du kurz Zeit?'],
  gast_kesh: ['Hm? Ach, du bist es.', 'Meine Knie sagen, dass Sturm aufzieht. Im Weltraum.', 'Setz dich, Junge. Oder Mädel. Egal.'],
  gast_rana: ['Saturn-Kurier. Hast du was gesehen da draußen?', 'Jede Geschichte hat ihren Preis.', 'Na, Pilot? Was Neues?'],
  gast_tomas: ['Feierabend. Lass mich in Ruhe trinken.', 'Hangar sieben ist der beste. Merk dir das.', 'Was guckst du so?'],
  gast_ilse: ['Kurierpilotin. Immer in Eile.', 'Schöner Tag für einen Sprung, oder?', 'Hey, Kollege.'],
  crew_a: ['Verlaufen? Passiert jedem auf Deck vier.', 'Bitte nicht im Gang rennen.', 'Alles in Ordnung, Pilot?'],
  crew_b: ['Atmen nicht vergessen. Die Luft ist von mir.', 'Pause. Zehn Minuten. Dann wieder Filter.', 'Hallo.'],
  crew_c: ['Bald geht es zurück nach Enceladus.', 'Kalt hier, oder? Bei uns ist es kälter.', 'Hallo, Pilot.'],
  crew_d: ['Willkommen in meiner Werkstatt. Was soll ich schrauben?', 'Pass auf, der Boden ist ölig.', 'Na? Lust auf ein paar Mods?'],
  crew_e: ['Ich bin nicht im Dienst.', 'Abend.', 'Liga? Heute nicht.'],
};

export function npcDialogue(game, npc) {
  const g = game.state;
  const name = g.callsign;
  if (npc === MAGS) {
    if (g.story === 'prolog' || (g.story === 'eisfracht' && !g.flags['accepted:eisfracht'])) {
      return [
        say(MAGS, 'Du bist von Hallström, oder? Die Firma, die pleitegegangen ist. Setz dich.'),
        say(MAGS, 'Ich bin Mags. Ich fliege Eis von Enceladus hierher, seit vierzig Jahren. Fliegen kann ich noch. Aber seit einem Jahr zittern mir am Abzug die Hände.'),
        say(MAGS, 'Ich brauche jemanden im Turm, der trifft, während ich fliege. Eine Tour nach Enceladus und zurück. Zwölfhundert Kredits.', {
          choices: [
            { t: 'Zwölfhundert? Ich bin dabei.', go: 'yes' },
            { t: 'Warum ich? Hier sitzen hundert Piloten.', go: 'why' },
            { t: 'Ich überleg’s mir noch.', end: true },
          ] }),
        say(MAGS, 'Weil du nüchtern bist und hungrig aussiehst. Das sind die besten.', { label: 'why' }),
        say(MAGS, 'Und weil die anderen hundert mir Geld schulden.', { choices: [{ t: 'Na gut. Wann geht’s los?', go: 'yes' }, { t: 'Später.', end: true }] }),
        say(MAGS, 'Jetzt. Mein „Eisvogel“ steht in Hangar 7. Das schönste Schiff im Ring, und wehe, du sagst was anderes.', { label: 'yes', act: (gm) => acceptStory(gm, 'eisfracht') }),
        say(MAGS, 'Geh zum Hangar und steig ein, der Turm ist hinten oben. Ich sitze schon im Cockpit. Und, ' + name + ': Fass nichts Rotes an.'),
      ];
    }
    if (g.story === 'eisfracht' && g.flags['accepted:eisfracht']) return [say(MAGS, 'Was stehst du noch hier rum? Hangar 7. Der Eisvogel wartet.')];
    if (g.story === 'flugschule' && !g.flags['done:flugschule']) return [say(MAGS, 'Die Spacewing steht startklar in Hangar 7. Steig ein, ich fliege neben dir und zeig dir alles.')];
    if (g.flags.m4rescued && !g.flags.m5done) return [
      say(MAGS, 'Mein Bein ist Schrott, mein Schiff ist Schrott. Aber mein Kopf funktioniert.'),
      say(MAGS, 'Juno muss nach Iapetus. Du fliegst. Ich komme mit, weil ich Juno nicht allein lasse. Frag nicht. Noch nicht.'),
    ];
    if (g.flags.m5done && !g.flags.ending) return [
      say(MAGS, 'Ja. Ich arbeite für das Archiv, schon seit Teos Tod. Ich hätte es dir früher sagen sollen.'),
      say(MAGS, 'Varga kann jede Fraktion vorhersagen, jede Flotte und jeden Markt. Dich kann sie nicht vorhersagen. Du bist kein Datenpunkt, ' + name + '. Du bist ein Mensch mit einem rostigen Jäger.'),
    ];
    return tree(MAGS, ['Setz dich, ' + name + '. Die Spacewing zieht immer noch nach links, oder?', 'Na, Pilot. Was macht der Rost?', 'Trink nicht, was Kix „Spezial“ nennt. Was gibt’s?'][g.day % 3], [
      { q: 'Erzähl mir von der Spacewing.', a: ['Hawker-Lindqvist SW-2. Ein Keil mit zwei Triebwerken, so groß wie Frachtcontainer. Kein Flügel, keine Romantik. Im Vakuum braucht man keine Flügel, nur Schub und Nerven.', 'Teo hat sie vierzig Jahre geflogen. Die Kanonen schwenken, wenn du sie lässt. Und sie zieht nach links.'] },
      { q: 'Wie komme ich zu den anderen Monden?', a: [jumpHint, 'Und nicht jeder Mond lässt dich rein. Titan zum Beispiel will erst wissen, auf welcher Seite du stehst.'] },
      { q: 'Wer war Teo?', a: ['Mein Vater. Kurierflieger, Sturkopf, der beste Pilot im Ring. Ist vor acht Jahren bei Mimas verschwunden.', 'Er hätte dich gemocht. Er mochte Leute, die nicht aufgeben.'] },
      { q: 'Worum geht es in diesem Handelskrieg eigentlich?', a: ['Wasser, Methan, Helium. Enceladus hat das Wasser, Titan das Methan, die Ringe das Erz. Die Liga will an allem Zoll verdienen, das Konsortium will alles besitzen.', 'Und wir dazwischen fliegen das Zeug hin und her und werden beschossen. So ist das hier draußen.'] },
    ], 'Bis später, Mags.');
  }
  if (npc === KIX) {
    const lines = [
      [say(KIX, 'Willkommen im Cassini-Spalt. Die Band ist live, nur mit 2,3 Sekunden Verzögerung aus Kraken-Hafen. Der Whisky ist synthetisch, aber ehrlich.')],
      [say(KIX, 'Ich habe vier Arme und kein Mitleid. Was darf’s sein?')],
    ];
    if (g.story === 'prolog') return [
      say(KIX, 'Neu hier? Du siehst aus wie jemand mit vierzig Kredits und drei Nächten Kabinenmiete.'),
      say(KIX, 'Ein Rat, kostenlos, weil ich heute großzügig bin: Die Alte am Fenstertisch sucht einen Piloten. Mags Okafor. Sie beißt nicht. Meistens.', { act: (gm) => { gm.state.story = 'eisfracht'; } }),
    ];
    if (g.flags.m3done && !g.flags['accepted:funkstille']) return [
      say(KIX, name + '. Gut, dass du da bist. Mags ist seit zwei Tagen weg.'),
      say(KIX, 'Ihr Transponder hat sich zuletzt vom Ringrand bei Mimas gemeldet, aus dem Abbaufeld der Ringgilde. Dann nichts mehr.'),
      say(KIX, 'Sie hat ihre Rechnung offen gelassen. Mags lässt nie eine Rechnung offen.', { choices: [{ t: 'Ich fliege hin.', act: (gm) => acceptStory(gm, 'funkstille'), end: true }, { t: 'Gib mir eine Minute.', end: true }] }),
    ];
    return tree(KIX, lines[g.day % lines.length][0].text, [
      { q: 'Einen Whisky. (12 Cr)', a: ['Synthetisch, zwölf Jahre in einem Tank gereift, der früher Hydraulikflüssigkeit hatte. Wohl bekommt’s.'], act: (gm) => { if (gm.state.credits >= 12) { gm.state.credits -= 12; gm.ui.refreshTopbar(); gm.ui.notify('−12 Cr'); } else gm.ui.notify('Kix: „Kein Geld, kein Whisky.“'); } },
      { q: 'Was gibt’s Neues?', a: [g.flags.zoll ? 'Die Liga hat den Saturnzoll erhoben. Helium-3 kostet ein Viertel mehr, und im Ringgang wird geflucht.' : 'Gerüchte, dass die Liga einen Zoll auf alles erheben will, was den Saturn verlässt. Die Händler trinken schon vorsorglich.', 'Und auf Titan baut das Konsortium Kriegsschiffe und nennt sie Geleitschutz.'] },
      { q: 'Wer spielt da?', a: ['„Roche-Grenze“. Saffi Lindqvist, Bass und Rhodes. Sie spielen in Kraken-Hafen auf Titan, und wir kriegen sie als Hologramm. 2,3 Sekunden Lichtverzögerung, man hört es am Applaus.'] },
      { q: 'Wo finde ich Arbeit?', a: ['Femi Oduya an der Söldnerbörse, Kommandodeck. Fracht, Kopfgeld, Eskorte. Am Anfang alles hier im Rhea-Orbit, für die anderen Monde brauchst du ein Sprungtriebwerk.'] },
    ], 'Danke, Kix.');
  }
  if (npc === ODUYA) return tree(ODUYA, 'Söldnerbörse Cassini. Aufträge am Terminal, Beschwerden bei der Stationsmeisterin, Trinkgeld bei mir.', [
    { q: 'Zeig mir die Aufträge.', a: ['Bitte sehr. Frisch vom Netz.'], act: (gm) => gm.ui.openBoerse() },
    { q: 'Wer zahlt am besten?', a: ['Das Konsortium zahlt gut und vergisst nichts. Das Kollektiv zahlt wenig und vergisst nie, wer geholfen hat. Die Ringgilde zahlt in bar und in Schnaps.', 'Kopfgelder auf Schakale zahlt die Börse selbst. Die sind ehrlich verdient.'] },
    { q: 'Was hat es mit dem Zoll auf sich?', a: ['Die Liga der Inneren Welten sagt, der Saturn soll seinen Anteil an der Ordnung des Systems zahlen. Das Konsortium sagt, die Liga soll sich um ihre eigenen Planeten kümmern.', 'Ich sage: Solange beide streiten, gibt es Arbeit.'] },
    { q: 'Wie werde ich bekannter?', a: ['Verdien Geld. Ab zwanzigtausend Kredits nennt man dich hier Frachtpilot, dann öffnet sogar das Herschel-Depot auf Mimas seine Tore.'] },
  ], 'Danke, Femi.');
  if (npc === 'haendler') return tree('haendler', 'Lenka Brandvold, Werft und Markt. Schiffe, Teile, Fracht. Ehrliche Preise, mehr oder weniger.', [
    { q: 'Zeig mir Schiffe und Waren.', a: ['Leg los. Umbauen und Lackieren macht übrigens Yara, unten in ihrer Werkstatt in Hangar 7.'], act: (gm) => gm.ui.openWerft() },
    { q: 'Was kann ein Sprungtriebwerk?', a: [jumpHint.replace('Lenka baut dir eins ein.', 'Ich baue es dir ein.'), 'Ohne Sprung brauchst du für den Weg nach Titan zwei Wochen Fusionsbrand. Mit Sprung einen Herzschlag und einen Kater.'] },
    { q: 'Lohnt sich ein Apartment?', a: ['Wenn du auf zwei Stationen eins besitzt, reist du per Transit-Kapsel hin und her, ohne zu fliegen. Dein Schiff kommt mit dem Frachtdienst nach.', 'Kabine 4-117 kannst du hier am Terminal in deiner Kabine kaufen. Dann ist auch Schluss mit der Miete.'] },
    { q: 'Welches Schiff als Nächstes?', a: ['Die Kestrel ist ein echter Jäger. Die Mule fährt Fracht, viel Fracht. Wer Geld hat, nimmt die Corsair und wird in Ruhe gelassen.'] },
  ], 'Bis später, Lenka.');
  if (npc === JUNO) return tree(JUNO, 'Du bist also der Pilot, von dem Mags erzählt. Juno Vesper, Archiv von Iapetus.', [
    { q: 'Was ist die Vesper-Prognose?', a: ['Mein Großvater hat eine Mathematik entwickelt, die das Verhalten großer Gesellschaften vorhersagt. Nicht einzelner Menschen, nur von Millionen.', 'Die Prognose sagt dem Saturn dreißig Jahre Chaos voraus. Varga hat eine Kopie. Und sie will daraus eine Krone machen.'] },
    { q: 'Warum Iapetus?', a: ['Weil niemand dorthin fliegt. Eine Seite schwarz, eine weiß, ein Gebirge genau am Äquator. Ideal, um ein Archiv zu verstecken.'] },
  ], 'Auf bald, Juno.');
  // ------------------------------------------------------------------ people on the deck
  if (npc === 'gast_kesh') return tree(npc, 'Hm? Ach, der neue Pilot. Setz dich, mir tun die Knie weh, wenn ich hochgucke.', [
    { q: 'Wer bist du?', a: ['Kesh. Ol’ Kesh, sagen sie. Fünfzig Jahre Erz geschürft am Ringrand, bevor die Gilde mich in Rente geschickt hat. Jetzt schürfe ich hier nach Whisky.'] },
    { q: 'Wie ist es bei Mimas?', a: ['Der Todesstern. Ein Krater, so groß, dass der ganze Mond fast dabei zerbrochen wäre. Im Krater liegt das Herschel-Depot. Keine Fragen, keine Papiere.', 'Und dahinter der Ringrand, die Cassini-Teilung. Da haben wir Erz geschürft. Wunderschön und tödlich.'] },
    { q: 'Was hältst du vom Handelskrieg?', a: ['Die Gilde fliegt für keinen. Weder für die Liga noch für das Konsortium. Aber wenn einer anfängt, die Ringe zu besitzen, dann fliege ich wieder, Knie hin oder her.'] },
  ], 'Pass auf dich auf, Kesh.');
  if (npc === 'gast_rana') return tree(npc, 'Rana Okonjo-Weiß, Saturn-Kurier. Wenn du was gesehen hast, ich zahle für Geschichten.', [
    { q: 'Was schreibst du gerade?', a: [g.flags.zoll ? 'Über den Zoll. Wer ihn bezahlt, wer ihn eintreibt und wer ihn heimlich umgeht.' : 'Über die Liga. Sie schickt Korvetten in den Rhea-Orbit und nennt es Höflichkeitsbesuch.', 'Und über Titan. Das Konsortium kauft auffällig viele Kanonen für eine Firma, die angeblich Methan verkauft.'] },
    { q: 'Was weißt du über Titan?', a: ['Kraken-Hafen hängt über dem größten Methanmeer. Goldfassaden, Dunst so orange wie ein Sonnenuntergang, und eine Konsulin, die nie lächelt. Aurelia Varga.', 'Man sagt, Varga kennt die Zukunft. Ich halte das für Werbung.'] },
    { q: 'Hast du einen Tipp für mich?', a: ['Kopfgelder auf Schakale. Die Rotten werden besser bewaffnet, als sie es sich leisten können. Wer die Waffen liefert, ist meine nächste Geschichte.'] },
  ], 'Viel Glück mit der Geschichte.');
  if (npc === 'gast_tomas') return tree(npc, 'Feierabend. Endlich. Was willst du?', [
    { q: 'Wie ist die Arbeit im Hangar?', a: ['Laut, kalt, und alle zwei Stunden kommt ein Frachter, dessen Pilot glaubt, Andocken sei optional. Hangar 7 ist der beste. Der mit der Spacewing.'] },
    { q: 'Was kosten die Waren gerade?', a: ['Wasser kommt billig von Enceladus, Methan billig von Titan. Wer zwischen beiden fliegt, verdient. ' + (g.flags.zoll ? 'Nur Helium-3 ist teuer, seit der Zoll gilt.' : 'Noch.')] },
    { q: 'Wie lebt man auf der Station?', a: ['Der Ring dreht sich, deshalb stehen wir. Deck 4 hat den Ringgang, die Bar und die Kabinen. Oben die Kuppel, da sieht man den Saturn, wenn man den Lift nimmt.'] },
  ], 'Schönen Feierabend.');
  if (npc === 'gast_ilse') return tree(npc, 'Kurierpilotin. Ich fliege, was in einen Laderaum passt und schnell sein muss. Du auch?', [
    { q: 'Wie fühlt sich ein Hyperraumsprung an?', a: ['Erst lädt das Triebwerk, drei Sekunden, die sich anfühlen wie dreißig. Dann wird alles weiß, die Sterne ziehen sich zu Strichen.', 'Und dann bist du da, und der Saturn hängt an einer anderen Stelle im Himmel. Den immer im Blick behalten. Er ist der einzige Fixpunkt hier draußen.'] },
    { q: 'Welcher Mond ist der schönste?', a: ['Enceladus. Weiß wie frischer Schnee, und die Geysire leuchten im Gegenlicht. Titan ist eindrucksvoller, aber man sieht vor lauter Dunst nichts.', 'Iapetus ist unheimlich. Halb schwarz, halb weiß. Da fliege ich nur, wenn ich muss.'] },
    { q: 'Hast du Ärger mit Piraten?', a: ['Die Schakale von Phoebe. Früher Lumpen mit Schrottkanonen, heute fliegen sie mit Waffen, die neu riechen.'] },
  ], 'Guten Flug, Ilse.');
  if (npc === 'crew_a') return tree(npc, 'Deckwart Halvorsen. Verlaufen? Passiert jedem auf Deck 4.', [
    { q: 'Wo finde ich was?', a: ['Ringgang: Bar am Westende, Kabinen auf der Südseite, deine ist 4-117. Kommandodeck über die zwei großen Türen. Vom Kommandodeck nach Osten: Hangar 7 und der Lift zur Aussichtskuppel.'] },
    { q: 'Was ist oben in der Kuppel?', a: ['Glas, Pflanzen und der beste Blick auf den Saturn im ganzen System. Lift in der Lobby rufen, draufstellen, E drücken.'] },
  ], 'Danke.');
  if (npc === 'crew_b') return tree(npc, 'Pause. Sorrel, Lebenserhaltung. Die Luft, die du atmest, ist von mir. Bitte.', [
    { q: 'Wie funktioniert die Station?', a: ['Der Ring dreht sich, das gibt uns etwa ein Drittel g. Das Wasser kommt von Enceladus, der Strom aus dem Fusionskern in der Spindel. Und wenn irgendwas ausfällt, ruft man mich.'] },
    { q: 'Was passiert, wenn der Zoll kommt?', a: ['Dann wird das Wasser teurer, und die Leute duschen weniger. Und dann kommt der Ärger. Glaub mir, Lebenserhaltung ist Politik.'] },
  ], 'Danke, Sorrel.');
  if (npc === 'crew_c') return tree(npc, 'Ama Quist, Eisfrachterin. Ich bin nur auf der Durchreise nach Enceladus.', [
    { q: 'Wie ist es auf Enceladus?', a: ['Kalt. Die „Quelle“ liegt über den Tigerstreifen am Südpol, da bohren wir das Eis. Das Kollektiv gehört allen, die dort arbeiten. Kein Konsortium, keine Liga.'] },
    { q: 'Und der Handelskrieg?', a: ['Wenn Titan oder die Liga unsere Quelle blockieren, verdurstet der halbe Saturn. Das wissen alle. Genau deshalb haben wir Angst.'] },
  ], 'Gute Reise.');
  if (npc === 'crew_d') return tree(npc, g.ships.length ? 'Willkommen in meiner Werkstatt. Was soll ich an deinem Schiff schrauben?' : 'Yara, Mechanikerin. Das hier ist meine Werkstatt. Komm wieder, wenn du ein eigenes Schiff hast.', [
    { q: 'Bau mir was ein. (Werkstatt)', if: g.ships.length > 0, a: ['Zeig her, was du an Kredits hast. Mods, Reparaturen, neuer Lack. Alles, was die alte Dame aushält.'], act: (gm) => gm.ui.openWerkstatt() },
    { q: 'Wie verdiene ich am Anfang Geld?', a: ['Fracht. Zwischen Cassini, dem Bergbauposten Inktomi und dem Depot L4 gibt es immer etwas zu fahren, ganz ohne Sprung.', 'Und wenn dich Schakale überfallen: Nachbrenner und weg, die Wespen holen dich hier im Rhea-System nicht ein. Oder du schießt sie ab und sammelst die Trümmer ein. Schrott kauft jede Station.'] },
    { q: 'Was bringt ein Bergungsnetz?', a: ['Ab Werk passen zwei Tonnen Trümmer ins Netz der Spacewing. Jede Stufe, die ich dir einbaue, drei Tonnen mehr. Bei den Preisen für Schrott rechnet sich das schnell.'] },
    { q: 'Was würdest du an der Spacewing verbessern?', a: ['Erst das Sprungtriebwerk, sonst bleibst du ewig bei Rhea. Dann Schilde. Die SW-2 hat einen Rumpf wie ein Panzer, aber Schilde wie ein Regenschirm.'] },
    { q: 'Warum sieht sie aus wie ein Keil?', a: ['Weil im All Flügel nichts bringen. Alles, was zählt, sind die zwei großen Triebwerke hinten und die schwenkbaren Kanonen an den Seiten. Der Rumpf hält nur alles zusammen.'] },
  ], 'Danke, Yara.');
  if (npc === 'crew_e') return tree(npc, 'Jun Takeda. Ja, Liga. Nein, ich bin nicht im Dienst. Und nein, ich weiß nichts über die Korvetten.', [
    { q: 'Was will die Liga hier draußen?', a: ['Ordnung. So sagen sie es jedenfalls. Die Inneren Welten brauchen Helium-3 für ihre Reaktoren. Der Saturn hat es. Den Rest kannst du dir denken.'] },
    { q: 'Bist du für den Zoll?', a: ['Ich bin für meinen Feierabend. Aber unter uns: Ein Zoll ohne Rückhalt ist nur eine Einladung für Schmuggler.'] },
  ], 'Schönen Abend noch.');
  return [say(npc, '…')];
}

export function acceptStory(game, id) {
  const g = game.state;
  g.story = id;
  g.flags['accepted:' + id] = true;
  logEntry(g, `Storymission angenommen: ${STORY[id].title}`);
  game.ui.notify(`Neue Mission: ${STORY[id].title}`);
}

function completeStory(game, id, reward, next, text) {
  const g = game.state;
  g.flags['done:' + id] = true;
  if (reward) addCredits(g, reward, `Mission „${STORY[id].title}“`);
  g.story = next;
  logEntry(g, text || `Mission abgeschlossen: ${STORY[id].title}`);
  game.audio?.coins();
}

// ============================================================================ missions

export const STORY = {
  prolog: { title: 'Drei Nächte Miete', brief: 'Sprich in der Bar mit dem Barkeeper.' },

  // ------------------------------------------------------------------------ M1 (gunner: Mags flies, the player shoots)
  eisfracht: {
    title: 'Eisfracht', giver: MAGS, anyZone: true,
    brief: 'Flieg mit Mags Okafor auf ihrem Frachter „Eisvogel“ nach Enceladus und zurück. Mags fliegt, du sitzt im Kugelturm und hältst Piraten auf Abstand.',
    ship: { cls: 'eisvogel', upgrades: {}, paint: null, cargo: {}, uid: 'TEMP-EISVOGEL', name: '„Eisvogel“', gunner: true },
    async flight(c, game) {
      const g = game.state, f = c.flight, p = f.player;
      const stage = g.flags.m1stage || 0;
      const jump = (zone) => f.travelTo(zone, () => game.arrive(f, zone), { jump: true });
      const M = (t) => ['Mags', t, 'ringgilde'];
      if (f.zoneId === 'rhea' && stage === 0) {
        const d = f.station.dock;
        p.ai = { mode: 'goto', point: d.pos.clone().addScaledVector(d.dir, 1900).add(new THREE.Vector3(0, 250, 0)), throttle: 0.55, arrive: 150 };
        c.objective('Im Kugelturm mitfliegen');
        await c.wait(2);
        await c.talk([
          M('Sitzt du? Gut. Willkommen im Turm. Ich fliege, du schießt. Die Maus dreht den Turm, links klicken feuert.'),
          M('Probier ruhig ein paar Schüsse. Hier draußen ist nichts außer Eis, Funkverkehr und dem alten Saturn.'),
          M('Gleich springen wir nach Enceladus. Beim ersten Sprung wird jedem schlecht. Nicht in meinen Turm kotzen.'),
        ]);
        await c.until(() => p.ai.mode !== 'goto');
        c.objective('Hyperraumsprung nach Enceladus');
        jump('enceladus');
      } else if (f.zoneId === 'enceladus' && stage === 0) {
        const st = f.station;
        const beacon = st.dock.pos.clone().addScaledVector(st.dock.dir, 700).add(new THREE.Vector3(0, -150, 0));
        f.addWaypoint('ice', beacon, 'Ladebake');
        p.ai = { mode: 'goto', point: beacon, throttle: 0.7, arrive: 140, then: 'idle' };
        await c.wait(3);
        await c.talk([
          ['Quelle Flugleitung', 'Eisvogel, willkommen in der Quelle. Eure Ladung steht an Bake drei. Wie immer gut gekühlt.', 'kollektiv'],
          M('Siehst du die Geysire? Hundert Kilometer hohe Wasserfontänen. Davon lebt das ganze System.'),
        ]);
        c.objective('Mags fliegt zur Ladebake');
        await c.until(() => p.ai.mode !== 'goto');
        p.ai = { mode: 'idle', throttle: 0 };
        c.objective('Container werden verladen …');
        f.hud.showToast('ANDOCKKLAMMERN GREIFEN', 2.5);
        await c.wait(6);
        f.removeWaypoint('ice');
        p.record.cargo = { wasser: 36 };
        p.cargoLabel = '36 t Wasser-Eis';
        f.hud.showToast('36 T WASSER-EIS GELADEN', 2.5);
        g.flags.m1stage = 1;
        await c.wait(1.5);
        await c.talk([M('Schön. Jetzt nach Hause, bevor …')]);
        const wave = await c.pirates(3, p.pos.clone().add(new THREE.Vector3(1, 0.3, 0.6).normalize().multiplyScalar(3000)), { dist: 300, skill: 0.45, upgrades: { lasers: 2 } });
        p.ai = { mode: 'orbit', center: beacon.clone(), radius: 650, throttle: 0.5 };
        await c.talk([
          ['Schakal Alpha', 'Na, wen haben wir denn da. Die alte Okafor mit einem Bauch voller Eis.', 'schakale'],
          M('… bevor genau das passiert. Drei Wespen! Ich halte uns in Bewegung, du hältst sie uns vom Leib.'),
          M('T schaltet die Ziele durch. Der kleine Kreis zeigt dir, wohin du vorhalten musst.'),
        ]);
        c.objective('Die Schakale abwehren');
        let line = 0;
        await c.until(() => {
          const left = c.alive(wave).length;
          if (left === 2 && line === 0) { line++; c.say('Mags', 'Einer weniger! Die Waffen dieser Wespen sind neu. Zu neu für Schakale.', 'ringgilde'); }
          if (left === 1 && line === 1) { line++; c.say('Mags', 'Noch einer! Halt drauf, ich dreh uns quer.', 'ringgilde'); }
          return left === 0;
        });
        g.flags.m1stage = 2;
        p.ai = { mode: 'idle', throttle: 0.2 };
        await c.talk([
          M('Ha! Nicht schlecht für jemanden, der vor einer Woche noch Kisten für Hallström gefahren hat.'),
          M('Merk dir das Wappen auf den Wracks. Ein Schakal mit Konsortiums-Kanonen. Jemand bezahlt die.'),
          M('Kurs Rhea. Festhalten.'),
        ]);
        c.objective('Hyperraumsprung nach Rhea');
        jump('rhea');
      } else if (f.zoneId !== 'rhea' && stage >= 1) {
        await c.wait(2);
        c.say('Mags', 'Ab nach Hause.', 'ringgilde');
        c.objective('Hyperraumsprung nach Rhea');
        await c.wait(3);
        jump('rhea');
      } else if (f.zoneId === 'rhea' && stage >= 1) {
        const d = f.station.dock;
        p.ai = { mode: 'goto', point: d.pos.clone().addScaledVector(d.dir, 900), throttle: 0.6, arrive: 200 };
        await c.wait(2);
        c.say('Mags', 'Da ist sie, unsere Cassini. Ich bring uns rein.', 'ringgilde');
        c.objective('Mags dockt an der Hochstation Cassini an');
        await c.until(() => p.ai.mode !== 'goto' || c.near(d.pos, 1200));
        g.flags.m1stage = 2;
        f.requestDock();
      } else {
        await c.wait(2);
        jump('enceladus');
      }
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'cassini' || (g.flags.m1stage || 0) < 2) return null;
      return [
        say(MAGS, 'So. Sechsunddreißig Tonnen Eis, null Kratzer am Eisvogel. Du schießt besser, als du aussiehst.', { scene: 'hangar' }),
        say(MAGS, 'Hier sind deine zwölfhundert. Und noch etwas.'),
        say(MAGS, 'Die SW-2 da hinten in der Ecke. Eine Hawker-Lindqvist „Spacewing“. Sie hat Teo gehört, meinem Vater. Er ist vor acht Jahren bei Mimas verschwunden.'),
        say(MAGS, 'Seitdem steht sie hier rum und rostet, und ich zahle Hangarmiete für einen Geist. Sie gehört dir.', {
          choices: [{ t: 'Das kann ich nicht annehmen.', go: 'no' }, { t: 'Danke, Mags. Ich pass auf sie auf.', go: 'yes' }] }),
        say(MAGS, 'Doch, kannst du. Sie will fliegen und ich habe meinen Eisvogel. Ende der Diskussion.', { label: 'no', go: 'yes2' }),
        say(MAGS, 'Ich weiß.', { label: 'yes' }),
        say(MAGS, 'Sie ist eine Rostlaube, aber sie fliegt. Bevor du damit Aufträge annimmst, drehen wir eine Runde, und ich bringe dir bei, wie man sie fliegt.', { label: 'yes2',
          act: (gm) => {
            completeStory(gm, 'eisfracht', 1200, 'flugschule', 'Erste Tour mit Mags. Die Spacewing gehört jetzt dir.');
            const s = addShip(gm.state, 'spacewing', 'Spacewing');
            s.hull = 0.72;
            gm.state.activeShip = s.uid;
            gm.state.flags.m1done = true;
            gm.state.rep.ringgilde += 5;
            acceptStory(gm, 'flugschule');
          } }),
        say(MAGS, 'Steig in Hangar 7 ein, wenn du so weit bist. Ich fliege mit dem Eisvogel neben dir.'),
      ];
    },
  },

  // ------------------------------------------------------------------------ M1b: flight school in the Spacewing
  flugschule: {
    title: 'Flugstunde', giver: MAGS, zone: 'rhea',
    brief: 'Mags bringt dir bei, wie man die Spacewing fliegt: lenken, Schub, rollen, Nachbrenner, Waffen, Raketen und Andocken. Start in Hangar 7.',
    async flight(c, game) {
      const g = game.state, f = c.flight, p = f.player;
      if (g.flags['done:flugschule'] || f.opts.spawn !== 'undock') return;
      const M = (t) => ['Mags', t, 'ringgilde'];
      const st = f.station;
      const mags = await f.spawn({ cls: 'eisvogel', faction: 'ringgilde', name: 'Mags · „Eisvogel“', pos: p.pos.clone().add(new THREE.Vector3(60, 30, 40)), quat: p.quat.clone(),
        tags: ['ally'], invulnerable: true, ai: { mode: 'escort', leader: p, offset: new THREE.Vector3(70, 25, 60), aggressive: false } });
      const ahead = (dist, side = 0, up = 0) => p.pos.clone().addScaledVector(p.forward(new THREE.Vector3()), dist).addScaledVector(p.right(new THREE.Vector3()), side).addScaledVector(p.up(new THREE.Vector3()), up);
      const ring = async (pos, label) => {
        f.addWaypoint('ring', pos, label);
        await c.until(() => c.near(pos, 120));
        f.removeWaypoint('ring');
        game.audio?.blip?.();
      };
      await c.wait(2.5);
      await c.talk([M('So, Pilot. Die Spacewing gehorcht der Maus. Der kleine Punkt in der Mitte ist dein Steuerknüppel. Je weiter weg, desto schneller drehst du.')]);
      c.objective('Mit der Maus lenken: zur Markierung fliegen');
      await ring(ahead(1100, 500, 260), 'Markierung');
      await c.talk([M('Gut. W gibt Schub, S nimmt ihn weg. Mit 1 bis 4 setzt du feste Stufen, X stoppt sofort.')]);
      c.objective('Auf über 180 m/s beschleunigen [W]');
      await c.until(() => p.speed() > 180);
      c.objective('Abbremsen auf unter 30 m/s [S] oder [X]');
      await c.until(() => p.speed() < 30);
      await c.talk([M('A und D rollen das Schiff um die Längsachse. Q und E schieben dich seitwärts. Damit weichst du aus, ohne die Nase vom Ziel zu nehmen.')]);
      c.objective('Einmal um die eigene Achse rollen [A] / [D]');
      let roll = 0;
      await c.until(dt => { roll += Math.abs(p.angVel.z) * dt; return roll > Math.PI * 1.8; });
      await c.talk([M('C wechselt zwischen Außenkamera und Cockpit. Probier beides, nimm, was dir liegt.')]);
      c.objective('Kamera wechseln [C]');
      const cam0 = f.camMode;
      await c.until(() => f.camMode !== cam0);
      await c.talk([M('Shift ist der Nachbrenner. Schnell, aber er frisst Energie, und ohne Energie schießt du nicht.')]);
      c.objective('Nachbrenner 3 Sekunden halten [Shift]');
      let boost = 0;
      await c.until(dt => { if (p.input.boost && p.energy > 5) boost += dt; return boost > 3; });
      c.objective('Zur nächsten Markierung fliegen');
      await ring(ahead(1400, -600, -200), 'Markierung');
      // gunnery: three target drones that do not shoot back
      const center = ahead(900);
      const drones = await c.spawnWave([0, 1, 2].map(i => ({ cls: 'wespe', faction: 'neutral', name: `Zieldrohne ${i + 1}`, paint: '#e8e8e8',
        pos: center.clone().add(new THREE.Vector3((i - 1) * 140, (i % 2) * 60, 0)), tags: ['noFriendlyFire', 'objective'],
        ai: { mode: 'patrol', center: center.clone(), radius: 260, aggressive: false } })));
      drones.forEach(d => { d.stats = { ...d.stats, speed: 70, boost: 90 }; d.shield = 0; d.maxShield = 1; d.hull = d.maxHull = 90; });
      await c.talk([
        M('Ich habe drei Zieldrohnen ausgesetzt. Die schießen nicht zurück, also keine Ausreden.'),
        M('T schaltet die Ziele durch. Der kleine Kreis vor dem Ziel ist der Vorhaltepunkt. Linksklick oder Leertaste feuert.'),
      ]);
      c.objective('Die drei Zieldrohnen abschießen [T] · [Linksklick]');
      await c.until(() => c.alive(drones).length === 0);
      const last = await f.spawn({ cls: 'wespe', faction: 'neutral', name: 'Zieldrohne „Hartnäckig“', paint: '#e8e8e8', pos: ahead(1300, 200, 100), tags: ['noFriendlyFire', 'objective'],
        ai: { mode: 'patrol', center: ahead(1300), radius: 400, aggressive: false } });
      last.stats = { ...last.stats, speed: 120 }; last.shield = 0; last.maxShield = 1; last.hull = last.maxHull = 130;
      p.target = last;
      await c.talk([M('Die da ist zäher. Halt sie im Visier, bis der Kreis rot wird, dann Rechtsklick oder F. Rakete raus.')]);
      c.objective('Die zähe Drohne mit einer Rakete treffen [Rechtsklick] / [F]');
      await c.until(() => !last.alive);
      await c.talk([
        M('Sauber. M öffnet die Systemkarte. Da siehst du die Monde. Für die anderen brauchst du ein Sprungtriebwerk von Lenka.'),
        M('Und jetzt nach Hause. Flieg auf unter drei Kilometer an die Andockbucht und drück L. Den Rest macht der Leitstrahl.'),
      ]);
      g.flags.m1bflown = true;
      c.objective('An der Hochstation Cassini andocken [L]');
      mags.ai = { mode: 'goto', point: st.dock.pos.clone().addScaledVector(st.dock.dir, 600).add(new THREE.Vector3(150, 80, 0)), throttle: 0.6, arrive: 100 };
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'cassini' || !g.flags.m1bflown) return null;
      return [
        say(MAGS, 'Na also. Du fliegst wie jemand, der es ernst meint. Teo hätte gelacht und dir sofort den Steuerknüppel geklaut.', { scene: 'hangar' }),
        say(MAGS, 'Für den Sprit gebe ich dir dreihundert dazu. Ab jetzt verdienst du dein Geld selbst: Söldnerbörse auf dem Kommandodeck, bei Femi.', {
          act: (gm) => completeStory(gm, 'flugschule', 300, 'zoll', 'Flugstunde mit Mags. Die Spacewing gehorcht.') }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M2
  zoll: {
    title: 'Ordnung durch Zoll', giver: ODUYA, zone: 'rhea',
    available: (g) => g.flags.m1done && (g.earned >= 4500 || g.day >= 3),
    brief: 'Der Kollektiv-Tanker „Tropfen 7“ erreicht Rhea mit Wasser für die Station. Die Liga hat einen neuen Kontrollpunkt eingerichtet. Begleite den Tanker zur Andockbucht. Zahlung: 3.500 Cr.',
    async flight(c, game) {
      const g = game.state, f = c.flight;
      if (g.flags['done:zoll']) return;
      await c.wait(3);
      const st = f.station.pos;
      const start = st.clone().add(new THREE.Vector3(-0.7, 0.2, 0.7).normalize().multiplyScalar(6500));
      const tanker = await f.spawn({ cls: 'mule', faction: 'kollektiv', name: 'Tanker „Tropfen 7“', pos: start, lookAt: st, paint: '#2f6fd1', tags: ['objective', 'ally'],
        ai: { mode: 'goto', point: start.clone().lerp(st, 0.45), throttle: 0.5, arrive: 150, aggressive: false } });
      await c.talk([['Tropfen 7', 'Hier Tanker Tropfen 7, voll mit Enceladus-Wasser. Wir freuen uns über Begleitung, ' + g.callsign + '.', 'kollektiv']]);
      c.objective('Tanker „Tropfen 7“ begleiten');
      await c.until(() => tanker.ai.mode !== 'goto' || !tanker.alive);
      tanker.ai = { mode: 'idle', throttle: 0 };
      const kpos = tanker.pos.clone().add(new THREE.Vector3(800, 300, -900));
      const korv = await f.spawn({ cls: 'korvette', faction: 'liga', name: 'Zollkorvette „Unbestechlich“', pos: kpos, lookAt: tanker.pos, invulnerable: true, ai: { mode: 'idle', throttle: 0 } });
      const escorts = await c.spawnWave([0, 1].map(i => ({ cls: 'kestrel', faction: 'liga', name: `Liga-Zollkutter ${i + 1}`, pos: kpos.clone().add(new THREE.Vector3(i ? 200 : -200, -100, 300)), paint: '#e8ecef', ai: { mode: 'escort', leader: tanker, offset: new THREE.Vector3(i ? 120 : -120, 60, 80), aggressive: false } })));
      await c.talk([
        ['Kommodore Brandt', 'Tanker Tropfen 7, hier spricht Kommodore Elias Brandt, Liga der Inneren Welten. Triebwerke aus. Zollinspektion.', 'liga'],
        ['Tropfen 7', 'Inspektion? Wir liefern Wasser an eine Freistation. Dafür gibt es keinen Zoll.', 'kollektiv'],
        ['Kommodore Brandt', 'Seit heute schon. Verordnung 2260/14, Saturnzoll. Vierzig Prozent auf alle strategischen Güter. Wasser ist strategisch.', 'liga'],
        ['Tropfen 7', 'Vierzig Prozent? Das ist Diebstahl!', 'kollektiv'],
        ['Kommodore Brandt', 'Das ist Ordnung. Ihre Ladung wird zur Hälfte beschlagnahmt. ' + g.callsign + ', Sie fliegen Begleitschutz? Halten Sie sich raus. Das ist ein guter Rat.', 'liga'],
      ]);
      f.hud.showToast('LADUNG BESCHLAGNAHMT', 3);
      tanker.cargoLabel = 'Halbe Ladung beschlagnahmt';
      await c.wait(3);
      await c.talk([['Kommodore Brandt', 'Inspektion abgeschlossen. Gute Weiterreise. Ordnung durch Zoll.', 'liga']]);
      korv.ai = { mode: 'goto', point: kpos.clone().add(new THREE.Vector3(0, 3000, -8000)), throttle: 1 };
      escorts.forEach(e => { e.ai = { mode: 'goto', point: kpos.clone().add(new THREE.Vector3(0, 3000, -8000)), throttle: 1 }; });
      await c.wait(9);
      [korv, ...escorts].forEach(s => s.alive && f.jumpOut(s));
      tanker.ai = { mode: 'goto', point: f.station.dock.pos.clone().addScaledVector(f.station.dock.dir, 350), throttle: 0.5, arrive: 180, aggressive: false };
      await c.wait(6);
      const wave = await c.pirates(3, tanker.pos.clone().add(new THREE.Vector3(0, 600, 0)), { dist: 2200, target: tanker, skill: 0.5 });
      await c.talk([
        ['Schakal Alpha', 'Die Liga hat schon vorgekostet, jetzt sind wir dran! Danke für die Inspektion, Kommodore!', 'schakale'],
        ['Tropfen 7', 'Sie greifen uns an, kaum dass die Liga weg ist! Hilfe!', 'kollektiv'],
      ]);
      c.objective('Tanker „Tropfen 7“ gegen die Schakale verteidigen');
      await c.until(() => c.alive(wave).length === 0 || !tanker.alive);
      if (!tanker.alive) {
        c.objective('Der Tanker ist verloren. Zur Station zurückkehren.');
        g.flags.zollFailed = true;
      } else {
        await c.talk([
          ['Tropfen 7', 'Danke. Die Hälfte unserer Ladung ist weg, aber wir leben. Das Kollektiv wird sich das merken. Beides.', 'kollektiv'],
          ['Tropfen 7', 'Ist dir aufgefallen, wie genau die Schakale wussten, wann die Liga abzieht?', 'kollektiv'],
        ]);
        c.objective('Tanker in Sicherheit – an der Cassini andocken [L]');
      }
      g.flags.m2flown = true;
      await c.until(() => !tanker.alive || tanker.ai.mode !== 'goto');
      if (tanker.alive) f.jumpOut(tanker);
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'cassini' || !g.flags.m2flown) return null;
      const ok = !g.flags.zollFailed;
      return [
        say(ODUYA, ok ? 'Der Tanker ist durch. Gute Arbeit. Die Hälfte des Wassers hat die Liga, die andere Hälfte haben wir, und du hast das hier.' : 'Den Tanker hat es erwischt. Du bekommst die Grundgebühr. Das Kollektiv ist trotzdem dankbar, dass es jemand versucht hat.'),
        say(ODUYA, 'Und merk dir: Ab heute kostet Helium-3 mehr, und Wasser auch. Der Saturnzoll verändert alles.', { act: (gm) => {
          completeStory(gm, 'zoll', ok ? 3500 : 1500, 'lanzen', 'Der Saturnzoll ist da. Die Preise steigen.');
          gm.state.flags.zoll = true; gm.state.rep.kollektiv += ok ? 10 : 4; gm.state.rep.liga -= 5;
        } }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M3
  lanzen: {
    title: 'Goldene Lanzen', giver: ODUYA, zone: 'titan',
    available: (g) => g.flags['done:zoll'],
    brief: 'Ein versiegelter Datenkern muss nach Kraken-Hafen auf Titan, persönlich an das Büro der Konsulin Varga. Absender unbekannt, Bezahlung großzügig: 4.000 Cr.',
    onAccept(game) { game.state.flags.datacore = true; },
    async flight(c, game) {
      const g = game.state, f = c.flight;
      if (g.flags['done:lanzen'] || f.opts.spawn !== 'arrive') return;
      await c.wait(2.5);
      const lz = await c.spawnWave([0, 1].map(i => ({ cls: 'lanze', faction: 'konsortium', name: i ? 'Lanze Zwei' : 'Kapitän Morrow', pos: f.player.pos.clone().add(new THREE.Vector3(i ? 300 : -300, 120, -600)),
        ai: { mode: 'escort', leader: f.player, offset: new THREE.Vector3(i ? 90 : -90, 30, 60), skill: 0.75 }, upgrades: { lasers: 2 } })));
      await c.talk([
        ['Kapitän Morrow', 'Pilot ' + g.callsign + '? Dax Morrow, Goldene Lanzen. Die Konsulin erwartet Ihre Lieferung. Wir begleiten Sie, zu Ihrem Schutz.', 'konsortium'],
        ['Kapitän Morrow', 'Titan ist schön von hier oben, nicht wahr? Unter dem Dunst liegt das reichste Meer des Systems.', 'konsortium'],
      ]);
      c.objective('Mit Eskorte nach Kraken-Hafen fliegen');
      await c.until(() => f.player.pos.distanceTo(f.station.pos) < 3200);
      const wave = await c.pirates(4, f.player.pos.clone().add(new THREE.Vector3(-1, 0.2, -0.3).normalize().multiplyScalar(2500)), { dist: 300, skill: 0.5 });
      await c.talk([['Kapitän Morrow', 'Schakale, sogar hier. Lanzen, Feuer frei! ' + g.callsign + ', zeigen Sie uns, was Sie können.', 'konsortium']]);
      c.objective('Schakale abwehren');
      await c.until(() => c.alive(wave).length === 0);
      await c.talk([
        ['Kapitän Morrow', 'Sauber. Sie fliegen besser, als Ihr Schiff aussieht. Docken Sie an, die Konsulin wartet nicht gern.', 'konsortium'],
        ['Kapitän Morrow', 'Seltsam, nicht? Die Schakale wussten genau, wann wir kommen.', 'konsortium'],
      ]);
      c.objective('In Kraken-Hafen andocken [L]');
      g.flags.m3flown = true;
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'kraken' || !g.flags.m3flown) return null;
      return [
        say(VARGA, 'Pilot ' + g.callsign + '. Die Konsulin persönlich, ja. Ich nehme meine Post gern selbst entgegen.', { scene: 'kraken' }),
        say(VARGA, 'Wissen Sie, was in diesem Kern ist? Natürlich nicht. Zahlen. Bevölkerungsdaten, Handelsströme, Geburtenraten. Langweilig für die meisten. Für mich die Zukunft.'),
        say(VARGA, 'Sie fliegen mit Magdalena Okafor. Eine bemerkenswerte Frau, mit bemerkenswerten Freunden auf Iapetus.'),
        say(VARGA, 'Ich mache Ihnen ein Angebot: Das Doppelte Ihres Lohns, jeden Monat. Dafür sagen Sie mir, wohin Mags fliegt. Nur wohin. Nichts weiter.', {
          choices: [
            { t: 'Abgemacht. Geld ist Geld.', act: (gm) => { gm.state.flags.spy = true; gm.state.rep.konsortium += 25; addCredits(gm.state, 2000, 'Vorschuss der Konsulin'); }, go: 'spy' },
            { t: 'Nein. Ich verkaufe keine Freunde.', act: (gm) => { gm.state.rep.konsortium -= 10; gm.state.rep.ringgilde += 5; }, go: 'nospy' },
          ] }),
        say(VARGA, 'Vernünftig. Morrow wird sich bei Ihnen melden. Willkommen in der Zukunft, Pilot.', { label: 'spy', go: 'end' }),
        say(VARGA, 'Loyalität. Wie altmodisch. Und wie vorhersehbar. Gehen Sie, Ihr Lohn ist überwiesen.', { label: 'nospy' }),
        say('comp', 'Nachricht von Mags: „Hab gehört, du warst auf Titan. Komm vorbei, wenn du zurück bist. Wir müssen reden.“', { label: 'end',
          act: (gm) => { completeStory(gm, 'lanzen', 4000, 'funkstille', 'Datenkern an Konsulin Varga übergeben.'); gm.state.flags.m3done = true; delete gm.state.flags.datacore; } }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M4
  funkstille: {
    title: 'Funkstille', giver: KIX, zone: 'rings',
    available: (g) => g.flags.m3done,
    brief: 'Mags ist verschwunden. Ihr Transponder meldete sich zuletzt vom Ringrand im Mimas-System, dem Abbaufeld der Ringgilde. Finde den Eisvogel.',
    async flight(c, game) {
      const g = game.state, f = c.flight;
      if (g.flags.m4rescued) { c.objective('Zurück zur Hochstation Cassini (Rhea)'); return; }
      await c.wait(3);
      const wreckPos = f.player.pos.clone().add(new THREE.Vector3(0.6, -0.05, -1).normalize().multiplyScalar(4200));
      const wreck = await f.spawn({ cls: 'eisvogel', faction: 'neutral', name: 'Eisvogel (treibend)', pos: wreckPos, invulnerable: true, tags: ['objective', 'noFriendlyFire'], ai: { mode: 'idle', throttle: 0 } });
      wreck.angVel.set(0.02, 0.05, 0.01);
      wreck.ai = null;
      wreck.input.throttle = 0;
      await c.talk([
        ['Bordcomputer', 'Schwaches Transpondersignal empfangen: SANKT ROSTIG. Keine Triebwerksaktivität.', 'neutral'],
        ['Ringgilde Patrouille', 'Pilot, wir haben den Eisvogel auch gesehen. Wir kommen nicht nah ran, da draußen jagen Schakale. Viel Glück.', 'ringgilde'],
      ]);
      c.objective('Den Eisvogel finden');
      f.addWaypoint('wreck', wreckPos, 'Eisvogel');
      await c.until(() => c.near(wreck.pos, 1600));
      const wave = await c.pirates(5, wreck.pos.clone().add(new THREE.Vector3(0, 300, 0)), { dist: 1400, skill: 0.55, upgrades: { lasers: 4, shield: 2 } });
      await c.talk([
        ['Schakal Alpha', 'Der Bergungstrupp ist da! Erledigt ihn, der Auftraggeber zahlt für jeden, der hier schnüffelt.', 'schakale'],
        ['Mags (schwach)', g.callsign + '? Bist du das? Die haben Lanzenkanonen. Konsortiumsware. Pass auf.', 'ringgilde'],
      ]);
      c.objective('Die Schakale ausschalten');
      await c.until(() => c.alive(wave).length === 0);
      await c.talk([['Mags (schwach)', 'Gut gemacht. Jetzt komm ganz nah ran, auf unter 200 Meter, und halt still. Meine Rettungskapsel klemmt.', 'ringgilde']]);
      c.objective('Am Eisvogel unter 200 m halten');
      let hold = 0;
      await c.until(dt => { if (c.near(wreck.pos, 200 + wreck.hitRadius)) hold += dt; else hold = Math.max(0, hold - dt); if (hold > 0) f.objective(`Andockklammer … ${Math.min(100, Math.round(hold / 6 * 100))} %`); return hold > 6; });
      f.removeWaypoint('wreck');
      f.hud.showToast('MAGS AN BORD', 2.5);
      g.flags.m4rescued = true;
      await c.talk([
        ['Mags', 'Danke. Mein Bein ist hin, und mein Eisvogel auch. Aber ich habe etwas gefunden: Frachtpapiere der Schakal-Wespen. Bezahlt von einer Briefkastenfirma auf Titan.', 'ringgilde'],
        ['Mags', 'Bring mich nach Hause. Da wartet jemand, den du kennenlernen musst.', 'ringgilde'],
      ]);
      c.objective('Mags zur Hochstation Cassini bringen (Rhea)');
      g.flags.evidence1 = true;
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'cassini' || !g.flags.m4rescued || g.flags['done:funkstille']) return null;
      return [
        say(MAGS, 'Setz dich. Das hier ist Juno. Dr. Juno Vesper.', { scene: 'bar' }),
        say(JUNO, 'Hallo. Ich weiß, wer Sie sind. Ich habe Sie berechnet. Das heißt, eigentlich habe ich Sie nicht berechnet, und genau deshalb bin ich hier.'),
        say(JUNO, 'Mein Großvater hat ein Modell entwickelt, die Vesper-Prognose. Es sagt voraus, wie sich das Saturnsystem verhalten wird. Nicht einzelne Menschen, sondern alle zusammen.'),
        say(JUNO, 'Seit sechs Monaten weicht die Realität vom Modell ab. Zum ersten Mal in neunzehn Jahren. Jemand greift ein und kennt dabei unsere Zahlen.'),
        say(MAGS, 'Und dieser Jemand sitzt auf Titan und trägt Gold.'),
        say(JUNO, 'Ich muss ins Gewölbe auf Iapetus. Dort liegen die Aufzeichnungen meines Großvaters. Die nächste öffnet sich in drei Tagen.', {
          choices: [{ t: 'Ich bringe euch hin.', go: 'ok' }, { t: 'Das klingt nach Ärger.', go: 'arg' }] }),
        say(MAGS, 'Ist es auch. Bezahlt wird trotzdem. Sechstausend.', { label: 'arg' }),
        say(JUNO, 'Danke. Iapetus liegt weit draußen. Rechnen Sie mit Gesellschaft.', { label: 'ok',
          act: (gm) => { completeStory(gm, 'funkstille', 5000, 'gewoelbe', 'Mags gerettet. Juno Vesper getroffen.'); acceptStory(gm, 'gewoelbe'); } }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M5
  gewoelbe: {
    title: 'Das Gewölbe', giver: JUNO, zone: 'iapetus',
    available: (g) => g.flags['done:funkstille'],
    brief: 'Bringe Mags und Juno Vesper nach Iapetus zum Gewölbe des Archivs. Das Konsortium wird versuchen, euch aufzuhalten.',
    async flight(c, game) {
      const g = game.state, f = c.flight;
      if (g.flags['done:gewoelbe'] || f.opts.spawn !== 'arrive') return;
      f.missionBlocksDock = 'Das Gewölbe öffnet sich erst, wenn der Luftraum frei ist';
      await c.wait(3);
      await c.talk([
        ['Juno', 'Iapetus. Eine Seite schwarz wie Teer, die andere weiß wie Schnee. Und quer über den Äquator ein Grat, zwanzig Kilometer hoch. Da drin ist das Gewölbe.', 'archiv'],
      ]);
      const lz = await c.spawnWave([0, 1, 2].map(i => ({ cls: 'lanze', faction: 'konsortium', name: i ? `Goldene Lanze ${i + 1}` : 'Kapitän Morrow', pos: f.player.pos.clone().add(new THREE.Vector3(-1500 + i * 600, 400, -2600)),
        lookAt: f.player.pos, ai: { mode: 'idle', throttle: 0.2 }, upgrades: { lasers: 3, shield: 2 } })));
      await c.talk([
        ['Kapitän Morrow', g.callsign + '. Sie haben Passagiere an Bord, die die Konsulin sprechen möchte. Drehen Sie bei und folgen Sie uns nach Titan.', 'konsortium'],
        ...(g.flags.spy ? [['Kapitän Morrow', 'Sie haben uns nicht gemeldet, wohin Sie fliegen. Die Konsulin ist enttäuscht. Ich auch.', 'konsortium']] : []),
        ['Mags', 'Antworte nicht. Das ist Morrows freundliche Stimme. Die unfreundliche hat Kanonen.', 'ringgilde'],
        ['Kapitän Morrow', 'Letzte Warnung.', 'konsortium'],
      ]);
      for (const s of lz) { s.ai = { mode: 'attack', skill: 0.7, aggroRange: 9000 }; s.target = f.player; }
      f.setHostile('konsortium', 'player');
      c.objective('Die Goldenen Lanzen abwehren');
      await c.until(() => c.alive(lz).length === 0 || c.alive(lz).every(s => s.hull < s.maxHull * 0.3));
      for (const s of c.alive(lz)) { s.ai = { mode: 'flee' }; }
      await c.talk([
        ['Kapitän Morrow', 'Rückzug! Das hier ist nicht vorbei, ' + g.callsign + '.', 'konsortium'],
        ['Juno', 'Das Gewölbe sendet die Freigabe. Andocken, schnell.', 'archiv'],
      ]);
      f.setHostile('konsortium', 'player', false);
      f.missionBlocksDock = null;
      g.flags.m5flown = true;
      c.objective('Am Gewölbe andocken [L]');
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'gewoelbe' || !g.flags.m5flown || g.flags['done:gewoelbe']) return null;
      return [
        say(JUNO, 'Hier ist es. Die Kammer meines Großvaters. Gleich fünf Uhr Systemzeit, genau wie berechnet.', { scene: 'vault' }),
        say(VESPER, 'Guten Tag. Ich bin Lior Vesper, oder vielmehr war ich es. Wenn Sie mich sehen, ist das Jahr 2260, und die Liga hat den Saturnzoll erhoben.'),
        say(VESPER, 'Das ist die erste Krise. Sie war unvermeidlich. Ihre Lösung ist es auch: Die Monde werden lernen, dass sie einander brauchen. Wasser gegen Treibstoff, Erz gegen Nahrung.'),
        say(VESPER, 'So jedenfalls meine Zahlen. Und jetzt hören Sie gut zu.'),
        say(VESPER, 'Wenn Sie diese Aufzeichnung sehen und das Konsortium Enceladus noch nicht blockiert hat, dann kennt jemand meine Zahlen und spielt mit ihnen.'),
        say(VESPER, 'Ein Mensch mit der Prognose in der Hand kann Krisen auslösen, statt sie zu lösen. Er kann aus dreißig dunklen Jahren dreihundert machen, oder ein Reich, das tausend Jahre lang niemand mehr infrage stellt.'),
        say(VESPER, 'Ich kann Ihnen nicht sagen, was Sie tun sollen. Mein Modell kennt Sie nicht. Das ist das einzige Geschenk, das ich Ihnen machen kann.'),
        say(JUNO, '… Das Konsortium hat Enceladus noch nicht blockiert. Aber es wird kommen. Varga hat die Zahlen, und sie schreibt die Zukunft um.'),
        say(MAGS, 'Dann schreiben wir zurück. ' + g.callsign + ', du bist unsere Unbekannte in Vargas Gleichung.', { act: (gm) => {
          completeStory(gm, 'gewoelbe', 6000, 'blockade', 'Die erste Vesper-Aufzeichnung gesehen.');
          gm.state.flags.m5done = true; gm.state.flags.gewoelbeOpen = true; gm.state.rep.archiv += 25;
        } }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M6
  blockade: {
    title: 'Blockade', giver: NOOR, zone: 'enceladus',
    available: (g) => g.flags.m5done,
    brief: 'Das Titan-Konsortium hat ein Treibstoff- und Medizinembargo gegen Enceladus verhängt. Das Kollektiv braucht Medizin. Brich durch die Blockade der Lanzen und dock an der Quelle an. Zahlung: 8.000 Cr.',
    onAccept(game) { game.state.flags.embargo = true; },
    async flight(c, game) {
      const g = game.state, f = c.flight;
      if (g.flags['done:blockade'] || f.opts.spawn !== 'arrive') return;
      f.allowHotDock = true;
      await c.wait(2);
      const st = f.station.pos;
      const ring = [];
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        ring.push({ cls: i === 0 ? 'corsair' : 'lanze', faction: 'konsortium', name: i === 0 ? 'Kanonenboot „Goldwacht“' : `Blockadelanze ${i}`, paint: i === 0 ? '#d1a23a' : null,
          pos: st.clone().add(new THREE.Vector3(Math.cos(a) * 1600, 300 * Math.sin(a * 2), Math.sin(a) * 1600)).addScaledVector(f.player.pos.clone().sub(st).normalize(), 1500),
          ai: { mode: 'patrol', center: st.clone().addScaledVector(f.player.pos.clone().sub(st).normalize(), 1500), radius: 900, skill: 0.65, aggroRange: 3200 }, upgrades: { lasers: 2 } });
      }
      const blk = await c.spawnWave(ring);
      f.setHostile('konsortium', 'player');
      await c.talk([
        ['Goldwacht', 'Unbekanntes Schiff, Enceladus steht unter Embargo des Titan-Konsortiums. Drehen Sie ab oder Sie werden beschossen.', 'konsortium'],
        ['Noor Haddad-Lund', g.callsign + ', hier Noor, Sprecherin des Kollektivs. Wir haben Kinder mit Strahlenkrankheit. Bitte. Durchbrechen, Andocken mit L geht auch unter Beschuss.', 'kollektiv'],
      ]);
      c.objective('Durch die Blockade brechen und an der Quelle andocken [L]');
      g.flags.m6flown = true;
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'quelle' || !g.flags.m6flown || g.flags['done:blockade']) return null;
      return [
        say(NOOR, 'Ihr habt es geschafft. Ich weiß nicht, wie ich danken soll, also tue ich es mit Kredits und Wasser. Die Kredits sind überwiesen, das Wasser ist Ehrensache.', { scene: 'quelle' }),
        say(NOOR, 'Varga behauptet, wir horten Wasser, um Titan zu erpressen. Die Liga behauptet, wir sind Schmuggler. Dabei wollen wir nur, dass das System atmen kann.'),
        say(NOOR, 'Juno sagt, die Schakale werden von Titan bezahlt. Wenn du das beweisen kannst, steht das ganze System hinter dir. Die Beweise liegen auf Phoebe, im Schakalnest.', { act: (gm) => {
          completeStory(gm, 'blockade', 8000, 'schakalnest', 'Blockade von Enceladus durchbrochen.');
          gm.state.rep.kollektiv += 20; gm.state.rep.konsortium -= 20; gm.state.flags.krieg = true;
        } }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M7
  schakalnest: {
    title: 'Schakalnest', giver: NOOR, zone: 'phoebe',
    available: (g) => g.flags['done:blockade'],
    brief: 'Fliege nach Phoebe, schalte die Verteidigung des Schakalnests aus und lade Silas Rooks Logbücher herunter, um Vargas Verbindung zu den Schakalen zu beweisen. Zahlung: 12.000 Cr.',
    async flight(c, game) {
      const g = game.state, f = c.flight;
      if (g.flags.evidence2) { c.objective('Beweise sichern: Zurück nach Rhea'); return; }
      await c.wait(2);
      await c.talk([['Juno (Funk)', 'Phoebe. Ein eingefangener Komet, dunkler als Kohle. Das Nest liegt direkt vor dir. Rooks Logbuchserver hängt am Hauptmodul.', 'archiv']]);
      c.objective('Die Verteidiger des Schakalnests ausschalten');
      let wave = await c.pirates(4, f.station.pos.clone(), { dist: 900, skill: 0.55, upgrades: { lasers: 3 } });
      await c.until(() => c.alive(wave).length <= 1);
      const rook = await f.spawn({ cls: 'corsair', faction: 'schakale', name: 'Silas Rook', paint: '#2a2c30', pos: f.station.pos.clone().add(new THREE.Vector3(0, 800, 0)), lookAt: f.player.pos,
        ai: { mode: 'attack', skill: 0.75, aggroRange: 9000 }, upgrades: { lasers: 3, shield: 3, armor: 3 } });
      rook.target = f.player;
      wave = wave.concat(await c.pirates(3, f.station.pos.clone(), { dist: 1200, skill: 0.6 }));
      await c.talk([
        ['Silas Rook', 'Du bist also der kleine Datenfehler, über den sich die Konsulin so aufregt. Weißt du, was sie für deinen Kopf zahlt?', 'schakale'],
        ['Silas Rook', 'Ich auch nicht. Aber genug für ein neues Nest.', 'schakale'],
      ]);
      c.objective('Silas Rook und seine Rotte ausschalten');
      await c.until(() => c.alive(wave).length === 0 && !rook.alive);
      await c.talk([['Juno (Funk)', 'Rook ist erledigt. Flieg nah an das Hauptmodul, unter 400 Meter. Ich zapfe den Server an.', 'archiv']]);
      c.objective('Unter 400 m am Schakalnest halten');
      let hold = 0;
      await c.until(dt => { if (c.near(f.station.pos, 400 + 150)) hold += dt; f.objective(`Download … ${Math.min(100, Math.round(hold / 8 * 100))} %`); return hold > 8; });
      g.flags.evidence2 = true;
      await c.talk([
        ['Juno (Funk)', 'Ich hab es. Zahlungen über drei Briefkastenfirmen, alle mit Kraken-Hafen als Sitz. Freigaben mit Vargas persönlichem Siegel. Und Einsatzpläne, die zu genau zu den Vesper-Zahlen passen.', 'archiv'],
        ['Mags (Funk)', 'Komm nach Hause. Jetzt müssen wir entscheiden, was wir damit machen.', 'ringgilde'],
      ]);
      c.objective('Zurück zur Hochstation Cassini (Rhea)');
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'cassini' || !g.flags.evidence2 || g.flags['done:schakalnest']) return null;
      return [
        say(MAGS, 'Du hast es geschafft. Setz dich, wir haben nicht viel Zeit.', { scene: 'bar' }),
        say(JUNO, 'Die Liga-Flotte ist unterwegs. Brandt will „Ordnung herstellen“. Und Varga hat ihre Lanzen in der Cassini-Teilung versammelt. Sie will die Liga in den Ringen vernichten und sich danach als Retterin des Saturn krönen lassen.'),
        say(JUNO, 'Das hat sie aus der Prognose. Ein äußerer Feind, ein gemeinsamer Sieg, und danach eine Krone. Sie weiß nur eines nicht: was du tun wirst.'),
        say(MAGS, 'Also, ' + g.callsign + '. Was machst du mit den Beweisen?', { act: (gm) => completeStory(gm, 'schakalnest', 12000, 'kassini', 'Beweise gegen Varga gesichert.') }),
      ];
    },
  },

  // ------------------------------------------------------------------------ M8
  kassini: {
    title: 'Die Kassini-Teilung', giver: MAGS, zone: 'rings',
    available: (g) => g.flags['done:schakalnest'],
    brief: 'Die Liga-Flotte und Vargas Lanzen treffen sich in der Cassini-Teilung. Entscheide, was mit den Beweisen geschieht, und flieg in die letzte Schlacht.',
    async flight(c, game) {
      const g = game.state, f = c.flight;
      const end = g.flags.ending;
      if (!end || g.flags['done:kassini']) return;
      await c.wait(2);
      const center = f.player.pos.clone().add(new THREE.Vector3(0, 0, -4000));
      if (end === 'foederation') {
        const flag = await f.spawn({ cls: 'korvette', faction: 'konsortium', name: 'Flaggschiff „Kronjuwel“', paint: '#d1a23a', pos: center.clone().add(new THREE.Vector3(0, 200, -1500)), lookAt: f.player.pos, ai: { mode: 'patrol', center, radius: 600, aggroRange: 3000 } });
        flag.maxHull = flag.hull = 4200; flag.maxShield = flag.shield = 2400; flag.tags.add('objective');
        const lz = await c.spawnWave([0, 1, 2, 3, 4].map(i => ({ cls: 'lanze', faction: 'konsortium', name: i ? `Goldene Lanze ${i}` : 'Kapitän Morrow', pos: center.clone().add(new THREE.Vector3((i - 2) * 400, 300, 0)), ai: { mode: 'attack', skill: 0.7, aggroRange: 9000 }, upgrades: { lasers: 3, shield: 2 } })));
        const allies = await c.spawnWave([
          { cls: 'corsair', faction: 'ringgilde', name: 'Ol’ Kesh', paint: '#4f8a52', pos: f.player.pos.clone().add(new THREE.Vector3(-200, 50, 200)), ai: { mode: 'attack', skill: 0.6, aggroRange: 9000 } },
          { cls: 'kestrel', faction: 'kollektiv', name: 'Kollektiv-Staffel 1', paint: '#2f6fd1', pos: f.player.pos.clone().add(new THREE.Vector3(200, 50, 200)), ai: { mode: 'attack', skill: 0.6, aggroRange: 9000 } },
          { cls: 'kestrel', faction: 'kollektiv', name: 'Kollektiv-Staffel 2', paint: '#2f6fd1', pos: f.player.pos.clone().add(new THREE.Vector3(300, -50, 300)), ai: { mode: 'attack', skill: 0.6, aggroRange: 9000 } },
        ]);
        f.setHostile('konsortium', 'player'); f.setHostile('konsortium', 'kollektiv'); f.setHostile('konsortium', 'ringgilde');
        await c.talk([
          ['Juno (Funk)', 'Die Beweise laufen auf allen Kanälen, auf jedem Mond, in jeder Bar. Die Liga hat das Feuer eingestellt. Brandt hört zu.', 'archiv'],
          ['Konsulin Varga', 'Wie töricht. Ich hätte dem Saturn tausend Jahre Frieden geschenkt.', 'konsortium'],
          ['Ol’ Kesh', 'Frieden mit einer Krone obendrauf. Nein danke. Die Ringgilde fliegt mit dir, ' + g.callsign + '!', 'ringgilde'],
        ]);
        c.objective('Das Flaggschiff „Kronjuwel“ zerstören');
        await c.until(() => !flag.alive);
        for (const s of c.alive(lz)) s.ai = { mode: 'flee' };
        g.flags.finaleWon = true;
        await c.talk([
          ['Kapitän Morrow', 'Die Konsulin … ist entkommen. Lanzen, wir ergeben uns. Das hier war nie unser Krieg.', 'konsortium'],
          ['Mags (Funk)', 'Du hast es geschafft. Komm nach Hause.', 'ringgilde'],
        ]);
      } else if (end === 'zoll') {
        const korv = await f.spawn({ cls: 'korvette', faction: 'liga', name: 'Liga-Schlachtkorvette „Ordnung“', pos: center.clone(), lookAt: f.player.pos, ai: { mode: 'idle' } });
        korv.tags.add('objective'); korv.tags.add('ally');
        f.setHostile('konsortium', 'player'); f.setHostile('konsortium', 'liga');
        await c.talk([
          ['Kommodore Brandt', 'Ihre Beweise sind in der Hand der Liga. Gute Wahl. Die Liga vergisst ihre Freunde nicht. Ihre Feinde auch nicht.', 'liga'],
          ['Konsulin Varga', 'Sie haben das System an die Erde verkauft, ' + g.callsign + '. Lanzen, alles auf die Korvette!', 'konsortium'],
        ]);
        c.objective('Die Liga-Korvette gegen drei Angriffswellen verteidigen');
        for (let w = 0; w < 3; w++) {
          const wave = await c.spawnWave([0, 1, 2].map(i => ({ cls: 'lanze', faction: 'konsortium', name: `Lanze ${w + 1}-${i + 1}`, pos: center.clone().add(new THREE.Vector3((i - 1) * 500, 400, -3000)), ai: { mode: 'attack', skill: 0.6, aggroRange: 9000 }, upgrades: { lasers: 2 } })));
          wave.forEach(s => s.target = korv);
          await c.until(() => c.alive(wave).length === 0 || !korv.alive);
          if (!korv.alive) break;
          if (w < 2) c.say('Kommodore Brandt', `Welle ${w + 1} abgewehrt. Da kommen noch mehr.`, 'liga');
        }
        g.flags.finaleWon = korv.alive;
        await c.talk([[korv.alive ? 'Kommodore Brandt' : 'Mags (Funk)', korv.alive ? 'Der Saturn steht unter dem Schutz der Liga. Ordnung durch Zoll. Willkommen in der neuen Zeit.' : 'Die Korvette ist weg. Komm zurück, bevor sie dich auch erwischen.', korv.alive ? 'liga' : 'ringgilde']]);
      }
      c.objective('Zurück zur Hochstation Cassini (Rhea)');
      g.flags.m8flown = true;
    },
    onDock(game, station) {
      const g = game.state;
      if (station !== 'cassini' || !g.flags.m8flown || g.flags['done:kassini']) return null;
      return endingDialogue(game);
    },
  },
};

export function finaleChoice(game) {
  const g = game.state;
  return [
    say(MAGS, 'Drei Wege, ' + g.callsign + '. Du kannst die Beweise an alle senden, an jeden Mond und jede Bar. Dann kämpfen wir in den Ringen gegen Varga, zusammen mit allen, die mitkommen.', { scene: 'bar' }),
    say(JUNO, 'Du kannst sie Brandt geben. Die Liga zerschlägt das Konsortium, und Saturn wird eine Kolonie der Erde. Ruhig, sicher und unfrei.'),
    say(MAGS, 'Oder du schweigst. Varga zahlt dafür mehr, als du je verdienen wirst. Sie gewinnt, und der Saturn bekommt seine Krone.', {
      choices: [
        { t: 'Alle sollen es wissen. Wir kämpfen.', act: (gm) => { gm.state.flags.ending = 'foederation'; }, go: 'f' },
        { t: 'Ich gebe die Beweise der Liga.', act: (gm) => { gm.state.flags.ending = 'zoll'; }, go: 'z' },
        { t: 'Ich schweige. Für Vargas Geld.', act: (gm) => { gm.state.flags.ending = 'krone'; }, go: 'k' },
        { t: 'Ich brauche noch Zeit.', end: true },
      ] }),
    say(MAGS, 'Dann flieg in die Cassini-Teilung. Die Ringgilde und das Kollektiv treffen dich dort.', { label: 'f', go: 'go' }),
    say(JUNO, 'Brandt erwartet dich in der Cassini-Teilung. Ich hoffe, du weißt, was du tust.', { label: 'z', go: 'go' }),
    say(MAGS, '… Ich hätte nicht gedacht, dass du so jemand bist. Geh. Varga zahlt beim Andocken auf Titan.', { label: 'k', act: (gm) => { acceptStory(gm, 'kassini'); }, end: true }),
    say('comp', 'Neues Ziel: Mimas-System, Ringrand an der Cassini-Teilung (Systemkarte).', { label: 'go', act: (gm) => acceptStory(gm, 'kassini') }),
  ];
}

export function kroneEnding(game) {
  const g = game.state;
  return [
    say(VARGA, 'Ein vernünftiger Mensch. Ich wusste es. Nein, eigentlich wusste ich es nicht, und das hat mich nervös gemacht.', { scene: 'kraken' }),
    say(VARGA, 'Hier sind Ihre zwei Millionen. Morgen schlagen meine Lanzen die Liga in der Cassini-Teilung. Übermorgen krönt man mich. Und in hundert Jahren erinnert sich niemand mehr, dass man auch Nein hätte sagen können.', {
      act: (gm) => { addCredits(gm.state, 2000000, 'Schweigegeld der Konsulin'); gm.state.flags['done:kassini'] = true; gm.state.story = 'ende'; gm.state.flags.endingShown = 'krone'; } }),
  ];
}

function endingDialogue(game) {
  const g = game.state;
  const end = g.flags.ending;
  if (end === 'foederation') return [
    say(MAGS, 'Varga ist auf der Flucht, die Lanzen haben kapituliert. Brandt ist abgezogen, weil kein Zoll der Welt einen ganzen Planeten aufhält, der sich einig ist.', { scene: 'bar' }),
    say(JUNO, 'Heute Morgen hat sich das Gewölbe von selbst geöffnet, außerplanmäßig. Mein Großvater hat nur einen Satz gesagt.'),
    say(VESPER, '„Dreißig Jahre. Vielleicht weniger.“'),
    say(SAFFI, 'Hey, ' + g.callsign + '. Die Roche-Grenze spielt heute live, ganz ohne Lichtverzögerung. Das nächste Stück ist für dich und die Spacewing. Mein Großvater hat sie gebaut. Er wäre stolz.', { act: (gm) => {
      completeStory(gm, 'kassini', 25000, 'ende', 'ENDE: Die Föderation des Saturn.'); gm.state.flags.endingShown = 'foederation';
      gm.state.rep.kollektiv += 30; gm.state.rep.ringgilde += 30; gm.state.rep.archiv += 30;
    } }),
  ];
  if (end === 'zoll') return [
    say(BRANDT, 'Das Konsortium ist aufgelöst, Varga in Liga-Gewahrsam. Der Saturn ist ab heute ein Protektorat der Inneren Welten. Danke für Ihre Kooperation.', { scene: 'bar' }),
    say(MAGS, 'Ruhig ist es jetzt. Die Preise sind niedrig, die Zölle hoch, und keiner mehr widerspricht.'),
    say(JUNO, 'Das Modell sagt, der große Krieg kommt trotzdem. Nur später. In vierzig Jahren, wenn die Erde zu schwach ist, uns zu halten.', { act: (gm) => {
      completeStory(gm, 'kassini', 20000, 'ende', 'ENDE: Ordnung durch Zoll.'); gm.state.flags.endingShown = 'zoll'; gm.state.rep.liga += 40;
    } }),
  ];
  return null;
}
