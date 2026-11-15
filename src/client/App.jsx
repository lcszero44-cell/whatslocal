import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, initializeApi } from './api.js';

const icons = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  phone: <><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/></>,
  plug: <><path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-5 5v5m0-5a5 5 0 0 1-5-5V7Z"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 17.3 6.7L20 12M4 12l2.7 5.3A7 7 0 0 0 18.4 15"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></>,
  unlink: <><path d="m10 13 4-4m-7 8-1 1a5 5 0 0 1-7-7l2-2a5 5 0 0 1 7 0m5-5 1-1a5 5 0 0 1 7 7l-2 2a5 5 0 0 1-7 0"/></>,
  trash: <><path d="M3 6h18m-2 0-1 14H6L5 6m3 0V4h8v2m-7 4v6m4-6v6"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  x: <><path d="m18 6-12 12M6 6l12 12"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  activity: <><path d="M3 12h4l3-9 4 18 3-9h4"/></>,
  message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/></>
};

function Icon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

const statusText = { connected: 'Conectada', qr: 'Aguardando QR', connecting: 'Conectando', disconnected: 'Desconectada', logged_out: 'Sessão encerrada', error: 'Erro' };

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <div className={`toast toast-${toast.type || 'success'}`} role="status"><span className="toast-icon"><Icon name={toast.type === 'error' ? 'x' : 'check'} size={16}/></span><span>{toast.message}</span><button className="icon-button toast-close" onClick={onClose} aria-label="Fechar aviso"><Icon name="x" size={15}/></button></div>;
}

