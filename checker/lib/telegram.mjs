export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// options.button = { text, url } vira um botão abaixo da mensagem;
// options.previewUrl escolhe qual link gera a prévia com imagem.
export async function sendTelegram({ telegramToken, telegramChatId }, html, options = {}) {
  const body = { chat_id: telegramChatId, text: html, parse_mode: 'HTML' };
  if (options.button) body.reply_markup = { inline_keyboard: [[options.button]] };
  if (options.previewUrl) body.link_preview_options = { url: options.previewUrl, prefer_large_media: true };
  const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(`Telegram recusou a mensagem: ${out.description}`);
}
