const { renderReceipt } = require('./receipt');

// Gestionnaires de jobs. Les dépendances sont injectées pour être testables.
function createHandlers({ db, storage, bucket, logger }) {
  return {
    // Emprunt créé -> génération du reçu PDF -> dépôt dans le stockage objet.
    async 'loan.created'({ loanId }) {
      const loan = await db.getLoanDetails(loanId);
      if (!loan) {
        logger.warn({ loanId }, 'emprunt introuvable, job ignoré');
        return;
      }
      const pdf = await renderReceipt(loan);
      const key = `loans/${loan.id}.pdf`;
      await storage.put(bucket, key, pdf, 'application/pdf');
      await db.setReceiptKey(loan.id, key);
      logger.info({ loanId, key, bytes: pdf.length }, 'reçu généré');
    },

    // Retour -> notification (e-mail simulé : journalisé, pas de SMTP dans le périmètre).
    async 'loan.returned'({ loanId }) {
      const loan = await db.getLoanDetails(loanId);
      if (!loan) return;
      logger.info({ notification: 'email', to: loan.user_email, loanId }, `Merci d'avoir rendu « ${loan.book_title} »`);
    },
  };
}

module.exports = { createHandlers };
