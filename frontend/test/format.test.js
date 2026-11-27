import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue, loanStatus, escapeHtml, formatDate } from '../src/format.js';

const now = new Date('2026-11-27T12:00:00Z');

test('statut des emprunts', () => {
  assert.equal(loanStatus({ returned_at: '2026-11-01', due_at: '2026-10-01' }, now), 'Rendu');
  assert.equal(loanStatus({ returned_at: null, due_at: '2026-11-01' }, now), 'En retard');
  assert.equal(loanStatus({ returned_at: null, due_at: '2026-12-15' }, now), 'En cours');
  assert.equal(isOverdue({ returned_at: null, due_at: '2026-12-15' }, now), false);
});

test('échappement HTML (protection XSS)', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('format de date', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('2026-11-27T12:00:00Z'), '27/11/2026');
});