function App() {
  const [token, setToken] = useState('');
  const [instances, setInstances] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState('overview');
  const [settings, setSettings] = useState({ webhookUrl: '', secretConfigured: false, pending: 0, deadLetters: 0 });
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('whatslocal-theme') || 'dark');
  const [toast, setToast] = useState(null);
  const [events, setEvents] = useState([]);

  const selected = useMemo(() => instances.find((item) => item.id === selectedId) || null, [instances, selectedId]);
  const connectedCount = instances.filter((item) => item.status === 'connected').length;
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4200);
  };
  const updateInstance = (item) => setInstances((current) => {
    const found = current.some((entry) => entry.id === item.id);
    return found ? current.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry) : [...current, item];
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('whatslocal-theme', theme);
  }, [theme]);

  useEffect(() => {
    let socket;
    let active = true;
    (async () => {
      try {
        const local = await initializeApi();
        if (!active) return;
        setToken(local.token);
        const [instanceResult, settingsResult] = await Promise.all([api('/instance/fetch-instances'), api('/settings/webhook')]);
        if (!active) return;
        setInstances(instanceResult);
        setSettings(settingsResult);
        setWebhookUrl(settingsResult.webhookUrl || '');
        socket = io({ auth: { token: local.token }, transports: ['websocket', 'polling'] });
        socket.on('instances:snapshot', (snapshot) => setInstances(snapshot));
        socket.on('instance:update', updateInstance);
        socket.on('instance:deleted', ({ instanceId }) => {
          setInstances((current) => current.filter((item) => item.id !== instanceId));
          setSelectedId((current) => current === instanceId ? null : current);
        });
        socket.on('instance:qr', (payload) => {
          setInstances((current) => current.map((item) => item.id === payload.instanceId ? { ...item, status: 'qr', qrAvailable: true, qrImage: payload.imageDataUrl } : item));
          setSelectedId((current) => current || payload.instanceId);
          showToast('Novo QR Code disponível para pareamento.');
        });
        socket.on('app:event', (event) => {
          setEvents((current) => [event, ...current].slice(0, 12));
          if (event.event === 'message.received') showToast(`Mensagem recebida · ${event.data.instanceName}`);
        });
        socket.on('webhook:delivery', (delivery) => {
          if (delivery.state === 'dead-letter') showToast('Um webhook esgotou as tentativas e foi para a fila de falhas.', 'error');
          api('/settings/webhook').then(setSettings).catch(() => {});
        });
        socket.on('connect_error', (error) => console.warn('Socket.io:', error.message));
      } catch (error) {
        showToast(error.message || 'Não foi possível carregar o painel.', 'error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; socket?.disconnect(); };
  }, []);

  async function runAction(key, action, successMessage) {
    setBusy(key);
    try {
      const result = await action();
      if (successMessage) showToast(successMessage);
      return result;
    } catch (error) {
      showToast(error.message || 'A operação falhou.', 'error');
      return null;
    } finally { setBusy(''); }
  }

  async function createInstance(event) {
    event.preventDefault();
    const result = await runAction('create', () => api('/instance/create', { method: 'POST', body: { name: newName } }), 'Instância criada. Escaneie o QR para parear.');
    if (result) {
      updateInstance(result);
      setSelectedId(result.id);
      setNewName('');
      setShowCreate(false);
      setView('overview');
    }
  }

  async function connectInstance(item, refresh = false) {
    const result = await runAction(item.id, () => api('/instance/connect', { method: 'POST', body: { instanceId: item.id, refresh } }), refresh ? 'Solicitação de novo QR enviada.' : 'Conexão iniciada.');
    if (result) updateInstance(result);
  }

  async function disconnectInstance(item) {
    const result = await runAction(item.id, () => api('/instance/disconnect', { method: 'POST', body: { instanceId: item.id } }), 'Instância desconectada.');
    if (result) updateInstance(result);
  }

  async function deleteInstance(item) {
    if (!window.confirm(`Excluir “${item.name}” e remover as credenciais locais dessa sessão?`)) return;
    await runAction(item.id, () => api('/instance/delete', { method: 'POST', body: { instanceId: item.id } }), 'Instância e sessão removidas.');
  }

  async function saveWebhook(event) {
    event.preventDefault();
    const result = await runAction('webhook', () => api('/settings/webhook', { method: 'PUT', body: { webhookUrl, webhookSecret } }), 'Configuração do n8n salva.');
    if (result) {
      setSettings((current) => ({ ...current, ...result }));
      setWebhookSecret('');
    }
  }

  async function testWebhook() {
    await runAction('webhook-test', () => api('/settings/webhook/test', { method: 'POST', body: {} }), 'Evento de teste adicionado à fila de entrega.');
  }

  async function clearWebhookSecret() {
    if (!settings.secretConfigured || !window.confirm('Remover o segredo HMAC salvo? As próximas entregas não terão uma chave compartilhada configurada.')) return;
    const result = await runAction('webhook-secret', () => api('/settings/webhook/clear-secret', { method: 'POST', body: {} }), 'Segredo HMAC removido.');
    if (result) {
      setSettings((current) => ({ ...current, ...result }));
      setWebhookSecret('');
    }
  }

  async function copyText(value, label) {
    try { await navigator.clipboard.writeText(value); showToast(`${label} copiado.`); }
    catch { showToast('Não foi possível copiar automaticamente.', 'error'); }
  }

  const refreshQr = async (item) => {
    const data = await runAction(item.id, () => api('/instance/connect', { method: 'POST', body: { instanceId: item.id, refresh: true } }));
    if (data) updateInstance(data);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setView('overview')} aria-label="Ir para o início">
        <span className="brand-mark"><span/><span/><span/><span/></span>
        <span className="brand-name">whats<span>local</span></span>
      </button>
      <div className="workspace-label">WORKSPACE LOCAL</div>
      <nav className="side-nav" aria-label="Navegação principal">
        <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}><Icon name="grid"/><span>Visão geral</span></button>
        <button className={`nav-item ${view === 'instances' ? 'active' : ''}`} onClick={() => setView('instances')}><Icon name="phone"/><span>Instâncias</span><span className="nav-count">{instances.length}</span></button>
        <button className={`nav-item ${view === 'integrations' ? 'active' : ''}`} onClick={() => setView('integrations')}><Icon name="plug"/><span>Integrações</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="local-card"><span className="local-pulse"/><div><b>Executando localmente</b><small>127.0.0.1:3333</small></div></div>
        <div className="sidebar-foot"><span className="small-brand-dot"/> WhatsLocal <span className="version-label">v1.0</span></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><span>WhatsLocal</span><Icon name="chevron" size={14}/><strong>{view === 'overview' ? 'Visão geral' : view === 'instances' ? 'Instâncias' : 'Integrações'}</strong></div>
        <div className="top-actions"><span className="top-status"><i/> API online</span><button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Alternar tema"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17}/></button><button className="token-button" onClick={() => copyText(token, 'Token local')} title="Copiar token da API"><Icon name="shield" size={15}/><span>Token API</span></button></div>
      </header>

      <div className="content-wrap">
        {loading ? <div className="loading-state"><span className="spinner"/><span>Preparando o painel local...</span></div> : <>
          {view === 'overview' && <>
            <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> PAINEL DE CONTROLE</div><h1>Suas conexões,<br/><em>em um só lugar.</em></h1><p>Gerencie sessões locais e conecte seus fluxos de automação.</p></div><button className="button button-primary" onClick={() => setShowCreate(true)}><Icon name="plus" size={17}/> Nova instância</button></section>
            <section className="stats-row">
              <div className="stat-card"><div className="stat-label">INSTÂNCIAS</div><div className="stat-main"><strong>{instances.length.toString().padStart(2, '0')}</strong><span className="stat-icon"><Icon name="phone"/></span></div><div className="stat-sub">Sessões registradas localmente</div></div>
              <div className="stat-card"><div className="stat-label">CONECTADAS</div><div className="stat-main"><strong>{connectedCount.toString().padStart(2, '0')}</strong><span className="stat-icon green"><Icon name="activity"/></span></div><div className="stat-sub"><i className="inline-dot"/> Prontas para automação</div></div>
              <div className="stat-card"><div className="stat-label">N8N · FILA PENDENTE</div><div className="stat-main"><strong>{String(settings.pending || 0).padStart(2, '0')}</strong><span className="stat-icon amber"><Icon name="plug"/></span></div><div className="stat-sub">{settings.deadLetters || 0} eventos na fila de falhas</div></div>
            </section>
            <section className="section-block"><div className="section-head"><div><div className="section-kicker">SESSÕES ATIVAS</div><h2>Instâncias WhatsApp</h2></div><button className="text-button" onClick={() => setView('instances')}>Ver todas <Icon name="chevron" size={15}/></button></div>
              {instances.length ? <div className="instance-grid">{instances.slice(0, 6).map((item) => <InstanceCard key={item.id} item={item} selected={selectedId === item.id} busy={busy === item.id} onSelect={() => setSelectedId(item.id)} onConnect={() => item.status === 'qr' ? setSelectedId(item.id) : connectInstance(item)} onDisconnect={() => disconnectInstance(item)} onDelete={() => deleteInstance(item)}/>)}</div> : <EmptyInstances onCreate={() => setShowCreate(true)}/>}
            </section>
            <section className="bottom-grid"><div className="panel-card activity-panel"><div className="panel-head"><div><div className="section-kicker">FLUXO LOCAL</div><h3>Atividade recente</h3></div><span className="live-pill"><i/> AO VIVO</span></div>{events.length ? <div className="event-list">{events.slice(0, 5).map((event) => <div className="event-row" key={event.id}><span className="event-icon"><Icon name={event.event === 'message.received' ? 'message' : 'activity'} size={16}/></span><div><b>{eventLabel(event)}</b><small>{new Date(event.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {event.data?.instanceName || event.data?.instanceId || 'Sistema'}</small></div><span className="event-kind">{event.event.split('.')[0]}</span></div>)}</div> : <div className="empty-events"><span className="activity-empty-icon"><Icon name="activity" size={19}/></span><b>Sem eventos por enquanto</b><span>Conexões e mensagens aparecerão aqui em tempo real.</span></div>}</div>
              <div className="panel-card n8n-panel"><div className="n8n-symbol">n8n</div><div className="section-kicker">AUTOMAÇÃO</div><h3>Pronto para o n8n</h3><p>Receba eventos via webhook assinados com HMAC-SHA256 e integre mensagens aos seus fluxos.</p><button className="button button-secondary" onClick={() => setView('integrations')}>Configurar integração <Icon name="chevron" size={15}/></button><div className="n8n-lines"><i/><i/><i/></div></div></section>
          </>}

          {view === 'instances' && <>
            <section className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-dot"/> SESSÕES LOCAIS</div><h1>Instâncias <em>WhatsApp</em></h1><p>As credenciais ficam nesta máquina e são restauradas ao iniciar o sistema.</p></div><button className="button button-primary" onClick={() => setShowCreate(true)}><Icon name="plus" size={17}/> Nova instância</button></section>
            <section className="section-block instance-page-block"><div className="section-head"><div><div className="section-kicker">SUAS SESSÕES</div><h2>{instances.length} {instances.length === 1 ? 'instância cadastrada' : 'instâncias cadastradas'}</h2></div><span className="subtle-note"><Icon name="lock" size={14}/> Dados armazenados localmente</span></div>
              {instances.length ? <div className="instance-grid full-grid">{instances.map((item) => <InstanceCard key={item.id} item={item} selected={selectedId === item.id} busy={busy === item.id} onSelect={() => setSelectedId(item.id)} onConnect={() => item.status === 'qr' ? setSelectedId(item.id) : connectInstance(item)} onDisconnect={() => disconnectInstance(item)} onDelete={() => deleteInstance(item)}/>)}</div> : <EmptyInstances onCreate={() => setShowCreate(true)}/>}
            </section>
          </>}

          {view === 'integrations' && <>
            <section className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-dot"/> CONECTORES</div><h1>Integrações <em>e segurança</em></h1><p>Conecte o n8n e controle como eventos e credenciais trafegam.</p></div></section>
            <section className="integration-layout"><div className="panel-card integration-form-card"><div className="integration-title"><div className="integration-logo n8n-large">n8n</div><div><div className="section-kicker">WEBHOOK DE SAÍDA</div><h2>WhatsLocal → n8n</h2></div><span className={`connection-pill ${settings.webhookUrl ? 'connected' : ''}`}><i/>{settings.webhookUrl ? 'Configurado' : 'Não configurado'}</span></div>
              <p className="integration-copy">Cada evento é enviado como JSON e assinado com HMAC-SHA256. Se o destino falhar, o sistema tenta novamente com backoff exponencial e mantém a fila em disco.</p>
              <form onSubmit={saveWebhook} className="form-stack"><label className="field-label">URL do webhook de produção<span className="field-hint">Use a URL Production do nó Webhook no n8n.</span></label><input className="text-input" type="url" placeholder="https://n8n.exemplo.com/webhook/whatslocal" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} autoComplete="url"/><label className="field-label">Segredo HMAC<span className="field-hint">Opcional. Guarde o mesmo segredo no n8n para validar a assinatura.</span></label><div className="secret-input-wrap"><input className="text-input" type="password" placeholder={settings.secretConfigured ? 'Segredo configurado · deixe em branco para manter' : 'Crie um segredo forte compartilhado'} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} autoComplete="new-password"/><Icon name="lock" size={16}/></div><div className="form-actions"><button className="button button-primary" disabled={busy === 'webhook'} type="submit">{busy === 'webhook' ? 'Salvando…' : 'Salvar configuração'}</button><button className="button button-secondary" disabled={!webhookUrl || busy === 'webhook-test'} type="button" onClick={testWebhook}><Icon name="activity" size={16}/> Enviar teste</button>{settings.secretConfigured && <button className="button button-secondary" disabled={Boolean(busy)} type="button" onClick={clearWebhookSecret}>Remover segredo HMAC</button>}</div></form>
              <div className="signature-note"><Icon name="shield" size={17}/><span><b>Assinatura ativa em cada entrega</b><small>Header <code>X-WhatsLocal-Signature</code> no formato <code>sha256=&lt;hex&gt;</code>.</small></span></div>
            </div>
            <div className="integration-side"><div className="panel-card token-card"><div className="section-kicker">ACESSO À API</div><h3>Seu token local</h3><p>Envie como Bearer Token em cada chamada HTTP feita pelo n8n.</p><div className="token-preview"><Icon name="lock" size={15}/><span>••••••••••••••••••••••••</span><button className="icon-button" onClick={() => copyText(token, 'Token local')} aria-label="Copiar token"><Icon name="copy" size={15}/></button></div><button className="text-button copy-full" onClick={() => copyText(token, 'Token local')}>Copiar token da API <Icon name="copy" size={14}/></button></div>
              <div className="panel-card events-card"><div className="section-kicker">EVENTOS ENVIADOS</div><h3>O que dispara um webhook</h3><div className="event-tags"><code>message.received</code><code>message.sent</code><code>instance.connection</code><code>instance.qr</code><code>system.webhook-test</code></div><div className="privacy-note"><Icon name="shield" size={16}/><span>O QR é dado de autenticação. Evite compartilhá-lo; o webhook só é habilitado quando você informa um destino.</span></div></div>
            </div></section>
          </>}
        </>}
      </div>
      <footer className="main-footer"><span>WhatsLocal <b>·</b> Serviço local nesta máquina</span><span><i/> Conexão protegida por token</span></footer>
    </main>

    {selected && ['qr', 'connecting'].includes(selected.status) && <QrDialog item={selected} busy={busy === selected.id} onClose={() => setSelectedId(null)} onRefresh={() => refreshQr(selected)} onCopy={() => api(`/instance/${selected.id}/qr`).then((data) => copyText(data.qr, 'String do QR')).catch((error) => showToast(error.message, 'error'))}/>}
    {showCreate && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCreate(false)}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="icon-button modal-close" onClick={() => setShowCreate(false)} aria-label="Fechar"><Icon name="x"/></button><div className="modal-icon"><Icon name="phone" size={22}/></div><div className="section-kicker">NOVA SESSÃO</div><h2 id="create-title">Adicionar instância</h2><p>Crie um nome para identificar esta sessão. Um QR Code será gerado para conectar o aparelho.</p><form onSubmit={createInstance}><label className="field-label" htmlFor="instance-name">Nome da instância</label><input id="instance-name" className="text-input" autoFocus placeholder="Ex.: atendimento" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={60}/><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowCreate(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={!newName.trim() || busy === 'create'}>{busy === 'create' ? 'Criando…' : 'Criar instância'} <Icon name="chevron" size={15}/></button></div></form><div className="modal-foot"><Icon name="lock" size={14}/> A sessão será armazenada nesta máquina.</div></div></div>}
    <Toast toast={toast} onClose={() => setToast(null)}/>
  </div>;
}

function InstanceCard({ item, selected, busy, onSelect, onConnect, onDisconnect, onDelete }) {
  const connected = item.status === 'connected';
  return <article className={`instance-card ${selected ? 'selected' : ''}`}>
    <div className="instance-card-top"><div className={`instance-avatar ${connected ? 'online' : ''}`}><Icon name="phone" size={19}/></div><div className={`status-pill status-${item.status}`}><i/>{statusText[item.status] || 'Desconhecido'}</div><button className="icon-button more-button" onClick={onDelete} title="Excluir instância" aria-label={`Excluir ${item.name}`}><Icon name="trash" size={16}/></button></div>
    <button className="instance-name-button" onClick={onSelect}><h3>{item.name}</h3><span className="instance-id">/{item.id}</span></button>
    <div className="instance-meta"><span>{item.phone ? `+${item.phone}` : item.status === 'qr' ? 'Leia o QR no WhatsApp' : 'Nenhum número vinculado'}</span>{item.status === 'qr' && <button onClick={onSelect} className="qr-inline">Abrir QR</button>}</div>
    <div className="card-divider"/>
    <div className="instance-card-actions">{connected ? <button className="button button-subtle" onClick={onDisconnect} disabled={busy}><Icon name="unlink" size={15}/> Desconectar</button> : <button className="button button-card-primary" onClick={onConnect} disabled={busy}><Icon name={item.status === 'qr' ? 'activity' : 'link'} size={15}/>{busy ? 'Aguarde…' : item.status === 'qr' ? 'Ver QR Code' : 'Conectar'}</button>}<button className="icon-button card-open" onClick={onSelect} title="Abrir detalhes"><Icon name="chevron" size={17}/></button></div>
  </article>;
}

function EmptyInstances({ onCreate }) {
  return <div className="empty-instances"><span className="empty-illustration"><span className="empty-ring ring-a"/><span className="empty-ring ring-b"/><span className="empty-phone"><Icon name="phone" size={23}/></span><i className="spark spark-a"/><i className="spark spark-b"/></span><div className="section-kicker">COMECE POR AQUI</div><h3>Nenhuma instância conectada</h3><p>Crie sua primeira sessão e faça o pareamento com um QR Code do WhatsApp.</p><button className="button button-primary" onClick={onCreate}><Icon name="plus" size={16}/> Criar primeira instância</button></div>;
}

function QrDialog({ item, busy, onClose, onRefresh, onCopy }) {
  const qr = item.qrImage;
  return <div className="modal-backdrop qr-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title"><button className="icon-button qr-close" onClick={onClose} aria-label="Fechar"><Icon name="x"/></button><div className="qr-modal-copy"><div className="eyebrow"><span className="eyebrow-dot"/> PAREAMENTO SEGURO</div><h2 id="qr-title">Conecte <em>{item.name}</em></h2><p>Abra o WhatsApp no celular e leia este QR Code em <b>Aparelhos conectados → Conectar aparelho.</b></p><div className="qr-steps"><span><i>01</i> Abra o WhatsApp</span><span><i>02</i> Acesse Aparelhos conectados</span><span><i>03</i> Escaneie o código</span></div><div className="qr-modal-actions"><button className="button button-secondary" onClick={onCopy}><Icon name="copy" size={15}/> Copiar string QR</button><button className="button button-secondary" onClick={onRefresh} disabled={busy}><Icon name="refresh" size={15}/> Atualizar QR</button></div><small className="qr-expiry"><span className="inline-dot"/> QR pode expirar; atualize se necessário.</small></div><div className="qr-visual-wrap"><div className="qr-visual"><div className="qr-frame">{qr ? <img src={qr} alt={`QR Code de pareamento para ${item.name}`}/> : <div className="qr-no-image"><span className="spinner"/><span>Gerando QR...</span></div>}</div><div className="qr-visual-name"><span className="instance-avatar small"><Icon name="phone" size={14}/></span><div><b>{item.name}</b><small>{item.status === 'connected' ? 'Conectada' : 'Aguardando leitura'}</small></div><span className="qr-dot"/></div></div><a className={`qr-download ${qr ? '' : 'disabled'}`} href={qr || undefined} download={`${item.id}-qrcode.png`}><Icon name="download" size={15}/> Baixar imagem PNG</a></div></div></div>;
}

function eventLabel(event) {
  if (event.event === 'message.received') return 'Mensagem recebida';
  if (event.event === 'message.sent') return 'Mensagem enviada';
  if (event.event === 'instance.connection') return `Conexão ${event.data?.status || 'alterada'}`;
  if (event.event === 'instance.qr') return 'Novo QR Code gerado';
  return event.event;
}

export default App;
