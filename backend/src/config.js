const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  version: env.APP_VERSION || 'dev',
  logLevel: env.LOG_LEVEL || 'info',
  jwtSecret: env.JWT_SECRET,
  jwtTtl: env.JWT_TTL || '2h',
  loanDays: Number(env.LOAN_DAYS || 21),
  admin: {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  },
  s3: {
    endPoint: env.S3_ENDPOINT || 'localhost',
    port: Number(env.S3_PORT || 9000),
    useSSL: env.S3_USE_SSL === 'true',
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    coversBucket: env.S3_BUCKET_COVERS || 'covers',
    receiptsBucket: env.S3_BUCKET_RECEIPTS || 'receipts',
  },
  amqp: {
    url: `amqp://${encodeURIComponent(env.RABBITMQ_USER || 'guest')}:${encodeURIComponent(
      env.RABBITMQ_PASSWORD || 'guest',
    )}@${env.RABBITMQ_HOST || 'localhost'}:${env.RABBITMQ_PORT || 5672}`,
    queue: env.QUEUE_NAME || 'library.jobs',
  },
};

function assertProductionConfig(cfg = config) {
  const missing = [];
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) missing.push('JWT_SECRET (>= 32 caractères)');
  if (!cfg.s3.accessKey) missing.push('S3_ACCESS_KEY');
  if (!cfg.s3.secretKey) missing.push('S3_SECRET_KEY');
  if (missing.length) {
    throw new Error(`Configuration invalide, variables manquantes : ${missing.join(', ')}`);
  }
}

module.exports = { config, assertProductionConfig };
