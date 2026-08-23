// Estoque da loja — o cadastro manual dos carros que estão no pátio (tabela
// `estoque`, criada via scripts/estoque-schema.sql).
//
// Erros SOBEM, como em `clientes.js` e `rascunhos.js`: cadastrar, subir foto e
// dar baixa são coisas que o consultor pediu explicitamente, então ele precisa
// saber quando falham. A única tolerância é dentro de um upload de várias fotos
// — ver `adicionaFotos`.
//
// Nada aqui fala com a FIPE, com o catálogo ou com a IA. É o consultor digitando
// o que ele tem. A separação é de propósito: o catálogo é o universo de modelos
// que a recomendação conhece; o estoque é o que existe de verdade no pátio, com
// km, cor e placa — e com FOTO DAQUELE CARRO, não do modelo.

import { randomUUID } from 'node:crypto';
import { q, one, oneOrFail, exec, jsonb } from './db.js';
import { putObject, removeObjects, listPrefix, pathFromUrl } from './storage.js';
import {
  encodeForStorage, dataUrlToBuffer, STORAGE_EXT, STORAGE_CONTENT_TYPE,
} from './imageCache.js';

// Pasta das fotos no bucket. Não colide com o acervo do catálogo: aquelas keys
// são `marca__modelo__ano`, sem barra, então nada do estoque cai numa varredura
// de modelo (nem o contrário).
const PREFIXO = 'estoque/';

const texto = (v) => {
  const s = (v == null ? '' : String(v)).trim();
  return s || null;
};

// Número como o brasileiro digita: "38.500", "R$ 38.500,00", "38500 km".
//
// Vazio vira NULL, e não 0 — "0 km" e "não sei o km" são coisas diferentes, e
// gravar zero seria inventar ficha técnica (a mesma regra do resto do projeto).
//
// O caso dos milhares é o que impede o erro caro: `Number('38.500')` é 38.5, ou
// seja, um carro de R$ 38.500 viraria R$ 38,50 sem ninguém perceber.
function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const inteiro = (v) => {
  const n = numero(v);
  return n == null ? null : Math.round(n);
};

// Só estes campos entram no insert/update. Whitelist, e não spread do body, pra
// que `status`, `baixa_em` e `fotos` não sejam alcançáveis por um PUT — quem
// mexe neles são `daBaixa`, `reabreVeiculo` e as funções de foto.
function camposDoVeiculo(body = {}) {
  const marca = texto(body.marca);
  const modelo = texto(body.modelo);
  if (!marca) throw new Error('marca é obrigatória');
  if (!modelo) throw new Error('modelo é obrigatório');
  const placa = texto(body.placa);
  return {
    marca,
    modelo,
    versao: texto(body.versao),
    ano_modelo: inteiro(body.ano_modelo),
    ano_fabricacao: inteiro(body.ano_fabricacao),
    km: inteiro(body.km),
    cor: texto(body.cor),
    // Maiúscula porque o índice de busca é `upper(placa)`: sem normalizar,
    // procurar "abc1d23" não acharia "ABC1D23".
    placa: placa ? placa.toUpperCase() : null,
    cambio: texto(body.cambio),
    combustivel: texto(body.combustivel),
    preco: numero(body.preco),
    notas: texto(body.notas),
  };
}

// ─── Leitura ────────────────────────────────────────────────────────────────

// `status` aceita 'disponivel', 'baixado' ou qualquer outra coisa (= todos).
export async function listEstoque({ busca = null, status = 'disponivel', limit = 300 } = {}) {
  const termo = texto(busca);
  const filtros = [];
  const params = [limit];

  if (status === 'disponivel' || status === 'baixado') {
    params.push(status);
    filtros.push(`status = $${params.length}`);
  }
  if (termo) {
    params.push(`%${termo}%`);
    const p = `$${params.length}`;
    filtros.push(`(marca ilike ${p} or modelo ilike ${p}
                   or coalesce(versao, '') ilike ${p}
                   or coalesce(placa, '') ilike ${p})`);
  }

  // Disponível primeiro mesmo em "todos" — `order by status` faria o contrário
  // (b antes de d), e a tela abriria mostrando o que já saiu do pátio.
  return q(
    `select * from estoque
      ${filtros.length ? 'where ' + filtros.join(' and ') : ''}
      order by (status = 'disponivel') desc, criado_em desc
      limit $1`,
    params
  );
}

