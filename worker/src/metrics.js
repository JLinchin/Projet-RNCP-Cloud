const http = require('node:http');
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const jobsProcessed = new client.Counter({
  name: 'jobs_processed_total',
  help: 'Jobs traités par le worker',
  labelNames: ['type', 'status'], // status: success | retry | dead_letter
  registers: [register],
});

const jobDuration = new client.Histogram({
  name: 'job_duration_seconds',
  help: 'Durée de traitement des jobs',
  labelNames: ['type'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const overdueLoans = new client.Gauge({
  name: 'library_overdue_loans',
  help: 'Nombre d’emprunts en retard (dernière exécution de maintenance)',
  registers: [register],
});

const purgedLoans = new client.Counter({
  name: 'library_purged_loans_total',
  help: 'Emprunts purgés par la politique de conservation',
  registers: [register],
});

// Petit serveur HTTP : /metrics (scrapé par Prometheus) et /healthz (sonde liveness).
function startMetricsServer(port, isHealthy) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      return res.end(await register.metrics());
    }
    if (req.url === '/healthz') {
      const ok = isHealthy();
      res.statusCode = ok ? 200 : 503;
      return res.end(ok ? 'ok' : 'unhealthy');
    }
    res.statusCode = 404;
    return res.end();
  });
  server.listen(port);
  return server;
}

module.exports = { register, jobsProcessed, jobDuration, overdueLoans, purgedLoans, startMetricsServer };
