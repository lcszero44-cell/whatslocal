import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server as SocketServer } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { ensureDirectories, getOrCreateApiToken, PORT, HOST, DATA_DIR, readJson } from './config.js';
import { createAuthMiddleware, isTrustedPanelRequest } from './security.js';
import { errorHandler, HttpError } from './utils/http.js';
import { WebhookDispatcher } from './services/webhook-dispatcher.js';
import { InstanceManager } from './services/instance-manager.js';
import { createApiRouter } from './routes/api.js';

await ensureDirectories();
const apiToken = await getOrCreateApiToken();
const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: false },
  maxHttpBufferSize: 1e6,
  pingInterval: 25_000,
  pingTimeout: 20_000
});
const settingsPath = path.join(DATA_DIR, 'settings.json');
const getSettings = () => readJson(settingsPath, { webhookUrl: '', webhookSecret: '' });
const dispatcher = new WebhookDispatcher(io, getSettings);
const manager = new InstanceManager(io, dispatcher);
const auth = createAuthMiddleware(apiToken);
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client');

app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(express.json({ limit: '22mb', strict: true }));
app.get('/health', (req, res) => res.json({ success: true, status: 'ok', port: PORT }));
app.get('/local-config', (req, res, next) => {
  if (!isTrustedPanelRequest(req)) return next(new HttpError(403, 'A configuração inicial só pode ser acessada pelo painel local.'));
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ success: true, data: { token: apiToken, socketPath: '/socket.io' } });
});

// Arquivos compilados e a página do painel são públicos somente na interface loopback.
app.use(express.static(clientDir, { index: false, maxAge: '1h', etag: true }));
app.get(['/', '/dashboard'], (req, res, next) => res.sendFile(path.join(clientDir, 'index.html'), (error) => error && next(new HttpError(503, 'Frontend ainda não compilado. Execute npm run build.'))));

// Todas as rotas funcionais exigem token Bearer e uma origem local válida no navegador.
app.use(auth);
app.use('/', createApiRouter({ manager, dispatcher }));
app.use((req, res, next) => next(new HttpError(404, 'Endpoint não encontrado.')));
app.use(errorHandler);

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  const host = socket.handshake.headers.host;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!['localhost:3333', '127.0.0.1:3333'].includes(parsed.host) || parsed.host !== host) return next(new Error('Origem não permitida'));
    } catch { return next(new Error('Origem inválida')); }
  }
  if (socket.handshake.auth?.token !== apiToken) return next(new Error('Token inválido'));
  next();
});
io.on('connection', (socket) => {
  socket.emit('instances:snapshot', manager.list());
  socket.on('instance:subscribe', (id) => {
    if (typeof id === 'string' && manager.instances.has(id)) socket.join(`instance:${id}`);
  });
});

await dispatcher.init();
await manager.init();
httpServer.listen(PORT, HOST, () => {
  console.log(`WhatsLocal ativo em http://${HOST}:${PORT}/dashboard`);
  console.log(`Token da API salvo em ${path.join(DATA_DIR, 'api-token.txt')}`);
});

async function shutdown(signal) {
  console.log(`\n${signal} recebido; encerrando conexões...`);
  dispatcher.close();
  await manager.close();
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
