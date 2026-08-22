# Technik Desktop

Casca Electron que abre o Technik numa janela própria. **Não embarca o
backend** — carrega `https://technik.paixaogabriel.com`, que continua rodando
na VPS. O porquê dessa escolha está em [../PLANO-DESKTOP-CRM.md](../PLANO-DESKTOP-CRM.md).

Consequência prática: **push no `main` atualiza o desktop sozinho**, porque o
frontend vem do servidor. Só mudança no `main.js` daqui exige gerar e instalar
um `.exe` novo.

## Rodar

```bash
npm install
npm start                  # aponta pra produção
npm run dev                # aponta pra http://localhost:3001
```

Pra apontar em qualquer outro lugar: `electron . --url=https://outra.coisa`
ou a variável `TECHNIK_URL`.

### Gotcha: testar a partir do VS Code

O VS Code é Electron e exporta `ELECTRON_RUN_AS_NODE=1`. Terminal aberto
dentro dele herda a variável, e aí o Electron roda como Node puro:
`require('electron')` devolve uma **string** em vez do módulo, e o app morre
com `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`.

Não é bug do código. Limpe antes de rodar:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

Num terminal fora do VS Code o problema não existe.

## Comportamento da janela

Abre em **tela cheia de verdade** (`fullscreen: true`): sem barra de título e
sem a barra de tarefas do Windows — o monitor inteiro é o app. **F11** sai da
tela cheia, **Alt+F4** fecha.

Saindo com F11, a janela vira **maximizada** em vez de voltar pro tamanho
pequeno salvo, que seria um susto no meio de um atendimento.

A barra de menu fica escondida (`autoHideMenuBar`). O menu não foi removido de
propósito: apagá-lo com `setApplicationMenu(null)` deixaria a janela igualmente
limpa, mas mataria os atalhos junto. Do jeito que está, continuam valendo
**Ctrl+R** (recarregar), **F11**, **Ctrl +/-** (zoom) e **Ctrl+Shift+I**
(DevTools) — e **Alt** revela a barra quando precisar.

O tamanho de janela restaurada é lembrado em `window-state.json` no userData,
gravado com `getNormalBounds()` — com `getBounds()` ele guardaria o tamanho do
monitor, já que a janela vive em tela cheia, e o "restaurar" não restauraria
nada.

## Gerar o instalador

```bash
npm run dist               # gera o ícone e empacota
```

Sai em `dist/Technik-Setup-<versão>.exe`. Instalador NSIS, permite escolher a
pasta e cria atalho na área de trabalho.

O **SmartScreen vai avisar "aplicativo desconhecido"** na primeira execução,
porque o executável não é assinado. Assinar exige certificado de code signing
(uns US$200–400/ano). Pra um cliente só, "Mais informações → Executar assim
mesmo" resolve.

## Ícone

`build/icon.ico` é gerado por [build-icon.js](build-icon.js) a partir de
`../assets/favicon.svg` (512×512, vetorial), em 16/32/48/64/128/256px. O
`technik-logo.png` não serve: é wordmark 1599×847, e ícone precisa ser
quadrado.

O `.ico` é montado à mão em vez de puxar dependência nova — o formato aceita
PNG embutido, então é cabeçalho + diretório + PNGs concatenados. Reusa o
`sharp` que já está em `server/node_modules`.

## Credenciais (quando o basic auth entrar)

Ainda **não há autenticação** no servidor — isso está pendente no plano. O
`main.js` já responde ao evento `login` do Electron, então quando o `auth_basic`
subir no nginx o usuário não verá prompt nenhum, desde que a credencial esteja
em um dos dois lugares:

1. variáveis `TECHNIK_USER` / `TECHNIK_PASS`;
2. `credentials.json` no userData — no Windows,
   `%APPDATA%\Technik\credentials.json`:

```json
{ "user": "...", "pass": "..." }
```

A credencial **não fica no código** de propósito: trocar a senha não deve
exigir recompilar o instalador.

Há um limite de 2 tentativas por sessão. Sem ele, credencial errada vira laço
infinito de 401 → login → 401. Estourou o limite, o Electron mostra o prompt
nativo — que é o comportamento certo, porque aí você vê que a senha está errada
em vez do app travar em silêncio.

## O que este executável não alcança

`BLOCKED_PATHS` em [main.js](main.js) recusa `/crm`. Não é organização, é
privacidade: o desktop é a tela que o **cliente final** vê por cima do ombro na
hora de olhar o carro, e o CRM guarda telefone e histórico de outros
compradores.

Por isso o CRM não precisa de um build separado — é o mesmo app, com a
navegação travada.
