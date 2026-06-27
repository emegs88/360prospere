export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache real fica no CDN via header

// Agregador/normalizador das cartas contempladas de 3 fontes EXTERNAS (além da Lance):
//   - CBC (Contempla Bens)  -> planilha Google Sheets (CSV)
//   - Piffer Contemplados   -> tabela HTML do site
//   - Cartas Contempladas   -> tabela HTML do site
//
// Regras de negócio pedidas:
//   - Puxa SÓ as disponíveis.
//   - Aplica comissão de 7% sobre o crédito e SOMA na entrada (entrada exibida).
//   - Recalcula o custo efetivo já com a comissão embutida.
//   - Mascara a administradora: cliente vê só um CÓDIGO (ADM-01, ADM-02...).
//     O nome real só é devolvido para o painel interno do 360 (?admin=1).
//   - Como as administradoras são diferentes, o cliente só pode JUNTAR cartas
//     da MESMA administradora e do MESMO tipo -> chave de junção = `ac` (código) + `t`.
//
// Saída por carta: { id, fonte, t, c, e, p, x, ac, custoEfetivo, comissao, [adm] }

const FONTES = {
  cbc: 'https://docs.google.com/spreadsheets/d/1bUFgA8qUTXSAC4gqhsUTU25_dMEaKbM3YgWp4yg8tcU/export?format=csv&gid=0',
  piffer: 'https://piffercontemplados.com.br/',
  cartas: 'https://cartascontempladas.com.br/ver-todas-as-cartas-contempladas/',
};
const WHATSAPP = '5519997561909';
const COMISSAO = 0.07; // 7% sobre o crédito, somado na entrada

// ---------------- helpers de parsing ----------------
function numBR(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function tipoDe(s) {
  return /im[oó]ve|casa/i.test(String(s)) ? 'imovel' : 'veiculo';
}
// Parcela pode ser simples ("199x R$ 286,00") ou escalonada
// ("190 x 4.093 + 05 x 3.462 + 30 x 980"). Extrai os pares "N x VALOR" e devolve:
//   p    = valor da 1ª faixa (parcela representativa)
//   x    = nº total de parcelas (soma dos N)
//   soma = total efetivamente pago em parcelas (Σ N*VALOR) -> usado no custo efetivo
function parsParcela(txt) {
  const t = String(txt || '').replace(/R\$/g, ' ');
  const pares = [...t.matchAll(/(\d{1,3})\s*x\s*([\d.]+(?:,\d{2})?)/gi)]
    .map((m) => ({ n: Number(m[1]), v: numBR(m[2]) }))
    .filter((o) => o.n > 0 && o.v > 50);
  if (pares.length) {
    const x = pares.reduce((s, o) => s + o.n, 0);
    const soma = pares.reduce((s, o) => s + o.n * o.v, 0);
    return { p: pares[0].v, x, soma };
  }
  // fallback: pega qualquer valor monetário avulso
  let x = 0;
  [...t.matchAll(/(\d+)\s*x/gi)].forEach((m) => (x += Number(m[1])));
  const val = [...t.matchAll(/([\d.]+,\d{2}|\d[\d.]{2,})/g)]
    .map((m) => numBR(m[1]))
    .filter((n) => n > 50);
  const p = val.length ? val[0] : 0;
  return { p, x: x || 0, soma: p * (x || 0) };
}
function tds(row) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  );
}

