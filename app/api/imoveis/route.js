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

// Preço de venda. O título é pouco confiável (vem truncado com "…" e em vários
// formatos), então a FONTE DE VERDADE é o JSON da página: anúncios com venda E
// aluguel trazem 2 valores "price" e o de VENDA é sempre o MAIOR (o menor é o
// aluguel mensal). Só caímos no título quando não há price no JSON.
function precoDe(html, titulo) {
  const precos = [...html.matchAll(/"price"\s*:\s*"?([\d.]+)/g)]
    .map((m) => Math.round(Number(m[1])) || 0)
    .filter(Boolean);
  if (precos.length) return Math.max(...precos);
  const tv = (titulo || '').match(/(?:à\s*venda\s*por|por)\s*R\$\s?([\d.]+,\d{2})/i);
  if (tv) return num(tv[1]);
  const m = (titulo || '').match(/R\$\s?([\d.]+,\d{2})/);
  return m ? num(m[1]) : 0;
}

// Extrai tipo/bairro/cidade/área dos vários formatos de título do parceiro:
//  "Casa à venda, 148 m² por R$ 1.170.000,00 - Parque Ortolândia - Hortolândia/SP"
//  "Sala de 14 m² Centro - Campinas, à venda por R$ 198.532 ou aluguel por R$ 900/mês"
//  "Apartamento de 50 m² na Avenida Mercedes Tiago, 1 - Residencial X - Cidade/SP"
//  "Sobrado com 3 dormitórios, 230 m² - venda por R$ 1.400.000,00 - Bairro - Cidade/SP"
const ehRuido = (s) =>
  !s ||
  /R\$|aluguel|à\s*venda|\bvenda\b|\bpor\b|\bm²\b|dormit|quart|^\d+$/i.test(s) ||
  /^(são\s+paulo|minas\s+gerais|paraná|rio\s+de\s+janeiro|santa\s+catarina|sp|mg|pr|rj|sc)$/i.test(s);
// limpa preço/estado/logradouro de um pedaço de texto até sobrar só o nome do local.
const limpaLocal = (s) =>
  s
    .replace(/,?\s*(à\s*venda|venda)\s*por[\s\S]*$/i, '')
    .replace(/[,/]\s*[A-Z]{2}\b[\s\S]*$/, '') // "/SP", ", SP", e estado por extenso
    .replace(/,\s*(são\s+paulo|minas|paraná|rio|santa\s+catarina)[\s\S]*$/i, '')
    .replace(/^na\s+(rua|av\.?|avenida|alameda|travessa|estrada)\b[^,]*,?\s*/i, '')
    .replace(/,\s*\d+\s*$/, '')
    .split(',')[0]
    .trim();

// A og:description do parceiro vem COMPLETA (o título é truncado em ~95 chars com
// "..."). A 1ª linha segue sempre o padrão "...por R$ X - Bairro - Cidade/SP", então
// ela é a fonte de verdade pra bairro/cidade. O título só serve de fallback.
// nome de local plausível: poucas palavras, sem pontuação de frase, não truncado.
// "Sumaré", "Recanto dos Sonhos" => ok; "Este apartamento no..." / "Ho" => não.
const ehLocalValido = (s) =>
  !!s &&
  s.length >= 4 &&
  s.split(/\s+/).length <= 5 &&
  !/[.!?:;]/.test(s) &&
  /^[A-Za-zÀ-ÿ]/.test(s);

function localDaDescricao(desc) {
  // só a 1ª linha, e só se ela seguir o padrão "...- Bairro - Cidade/SP" (tem o /UF).
  const linha = String(desc || '').split(/[\r\n]/)[0];
  if (!linha || !/\/(SP|MG|PR|RJ|SC)\b/i.test(linha)) return null;
  const partes = linha.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const uteis = partes.map(limpaLocal).filter((s) => s && !ehRuido(s));
  if (!uteis.length) return null;
  const cidade = uteis[uteis.length - 1];
  let bairro = uteis.length >= 2 ? uteis[uteis.length - 2] : '';
  if (bairro && bairro === cidade) bairro = '';
  // se algum dos dois não parece nome de lugar (texto corrido/truncado), descarta.
  if (!ehLocalValido(cidade) || (bairro && !ehLocalValido(bairro))) return null;
  return { bairro, cidade };
}

function parseTitulo(t, desc) {
  // og:title às vezes vem truncado com reticências (… ou ...): corta tudo a partir
  // delas e remove hífen/separador solto que sobra antes da reticência.
  const tt = (t || '')
    .replace(/(\.\.\.|…)[\s\S]*$/, '')
    .replace(/[\s-]+$/, '')
    .trim();
  const partes = tt.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const head = partes[0] || '';
  // tipo = primeira palavra (Casa, Apartamento, Sala, Sobrado, Terreno, Barracão...)
  const mt = head.match(/^([A-Za-zÀ-ÿ]+)/);
  const tipo = mt ? mt[1] : head.split(',')[0].trim();

  // bairro/cidade: prioriza a descrição (completa); cai no título quando a descrição
  // não traz o padrão "- Bairro - Cidade".
  const doDesc = localDaDescricao(desc);
  let cidade = doDesc ? doDesc.cidade : '';
  let bairro = doDesc ? doDesc.bairro : '';

  if (!cidade && !bairro) {
    // partes que não são ruído (preço/área/endereço) e não começam com logradouro.
    const uteis = partes.slice(1).map(limpaLocal).filter((s) => s && !ehRuido(s));
    cidade = uteis.length ? uteis[uteis.length - 1] : '';
    bairro = uteis.length >= 2 ? uteis[uteis.length - 2] : '';
    // formato "Tipo de N m² BAIRRO - Cidade...": bairro grudado depois do "m²"
    if (!bairro) {
      const mb = head.match(/m²\s+(.+)$/);
      if (mb) {
        const b = limpaLocal(mb[1]);
        if (b && !ehRuido(b)) bairro = b;
      }
    }
    if (bairro && bairro === cidade) bairro = '';
    // cidade truncada pelo "..." (ex.: "Ho" de Hortolândia): melhor vazio que quebrado.
    if (cidade && !ehLocalValido(cidade)) cidade = '';
  }

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
  const { tipo, bairro, cidade, area } = parseTitulo(titulo, desc);
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
