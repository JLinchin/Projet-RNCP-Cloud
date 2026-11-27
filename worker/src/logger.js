const pino = require('pino');

module.exports = (level = 'info') =>
  pino({ level, base: { service: 'worker' }, timestamp: pino.stdTimeFunctions.isoTime });
