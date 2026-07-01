export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache real fica no CDN via header

// JSON-LD (schema.org ItemList/Product) das cotas contempladas disponíveis,
// pré-renderizado no servidor pra cobertura em IA/AI Overviews (SSR real, não
// depende de JS no cliente). Espelha exatamente o que já aparece no card do
// bidcon público: tipo, crédito (poder de compra), entrada (preço pra assumir),
// situação (Contemplada) e administradora (decisão do dono — visível a todos).
//
// NÃO expõe mecânica interna (taxa/fundo/comissão/custo efetivo). Só o factual
// já público.
//
// Agrega as MESMAS duas fontes que a vitrine pública (bidcon.html) usa:
//   - Lance Consórcio (via FONTE) — mesma normalização do /api/cotas.
//   - /api/cotas-extra (CBC + Piffer + Cartas) — já sanitizado (sem comissão).
// Antes o schema cobria só a Lance/HS (~5% do estoque); agora reflete o
// catálogo real de administradoras exibido ao cliente.
const FONTE = 'https://contempladas.lanceconsorcio.com.br/';
const SITE = 'https://www.bidcon.com.br';
// teto de segurança pro tamanho do JSON-LD (estoque real ~1.135; folga ampla)
const MAX_ITENS = 2000;

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

// busca a Lance e devolve cotas normalizadas {t,c,e,[adm]} (só disponíveis).
async function puxaLance() {
  try {
    const r = await fetch(FONTE, {
      headers: { Accept: 'application/json', 'User-Agent': 'Prospere360/1.0' },
      cache: 'no-store',
    });
    if (!r.ok) return [];
    const arr = await r.json().catch(() => null);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(normaliza)
      .filter((a) => a.n > 0 && a.c > 0 && a.r !== 1)
      .map((a) => ({ t: a.t, c: a.c, e: a.e, adm: a.adm }));
  } catch (e) {
    return [];
  }
}

// busca o /api/cotas-extra (payload já público/sanitizado) e mapeia pro mesmo
// formato {t,c,e,[adm]}. `base` = origin do próprio request.
async function puxaExtra(base) {
  try {
    const r = await fetch(base + '/api/cotas-extra', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    const cotas = j && Array.isArray(j.cotas) ? j.cotas : [];
    return cotas
      .filter((o) => Number(o.c) > 0)
      .map((o) => {
        const a = { t: o.t === 'imovel' ? 'imovel' : 'veiculo', c: Number(o.c), e: Number(o.e) || 0 };
        const adm = String(o.adm || '').trim();
        if (adm) a.adm = adm;
        return a;
      });
  } catch (e) {
    return [];
  }
}

// "R$ 26.329"
function BRL(a) {
  return 'R$ ' + Math.round(a).toLocaleString('pt-BR');
}

// monta o Product schema.org a partir de uma cota normalizada.
// `ts` = timestamp ISO da resposta da API (frescura de dado), um por produto.
function produto(a, ts) {
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
    dateModified: ts,
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

export async function GET(request) {
  try {
    // origin do próprio deploy — pra chamar /api/cotas-extra no mesmo host.
    const base = new URL(request.url).origin;

    // agrega as duas fontes em paralelo; cada uma tolera falha isoladamente.
    const [lance, extra] = await Promise.all([puxaLance(), puxaExtra(base)]);
    let disp = [...lance, ...extra].filter((a) => a && a.c > 0);

    // se as DUAS fontes falharem, devolve lista vazia com 502.
    if (disp.length === 0) {
      return Response.json(
        { '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: 0, itemListElement: [] },
        { status: 502 }
      );
    }

    // timestamp da resposta da API — frescura de dado, um por produto
    const ts = new Date().toISOString();

    // ordena por crédito desc (cartas de maior valor primeiro) e aplica o teto.
    disp = disp.sort((a, b) => b.c - a.c).slice(0, MAX_ITENS);

    const itemListElement = disp.map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: produto(a, ts),
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
