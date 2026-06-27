export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache real fica no CDN via header

// Proxy/normalizador da carteira de cotas contempladas da Lance Consórcio.
// Roda no servidor pra contornar CORS e entregar ao front (cerebro/bidcon) os
// mesmos campos do antigo cotas.js — porém SEMPRE em tempo real:
//   - reservou na Lance  -> sai da lista de disponíveis
//   - entrou cota nova   -> aparece sozinha
//
// Fonte oficial (JSON): https://contempladas.lanceconsorcio.com.br/
// Campos da fonte: id, categoria, valor_credito, entrada, parcelas,
//                  administradora, valor_parcela, reserva ("Reservada"|"Disponível"),
//                  taxa, fundo
const FONTE = 'https://contempladas.lanceconsorcio.com.br/';
const WHATSAPP = '5519997561909';

// "1.709.569,00" / "324.797,76" -> 1709569 / 324797.76  (Number)
function numBR(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// categoria da Lance -> tipo interno usado no cotas.js ('imovel' | 'veiculo')
function tipoDe(categoria) {
  return /im[oó]vel|imovel/i.test(String(categoria)) ? 'imovel' : 'veiculo';
}

// status -> reservada?
function isReservada(reserva) {
  return /reserv/i.test(String(reserva));
}

// Normaliza um item da Lance para o formato interno (mesmas chaves do cotas.js).
function normaliza(o) {
  const n = Number(o.id) || 0;
  const c = numBR(o.valor_credito);
  const e = numBR(o.entrada);
  const x = Number(o.parcelas) || 0;
  const p = numBR(o.valor_parcela);
  const co = { n, t: tipoDe(o.categoria), c, e, p, x };
  if (isReservada(o.reserva)) co.r = 1; // marcador de reserva (mesma convenção do cotas.js)
  return co;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    // ?incluir=reservadas devolve TODAS (com r:1 nas reservadas) — útil pro painel interno.
    // padrão: só as disponíveis (o que vai pro bidcon público).
    const incluirReservadas = searchParams.get('incluir') === 'reservadas';

    const r = await fetch(FONTE, {
      headers: { Accept: 'application/json', 'User-Agent': 'Prospere360/1.0' },
      cache: 'no-store',
    });
    if (!r.ok) {
      return Response.json(
        { ok: false, error: 'Fonte Lance indisponível (HTTP ' + r.status + ')', cotas: [] },
        { status: 502 }
      );
    }
    const arr = await r.json().catch(() => null);
    if (!Array.isArray(arr)) {
      return Response.json(
        { ok: false, error: 'Resposta da Lance não é uma lista', cotas: [] },
        { status: 502 }
      );
    }

    const todas = arr.map(normaliza).filter((co) => co.n > 0 && co.c > 0);
    const reservadas = todas.filter((co) => co.r === 1).length;
    const disponiveis = todas.filter((co) => co.r !== 1);
    const cotas = incluirReservadas ? todas : disponiveis;

    return new Response(
      JSON.stringify({
        ok: true,
        fonte: FONTE,
        whatsapp: WHATSAPP,
        atualizado: new Date().toISOString(),
        total_fonte: todas.length,
        reservadas,
        disponiveis: disponiveis.length,
        total: cotas.length,
        cotas,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // cache curto no CDN: respostas frescas a cada ~3min, revalida em background até 10min
          'cache-control': 's-maxage=180, stale-while-revalidate=600',
        },
      }
    );
  } catch (e) {
    return Response.json({ ok: false, error: String(e), cotas: [] }, { status: 502 });
  }
}
