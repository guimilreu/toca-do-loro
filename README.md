# Toca do Loro

Uma toca só, sempre aberta. Quem abre o site digita um nome, entra e já fala —
voz, tela e câmera, sem cadastro e sem instalar nada.

A identidade é carioca de propósito: azul-arara no fundo, amarelo de Louro José
nas ações, verde em quem está falando. Cor e geometria; nada de estampa.

## Como funciona

- **Mídia é P2P (mesh)**: cada participante abre uma `RTCPeerConnection` com cada
  um dos outros. Áudio e vídeo nunca passam pelo servidor — e, como não há
  servidor de mídia no meio, a call já é criptografada ponta a ponta pelo
  DTLS-SRTP.
- **O servidor só sinaliza**: relaya SDP/ICE, guarda quem está em qual toca e
  repassa chat e moderação. Nada é gravado nem persistido: toca vazia é toca
  zerada, e reiniciar o processo apaga tudo.
- **Sem renegociação**: cada conexão nasce com quatro transceivers em ordem fixa
  (microfone, áudio da tela, vídeo da tela, câmera). Ligar ou desligar qualquer
  coisa é um `replaceTrack` — não há novo offer/answer no meio da call.

```
navegador ──WebSocket (SDP/ICE, chat, presença)──> servidor Node
    └──────────── áudio, tela e câmera direto, P2P (SRTP) ────────────┘
```

### O handshake, passo a passo

```
Ana (já na toca)                servidor                 Bia (chegando)
       │                           │                           │
       │                           │◄──── join {nome, toca} ────┤
       │                           │                           │
       │                           ├──── welcome {peers} ──────►│
       │◄──── peer-joined {Bia} ───┤                           │
       │                           │                           │
  cria 4 transceivers              │                     aguarda offer
  (mic, tela-áudio,                │                           │
   tela-vídeo, câmera)             │                           │
       │                           │                           │
       ├── signal {offer} ────────►├──── signal {offer} ──────►│
       │                           │                    espelha transceivers
       │                           │                    e pendura as trilhas
       │◄── signal {answer} ───────┤◄─── signal {answer} ──────┤
       │                           │                           │
       ├── signal {candidate} ────►├──── signal {candidate} ──►│
       │◄── signal {candidate} ────┤◄─── signal {candidate} ───┤
       │                           │                           │
       │═══════════ mídia direto, sem passar pelo servidor ═════│
```

A ordem dos transceivers é o contrato: quem recebe descobre o papel de cada
trilha pelo índice, e é isso que permite trocar mídia depois sem renegociar.

## Rodando

```bash
npm install
npm start
# http://localhost:3000
```

Cada endereço `/r/<nome>` é uma toca diferente, criada na hora.

Configuração por variável de ambiente (veja `.env.example`):

| variável | padrão | para quê |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | onde escutar |
| `ROOM_NAME` | `Toca do Loro` | nome exibido da toca principal |
| `DEFAULT_ROOM` | `toca` | endereço da toca que sempre existe |
| `MAX_PEERS` | `12` | teto de gente por toca |
| `MAX_CONNECTIONS_PER_IP` | `8` | conexões simultâneas do mesmo IP |
| `MAX_JOINS_PER_IP` | `20` | entradas por minuto do mesmo IP |
| `MAX_SCREEN_BITRATE` | livre | teto de vídeo que toda toca respeita |
| `ALLOWED_ORIGINS` | mesma origem | quem pode abrir WebSocket |
| `TOCA_SECRET` | sorteado | assina convites e senhas |
| `STUN_URLS` | STUN público do Google | descoberta de IP externo |
| `TURN_URLS` / `TURN_SECRET` | vazio | relay pra redes fechadas |

## Testes

```bash
npm test              # unidade + protocolo + e2e no Chrome
npm run test:unit       # partes puras, sem rede
npm run test:signaling  # protocolo do servidor, sem navegador
npm run test:e2e        # Chrome real com mic, câmera e tela falsos
npm run test:browsers   # Firefox ↔ Chromium na mesma toca, e motor do Safari
npm run lint            # ESLint
npm run typecheck       # checkJs com JSDoc
```

Os testes sobem o próprio servidor em porta separada — não precisa ter nada
rodando. `APP_URL=https://... npm run test:e2e` roda contra um deploy já no ar, e
`FORCE_RELAY=1` obriga todas as conexões a passarem pelo TURN — é assim que se
reproduz, sem sair da mesa, o caso de dois participantes atrás de CGNAT.

