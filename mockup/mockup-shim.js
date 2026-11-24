// Servidor falso do mockup: intercepta o fetch('/api/...') do app real e
// responde com os dados congelados de mockup-data.js. Nada sai pra rede além
// das fotos (R2 público) e das fontes/CDN. Carregar ANTES dos .jsx.
(function () {
  window.API_BASE = '';

  const slug = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));

  const consultas = () => window.MOCKUP_CONSULTAS || [];
  const resumo = (c) => ({
    id: c.id, created_at: c.created_at, client_name: c.client_name,
    client_segment: c.client_segment, orcamento_min: c.orcamento_min,
    orcamento_max: c.orcamento_max, tipos: c.tipos,
    total_resultados: c.top.length, top_models: c.top.map(t => `${t.brand} ${t.model}`),
  });
  const completa = (c) => ({ ...c, ok: true, modelo: true, total_resultados: c.top.length });

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : input.url;
    const u = new URL(raw, location.href);
    if (!u.pathname.startsWith('/api/')) return realFetch(input, init);
    const p = u.pathname;
    let m;

    if (p === '/api/me') return json({ ok: true, nome: 'Consultor Technik', email: '', admin: false });
    if (p === '/api/consultas/modelos') return json({ ok: true, modelos: consultas().map(resumo) });
    if ((m = p.match(/^\/api\/consultas\/([^/]+)$/))) {
      const c = consultas().find(x => x.id === m[1]);
      return c ? json({ ok: true, consulta: completa(c) }) : json({ ok: false, reason: 'consulta não encontrada' }, 404);
    }
    if (/^\/api\/consultas\/[^/]+\/modelo$/.test(p)) return json({ ok: true, modelo: true });
    if ((m = p.match(/^\/api\/images\/([^/]+)\/([^/]+)\/(\d+)$/))) {
      const key = `${slug(decodeURIComponent(m[1]))}__${slug(decodeURIComponent(m[2]))}__${m[3]}`;
      const images = (window.MOCKUP_FOTOS || {})[key] || [];
      return json({ key, images, validated: true, cached: true });
    }
    if (p === '/api/recommend') {
      return json({ ok: false, reason: 'Este é um mockup: abra uma das "Pesquisas modelo" no menu lateral.' }, 400);
    }
    if (p === '/api/rascunhos') return json({ ok: true, rascunhos: [] });
    // Feedback, "não curti", etc.: aceita e ignora.
    return json({ ok: true });
  };
})();
