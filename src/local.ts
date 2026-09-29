import { serve } from '@hono/node-server';
import { app } from './app.js';
serve({ fetch: app.fetch, port: Number(process.env.PORT || 8787) });
console.log('Truework API listening on http://localhost:' + Number(process.env.PORT || 8787));
