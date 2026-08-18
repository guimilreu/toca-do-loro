# starpink

Uma única call pública. Quem abre o site digita um nome, entra e já fala — voz e
compartilhamento de tela, sem cadastro, sem sala pra criar, sem câmera.

## Como funciona

- **Mídia é P2P (mesh)**: cada participante abre uma `RTCPeerConnection` com cada
  um dos outros. Áudio e vídeo nunca passam pelo servidor.
- **O servidor só sinaliza**: relaya SDP/ICE e mantém a lista de quem está na sala.
  Nada é gravado nem persistido — sala vazia é sala zerada.
- **Sem renegociação**: cada conexão nasce com três transceivers em ordem fixa
  (microfone, áudio da tela, vídeo da tela). Ligar/desligar mic ou tela é só um
  `replaceTrack` — não há novo offer/answer no meio da call.

```
navegador ──WebSocket (SDP/ICE)──> servidor Node ──> outros navegadores
    └───────────── áudio + tela direto, P2P (SRTP) ─────────────┘
```

## Rodando

```bash
npm install
npm start
# http://localhost:3000
```

Configuração por variável de ambiente (veja `.env.example`):

| variável | padrão | para quê |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | onde escutar |
| `ROOM_NAME` | `Sala pública` | nome exibido no topo |
| `MAX_PEERS` | `12` | teto de gente simultânea |
| `STUN_URLS` | STUN público do Google | descoberta de IP externo |
| `TURN_URLS` | vazio | relay pra redes fechadas (obrigatório na prática) |
| `TURN_SECRET` | vazio | segredo do coturn; gera credencial temporária por entrada |
| `TURN_USERNAME` / `TURN_PASSWORD` | vazio | alternativa com credencial fixa |

```bash
node --env-file=.env server/index.js
```

## Testes

```bash
npm test              # sinalização + e2e
npm run test:signaling  # só o servidor, sem navegador
npm run test:e2e        # Chrome de verdade com mic e tela fake
```

Os testes sobem o próprio servidor em porta separada — não precisa ter nada rodando.
O e2e abre o Google Chrome em headless com `--use-fake-device-for-media-stream`
e dirige tudo por CDP: entrar, falar, mutar, compartilhar tela, sair e voltar
depois de o servidor cair. Ele confere pacotes RTP realmente recebidos, não só o
que a interface diz. `CHROME_PATH=... npm run test:e2e` aponta outro binário;
`HEADFUL=1` abre a janela pra assistir.

## Colocando no ar

1. **HTTPS é obrigatório.** `getUserMedia` e `getDisplayMedia` só existem em
   contexto seguro (exceto em `localhost`). Ponha atrás de um proxy com TLS e
   garanta o upgrade de WebSocket em `/ws`.
2. **TURN é obrigatório na prática.** Só com STUN, dois participantes atrás de
   NAT simétrico/CGNAT não conseguem se conectar *entre si* — o sintoma é uma call
   onde todo mundo ouve a mesma pessoa e mais ninguém. Suba um coturn:

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
         - --realm=starpink
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
   porta de entrada pra rede interna do servidor.
3. Sem estado no servidor: pode reiniciar à vontade (todo mundo cai e reconecta).

## Limites conhecidos

- **Mesh não escala.** Com N pessoas, cada uma envia N-1 cópias da própria mídia.
  Voz aguenta tranquilo até ~10; compartilhar tela pra 8 pessoas exige ~20 Mbps de
  upload de quem compartilha. Acima disso, o caminho é um SFU (mediasoup, LiveKit,
  Janus) — o cliente muda pouco, porque o mapeamento de papéis por transceiver
  continua valendo.
- Sem moderação: qualquer um entra com qualquer nome. É pra grupo de confiança.
- Sem chat, sem câmera, sem gravação — por decisão de escopo.

## Estrutura

```
server/
  index.js    HTTP + WebSocket + shutdown
  room.js     presença, relay de sinalização, rate limit
  static.js   arquivos estáticos com ETag e proteção de path
public/
  index.html  duas telas: entrada e call
  styles.css  tema escuro
  js/
    main.js        orquestra estado, entrada/saída, controles
    mesh.js        RTCPeerConnection por participante (perfect negotiation)
    signaling.js   WebSocket com reconexão em backoff
    media.js       captura de microfone e tela
    audio-level.js detecção de quem está falando (RMS)
    ui.js          DOM
test/
  signaling.test.mjs  protocolo do servidor
  e2e.mjs             Chrome real, mídia fake, ponta a ponta
```

## Atalhos

- `M` — liga/desliga o microfone
- duplo clique na tela compartilhada — tela cheia
