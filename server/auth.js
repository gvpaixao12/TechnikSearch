// Autenticação — login por senha no navegador, token de dispositivo no desktop.
//
// Duas portas de entrada, de propósito:
//
//   navegador → POST /api/login → cookie de sessão → acesso a tudo
//   desktop   → header x-technik-device → acesso só ao escopo do token
//
// O desktop entra sozinho porque a pessoa vai estar mostrando carro pra um
// cliente e não pode topar com uma tela de senha no meio disso. Mas ele NÃO
// carrega a senha do usuário: carrega um token de dispositivo, que alcança
// menos coisa e é revogável sem mexer na senha. Ver auth-schema.sql.
//
// Nada de segredo em claro no banco: senha vira scrypt, tokens viram sha256.

import crypto from 'node:crypto';
import { q, one, exec } from './db.js';

// ─── Hash de senha (scrypt) ──────────────────────────────────────────────────
// scrypt vem do `node:crypto` — sem dependência nova. Os parâmetros abaixo são
// o padrão recomendado; ficam gravados no próprio hash pra que aumentar o
// custo no futuro não invalide as senhas já existentes.

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const scryptAsync = (senha, salt, opts) => new Promise((resolve, reject) => {
  // maxmem precisa acompanhar o N, senão o Node recusa com "memory limit exceeded".
  crypto.scrypt(senha, salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: 256 * 1024 * 1024 },
    (err, dk) => (err ? reject(err) : resolve(dk)));
});

