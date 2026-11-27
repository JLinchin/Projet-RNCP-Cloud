const { Pool } = require('pg');

function createDb() {
  const pool = new Pool({ max: 5 });
  return {
    pool,
    async getLoanDetails(id) {
      const { rows } = await pool.query(
        `SELECT l.id, l.borrowed_at, l.due_at, l.returned_at, u.email AS user_email,
                b.title AS book_title, b.author AS book_author
           FROM loans l JOIN users u ON u.id = l.user_id JOIN books b ON b.id = l.book_id
          WHERE l.id = $1`,
        [id],
      );
      return rows[0] || null;
    },
    async setReceiptKey(id, key) {
      await pool.query('UPDATE loans SET receipt_key = $2 WHERE id = $1', [id, key]);
    },
    // Relances : emprunts en retard non encore notifiés.
    async markOverdueReminders() {
      const { rows } = await pool.query(
        `UPDATE loans l SET reminder_sent_at = now()
           FROM users u, books b
          WHERE u.id = l.user_id AND b.id = l.book_id
            AND l.returned_at IS NULL AND l.due_at < now() AND l.reminder_sent_at IS NULL
        RETURNING l.id, u.email AS user_email, b.title AS book_title`,
      );
      return rows;
    },
    async countOverdue() {
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM loans WHERE returned_at IS NULL AND due_at < now()',
      );
      return rows[0].n;
    },
    // Purge des emprunts clôturés au-delà de la durée de conservation.
    async purgeOldLoans(retentionDays) {
      const { rows } = await pool.query(
        `DELETE FROM loans WHERE returned_at < now() - make_interval(days => $1) RETURNING id, receipt_key`,
        [retentionDays],
      );
      return rows;
    },
  };
}

module.exports = { createDb };
