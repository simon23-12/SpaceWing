// Rebindable controls: keyboard keys (by physical key code) and joystick / gamepad buttons and axes per device.
// Stored in localStorage under 'spacewing.controls'. Labels follow the user's keyboard layout where the browser tells us.

const STORE = 'spacewing.controls';

/** [id, label, context, default keys] – context 'flug' or 'station' (the same key may be used once per context). */
export const ACTIONS = [
  ['throttleUp', 'Schub erhöhen', 'flug', ['KeyW']],
  ['throttleDown', 'Schub verringern', 'flug', ['KeyS']],
  ['throttleStop', 'Schub null', 'flug', ['KeyX', 'Backspace']],
  ['boost', 'Nachbrenner', 'flug', ['ShiftLeft', 'ShiftRight']],
  ['rollLeft', 'Rollen links', 'flug', ['KeyA']],
  ['rollRight', 'Rollen rechts', 'flug', ['KeyD']],
  ['pitchDown', 'Nase runter', 'flug', ['ArrowUp']],
  ['pitchUp', 'Nase hoch', 'flug', ['ArrowDown']],
  ['yawLeft', 'Gieren links', 'flug', ['ArrowLeft']],
  ['yawRight', 'Gieren rechts', 'flug', ['ArrowRight']],
  ['strafeLeft', 'Seitwärts links', 'flug', ['KeyQ']],
  ['strafeRight', 'Seitwärts rechts', 'flug', ['KeyE']],
  ['strafeUp', 'Schub nach oben', 'flug', ['PageUp']],
  ['strafeDown', 'Schub nach unten', 'flug', ['PageDown']],
  ['fire', 'Laser (auch linke Maustaste)', 'flug', ['Space']],
  ['missile', 'Rakete (auch rechte Maustaste)', 'flug', ['KeyF']],
  ['targetNext', 'Nächstes Ziel', 'flug', ['KeyT']],
  ['targetPrev', 'Vorheriges Ziel', 'flug', ['KeyR']],
  ['targetAim', 'Ziel am Fadenkreuz', 'flug', ['KeyG', 'KeyY']],
  ['camera', 'Cockpit / Verfolgerkamera', 'flug', ['KeyC']],
  ['assist', 'Flughilfe an/aus', 'flug', ['KeyZ']],
  ['dock', 'Andocken', 'flug', ['KeyL']],
  ['map', 'Systemkarte', 'flug', ['KeyM']],
  ['help', 'Tastenhilfe im HUD', 'flug', ['KeyH']],
  ['walkFwd', 'Gehen vorwärts', 'station', ['KeyW']],
  ['walkBack', 'Gehen rückwärts', 'station', ['KeyS']],
  ['walkLeft', 'Gehen links', 'station', ['KeyA']],
  ['walkRight', 'Gehen rechts', 'station', ['KeyD']],
  ['run', 'Rennen', 'station', ['ShiftLeft']],
  ['use', 'Benutzen / Sprechen', 'station', ['KeyE']],
  ['deckplan', 'Deckplan', 'station', ['Tab']],
  ['stats', 'Pilotenstatus (Reputation, Kredits)', 'station', ['KeyP']],
  ['menu', 'Menü (zusätzlich zu Esc)', 'beide', []],
];
export const ACTION = Object.fromEntries(ACTIONS.map(a => [a[0], { id: a[0], label: a[1], ctx: a[2], keys: a[3] }]));

/** Flight axes a joystick can drive. */
export const AXES = [['pitch', 'Nicken'], ['yaw', 'Gieren'], ['roll', 'Rollen'], ['throttle', 'Schub (Hebel)']];

// ------------------------------------------------------------------ keyboard labels

const NAMES = {
  Space: 'Leertaste', Backspace: '⌫', Tab: 'Tab', Enter: 'Enter', ShiftLeft: 'Shift links', ShiftRight: 'Shift rechts',
  ControlLeft: 'Strg links', ControlRight: 'Strg rechts', AltLeft: 'Alt', AltRight: 'Alt Gr', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  PageUp: 'Bild ↑', PageDown: 'Bild ↓', Home: 'Pos1', End: 'Ende', Insert: 'Einfg', Delete: 'Entf', CapsLock: 'Feststell',
};
let layout = null;
navigator.keyboard?.getLayoutMap?.().then(m => { layout = m; }).catch(() => {});

