import { createApp } from '../server/app.js';

export function createHandler(initialize = createApp) {
  let appPromise;
  return async function handler(req, res) {
    const initialization = appPromise ??= Promise.resolve().then(initialize);
    try {
      const app = await initialization;
      if (res.destroyed) return;
      await new Promise((resolve) => {
        res.once('finish', resolve);
        res.once('close', resolve);
        app(req, res);
      });
    } catch (error) {
      if (appPromise === initialization) appPromise = undefined;
      console.error('Unable to initialize API:', error.code ?? 'INITIALIZATION_FAILED');
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'Database connection is not configured or unavailable.', code: 'DATABASE_UNAVAILABLE' }));
    }
  };
}

export default createHandler();
