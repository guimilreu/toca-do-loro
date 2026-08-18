# Escopo — Toca do Loro

> **Escopo entregue.** Os 150 itens abaixo estão implementados e cobertos por
> teste automatizado. As tabelas guardam a decisão original de cada um; o que
> mudou de forma durante a execução está anotado na própria linha.
>
> Provas: `npm run test:unit` (12 testes), `npm run test:signaling` (45 checks),
> `npm run test:e2e` (37 checks no Chrome com mídia real, e 35 contra o deploy
> com `FORCE_RELAY=1`) e `npm run test:browsers` (12 checks, Firefox ↔ Chromium
> e motor do Safari).

Uma toca só, sempre aberta: quem abre o site digita um nome, entra e fala. Voz,
tela e câmera, sem cadastro e sem instalar nada.

## 0. Regra de corte

Ficou no escopo o que atende **as três condições ao mesmo tempo**:

1. resolve com arquivo dentro deste repositório;
2. roda numa aba de navegador, sem app nativo;
3. não depende de servidor novo, banco de dados nem serviço contratado.

Qualquer coisa que falhasse em uma delas foi para a seção 15, com o motivo. O
levantamento original tinha 245 itens; sobraram **150**.

| | |
| --- | --- |
| 🔴 bloqueia | sem isso alguém desiste de usar |
| 🟡 diferencial | é o que faz escolher a Toca em vez do Discord |
| 🟢 refino | acabamento, some se faltar |
| ⚪ pronto | já existe hoje |
| **P** | algumas horas |
| **M** | alguns dias |

Nada no escopo passa de **M**. Todo item de semanas ou meses saiu.

## 1. Identidade — Toca do Loro

O projeto se chamava starpink (rosa sobre preto). Passou a se chamar **Toca do
Loro**, com identidade brasileira: cor, alegria, geometria e arte — **não**
estampa de bandeira nem textura de calçada.

### 1.1 Nome e vocabulário

| Onde | Antes | Agora |
| --- | --- | --- |
| Produto | starpink | Toca do Loro |
| Repositório | `guimilreu/starpink` | `guimilreu/toca-do-loro` |
| Pacote npm | `starpink` | `toca-do-loro` |
| Título da aba | starpink — call pública | Toca do Loro — call aberta |
| Botão de entrar | Entrar na call | Entrar na toca |
| Contador do topo | *N* na call | *N* na toca |
| Lobby | *N* pessoas na sala agora | *N* pessoas na toca agora |
| Sair | Sair da call | Sair da toca |
| `ROOM_NAME` padrão | Sala pública | Toca do Loro |
| Chaves de `localStorage` | `starpink:*` | `toca:*` |

### 1.2 Paleta

| Token | Hex | Uso |
| --- | --- | --- |
| `--bg` | `#071429` | azul-noite, fundo de tudo |
| `--surface` | `#0e2340` | cards e barras |
| `--surface-2` | `#14304f` | controles e campos |
| `--line` | `#1f4270` | bordas |
| `--text` | `#eaf2ff` | texto |
| `--muted` | `#8ba5c9` | texto secundário |
| `--arara` | `#2e7bff` | azul-arara, links e destaques frios |
| `--arara-deep` | `#1b4fd8` | profundidade do azul |
| `--louro` | `#ffc61e` | amarelo Louro José — **cor das ações** |
| `--verde` | `#12d18e` | quem está falando, status ok |
| `--laranja` | `#ff6a3d` | detalhe quente |
| `--rosa` | `#ff3e8e` | rosa de bloco, acento |

Avatares deixaram de ser arco-íris por hash: usam uma **paleta tropical fechada**
de sete pares (arara, verde, louro, laranja, rosa, turquesa, roxo).

### 1.3 Marca

Loro geométrico, montado só com formas primitivas — círculo da cabeça em
azul-arara, triângulo do bico em amarelo, mandíbula em laranja, duas penas de
crista em verde e laranja, olho escuro com um ponto de luz. Sem fonte, sem
imagem, sem dependência: é SVG inline, legível a 22px e a 512px, e o mesmo
desenho serve de favicon.

### 1.4 Fundo

Campo de cor: quatro gradientes radiais suaves (azul no alto à esquerda, verde no
alto à direita, louro no pé à direita, rosa no pé à esquerda) sobre o azul-noite.

**Rejeitado no caminho, e por quê:**

