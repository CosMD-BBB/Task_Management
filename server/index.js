import { createApp } from './app.js';

export async function startServer(options = {}) {
  const app = await createApp(options);
  const port = options.port ?? Number(process.env.PORT || 3000);
  try {
    const server = await new Promise((resolve, reject) => {
      const listening = app.listen(port, '0.0.0.0', (error) => error ? reject(error) : resolve(listening));
    });
    return { app, server };
  } catch (error) {
    await app.locals.close();
    throw error;
  }
}

if (import.meta.main) {
  try {
    const { app, server } = await startServer();
    console.log(`Room running on http://0.0.0.0:${server.address().port}`);
    let stopping = false;
    function shutdown() {
      if (stopping) return;
      stopping = true;
      server.close(async () => { await app.locals.close(); process.exit(0); });
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error(`Unable to start Room: ${error.code ?? 'STARTUP_FAILED'}`);
    process.exitCode = 1;
  }
}
