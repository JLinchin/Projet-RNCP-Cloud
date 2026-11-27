const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const request = require('supertest');
const pino = require('pino');
const { createApp } = require('../src/app');
const { hashPassword, signToken } = require('../src/auth');

const config = { jwtSecret: 'x'.repeat(40), jwtTtl: '1h', loanDays: 21, version: 'test' };
const tokenFor = (user) => signToken(user, { secret: config.jwtSecret, ttl: '1h' });
const ADMIN = { id: 1, email: 'admin@biblio.local', role: 'admin' };
const MEMBER = { id: 2, email: 'lecteur@biblio.local', role: 'member' };

// Doublures en mémoire : aucune base, aucun MinIO, aucun RabbitMQ requis en CI.
function fakes() {
  const state = { users: [], books: [], loans: [], published: [], objects: new Map() };
  const repo = {
    ping: async () => {},
    findUserByEmail: async (email) => state.users.find((u) => u.email === email.toLowerCase()) || null,
    createUser: async ({ email, passwordHash, role = 'member' }) => {
      if (state.users.some((u) => u.email === email.toLowerCase())) return null;
      const user = { id: state.users.length + 10, email: email.toLowerCase(), password_hash: passwordHash, role };
      state.users.push(user);
      return { id: user.id, email: user.email, role };
    },
    listBooks: async () => state.books,
    getBook: async (id) => state.books.find((b) => b.id === id) || null,
    createBook: async ({ title, author, isbn, totalCopies }) => {
      const book = { id: state.books.length + 1, title, author, isbn, total_copies: totalCopies, cover_key: null };
      state.books.push(book);
      return book;
    },
    deleteBook: async () => 'deleted',
    setCover: async (id, key) => {
      state.books.find((b) => b.id === id).cover_key = key;
    },
    createLoan: async ({ userId, bookId }) => {
      const book = state.books.find((b) => b.id === bookId);
      if (!book) return { error: 'BOOK_NOT_FOUND' };
      const active = state.loans.filter((l) => l.book_id === bookId && !l.returned_at).length;
      if (active >= book.total_copies) return { error: 'UNAVAILABLE' };
      const loan = { id: state.loans.length + 1, user_id: userId, book_id: bookId, returned_at: null, receipt_key: null };
      state.loans.push(loan);
      return { loan };
    },
    listLoans: async ({ userId } = {}) => state.loans.filter((l) => !userId || l.user_id === userId),
    getLoan: async (id) => state.loans.find((l) => l.id === id) || null,
    returnLoan: async (id) => {
      const loan = state.loans.find((l) => l.id === id && !l.returned_at);
      if (!loan) return null;
      loan.returned_at = new Date();
      return loan;
    },
  };
  const storage = {
    buckets: { covers: 'covers', receipts: 'receipts' },
    put: async (bucket, key, buf) => state.objects.set(`${bucket}/${key}`, buf),
    get: async (bucket, key) => Readable.from(state.objects.get(`${bucket}/${key}`)),
    remove: async () => {},
  };
  const queue = { ready: () => true, publish: async (type, payload) => state.published.push({ type, payload }) };
  return { state, repo, storage, queue };
}