**O que os testes não cobrem, e por quê:** perda de pacote real (não dá pra
moldar UDP a partir do processo de teste — o e2e estrangula o encoder a 16 kbps
como aproximação), compartilhamento de tela no Firefox e no Safari (o seletor de
janela exige clique humano) e captura de mídia no WebKit, que não tem
dispositivo falso — ali o teste prova que a interface carrega e conversa com o
servidor, nada além disso.

## Colocando no ar

1. **HTTPS é obrigatório.** `getUserMedia` e `getDisplayMedia` só existem em
   contexto seguro (exceto em `localhost`). Ponha atrás de um proxy com TLS e
   garanta o upgrade de WebSocket em `/ws`.
2. **TURN é obrigatório na prática.** Só com STUN, dois participantes atrás de
   NAT simétrico/CGNAT não conseguem se conectar *entre si* — o sintoma é uma
   call onde todo mundo ouve a mesma pessoa e mais ninguém. Suba um coturn:

   ```yaml
   services:
     coturn:
       image: coturn/coturn:4.7-alpine
       restart: unless-stopped
       network_mode: host
       command:
         - -n
         - --log-file=stdout
         - --listening-port=3478
         - --min-port=49160
         - --max-port=49200
         - --realm=tocadoloro
         - --use-auth-secret
         - --static-auth-secret=TROQUE_ESTE_SEGREDO
         - --no-tls
         - --no-dtls
         - --no-cli
         - --fingerprint
         - --no-multicast-peers
         - --denied-peer-ip=10.0.0.0-10.255.255.255
         - --denied-peer-ip=172.16.0.0-172.31.255.255
         - --denied-peer-ip=192.168.0.0-192.168.255.255
         - --user-quota=12
         - --total-quota=100
   ```

   Depois aponte `TURN_URLS` para ele e repita o mesmo segredo em `TURN_SECRET`.
   As faixas privadas ficam negadas de propósito: sem isso, o relay público vira
   porta de entrada pra rede interna do servidor. Lembre de liberar no firewall
   as portas `3478/udp`, `3478/tcp` e `49160-49200/udp`.
3. **Voltar uma versão** é `git revert <commit> && git push`: o deploy reconstrói
   sozinho e a toca volta ao que era em poucos minutos. Não há banco pra migrar.

## Limites conhecidos

- **Mesh não escala.** Com N pessoas, cada uma envia N-1 cópias da própria mídia.
  Voz aguenta tranquilo até ~10; compartilhar tela pra 8 pessoas exige bastante
  upload de quem compartilha. Acima disso, o caminho é um SFU.
- **Seu IP fica visível pros outros participantes**, como em qualquer P2P. O
  *modo privacidade* nos ajustes força tudo pelo seu TURN e resolve, ao custo de
  um pouco de latência.
- Sem histórico: chat, fila e moderação vivem só enquanto a toca existe.

## Estrutura

```
server/
  index.js    HTTP, WebSocket, limites por IP e ICE
  session.js  uma conexão: entrada, moderação, chat
  rooms.js    registro de tocas em memória
  room.js     uma toca: presença, papéis, fila, chat
  tokens.js   convites assinados e senhas
  limits.js   teto de conexões e entradas por IP
  static.js   arquivos estáticos, cabeçalhos de segurança e rota /r/
public/
  index.html  as duas telas e os diálogos
  styles.css  tema escuro e claro
  js/
    main.js          orquestra estado, entrada/saída, controles
    mesh.js          RTCPeerConnection por participante
    audio.js         grafo de Web Audio: volume, posição, portão, sons
    gate-worklet.js  portão de ruído e efeitos na thread de áudio
    stats.js         qualidade da conexão e nota da chamada
    media.js         captura de microfone, tela e câmera
    signaling.js     WebSocket com reconexão em backoff
    storage.js       preferências e identidade local
    qr.js            gerador de QR (sem dependência)
    ui/              telas, cards, palco, conversa e diálogos
test/
  unit.test.mjs       partes puras
  signaling.test.mjs  protocolo do servidor
  e2e.mjs             Chrome real, mídia falsa, ponta a ponta
  browsers.mjs        Firefox, Chromium e o motor do Safari
```
