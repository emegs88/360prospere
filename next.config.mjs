/** @type {import('next').NextConfig} */
const nextConfig = {
  // CORS para as APIs públicas de dados consumidas pela bidcon (projeto/domínio
  // separado). Só libera os endpoints de leitura de catálogo — não as rotas internas.
  async headers() {
    return [
      {
        source: '/api/:path(imoveis|estoque|fipe)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        // cotas.js é servido de /public; também precisa de CORS pra leitura cross-origin
        source: '/cotas.js',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ];
  },
};
export default nextConfig;
