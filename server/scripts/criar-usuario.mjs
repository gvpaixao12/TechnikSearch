// Cria (ou troca a senha de) um usuário do CRM.
//
//   node scripts/criar-usuario.mjs <login> <senha> ["Nome Completo"]
//
// Aplica o auth-schema.sql antes, se as tabelas ainda não existirem — o SQL é
// todo `create ... if not exists`, então rodar de novo não faz mal.
//
// A senha vai por argumento porque este script roda sem terminal interativo.
// Consequência: ela fica no histórico do shell. Depois de criar, vale limpar
// (`history -c` no bash, ou rodar com um espaço na frente do comando).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, one, closePool } from '../db.js';
import { hashSenha } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [login, senha, nome] = process.argv.slice(2);

if (!login || !senha) {
  console.error('uso: node scripts/criar-usuario.mjs <login> <senha> ["Nome"]');
  process.exit(1);
}

try {
  const sql = fs.readFileSync(path.join(__dirname, 'auth-schema.sql'), 'utf8');
  await exec(sql);
  console.log('schema conferido');

  const hash = await hashSenha(senha);

  const existente = await one('select id from usuarios where lower(login) = lower($1)', [login]);
  if (existente) {
    await exec('update usuarios set senha_hash = $1, nome = coalesce($2, nome) where id = $3',
      [hash, nome || null, existente.id]);
    // Trocar a senha invalida os logins abertos — senão trocar por suspeita de
    // vazamento não expulsaria quem já estava dentro.
    const n = await exec('delete from sessoes where usuario_id = $1', [existente.id]);
    console.log(`senha de "${login}" atualizada (${n} sessão(ões) encerrada(s))`);
  } else {
    await exec('insert into usuarios (login, nome, senha_hash) values ($1, $2, $3)',
      [login, nome || null, hash]);
    console.log(`usuário "${login}" criado`);
  }
} catch (e) {
  console.error('falhou:', e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
