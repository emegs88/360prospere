export const runtime = 'nodejs';
export const revalidate = 86400; // 24h — tabela FIPE muda 1x/mês

// Proxy da API FIPE pública (parallelum). Contorna CORS e padroniza a resposta.
// Uso:
//   /api/fipe                      -> marcas
//   /api/fipe?marca=21             -> modelos da marca
//   /api/fipe?marca=21&modelo=437  -> anos do modelo
//   /api/fipe?marca=21&modelo=437&ano=1987-1 -> preço (valor)
const FIPE = 'https://parallelum.com.br/fipe/api/v1/carros/marcas';

async function get(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 86400 } });
  if (!r.ok) throw new Error('fipe ' + r.status);
  return r.json();
}

const num = (s) => Number(String(s || '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const marca = searchParams.get('marca');
    const modelo = searchParams.get('modelo');
    const ano = searchParams.get('ano');

    let data;
    if (!marca) {
      const arr = await get(FIPE);
      data = { tipo: 'marcas', itens: arr.map((m) => ({ codigo: m.codigo, nome: m.nome })) };
    } else if (!modelo) {
      const r = await get(`${FIPE}/${marca}/modelos`);
      data = { tipo: 'modelos', itens: (r.modelos || []).map((m) => ({ codigo: m.codigo, nome: m.nome })) };
    } else if (!ano) {
      const arr = await get(`${FIPE}/${marca}/modelos/${modelo}/anos`);
      data = { tipo: 'anos', itens: arr.map((a) => ({ codigo: a.codigo, nome: a.nome })) };
    } else {
      const v = await get(`${FIPE}/${marca}/modelos/${modelo}/anos/${ano}`);
      data = {
        tipo: 'valor',
        valor: num(v.Valor),
        valorTexto: v.Valor,
        marca: v.Marca,
        modelo: v.Modelo,
        anoModelo: v.AnoModelo,
        combustivel: v.Combustivel,
        codigoFipe: v.CodigoFipe,
        referencia: v.MesReferencia,
      };
    }

    return new Response(JSON.stringify({ ok: true, ...data }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 's-maxage=86400, stale-while-revalidate=172800',
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
