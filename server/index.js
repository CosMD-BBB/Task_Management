import { createApp } from './app.js';

const app = await createApp();
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`Teamflow running on http://0.0.0.0:${port}`));
async function shutdown() {
  server.close(async () => { await app.locals.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