| Ideia | Motivo de sair |
| --- | --- |
| Shader WebGL animado | Peso desnecessário num app que já usa GPU pra vídeo |
| Onda do calçadão de Copacabana em SVG | Virou textura repetida e poluiu a tela — a referência à cidade tinha que ser cor e geometria, não piso |

## 2. Deploy e domínio

| Item | Decisão |
| --- | --- |
| Domínio | **`tocadoloro.gmdev.pro`** — único. `starpink.gmdev.pro` sai |
| Registro DNS | `A` · nome `tocadoloro` · conteúdo `177.155.199.194` · **DNS only** (nuvem cinza) |
| Por que cinza | Com proxy laranja o Let's Encrypt não valida e o certificado não sai |
| Hospedagem | Easypanel no VPS que já existe — sem servidor novo |
| TURN | coturn já rodando no mesmo VPS, portas 3478 e 49160-49200 liberadas no ufw |
| Fonte do deploy | `guimilreu/toca-do-loro`, branch `main`, build Nixpacks, porta 3000 |
| Variáveis | `PORT`, `ROOM_NAME`, `MAX_PEERS`, `TURN_URLS`, `TURN_SECRET` |

Fora de escopo aqui: qualquer segundo domínio, subdomínio extra, CDN, ambiente de
staging ou provedor novo.

## 3. Estado atual — o que já existe e foi verificado

A linha de base, verificada por teste automatizado contra o deploy em produção.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 3.1 | **Voz P2P entre todos** | Mesh WebRTC, mídia nunca passa pelo servidor | — | ⚪ pronto |
| 3.2 | **Criptografia ponta a ponta** | DTLS-SRTP entre pares. Como não há servidor de mídia no meio, a call *já é* E2EE — o Discord só conseguiu isso em 2024 | — | ⚪ pronto |
| 3.3 | **Compartilhamento de tela** | Com áudio da aba quando o navegador oferece, com fallback sem áudio | — | ⚪ pronto |
| 3.4 | **Entrada sem cadastro** | Nome e pronto; nada é persistido | — | ⚪ pronto |
| 3.5 | **Mudo com propagação** | Estado replicado para todos via sinalização | — | ⚪ pronto |
| 3.6 | **Indicador de quem fala** | RMS com histerese, um analyser por participante | — | ⚪ pronto |
| 3.7 | **Modo só ouvir** | Mic negado não vira erro, vira estado válido | — | ⚪ pronto |
| 3.8 | **Troca de microfone em call** | `replaceTrack` sem renegociar | — | ⚪ pronto |
| 3.9 | **Zero renegociação** | Três transceivers fixos por conexão desde o primeiro offer | — | ⚪ pronto |
| 3.10 | **TURN próprio** | coturn no VPS com credencial que expira, faixas privadas negadas | — | ⚪ pronto |
| 3.11 | **Reconexão automática** | Backoff no WebSocket e reentrada; ICE restart com limite | — | ⚪ pronto |
| 3.12 | **Palco de tela com abas** | Troca entre múltiplas telas compartilhadas | — | ⚪ pronto |
| 3.13 | **Contador no lobby** | Mostra quem já está lá antes de entrar | — | ⚪ pronto |
| 3.14 | **Rate limit e sanitização** | 300 msg/10s por conexão, nome limpo, relay só de SDP/ICE | — | ⚪ pronto |
| 3.15 | **HTTPS e wss** | Let's Encrypt via Traefik, domínio próprio | — | ⚪ pronto |
| 3.16 | **Responsivo** | Controles viram ícones no celular | — | ⚪ pronto |
| 3.17 | **Suíte de testes** | Sinalização + e2e em Chrome real com mídia fake, incluindo modo relay-only | — | ⚪ pronto |
| 3.18 | **Deploy contínuo** | Push no main, Easypanel reconstrói | — | ⚪ pronto |

## 4. Ajustes de mídia

