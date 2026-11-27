// Fonctions pures (testées unitairement en CI).
export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '—';

export const isOverdue = (loan, now = new Date()) => !loan.returned_at && new Date(loan.due_at) < now;

export function loanStatus(loan, now = new Date()) {
  if (loan.returned_at) return 'Rendu';
  return isOverdue(loan, now) ? 'En retard' : 'En cours';
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
