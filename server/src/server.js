import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb, disconnectDb, safeUri } from './db.js';
import { DEMO_PASSWORD, seedIfEmpty } from './seed.js';

try {
  await connectDb();
} catch (err) {
  console.error(`Could not connect to MongoDB at ${safeUri(config.mongoUri)}`);
  console.error(`  ${err.message}`);
  console.error('Start MongoDB (or set MONGODB_URI in .env to a MongoDB Atlas connection string) and try again.');
  process.exit(1);
}
console.log(`Connected to MongoDB at ${safeUri(config.mongoUri)}`);

if (await seedIfEmpty()) console.log(`Demo data created. Sign in as "admin" with password ${DEMO_PASSWORD}`);

const server = createApp().listen(config.port, () => {
  console.log(`Forensics portal API running at http://localhost:${config.port}`);
});

// Docker and Kubernetes send SIGTERM before stopping a container: finish open requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