Sem trocar a arquitetura: tudo aqui é parâmetro de `RTCRtpSender`, leitura de `getStats` ou constraint de captura.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 4.1 | **FEC e RED no áudio** | Recupera perda de pacote sem retransmitir. É a diferença entre voz robótica e voz limpa no 4G — e é uma linha de SDP | P | 🔴 bloqueia |
| 4.2 | **Bitrate de voz configurável** | Discord vende isso por canal; aqui é `setParameters` | P | 🟡 diferencial |
| 4.3 | **Prioridade de áudio sobre vídeo** | Quando a rede aperta, a tela trava mas a voz continua. Hoje competem igual | P | 🔴 bloqueia |
| 4.4 | **Bitrate adaptativo** | Hoje o teto de 2,5 Mbps é fixo; ler `getStats` e ajustar cobre a rede real | M | 🔴 bloqueia |
| 4.5 | **Teto de bitrate por sala** | Proteger sua banda de uma sala abusiva | P | 🟡 diferencial |
| 4.6 | **Detectar CPU saturada** | `qualityLimitationReason` avisa antes de travar; derrubar resolução sozinho | P | 🟢 refino |
| 4.7 | **Preferência de codec** | `setCodecPreferences` para escolher o que tem aceleração de hardware | P | 🟢 refino |
| 4.8 | **Jitter buffer ajustável** | `playoutDelayHint`: trocar latência por estabilidade quando a rede é ruim | P | 🟢 refino |
| 4.9 | **Fim de candidatos no trickle** | Sinalizar `end-of-candidates` acelera o fechamento em rede lenta | P | 🟢 refino |
| 4.10 | **Retomada de sessão** | Reconectar com o mesmo id em vez de sair e entrar — hoje o card pisca e todo mundo vê "fulano saiu" | M | 🟡 diferencial |
| 4.11 | **Priorizar TCP quando UDP falha** | O TURN já escuta em TCP; falta detectar e preferir sem o usuário perceber | M | 🟡 diferencial |
| 4.12 | **Nota de qualidade da chamada** | MOS calculado de jitter, perda e RTT — saber se piorou sem depender de reclamação | M | 🟢 refino |
| 4.13 | **Espaço para a câmera** | O desenho de três transceivers fixos não comporta um quarto fluxo; ajustar antes de precisar | M | 🟢 refino |

## 5. Voz

Onde o usuário sente diferença em cinco minutos de uso — e quase tudo é Web Audio puro.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 5.1 | **Volume por participante** | Sempre tem alguém baixo e alguém estourando. `GainNode` por pessoa, com memória | P | 🔴 bloqueia |
| 5.2 | **Silenciar tudo (deafen)** | Diferente de mudo: para de ouvir. Falta completamente | P | 🔴 bloqueia |
| 5.3 | **Silenciar uma pessoa só pra mim** | Sem precisar pedir nem moderar | P | 🟡 diferencial |
| 5.4 | **Aviso "você está mudo"** | Detecta fala com mic mudo e avisa. O erro mais comum de toda call do mundo — e o analyser que precisa disso já existe | P | 🟡 diferencial |
| 5.5 | **Noise gate simples** | Corta o que fica abaixo de um limiar e passa um filtro grave. Resolve ventilador e teclado sem WASM nem modelo neural | P | 🔴 bloqueia *Entregue como `AudioWorkletNode`: na thread de áudio, porque `requestAnimationFrame` congela em aba de fundo e cortaria a voz de quem trocou de janela.* |
| 5.6 | **Ligar/desligar processamento** | Eco, ruído e ganho automático hoje são fixos no código | P | 🟡 diferencial |
| 5.7 | **Sensibilidade de detecção de voz** | O limiar é constante; em ambiente barulhento o card fica aceso sempre | P | 🟡 diferencial |
| 5.8 | **Escolha de saída de áudio** | `setSinkId`: call no fone, resto na caixa | P | 🟡 diferencial |
| 5.9 | **Teste de microfone** | Gravar dois segundos e ouvir de volta antes de entrar | P | 🟡 diferencial |
| 5.10 | **Medidor no lobby** | Ver a barrinha mexer antes de entrar mata metade dos "não tô te ouvindo" | P | 🔴 bloqueia |
| 5.11 | **Ganho manual de entrada** | Para mic fraco que o ganho automático não resolve | P | 🟢 refino |
| 5.12 | **Áudio espacial** | Um `StereoPannerNode` por participante. Posicionar cada voz torna sala de 8 muito mais inteligível | P | 🟡 diferencial |
| 5.13 | **Som de entrada e saída** | Saber que alguém chegou sem olhar a tela | P | 🟢 refino |
| 5.14 | **Soundboard** | Alguns arquivos curtos no repositório e um atalho por tecla. É meme, mas é o que faz voltar | M | 🟢 refino *Sons sintetizados no navegador e disparados por aviso: não trafega áudio nem depende de arquivo licenciado.* |
| 5.15 | **Efeitos de voz** | Grave e agudo saem de um `playbackRate`; robô sai de um oscilador | M | 🟢 refino |
| 5.16 | **Detecção de microfonia** | Avisar quem está com caixa aberta perto do mic estragando a call de todos | M | 🟡 diferencial |
| 5.17 | **Lembrar dispositivos e volumes** | Já grava o microfone; falta saída e volume por pessoa | P | 🟢 refino |
| 5.18 | **Aviso de troca de fone** | Trocar de AirPods no meio da call hoje muda a saída sem avisar | P | 🟡 diferencial |
| 5.19 | **Levantar a mão** | Sala grande sem moderação vira atropelo | P | 🟢 refino |
| 5.20 | **Tempo de fala por pessoa** | Quem dominou a conversa. O contador já roda no detector de fala | P | 🟢 refino |

