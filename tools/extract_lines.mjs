// Collects every spoken line (dialogues + radio comms) from the game sources for the voice-over generator.
// Usage: node tools/extract_lines.mjs > tools/lines.json
// A line's text may contain {name} where the player's callsign is inserted at runtime.
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import { ancestor } from 'acorn-walk';

const FILES = ['src/game/story.js', 'src/game/missions.js', 'src/game/game.js', 'src/space/flight.js'];
const out = new Map();

function product(a, b) {
  const r = [];
  for (const x of a) for (const y of b) { r.push(x + y); if (r.length > 64) return r; }
  return r;
}

function makeVals(consts) {
  const vals = (n) => {
    if (!n) return null;
    switch (n.type) {
      case 'Literal': return typeof n.value === 'string' ? [n.value] : typeof n.value === 'number' ? [String(n.value)] : null;
      case 'TemplateLiteral': {
        let acc = [''];
        n.quasis.forEach((q, i) => {
          if (!acc) return;
          acc = acc.map(s => s + q.value.cooked);
          if (i < n.expressions.length) { const v = vals(n.expressions[i]); acc = v ? product(acc, v) : null; }
        });
        return acc;
      }
      case 'BinaryExpression': {
        if (n.operator !== '+') return null;
        const l = vals(n.left), r = vals(n.right);
        return l && r ? product(l, r) : null;
      }
      case 'Identifier':
        if (n.name === 'name') return ['{name}'];
        return consts[n.name] ? [consts[n.name]] : null;
      case 'MemberExpression':
        if (!n.computed && n.property.name === 'callsign') return ['{name}'];
        if (n.computed && n.object.type === 'ArrayExpression') return n.object.elements.flatMap(e => vals(e) || []);
        return null;
      case 'ConditionalExpression':
      case 'LogicalExpression': {
        const a = vals(n.consequent || n.left), b = vals(n.alternate || n.right);
        return a || b ? [...(a || []), ...(b || [])] : null;
      }
      case 'CallExpression': {
        const c = n.callee;
        if (c.type === 'MemberExpression' && c.property.name === 'replace' && n.arguments.length === 2) {
          const o = vals(c.object), x = vals(n.arguments[0]), y = vals(n.arguments[1]);
          if (o && x && y) return o.map(s => s.replace(x[0], y[0]));
        }
        return null;
      }
      default: return null;
    }
  };
  return vals;
}

for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  // top-level string constants (MAGS = 'mags', jumpHint = '...')
  const consts = {};
  for (const st of ast.body) {
    const decl = st.type === 'VariableDeclaration' ? st : st.declaration?.type === 'VariableDeclaration' ? st.declaration : null;
    if (!decl) continue;
    for (const d of decl.declarations) if (d.init?.type === 'Literal' && typeof d.init.value === 'string') consts[d.id.name] = d.init.value;
  }
  const vals = makeVals(consts);
  const speakerOf = (n, anc) => {
    if (!n) return 'comp';
    if (n.type === 'Identifier' && !consts[n.name]) {
      for (let i = anc.length - 1; i >= 0; i--) {
        const t = anc[i].test;
        if (anc[i].type === 'IfStatement' && t?.type === 'BinaryExpression' && t.left.type === 'Identifier' && t.left.name === n.name && t.right.type === 'Literal') return t.right.value;
      }
      return n.name;
    }
    const v = vals(n);
    if (v) return v[0];
    if (n.type === 'BinaryExpression') return speakerOf(n.left, anc);
    return 'generic';
  };
  const add = (who, textNode, radio) => {
    const v = vals(textNode);
    if (!v) return;
    for (const text of v) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.length < 2 || out.has(t)) continue;
      out.set(t, { speaker: who, text: t, radio });
    }
  };
  ancestor(ast, {
    CallExpression(n, _s, anc) {
      const c = n.callee, a = n.arguments;
      if (c.type === 'Identifier' && c.name === 'say' && a.length >= 2) add(speakerOf(a[0], anc), a[1], false);
      else if (c.type === 'Identifier' && c.name === 'M' && a.length === 1) add('Mags', a[0], true);
      else if (c.type === 'Identifier' && c.name === 'tree' && a.length >= 3) {
        const who = speakerOf(a[0], anc);
        add(who, a[1], false);
        if (a[2].type === 'ArrayExpression') for (const topic of a[2].elements) {
          const ans = topic.properties?.find(p => p.key?.name === 'a')?.value;
          if (ans?.type !== 'ArrayExpression') continue;
          for (const e of ans.elements) {
            if (e.type === 'ArrayExpression') add(speakerOf(e.elements[0], anc), e.elements[1], false);
            else add(who, e, false);
          }
        }
      } else if (c.type === 'MemberExpression' && c.property.name === 'say' && a.length >= 2) add(speakerOf(a[0], anc), a[1], true);
      else if (c.type === 'MemberExpression' && c.property.name === 'talk' && a[0]?.type === 'ArrayExpression') {
        for (const e of a[0].elements) if (e.type === 'ArrayExpression') add(speakerOf(e.elements[0], anc), e.elements[1], true);
      }
    },
    ObjectExpression(n, _s, anc) {
      const who = n.properties.find(p => p.key?.name === 'who'), text = n.properties.find(p => p.key?.name === 'text');
      if (who && text) add(speakerOf(who.value, anc), text.value, false);
    },
  });
}
process.stdout.write(JSON.stringify([...out.values()], null, 1));
