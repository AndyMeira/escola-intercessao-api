export default async function handler(req, res) {
  // Libera acesso vindo do site no GitHub Pages
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

  try {
    const { model, body } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Tenta a chamada até 3 vezes no total (1 tentativa original + 2 novas tentativas).
    // Isso resolve o erro "high demand" (503), que costuma ser passageiro.
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

      // Considera "alta demanda" quando o status é 503, ou quando o texto
      // do erro menciona demanda/sobrecarga (o Gemini varia a mensagem).
      const mensagemErro = JSON.stringify(data.error || '').toLowerCase();
      const altaDemanda = response.status === 503 ||
        mensagemErro.includes('overloaded') ||
        mensagemErro.includes('high demand');

      if (response.ok || !altaDemanda) {
        // Deu certo, ou o erro não é de alta demanda (não adianta tentar de novo)
        break;
      }

      if (tentativa < maxTentativas) {
        // Espera um pouco antes de tentar de novo (1s, depois 2s)
        await new Promise(resolve => setTimeout(resolve, tentativa * 1000));
      }
    }

    res.status(ultimaResposta.status).json(ultimoDado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