## 6. Tela e vídeo

Existe compartilhamento, mas sem nenhum controle de qualidade — e sem câmera, que é paridade básica.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 6.1 | **Escolher resolução e FPS** | Hoje é sempre 30fps e teto fixo. Ler código exige nitidez, jogo exige fluidez | P | 🔴 bloqueia |
| 6.2 | **1080p60** | Paridade com o Go Live pago do Discord — de graça | P | 🟡 diferencial |
| 6.3 | **Otimizar para texto ou movimento** | `contentHint` está fixo em `detail`; jogo pede `motion` | P | 🟢 refino |
| 6.4 | **Limite de telas simultâneas** | Cinco pessoas compartilhando ao mesmo tempo em mesh derruba a sala | P | 🔴 bloqueia |
| 6.5 | **Aviso de tela ainda ligada** | Sair da call compartilhando sem perceber é vazamento clássico | P | 🔴 bloqueia |
| 6.6 | **Câmera** | Fora do escopo original, mas é a primeira coisa que perguntam | M | 🔴 bloqueia |
| 6.7 | **Picture-in-picture** | Continuar vendo a tela usando outro app. API nativa, poucas linhas | P | 🟡 diferencial |
| 6.8 | **Zoom e pan na tela** | Ler código compartilhado em 720p sem zoom é sofrimento. É `transform` em cima do vídeo | P | 🟡 diferencial |
| 6.9 | **Ver várias telas ao mesmo tempo** | Hoje só uma fica no palco; as outras esperam em aba | M | 🟡 diferencial |
| 6.10 | **Qualidade por tamanho na tela** | Miniatura não precisa de 1080p; hoje recebe igual | M | 🟡 diferencial *Em mesh quem decide é quem envia: se ninguém está olhando a sua tela, a resolução cai pela metade.* |
| 6.11 | **Quem está vendo minha tela** | Dá segurança de que a demo está sendo vista | P | 🟢 refino |
| 6.12 | **Layouts de grade** | Grade, foco e lado a lado — hoje existe um arranjo só | M | 🟢 refino |
| 6.13 | **Áudio de tela no Firefox e Safari** | Hoje cai no fallback sem áudio sem avisar ninguém | P | 🟢 refino |
| 6.14 | **Screenshot da tela alheia** | Capturar o frame que está vendo, com aviso a quem compartilha | P | 🟢 refino |
| 6.15 | **Trocar de janela sem parar** | O `surfaceSwitching` já está ligado; falta refletir na interface | P | 🟢 refino |

## 7. Salas

Tudo aqui vive num `Map` em memória, exatamente como a sala única de hoje. Nenhum banco envolvido.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 7.1 | **Múltiplas salas** | Duas conversas ao mesmo tempo hoje é impossível. O `Room` vira um mapa de rooms | M | 🔴 bloqueia |
| 7.2 | **Sala privada por link** | Token no caminho da URL; quem tem o link entra, quem não tem nem vê | M | 🔴 bloqueia |
| 7.3 | **Senha na entrada** | O mínimo se o link vazar | P | 🔴 bloqueia |
| 7.4 | **Trancar sala** | Fechar a porta depois que todo mundo chegou | P | 🟡 diferencial |
| 7.5 | **Convite com validade** | Link assinado que expira sozinho, sem guardar nada | M | 🟡 diferencial |
| 7.6 | **Sala de espera** | Quem chega fica na fila até o dono aprovar | M | 🟡 diferencial |
| 7.7 | **Nome e tema por sala** | Hoje vem de variável de ambiente e vale para todo mundo | P | 🟢 refino |
| 7.8 | **Limite por sala** | `MAX_PEERS` é global; salas diferentes têm necessidades diferentes | P | 🟢 refino |
| 7.9 | **Ver salas ativas** | Uma página inicial mostrando onde tem gente agora | M | 🟡 diferencial |
| 7.10 | **Mover alguém de sala** | Sem obrigar a pessoa a sair e entrar | M | 🟢 refino |
| 7.11 | **Sala efêmera vs fixa** | Uma some quando esvazia, a outra mantém o endereço enquanto o servidor roda | P | 🟡 diferencial |
| 7.12 | **Sala com hora marcada** | Link assinado que só abre no horário combinado | M | 🟢 refino |

