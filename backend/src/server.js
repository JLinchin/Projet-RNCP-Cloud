const { config, assertProductionConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool, migrate, createRepository } = require('./db');
const { createStorage } = require('./storage');
const { createQueue } = require('./queue');
const { createApp } = require('./app');
const { hashPassword } = require('./auth');

async function main() {
  const logger = createLogger(config.logLevel);
  assertProductionConfig(config);

  const pool = createPool();
  const adminPasswordHash = config.admin.email && config.admin.password ? await hashPassword(config.admin.password) : null;
  await migrate(pool, { adminEmail: config.admin.email, adminPasswordHash });

  const queue = createQueue({ ...config.amqp, logger });
  await queue.connect();

  const app = createApp({ repo: createRepository(pool), storage: createStorage(config.s3), queue, config, logger });
  const server = app.listen(config.port, () => logger.info({ port: config.port, version: config.version }, 'API démarrée'));

  // Arrêt gracieux : Kubernetes envoie SIGTERM lors d'un rolling update / scale-down.
  const shutdown = (signal) => {
    logger.info({ signal }, 'arrêt en cours');
    server.close(async () => {
      await queue.close();
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  createLogger().fatal({ err }, 'échec du démarrage');
  process.exit(1);
});