// Contagem por status + soma dos preços. Vem separado da lista porque o
// cabeçalho tem que dizer o tamanho do estoque INTEIRO, e não do que sobrou
// depois do filtro de busca que o consultor acabou de digitar.
export async function resumoEstoque() {
  const linhas = await q(
    `select status, count(*)::int as total, coalesce(sum(preco), 0)::float as valor
       from estoque group by status`
  );
  const por = (s) => linhas.find(l => l.status === s) || { total: 0, valor: 0 };
  return {
    disponivel: por('disponivel').total,
    baixado: por('baixado').total,
    valorDisponivel: por('disponivel').valor,
  };
}

export async function getVeiculo(id) {
  return oneOrFail('select * from estoque where id = $1', [id], 'veículo não encontrado');
}

// ─── Cadastro ───────────────────────────────────────────────────────────────

export async function criaVeiculo(body) {
  const c = camposDoVeiculo(body);
  return one(
    `insert into estoque
       (marca, modelo, versao, ano_modelo, ano_fabricacao, km, cor, placa,
        cambio, combustivel, preco, notas)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning *`,
    [c.marca, c.modelo, c.versao, c.ano_modelo, c.ano_fabricacao, c.km, c.cor,
     c.placa, c.cambio, c.combustivel, c.preco, c.notas]
  );
}

export async function atualizaVeiculo(id, body) {
  const c = camposDoVeiculo(body);
  return oneOrFail(
    `update estoque
        set marca = $1, modelo = $2, versao = $3, ano_modelo = $4,
            ano_fabricacao = $5, km = $6, cor = $7, placa = $8, cambio = $9,
            combustivel = $10, preco = $11, notas = $12, atualizado_em = now()
      where id = $13 returning *`,
    [c.marca, c.modelo, c.versao, c.ano_modelo, c.ano_fabricacao, c.km, c.cor,
     c.placa, c.cambio, c.combustivel, c.preco, c.notas, id],
    'veículo não encontrado'
  );
}

// ─── Baixa ──────────────────────────────────────────────────────────────────
// Dar baixa é tirar do pátio SEM apagar o registro: a linha é o histórico de
// que aquele carro existiu, por quanto saiu e quanto tempo ficou parado.
// Excluir de verdade é `excluiVeiculo`, e serve pra cadastro errado.

export async function daBaixa(id, { motivo, preco_venda } = {}) {
  const atual = await getVeiculo(id);
  if (atual.status === 'baixado') throw new Error('este veículo já teve baixa');
  return oneOrFail(
    `update estoque
        set status = 'baixado', baixa_em = now(), baixa_motivo = $1,
            preco_venda = $2, atualizado_em = now()
      where id = $3 returning *`,
    [texto(motivo), numero(preco_venda), id],
    'veículo não encontrado'
  );
}

// Desfaz a baixa (clique errado, venda que caiu). Limpa motivo e preço de venda
// junto: eles descreviam AQUELA saída, e deixá-los grudados num carro que
// voltou pro pátio seria dado de outra vida do veículo.
export async function reabreVeiculo(id) {
  return oneOrFail(
    `update estoque
        set status = 'disponivel', baixa_em = null, baixa_motivo = null,
            preco_venda = null, atualizado_em = now()
      where id = $1 returning *`,
    [id],
    'veículo não encontrado'
  );
}

// Apaga a linha e, depois, as fotos do bucket.
//
// Nesta ordem de propósito: se a limpeza do bucket falhar, sobram arquivos
// órfãos — invisíveis e baratos. Na ordem inversa, uma falha no delete deixaria
// o veículo na tela com a galeria inteira quebrada.
export async function excluiVeiculo(id) {
  const apagados = await exec('delete from estoque where id = $1', [id]);
  if (!apagados) throw new Error('veículo não encontrado');
  try {
    const objetos = await listPrefix(`${PREFIXO}${id}/`);
    if (objetos.length) await removeObjects(objetos.map(o => o.path));
  } catch (e) {
    console.warn(`[estoque] limpeza do bucket de ${id} falhou: ${e.message}`);
  }
  return true;
}

// ─── Fotos ──────────────────────────────────────────────────────────────────