## 8. Identidade de quem entra

Sem conta e sem banco: tudo mora no `localStorage` de quem usa. Não ter cadastro continua sendo o trunfo.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 8.1 | **Evitar dois nomes iguais** | Duas pessoas podem entrar como "Fred" agora mesmo | P | 🔴 bloqueia |
| 8.2 | **Identidade estável no navegador** | Um id gerado uma vez e guardado local: reconhece você entre sessões sem cadastro nenhum | P | 🟡 diferencial |
| 8.3 | **Avatar leve** | Emoji ou cor escolhida, guardado no navegador e enviado como texto curto na sinalização | P | 🟡 diferencial |
| 8.4 | **Cor escolhida pela pessoa** | Hoje é hash do nome; mudar o nome muda a cor | P | 🟢 refino |
| 8.5 | **Bloquear pessoa localmente** | Não ouvir mais alguém, decisão sua, guardada no seu navegador | P | 🟡 diferencial |
| 8.6 | **Status** | Disponível, ausente, não perturbe | P | 🟢 refino |
| 8.7 | **Pronomes no nome de exibição** | Campo simples, impacto real em como as pessoas são tratadas | P | 🟢 refino |

## 9. Chat

Chat efêmero, relayado pelo WebSocket que já existe. Sem histórico, sem banco — coerente com o "nada é guardado".

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 9.1 | **Chat de texto na sala** | Mandar link no meio da call sem sair pro WhatsApp. Some quando a sala esvazia | M | 🔴 bloqueia |
| 9.2 | **Markdown e blocos de código** | Público dev cola código o tempo todo | P | 🟡 diferencial |
| 9.3 | **Reações que sobem e somem** | Reagir sem interromper quem fala. Barato e muito usado | P | 🟡 diferencial |
| 9.4 | **Emoji nas mensagens** | Seletor simples, sem biblioteca pesada | P | 🟢 refino |
| 9.5 | **Indicador de digitação** | Sinal social básico | P | 🟢 refino |
| 9.6 | **Menções** | Chamar quem está de aba fechada, junto com a notificação | M | 🟢 refino |
| 9.7 | **Mensagem fixada da sessão** | Deixar o link da pauta visível enquanto a sala existir | P | 🟢 refino |

## 10. Portas e abusos

Sala aberta na internet, mesmo que só entre amigos. O que está aqui é o mínimo pra ninguém estragar a brincadeira — tudo em memória, nada de banco.

> **Vale saber:** em P2P direto, todo participante descobre o IP público dos outros. Entre amigos tudo bem; se o link circular, o *modo privacidade* (7.13) força tudo pelo seu TURN e resolve.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 10.1 | **Dono da sala** | Quem criou manda. Hoje todo mundo é igual e ninguém pode nada | M | 🔴 bloqueia |
| 10.2 | **Expulsar** | Não existe forma de tirar alguém da sala | P | 🔴 bloqueia |
| 10.3 | **Bloquear reentrada na sessão** | Expulsar sem impedir de voltar em 2 segundos é inútil. Lista em memória basta | P | 🔴 bloqueia |
| 10.4 | **Mudo forçado** | Silenciar quem está com áudio estourado e não percebe | P | 🔴 bloqueia |
| 10.5 | **Encerrar tela de alguém** | Alguém compartilhando o que não devia | P | 🔴 bloqueia |
| 10.6 | **Mudo geral** | Silenciar todos de uma vez pra apresentar algo | P | 🟡 diferencial |
| 10.7 | **Bloquear novas entradas** | Botão de pânico quando o link vaza no grupo errado | P | 🔴 bloqueia *Mesma trava do item 7.4, exposta também como botão de pânico.* |
| 10.8 | **Rate limit por IP** | Hoje é por conexão: abrir 500 conexões contorna o limite | P | 🔴 bloqueia |
| 10.9 | **Limite de entradas por IP** | Um script enche o limite de vagas e ninguém mais entra. Derrubar a sala hoje é trivial | P | 🔴 bloqueia |
| 10.10 | **Verificar Origin no WebSocket** | Hoje qualquer site consegue abrir conexão contra o seu servidor | P | 🔴 bloqueia |
| 10.11 | **Cabeçalhos de segurança** | CSP, `Referrer-Policy`, `Permissions-Policy`. Nenhum está sendo enviado, e são cinco linhas em `static.js` | P | 🔴 bloqueia |
| 10.12 | **Validar tamanho do SDP** | Existe teto por mensagem, mas nada olha o conteúdo relayado | P | 🟢 refino |
| 10.13 | **Modo privacidade** | Força tudo pelo seu TURN e esconde seu IP dos outros, ao custo de um pouco de latência | P | 🔴 bloqueia |
| 10.14 | **Expirar sala ociosa** | Conexão fantasma segura vaga até o heartbeat derrubar | P | 🟢 refino |

