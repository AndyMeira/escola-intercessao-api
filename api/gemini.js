export default async function handler(req, res) {
  // Libera acesso vindo do site no GitHub Pages
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chave GEMINI_API_KEY não configurada no Vercel.' });
  }

  // Segurança: só aceita pedidos de quem estiver logado de verdade no site
  // (verifica o token de sessão do Supabase antes de gastar cota do Gemini).
  const SUPABASE_URL = "https://xmlspowbfzbptldtferl.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_TCe91nYvgglwoFCeCyDm4Q_a05Lxa0R";

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado. Faça login para usar o chat.' });
  }

  try {
    const userCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY
      }
    });

    if (!userCheck.ok) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Não foi possível verificar sua sessão.' });
  }

  try {
    const { model, body } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const maxTentativas = 3;
    let ultimaResposta, ultimoDado;

    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      ultimaResposta = response;
      ultimoDado = data;

      const mensagemErro = JSON.stringify(data.error || '').toLowerCase();
      const altaDemanda = response.status === 503 ||
        mensagemErro.includes('overloaded') ||
        mensagemErro.includes('high demand');

      if (response.ok || !altaDemanda) {
        break;
      }

      if (tentativa < maxTentativas) {
        await new Promise(resolve => setTimeout(resolve, tentativa * 1000));
      }
    }

    res.status(ultimaResposta.status).json(ultimoDado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
