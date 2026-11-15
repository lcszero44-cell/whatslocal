import { Router } from 'express';
import path from 'node:path';
import { DATA_DIR, readJson, writeJsonAtomic } from '../config.js';
import { asyncRoute, HttpError, sendSuccess } from '../utils/http.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const router = Router();

async function getSettings() {
  return readJson(SETTINGS_FILE, { webhookUrl: '', webhookSecret: '' });
}

export function createApiRouter({ manager, dispatcher }) {
  router.get('/instance/fetch-instances', asyncRoute(async (req, res) => sendSuccess(res, manager.list())));

  router.post('/instance/create', asyncRoute(async (req, res) => {
    const instance = await manager.create(req.body?.name);
    sendSuccess(res, instance, 201);
  }));

  router.post('/instance/delete', asyncRoute(async (req, res) => {
    const result = await manager.delete(req.body?.instanceId);
    sendSuccess(res, result);
  }));

  router.post('/instance/connect', asyncRoute(async (req, res) => {
    const instance = await manager.connect(req.body?.instanceId, { refresh: req.body?.refresh === true });
    sendSuccess(res, instance);
  }));

  router.post('/instance/disconnect', asyncRoute(async (req, res) => {
    const instance = await manager.disconnect(req.body?.instanceId);
    sendSuccess(res, instance);
  }));

  router.get('/instance/:id/qr', asyncRoute(async (req, res) => sendSuccess(res, manager.getQr(req.params.id))));

  router.post('/message/send-text', asyncRoute(async (req, res) => {
    const { instanceId, to, text } = req.body || {};
    const result = await manager.sendText(instanceId, to, text);
    sendSuccess(res, result, 202);
  }));

  router.post('/message/send-media', asyncRoute(async (req, res) => {
    const result = await manager.sendMedia(req.body?.instanceId, req.body?.to, req.body);
    sendSuccess(res, result, 202);
  }));

  router.get('/settings/webhook', asyncRoute(async (req, res) => {
    const settings = await getSettings();
    const queue = await dispatcher.stats();
    sendSuccess(res, { webhookUrl: settings.webhookUrl, secretConfigured: Boolean(settings.webhookSecret), ...queue });
  }));

  router.put('/settings/webhook', asyncRoute(async (req, res) => {
    const urlValue = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl.trim() : '';
    const secretValue = typeof req.body?.webhookSecret === 'string' ? req.body.webhookSecret : '';
    if (urlValue) {
      let parsed;
      try { parsed = new URL(urlValue); } catch { throw new HttpError(400, 'Informe uma URL válida para o webhook.'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
        throw new HttpError(400, 'A URL do webhook deve usar HTTP/HTTPS, sem credenciais nem fragmento.');
      }
    }
    if (secretValue.length > 512) throw new HttpError(400, 'O segredo pode ter no máximo 512 caracteres.');
    const previous = await getSettings();
    const next = { webhookUrl: urlValue, webhookSecret: secretValue || previous.webhookSecret || '' };
    await writeJsonAtomic(SETTINGS_FILE, next);
    sendSuccess(res, { webhookUrl: next.webhookUrl, secretConfigured: Boolean(next.webhookSecret) });
  }));

  router.post('/settings/webhook/test', asyncRoute(async (req, res) => {
    await dispatcher.test();
    sendSuccess(res, { queued: true, message: 'Evento de teste enfileirado.' }, 202);
  }));

  router.post('/settings/webhook/clear-secret', asyncRoute(async (req, res) => {
    const settings = await getSettings();
    await writeJsonAtomic(SETTINGS_FILE, { ...settings, webhookSecret: '' });
    sendSuccess(res, { secretConfigured: false });
  }));

  return router;
}
