export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // executa a cada request; cache real no CDN via header

// Fonte SERVOPA (parceria exclusiva) — via API JSON, NÃO scraper.
// Estrutura diferente das fontes do /api/cotas-extra (single-admin, paginada),
// por isso mora em rota própria e fica FORA do dedup cross-fonte (estoque
// exclusivo, não vem de sitedeconsorcio.com — não duplica CBC/PIFFER/CARTAS).
//
// Regra de comissão (igual às outras fontes externas, DIFERENTE da Lance):
//   Bidcon soma 7% do crédito na entrada -> entrada_cliente = entrada_parceiro + 7%*credito.
//   entrada_parceiro (valor CRU do parceiro) NUNCA vai no payload público (Opção B):
//   é o número que a Servopa reconhece, usado só na confirmação interna. Só aparece
//   em ?admin=1. Mesmo sigilo do nome de administradora e da mecânica de margem (§1.3).
//
// Saída pública por carta: { id, fonte, t, c, e, p, x, adm }
//   e = entrada_cliente (com 7%). entrada_parceiro só em ?admin=1.

const API = 'https://cartascontempladasservopa.com.br/api/cartas.php';
const COMISSAO = 0.07; // 7% sobre o crédito, somado na entrada
const LIMIT = 24; // itens por página da API
const MAX_PAGINAS = 30; // trava de segurança (hoje são ~14); evita loop infinito
const ADM = 'SERVOPA'; // fonte single-admin

// fetch tolerante de uma página
async function puxaPagina(page) {
  const url = `${API}?order=recentes&page=${page}&limit=${LIMIT}`;
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Prospere360/1.0)',
      },
      cache: 'no-store',
    });
    if (!r.ok) return { ok: false, status: r.status, cartas: [], hasMore: false };
    const j = await r.json();
    const cartas = (j && j.data && Array.isArray(j.data.cartas)) ? j.data.cartas : [];
    const hasMore = !!(j && j.data && j.data.pagination && j.data.pagination.has_more);
    return { ok: true, status: 200, cartas, hasMore };
  } catch (e) {
    return { ok: false, status: 0, erro: String(e), cartas: [], hasMore: false };
  }
}

// paginação: segue enquanto has_more, respeitando a trava MAX_PAGINAS
async function puxaTodas() {
  const todas = [];
  let page = 1;
  let okAlguma = false;
  let ultimoStatus = 0;
  while (page <= MAX_PAGINAS) {
    const res = await puxaPagina(page);
    ultimoStatus = res.status;
    if (res.ok) okAlguma = true;
    if (res.cartas.length) todas.push(...res.cartas);
    if (!res.ok || !res.hasMore || res.cartas.length === 0) break;
    page += 1;
  }
  return { ok: okAlguma, status: ultimoStatus, paginas: page, cartas: todas };
}

function tipoDe(slug) {
  return String(slug) === 'imovel' ? 'imovel' : 'veiculo';
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tipoReq = searchParams.get('tipo'); // ?tipo=imovel|veiculo
    // painel interno: expõe entrada_parceiro (valor cru p/ confirmar com a Servopa).
    // NUNCA no payload público — Opção B (§1.3).
    const admReq = searchParams.get('admin') === '1';

    const res = await puxaTodas();

    const cotas = res.cartas
      .filter((o) => num(o.credito) > 0)
      .map((o, i) => {
        const c = num(o.credito);
        const entradaParceiro = num(o.entrada); // valor CRU do parceiro
        const comissao = Math.round(c * COMISSAO);
        const entradaCliente = Math.round(entradaParceiro + comissao); // com 7%
        const x = Number(o.prazo) || 0;
        const p = num(o.parcela);
        const t = tipoDe(o.tipo_slug);
        const carta = {
          id: i + 1,
          fonte: ADM,
          t,
          c,
          e: entradaCliente, // entrada exibida ao cliente (já com comissão)
          p,
          x,
          adm: ADM, // single-admin (visível para todos, como as outras fontes)
        };
        // Campos internos só no painel (?admin=1). Ambos NUNCA no payload público:
        //  - entrada_parceiro: valor cru do parceiro (Opção B, §1.3).
        //  - idParceiro (ref): a Servopa é fonte EXCLUSIVA com página própria por ref
        //    (cartascontempladasservopa.com.br/cartas/<ref>). Ref público = qualquer um
        //    pega o número no card da Bidcon e vai direto no parceiro — mesmo bypass que
        //    já fechamos pra administradora. Como aqui a fonte é única, o risco persiste.
        if (admReq) {
          carta.idParceiro = o.ref;
          carta.entrada_parceiro = Math.round(entradaParceiro);
        }
        return carta;
      });

    const filtradas =
      tipoReq === 'imovel' || tipoReq === 'veiculo'
        ? cotas.filter((c) => c.t === tipoReq)
        : cotas;

    return new Response(
      JSON.stringify({
        ok: res.ok,
        atualizado: new Date().toISOString(),
        fonte: ADM,
        total: filtradas.length,
        imovel: filtradas.filter((c) => c.t === 'imovel').length,
        veiculo: filtradas.filter((c) => c.t === 'veiculo').length,
        paginasLidas: res.paginas,
        cotas: filtradas,
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
    return new Response(
      JSON.stringify({ ok: false, erro: String(e), cotas: [] }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  }
}
