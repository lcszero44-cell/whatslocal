let apiToken = '';

export async function initializeApi() {
  const response = await fetch('/local-config', { cache: 'no-store', credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data?.token) throw new Error(payload?.error || 'Não foi possível obter o token local.');
  apiToken = payload.data.token;
  return payload.data;
}

export async function api(path, options = {}) {
  const { body, headers = {}, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || `Falha HTTP ${response.status}`);
  return payload.data;
}
