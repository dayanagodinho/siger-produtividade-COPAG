// Envio de e-mail pelo Resend, com fetch (Node 18+ ja tem). Sem RESEND_API_KEY
// e EMAIL_REMETENTE no ambiente, nao envia e diz o motivo; o aviso continua
// gravado no painel, entao nada se perde.
async function enviarEmail({ para, assunto, texto }) {
  const chave = process.env.RESEND_API_KEY;
  const de = process.env.EMAIL_REMETENTE;
  const destinos = (Array.isArray(para) ? para : [para]).filter(Boolean);
  if (!chave || !de) return { enviado: false, motivo: 'RESEND_API_KEY ou EMAIL_REMETENTE nao definidos' };
  if (!destinos.length) return { enviado: false, motivo: 'sem destinatario' };
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: de, to: destinos, subject: assunto, text: texto }),
  });
  if (!resposta.ok) throw new Error(`Resend respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 200)}`);
  return { enviado: true, para: destinos };
}

module.exports = { enviarEmail };
