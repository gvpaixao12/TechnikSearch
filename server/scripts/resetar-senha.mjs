// Gera uma senha TEMPORÁRIA pra um usuário, por SSH.
//
//   node scripts/resetar-senha.mjs <login>
//
// Irmão do criar-usuario.mjs, com uma diferença que é o motivo de existir: lá a
// senha sai definitiva (senha_temporaria = false), aqui sai temporária. Use
// este quando a senha for atravessar um canal que você não controla — chat,
// WhatsApp, papel — porque uma senha que passou por fora tem que morrer no
// primeiro login, não virar a senha permanente da conta.
//
// A senha é sorteada AQUI, na máquina que já tem o banco. Quem pediu o reset
// nunca a digitou e não precisa inventá-la, então ela não vaza pelo caminho de
// ida — só pelo de volta, uma vez.
//
// Toda a lógica é do resetaSenha() em auth.js — o mesmo que o botão do CRM
// chama. Este arquivo é só a porta de entrada por linha de comando, pro caso de
// não haver outro admin capaz de clicar naquele botão.

import 'dotenv/config';
import { one, closePool } from '../db.js';
import { resetaSenha } from '../auth.js';

const [login] = process.argv.slice(2);

if (!login) {
  console.error('uso: node scripts/resetar-senha.mjs <login>');
  process.exit(1);
}

try {
  const u = await one('select id, login from usuarios where lower(login) = lower($1)', [login]);
  if (!u) {
    // Diferente do endpoint público, aqui dizer que não existe é o certo: quem
    // tem SSH da máquina já pode listar a tabela inteira. Esconder só faria
    // você perder tempo com um login errado de digitação.
    console.error(`não existe usuário com login "${login}"`);
    process.exit(1);
  }

  const { senhaTemporaria } = await resetaSenha(u.id);

  console.log(`\n  usuário: ${u.login}`);
  console.log(`  senha temporária: ${senhaTemporaria}\n`);
  console.log('  Vale UMA vez: no próximo login o sistema exige que você escolha');
  console.log('  outra. As sessões que estavam abertas foram encerradas.\n');
} catch (e) {
  console.error('falhou:', e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
