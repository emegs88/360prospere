export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // cache fica no CDN via header

// Proxy do estoque de imóveis das imobiliárias parceiras. Todas rodam na
// plataforma Kenlo/ingaia (mesmo formato): não há API pública de produtos, então
// a fonte de verdade é o sitemap de imóveis + as meta tags Open Graph de cada
// anúncio (título, preço, descrição, imagem, localização). Roda no servidor pra
// contornar CORS e normalizar igual ao /api/estoque.
//
// ?fonte=prospere (padrão) | fmi  -> escolhe a imobiliária parceira.
const FONTES = {
  prospere: { nome: 'Prospere Hortolândia', site: 'https://www.prosperehortolandia.com.br' },
  fmi: { nome: 'FMI Imobiliária', site: 'https://www.fmiimobiliaria.com.br' },
};
const FONTE_PADRAO = 'prospere';
const UA = 'Mozilla/5.0 (compatible; bidconBot/1.0; +https://360prospere.vercel.app)';
const MAX_SITEMAPS = 60; // teto de sub-sitemaps de imóveis a varrer
const MAX_IMOVEIS = 90; // teto de anúncios buscados por request
const FETCH_CONC = 8; // requisições paralelas

async function txt(url, timeout = 12000) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctl.signal });
    if (!r.ok) return '';
    return await r.text();
  } catch {
    return '';
  } finally {
    clearTimeout(id);
  }
}

const locs = (xml) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());

function og(html, prop) {
  const m = html.match(new RegExp(`<meta property="og:${prop}" content="([\\s\\S]*?)"`, 'i'));
  return m ? m[1].trim() : '';
}

const num = (s) =>
  Number(String(s || '').replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

// Atenção: anúncios com venda E aluguel trazem 2 valores. No título, o preço de
// venda vem depois de "à venda por"; no JSON aparecem vários "price" (o de
// aluguel costuma ser o menor). Priorizamos o título; no JSON, pegamos o MAIOR.
function precoDe(html, titulo) {
  const tv = (titulo || '').match(/à\s*venda\s*por\s*R\$\s?([\d.]+(?:,\d{2})?)/i);
  if (tv) {
    const v = num(tv[1]);
    if (v) return v;
  }
  const precos = [...html.matchAll(/"price"\s*:\s*"?([\d.]+)/g)]
    .map((m) => Math.round(Number(m[1])) || 0)
    .filter(Boolean);
  if (precos.length) return Math.max(...precos);
  const m = (titulo || '').match(/R\$\s?([\d.]+,\d{2})/);
  return m ? num(m[1]) : 0;
}

// Aceita os dois formatos do parceiro:
//  "Casa à venda, 148 m² por R$ 1.170.000,00 - Parque Ortolândia - Hortolândia/SP"
//  "Sala de 14 m² Centro - Campinas, à venda por R$ 198.532 ou aluguel por R$ 900/mês"
function parseTitulo(t) {
  const partes = (t || '').split(' - ').map((s) => s.trim());
  let head = partes[0] || '';
  // tipo = primeira palavra significativa (Casa, Apartamento, Sala, Terreno...)
  const mt = head.match(/^([A-Za-zÀ-ÿ]+)/);
  const tipo = mt ? mt[1] : head.split(',')[0].trim();
  // bairro: no formato 1 vem em partes[1]; no formato 2 vem grudado depois do "m² "
  let bairro = '';
  const mb = head.match(/m²\s+(.+)$/);
  if (mb) bairro = mb[1].trim();
  else if (partes.length >= 2) bairro = partes[1];
  // cidade: parte que tem "à venda"/UF, limpando o trecho de venda/aluguel
  let cidade = '';
  for (const p of partes.slice(1)) {
    const c = p.split(',')[0].replace(/\/[A-Z]{2}.*$/, '').trim();
    if (/à\s*venda|aluguel|R\$/i.test(p) || /\/[A-Z]{2}/.test(p)) {
      cidade = c;
      break;
    }
  }
  if (!cidade && partes.length >= 3) cidade = partes[2].split(',')[0].trim();
  const area = (() => {
    const m = (t || '').match(/([\d.,]+)\s*m²/);
    return m ? m[1] : '';
  })();
  return { tipo, bairro, cidade, area };
}

function normaliza(url, html) {
  const titulo = og(html, 'title');
  if (!titulo) return null;
  const preco = precoDe(html, titulo);
  if (!preco) return null;
  const img = og(html, 'image');
  const desc = og(html, 'description');
  const { tipo, bairro, cidade, area } = parseTitulo(titulo);
  const codigo = (url.match(/\/([A-Z]{2}\d+-[A-Z]+)$/) || [])[1] || '';
  const venda = /\/a-venda\//.test(url) || /à venda/i.test(titulo);
  return {
    id: codigo || url,
    codigo,
    nome:
      titulo
        .replace(/,?\s*(à\s*venda|aluguel)\s*por[\s\S]*$/i, '')
        .replace(/\s*-\s*[^-]*\/SP.*$/i, '')
        .trim() || tipo,
    tipo,
    bairro,
    cidade,
    area,
    preco,
    desc: (desc || '').slice(0, 220),
    img,
    link: og(html, 'url') || url,
    venda,
  };
}

async function pool(items, worker, conc) {
  const out = [];
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, run));
  return out;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = (searchParams.get('fonte') || FONTE_PADRAO).toLowerCase();
    const fonte = FONTES[key] || FONTES[FONTE_PADRAO];
    const SITE = fonte.site;
    const SITEMAP = `${SITE}/sitemap.xml`;

    const idx = await txt(SITEMAP);
    const children = locs(idx).filter((u) => /\/sitemap\/imoveis\//.test(u)).slice(0, MAX_SITEMAPS);

    // coleta URLs de anúncios individuais (contêm /imovel/.../CODIGO)
    const setUrls = new Set();
    await pool(
      children,
      async (sm) => {
        const xml = await txt(sm);
        for (const u of locs(xml)) {
          if (/\/imovel\//.test(u)) setUrls.add(u);
          if (setUrls.size >= MAX_IMOVEIS) break;
        }
      },
      FETCH_CONC
    );

    const urls = [...setUrls].slice(0, MAX_IMOVEIS);
    const pages = await pool(urls, async (u) => normaliza(u, await txt(u)), FETCH_CONC);
    const imoveis = pages.filter(Boolean).sort((a, b) => a.preco - b.preco);

    return new Response(
      JSON.stringify({
        ok: true,
        fonteId: key in FONTES ? key : FONTE_PADRAO,
        parceiro: fonte.nome,
        fonte: SITE,
        atualizado: new Date().toISOString(),
        total: imoveis.length,
        imoveis,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 's-maxage=3600, stale-while-revalidate=21600',
        },
      }
    );
  } catch (e) {
    return Response.json({ ok: false, error: String(e), imoveis: [] }, { status: 502 });
  }
}
