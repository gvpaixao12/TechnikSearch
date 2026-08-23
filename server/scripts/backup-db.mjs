// Backup do Postgres pro R2.
//
//   node scripts/backup-db.mjs              # faz um backup
//   node scripts/backup-db.mjs --listar     # o que existe lá
//   node scripts/backup-db.mjs --verificar  # baixa o mais novo e prova que abre
//   node scripts/backup-db.mjs --baixar <chave>   # traz um pro disco local
//
// ─── Por que não dá pra jogar no bucket das fotos ───────────────────────────
// `car-images` é servido por um domínio público (`R2_PUBLIC_BASE`, pub-*.r2.dev).
// Um dump ali dentro seria telefone e e-mail de cliente atrás de uma URL que
// qualquer um alcança sabendo o nome do arquivo. Por isso bucket separado
// (`R2_BACKUP_BUCKET`), que tem que estar com acesso público DESLIGADO.
//
// As credenciais caem pras principais se não houver `R2_BACKUP_*`, pra funcionar
// no primeiro dia — mas o certo é um token do R2 escopado só neste bucket, senão
// um vazamento do .env da aplicação entrega os backups junto.
//
// ─── O que este script recusa a fazer ───────────────────────────────────────
// Backup que não restaura é pior do que não ter backup, porque para de doer.
// Então, ANTES de subir qualquer coisa, ele:
//
//   1. roda `pg_restore --list` no arquivo — se não abre, não sobe;
//   2. exige que as tabelas que importam estejam lá dentro — pega o caso de ter
//      apontado pro banco errado (ou pro `technik_test` vazio), que é o modo de
//      falha que passa despercebido por meses;
//   3. recusa dump ridiculamente pequeno.
//
// E só apaga backup velho DEPOIS que o novo subiu e foi conferido por HEAD.

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import {
  PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectsCommand, S3Client,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.R2_BACKUP_BUCKET || 'technik-backups';
const PREFIXO = 'postgres/';
// Função, e não const: lida na hora de podar. Como const, o valor congelava no
// import do módulo, o que amarrava o comportamento à ordem dos imports e deixava
// a poda impossível de testar.
const manter = () => Number(process.env.BACKUP_MANTER || 30);
const MINIMO_BYTES = 4096;

// Sem estas o backup existe mas não serve: um dump que não tem `clientes` é um
// dump do banco errado.
const TABELAS_ESPERADAS = ['clientes', 'consultas', 'usuarios', 'rascunhos'];

// ─── R2 ─────────────────────────────────────────────────────────────────────
let _r2 = null;
function r2() {
  if (_r2) return _r2;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_BACKUP_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCOUNT_ID e credenciais ausentes no .env');
  }
  // R2_ENDPOINT existe pro teste apontar num S3 local (MinIO). Em produção fica
  // ausente e vale o endpoint do R2. `forcePathStyle` só entra junto, porque é o
  // que o MinIO quer e o R2 não precisa.
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  _r2 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    ...(process.env.R2_ENDPOINT ? { forcePathStyle: true } : {}),
    // Mesmo motivo do storage.js: o R2 rejeita alguns headers de checksum que o
    // SDK v3 manda por default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _r2;
}

// ─── Cifra (opcional) ───────────────────────────────────────────────────────
// Ligada só se houver BACKUP_PASSPHRASE. É opcional de propósito: perder a
// passphrase é perder o backup, e pra uma operação de uma pessoa esse risco
// compete de verdade com o risco que a cifra evita. Bucket privado já é o grosso
// da proteção; a cifra é pra quem quer o resto.
//
// Formato: "TKBK1" | salt(16) | iv(12) | ciphertext | tag(16), AES-256-GCM com
// chave derivada por scrypt.
const MAGIC = Buffer.from('TKBK1');
const temSenha = () => !!process.env.BACKUP_PASSPHRASE;

const derivaChave = (salt) => new Promise((ok, erro) => {
  crypto.scrypt(process.env.BACKUP_PASSPHRASE, salt, 32, (e, k) => (e ? erro(e) : ok(k)));
});

