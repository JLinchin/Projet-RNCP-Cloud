const amqp = require('amqplib');
const config = require('./config');
const createLogger = require('./logger');
const { createDb } = require('./db');
const { createStorage } = require('./storage');
const { createHandlers } = require('./jobs');
const { runMaintenance } = require('./maintenance');
const { jobsProcessed, jobDuration, startMetricsServer } = require('./metrics');

const logger = createLogger(config.logLevel);

async function main() {
  const db = createDb();
  const storage = createStorage(config.s3);
  const bucket = config.s3.receiptsBucket;
  const handlers = createHandlers({ db, storage, bucket, logger });
  const { queue } = config.amqp;

  let channel = null;
  startMetricsServer(config.metricsPort, () => channel !== null);

  const connection = await amqp.connect(config.amqp.url);
  connection.on('close', () => {
    logger.error('connexion RabbitMQ perdue, redémarrage du pod');
    process.exit(1); // Kubernetes redémarre le conteneur (self-healing)
  });
  channel = await connection.createChannel();
  await channel.assertQueue(`${queue}.dlq`, { durable: true });
  await channel.assertQueue(queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': `${queue}.dlq` },
  });
  await channel.prefetch(config.prefetch);

  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    let job;
    try {
      job = JSON.parse(msg.content.toString());
    } catch {
      jobsProcessed.inc({ type: 'invalid', status: 'dead_letter' });
      return channel.nack(msg, false, false);
    }
    const handler = handlers[job.type];
    const end = jobDuration.startTimer({ type: job.type });
    try {
      if (!handler) throw new Error(`type de job inconnu: ${job.type}`);
      await handler(job.payload || {});
      jobsProcessed.inc({ type: job.type, status: 'success' });
      channel.ack(msg);
    } catch (err) {
      const retries = Number(msg.properties.headers?.['x-retries'] || 0);
      if (handler && retries < config.maxRetries) {
        // Nouvelle tentative : republication avec compteur incrémenté.
        channel.sendToQueue(queue, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: { 'x-retries': retries + 1 },
        });
        channel.ack(msg);
        jobsProcessed.inc({ type: job.type, status: 'retry' });
        logger.warn({ err: err.message, job, retries: retries + 1 }, 'job en échec, nouvelle tentative');
      } else {
        channel.nack(msg, false, false); // -> dead-letter queue
        jobsProcessed.inc({ type: job.type, status: 'dead_letter' });
        logger.error({ err: err.message, job }, 'job envoyé en dead-letter queue');
      }
    } finally {
      end();
    }
  });
  logger.info({ queue }, 'worker à l’écoute');

  const maintenance = () =>
    runMaintenance({ db, storage, bucket, retentionDays: config.retentionDays, logger }).catch((err) =>
      logger.error({ err: err.message }, 'échec de la maintenance'),
    );
  setTimeout(maintenance, 10000);
  const timer = setInterval(maintenance, config.maintenanceIntervalMs);

  const shutdown = async () => {
    logger.info('arrêt du worker');
    clearInterval(timer);
    await channel.close().catch(() => {});
    connection.removeAllListeners('close');
    await connection.close().catch(() => {});
    await db.pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'échec du démarrage du worker');
  process.exit(1);
});
