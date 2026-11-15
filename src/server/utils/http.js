export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('[api]', error);
  return res.status(status).json({
    success: false,
    error: status >= 500 ? 'Erro interno do servidor.' : error.message,
    ...(error.details ? { details: error.details } : {})
  });
}
