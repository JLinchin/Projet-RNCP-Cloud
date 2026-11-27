// Client de l'API REST. Le jeton JWT est conservé en sessionStorage (effacé à la fermeture de l'onglet).
const TOKEN_KEY = 'biblio.token';

export const session = {
  get token() {
    return sessionStorage.getItem(TOKEN_KEY);
  },
  set token(v) {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  },
};

export async function api(path, { method = 'GET', body, form, raw } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
