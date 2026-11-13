export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export async function sendTelegram({ telegramToken, telegramChatId }, html) {
  const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramChatId, text: html, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram recusou a mensagem: ${body.description}`);
}
