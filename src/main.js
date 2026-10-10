import './ui/style.css';
import { Game } from './game/game.js';

const game = new Game();
window.__game = game;
game.boot();

if (import.meta.env.DEV) {
  // console helpers for testing: __dev.flight('rings'), __dev.room('bar')
  window.__dev = {
    async setup(cls = 'spacewing') {
      const st = window.__S;
      if (!st.state.g) { st.state.set(st.newGame('Test')); st.addShip(st.state.g, cls, 'Testschiff'); st.state.g.credits = 50000; }
      return st.state.g;
    },
    async flight(zone = 'rhea', spawn = 'arrive', cls = 'spacewing') {
      const g = await this.setup(cls);
      game.ui.clear();
      await game.startFlight(zone, spawn, g.ships[0]);
      return game.mode;
    },
    async room(id = 'bruecke') { await this.setup(); game.ui.clear(); await game.enterRoom(id); return game.mode; },
    /** Render one frame and save it via the dev server (works with a hidden browser pane). */
    async shot(name = 'shot', w = 960, steps = 1) {
      for (let i = 0; i < steps; i++) game.mode?.update?.(0.033);
      game.renderer.render(0.016);
      const src = game.renderer.gl.domElement, c = document.createElement('canvas');
      c.width = w; c.height = Math.round(w * src.height / src.width);
      const x = c.getContext('2d'); x.drawImage(src, 0, 0, c.width, c.height);
      await fetch('/__shot?n=' + name, { method: 'POST', body: c.toDataURL('image/jpeg', 0.85) });
      return name;
    },
    /** Put the walking player at a world position looking at a point. */
    look(px, py, pz, tx, ty, tz) {
      const m = game.mode; m.pos.set(px, py, pz); m.vel.set(0, 0, 0);
      const dx = tx - px, dy = ty - (py + 1.63), dz = tz - pz;
      m.yaw = Math.atan2(-dx, -dz); m.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      m.updateRoom?.();
    },
  };
}
