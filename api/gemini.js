export default async function handler(req, res) {
  // Libera acesso vindo do site no GitHub Pages
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Método não permitido' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Chave GEMINI_API_KEY não configurada no Vercel.' } });
  }

  const SUPABASE_URL = "https://xmlspowbfzbptldtferl.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_TCe91nYvgglwoFCeCyDm4Q_a05Lxa0R";

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: { message: 'Não autenticado. Faça login para usar o chat.' } });
  }

  let userId;

  // 1. Segurança: Verifica se o token é válido e pega o ID do usuário
  try {
    const userCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY
      }
    });

    if (!userCheck.ok) {
      return res.status(401).json({ error: { message: 'Sessão inválida ou expirada. Faça login novamente.' } });
    }
    
    // Captura os dados do usuário para pegar o ID
    const userData = await userCheck.json();
    userId = userData.id;
  } catch (e) {
    return res.status(401).json({ error: { message: 'Não foi possível verificar sua sessão.' } });
  }

  // 2. Trava de Segurança: Checar limite de 75 mensagens por dia
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); // Pega desde a meia-noite de hoje
    const dataIso = hoje.toISOString();

    // Fazemos um pedido "HEAD" com preferência "count=exact". 
    // É muito mais rápido porque não baixa o conteúdo das mensagens, só a contagem.
    const limiteCheck = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?user_id=eq.${userId}&role=eq.user&created_at=gte.${dataIso}`, {
      method: 'HEAD', 
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Prefer': 'count=exact'
      }
    });

    const range = limiteCheck.headers.get('content-range');
    let totalMensagens = 0;
    
    if (range) {
      // O formato do range é "0-0/75" (início-fim/total)
      totalMensagens = parseInt(range.split('/')[1], 10) || 0;
    }

    if (totalMensagens >= 75) {
      return res.status(429).json({ 
        error: { message: 'Você atingiu o limite de 75 mensagens por dia. Volte amanhã para continuar aprendendo! 🙏' } 
      });
    }
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erro ao verificar o limite de uso diário.' } });
  }

  // 3. Chamada à API do Gemini
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
    res.status(500).json({ error: { message: e.message } });
  }
}
