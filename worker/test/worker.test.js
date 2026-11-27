const { test } = require('node:test');
const assert = require('node:assert/strict');
const pino = require('pino');
const { renderReceipt } = require('../src/receipt');
const { createHandlers } = require('../src/jobs');
const { runMaintenance } = require('../src/maintenance');

const logger = pino({ level: 'silent' });
const LOAN = {
  id: 42,
  user_email: 'lecteur@biblio.local',
  book_title: 'Le Petit Prince',
  book_author: 'Antoine de Saint-Exupéry',
  borrowed_at: '2026-11-01T10:00:00Z',
  due_at: '2026-11-22T10:00:00Z',
};

test('le reçu généré est un PDF valide', async () => {
  const pdf = await renderReceipt(LOAN);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 500);
});

test('loan.created : génère le reçu, le stocke et référence la clé en base', async () => {
  const stored = [];
  let receiptKey;
  const handlers = createHandlers({
    db: { getLoanDetails: async () => LOAN, setReceiptKey: async (_id, key) => (receiptKey = key) },
    storage: { put: async (bucket, key, buf, type) => stored.push({ bucket, key, type, size: buf.length }) },
    bucket: 'receipts',
    logger,
  });
  await handlers['loan.created']({ loanId: 42 });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].bucket, 'receipts');
  assert.equal(stored[0].type, 'application/pdf');
  assert.equal(receiptKey, 'loans/42.pdf');
});

test('loan.created : un emprunt supprimé entre-temps est ignoré sans erreur', async () => {
  const handlers = createHandlers({
    db: { getLoanDetails: async () => null },
    storage: { put: async () => assert.fail('ne doit pas stocker') },
    bucket: 'receipts',
    logger,
  });
  await handlers['loan.created']({ loanId: 1 });
});

test('maintenance : relances et purge des reçus des emprunts expirés', async () => {
  const removed = [];
  await runMaintenance({
    db: {
      markOverdueReminders: async () => [{ id: 1, user_email: 'a@b.fr', book_title: 'X' }],
      countOverdue: async () => 1,
      purgeOldLoans: async (days) => {
        assert.equal(days, 365);
        return [{ id: 7, receipt_key: 'loans/7.pdf' }, { id: 8, receipt_key: null }];
      },
    },
    storage: { remove: async (bucket, key) => removed.push(`${bucket}/${key}`) },
    bucket: 'receipts',
    retentionDays: 365,
    logger,
  });
  assert.deepEqual(removed, ['receipts/loans/7.pdf']);
});
