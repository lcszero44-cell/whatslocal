import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { DATA_DIR, readJson, writeJsonAtomic } from '../config.js';

const QUEUE_FILE = path.join(DATA_DIR, 'webhook-queue.json');
const DEAD_FILE = path.join(DATA_DIR, 'webhook-dead-letter.json');
const MAX_ATTEMPTS = 10;
const MAX_QUEUE_SIZE = 1000;

export class WebhookDispatcher {
  constructor(io, getSettings) {
    this.io = io;
    this.getSettings = getSettings;
    this.queue = [];
    this.deadLetters = [];
    this.running = false;
    this.closed = false;
    this.queueWrites = Promise.resolve();
    this.deadLetterWrites = Promise.resolve();
  }

  async init() {
    this.queue = await readJson(QUEUE_FILE, []);
    this.deadLetters = await readJson(DEAD_FILE, []);
    this.run().catch((error) => console.error('[webhook] worker encerrado inesperadamente', error));
  }

  async emit(event, data) {
    const envelope = { id: randomUUID(), event, timestamp: new Date().toISOString(), data };
    this.io.emit('app:event', envelope);
    const settings = await this.getSettings();
    if (!settings.webhookUrl) return envelope;
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      console.error('[webhook] fila cheia; evento não enfileirado:', event);
      return envelope;
    }
    this.queue.push({ envelope, attempts: 0, nextAttemptAt: Date.now() });
    await this.persistQueue();
    return envelope;
  }

  async stats() {
    return { pending: this.queue.length, deadLetters: this.deadLetters.length };
  }

  async persistQueue() {
    this.queueWrites = this.queueWrites.catch(() => {}).then(() => writeJsonAtomic(QUEUE_FILE, this.queue));
    await this.queueWrites;
  }

  async persistDeadLetters() {
    this.deadLetterWrites = this.deadLetterWrites.catch(() => {}).then(() => writeJsonAtomic(DEAD_FILE, this.deadLetters.slice(-500)));
    await this.deadLetterWrites;
  }

  async run() {
    if (this.running) return;
    this.running = true;
    while (!this.closed) {
      const next = this.queue[0];
      if (!next) {
        await delay(1000);
        continue;
      }
      const waitMs = Math.max(0, next.nextAttemptAt - Date.now());
      if (waitMs) await delay(Math.min(waitMs, 1000));
      if (next.nextAttemptAt > Date.now()) continue;
      const settings = await this.getSettings();
      if (!settings.webhookUrl) {
        await delay(1000);
        continue;
      }
      const body = JSON.stringify(next.envelope);
      const signature = createHmac('sha256', settings.webhookSecret || '').update(body).digest('hex');
      try {
        const response = await fetch(settings.webhookUrl, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(12000),
          headers: {
            'Content-Type': 'application/json',
            'X-WhatsLocal-Event': next.envelope.event,
            'X-WhatsLocal-Delivery': next.envelope.id,
            'X-WhatsLocal-Signature': `sha256=${signature}`
          },
          body
        });
        if (!response.ok) throw new Error(`n8n respondeu HTTP ${response.status}`);
        this.queue.shift();
        await this.persistQueue();
        this.io.emit('webhook:delivery', { id: next.envelope.id, state: 'delivered' });
      } catch (error) {
        next.attempts += 1;
        if (next.attempts >= MAX_ATTEMPTS) {
          this.queue.shift();
          this.deadLetters.push({ ...next, failedAt: new Date().toISOString(), lastError: error.message });
          await this.persistQueue();
          await this.persistDeadLetters();
          this.io.emit('webhook:delivery', { id: next.envelope.id, state: 'dead-letter', attempts: next.attempts });
          console.error('[webhook] evento movido para dead-letter:', next.envelope.id, error.message);
        } else {
          const backoff = Math.min(1000 * (2 ** (next.attempts - 1)), 5 * 60 * 1000);
          const jitter = Math.floor(Math.random() * Math.min(1000, backoff / 4));
          next.nextAttemptAt = Date.now() + backoff + jitter;
          await this.persistQueue();
          this.io.emit('webhook:delivery', { id: next.envelope.id, state: 'retrying', attempts: next.attempts });
          console.warn(`[webhook] tentativa ${next.attempts}/${MAX_ATTEMPTS} falhou:`, error.message);
        }
      }
    }
    this.running = false;
  }

  async test() {
    const settings = await this.getSettings();
    if (!settings.webhookUrl) throw new Error('Configure a URL do webhook antes de testar.');
    return this.emit('system.webhook-test', { message: 'Teste de conexão do WhatsLocal com o n8n.' });
  }

  close() {
    this.closed = true;
  }
}
