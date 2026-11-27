import './style.css';
import { api, session } from './api.js';
import { formatDate, loanStatus, isOverdue, escapeHtml as h } from './format.js';

const $ = (sel) => document.querySelector(sel);
let me = null;

function toast(msg, error = false) {
  const el = document.createElement('div');
  el.className = `toast ${error ? 'error' : ''}`;
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderAuth() {
  $('#session').innerHTML = me
    ? `<span>${h(me.email)} (${me.role === 'admin' ? 'administrateur' : 'lecteur'})</span> <button id="logout">Déconnexion</button>`
    : '';
  $('#auth').hidden = Boolean(me);
  $('#admin').hidden = me?.role !== 'admin';
  $('#loans').hidden = !me;
  if (me) {
    $('#logout').onclick = () => {
      session.token = null;
      me = null;
      refresh();
    };
    return;
  }
  $('#auth').innerHTML = `
    <h2>Connexion</h2>
    <form id="auth-form" class="row">
      <input name="email" type="email" placeholder="Email" required autocomplete="username" />
      <input name="password" type="password" placeholder="Mot de passe (10 caractères min.)" required minlength="10" autocomplete="current-password" />
      <button name="action" value="login">Se connecter</button>
      <button name="action" value="register" class="secondary">Créer un compte</button>
    </form>`;
  $('#auth-form').onsubmit = (ev) =>
    guard(async () => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(ev.target));
      const action = ev.submitter?.value === 'register' ? 'register' : 'login';
      const res = await api(`/auth/${action}`, { method: 'POST', body: { email: data.email, password: data.password } });
      session.token = res.token;
      me = res.user;
      toast(action === 'register' ? 'Compte créé' : 'Connecté');
      refresh();
    });
}

function renderAdmin() {
  if (me?.role !== 'admin') return;
  $('#admin').innerHTML = `
    <h2>Ajouter un ouvrage</h2>
    <form id="book-form" class="row">
      <input name="title" placeholder="Titre" required />
      <input name="author" placeholder="Auteur" required />
      <input name="isbn" placeholder="ISBN (optionnel)" />
      <input name="totalCopies" type="number" min="0" value="1" aria-label="Exemplaires" />
      <input name="cover" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Couverture" />
      <button>Ajouter</button>
    </form>`;
  $('#book-form').onsubmit = (ev) =>
    guard(async () => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const { book } = await api('/books', {
        method: 'POST',
        body: {
          title: fd.get('title'),
          author: fd.get('author'),
          isbn: fd.get('isbn') || undefined,
          totalCopies: Number(fd.get('totalCopies')),
        },
      });
      const cover = fd.get('cover');
      if (cover && cover.size) {
        const form = new FormData();
        form.append('cover', cover);
        await api(`/books/${book.id}/cover`, { method: 'POST', form });
      }
      ev.target.reset();
      toast('Ouvrage ajouté');
      loadBooks();
    });
}

async function loadBooks() {
  const q = $('#search').value.trim();
  const { books } = await api(`/books${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  $('#books').innerHTML =
    books
      .map(
        (b) => `
      <article class="book">
        ${b.has_cover ? `<img src="/api/books/${b.id}/cover" alt="Couverture de ${h(b.title)}" loading="lazy" />` : '<div class="nocover">📖</div>'}
        <h3>${h(b.title)}</h3>
        <p>${h(b.author)}</p>
        <p class="muted">${b.available} / ${b.total_copies} disponible(s)</p>
        ${me ? `<button data-borrow="${b.id}" ${b.available > 0 ? '' : 'disabled'}>Emprunter</button>` : ''}
        ${me?.role === 'admin' ? `<button class="danger" data-delete="${b.id}">Supprimer</button>` : ''}
      </article>`,
      )
      .join('') || '<p class="muted">Aucun ouvrage.</p>';
  document.querySelectorAll('[data-borrow]').forEach((btn) => {
    btn.onclick = () =>
      guard(async () => {
        await api('/loans', { method: 'POST', body: { bookId: Number(btn.dataset.borrow) } });
        toast('Emprunt enregistré — reçu PDF en cours de génération');
        refresh();
      });
  });
  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = () =>
      guard(async () => {
        await api(`/books/${btn.dataset.delete}`, { method: 'DELETE' });
        toast('Ouvrage supprimé');
        loadBooks();
      });
  });
}

async function loadLoans() {
  if (!me) return;
  const { loans } = await api('/loans');
  $('#loans').innerHTML = `
    <h2>${me.role === 'admin' ? 'Tous les emprunts' : 'Mes emprunts'}</h2>
    <table>
      <thead><tr><th>Ouvrage</th>${me.role === 'admin' ? '<th>Lecteur</th>' : ''}<th>Emprunté le</th><th>Retour prévu</th><th>Statut</th><th></th></tr></thead>
      <tbody>${loans
        .map(
          (l) => `<tr class="${isOverdue(l) ? 'overdue' : ''}">
            <td>${h(l.book_title)}</td>${me.role === 'admin' ? `<td>${h(l.user_email)}</td>` : ''}
            <td>${formatDate(l.borrowed_at)}</td><td>${formatDate(l.due_at)}</td><td>${loanStatus(l)}</td>
            <td>
              ${l.has_receipt ? `<button class="secondary" data-receipt="${l.id}">Reçu PDF</button>` : '<span class="muted">reçu en attente</span>'}
              ${l.returned_at ? '' : `<button data-return="${l.id}">Rendre</button>`}
            </td></tr>`,
        )
        .join('')}</tbody>
    </table>`;
  document.querySelectorAll('[data-return]').forEach((btn) => {
    btn.onclick = () =>
      guard(async () => {
        await api(`/loans/${btn.dataset.return}/return`, { method: 'POST' });
        toast('Retour enregistré');
        refresh();
      });
  });
  document.querySelectorAll('[data-receipt]').forEach((btn) => {
    btn.onclick = () =>
      guard(async () => {
        const res = await api(`/loans/${btn.dataset.receipt}/receipt`, { raw: true });
        if (!res.ok) throw new Error('Reçu indisponible');
        const url = URL.createObjectURL(await res.blob());
        window.open(url, '_blank');
      });
  });
}

async function refresh() {
  renderAuth();
  renderAdmin();
  await guard(loadBooks);
  await guard(loadLoans);
}

async function init() {
  if (session.token) {
    try {
      me = (await api('/auth/me')).user;
    } catch {
      session.token = null;
    }
  }
  let t;
  $('#search').oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => guard(loadBooks), 250);
  };
  api('/health')
    .then((v) => ($('#version').textContent = `API v${v.version} — pod ${v.pod}`))
    .catch(() => {});
  refresh();
}

init();
