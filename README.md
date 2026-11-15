# WhatsLocal

Painel local para gerenciar múltiplas sessões do WhatsApp Web, com API REST e webhooks de saída para o n8n. Por padrão, a API escuta somente em `127.0.0.1:3333`; não é publicada na internet.

> **Importante:** Baileys é uma biblioteca independente e não oficial, não é a WhatsApp Business Platform nem tem vínculo com a Meta. O protocolo pode mudar, e o uso automatizado pode violar os termos aplicáveis ou causar restrições da conta. Use somente com contas autorizadas e contatos que esperam receber mensagens. Não use para spam, disparos em massa ou vigilância. Para operação comercial crítica, prefira a WhatsApp Business Platform oficial. Nenhum software pode garantir "zero bugs" ou disponibilidade permanente.

## Funcionalidades

- **Múltiplas instâncias**: Gerencie várias sessões do WhatsApp simultaneamente
- **QR Code no painel**: Pareamento visual pelo navegador
- **API REST**: Envio de texto e mídia (imagem, vídeo, áudio, documento)
- **Webhooks para n8n**: Eventos assinados com HMAC-SHA256, retentativas com backoff exponencial
- **Tempo real**: Socket.io para atualizações instantâneas de status, QR e mensagens
- **Segurança local**: Bind apenas em localhost, token Bearer, validação de origem

## Requisitos

- **Node.js 20.19 ou superior** (recomendado: Node 22 LTS)
- Windows (scripts `.bat` inclusos) ou Linux/macOS (use `npm start`)

## Instalação

### Windows (recomendado)

1. Clone o repositório:
   ```bash
   git clone https://github.com/seu-usuario/whatslocal.git
   cd whatslocal
   ```

2. Execute o instalador:
   ```bash
   start.bat
   ```

   O script faz automaticamente:
   - Verifica a versão do Node.js (≥ 20.19)
   - Instala dependências (`npm install`)
   - Compila o painel React (`npm run build`)
   - Inicia o servidor em segundo plano
   - Abre o painel em `http://localhost:3333/dashboard`

3. No painel, clique em **Nova instância**, dê um nome e escaneie o QR Code no WhatsApp:
   - Abra o WhatsApp no celular
   - Vá em **Aparelhos conectados → Conectar aparelho**
   - Escaneie o QR Code exibido

### Linux / macOS / Desenvolvimento

```bash
# Instalar dependências
npm install

# Compilar o painel (produção)
npm run build

# Iniciar servidor
npm start
```

Para desenvolvimento com recarga rápida (hot reload), use dois terminais:

```bash
# Terminal 1: API + Socket.io
npm start

# Terminal 2: Vite dev server (proxy para API)
npm run dev
```

O painel estará em `http://localhost:5173` (proxy para `127.0.0.1:3333`).

## Estrutura do Projeto

```
whatslocal/
├── start.bat              # Inicializador Windows (instala, builda, inicia)
├── run-server.bat         # Inicia apenas o servidor (logs em logs/server.log)
├── package.json
├── vite.config.js         # Config Vite + proxy para desenvolvimento
├── .env.example           # Exemplo de variáveis de ambiente
├── .gitignore
├── src/
│   ├── server/            # Backend (Express + Socket.io + Baileys)
│   │   ├── index.js       # Bootstrap do servidor
│   │   ├── config.js      # Diretórios, portas, token API
│   │   ├── security.js    # Middleware de auth + validação de origem
│   │   ├── routes/api.js  # Rotas REST
│   │   ├── services/
│   │   │   ├── instance-manager.js    # Ciclo de vida Baileys, QR, mensagens
│   │   │   └── webhook-dispatcher.js  # Fila, retentativas, HMAC, dead-letter
│   │   └── utils/http.js  # Helpers de erro e resposta
│   └── client/            # Frontend (React + Tailwind)
│       ├── index.html
│       ├── main.jsx
│       ├── App.jsx        # Dashboard completo
│       ├── api.js         # Cliente API + Socket.io
│       └── styles.css     # Tailwind + estilos customizados
├── auth_info/             # Sessões criptográficas por instância (NÃO COMMITAR)
├── data/                  # Token API, config, fila webhook, dead-letter (NÃO COMMITAR)
├── logs/                  # Logs de execução (NÃO COMMITAR)
└── dist/                  # Build de produção do frontend (gerado pelo build)
```

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz (baseado no `.env.example`):

```env
# Padrão seguro: servidor acessível somente neste computador.
HOST=127.0.0.1
LOG_LEVEL=warn
```

> ⚠️ **Atenção**: Se precisar acessar de outro container (ex: n8n no Docker Desktop), use `HOST=0.0.0.0`. Isso expõe a porta na rede local. **Proteja o token**, configure firewall e não use em redes não confiáveis. A URL acessível pelo container será `http://host.docker.internal:3333`.

## API REST

**Base URL**: `http://127.0.0.1:3333` (ou `http://host.docker.internal:3333` no Docker)

**Autenticação**: Header `Authorization: Bearer SEU_TOKEN_LOCAL`
- Copie o token no botão **Token API** do painel
- Também fica em `data/api-token.txt`