describe('API bibliothèque', () => {
  let f;
  let app;
  beforeEach(() => {
    f = fakes();
    app = createApp({ ...f, config, logger: pino({ level: 'silent' }) });
  });

  test('sondes de santé et métriques Prometheus', async () => {
    await request(app).get('/healthz').expect(200);
    const ready = await request(app).get('/readyz').expect(200);
    assert.equal(ready.body.status, 'ready');
    const metrics = await request(app).get('/metrics').expect(200);
    assert.match(metrics.text, /http_request_duration_seconds/);
    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.version, 'test');
  });

  test('readyz renvoie 503 si la base est indisponible', async () => {
    f.repo.ping = async () => {
      throw new Error('down');
    };
    await request(app).get('/readyz').expect(503);
  });

  test("inscription : validation de l'email et de la longueur du mot de passe", async () => {
    await request(app).post('/api/auth/register').send({ email: 'pas-un-email', password: 'motdepasse-long' }).expect(400);
    await request(app).post('/api/auth/register').send({ email: 'a@b.fr', password: 'court' }).expect(400);
    const res = await request(app).post('/api/auth/register').send({ email: 'A@b.fr', password: 'motdepasse-long' }).expect(201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'a@b.fr');
    assert.equal(f.state.users[0].password_hash.startsWith('$2'), true, 'mot de passe haché avec bcrypt');
    await request(app).post('/api/auth/register').send({ email: 'a@b.fr', password: 'motdepasse-long' }).expect(409);
  });

  test('connexion : succès puis échec avec un message générique', async () => {
    f.state.users.push({ id: 5, email: 'x@y.fr', role: 'member', password_hash: await hashPassword('motdepasse-long') });
    const ok = await request(app).post('/api/auth/login').send({ email: 'x@y.fr', password: 'motdepasse-long' }).expect(200);
    assert.ok(ok.body.token);
    const ko = await request(app).post('/api/auth/login').send({ email: 'x@y.fr', password: 'mauvais-mot-de-passe' }).expect(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'inconnu@y.fr', password: 'peu-importe-x' }).expect(401);
    assert.equal(ko.body.error, unknown.body.error);
  });

  test('création d’ouvrage réservée aux administrateurs', async () => {
    await request(app).post('/api/books').send({ title: 'T', author: 'A' }).expect(401);
    await request(app).post('/api/books').set('Authorization', `Bearer ${tokenFor(MEMBER)}`).send({ title: 'T', author: 'A' }).expect(403);
    await request(app).post('/api/books').set('Authorization', `Bearer ${tokenFor(ADMIN)}`).send({ title: '', author: 'A' }).expect(400);
    const res = await request(app)
      .post('/api/books')
      .set('Authorization', `Bearer ${tokenFor(ADMIN)}`)
      .send({ title: 'Les Misérables', author: 'Victor Hugo', totalCopies: 1 })
      .expect(201);
    assert.equal(res.body.book.title, 'Les Misérables');
  });

  test('jeton falsifié refusé', async () => {
    const forged = signToken(ADMIN, { secret: 'y'.repeat(40), ttl: '1h' });
    await request(app).post('/api/books').set('Authorization', `Bearer ${forged}`).send({ title: 'T', author: 'A' }).expect(401);
  });

  test('téléversement de couverture : type contrôlé et stockage objet', async () => {
    f.state.books.push({ id: 1, title: 'T', author: 'A', total_copies: 1, cover_key: null });
    const admin = `Bearer ${tokenFor(ADMIN)}`;
    await request(app).post('/api/books/1/cover').set('Authorization', admin).attach('cover', Buffer.from('#!/bin/sh'), { filename: 'x.sh', contentType: 'text/x-sh' }).expect(400);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const res = await request(app).post('/api/books/1/cover').set('Authorization', admin).attach('cover', png, { filename: 'c.png', contentType: 'image/png' }).expect(201);
    assert.match(res.body.key, /^books\/1\/.+\.png$/);
    const cover = await request(app).get('/api/books/1/cover').expect(200);
    assert.equal(cover.headers['content-type'], 'image/png');
  });

  test('emprunt : publication d’un job asynchrone et gestion de la disponibilité', async () => {
    f.state.books.push({ id: 1, title: 'T', author: 'A', total_copies: 1, cover_key: null });
    const member = `Bearer ${tokenFor(MEMBER)}`;
    await request(app).post('/api/loans').set('Authorization', member).send({}).expect(400);
    const res = await request(app).post('/api/loans').set('Authorization', member).send({ bookId: 1 }).expect(201);
    assert.deepEqual(f.state.published, [{ type: 'loan.created', payload: { loanId: res.body.loan.id } }]);
    await request(app).post('/api/loans').set('Authorization', `Bearer ${tokenFor({ ...MEMBER, id: 3 })}`).send({ bookId: 1 }).expect(409);
    // Le reçu n'est pas encore généré par le worker
    const receipt = await request(app).get(`/api/loans/${res.body.loan.id}/receipt`).set('Authorization', member).expect(202);
    assert.equal(receipt.body.status, 'pending');
  });

  test('un membre ne peut pas retourner l’emprunt d’un autre', async () => {
    f.state.books.push({ id: 1, title: 'T', author: 'A', total_copies: 2, cover_key: null });
    f.state.loans.push({ id: 1, user_id: 99, book_id: 1, returned_at: null });
    await request(app).post('/api/loans/1/return').set('Authorization', `Bearer ${tokenFor(MEMBER)}`).expect(404);
    await request(app).post('/api/loans/1/return').set('Authorization', `Bearer ${tokenFor(ADMIN)}`).expect(200);
    assert.equal(f.state.published.at(-1).type, 'loan.returned');
  });

  test('un échec de la file ne bloque pas l’emprunt', async () => {
    f.state.books.push({ id: 1, title: 'T', author: 'A', total_copies: 1, cover_key: null });
    f.queue.publish = async () => {
      throw new Error('queue unavailable');
    };
    await request(app).post('/api/loans').set('Authorization', `Bearer ${tokenFor(MEMBER)}`).send({ bookId: 1 }).expect(201);
  });
});
