const env = process.env;

module.exports = {
  logLevel: env.LOG_LEVEL || 'info',
  metricsPort: Number(env.METRICS_PORT || 9100),
  prefetch: Number(env.WORKER_PREFETCH || 5),
  maxRetries: Number(env.WORKER_MAX_RETRIES || 3),
  maintenanceIntervalMs: Number(env.MAINTENANCE_INTERVAL_MS || 60 * 60 * 1000),
  // Politique de conservation (RGPD / C6.3) : les emprunts clôturés sont purgés après ce délai.
  retentionDays: Number(env.RETENTION_DAYS || 365),
  s3: {
    endPoint: env.S3_ENDPOINT || 'localhost',
    port: Number(env.S3_PORT || 9000),
    useSSL: env.S3_USE_SSL === 'true',
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    receiptsBucket: env.S3_BUCKET_RECEIPTS || 'receipts',
  },
  amqp: {
    url: `amqp://${encodeURIComponent(env.RABBITMQ_USER || 'guest')}:${encodeURIComponent(
      env.RABBITMQ_PASSWORD || 'guest',
    )}@${env.RABBITMQ_HOST || 'localhost'}:${env.RABBITMQ_PORT || 5672}`,
    queue: env.QUEUE_NAME || 'library.jobs',
  },
};
