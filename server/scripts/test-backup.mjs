// Teste ponta a ponta do backup, contra um Postgres 16 e um S3 de verdade.
//
// Um backup só é backup depois que alguém restaurou. Este teste faz isso: dumpa
// um banco com dados, sobe pro storage, baixa de volta, restaura NUM BANCO VAZIO
// e confere que as linhas voltaram — inclusive o acento do nome e a vinculação
// entre consulta e cliente.
//
// Precisa de dois serviços na rede; não roda na máquina do dev sozinho. O jeito
// de rodar está em DEPLOY-VPS.md, seção "Testar o backup".
//
//   DATABASE_URL=...        banco de origem (será populado)
//   RESTORE_URL=...         banco vazio de destino (será sobrescrito)
//   R2_ENDPOINT=...         S3 compatível
//   R2_BACKUP_BUCKET=...    bucket (criado se não existir)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  S3Client, CreateBucketCommand, PutObjectCommand,
  ListObjectsV2Command, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const testes = [];
const ok = (nome, cond, extra = '') => {
  testes.push({ nome, cond: !!cond, extra });
  console.log((cond ? '  ok  ' : ' FALHA ') + nome + (cond || !extra ? '' : '\n         -> ' + extra));
};

const sh = (cmd, args, env = {}) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env } });
  let out = ''; let err = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { err += d; });
  p.on('close', c => (c === 0 ? res(out) : rej(new Error(`${cmd} (${c}): ${(err || out).trim()}`))));
});

const psql = (url, sql) => sh('psql', ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-d', url, '-c', sql]);

// ─── Preparo ────────────────────────────────────────────────────────────────
const ORIGEM = process.env.DATABASE_URL;
const DESTINO = process.env.RESTORE_URL;
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

async function aplicaSchemas(url) {
  // Ordem importa: clientes-schema referencia consultas e rascunhos.
  const ordem = ['auth-schema.sql', 'consultas-schema.sql', 'rascunhos-schema.sql',
    'feedback-schema.sql', 'car-images-cache-schema.sql', 'uso-api-schema.sql',
    'clientes-schema.sql'];
  for (const f of ordem) {
    const p = path.join(DIR, f);
    if (fs.existsSync(p)) await sh('psql', ['-v', 'ON_ERROR_STOP=1', '-d', url, '-f', p]);
  }
}

// Zera os dois bancos e o bucket. Sem isto o teste só passa na primeira vez —
// e teste que não repete não serve pra rodar de novo depois de mexer no script.
async function zera(s3) {
  for (const url of [ORIGEM, DESTINO]) {
    await sh('psql', ['-v', 'ON_ERROR_STOP=1', '-d', url, '-c',
      'drop schema public cascade; create schema public;']);
  }
  const dentro = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BACKUP_BUCKET }))
    .catch(() => ({ Contents: [] }));
  if (dentro.Contents?.length) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BACKUP_BUCKET,
      Delete: { Objects: dentro.Contents.map(o => ({ Key: o.Key })) },
    }));
  }
}

async function populaOrigem() {
  await psql(ORIGEM, `
    insert into clientes (id, nome, telefone, email, notas)
      values ('11111111-1111-1111-1111-111111111111', 'João Conceição', '(11) 90000-0000',
              'joao@exemplo.com', 'acento e til: ãõç');
    insert into consultas (client_name, client_segment, ok, orcamento_min, orcamento_max,
                           tipos, total_resultados, top_models, cliente_id)
      values ('João Conceição', 'família', true, 80000, 140000,
              array['suv'], 3, array['Jeep Compass'],
              '11111111-1111-1111-1111-111111111111');
    insert into usuarios (login, senha_hash) values ('teste', 'scrypt$x$y$z$aa$bb');
  `);
}

const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tkbkp-'));

