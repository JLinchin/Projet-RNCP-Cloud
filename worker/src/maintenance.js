const { overdueLoans, purgedLoans } = require('./metrics');

// Tâche planifiée : relances de retard + application de la politique de conservation.
async function runMaintenance({ db, storage, bucket, retentionDays, logger }) {
  const reminders = await db.markOverdueReminders();
  for (const r of reminders) {
    logger.info({ notification: 'email', to: r.user_email, loanId: r.id }, `Relance : « ${r.book_title} » est en retard`);
  }
  overdueLoans.set(await db.countOverdue());

  const purged = await db.purgeOldLoans(retentionDays);
  for (const p of purged) {
    if (p.receipt_key) await storage.remove(bucket, p.receipt_key).catch(() => {});
  }
  purgedLoans.inc(purged.length);
  logger.info({ reminders: reminders.length, purged: purged.length, retentionDays }, 'maintenance terminée');
}

module.exports = { runMaintenance };
