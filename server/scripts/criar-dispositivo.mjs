// Emite um token de dispositivo — a credencial que faz o app desktop entrar
// sozinho, sem tela de senha.
//
//   node scripts/criar-dispositivo.mjs "notebook da loja" [escopo]
//   node scripts/criar-dispositivo.mjs --listar
//   node scripts/criar-dispositivo.mjs --revogar <id>
//
// escopo: 'busca' (padrão) | 'crm' | 'tudo'. Deixe em 'busca': o token vive
// numa máquina que fica ligada na frente de clientes, e não há motivo pra ele
// alcançar telefone e histórico de outros compradores.
//
// O token é impresso UMA vez. Não dá pra recuperar depois — o banco só guarda
// o sha256. Perdeu, emite outro e revoga o antigo.

import 'dotenv/config';
import { closePool } from '../db.js';
import { criaDispositivo, listaDispositivos, revogaDispositivo } from '../auth.js';

const args = process.argv.slice(2);

try {
  if (args[0] === '--listar') {
    const linhas = await listaDispositivos();
    if (!linhas.length) console.log('nenhum dispositivo emitido');
    for (const d of linhas) {
      const estado = d.revogado_em ? 'REVOGADO' : 'ativo';
      const uso = d.ultimo_uso ? new Date(d.ultimo_uso).toLocaleString('pt-BR') : 'nunca usado';
      console.log(`${d.id}  ${estado.padEnd(9)} ${d.escopo.padEnd(6)} ${d.nome} — ${uso}`);
    }
  } else if (args[0] === '--revogar') {
    if (!args[1]) throw new Error('informe o id: --revogar <id>');
    const n = await revogaDispositivo(args[1]);
    console.log(n ? 'revogado — o app daquela máquina para de entrar na hora'
                  : 'nada revogado (id não existe ou já estava revogado)');
  } else {
    const nome = args[0];
    if (!nome) throw new Error('uso: node scripts/criar-dispositivo.mjs "nome da máquina" [escopo]');
    const escopo = args[1] || 'busca';
    if (!['busca', 'crm', 'tudo'].includes(escopo)) throw new Error(`escopo inválido: ${escopo}`);

    const token = await criaDispositivo({ nome, escopo });
    console.log(`\ndispositivo "${nome}" criado (escopo: ${escopo})`);
    console.log('\nGrave isto em credentials.json na máquina, e não guarde cópia:\n');
    console.log(JSON.stringify({ device: token }, null, 2));
    console.log('\nCaminho no Windows: %APPDATA%\\Technik\\credentials.json\n');
  }
} catch (e) {
  console.error('falhou:', e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