// A capa é a foto que aparece no card da lista. Garante SEMPRE uma, e só uma:
// sem isto, excluir justo a foto que era capa deixaria o card cinza mesmo com
// outras seis fotos no veículo.
function comCapa(fotos) {
  const lista = (fotos || []).filter(Boolean);
  if (lista.length === 0) return [];
  const i = lista.findIndex(f => f.capa);
  const capa = i >= 0 ? i : 0;
  return lista.map((f, k) => ({ ...f, capa: k === capa }));
}

// `jsonb(...)` é obrigatório aqui: o driver `pg` serializaria o array JS como
// ARRAY DO POSTGRES numa coluna jsonb, e o erro só apareceria na leitura.
// Ver o comentário do footgun em db.js.
async function gravaFotos(id, fotos) {
  return oneOrFail(
    'update estoque set fotos = $1, atualizado_em = now() where id = $2 returning *',
    [jsonb(fotos), id],
    'veículo não encontrado'
  );
}

// Upload manual: reencoda pro AVIF do projeto e sobe pro R2. Sem portão de
// visão — é foto do carro que está no pátio, tirada por quem cadastrou; não há
// o que validar contra "é mesmo um Corolla?".
//
// Uma foto que falha não derruba as outras (é comum mandar 10 de uma vez e uma
// estar corrompida), mas se NENHUMA subir o erro sobe: aí o consultor clicou em
// enviar e não aconteceu nada, e ele precisa saber.
export async function adicionaFotos(id, dataUrls) {
  if (!Array.isArray(dataUrls) || dataUrls.length === 0) throw new Error('nenhuma imagem enviada');
  const veiculo = await getVeiculo(id);
  const atuais = Array.isArray(veiculo.fotos) ? veiculo.fotos : [];

  const novas = [];
  for (const dataUrl of dataUrls) {
    const buffer = dataUrlToBuffer(dataUrl);
    if (!buffer) continue;
    try {
      const stored = await encodeForStorage(buffer);
      // Sufixo aleatório em vez de numeração sequencial: `01, 02, 03…` recicla
      // o número de uma foto excluída, e a próxima subiria POR CIMA do arquivo
      // de outra que ainda existe.
      const path = `${PREFIXO}${id}/${randomUUID().slice(0, 8)}.${STORAGE_EXT}`;
      const url = await putObject({ path, body: stored, contentType: STORAGE_CONTENT_TYPE });
      novas.push({ url, capa: false, criado_em: new Date().toISOString() });
    } catch (e) {
      console.warn(`[estoque] upload de foto em ${id}: ${e.message}`);
    }
  }
  if (novas.length === 0) throw new Error('nenhuma imagem válida no upload (formato ou tamanho)');

  const atualizado = await gravaFotos(id, comCapa([...atuais, ...novas]));
  console.log(`[estoque] ${id}: +${novas.length} foto(s) (total ${atualizado.fotos.length})`);
  return { veiculo: atualizado, adicionadas: novas.length };
}

// Remove do índice e do bucket. Falha no bucket não impede a remoção do índice —
// mesmo critério de `deleteCarPhoto` no imageCache: a foto some da tela, que é o
// que foi pedido; arquivo órfão é problema menor que um botão que não obedece.
export async function removeFoto(id, url) {
  if (!url) throw new Error('url da foto é obrigatória');
  const veiculo = await getVeiculo(id);
  const fotos = Array.isArray(veiculo.fotos) ? veiculo.fotos : [];
  if (!fotos.some(f => f.url === url)) throw new Error('foto não encontrada neste veículo');

  const path = pathFromUrl(url);
  if (path) {
    try { await removeObjects([path]); }
    catch (e) { console.warn(`[estoque] remoção no bucket falhou (${e.message}) — segue removendo do índice`); }
  }
  return gravaFotos(id, comCapa(fotos.filter(f => f.url !== url)));
}

export async function defineCapa(id, url) {
  if (!url) throw new Error('url da foto é obrigatória');
  const veiculo = await getVeiculo(id);
  const fotos = Array.isArray(veiculo.fotos) ? veiculo.fotos : [];
  if (!fotos.some(f => f.url === url)) throw new Error('foto não encontrada neste veículo');
  return gravaFotos(id, fotos.map(f => ({ ...f, capa: f.url === url })));
}
