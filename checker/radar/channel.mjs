import { USER_AGENT } from '../lib/http.mjs';

// Lê a página pública de um canal (t.me/s/<canal>), que mostra os ~20 posts mais recentes.
// Só funciona para canais públicos com @; grupos e canais privados não têm essa página.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<i class="emoji"[^>]*><b>(.*?)<\/b><\/i>/gi, '$1')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function parseChannelPage(html, channel) {
  const posts = [];
  const blocks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const block of blocks) {
    const ref = block.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!ref) continue;
    const textHtml = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
    const links = [...textHtml.matchAll(/<a[^>]+href="([^"]+)"/g)]
      .map((m) => decodeEntities(m[1]))
      .filter((u) => /^https?:\/\//.test(u) && !/^https?:\/\/t\.me\//.test(u));
    posts.push({
      channel: ref[1] || channel,
      id: Number(ref[2]),
      url: `https://t.me/${ref[1]}/${ref[2]}`,
      text: htmlToText(textHtml),
      links: [...new Set(links)],
      photo: block.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/)?.[1] || null,
      date: block.match(/<time datetime="([^"]+)"/)?.[1] || null,
    });
  }
  return posts.sort((a, b) => a.id - b.id);
}

// Busca para trás (?before=) até alcançar o último post já visto, para não pular nada em canal muito ativo.
export async function fetchChannelSince(channel, lastSeenId, maxPages = 4) {
  const first = await fetchChannel(channel);
  const all = new Map(first.posts.map((p) => [p.id, p]));
  let oldest = first.posts[0]?.id;
  for (let page = 1; lastSeenId != null && oldest > lastSeenId + 1 && page < maxPages; page++) {
    const older = await fetchChannel(channel, oldest);
    if (!older.posts.length) break;
    for (const p of older.posts) all.set(p.id, p);
    if (older.posts[0].id >= oldest) break;
    oldest = older.posts[0].id;
  }
  return { title: first.title, posts: [...all.values()].sort((a, b) => a.id - b.id) };
}

export async function fetchChannel(channel, beforeId) {
  const qs = beforeId ? `?before=${beforeId}` : '';
  const res = await fetch(`https://t.me/s/${encodeURIComponent(channel)}${qs}`, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'pt-BR' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`t.me respondeu ${res.status}`);
  const html = await res.text();
  const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || channel);
  return { title, posts: parseChannelPage(html, channel) };
}
