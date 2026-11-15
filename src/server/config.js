import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const AUTH_DIR = path.join(ROOT_DIR, 'auth_info');
export const LOG_DIR = path.join(ROOT_DIR, 'logs');
export const PORT = 3333;
export const HOST = process.env.HOST || '127.0.0.1';
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export async function ensureDirectories() {
  await Promise.all([DATA_DIR, AUTH_DIR, LOG_DIR].map((dir) => mkdir(dir, { recursive: true })));
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}

export async function getOrCreateApiToken() {
  const tokenPath = path.join(DATA_DIR, 'api-token.txt');
  try {
    return (await readFile(tokenPath, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const token = randomBytes(32).toString('hex');
    await writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return token;
  }
}
