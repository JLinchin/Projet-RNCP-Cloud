const { Pool } = require('pg');

// Schéma relationnel (3 entités métier) — migrations idempotentes exécutées au démarrage.
// Un verrou consultatif PostgreSQL évite les migrations concurrentes quand plusieurs
// réplicas démarrent en même temps (rolling update, autoscaling).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  isbn         TEXT UNIQUE,
  total_copies INTEGER NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
  cover_key    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loans (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  book_id          INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  borrowed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at           TIMESTAMPTZ NOT NULL,
  returned_at      TIMESTAMPTZ,
  receipt_key      TEXT,
  reminder_sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS loans_book_active_idx ON loans(book_id) WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS loans_user_idx ON loans(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS loans_one_active_per_user_book
  ON loans(user_id, book_id) WHERE returned_at IS NULL;
`;

const MIGRATION_LOCK_ID = 424242;

function createPool() {
  // Paramètres de connexion lus depuis PGHOST / PGUSER / PGPASSWORD / PGDATABASE.
  return new Pool({ max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000 });
}

async function migrate(pool, { adminEmail, adminPasswordHash } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(SCHEMA);
    if (adminEmail && adminPasswordHash) {
      await client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [adminEmail.toLowerCase(), adminPasswordHash],
      );
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Couche d'accès aux données : toutes les requêtes sont paramétrées (pas d'injection SQL, A.8.28).
function createRepository(pool) {
  return {
    async ping() {
      await pool.query('SELECT 1');
    },

    async findUserByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
      return rows[0] || null;
    },

    async findUserById(id) {
      const { rows } = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async createUser({ email, passwordHash, role = 'member' }) {
      try {
        const { rows } = await pool.query(
          'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
          [email.toLowerCase(), passwordHash, role],
        );
        return rows[0];
      } catch (err) {
        if (err.code === '23505') return null; // email déjà utilisé
        throw err;
      }
    },

    async listBooks(q) {
      const { rows } = await pool.query(
        `SELECT b.id, b.title, b.author, b.isbn, b.total_copies,
                (b.cover_key IS NOT NULL) AS has_cover,
                b.total_copies - COUNT(l.id) FILTER (WHERE l.returned_at IS NULL) AS available
           FROM books b
           LEFT JOIN loans l ON l.book_id = b.id
          WHERE $1::text IS NULL OR b.title ILIKE '%' || $1 || '%' OR b.author ILIKE '%' || $1 || '%'
          GROUP BY b.id
          ORDER BY b.title
          LIMIT 200`,
        [q || null],
      );
      return rows.map((r) => ({ ...r, available: Number(r.available) }));
    },

    async getBook(id) {
      const { rows } = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async createBook({ title, author, isbn, totalCopies }) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO books (title, author, isbn, total_copies) VALUES ($1, $2, $3, $4) RETURNING *`,
          [title, author, isbn || null, totalCopies],
        );
        return rows[0];
      } catch (err) {
        if (err.code === '23505') return null; // ISBN déjà présent
        throw err;
      }
    },

    async deleteBook(id) {
      try {
        const { rowCount } = await pool.query('DELETE FROM books WHERE id = $1', [id]);
        return rowCount > 0 ? 'deleted' : 'not_found';
      } catch (err) {
        if (err.code === '23503') return 'has_loans';
        throw err;
      }
    },

    async setCover(id, key) {
      await pool.query('UPDATE books SET cover_key = $2 WHERE id = $1', [id, key]);
    },

    // Emprunt transactionnel : verrou sur la ligne du livre pour éviter de prêter
    // plus d'exemplaires qu'il n'en existe (accès concurrents depuis plusieurs pods).
    async createLoan({ userId, bookId, loanDays }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const book = await client.query('SELECT id, total_copies FROM books WHERE id = $1 FOR UPDATE', [bookId]);
        if (book.rowCount === 0) {
          await client.query('ROLLBACK');
          return { error: 'BOOK_NOT_FOUND' };
        }
        const active = await client.query(
          'SELECT count(*)::int AS n FROM loans WHERE book_id = $1 AND returned_at IS NULL',
          [bookId],
        );
        if (active.rows[0].n >= book.rows[0].total_copies) {
          await client.query('ROLLBACK');
          return { error: 'UNAVAILABLE' };
        }
        const { rows } = await client.query(
          `INSERT INTO loans (user_id, book_id, due_at)
           VALUES ($1, $2, now() + make_interval(days => $3)) RETURNING *`,
          [userId, bookId, loanDays],
        );
        await client.query('COMMIT');
        return { loan: rows[0] };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return { error: 'ALREADY_BORROWED' };
        throw err;
      } finally {
        client.release();
      }
    },

    async listLoans({ userId } = {}) {
      const { rows } = await pool.query(
        `SELECT l.id, l.user_id, u.email AS user_email, l.book_id, b.title AS book_title,
                l.borrowed_at, l.due_at, l.returned_at, (l.receipt_key IS NOT NULL) AS has_receipt
           FROM loans l
           JOIN books b ON b.id = l.book_id
           JOIN users u ON u.id = l.user_id
          WHERE $1::int IS NULL OR l.user_id = $1
          ORDER BY l.borrowed_at DESC
          LIMIT 500`,
        [userId || null],
      );
      return rows;
    },

    async getLoan(id) {
      const { rows } = await pool.query('SELECT * FROM loans WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async returnLoan(id) {
      const { rows } = await pool.query(
        'UPDATE loans SET returned_at = now() WHERE id = $1 AND returned_at IS NULL RETURNING *',
        [id],
      );
      return rows[0] || null;
    },
  };
}

module.exports = { createPool, migrate, createRepository, SCHEMA };
