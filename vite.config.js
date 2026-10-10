import { defineConfig } from 'vite';
import fs from 'node:fs';

// Dev only: POST /__shot with a JPEG data URL saves it to $SHOT_DIR (for automated visual checks).
const shots = () => ({
  name: 'dev-shots',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      const dir = process.env.SHOT_DIR;
      if (req.method !== 'POST' || !dir) { res.statusCode = 404; return res.end(); }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const name = (new URL(req.url, 'http://x').searchParams.get('n') || 'shot').replace(/[^\w-]/g, '');
        fs.writeFileSync(`${dir}/${name}.jpg`, Buffer.from(body.split(',')[1] || '', 'base64'));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
  plugins: [shots()],
});