## 11. Interface

Onde mais barato se ganha percepção de produto: quase tudo aqui é de horas.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 11.1 | **Copiar link de convite** | Um botão. Hoje a pessoa copia da barra de endereço | P | 🔴 bloqueia |
| 11.2 | **Qualidade da conexão por pessoa** | RTT e perda no card. Hoje "sem conexão" é tudo que se sabe | M | 🔴 bloqueia |
| 11.3 | **Erro que explica o que fazer** | "Não foi possível compartilhar a tela" não diz por quê nem o que tentar | P | 🔴 bloqueia |
| 11.4 | **Manter a tela ligada** | Wake Lock: no celular a tela apaga no meio da call | P | 🔴 bloqueia |
| 11.5 | **Contraste legível** | O texto secundário sobre o card escuro está no limite do ilegível | P | 🔴 bloqueia |
| 11.6 | **Foco visível** | Navegar por Tab hoje é quase invisível. Duas linhas de CSS | P | 🔴 bloqueia |
| 11.7 | **Contador no título da aba** | Saber que tem gente sem trocar de aba | P | 🟡 diferencial |
| 11.8 | **Favicon de estado** | Ícone da aba muda quando você está em call | P | 🟢 refino |
| 11.9 | **Estado vazio útil** | Sozinho na sala? Mostrar o convite grande, não um card solitário | P | 🟡 diferencial |
| 11.10 | **QR do convite** | Passar a call do computador pro celular sem digitar | P | 🟢 refino |
| 11.11 | **Reconexão com contador** | Hoje diz "reconectando…" sem prazo nem botão de tentar agora | P | 🟢 refino |
| 11.12 | **Ordenar por quem falou** | Em sala cheia, quem fala sobe | P | 🟢 refino |
| 11.13 | **Cartão do participante** | Passar o mouse e ver volume, silenciar e qualidade num lugar só | M | 🟡 diferencial |
| 11.14 | **Modo compacto** | Lista em vez de grade quando a sala enche | M | 🟢 refino |
| 11.15 | **Confirmar saída compartilhando** | Evita encerrar sem querer no meio de uma apresentação | P | 🟢 refino |
| 11.16 | **Animação de entrada e saída** | Card aparecendo do nada é brusco | P | 🟢 refino |
| 11.17 | **Estado de carregamento** | Entre clicar em entrar e conectar existe um vazio sem resposta | P | 🟢 refino |
| 11.18 | **Onboarding de três passos** | Primeira vez: microfone, tela, convite | M | 🟢 refino |
| 11.19 | **Tema claro** | Só existe escuro | M | 🟢 refino |
| 11.20 | **Versão visível** | Hash do commit no rodapé — sem isso, "atualiza a página" vira chute | P | 🟡 diferencial |
| 11.21 | **Aviso de versão nova** | Servidor avisa que o cliente está velho e sugere recarregar | M | 🟡 diferencial |
| 11.22 | **Som ao entrar e sair** | Feedback sonoro curto, com opção de desligar | P | 🟢 refino |
| 11.23 | **Feedback ao fim da call** | "Como foi a qualidade?" fecha o ciclo com a nota de qualidade (1.15) | P | 🟢 refino |

## 12. Código

