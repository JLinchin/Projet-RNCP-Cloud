const os = require('node:os');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const { register, metricsMiddleware, authEvents } = require('./metrics');
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const loanRoutes = require('./routes/loans');

const PROBES = new Set(['/healthz', '/readyz', '/metrics']);

// Fabrique d'application : les dépendances (BDD, stockage, file) sont injectées,
// ce qui rend l'API testable sans infrastructure (tests unitaires en CI).
function createApp({ repo, storage, queue, config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // derrière l'Ingress NGINX (IP client réelle pour les logs/rate-limit)

  // Journal de sécurité structuré (A.8.15) : catégorie dédiée, requêtable dans Loki
  // ({namespace="library-prod"} | json | category="security").
  const securityEvent = (req, event, result, extra = {}) => {
    authEvents.inc({ event, result });
    logger.info({ category: 'security', event, result, ip: req.ip, userId: req.user?.id, ...extra }, `security ${event} ${result}`);
  };

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => PROBES.has(req.url) } }));
  app.use(metricsMiddleware);

  // Sondes Kubernetes (non exposées par l'Ingress, qui ne route que /api).
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    try {
      await repo.ping();
      res.json({ status: 'ready', queue: queue.ready() ? 'up' : 'degraded' });
    } catch {
      res.status(503).json({ status: 'not ready' });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  const deps = { repo, storage, queue, config, logger, securityEvent };
  const api = express.Router();
  // Version + pod : utile pour visualiser un déploiement canary / rolling update.
  api.get('/health', (_req, res) => res.json({ status: 'ok', version: config.version, pod: os.hostname() }));
  api.use('/auth', authRoutes(deps));
  api.use('/books', bookRoutes(deps));
  api.use('/loans', loanRoutes(deps));
  app.use('/api', api);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
    req.log?.error({ err }, 'erreur non gérée');
    return res.status(500).json({ error: 'Erreur interne' });
  });

  return app;
}

module.exports = { createApp };
