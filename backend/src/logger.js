const pino = require('pino');

// Logs JSON sur stdout -> collectés par Promtail -> Loki -> Grafana.
// Les champs sensibles sont masqués (ISO 27001 A.8.12 prévention de la fuite de données).
function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        'token',
      ],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