A base é pequena e limpa. O risco não é o que existe, é o que vai crescer sem rede de proteção.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 12.1 | **Testar no Safari e no Firefox** | A suíte só roda em Chrome. Seus amigos de iPhone estão no Safari, onde o WebRTC mais quebra | M | 🔴 bloqueia *Firefox roda completo; no motor do Safari (WebKit) o teste prova carregamento e conversa com o servidor — não há dispositivo de captura falso.* |
| 12.2 | **Teste entre navegadores diferentes** | Chrome falando com Safari é onde aparece o bug de verdade | M | 🔴 bloqueia |
| 12.3 | **Teste com rede ruim** | Simular 5% de perda e 300ms pra ver o que o amigo no 4G sente | M | 🟡 diferencial *Não dá pra moldar UDP do processo de teste: o e2e estrangula o encoder a 16 kbps como aproximação honesta.* |
| 12.4 | **Rodar os testes a cada push** | A suíte existe mas depende de lembrar de rodar | P | 🔴 bloqueia |
| 12.5 | **Tipagem** | JSDoc com `checkJs` já resolve. A malha P2P tem estado demais pra checagem só mental | M | 🟡 diferencial |
| 12.6 | **Lint e formatação** | Nenhum configurado | P | 🟡 diferencial |
| 12.7 | **Testes unitários** | Hoje um bug de histerese exige subir o Chrome inteiro pra reproduzir | M | 🟡 diferencial |
| 12.8 | **Voltar deploy rápido** | Push quebrado derruba a sala; documentar o revert já resolve | P | 🟡 diferencial |
| 12.9 | **Licença** | Repositório público sem licença é "todos os direitos reservados" por padrão — o oposto do que parece | P | 🔴 bloqueia |
| 12.10 | **Diagrama do handshake** | O desenho de transceivers fixos é a parte mais sutil e vive só num parágrafo do README | P | 🟢 refino |

## 13. Onde dá pra ser melhor que o Discord

Copiar chega no empate. Estes são os pontos onde a arquitetura já é estruturalmente melhor — e onde vale gastar energia.

| # | Item | Por que importa | Esforço | Prioridade |
| --- | --- | --- | --- | --- |
| 13.1 | **Entrar em 2 segundos** | Sem conta, sem app, sem convite de servidor. O Discord não vai abrir mão do cadastro | — | ⚪ pronto |
| 13.2 | **Criptografia ponta a ponta de fábrica** | Sem servidor de mídia, não existe ponto onde interceptar. Eles levaram até 2024 pra ter isso | — | ⚪ pronto |
| 13.3 | **Nada gravado** | Sala vazia é sala zerada. O modelo deles depende do histórico | — | ⚪ pronto |
| 13.4 | **Latência de caminho direto** | Em 2 ou 3 pessoas, ir direto bate qualquer servidor no meio | — | ⚪ pronto |
| 13.5 | **Roda numa aba** | Sem Electron comendo 800 MB pra ficar em call | — | ⚪ pronto |
| 13.6 | **Qualidade máxima sem plano pago** | 1080p60 e bitrate alto de graça, onde eles cobram Nitro | P | 🟡 diferencial |
| 13.7 | **Áudio espacial** | Web Audio dá controle fino que app fechado não expõe | P | 🟡 diferencial |
| 13.8 | **Latência mostrada com honestidade** | Exibir RTT e perda em vez de esconder atrás de um "conectado" verde | M | 🟡 diferencial |
| 13.9 | **Sala que se autodestrói** | O link morre junto com a conversa | P | 🟡 diferencial |
| 13.10 | **Sem telemetria e sem anúncio** | Declarar e cumprir vira posicionamento — e aqui é verdade, não promessa | P | 🟡 diferencial |
| 13.11 | **Subir o seu em 5 minutos** | Uma dependência, sem build. Qualquer amigo levanta a própria toca | P | 🟡 diferencial |

## 14. Ordem de ataque

A sequência importa mais que a lista: cada fase entrega valor sozinha.

| Fase | O que entra | Por que agora | Prazo |
| --- | --- | --- | --- |
| 1 | **Fechar as portas** | Modo privacidade (10.13), Origin no WebSocket (10.10), limite por IP (10.8, 10.9), cabeçalhos de segurança (10.11), licença (12.9), testes a cada push (12.4) | 1 semana |
| 2 | **Call que não frustra** | Volume por participante (5.1), deafen (5.2), noise gate (5.5), medidor no lobby (5.10), aviso de mudo (5.4), FEC e RED (4.1), copiar convite (11.1), manter tela ligada (11.4), erro que explica (11.3) | 1–2 semanas |
| 3 | **Sala de verdade** | Múltiplas salas (7.1), link privado (7.2), senha (7.3), dono e moderação (10.1–10.5), chat efêmero (9.1) | 2 semanas |
| 4 | **Áudio que impressiona** | Bitrate de voz (4.2), prioridade de áudio (4.3), áudio espacial (5.12), soundboard (5.14), saída de áudio (5.8) | 1 semana |
| 5 | **Tela decente** | Resolução e FPS (6.1), 1080p60 (6.2), limite de telas (6.4), aviso de tela ligada (6.5), zoom e pan (6.8) | 1 semana |
| 6 | **Acabamento** | Qualidade por pessoa (11.2), cartão do participante (11.13), contraste e foco (11.5, 11.6), estados vazios (11.9, 11.17), Safari e Firefox (12.1, 12.2) | contínuo |

