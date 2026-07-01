export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache real fica no CDN via header

// JSON-LD (schema.org ItemList/Product) das cotas contempladas disponíveis,
// pré-renderizado no servidor pra cobertura em IA/AI Overviews (SSR real, não
// depende de JS no cliente). Espelha exatamente o que já aparece no card do
// bidcon público: tipo, crédito (poder de compra), entrada (preço pra assumir),
// situação (Contemplada) e administradora (decisão do dono — visível a todos).
//
// NÃO expõe mecânica interna (taxa/fundo/comissão/custo efetivo). Só o factual
// já público. Mesma fonte e normalização do /api/cotas (Lance Consórcio).
const FONTE = 'https://contempladas.lanceconsorcio.com.br/';
const SITE = 'https://www.bidcon.com.br';

// "1.709.569,00" -> 1709569 (Number)
function numBR(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function tipoDe(categoria) {
  return /im[oó]vel|imovel/i.test(String(categoria)) ? 'imovel' : 'veiculo';
}

function isReservada(reserva) {
  return /reserv/i.test(String(reserva));
}

// mesma normalização do /api/cotas
function normaliza(o) {
  const n = Number(o.id) || 0;
  const c = numBR(o.valor_credito);
  const e = numBR(o.entrada);
  const co = { n, t: tipoDe(o.categoria), c, e };
  const adm = String(o.administradora || '').trim();
  if (adm) co.adm = adm;
  if (isReservada(o.reserva)) co.r = 1;
  return co;
}

// "R$ 26.329"
function BRL(a) {
  return 'R$ ' + Math.round(a).toLocaleString('pt-BR');
}

// monta o Product schema.org a partir de uma cota normalizada
function produto(a) {
  const rotulo = a.t === 'imovel' ? 'Imóvel' : 'Veículo';
  const prop = [
    { '@type': 'PropertyValue', name: 'Poder de compra (carta de crédito)', value: BRL(a.c) },
    { '@type': 'PropertyValue', name: 'Entrada para assumir', value: BRL(a.e) },
    { '@type': 'PropertyValue', name: 'Situação', value: 'Contemplada' },
  ];
  if (a.adm) prop.push({ '@type': 'PropertyValue', name: 'Administradora', value: a.adm });
  return {
    '@type': 'Product',
    name: 'Carta de crédito contemplada — ' + rotulo + ' ' + BRL(a.c),
    category: rotulo,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'BRL',
      price: Math.round(a.e),
      availability: 'https://schema.org/InStock',
      itemOffered: {
        '@type': 'Service',
        name: 'Assunção de cota de consórcio já contemplada',
      },
    },
    additionalProperty: prop,
  };
}

export async function GET() {
  try {
    const r = await fetch(FONTE, {
      headers: { Accept: 'application/json', 'User-Agent': 'Prospere360/1.0' },
      cache: 'no-store',
    });
    if (!r.ok) {
      return Response.json(
        { '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: 0, itemListElement: [] },
        { status: 502 }
      );
    }
    const arr = await r.json().catch(() => null);
    if (!Array.isArray(arr)) {
      return Response.json(
        { '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: 0, itemListElement: [] },
        { status: 502 }
      );
    }

    // só disponíveis, com crédito válido (mesma regra do bidcon público)
    const disp = arr
      .map(normaliza)
      .filter((a) => a.n > 0 && a.c > 0 && a.r !== 1)
      .slice(0, 60);

    const itemListElement = disp.map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: produto(a),
    }));

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Cotas de consórcio contempladas disponíveis na Bidcon',
      url: SITE,
      numberOfItems: itemListElement.length,
      itemListElement,
    };

    return new Response(JSON.stringify(schema), {
      status: 200,
      headers: {
        'content-type': 'application/ld+json; charset=utf-8',
        'cache-control': 's-maxage=180, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    return Response.json(
      { '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: 0, itemListElement: [] },
      { status: 502 }
    );
  }
}