export async function hashSenha(senha) {
  if (!senha || senha.length < 8) throw new Error('senha precisa de pelo menos 8 caracteres');
  const salt = crypto.randomBytes(16);
  const dk = await scryptAsync(senha, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export async function verificaSenha(senha, armazenado) {
  try {
    const [alg, N, r, p, saltHex, hashHex] = String(armazenado).split('$');
    if (alg !== 'scrypt') return false;
    const dk = await scryptAsync(senha, Buffer.from(saltHex, 'hex'), {
      N: Number(N), r: Number(r), p: Number(p), keylen: hashHex.length / 2,
    });
    // timingSafeEqual, não ===: comparar string vaza, pelo tempo, quantos
    // caracteres iniciais bateram.
    return crypto.timingSafeEqual(dk, Buffer.from(hashHex, 'hex'));
  } catch { return false; }
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

const novoToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

const DIAS_SESSAO = 30;
export const COOKIE = 'technik_sess';

// ─── Sessões ─────────────────────────────────────────────────────────────────

export async function criaSessao({ usuarioId, userAgent }) {
  const token = novoToken();
  await exec(
    // make_interval em vez de ($3 || ' days')::interval: naquela forma os dois
    // lados do || são de tipo indeterminado e o Postgres recusa o parâmetro.
    `insert into sessoes (token_hash, usuario_id, expira_em, user_agent)
     values ($1, $2, now() + make_interval(days => $3::int), $4)`,
    [hashToken(token), usuarioId, DIAS_SESSAO, (userAgent || '').slice(0, 300)]
  );
  return token;
}

export async function destroiSessao(token) {
  if (!token) return;
  await exec('delete from sessoes where token_hash = $1', [hashToken(token)]);
}

async function resolveSessao(token) {
  if (!token) return null;
  const row = await one(
    `select s.usuario_id, u.login, u.nome, u.senha_temporaria, u.admin
       from sessoes s join usuarios u on u.id = s.usuario_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [hashToken(token)]
  );
  if (!row) return null;
  // Marca uso sem esperar: atrasar toda requisição por causa de telemetria de
  // sessão não se justifica.
  exec('update sessoes set ultimo_uso = now() where token_hash = $1', [hashToken(token)])
    .catch(() => { /* irrelevante se falhar */ });
  return {
    tipo: 'usuario', usuarioId: row.usuario_id, login: row.login, nome: row.nome,
    escopo: 'tudo',
    admin: row.admin === true,
    // Enquanto true, `exigeAuth` só deixa passar a tela de troca de senha.
    precisaTrocarSenha: row.senha_temporaria === true,
  };
}

// ─── Dispositivos ────────────────────────────────────────────────────────────

export async function criaDispositivo({ nome, escopo = 'busca' }) {
  const token = novoToken();
  await exec(
    'insert into dispositivos (nome, token_hash, escopo) values ($1, $2, $3)',
    [nome, hashToken(token), escopo]
  );
  return token;   // única vez que o valor real existe fora da máquina dele
}

async function resolveDispositivo(token) {
  if (!token) return null;
  const row = await one(
    `select id, nome, escopo from dispositivos
      where token_hash = $1 and revogado_em is null`,
    [hashToken(token)]
  );
  if (!row) return null;
  exec('update dispositivos set ultimo_uso = now() where id = $1', [row.id])
    .catch(() => { /* idem */ });
  return { tipo: 'dispositivo', dispositivoId: row.id, nome: row.nome, escopo: row.escopo };
}

// ─── Cookies ─────────────────────────────────────────────────────────────────
// Parse manual em vez de `cookie-parser`: é um cookie só, e a dependência não
// se paga.

export function leCookie(req, nome) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

export function setCookieSessao(req, res, token) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',                       // JS da página não lê — some o roubo por XSS
    'SameSite=Lax',
    `Max-Age=${DIAS_SESSAO * 24 * 60 * 60}`,
  ];
  // Secure só sob https: em http://localhost o navegador descartaria o cookie
  // e o login pareceria "não funcionar" em dev.
  if (seguro) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function limpaCookieSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ─── Identificação ───────────────────────────────────────────────────────────

// Descobre quem está chamando. Cookie primeiro (é o caso do navegador), header
// de dispositivo depois. Devolve null se nenhum dos dois valer.
export async function identifica(req) {
  const porCookie = await resolveSessao(leCookie(req, COOKIE));
  if (porCookie) return porCookie;
  return resolveDispositivo(req.headers['x-technik-device']);
}

const alcanca = (escopo, exigido) => escopo === 'tudo' || escopo === exigido;

// Middleware. `escopo` é o que a rota exige: 'busca' ou 'crm'.
//
// Responde 401 em JSON pra /api/* e redireciona pro login nas páginas — quem
// chama fetch quer um status pra tratar, quem digitou a URL quer ver a tela.
// Rotas que uma sessão com senha temporária ainda alcança. Precisa incluir o
// logout: senão quem entrou com a temporária e desistiu ficaria preso.
const LIBERADO_COM_SENHA_TEMPORARIA = new Set([
  '/trocar-senha', '/api/trocar-senha', '/api/logout', '/api/me',
]);

export function exigeAuth(escopo = 'busca') {
  return async (req, res, next) => {
    try {
      const quem = await identifica(req);

      // Senha temporária: a pessoa está autenticada, mas o único lugar aonde
      // pode ir é trocar a senha. Sem esta trava bastaria navegar pra outro
      // lugar e a temporária viraria permanente.
      if (quem?.precisaTrocarSenha && !LIBERADO_COM_SENHA_TEMPORARIA.has(req.path)) {
        if (req.path.startsWith('/api/')) {
          return res.status(403).json({ ok: false, reason: 'troque a senha antes de continuar', trocarSenha: true });
        }
        return res.redirect('/trocar-senha');
      }

      if (quem && alcanca(quem.escopo, escopo)) { req.auth = quem; return next(); }

      if (req.path.startsWith('/api/')) {
        return res.status(401).json({
          ok: false,
          reason: quem ? 'este acesso não alcança esta área' : 'não autenticado',
        });
      }
      // Dispositivo tentando abrir o CRM não vai pro login: ele não TEM senha
      // pra digitar. Mandar pra tela de login seria um beco sem saída.
      if (quem) return res.status(403).send('Este dispositivo não tem acesso a esta área.');
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    } catch (e) {
      next(e);
    }
  };
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function autentica({ login, senha }) {
  const u = await one(
    'select id, login, nome, senha_hash, senha_temporaria from usuarios where lower(login) = lower($1)',
    [login || '']
  );
  // Mesmo sem usuário, roda um scrypt descartável: sem isso, "usuário não
  // existe" responde na hora e "senha errada" demora, e dá pra descobrir quais
  // logins existem só cronometrando.
  if (!u) {
    await hashSenha('descarte-para-igualar-o-tempo').catch(() => {});
    return null;
  }
  if (!await verificaSenha(senha || '', u.senha_hash)) return null;
  exec('update usuarios set ultimo_acesso = now() where id = $1', [u.id]).catch(() => {});
  return { id: u.id, login: u.login, nome: u.nome, senhaTemporaria: u.senha_temporaria === true };
}

// Varre sessões vencidas. Chamado de vez em quando pelo index.js — sem isso a
// tabela cresce pra sempre com lixo que já não autentica nada.
export async function limpaSessoesVencidas() {
  const n = await exec('delete from sessoes where expira_em < now()');
  if (n) console.log(`[auth] ${n} sessão(ões) vencida(s) removida(s)`);
  return n;
}

// ─── Usuários (tela de administração no CRM) ─────────────────────────────────

export async function listaUsuarios() {
  return q(`select id, login, nome, criado_em, ultimo_acesso, senha_temporaria, admin
              from usuarios order by criado_em`);
}

// Middleware: gerenciar usuários é coisa de admin. Vem depois de exigeAuth,
// então req.auth já existe.
export function exigeAdmin(req, res, next) {
  if (req.auth?.tipo === 'usuario' && req.auth.admin) return next();
  const msg = 'só administradores gerenciam usuários';
  if (req.path.startsWith('/api/')) return res.status(403).json({ ok: false, reason: msg });
  return res.status(403).send(msg);
}

// Promove ou rebaixa. A trava importante é não deixar a base sem admin nenhum:
// sem isso, ninguém conseguiria promover ninguém depois, e a recuperação viraria
// SSH obrigatório.
export async function defineAdmin({ id, admin, quemPede }) {
  if (!admin) {
    const { restantes } = await one(
      'select count(*)::int as restantes from usuarios where admin and id <> $1', [id]
    ) || {};
    if (!restantes) throw new Error('não dá pra remover o último administrador — ninguém poderia promover outro depois');
    if (id === quemPede) throw new Error('você não pode remover o próprio acesso de administrador');
  }
  const n = await exec('update usuarios set admin = $1 where id = $2', [admin === true, id]);
  if (!n) throw new Error('usuário não encontrado');
  return true;
}

export async function criaUsuario({ login, nome, senha, admin = false }) {
  const limpo = String(login || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(limpo)) {
    throw new Error('login deve ter 3 a 40 caracteres: letras, números, ponto, hífen ou underline');
  }
  const jaExiste = await one('select 1 from usuarios where lower(login) = lower($1)', [limpo]);
  if (jaExiste) throw new Error('já existe um usuário com esse login');

  const hash = await hashSenha(senha);   // valida o tamanho mínimo
  const row = await one(
    'insert into usuarios (login, nome, senha_hash, admin) values ($1, $2, $3, $4) returning id',
    [limpo, (nome || '').trim() || null, hash, admin === true]
  );
  return row?.id || null;
}

export async function removeUsuario(id, quemPede) {
  if (id === quemPede) throw new Error('você não pode remover o próprio usuário');

  const { total } = await one('select count(*)::int as total from usuarios') || {};
  if (total <= 1) throw new Error('não dá pra remover o último usuário — ninguém entraria depois');

  // Idem pra admin: remover o último deixaria a base sem quem administre.
  const { admins } = await one(
    'select count(*)::int as admins from usuarios where admin and id <> $1', [id]
  ) || {};
  if (!admins) throw new Error('não dá pra remover o último administrador');

  await exec('delete from usuarios where id = $1', [id]);   // sessões caem no cascade
  return true;
}

// Alfabeto sem 0/O/1/l/I: a senha vai ser lida em voz alta ou digitada à mão,
// e confundir caractere aqui vira "não funciona" sem motivo aparente.
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function senhaLegivel(tamanho = 12) {
  const bytes = crypto.randomBytes(tamanho);
  return [...bytes].map(b => ALFABETO[b % ALFABETO.length]).join('');
}

// Admin reseta a senha de alguém. Devolve a temporária UMA vez, pra ser
// entregue por fora (não há e-mail no projeto). No próximo login, a pessoa é
// obrigada a escolher uma senha própria.
export async function resetaSenha(usuarioId) {
  const temporaria = senhaLegivel();
  const hash = await hashSenha(temporaria);
  const row = await one(
    `update usuarios set senha_hash = $1, senha_temporaria = true
      where id = $2 returning login`,
    [hash, usuarioId]
  );
  if (!row) throw new Error('usuário não encontrado');
  // Derruba o que estiver aberto: se a senha foi resetada por suspeita, deixar
  // sessão viva anularia o reset.
  await exec('delete from sessoes where usuario_id = $1', [usuarioId]);
  return { login: row.login, senhaTemporaria: temporaria };
}

// A própria pessoa trocando a senha. Dois caminhos chegam aqui:
//
//   1. veio da senha temporária → não pede a atual, porque ela acabou de provar
//      que a conhece ao fazer login com ela;
//   2. trocou por vontade própria, já logada → PEDE a senha atual. Sem isso,
//      uma sessão esquecida aberta viraria troca de senha por quem passasse na
//      frente do computador.
export async function trocaSenhaPropria({ usuarioId, tokenAtual, senhaAtual, novaSenha }) {
  const u = await one('select senha_hash, senha_temporaria from usuarios where id = $1', [usuarioId]);
  if (!u) throw new Error('usuário não encontrado');

  if (u.senha_temporaria !== true) {
    if (!senhaAtual) throw new Error('informe a senha atual');
    if (!await verificaSenha(senhaAtual, u.senha_hash)) throw new Error('senha atual incorreta');
  }

  const hash = await hashSenha(novaSenha);
  await exec('update usuarios set senha_hash = $1, senha_temporaria = false where id = $2',
    [hash, usuarioId]);
  // Mantém só a sessão de quem está trocando; qualquer outra que existisse com
  // a senha antiga morre aqui.
  await exec('delete from sessoes where usuario_id = $1 and token_hash <> $2',
    [usuarioId, hashToken(tokenAtual || '')]);
  return true;
}

// ─── Pedidos de "esqueci minha senha" ────────────────────────────────────────

export async function registraPedidoSenha(login) {
  const texto = String(login || '').trim().slice(0, 120);
  if (!texto) return false;
  // Grava mesmo que o login não exista — ver o comentário no schema.
  await exec('insert into pedidos_senha (login_informado) values ($1)', [texto]);
  return true;
}

export async function listaPedidosSenha() {
  return q(`select id, login_informado, criado_em
              from pedidos_senha where atendido_em is null
             order by criado_em desc limit 50`);
}

export async function marcaPedidoAtendido(id, adminId) {
  return exec('update pedidos_senha set atendido_em = now(), atendido_por = $1 where id = $2',
    [adminId, id]);
}

export async function listaDispositivos() {
  return q(`select id, nome, escopo, criado_em, ultimo_uso, revogado_em
              from dispositivos order by criado_em desc`);
}

export async function revogaDispositivo(id) {
  return exec('update dispositivos set revogado_em = now() where id = $1 and revogado_em is null', [id]);
}