try {
  const s3 = new S3Client({
    region: 'auto', endpoint: process.env.R2_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  await s3.send(new CreateBucketCommand({ Bucket: process.env.R2_BACKUP_BUCKET })).catch(() => {});

  await zera(s3);
  await aplicaSchemas(ORIGEM);
  await populaOrigem();
  ok('preparo: origem tem 1 cliente', (await psql(ORIGEM, 'select count(*) from clientes')).trim() === '1');

  const bkp = await import('./backup-db.mjs');

  // ── Ciclo sem cifra ───────────────────────────────────────────────────────
  const chave = await bkp.fazBackup();
  ok('backup: subiu com nome datado', /^postgres\/technik-\d{4}-\d\d-\d\dT\d\d-\d\d\.dump$/.test(chave), chave);
  ok('backup: aparece na listagem', (await bkp.listar()).some(o => o.Key === chave));

  ok('verificar: o que está no bucket abre e tem as tabelas', await bkp.verificar());

  // ── O teste que importa: restaurar num banco vazio ────────────────────────
  const local = path.join(tmp, 'baixado.dump');
  await bkp.baixa(chave, local);
  await sh('pg_restore', ['--no-owner', '--no-privileges', '-d', DESTINO, local]);

  const nome = (await psql(DESTINO, 'select nome from clientes')).trim();
  ok('restore: o cliente voltou, com acento intacto', nome === 'João Conceição', nome);

  const vinculo = (await psql(DESTINO,
    `select c.client_name from consultas c
       join clientes k on k.id = c.cliente_id`)).trim();
  ok('restore: a vinculação consulta→cliente sobreviveu', vinculo === 'João Conceição', vinculo);

  const notas = (await psql(DESTINO, 'select notas from clientes')).trim();
  ok('restore: UTF-8 dos campos livres intacto', notas === 'acento e til: ãõç', notas);

  const fk = (await psql(DESTINO,
    `select count(*) from information_schema.table_constraints
      where constraint_type = 'FOREIGN KEY' and table_name = 'consultas'`)).trim();
  ok('restore: a foreign key veio junto', Number(fk) >= 1, fk);

  // ── Cifra ─────────────────────────────────────────────────────────────────
  const claro = path.join(tmp, 'claro.bin');
  const cifrado = path.join(tmp, 'cifrado.bin');
  const devolta = path.join(tmp, 'devolta.bin');
  const original = crypto.randomBytes(200000);   // maior que um chunk de stream
  await fs.promises.writeFile(claro, original);

  process.env.BACKUP_PASSPHRASE = 'uma senha qualquer';
  await bkp.cifra(claro, cifrado);
  const cif = await fs.promises.readFile(cifrado);
  ok('cifra: o resultado não contém o texto claro', !cif.includes(original.subarray(0, 64)));
  // 5 (TKBK1) + 16 (salt) + 12 (iv) + 16 (tag) = 49.
  ok('cifra: tem o cabeçalho e cresce 49 bytes (magic+salt+iv+tag)',
    cif.subarray(0, 5).toString() === 'TKBK1' && cif.length === original.length + 49,
    `${cif.length} vs ${original.length}`);

  await bkp.decifra(cifrado, devolta);
  ok('cifra: decifrar devolve byte a byte o original',
    Buffer.compare(await fs.promises.readFile(devolta), original) === 0);

  // Adulterar tem que estourar, senão a cifra não está autenticando nada.
  const mexido = path.join(tmp, 'mexido.bin');
  const copia = Buffer.from(cif);
  copia[100] ^= 0xff;
  await fs.promises.writeFile(mexido, copia);
  let estourou = false;
  await bkp.decifra(mexido, path.join(tmp, 'lixo.bin')).catch(() => { estourou = true; });
  ok('cifra: conteúdo adulterado é recusado', estourou);

  let senhaErrada = false;
  process.env.BACKUP_PASSPHRASE = 'senha errada';
  await bkp.decifra(cifrado, path.join(tmp, 'lixo2.bin')).catch(() => { senhaErrada = true; });
  ok('cifra: senha errada é recusada', senhaErrada);
  process.env.BACKUP_PASSPHRASE = 'uma senha qualquer';

  // Ciclo completo cifrado, incluindo a verificação.
  const chaveCif = await bkp.fazBackup();
  ok('backup cifrado: nome termina em .enc', chaveCif.endsWith('.dump.enc'), chaveCif);
  ok('backup cifrado: verificar decifra e valida', await bkp.verificar());
  delete process.env.BACKUP_PASSPHRASE;

  // ── As recusas ────────────────────────────────────────────────────────────
  // Dump de um banco vazio não pode passar: é o modo de falha silencioso.
  const vazio = path.join(tmp, 'vazio.dump');
  const urlVazio = DESTINO.replace(/\/[^/]+$/, '/postgres');
  await bkp.geraDump(vazio).catch(() => {});
  let recusou = null;
  try {
    process.env.DATABASE_URL = urlVazio;
    await bkp.geraDump(vazio);
    await bkp.conferaDump(vazio);
  } catch (e) { recusou = e.message; } finally { process.env.DATABASE_URL = ORIGEM; }
  ok('recusa: dump sem as tabelas do projeto é rejeitado',
    recusou && (/não tem|pequeno demais/.test(recusou)), String(recusou));

  const truncado = path.join(tmp, 'truncado.dump');
  await fs.promises.writeFile(truncado, 'nada');
  let recusouPequeno = null;
  await bkp.conferaDump(truncado).catch(e => { recusouPequeno = e.message; });
  ok('recusa: arquivo minúsculo é rejeitado', /pequeno demais/.test(String(recusouPequeno)), String(recusouPequeno));

  // ── Retenção ──────────────────────────────────────────────────────────────
  // Enche o bucket de backups falsos velhos e confirma que a poda respeita o
  // teto — e que o backup novo continua lá depois dela.
  process.env.BACKUP_MANTER = '3';
  for (let i = 0; i < 6; i++) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BACKUP_BUCKET,
      Key: `postgres/technik-2020-01-0${i + 1}T00-00.dump`,
      Body: Buffer.alloc(10),
    }));
  }
  const antes = (await bkp.listar()).length;
  const nova = await bkp.fazBackup();
  const depois = await bkp.listar();
  ok('retenção: poda até o teto', depois.length === 3, `antes ${antes}, depois ${depois.length}`);
  ok('retenção: o backup recém-criado sobrevive à poda', depois.some(o => o.Key === nova));

  // A poda é por LastModified (hora do upload), não pelo nome do arquivo — os
  // dois coincidem no uso real, mas é o LastModified que manda. Então o que se
  // verifica é que sobrou o mais recente, não que sobrou o nome mais novo.
  const maisRecentes = [...depois].sort((a, b) => b.LastModified - a.LastModified);
  ok('retenção: sobram os mais recentes por LastModified',
    JSON.stringify(depois.map(o => o.Key)) === JSON.stringify(maisRecentes.map(o => o.Key)),
    depois.map(o => o.Key).join(' '));

  // E podar de novo, sem nada novo pra subir, não pode zerar o bucket.
  await bkp.fazBackup();
  ok('retenção: rodar de novo mantém o teto, não esvazia',
    (await bkp.listar()).length === 3);

} catch (e) {
  ok('o teste rodou ate o fim', false, String(e).slice(0, 400));
} finally {
  await fs.promises.rm(tmp, { recursive: true, force: true });
}

const falhas = testes.filter(t => !t.cond).length;
console.log('\n' + (testes.length - falhas) + '/' + testes.length + ' passaram');
process.exit(falhas ? 1 : 0);