### Endpoints Principais

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check (sem token) |
| `GET` | `/instance/fetch-instances` | Listar instâncias |
| `POST` | `/instance/create` | Criar instância `{ "name": "atendimento" }` |
| `POST` | `/instance/connect` | Conectar/renovar QR `{ "instanceId": "atendimento", "refresh": true }` |
| `POST` | `/instance/disconnect` | Desconectar instância |
| `GET` | `/instance/:id/qr` | Obter QR (string + data URL PNG) |
| `POST` | `/instance/delete` | Excluir instância e sessão local |
| `POST` | `/message/send-text` | Enviar texto |
| `POST` | `/message/send-media` | Enviar mídia (URL ou Base64) |
| `GET` | `/settings/webhook` | Ver configuração do webhook |
| `PUT` | `/settings/webhook` | Configurar webhook n8n |
| `POST` | `/settings/webhook/test` | Enviar evento de teste |
| `POST` | `/settings/webhook/clear-secret` | Remover segredo HMAC |

### Exemplos

**Enviar texto:**
```bash
curl -X POST http://127.0.0.1:3333/message/send-text \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "atendimento",
    "to": "5511999999999",
    "text": "Olá! **Negrito**, *itálico*, ~~tachado~~ e `código`."
  }'
```

**Enviar imagem por URL:**
```bash
curl -X POST http://127.0.0.1:3333/message/send-media \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "atendimento",
    "to": "5511999999999",
    "kind": "image",
    "url": "https://exemplo.com/imagem.jpg",
    "mimetype": "image/jpeg",
    "caption": "Legenda opcional"
  }'
```

> Números no formato internacional: código do país + DDD + número (apenas dígitos). Ex: `5511999999999` ou `5511999999999@s.whatsapp.net`.
> Limite de mídia: 16 MB.

## Webhook para n8n

No painel, aba **Integrações**:
1. Cole a **URL Production** do nó Webhook do n8n
2. Defina um **segredo HMAC** compartilhado (opcional, mas recomendado)
3. Salve

### Envelope do Webhook

```json
{
  "id": "uuid-da-entrega",
  "event": "message.received",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "data": {
    "instanceId": "atendimento",
    "instanceName": "Atendimento",
    "messageId": "id-da-mensagem",
    "from": "5511999999999@s.whatsapp.net",
    "pushName": "Contato",
    "text": "Olá",
    "messageType": "conversation",
    "timestamp": "2026-01-01T11:59:58.000Z"
  }
}
```

**Headers de segurança:**
- `X-WhatsLocal-Event`: nome do evento
- `X-WhatsLocal-Delivery`: UUID da entrega
- `X-WhatsLocal-Signature`: `sha256=<hex>` (HMAC-SHA256 do corpo JSON com o segredo)

**Eventos disponíveis:**
- `message.received` — mensagem recebida
- `message.sent` — mensagem enviada (pela API)
- `instance.connection` — conexão/desconexão/ logged_out
- `instance.qr` — novo QR Code gerado
- `system.webhook-test` — teste de conectividade

**Retentativas:** Falhas HTTP/timeout são retentadas com backoff exponencial (até 10 tentativas). Após esgotar, o evento vai para a fila dead-letter em `data/webhook-dead-letter.json`.

### Validar assinatura no n8n (nó Code)

```javascript
const crypto = require('crypto');
const secret = $credentials.webhookSecret; // configure como credencial
const signature = $request.headers['x-whatslocal-signature'];
const body = JSON.stringify($request.body);
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

// Comparação em tempo constante (recomendado para produção)
const match = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
if (!match) throw new Error('Assinatura inválida');
```

## Socket.io (Tempo Real)

Conecte com `socket.io-client`:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:3333', {
  auth: { token: 'SEU_TOKEN_LOCAL' },
  transports: ['websocket', 'polling']
});

socket.on('instances:snapshot', (instances) => console.log(instances));
socket.on('instance:update', (instance) => console.log('Status:', instance.status));
socket.on('instance:qr', ({ instanceId, qr, imageDataUrl }) => console.log('QR:', qr));
socket.on('app:event', (event) => console.log('Evento:', event.event, event.data));
socket.on('webhook:delivery', (delivery) => console.log('Webhook:', delivery.state));
```

**Eventos:**
- `instances:snapshot` — lista inicial ao conectar
- `instance:update` — mudança de status/telefone/QR
- `instance:qr` — novo QR Code (string + data URL PNG)
- `instance:deleted` — instância removida
- `app:event` — todos os eventos de webhook (message.received, etc.)
- `webhook:delivery` — status de entrega do webhook

## Segurança e Boas Práticas

- **Bind padrão**: `127.0.0.1:3333` — não acessível de fora da máquina
- **Token Bearer**: gerado automaticamente na primeira execução (64 chars hex)
- **Validação de origem**: API e Socket.io aceitam apenas `localhost:3333` / `127.0.0.1:3333`
- **HMAC-SHA256**: webhooks assinados para autenticar o remetente
- **Dados sensíveis**: `auth_info/` (chaves privadas Baileys) e `data/` (token, config) **nunca devem ser commitados** — estão no `.gitignore`
- **Limite de mídia**: 16 MB por arquivo (download via URL ou Base64)

## Solução de Problemas

| Problema | Solução |
|----------|---------|
| Porta 3333 ocupada | Feche o processo `node.exe` no Gerenciador de Tarefas ou mate a porta |
| QR não aparece | Clique em "Atualizar QR" ou desconecte/conecte a instância |
| Webhook não chega | Verifique URL, segredo, firewall e logs em `logs/server.log` |
| Sessão não restaura | Apague a pasta em `auth_info/<id>` e reconecte |
| Erro de build | Delete `node_modules` e `package-lock.json`, rode `npm install` novamente |

## Licença

MIT — veja [LICENSE](LICENSE).

---

**Desenvolvido com:** Node.js, Express, Socket.io, Baileys, React, Vite, Tailwind CSS.