/** Printable name of a key code on this keyboard (e.g. KeyY is "Z" on a German keyboard). */
export function keyLabel(code) {
  if (!code) return '–';
  if (NAMES[code]) return NAMES[code];
  const l = layout?.get(code);
  if (l && l.trim()) return l.length === 1 ? l.toUpperCase() : l;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

// ------------------------------------------------------------------ storage

let data = { keys: {}, pads: {} };
try { Object.assign(data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { } };

export function keysFor(id) { return data.keys[id] || ACTION[id].keys; }

/** Bind a key to an action (slot 0/1). The key is taken away from any other action of the same context. */
export function bindKey(id, slot, code) {
  const ctx = ACTION[id].ctx;
  const stolen = [];
  if (code) for (const a of ACTIONS) {
    if (a[0] === id || (a[2] !== ctx && a[2] !== 'beide' && ctx !== 'beide')) continue;
    const ks = keysFor(a[0]);
    if (ks.includes(code)) { data.keys[a[0]] = ks.filter(k => k !== code); stolen.push(a[1]); }
  }
  const ks = [...keysFor(id)];
  if (code) ks[slot] = code; else ks.splice(slot, 1);
  data.keys[id] = [...new Set(ks.filter(Boolean))];
  save();
  return stolen;
}
export function resetKeys() { data.keys = {}; save(); }

/** Key and joystick bindings for the JSON save file. */
export function exportControls() { return JSON.parse(JSON.stringify(data)); }
/** Restore bindings from a save file (replaces the ones in this browser). */
export function importControls(c) {
  if (!c || typeof c !== 'object') return false;
  data = { keys: { ...(c.keys || {}) }, pads: { ...(c.pads || {}) } };
  save();
  return true;
}

/** One readable key for prompts and objectives, e.g. K('dock') → "L". */
export const K = (id) => keyLabel(keysFor(id)[0]);

// ------------------------------------------------------------------ joystick / gamepad profiles (per device id)

/** Thrustmaster TCA Sidestick and other HID sticks show up with a non-standard mapping (Chrome on Windows: axis = HID usage, hat on axis 9). */
export function defaultProfile(gp) {
  const std = gp.mapping === 'standard';
  if (std) return {
    axes: { yaw: { i: 0, inv: false }, pitch: { i: 1, inv: false }, roll: { i: 2, inv: false }, throttle: null },
    look: 3,
    buttons: { fire: [{ b: 7 }], missile: [{ b: 6 }], boost: [{ b: 0 }, { b: 10 }], throttleUp: [{ b: 5 }, { b: 12 }], throttleDown: [{ b: 4 }, { b: 13 }],
      targetNext: [{ b: 1 }], targetPrev: [{ b: 14 }], targetAim: [{ b: 2 }], camera: [{ b: 3 }], dock: [{ b: 8 }], map: [{ b: 15 }], menu: [{ b: 9 }], use: [{ b: 0 }], run: [{ b: 10 }] },
  };
  const n = gp.axes.length;
  return {
    axes: { yaw: { i: 0, inv: false }, pitch: { i: 1, inv: false }, roll: { i: n > 5 ? 5 : 2, inv: false }, throttle: n > 6 ? { i: 6, inv: false } : null },
    buttons: { fire: [{ b: 0 }], missile: [{ b: 1 }], boost: [{ b: 2 }], targetNext: [{ b: 3 }], targetAim: [{ b: 4 }], camera: [{ b: 5 }], map: [{ b: 6 }], dock: [{ b: 7 }], use: [{ b: 1 }] },
  };
}

export function profileFor(gp) {
  return data.pads[gp.id] || defaultProfile(gp);
}
export function saveProfile(gp, prof) { data.pads[gp.id] = prof; save(); }
export function resetProfile(gp) { delete data.pads[gp.id]; save(); }

/** Readable name of a pad binding: button number (1-based like Windows) or hat / axis position. */
export function padLabel(bd) {
  if (!bd) return '–';
  if (bd.b != null) return `Knopf ${bd.b + 1}`;
  if (bd.hat) return `Coolie-Hat ${bd.hat}`;
  return `Achse ${bd.a + 1} ${bd.v > 0 ? '+' : '−'}`;
}

/** Short device name for notifications ("Thrustmaster TCA Sidestick Airbus Edition (Vendor: 044f …)" → first part). */
export const padName = (id) => String(id).replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'Gamepad';

/** Replace {k:action} placeholders in UI text with the key currently bound (e.g. "[{k:dock}]" → "[L]"). */
export const withKeys = (t) => typeof t === 'string' ? t.replace(/\{k:(\w+)\}/g, (_, id) => ACTION[id] ? K(id) : id) : t;
