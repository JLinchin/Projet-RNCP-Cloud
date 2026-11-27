const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../auth');

const ALLOWED_IMAGES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_COVER_BYTES = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COVER_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(ALLOWED_IMAGES[file.mimetype])),
});

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = function bookRoutes({ repo, storage, config, securityEvent }) {
  const router = express.Router();
  const auth = authenticate(config.jwtSecret);
  const admin = [auth, requireRole('admin')];

  // Catalogue consultable publiquement.
  router.get('/', async (req, res) => {
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;
    res.json({ books: await repo.listBooks(q) });
  });

  router.get('/:id', async (req, res) => {
    const id = toId(req.params.id);
    const book = id && (await repo.getBook(id));
    if (!book) return res.status(404).json({ error: 'Ouvrage introuvable' });
    const { cover_key, ...rest } = book;
    return res.json({ book: { ...rest, has_cover: Boolean(cover_key) } });
  });

  // La couverture est servie via l'API : le stockage objet n'est jamais exposé publiquement.
  router.get('/:id/cover', async (req, res) => {
    const id = toId(req.params.id);
    const book = id && (await repo.getBook(id));
    if (!book || !book.cover_key) return res.status(404).json({ error: 'Pas de couverture' });
    const ext = book.cover_key.split('.').pop();
    const type = Object.keys(ALLOWED_IMAGES).find((k) => ALLOWED_IMAGES[k] === ext) || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = await storage.get(storage.buckets.covers, book.cover_key);
    stream.pipe(res);
  });

  router.post('/', ...admin, async (req, res) => {
    const { title, author, isbn } = req.body || {};
    const totalCopies = req.body?.totalCopies === undefined ? 1 : Number(req.body.totalCopies);
    if (typeof title !== 'string' || !title.trim() || typeof author !== 'string' || !author.trim()) {
      return res.status(400).json({ error: 'Titre et auteur requis' });
    }
    if (!Number.isInteger(totalCopies) || totalCopies < 0 || totalCopies > 1000) {
      return res.status(400).json({ error: "Nombre d'exemplaires invalide" });
    }
    if (isbn !== undefined && isbn !== null && !/^[0-9Xx-]{10,17}$/.test(String(isbn))) {
      return res.status(400).json({ error: 'ISBN invalide' });
    }
    const book = await repo.createBook({ title: title.trim(), author: author.trim(), isbn, totalCopies });
    if (!book) return res.status(409).json({ error: 'ISBN déjà présent' });
    return res.status(201).json({ book });
  });

  router.delete('/:id', ...admin, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
    const result = await repo.deleteBook(id);
    if (result === 'not_found') return res.status(404).json({ error: 'Ouvrage introuvable' });
    if (result === 'has_loans') return res.status(409).json({ error: "L'ouvrage possède un historique d'emprunts" });
    securityEvent(req, 'book.delete', 'success', { bookId: id });
    return res.status(204).end();
  });

  // Téléversement de couverture -> stockage objet (bucket « covers »).
  router.post('/:id/cover', ...admin, upload.single('cover'), async (req, res) => {
    const id = toId(req.params.id);
    const book = id && (await repo.getBook(id));
    if (!book) return res.status(404).json({ error: 'Ouvrage introuvable' });
    if (!req.file) return res.status(400).json({ error: 'Image JPEG, PNG ou WebP requise (2 Mo max)' });
    const key = `books/${id}/${crypto.randomUUID()}.${ALLOWED_IMAGES[req.file.mimetype]}`;
    await storage.put(storage.buckets.covers, key, req.file.buffer, req.file.mimetype);
    await repo.setCover(id, key);
    if (book.cover_key) await storage.remove(storage.buckets.covers, book.cover_key).catch(() => {});
    return res.status(201).json({ key });
  });

  return router;
};
