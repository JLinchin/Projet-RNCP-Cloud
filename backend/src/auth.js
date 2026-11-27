const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Authentification sécurisée (ISO 27001 A.8.5) :
// - mots de passe hachés avec bcrypt (facteur 12), jamais stockés en clair ;
// - jetons JWT signés HS256, durée de vie courte ; l'API reste sans état (stateless).
const BCRYPT_ROUNDS = 12;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

function signToken(user, { secret, ttl }) {
  return jwt.sign({ sub: String(user.id), email: user.email, role: user.role }, secret, {
    algorithm: 'HS256',
    expiresIn: ttl,
  });
}

function authenticate(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentification requise' });
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      req.user = { id: Number(payload.sub), email: payload.email, role: payload.role };
      return next();
    } catch {
      return res.status(401).json({ error: 'Jeton invalide ou expiré' });
    }
  };
}

// Contrôle d'accès basé sur les rôles (A.5.15 / A.8.3).
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) return res.status(403).json({ error: 'Accès refusé' });
    return next();
  };
}

module.exports = { hashPassword, verifyPassword, signToken, authenticate, requireRole };
