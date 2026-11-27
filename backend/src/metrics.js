const client = require('prom-client');

// Registre dédié : métriques techniques (Node.js) + métriques métier / SLI.
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// SLI latence & disponibilité : histogramme des requêtes HTTP.
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

// Événements de sécurité (A.8.15 journalisation / A.8.16 surveillance).
const authEvents = new client.Counter({
  name: 'auth_events_total',
  help: "Événements d'authentification",
  labelNames: ['event', 'result'],
  registers: [register],
});

const jobsPublished = new client.Counter({
  name: 'jobs_published_total',
  help: 'Messages publiés dans la file de traitement asynchrone',
  labelNames: ['type', 'result'],
  registers: [register],
});

const loansCreated = new client.Counter({
  name: 'library_loans_created_total',
  help: "Nombre d'emprunts créés",
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // On utilise le *pattern* de route (ex. /api/books/:id) pour éviter l'explosion de cardinalité.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

module.exports = { register, httpDuration, authEvents, jobsPublished, loansCreated, metricsMiddleware };