async function cifra(de, para) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = await derivaChave(salt);
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);

  const saida = fs.createWriteStream(para);
  saida.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(de), c, saida, { end: false });
  // O tag de autenticação só existe depois que a cifra terminou, então vai no fim.
  await new Promise((ok, erro) => saida.end(c.getAuthTag(), e => (e ? erro(e) : ok())));
}

async function decifra(de, para) {
  const bruto = await fs.promises.readFile(de);
  if (!bruto.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('não parece um backup cifrado deste script');
  }
  const salt = bruto.subarray(5, 21);
  const iv = bruto.subarray(21, 33);
  const tag = bruto.subarray(bruto.length - 16);
  const corpo = bruto.subarray(33, bruto.length - 16);

  const chave = await derivaChave(salt);
  const d = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  d.setAuthTag(tag);
  // O .final() é o que valida o tag — sem ele, conteúdo adulterado passaria.
  await fs.promises.writeFile(para, Buffer.concat([d.update(corpo), d.final()]));
}

// ─── pg_dump / pg_restore ───────────────────────────────────────────────────
function roda(cmd, args, opts = {}) {
  return new Promise((ok, erro) => {
    const p = spawn(cmd, args, { ...opts });
    let saida = '';
    let err = '';
    p.stdout?.on('data', d => { saida += d; });
    p.stderr?.on('data', d => { err += d; });
    p.on('error', e => erro(new Error(
      e.code === 'ENOENT' ? `${cmd} não encontrado — instale o cliente do Postgres` : e.message)));
    p.on('close', c => (c === 0 ? ok(saida) : erro(new Error(`${cmd} saiu com ${c}: ${err.trim()}`))));
  });
}

async function geraDump(destino) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente no .env');
  // -Fc: formato custom, já comprimido e restaurável seletivamente com
  // pg_restore. --no-owner/--no-privileges pra restaurar num banco cujo dono
  // tenha outro nome sem o restore cuspir erro em cada linha.
  await roda('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-f', destino, url]);
}

// Prova que o arquivo abre E que tem o que precisa ter.
async function conferaDump(arquivo) {
  const { size } = await fs.promises.stat(arquivo);
  if (size < MINIMO_BYTES) {
    throw new Error(`dump de ${size} bytes é pequeno demais pra ser verdade`);
  }
  const lista = await roda('pg_restore', ['--list', arquivo]);
  const faltando = TABELAS_ESPERADAS.filter(t => !new RegExp(`TABLE\\s+\\S+\\s+${t}\\b`, 'i').test(lista));
  if (faltando.length) {
    throw new Error(`o dump abriu mas não tem: ${faltando.join(', ')} — apontou pro banco errado?`);
  }
  return { size, tabelas: (lista.match(/^\d+;.*TABLE /gm) || []).length };
}

// ─── Ações ──────────────────────────────────────────────────────────────────
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

async function listar() {
  const r = await r2().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIXO }));
  return (r.Contents || []).sort((a, b) => b.LastModified - a.LastModified);
}

async function fazBackup() {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'technik-bkp-'));
  const dump = path.join(tmp, 'technik.dump');
  try {
    console.log('pg_dump…');
    await geraDump(dump);

    const info = await conferaDump(dump);
    console.log(`dump ok: ${mb(info.size)}, ${info.tabelas} tabelas`);

    let envio = dump;
    let chave = `${PREFIXO}technik-${carimbo()}.dump`;
    if (temSenha()) {
      envio = dump + '.enc';
      chave += '.enc';
      await cifra(dump, envio);
      console.log('cifrado (BACKUP_PASSPHRASE presente)');
    } else {
      console.log('SEM cifra — defina BACKUP_PASSPHRASE se quiser cifrar');
    }

    const corpo = await fs.promises.readFile(envio);
    const sha = crypto.createHash('sha256').update(corpo).digest('hex');
    await r2().send(new PutObjectCommand({
      Bucket: BUCKET, Key: chave, Body: corpo,
      ContentType: 'application/octet-stream',
      Metadata: { sha256: sha, cifrado: String(temSenha()) },
    }));

    // Confere que chegou do tamanho certo antes de apagar qualquer coisa.
    const head = await r2().send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
    if (Number(head.ContentLength) !== corpo.length) {
      throw new Error(`subiu truncado: ${head.ContentLength} de ${corpo.length} bytes`);
    }
    console.log(`subiu: ${chave} (${mb(corpo.length)})`);

    // Só agora a limpeza. Se algo acima estourou, o histórico continua intacto.
    // O `!== chave` é cinto de segurança: se dois objetos empatarem no
    // LastModified, a ordenação fica instável e o recém-criado poderia cair na
    // faixa de poda. Apagar o backup que acabou de subir seria o pior desfecho
    // possível pra uma rotina de backup.
    const teto = manter();
    const todos = await listar();
    const velhos = todos.slice(teto).filter(o => o.Key !== chave);
    if (velhos.length) {
      await r2().send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: velhos.map(o => ({ Key: o.Key })) },
      }));
      console.log(`apagados ${velhos.length} antigos (mantendo ${teto})`);
    }
    return chave;
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

