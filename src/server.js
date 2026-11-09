import { createApp } from './app.js';
import { config } from './config.js';
import { DEMO_PASSWORD, seedIfEmpty } from './db/seed.js';

if (seedIfEmpty()) {
  console.log(`Demo data created. Sign in as "admin" with password ${DEMO_PASSWORD}`);
}

createApp().listen(config.port, () => {
  console.log(`Forensics portal running at http://localhost:${config.port}`);
});
