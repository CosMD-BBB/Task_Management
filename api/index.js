import { createApp } from '../server/app.js';

let appPromise;
export default async function handler(req, res) {
  appPromise ??= createApp();
  try {
    const app = await appPromise;
    await new Promise((resolve) => {
      res.once('finish', resolve);
      res.once('close', resolve);
      app(req, res);
    });
  } catch (error) {
    appPromise = undefined;
    console.error('Unable to initialize API:', error.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database connection is not configured or unavailable.', code: 'DATABASE_UNAVAILABLE' }));
  }
}
