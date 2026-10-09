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
  };
}
