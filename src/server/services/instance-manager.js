import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'node:path';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { AUTH_DIR, DATA_DIR, readJson, writeJsonAtomic } from '../config.js';
import { HttpError } from '../utils/http.js';

const INSTANCES_FILE = path.join(DATA_DIR, 'instances.json');
const log = pino({ level: process.env.LOG_LEVEL || 'warn' });
const MAX_RECONNECT_MS = 60_000;

function extractText(message = {}) {
  return message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || message.videoMessage?.caption
    || message.documentMessage?.caption
    || message.buttonsResponseMessage?.selectedDisplayText
    || message.listResponseMessage?.title
    || message.templateButtonReplyMessage?.selectedDisplayText
    || '';
}

function toWhatsAppFormatting(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    .replace(/__(.+?)__/gs, '*$1*')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '_$1_')
    .replace(/~~(.+?)~~/gs, '~$1~')
    .replace(/(?<!`)`([^`\n]+)`(?!`)/g, '```$1```');
}

export function normalizePhone(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Informe o número de destino.');
  const input = value.trim();
  if (input.includes('@')) {
    if (!/^\d{5,20}@(s\.whatsapp\.net|g\.us|lid)$/.test(input)) throw new HttpError(400, 'JID inválido.');
    return input;
  }
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new HttpError(400, 'Número inválido. Use o código do país e DDD, sem ramal.');
  return `${digits}@s.whatsapp.net`;
}

export class InstanceManager {
  constructor(io, dispatcher) {
    this.io = io;
    this.dispatcher = dispatcher;
    this.instances = new Map();
    this.indexWrites = Promise.resolve();
  }

  async init() {
    const stored = await readJson(INSTANCES_FILE, []);
    for (const item of stored) {
      if (!item?.id || !item?.name) continue;
      const folder = path.join(AUTH_DIR, item.id);
      try {
        await readdir(folder);
      } catch {
        continue;
      }
      const instance = this.makeRecord(item.id, item.name);
      this.instances.set(item.id, instance);
    }
    for (const instance of this.instances.values()) {
      this.connect(instance.id).catch((error) => console.error(`[instance:${instance.id}] restauração falhou`, error));
    }
  }

  makeRecord(id, name) {
    return {
      id,
      name,
      status: 'disconnected',
      qr: null,
      qrImage: null,
      qrRevision: 0,
      phone: null,
      socket: null,
      transitionQueue: Promise.resolve(),
      refreshPromise: null,
      generation: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
      intentionalDisconnect: false,
      startedAt: null,
      updatedAt: new Date().toISOString()
    };
  }

  publicRecord(item) {
    return {
      id: item.id,
      name: item.name,
      status: item.status,
      phone: item.phone,
      qrAvailable: Boolean(item.qr),
      qrImage: item.qrImage,
      updatedAt: item.updatedAt,
      reconnectAttempts: item.reconnectAttempts
    };
  }

  async saveIndex() {
    this.indexWrites = this.indexWrites.catch(() => {}).then(() => {
      const records = [...this.instances.values()].map(({ id, name }) => ({ id, name }));
      return writeJsonAtomic(INSTANCES_FILE, records);
    });
    await this.indexWrites;
  }

  list() {
    return [...this.instances.values()].map((item) => this.publicRecord(item));
  }

  get(id) {
    const item = this.instances.get(id);
    if (!item) throw new HttpError(404, 'Instância não encontrada.');
    return item;
  }

  async create(name) {
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 60) : '';
    if (!cleanName) throw new HttpError(400, 'Informe um nome para a instância.');
    const id = cleanName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (!id) throw new HttpError(400, 'O nome deve conter letras ou números.');
    if (this.instances.has(id)) throw new HttpError(409, 'Já existe uma instância com esse nome.');
    const instance = this.makeRecord(id, cleanName);
    this.instances.set(id, instance);
    await mkdir(path.join(AUTH_DIR, id), { recursive: true });
    await this.saveIndex();
    await this.connect(id);
    return this.publicRecord(instance);
  }

  enqueueTransition(instance, operation) {
    const result = instance.transitionQueue.catch(() => {}).then(() => {
      if (this.instances.get(instance.id) !== instance) throw new HttpError(404, 'Instância não encontrada.');
      return operation();
    });
    instance.transitionQueue = result.catch(() => {});
    return result;
  }

  connect(id, options = {}) {
    const instance = this.get(id);
    if (options.refresh && instance.refreshPromise) return instance.refreshPromise;
    const operation = this.enqueueTransition(instance, () => this.startConnection(instance, options));
    if (options.refresh) {
      instance.refreshPromise = operation;
      operation.finally(() => {
        if (instance.refreshPromise === operation) instance.refreshPromise = null;
      }).catch(() => {});
    }
    return operation;
  }

  async startConnection(instance, { refresh = false } = {}) {
    if (instance.socket && ['connecting', 'qr', 'connected'].includes(instance.status) && !refresh) return this.publicRecord(instance);
    if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
    instance.reconnectTimer = null;
    const oldSocket = instance.socket;
    if (oldSocket) {
      instance.intentionalDisconnect = true;
      instance.generation += 1;
      instance.socket = null;
      try { oldSocket.end(new Error('Atualização solicitada')); } catch {}
    }
    const wasLoggedOut = instance.status === 'logged_out';
    instance.intentionalDisconnect = false;
    instance.status = 'connecting';
    instance.updatedAt = new Date().toISOString();
    this.io.emit('instance:update', this.publicRecord(instance));
    const authPath = path.join(AUTH_DIR, instance.id);
    if (wasLoggedOut) await rm(authPath, { recursive: true, force: true });
    await mkdir(authPath, { recursive: true });
    const generation = ++instance.generation;
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const sock = makeWASocket({
        auth: state,
        logger: log,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 45_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000
      });
      instance.socket = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (update) => {
        if (generation === instance.generation) this.handleConnectionUpdate(instance, update, generation).catch((error) => log.warn({ err: error, id: instance.id }, 'evento de conexão falhou'));
      });
      sock.ev.on('messages.upsert', (event) => {
        if (generation === instance.generation) this.handleMessages(instance, event).catch((error) => log.warn({ err: error, id: instance.id }, 'evento de mensagem falhou'));
      });
    } catch (error) {
      instance.socket = null;
      instance.status = 'error';
      instance.updatedAt = new Date().toISOString();
      this.io.emit('instance:update', this.publicRecord(instance));
      throw new HttpError(500, `Falha ao iniciar Baileys: ${error.message}`);
    }
    return this.publicRecord(instance);
  }

  async handleConnectionUpdate(instance, update, generation) {
    if (generation !== instance.generation) return;
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      const qrRevision = ++instance.qrRevision;
      const qrImage = await QRCode.toDataURL(qr, { width: 320, margin: 2, errorCorrectionLevel: 'M' }).catch(() => null);
      if (generation !== instance.generation || this.instances.get(instance.id) !== instance || qrRevision !== instance.qrRevision) return;
      instance.qr = qr;
      instance.qrImage = qrImage;
      instance.status = 'qr';
      instance.updatedAt = new Date().toISOString();
      this.io.emit('instance:qr', { instanceId: instance.id, qr, imageDataUrl: instance.qrImage, generatedAt: instance.updatedAt });
      this.io.emit('instance:update', this.publicRecord(instance));
      this.dispatcher.emit('instance.qr', { instanceId: instance.id, name: instance.name, qr }).catch((error) => log.warn({ err: error }, 'webhook QR falhou'));
    }
    if (connection === 'open') {
      instance.qrRevision += 1;
      instance.status = 'connected';
      instance.qr = null;
      instance.qrImage = null;
      instance.reconnectAttempts = 0;
      instance.startedAt = new Date().toISOString();
      const meId = instance.socket?.user?.id || '';
      instance.phone = meId ? meId.split(':')[0].split('@')[0] : null;
      instance.updatedAt = new Date().toISOString();
      this.io.emit('instance:update', this.publicRecord(instance));
      this.dispatcher.emit('instance.connection', { instanceId: instance.id, name: instance.name, status: 'connected', phone: instance.phone }).catch((error) => log.warn({ err: error }, 'webhook conexão falhou'));
    }
    if (connection === 'close') {
      instance.qrRevision += 1;
      const error = lastDisconnect?.error;
      const statusCode = error instanceof Boom ? error.output?.statusCode : error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const restartRequired = statusCode === DisconnectReason.restartRequired;
      instance.socket = null;
      instance.status = loggedOut ? 'logged_out' : 'disconnected';
      instance.updatedAt = new Date().toISOString();
      instance.qr = null;
      instance.qrImage = null;
      this.io.emit('instance:update', this.publicRecord(instance));
      this.dispatcher.emit('instance.connection', {
        instanceId: instance.id,
        name: instance.name,
        status: instance.status,
        reason: error?.message || 'connection closed'
      }).catch((dispatchError) => log.warn({ err: dispatchError }, 'webhook desconexão falhou'));
      if (!instance.intentionalDisconnect && !loggedOut) {
        const wait = restartRequired ? 1000 : Math.min(1000 * (2 ** instance.reconnectAttempts), MAX_RECONNECT_MS);
        instance.reconnectAttempts += 1;
        instance.reconnectTimer = setTimeout(() => {
          instance.reconnectTimer = null;
          this.connect(instance.id).catch((connectError) => log.warn({ err: connectError, id: instance.id }, 'reconexão falhou'));
        }, wait);
      }
    }
  }

  async handleMessages(instance, event) {
    if (event.type !== 'notify') return;
    for (const message of event.messages || []) {
      if (message.key?.fromMe || !message.key?.remoteJid) continue;
      const payload = {
        instanceId: instance.id,
        instanceName: instance.name,
        messageId: message.key.id || null,
        from: message.key.remoteJid,
        participant: message.key.participant || null,
        pushName: message.pushName || null,
        text: extractText(message.message || {}),
        messageType: Object.keys(message.message || {})[0] || 'unknown',
        timestamp: message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toISOString() : new Date().toISOString()
      };
      await this.dispatcher.emit('message.received', payload).catch((error) => log.warn({ err: error }, 'webhook mensagem recebida falhou'));
    }
  }

  disconnect(id) {
    const instance = this.get(id);
    return this.enqueueTransition(instance, async () => {
      instance.intentionalDisconnect = true;
      instance.generation += 1;
      if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
      const socket = instance.socket;
      instance.socket = null;
      instance.status = 'disconnected';
      instance.qr = null;
      instance.qrImage = null;
      instance.updatedAt = new Date().toISOString();
      if (socket) {
        try { socket.end(new Error('Desconexão solicitada pelo painel')); } catch (error) { log.debug({ err: error }, 'socket já encerrado'); }
      }
      this.io.emit('instance:update', this.publicRecord(instance));
      await this.dispatcher.emit('instance.connection', { instanceId: instance.id, name: instance.name, status: 'disconnected', reason: 'manual' });
      return this.publicRecord(instance);
    });
  }

  delete(id) {
    const instance = this.get(id);
    return this.enqueueTransition(instance, async () => {
      instance.intentionalDisconnect = true;
      instance.generation += 1;
      if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
      const socket = instance.socket;
      instance.socket = null;
      if (socket) {
        try { await socket.logout(); } catch (error) { log.warn({ err: error }, 'logout antes da exclusão falhou'); }
      }
      instance.status = 'disconnected';
      instance.qr = null;
      instance.qrImage = null;
      await this.dispatcher.emit('instance.connection', { instanceId: id, name: instance.name, status: 'deleted', reason: 'deleted' });
      this.instances.delete(id);
      await rm(path.join(AUTH_DIR, id), { recursive: true, force: true });
      await this.saveIndex();
      this.io.emit('instance:deleted', { instanceId: id });
      return { id, deleted: true };
    });
  }

  async sendText(id, to, text) {
    const instance = this.get(id);
    if (instance.status !== 'connected' || !instance.socket) throw new HttpError(409, 'A instância não está conectada.');
    if (typeof text !== 'string' || !text.trim() || text.length > 65_536) throw new HttpError(400, 'O texto é obrigatório e deve ter até 65.536 caracteres.');
    const destination = normalizePhone(to);
    const result = await instance.socket.sendMessage(destination, { text: toWhatsAppFormatting(text) });
    await this.dispatcher.emit('message.sent', { instanceId: id, to: destination, messageId: result?.key?.id || null, type: 'text' });
    return { messageId: result?.key?.id || null, to: destination };
  }

  async sendMedia(id, to, payload) {
    const instance = this.get(id);
    if (instance.status !== 'connected' || !instance.socket) throw new HttpError(409, 'A instância não está conectada.');
    const { kind, mimetype, caption, fileName, base64, url, ptt } = payload || {};
    if (!['image', 'video', 'audio', 'document'].includes(kind)) throw new HttpError(400, 'kind deve ser image, video, audio ou document.');
    let buffer;
    if (typeof base64 === 'string' && base64.length) {
      const encoded = base64.replace(/^data:[^,]*;base64,/i, '').replace(/\s/g, '');
      if (encoded.length > Math.ceil(16 * 1024 * 1024 * 4 / 3) + 8) throw new HttpError(413, 'Arquivo maior que 16 MB.');
      buffer = Buffer.from(encoded, 'base64');
      if (!buffer.length) throw new HttpError(400, 'Base64 inválido ou vazio.');
    } else if (typeof url === 'string' && url) {
      let mediaUrl;
      try { mediaUrl = new URL(url); } catch { throw new HttpError(400, 'URL de mídia inválida.'); }
      if (!['http:', 'https:'].includes(mediaUrl.protocol) || mediaUrl.username || mediaUrl.password) throw new HttpError(400, 'A URL de mídia deve ser HTTP/HTTPS e não pode conter credenciais.');
      let response;
      try {
        response = await fetch(mediaUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        throw new HttpError(400, `Não foi possível buscar a mídia: ${error.message}`);
      }
      if (!response.ok) throw new HttpError(400, `A URL de mídia respondeu HTTP ${response.status}.`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 16 * 1024 * 1024) throw new HttpError(413, 'Arquivo maior que 16 MB.');
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 16 * 1024 * 1024) throw new HttpError(413, 'Arquivo maior que 16 MB.');
      buffer = Buffer.from(arrayBuffer);
    } else {
      throw new HttpError(400, 'Informe base64 ou url para a mídia.');
    }
    if (buffer.length > 16 * 1024 * 1024) throw new HttpError(413, 'Arquivo maior que 16 MB.');
    const mime = typeof mimetype === 'string' && mimetype.includes('/') ? mimetype.slice(0, 120) : 'application/octet-stream';
    const safeFileName = typeof fileName === 'string' && fileName.trim() ? path.basename(fileName).slice(0, 180) : `arquivo-${Date.now()}`;
    const content = kind === 'image' ? { image: buffer, mimetype: mime, caption: caption || undefined }
      : kind === 'video' ? { video: buffer, mimetype: mime, caption: caption || undefined }
        : kind === 'audio' ? { audio: buffer, mimetype: mime, ptt: Boolean(ptt) }
          : { document: buffer, mimetype: mime, fileName: safeFileName, caption: caption || undefined };
    const destination = normalizePhone(to);
    const result = await instance.socket.sendMessage(destination, content);
    await this.dispatcher.emit('message.sent', { instanceId: id, to: destination, messageId: result?.key?.id || null, type: kind, fileName: safeFileName });
    return { messageId: result?.key?.id || null, to: destination, kind, bytes: buffer.length };
  }

  getQr(id) {
    const instance = this.get(id);
    if (!instance.qr) throw new HttpError(404, 'QR indisponível. Conecte ou atualize a instância para gerar outro código.');
    return { instanceId: id, qr: instance.qr, imageDataUrl: instance.qrImage, generatedAt: instance.updatedAt };
  }

  async close() {
    for (const instance of this.instances.values()) {
      instance.intentionalDisconnect = true;
      instance.generation += 1;
      if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
      try { instance.socket?.end(new Error('Servidor encerrando')); } catch {}
    }
  }
}