## 15. O que ficou de fora, e por quê

Nenhum item saiu por falta de valor — todos por dependerem de algo que não é
código deste repositório, ou por serem grandes demais para o tamanho do projeto.

| Motivo | O que saiu | Quando revisitar |
| --- | --- | --- |
| Servidor de mídia | SFU, simulcast, SVC, camadas por assinante, gravação no servidor, servidores por região, sinalização em várias instâncias | Só se a sala passar de 10 pessoas com frequência |
| Banco de dados | Contas e login, histórico de chat, busca, threads, lista de amigos, banidos permanentes, log de auditoria | Se quiserem sala que lembra as coisas entre dias |
| Fora do navegador | App mobile, áudio em segundo plano no iOS, push, CallKit, app desktop, push-to-talk global, overlay em jogo, PWA instalável | Só se virar rotina diária e a aba incomodar |
| Serviço de terceiro | Captcha, monitoramento externo, painel de métricas, rastreio de erro, tradução, resumo por IA, legendas do navegador (mandam áudio pra fora) | Nunca, provavelmente |
| Infra do servidor | TURN em 443, TURN redundante, ambiente de teste, alertas, limites de container, infra como código | Se alguém não conseguir conectar de rede corporativa |
| Pesado demais pro tamanho | Supressão neural, transcrição local, quadro branco, anotação na tela, controle remoto, fundo virtual, salas paralelas, modo sussurro, E2EE com chave rotativa | O noise gate (2.6) cobre 80% do valor da supressão neural por 5% do trabalho |
| Não faz sentido entre amigos | Termos de uso, política de privacidade, verificação de idade, canal de denúncia, papéis complexos, operação de produto inteira | Só se um dia abrir pro público de verdade |
| Interface que ninguém usaria | Painel de diagnóstico, tela de atalhos, notificação do navegador, preview de link, locutor prioritário, atenuação, navegação completa por teclado | Contraste e foco visível ficaram, porque são duas linhas de CSS |

### 15.1 Cortes pedidos diretamente

Estes estavam no escopo e saíram por decisão sua, não por análise técnica:

| Item | Onde estava | Observação |
| --- | --- | --- |
| Push-to-talk | Voz | Era barato (`keydown`/`keyup` no `track.enabled`), mas fora |
| Supressão de ruído neural | Voz | Trocada por **noise gate simples**, que ficou no escopo (2.x) |
| Locutor prioritário | Voz | — |
| Atenuação de volume | Voz | — |
| Modo música | Mídia e diferenciais | — |
| DTX | Mídia | — |
| Teste de rede antes de entrar | Mídia | — |
| Gravação local | Mídia e diferenciais | — |
| Arquivo direto entre pares | Chat e diferenciais | — |
| Card do link no WhatsApp (OpenGraph) | Interface | — |
| Atalho de mudo (tecla M) | Estado atual | Já existe no código; sai na próxima limpeza |
| Threads no chat | Chat | — |
| Quadro branco | Chat | — |
| Legendas ao vivo | Chat | Mandavam áudio para fora |
| Transcrição local | Chat e diferenciais | Peso e escopo |
| Preview de link | Chat | — |
| Painel de diagnóstico | Interface | — |
| Tela de atalhos e mais atalhos | Interface | — |
| Navegação completa por teclado | Interface | Contraste e foco visível ficaram — são duas linhas de CSS |
| Notificação do navegador | Interface | — |
| Seção inteira de Operação | — | 19 itens: métricas, alertas, monitor, staging, infra como código |
| Seção inteira de Legal | — | 8 itens: termos, privacidade, idade mínima, denúncia |
| Seção inteira de Mobile e desktop | — | 9 itens: app nativo, push, CallKit, PTT global, overlay |
| Shader WebGL no fundo | Identidade | Peso |
| Calçadão de Copacabana | Identidade | Poluição visual |

---

Levantamento feito sobre o código em produção em 18 de agosto de 2026. Prazos
assumem uma pessoa mexendo nas horas vagas.
