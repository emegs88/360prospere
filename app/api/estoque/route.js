export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache fica no CDN via header

// Proxy do estoque do parceiro (Unimais Veículos / WooCommerce Store API).
// Roda no servidor pra contornar CORS e normalizar os dados pro front.
const BASE = 'https://unimaisveiculos.com.br/wp-json/wc/store/v1/products';
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

export async function GET() {
  try {
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
    return new Response(
      JSON.stringify({
        ok: true,
        parceiro: 'Unimais Veículos',
        fonte: 'https://unimaisveiculos.com.br/estoque/',
        atualizado: new Date().toISOString(),
        total: out.length,
        veiculos: out,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 's-maxage=600, stale-while-revalidate=1800',
        },
      }
    );
  } catch (e) {
    return Response.json({ ok: false, error: String(e), veiculos: [] }, { status: 502 });
  }
}
