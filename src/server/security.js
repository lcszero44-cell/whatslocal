import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './utils/http.js';

const LOCAL_HOSTS = new Set(['localhost:3333', '127.0.0.1:3333']);

function tokenMatches(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isAllowedLocalOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOCAL_HOSTS.has(parsed.host)
      && parsed.host === req.get('host');
  } catch {
    return false;
  }
}

export function isTrustedPanelRequest(req) {
  if (req.get('origin')) return isAllowedLocalOrigin(req);
  const fetchSite = req.get('sec-fetch-site');
  const referer = req.get('referer');
  if (fetchSite && fetchSite !== 'same-origin') return false;
  if (!referer) return false;
  try {
    const parsed = new URL(referer);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOCAL_HOSTS.has(parsed.host)
      && parsed.host === req.get('host');
  } catch {
    return false;
  }
}

export function localOriginGuard(req, res, next) {
  if (!isAllowedLocalOrigin(req)) return next(new HttpError(403, 'Origem não permitida. A API aceita apenas o painel local.'));
  next();
}

export function createAuthMiddleware(apiToken) {
  return (req, res, next) => {
    if (!isAllowedLocalOrigin(req)) return next(new HttpError(403, 'Origem não permitida.'));
    const authorization = req.get('authorization') || '';
    const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!tokenMatches(candidate, apiToken)) return next(new HttpError(401, 'Token ausente ou inválido. Envie Authorization: Bearer <token>.'));
    next();
  };
}
