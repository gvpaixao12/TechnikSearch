// Aplica um arquivo .sql de schema no banco configurado em DATABASE_URL.
//
//   node scripts/aplicar-schema.mjs auth-schema.sql
//
// Existe porque `criar-usuario.mjs` aplica o schema de carona, mas exige criar
// ou trocar a senha de alguém junto — o que não serve quando você só quer
// atualizar as tabelas num deploy.
//
// Os schemas do projeto são todos `create ... if not exists` / `add column if
// not exists`, então rodar de novo é inofensivo.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, closePool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node scripts/aplicar-schema.mjs <arquivo.sql>');
  process.exit(1);
}

const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(__dirname, arquivo);

try {
  if (!fs.existsSync(caminho)) throw new Error(`não achei ${caminho}`);
  await exec(fs.readFileSync(caminho, 'utf8'));
  console.log(`${path.basename(caminho)} aplicado`);
} catch (e) {
  console.error('falhou:', e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