async function baixa(chave, destino) {
  const r = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: chave }));
  await pipeline(r.Body, fs.createWriteStream(destino));
  return destino;
}

// O que separa backup de esperança: pegar o que está lá e provar que abre.
async function verificar() {
  const todos = await listar();
  if (!todos.length) throw new Error('não há nenhum backup no bucket');
  const alvo = todos[0];
  console.log(`verificando ${alvo.Key} (${mb(alvo.Size)}, de ${alvo.LastModified.toISOString()})`);

  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'technik-vrf-'));
  try {
    let arq = path.join(tmp, 'baixado');
    await baixa(alvo.Key, arq);

    if (alvo.Key.endsWith('.enc')) {
      if (!temSenha()) throw new Error('backup cifrado e BACKUP_PASSPHRASE ausente — não dá pra verificar');
      const claro = path.join(tmp, 'claro.dump');
      await decifra(arq, claro);
      arq = claro;
      console.log('decifrou ok');
    }

    const info = await conferaDump(arq);
    console.log(`ABRE E TEM AS TABELAS: ${mb(info.size)}, ${info.tabelas} tabelas`);
    return true;
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

// Exportado pro teste (scripts/test-backup.mjs) poder exercitar cada peça sem
// passar pela CLI.
export { fazBackup, verificar, listar, baixa, cifra, decifra, conferaDump, geraDump, BUCKET };

// ─── CLI ────────────────────────────────────────────────────────────────────
// Só roda quando o arquivo é o ponto de entrada — importar não dispara backup.
const executando = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (executando) {
const [acao, arg] = process.argv.slice(2);
try {
  if (acao === '--listar') {
    const todos = await listar();
    if (!todos.length) console.log('(vazio)');
    for (const o of todos) {
      console.log(`${o.LastModified.toISOString()}  ${mb(o.Size).padStart(10)}  ${o.Key}`);
    }
  } else if (acao === '--verificar') {
    await verificar();
  } else if (acao === '--baixar') {
    if (!arg) throw new Error('uso: --baixar <chave>');
    const destino = path.basename(arg);
    await baixa(arg, destino);
    console.log(`salvo em ./${destino}`);
    if (arg.endsWith('.enc')) {
      console.log('está cifrado — para abrir:');
      console.log(`  node scripts/backup-db.mjs --decifrar ${destino}`);
    } else {
      console.log('para restaurar num banco vazio:');
      console.log(`  pg_restore --no-owner --no-privileges -d "$DATABASE_URL" ${destino}`);
    }
  } else if (acao === '--decifrar') {
    if (!arg) throw new Error('uso: --decifrar <arquivo.enc>');
    if (!temSenha()) throw new Error('BACKUP_PASSPHRASE ausente no .env');
    const saida = arg.replace(/\.enc$/, '');
    await decifra(arg, saida);
    console.log(`decifrado em ./${saida}`);
    console.log(`  pg_restore --no-owner --no-privileges -d "$DATABASE_URL" ${saida}`);
  } else if (!acao) {
    await fazBackup();
  } else {
    throw new Error(`ação desconhecida: ${acao}`);
  }
} catch (e) {
  console.error('falhou:', e.message);
  process.exitCode = 1;
}
}
