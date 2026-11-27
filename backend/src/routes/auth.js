const express = require('express');
const rateLimit = require('express-rate-limit');
const { hashPassword, verifyPassword, signToken, authenticate } = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;

module.exports = function authRoutes({ repo, config, securityEvent }) {
  const router = express.Router();

  // Limitation anti force brute sur la connexion (par IP, derrière l'Ingress).
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      securityEvent(req, 'login', 'rate_limited');
      res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard' });
    },
  });

  router.post('/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Mot de passe trop court (${MIN_PASSWORD} caractères minimum)` });
    }
    const user = await repo.createUser({ email, passwordHash: await hashPassword(password) });
    if (!user) return res.status(409).json({ error: 'Compte déjà existant' });
    securityEvent(req, 'register', 'success', { userId: user.id });
    return res.status(201).json({ user, token: signToken(user, { secret: config.jwtSecret, ttl: config.jwtTtl }) });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }
    const user = await repo.findUserByEmail(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) {
      // Message identique que l'utilisateur existe ou non (pas d'énumération de comptes).
      securityEvent(req, 'login', 'failure', { email: email.toLowerCase() });
      return res.status(401).json({ error: 'Identifiants invalides' });
    }
    securityEvent(req, 'login', 'success', { userId: user.id });
    const publicUser = { id: user.id, email: user.email, role: user.role };
    return res.json({ user: publicUser, token: signToken(publicUser, { secret: config.jwtSecret, ttl: config.jwtTtl }) });
  });

  router.get('/me', authenticate(config.jwtSecret), (req, res) => res.json({ user: req.user }));

  return router;
};
