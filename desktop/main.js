// Casca desktop do Technik.
//
// Isto NÃO embarca o backend: a janela carrega o app que já roda na VPS. O
// motivo está em PLANO-DESKTOP-CRM.md — resumindo, embarcar o Node obrigaria a
// distribuir as chaves de API dentro do instalador e a fazer electron-rebuild
// do `sharp`, e não economizaria hospedagem nenhuma, já que a VPS fica de pé
// pra outras coisas de qualquer jeito.
//
// Efeito colateral bom: como o frontend vem do servidor, push no `main`
// atualiza esta janela sozinho. Só mudança neste arquivo pede reinstalar.

const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Aponta direto na busca, não na raiz: a raiz agora é o login do CRM, e este
// executável não pode cair numa tela de senha na frente de um cliente.
const DEFAULT_URL = 'https://technik.paixaogabriel.com/busca';

// Ordem: --url=... > TECHNIK_URL > produção. O primeiro serve pra apontar num
// backend local sem mexer no código (`npm run dev`).
const APP_URL = (() => {
  const arg = process.argv.find(a => a.startsWith('--url='));
  const raw = arg ? arg.slice('--url='.length) : (process.env.TECHNIK_URL || DEFAULT_URL);
  return raw.replace(/\/+$/, '');
})();

const APP_ORIGIN = new URL(APP_URL).origin;

// Rotas que este executável não pode alcançar. O desktop é a tela que o
// cliente final vê por cima do ombro; o CRM (quando existir) guarda telefone e
// histórico de OUTROS compradores e não pode aparecer ali. Ver o plano.
const BLOCKED_PATHS = ['/crm'];

const isBlocked = url => {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return BLOCKED_PATHS.some(b => p === b || p.startsWith(b + '/'));
  } catch { return false; }
};

const isInternal = url => {
  try { return new URL(url).origin === APP_ORIGIN && !isBlocked(url); }
  catch { return false; }
};

// ─── Estado da janela ────────────────────────────────────────────────────────
// Guardado no userData (não junto do executável, que pode estar em Program
// Files sem permissão de escrita).

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch { /* primeira execução, ou arquivo corrompido — usa o padrão */ }
  return { width: 1440, height: 900 };
}

let saveTimer = null;
function saveState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      // getNormalBounds, não getBounds: como a janela abre sempre maximizada,
      // getBounds devolveria o tamanho do monitor e o "restaurar" nasceria já
      // em tela cheia. getNormalBounds dá o tamanho de janela restaurada.
      fs.writeFileSync(statePath(), JSON.stringify(win.getNormalBounds()));
    } catch (e) { console.warn('[state] não salvou:', e.message); }
  }, 400);
}

// ─── Token de dispositivo ────────────────────────────────────────────────────
// O app entra sozinho: em vez da senha do usuário, carrega um token emitido por
// `server/scripts/criar-dispositivo.mjs`. Ele alcança só a busca — nunca o CRM —
// e é revogável sem trocar a senha que você usa no navegador.
//
// Vem de env ou de credentials.json no userData, NUNCA daqui: trocar o token
// não pode exigir recompilar o instalador.

function loadDeviceToken() {
  if (process.env.TECHNIK_DEVICE) return process.env.TECHNIK_DEVICE;
  try {
    const file = path.join(app.getPath('userData'), 'credentials.json');
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.device) return c.device;
  } catch { /* sem token — o servidor vai mandar pro login e a gente avisa */ }
  return null;
}

// ─── Janela ──────────────────────────────────────────────────────────────────

let mainWindow = null;

function showError(win, code, desc) {
  const q = new URLSearchParams({ url: APP_URL, code: String(code), desc: desc || '' });
  win.loadFile(path.join(__dirname, 'error.html'), { search: '?' + q.toString() });
}

function createWindow() {
  const state = loadState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(Number.isFinite(state.x) ? { x: state.x, y: state.y } : {}),
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#19193a',      // mesma cor do favicon: evita flash branco
    show: false,
    // Abre em tela cheia de verdade: sem barra de título e sem barra de tarefas
    // do Windows. F11 sai, Alt+F4 fecha.
    fullscreen: true,
    // Esconde a barra de menu sem removê-la: os atalhos (Ctrl+R, F11, zoom)
    // continuam valendo, e Alt revela a barra se precisar. `setApplicationMenu(null)`
    // deixaria a janela limpa igual, mas mataria os atalhos junto.
    autoHideMenuBar: true,
    title: 'Technik',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,                 // nada aqui precisa de acesso a Node
      spellcheck: true,
    },
  });

  // Saindo da tela cheia (F11), a janela vira maximizada em vez de voltar pro
  // tamanho pequeno salvo — que seria um susto no meio de um atendimento.
  win.on('leave-full-screen', () => win.maximize());

  win.once('ready-to-show', () => win.show());

  win.on('resize', () => saveState(win));
  win.on('move', () => saveState(win));
  win.on('maximize', () => saveState(win));
  win.on('unmaximize', () => saveState(win));
  win.on('closed', () => { mainWindow = null; });

  // Link externo abre no navegador do sistema, nunca numa janela do Electron
  // sem barra de endereço (onde o usuário não veria pra onde foi).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (isInternal(url)) return;
    e.preventDefault();
    // Rota bloqueada não vaza pro navegador — simplesmente não acontece.
    if (!isBlocked(url)) shell.openExternal(url);
  });

  // Token ausente ou revogado: o servidor responde com redirect pro /login.
  // Este executável não tem senha pra digitar, então cair no formulário seria
  // um beco sem saída — melhor dizer o que aconteceu.
  win.webContents.on('did-navigate', (_e, url) => {
    try {
      if (new URL(url).pathname.startsWith('/login')) showError(win, 'auth', '');
    } catch { /* url esquisita, deixa passar */ }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    // -3 é ABORTED (navegação cancelada, normal). Sub-frame que falha não deve
    // derrubar a página inteira.
    if (!isMainFrame || code === -3) return;
    console.warn('[load] falhou:', code, desc, failedUrl);
    showError(win, code, desc);
  });

  win.loadURL(APP_URL);
  return win;
}

// ─── Menu ────────────────────────────────────────────────────────────────────
// O menu padrão do Electron traz itens irrelevantes ("Learn More" apontando
// pro electronjs.org). Este tem só o que serve aqui.

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Technik',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.loadURL(APP_URL) },
        { role: 'forceReload', label: 'Recarregar ignorando cache' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
      ],
    },
  ]));
}

// ─── Ciclo de vida ───────────────────────────────────────────────────────────

// Uma instância só: clicar no atalho de novo traz a janela existente pra frente
// em vez de abrir uma segunda cópia do mesmo app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // Injeta o token em TODA requisição pro nosso domínio. Fica no nível da
    // sessão de propósito: assim pega fetch, <img> e principalmente o
    // EventSource do stream de fotos — que, pela API do browser, não aceita
    // header customizado setado pelo JS da página.
    const token = loadDeviceToken();
    if (token) {
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: [APP_ORIGIN + '/*'] },
        (details, callback) => {
          callback({ requestHeaders: { ...details.requestHeaders, 'x-technik-device': token } });
        }
      );
    } else {
      console.warn('[auth] sem token de dispositivo — o servidor vai recusar');
    }

    buildMenu();
    mainWindow = createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