// ---------------- normalização de administradora ----------------
// Agrupa variações de grafia da MESMA administradora numa chave canônica,
// pra junção funcionar entre fontes (ex.: "PORTO", "PORTO SEGURO", "PORTO AF").
function normAdm(raw) {
  const s = String(raw || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (/^PORTO/.test(s)) return 'PORTO';
  if (/^ITAU/.test(s)) return 'ITAU';
  if (/^ANCORA/.test(s)) return 'ANCORA';
  if (/^(BANCO DO BRASIL|BCO BRASIL|BBRASIL|BB)$/.test(s)) return 'BANCO DO BRASIL';
  if (/^(H S|HS)$/.test(s)) return 'HS';
  if (/^VOLKS/.test(s)) return 'VOLKSWAGEN';
  return s;
}

// ---------------- parsers por fonte ----------------
function parseCBC(csv) {
  const out = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    if (f.length < 7) continue;
    const [tipoRaw, adm, cred, ent, prazo, parc, status] = f;
    if (!/dispon/i.test(status)) continue; // só disponíveis
    const c = numBR(cred);
    if (!(c > 0)) continue;
    const pp = parsParcela(parc);
    out.push({
      fonte: 'CBC',
      adm: (adm || '').trim(),
      t: tipoDe(tipoRaw),
      c,
      e: numBR(ent),
      x: Number(prazo) || pp.x,
      p: pp.p,
      soma: pp.soma,
    });
  }
  return out;
}
function parsePiffer(html) {
  const out = [];
  const tb = (html.match(/<tbody[\s\S]*?<\/tbody>/i) || [])[0] || html;
  const rows = [...tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (const r of rows) {
    const cat = (r.match(/data-category="([^"]*)"/) || [])[1];
    const adm = (r.match(/data-admin="([^"]*)"/) || [])[1];
    if (!cat) continue; // só linhas de carta (têm checkbox com data-category)
    const c = tds(r); // [chk, img, adm, crédito, entrada, parcela, valorparc, venc, tipopg, status]
    if (!/dispon/i.test(c[9] || c[c.length - 1] || '')) continue;
    const cred = numBR(c[3]);
    if (!(cred > 0)) continue;
    const pp = parsParcela(c[5]);
    const pVal = numBR(c[6]) || pp.p;
    out.push({
      fonte: 'PIFFER',
      adm: (adm || c[2] || '').trim(),
      t: cat === '1' ? 'imovel' : 'veiculo',
      c: cred,
      e: numBR(c[4]),
      x: pp.x,
      p: pVal,
      soma: pp.soma || pVal * pp.x,
    });
  }
  return out;
}
function parseCartas(html) {
  const out = [];
  const t = (html.match(/<table[\s\S]*?<\/table>/i) || [])[0] || '';
  const rows = [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (const r of rows) {
    if (!/colunaSegmento/.test(r)) continue; // linha de carta
    const c = tds(r); // [_, _, segmento, adm, crédito, entrada, prazo, valorparc, venc]
    const cred = numBR(c[4]);
    if (!(cred > 0)) continue;
    // a coluna de parcela (c[7]) pode ser simples ou escalonada ("5 x 380,00 + 162 x 352,00")
    const pp = parsParcela(c[7]);
    const pVal = pp.p || numBR(c[7]);
    const xVal = Number(c[6]) || pp.x;
    out.push({
      fonte: 'CARTAS',
      adm: (c[3] || '').trim(),
      t: tipoDe(c[2] || ''),
      c: cred,
      e: numBR(c[5]),
      x: xVal,
      p: pVal,
      soma: pp.soma || pVal * xVal,
    });
  }
  return out;
}

// fetch tolerante: nunca derruba o agregado se uma fonte cair
async function puxa(url, parser) {
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'text/html,text/csv,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; Prospere360/1.0)',
      },
      cache: 'no-store',
    });
    if (!r.ok) return { ok: false, status: r.status, itens: [] };
    const txt = await r.text();
    return { ok: true, status: 200, itens: parser(txt) };
  } catch (e) {
    return { ok: false, status: 0, erro: String(e), itens: [] };
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    // ?admin=1 -> devolve também o nome real da administradora (só p/ painel interno 360).
    const isAdmin = searchParams.get('admin') === '1';
    // ?tipo=imovel|veiculo -> filtra (bidcon-imobiliaria / bidcon-lojista).
    const tipoReq = searchParams.get('tipo');

    const [cbc, pif, car] = await Promise.all([
      puxa(FONTES.cbc, parseCBC),
      puxa(FONTES.piffer, parsePiffer),
      puxa(FONTES.cartas, parseCartas),
    ]);

    let all = [...cbc.itens, ...pif.itens, ...car.itens].filter((o) => o.c > 0);

    // chave canônica + mapa de código estável (ordem alfabética)
    all.forEach((o) => (o.admN = normAdm(o.adm)));

    // exclui administradoras bloqueadas (ex.: Âncora não entra no agregado)
    const ADM_BLOQUEADAS = new Set(['ANCORA']);
    all = all.filter((o) => !ADM_BLOQUEADAS.has(o.admN));
    const canon = [...new Set(all.map((o) => o.admN).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
    const code = {};
    canon.forEach((a, i) => (code[a] = 'ADM-' + String(i + 1).padStart(2, '0')));

    // monta saída final com comissão 7% + custo efetivo
    let cotas = all.map((o, i) => {
      const comissao = Math.round(o.c * COMISSAO);
      const eExib = o.e + comissao; // entrada exibida = entrada + comissão
      // total das parcelas: usa a soma real das faixas quando há (parcela escalonada),
      // senão estima parcela × nº de parcelas.
      const totalParcelas = o.soma > 0 ? o.soma : (o.p || 0) * (o.x || 0);
      const totalPago = eExib + totalParcelas;
      // custo efetivo: quanto se paga a mais do que o crédito, em % do crédito
      const custoEfetivo = o.c > 0 ? Math.round(((totalPago - o.c) / o.c) * 1000) / 10 : 0;
      const out = {
        id: i + 1,
        fonte: o.fonte,
        t: o.t,
        c: o.c, // crédito
        e: eExib, // entrada já com a comissão somada
        p: o.p, // valor da parcela
        x: o.x, // nº de parcelas
        ac: code[o.admN] || 'ADM-00', // código mascarado da administradora
        comissao,
        custoEfetivo, // % sobre o crédito (já com comissão)
      };
      if (isAdmin) out.adm = o.adm; // nome real só p/ admin
      return out;
    });

    if (tipoReq === 'imovel' || tipoReq === 'veiculo') {
      cotas = cotas.filter((c) => c.t === tipoReq);
    }

    const fontesStatus = {
      CBC: { ok: cbc.ok, status: cbc.status, qtd: cbc.itens.length },
      PIFFER: { ok: pif.ok, status: pif.status, qtd: pif.itens.length },
      CARTAS: { ok: car.ok, status: car.status, qtd: car.itens.length },
    };

    return new Response(
      JSON.stringify({
        ok: true,
        atualizado: new Date().toISOString(),
        whatsapp: WHATSAPP,
        comissao_pct: COMISSAO,
        admins: canon.length, // nº de administradoras distintas
        total: cotas.length,
        imovel: cotas.filter((c) => c.t === 'imovel').length,
        veiculo: cotas.filter((c) => c.t === 'veiculo').length,
        fontes: fontesStatus,
        cotas,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 's-maxage=300, stale-while-revalidate=900',
        },
      }
    );
  } catch (e) {
    return Response.json({ ok: false, error: String(e), cotas: [] }, { status: 502 });
  }
}
