const express = require('express');
const { authenticate } = require('../auth');
const { jobsPublished, loansCreated } = require('../metrics');

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = function loanRoutes({ repo, storage, queue, config, logger }) {
  const router = express.Router();
  router.use(authenticate(config.jwtSecret));

  const canAccess = (req, loan) => loan && (req.user.role === 'admin' || loan.user_id === req.user.id);

  // Publication asynchrone : un échec de la file ne bloque pas l'emprunt (le reçu sera
  // simplement absent) — arbitrage disponibilité > exhaustivité documenté dans le rapport.
  async function publish(type, payload) {
    try {
      await queue.publish(type, payload);
      jobsPublished.inc({ type, result: 'success' });
    } catch (err) {
      jobsPublished.inc({ type, result: 'failure' });
      logger.warn({ err: err.message, type, payload }, 'publication du job impossible');
    }
  }

  router.get('/', async (req, res) => {
    const loans = await repo.listLoans(req.user.role === 'admin' ? {} : { userId: req.user.id });
    res.json({ loans });
  });

  router.post('/', async (req, res) => {
    const bookId = toId(req.body?.bookId);
    if (!bookId) return res.status(400).json({ error: 'bookId requis' });
    const result = await repo.createLoan({ userId: req.user.id, bookId, loanDays: config.loanDays });
    if (result.error === 'BOOK_NOT_FOUND') return res.status(404).json({ error: 'Ouvrage introuvable' });
    if (result.error === 'UNAVAILABLE') return res.status(409).json({ error: 'Aucun exemplaire disponible' });
    if (result.error === 'ALREADY_BORROWED') return res.status(409).json({ error: 'Vous empruntez déjà cet ouvrage' });
    loansCreated.inc();
    await publish('loan.created', { loanId: result.loan.id });
    return res.status(201).json({ loan: result.loan });
  });

  router.post('/:id/return', async (req, res) => {
    const id = toId(req.params.id);
    const loan = id && (await repo.getLoan(id));
    if (!canAccess(req, loan)) return res.status(404).json({ error: 'Emprunt introuvable' });
    const updated = await repo.returnLoan(id);
    if (!updated) return res.status(409).json({ error: 'Emprunt déjà clôturé' });
    await publish('loan.returned', { loanId: id });
    return res.json({ loan: updated });
  });

  // Reçu PDF généré par le worker et stocké dans le bucket « receipts ».
  router.get('/:id/receipt', async (req, res) => {
    const id = toId(req.params.id);
    const loan = id && (await repo.getLoan(id));
    if (!canAccess(req, loan)) return res.status(404).json({ error: 'Emprunt introuvable' });
    if (!loan.receipt_key) return res.status(202).json({ status: 'pending' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="recu-emprunt-${id}.pdf"`);
    const stream = await storage.get(storage.buckets.receipts, loan.receipt_key);
    stream.pipe(res);
  });

  return router;
};
