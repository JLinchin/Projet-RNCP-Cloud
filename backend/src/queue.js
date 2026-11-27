const amqp = require('amqplib');

// Déclaration de la file partagée avec le worker (mêmes arguments des deux côtés).
// Les messages en échec définitif partent dans une dead-letter queue (DLQ).
function queueArgs(queue) {
  return {
    durable: true,
    arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': `${queue}.dlq` },
  };
}

function createQueue({ url, queue, logger }) {
  let connection = null;
  let channel = null;
  let closing = false;

  async function connect() {
    try {
      connection = await amqp.connect(url);
      connection.on('error', (err) => logger.warn({ err }, 'amqp connection error'));
      connection.on('close', () => {
        channel = null;
        if (!closing) setTimeout(connect, 3000);
      });
      channel = await connection.createConfirmChannel();
      await channel.assertQueue(`${queue}.dlq`, { durable: true });
      await channel.assertQueue(queue, queueArgs(queue));
      logger.info({ queue }, 'connecté à RabbitMQ');
    } catch (err) {
      logger.warn({ err: err.message }, 'RabbitMQ indisponible, nouvelle tentative dans 3s');
      channel = null;
      if (!closing) setTimeout(connect, 3000);
    }
  }

  return {
    connect,
    ready: () => channel !== null,
    async publish(type, payload) {
      if (!channel) throw new Error('queue unavailable');
      const body = Buffer.from(JSON.stringify({ type, payload, publishedAt: new Date().toISOString() }));
      channel.sendToQueue(queue, body, { persistent: true, contentType: 'application/json' });
      await channel.waitForConfirms();
    },
    async close() {
      closing = true;
      if (connection) await connection.close().catch(() => {});
    },
  };
}

module.exports = { createQueue, queueArgs };
