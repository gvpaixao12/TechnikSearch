// Limite de tentativas pras rotas públicas (login e "esqueci a senha").
//
// Em memória, sem dependência e sem banco: o servidor roda num processo só
// (pm2, 1 vCPU), então um Map basta. Reiniciar zera os contadores, e isso é
// aceitável: o que se quer barrar é o chute de senha em massa, não guardar
// histórico.
//
// O scrypt já deixa cada tentativa lenta (~50 ms), mas lento não é limitado:
// sem isto, um script testaria senhas indefinidamente.

const janelas = new Map();   // chave → { n, expira }

// Conta um evento pra `chave`. Devolve quantos segundos faltam pro bloqueio
// acabar se o limite estourou, ou 0 se ainda está dentro.
function conta(chave, max, janelaMs) {
  const agora = Date.now();
  let j = janelas.get(chave);
  if (!j || j.expira <= agora) { j = { n: 0, expira: agora + janelaMs }; janelas.set(chave, j); }
  j.n++;
  return j.n > max ? Math.ceil((j.expira - agora) / 1000) : 0;
}

// Só consulta, sem contar.
function bloqueado(chave, max) {
  const j = janelas.get(chave);
  if (!j || j.expira <= Date.now()) return 0;
  return j.n >= max ? Math.ceil((j.expira - Date.now()) / 1000) : 0;
}

const zera = chave => janelas.delete(chave);

// Faxina: sem ela o Map cresce com IP que passou uma vez e nunca voltou.
setInterval(() => {
  const agora = Date.now();
  for (const [k, j] of janelas) if (j.expira <= agora) janelas.delete(k);
}, 10 * 60 * 1000).unref();

const minutos = s => Math.max(1, Math.ceil(s / 60));

// ─── Login ───────────────────────────────────────────────────────────────────
// Duas contas, as duas só de FALHAS:
//   - por IP: barra quem chuta muitas senhas a partir de um lugar;
//   - por login: barra o chute distribuído (vários IPs) contra uma conta só.
// O limite por login permite que um terceiro trave a conta de alguém por 15
// min errando de propósito. Com poucos usuários e admin à mão, é melhor isso
// que deixar a conta aberta a chute.

const LOGIN_MAX_IP = 10;
const LOGIN_MAX_CONTA = 10;
const LOGIN_JANELA = 15 * 60 * 1000;

const chaveIp = req => 'login-ip:' + (req.ip || 'desconhecido');
const chaveConta = login => 'login-conta:' + String(login || '').trim().toLowerCase();

// Antes de tentar: se já está bloqueado, nem roda o scrypt.
export function loginBloqueado(req, login) {
  return Math.max(bloqueado(chaveIp(req), LOGIN_MAX_IP), bloqueado(chaveConta(login), LOGIN_MAX_CONTA));
}

export function registraFalhaLogin(req, login) {
  conta(chaveIp(req), LOGIN_MAX_IP, LOGIN_JANELA);
  conta(chaveConta(login), LOGIN_MAX_CONTA, LOGIN_JANELA);
}

// Acertou: limpa o contador daquela conta (e do IP, que provou ser legítimo).
export function registraSucessoLogin(req, login) {
  zera(chaveIp(req));
  zera(chaveConta(login));
}

export const msgLoginBloqueado = s =>
  `Muitas tentativas erradas. Espere ${minutos(s)} min e tente de novo.`;

// ─── "Esqueci minha senha" ───────────────────────────────────────────────────
// Rota pública que grava no banco: sem limite, dá pra encher a tabela e a
// lista do admin de lixo.

export function pedidoSenhaBloqueado(req) {
  return conta('pedido-senha:' + (req.ip || 'desconhecido'), 5, 60 * 60 * 1000);
}
