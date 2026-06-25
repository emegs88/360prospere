export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache fica no CDN via header

// Proxy de estoque WooCommerce (Store API). Roda no servidor pra contornar CORS
// e normalizar os dados pro front.
//
// Sem ?url=  -> usa o parceiro padrão (Unimais Veículos).
// Com ?url=  -> qualquer lojista cola o link da própria loja WooCommerce e o
//               sistema descobre o endpoint Store API, busca e normaliza igual.
const DEFAULT_BASE = 'https://unimaisveiculos.com.br/wp-json/wc/store/v1/products';
const DEFAULT_FONTE = 'https://unimaisveiculos.com.br/estoque/';
const DEFAULT_PARCEIRO = 'Unimais Veículos';
const PER = 100;
const MAX_PAGES = 6; // teto de segurança (~600 itens)

function precoReais(prices) {
  if (!prices) return 0;
  const minor = Number(prices.currency_minor_unit ?? 2);
  const raw = Number(prices.price ?? prices.regular_price ?? 0);
  if (!raw) return 0;
  return raw / Math.pow(10, minor);
}

function normaliza(p) {
  const preco = precoReais(p.prices);
  const img = (p.images && p.images[0] && p.images[0].src) || '';
  const cats = (p.categories || []).map((c) => c.name);
  return {
    id: p.id,
    nome: (p.name || '').trim(),
    preco,
    sku: p.sku || '',
    link: p.permalink || '',
    img,
    categorias: cats,
    estoque: p.is_in_stock !== false,
  };
}

// Resolve a URL crua que o lojista colou para o endpoint Store API de products.
// Aceita: domínio, home, página de loja, ou o próprio endpoint já pronto.
// Retorna null se a URL for inválida ou não-http(s).
function resolveBase(raw) {
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    try {
      u = new URL('https://' + raw.trim());
    } catch {
      return null;
    }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // se já é um endpoint da Store API, usa como veio (só garante /products)
  if (u.pathname.includes('/wp-json/')) {
    let base = u.origin + u.pathname.replace(/\/+$/, '');
    if (!/\/products$/.test(base)) {
      base = base.replace(/\/wc\/store(\/v\d+)?.*$/, '/wc/store/v1/products');
      if (!/\/products$/.test(base)) base = u.origin + '/wp-json/wc/store/v1/products';
    }
    return { base, host: u.host };
  }
  // qualquer outra URL: assume WooCommerce padrão na raiz do domínio
  return { base: u.origin + '/wp-json/wc/store/v1/products', host: u.host };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');

    let BASE = DEFAULT_BASE;
    let parceiro = DEFAULT_PARCEIRO;
    let fonte = DEFAULT_FONTE;
    let custom = false;

    if (rawUrl) {
      const r = resolveBase(rawUrl);
      if (!r) {
        return Response.json(
          { ok: false, error: 'URL inválida', veiculos: [] },
          { status: 400 }
        );
      }
      BASE = r.base;
      parceiro = r.host.replace(/^www\./, '');
      fonte = 'https://' + r.host;
      custom = true;
    }

    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE}?per_page=${PER}&page=${page}`;
      const r = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!r.ok) break;
      const arr = await r.json().catch(() => []);
      if (!Array.isArray(arr) || !arr.length) break;
      for (const p of arr) {
        const v = normaliza(p);
        if (v.preco > 0 && v.estoque) out.push(v);
      }
      if (arr.length < PER) break;
    }

    if (custom && !out.length) {
      return Response.json(
        {
          ok: false,
          custom: true,
          parceiro,
          error:
            'Não encontrei produtos nessa loja. Confira se o link é de uma loja WooCommerce com a Store API pública.',
          veiculos: [],
        },
        { status: 422 }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        custom,
        parceiro,
        fonte,
        atualizado: new Date().toISOString(),
        total: out.length,
        veiculos: out,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': custom
            ? 's-maxage=120, stale-while-revalidate=600'
            : 's-maxage=600, stale-while-revalidate=1800',
        },
      }
    );
  } catch (e) {
    return Response.json({ ok: false, error: String(e), veiculos: [] }, { status: 502 });
  }
}
