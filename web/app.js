'use strict';

// Lojas que o verificador já sabe ler (manter igual a checker/stores/index.mjs).
// Lojas VTEX: link de produto termina em /<slug>/p.
const vtexStore = (id, name, host) => ({
  id,
  name,
  productKey(url) {
    try {
      const u = new URL(url);
      if (u.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) return null;
      return u.pathname.match(/^\/([^/]+)\/p\/?$/)?.[1];
    } catch {
      return null;
    }
  },
});
const STORES = [
  { id: 'kabum', name: 'KaBuM!', productKey: (url) => url.match(/^https:\/\/(www\.)?kabum\.com\.br\/produto\/(\d+)/i)?.[2] },
  vtexStore('americanas', 'Americanas', 'www.americanas.com.br'),
  vtexStore('brastemp', 'Brastemp', 'www.brastemp.com.br'),
  vtexStore('consul', 'Consul', 'www.consul.com.br'),
  vtexStore('electrolux', 'Electrolux', 'loja.electrolux.com.br'),
  vtexStore('lojasmm', 'Lojas MM', 'www.lojasmm.com'),
  vtexStore('copag', 'COPAG', 'www.copagloja.com.br'),
];
// Lojas previstas ou bloqueadas, para dar uma mensagem clara em vez de "link inválido".
const COMING_SOON = [
  { name: 'Mercado Livre', re: /mercadoli(vre|bre)\.com|meli\.la/i },
  { name: 'Shopee', re: /shopee\.com/i },
  { name: 'Amazon', re: /amazon\.com|amzn\.to/i },
  { name: 'Magalu', re: /magazineluiza\.com|magazinevoce\.com|magalu\.com/i },
  { name: 'AliExpress', re: /aliexpress\./i },
];
const CHECK_INTERVAL_TEXT = 'em até 30 minutos';

firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  favorites: [],
  unsubscribe: null,
  editingId: null,
  editingKind: 'favorites',
  searchAlerts: [],
  searchAlertsUnsubscribe: null,
  radar: { terms: [], channels: [] },
  radarUnsubscribe: null,
  watches: [],
  watchesUnsubscribe: null,
  coupons: [],
  couponStore: null,
  couponsUnsubscribe: null,
};

// ---------- utilidades ----------
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

function parseBRL(text) {
  const clean = String(text).replace(/[^\d,.]/g, '');
  if (!clean) return null;
  // "1.299,90" e "1299,90" → vírgula é decimal; "1299.90" → ponto é decimal.
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function timeAgo(date) {
  if (!date) return '';
  const min = Math.round((Date.now() - date.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dia(s)`;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 3500);
}

function identifyStore(url) {
  for (const s of STORES) {
    const id = s.productKey(url);
    if (id) return { store: s, productKey: `${s.id}:${decodeURIComponent(id)}` };
  }
  const coming = COMING_SOON.find((c) => c.re.test(url));
  return { comingSoon: coming?.name };
}

// ---------- login ----------
auth.onAuthStateChanged((user) => {
  state.user = user;
  $('login-view').hidden = !!user;
  $('app-view').hidden = !user;
  $('user-box').hidden = !user;
  $('navbar').hidden = !user;
  $('search-form').hidden = !user;
  if (state.unsubscribe) state.unsubscribe();
  for (const key of ['unsubscribe', 'radarUnsubscribe', 'couponsUnsubscribe', 'watchesUnsubscribe', 'searchAlertsUnsubscribe']) {
    if (state[key]) state[key]();
    state[key] = null;
  }
  if (!user) return;
  $('user-name').textContent = user.displayName || user.email;
  $('user-photo').src = user.photoURL || '';
  $('user-photo').hidden = !user.photoURL;
  listenFavorites();
  listenRadar();
  listenWatches();
  listenCoupons();
  listenSearchAlerts();
});

// ---------- abas ----------
function showTab(name) {
  document.querySelectorAll('.tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  for (const id of ['search', 'favs', 'coupons', 'radar']) $(`tab-${id}`).hidden = id !== name;
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('.tabs [data-tab]').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

$('logo-link').addEventListener('click', (ev) => {
  ev.preventDefault();
  clearSearch();
  showTab('search');
});

function setCount(id, n) {
  $(id).textContent = n;
  $(id).hidden = !n;
}

// ---------- cupons ----------
function listenCoupons() {
  state.couponsUnsubscribe = db
    .collection('coupons')
    .doc('recent')
    .onSnapshot(
      (snap) => {
        state.coupons = (snap.data()?.items || []).map((c) => ({ ...c, lastSeen: toDate(c.lastSeen), firstSeen: toDate(c.firstSeen) }));
        renderCoupons();
      },
      (err) => {
        console.error('Erro ao ler cupons:', err);
        $('coupon-list').innerHTML = '<p class="panel empty">Não consegui carregar os cupons. Recarregue a página.</p>';
      },
    );
}

function filteredCoupons() {
  const words = normalizeTerm($('coupon-search').value).split(/\s+/).filter(Boolean);
  return state.coupons.filter((c) => {
    if (state.couponStore && c.store !== state.couponStore) return false;
    const haystack = normalizeTerm(`${c.code} ${c.store} ${c.text} ${c.channel}`);
    return words.every((w) => haystack.includes(w));
  });
}

function renderCoupons() {
  setCount('count-coupons', state.coupons.length);
  const stores = [...new Set(state.coupons.map((c) => c.store))].sort();
  $('coupon-stores').innerHTML = ['', ...stores]
    .map((s) => {
      const count = s ? state.coupons.filter((c) => c.store === s).length : state.coupons.length;
      return `<button type="button" class="chip-btn" data-store="${escapeHtml(s)}" aria-pressed="${String((state.couponStore || '') === s)}">${escapeHtml(s || 'Todas as lojas')} <span class="n">${count}</span></button>`;
    })
    .join('');

  const list = filteredCoupons();
  $('coupon-list').innerHTML = list.length
    ? list
        .map(
          (c) => `<article class="ticket">
            <div class="ticket-code">
              <div>
                <div class="store">${escapeHtml(c.store)}</div>
                <div class="code">${escapeHtml(c.code)}</div>
              </div>
              <button class="btn btn-primary btn-sm" type="button" data-copy="${escapeHtml(c.code)}">Copiar</button>
            </div>
            <div class="ticket-body">
              <p>${escapeHtml(c.text)}</p>
              <div class="row-actions">
                <span>Visto ${timeAgo(c.lastSeen)}${c.seenCount > 1 ? ` · ${c.seenCount}× nos canais` : ''}</span>
                <span>${escapeHtml(c.channel)}</span>
                <a class="btn-link spacer" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">Ver o post ↗</a>
              </div>
            </div>
          </article>`,
        )
        .join('')
    : `<div class="panel empty" style="grid-column:1/-1">${state.coupons.length ? '<b>Nenhum cupom com esse filtro</b>Tente outra palavra ou outra loja.' : '<b>Nenhum cupom ainda</b>Eles aparecem aqui conforme os canais postam.'}</div>`;
}

$('coupon-search').addEventListener('input', renderCoupons);

$('tab-coupons').addEventListener('click', async (ev) => {
  const filter = ev.target.closest('[data-store]');
  if (filter) {
    state.couponStore = filter.dataset.store || null;
    return renderCoupons();
  }
  const copy = ev.target.closest('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast(`Cupom ${copy.dataset.copy} copiado.`);
    } catch (err) {
      console.error('Erro ao copiar:', err);
      toast('Não consegui copiar — selecione o código e copie manualmente.', true);
    }
  }
});

// ---------- radar ----------
const radarDoc = () => db.collection('settings').doc('radar');
const normalizeTerm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function listenRadar() {
  state.radarUnsubscribe = radarDoc().onSnapshot(
    (snap) => {
      const data = snap.data() || {};
      state.radar = { terms: data.terms || [], channels: data.channels || [] };
      renderRadar();
      if (!state.search.term) renderSuggestions();
    },
    (err) => {
      console.error('Erro ao ler o radar:', err);
      toast('Não consegui carregar o Radar. Recarregue a página.', true);
    },
  );
}

async function saveRadar(next, okMessage) {
  try {
    await radarDoc().set({ terms: next.terms, channels: next.channels, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast(okMessage);
    return true;
  } catch (err) {
    console.error('Erro ao salvar o radar:', err);
    toast('Não consegui salvar. Tente de novo.', true);
    return false;
  }
}

function parseChannel(input) {
  const raw = input.trim().replace(/^@/, '');
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([A-Za-z0-9_]+)/i);
  const name = m ? m[1] : raw;
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name : null;
}

function renderRadar() {
  $('terms').innerHTML = state.radar.terms
    .map((t, i) => `<span class="tag">${escapeHtml(t)}<button type="button" data-remove-term="${i}" aria-label="Remover ${escapeHtml(t)}">×</button></span>`)
    .join('');
  $('channels').innerHTML = state.radar.channels
    .map(
      (c, i) =>
        `<span class="tag"><a href="https://t.me/${escapeHtml(c)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(c)}</a><button type="button" data-remove-channel="${i}" aria-label="Remover ${escapeHtml(c)}">×</button></span>`,
    )
    .join('');
}

$('term-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const term = $('term-input').value.replace(/\s+/g, ' ').trim();
  if (!/[a-z0-9]/i.test(normalizeTerm(term).replace(/-\S+/g, ''))) return toast('Digite pelo menos uma palavra que precisa aparecer.', true);
  if (state.radar.terms.some((t) => normalizeTerm(t) === normalizeTerm(term))) return toast('Esse termo já está na lista.', true);
  if (await saveRadar({ ...state.radar, terms: [...state.radar.terms, term] }, `Termo "${term}" adicionado.`)) $('term-input').value = '';
});

$('channel-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = parseChannel($('channel-input').value);
  if (!name) return toast('Não reconheci o canal. Cole o link t.me/… ou o @ do canal.', true);
  if (/bot$/i.test(name)) return toast('Isso é um bot, não um canal — bots não têm página pública para ler.', true);
  if (state.radar.channels.some((c) => c.toLowerCase() === name.toLowerCase())) return toast('Esse canal já está na lista.', true);
  if (await saveRadar({ ...state.radar, channels: [...state.radar.channels, name] }, `Canal @${name} adicionado.`)) $('channel-input').value = '';
});

$('tab-radar').addEventListener('click', async (ev) => {
  const termBtn = ev.target.closest('[data-remove-term]');
  const chanBtn = ev.target.closest('[data-remove-channel]');
  if (termBtn) {
    const i = Number(termBtn.dataset.removeTerm);
    await saveRadar({ ...state.radar, terms: state.radar.terms.filter((_, j) => j !== i) }, 'Termo removido.');
  }
  if (chanBtn) {
    const i = Number(chanBtn.dataset.removeChannel);
    await saveRadar({ ...state.radar, channels: state.radar.channels.filter((_, j) => j !== i) }, 'Canal removido.');
  }
});

// ---------- novidades nas lojas ----------
// Lojas cuja busca o robô sabe ler (catálogo público VTEX — checker/stores/vtex.mjs).
const WATCH_STORES = [
  ['copag', 'COPAG'],
  ['americanas', 'Americanas'],
  ['brastemp', 'Brastemp'],
  ['consul', 'Consul'],
  ['electrolux', 'Electrolux'],
  ['lojasmm', 'Lojas MM'],
];
const watchStoreName = (id) => WATCH_STORES.find(([s]) => s === id)?.[1] || id;
const watchesDoc = () => db.collection('settings').doc('watches');
$('watch-store').innerHTML = WATCH_STORES.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');

function listenWatches() {
  state.watchesUnsubscribe = watchesDoc().onSnapshot(
    (snap) => {
      state.watches = snap.data()?.items || [];
      renderWatches();
    },
    (err) => {
      console.error('Erro ao ler as novidades:', err);
      toast('Não consegui carregar as novidades nas lojas. Recarregue a página.', true);
    },
  );
}

async function saveWatches(items, okMessage) {
  try {
    await watchesDoc().set({ items, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast(okMessage);
    return true;
  } catch (err) {
    console.error('Erro ao salvar as novidades:', err);
    toast('Não consegui salvar. Tente de novo.', true);
    return false;
  }
}

function renderWatches() {
  $('watches').innerHTML = state.watches
    .map(
      (w, i) =>
        `<span class="tag">${escapeHtml(watchStoreName(w.store))} · ${escapeHtml(w.term)}<button type="button" data-remove-watch="${i}" aria-label="Remover ${escapeHtml(w.term)}">×</button></span>`,
    )
    .join('');
}

$('watch-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const store = $('watch-store').value;
  const term = $('watch-term').value.replace(/\s+/g, ' ').trim();
  if (term.length < 2) return toast('Digite o que buscar na loja.', true);
  if (state.watches.some((w) => w.store === store && normalizeTerm(w.term) === normalizeTerm(term))) return toast('Essa busca já está na lista.', true);
  if (await saveWatches([...state.watches, { store, term }], `Acompanhando "${term}" na ${watchStoreName(store)}.`)) $('watch-term').value = '';
});

$('watches').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-remove-watch]');
  if (!btn) return;
  const i = Number(btn.dataset.removeWatch);
  await saveWatches(state.watches.filter((_, j) => j !== i), 'Busca removida.');
});

$('btn-login').addEventListener('click', async () => {
  $('login-error').textContent = '';
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (err) {
    console.error('Erro no login:', err);
    $('login-error').textContent = err.code === 'auth/popup-closed-by-user' ? 'Login cancelado.' : 'Não foi possível entrar. Tente de novo.';
  }
});

$('btn-logout').addEventListener('click', () => auth.signOut());

// ---------- favoritos ----------
function listenFavorites() {
  $('list').innerHTML = '<p class="empty">Carregando…</p>';
  state.unsubscribe = db
    .collection('favorites')
    .where('uid', '==', state.user.uid)
    .onSnapshot(
      (snap) => {
        state.favorites = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
        if (state.search.term) renderSearch();
      },
      (err) => {
        console.error('Erro ao ler favoritos:', err);
        $('list').innerHTML =
          err.code === 'permission-denied'
            ? '<p class="empty">Esta conta Google não tem acesso. Entre com a conta autorizada.</p>'
            : '<p class="empty">Não consegui carregar seus favoritos. Recarregue a página.</p>';
      },
    );
}

$('add-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const url = $('add-url').value.trim();
  const target = parseBRL($('add-target').value);

  if (!/^https:\/\//i.test(url)) return toast('Cole o link completo do produto (começando com https://).', true);
  const found = identifyStore(url);
  if (!found.store) {
    return toast(
      found.comingSoon
        ? `${found.comingSoon} ainda não está liberado — por enquanto só ${STORES.map((s) => s.name).join(', ')}.`
        : 'Não reconheci esse link. Use o link da página de um produto.',
      true,
    );
  }
  if (target == null) return toast('Informe o preço que você pagaria, ex.: 899,90.', true);
  if (state.favorites.some((f) => f.productKey === found.productKey)) return toast('Esse produto já está nos favoritos.', true);

  const btn = $('btn-add');
  btn.disabled = true;
  try {
    await db.collection('favorites').add({
      uid: state.user.uid,
      url,
      store: found.store.id,
      productKey: found.productKey,
      targetPrice: target,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    $('add-form').reset();
    toast(`Adicionado! O preço aparece ${CHECK_INTERVAL_TEXT} e eu te aviso no Telegram.`);
  } catch (err) {
    console.error('Erro ao salvar favorito:', err);
    toast('Não consegui salvar. Tente de novo.', true);
  } finally {
    btn.disabled = false;
  }
});

$('list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const fav = state.favorites.find((f) => f.id === btn.dataset.id);
  if (!fav) return;

  if (btn.dataset.action === 'edit') {
    state.editingId = fav.id;
    state.editingKind = 'favorites';
    $('target-input').value = fav.targetPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    $('target-dialog').showModal();
  }
  if (btn.dataset.action === 'remove') {
    if (!confirm(`Remover "${fav.title || fav.url}" dos favoritos?`)) return;
    try {
      await db.collection('favorites').doc(fav.id).delete();
      toast('Removido.');
    } catch (err) {
      console.error('Erro ao remover favorito:', err);
      toast('Não consegui remover. Tente de novo.', true);
    }
  }
});

$('target-dialog').addEventListener('close', async () => {
  if ($('target-dialog').returnValue !== 'save' || !state.editingId) return;
  const id = state.editingId;
  state.editingId = null;
  const target = parseBRL($('target-input').value);
  if (target == null) return toast('Valor inválido. Use algo como 899,90.', true);
  try {
    await db.collection(state.editingKind).doc(id).update({ targetPrice: target });
    toast('Meta atualizada.');
  } catch (err) {
    console.error('Erro ao alterar meta:', err);
    toast('Não consegui alterar a meta. Tente de novo.', true);
  }
});

// ---------- busca em várias lojas ----------
const storeName = (id) => STORES.find((s) => s.id === id)?.name || id;
const emptySearch = () => ({ term: '', results: [], errors: [], selected: new Set(), loading: false, store: null, sort: 'price' });
state.search = emptySearch();

$('search-store-count').textContent = STORES.length;
$('search-stores').innerHTML =
  STORES.map((s) => `<span class="store-logo">${escapeHtml(s.name)}</span>`).join('') +
  COMING_SOON.map((c) => `<span class="store-logo soon" title="Ainda não liberada">${escapeHtml(c.name)} · em breve</span>`).join('');

const discountOf = (r) => (r.listPrice > r.price ? Math.round((1 - r.price / r.listPrice) * 100) : 0);
const productImage = (src, alt = '') =>
  src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="noimg" aria-hidden="true">🛍️</div>';

async function runSearch(term) {
  state.search = { ...emptySearch(), term, loading: true, sort: $('search-sort').value };
  $('search-input').value = term;
  showTab('search');
  renderSearch();
  $('btn-search').disabled = true;
  try {
    const token = await state.user.getIdToken();
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    // Busca limpa enquanto esperava a resposta: descarta.
    if (state.search.term !== term) return;
    state.search.results = body.results || [];
    state.search.errors = body.errors || [];
  } catch (err) {
    console.error('Erro na busca:', err);
    toast(`A busca falhou: ${err.message}`, true);
  } finally {
    if (state.search.term === term) state.search.loading = false;
    $('btn-search').disabled = false;
    renderSearch();
  }
}

function clearSearch() {
  state.search = { ...emptySearch(), sort: $('search-sort').value };
  $('search-input').value = '';
  $('search-target').value = '';
  renderSearch();
}

$('search-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const term = $('search-input').value.replace(/\s+/g, ' ').trim();
  if (term.length < 2) return toast('Digite o que você procura.', true);
  runSearch(term);
});
$('search-input').addEventListener('input', () => ($('search-clear').hidden = !$('search-input').value && !state.search.term));
$('search-clear').addEventListener('click', () => {
  clearSearch();
  $('search-input').focus();
});
$('search-reset').addEventListener('click', () => {
  clearSearch();
  window.scrollTo({ top: 0 });
  $('search-input').focus();
});
$('search-only-relevant').addEventListener('change', renderSearch);
$('search-sort').addEventListener('change', () => {
  state.search.sort = $('search-sort').value;
  renderSearch();
});
$('search-filters').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-store]');
  if (!btn) return;
  state.search.store = btn.dataset.store || null;
  renderSearch();
});
$('search-suggest').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-term]');
  if (btn) runSearch(btn.dataset.term);
});

function baseResults() {
  const onlyRelevant = $('search-only-relevant').checked;
  return state.search.results.filter((r) => !onlyRelevant || (r.relevant && r.available));
}

function sortResults(list) {
  const { sort } = state.search;
  const byAvail = (a, b) => Number(b.available) - Number(a.available) || Number(b.relevant) - Number(a.relevant);
  const cmp = {
    price: (a, b) => byAvail(a, b) || a.price - b.price,
    'price-desc': (a, b) => byAvail(a, b) || b.price - a.price,
    discount: (a, b) => byAvail(a, b) || discountOf(b) - discountOf(a) || a.price - b.price,
  }[sort];
  return [...list].sort(cmp);
}

function resultHtml(r, isBest) {
  const fav = state.favorites.some((f) => f.productKey === r.productKey);
  const checked = state.search.selected.has(r.productKey);
  const off = discountOf(r);
  const id = `pick-${r.productKey.replace(/[^a-z0-9]/gi, '-')}`;
  const price = r.available
    ? `${r.listPrice ? `<s>${brl(r.listPrice)}</s>` : ''}
       <div class="now">${brl(r.price)}</div>
       <div class="how">${r.priceCard ? `<b>à vista no Pix</b> · ou ${brl(r.priceCard)} no cartão` : 'à vista'}</div>`
    : '<div class="out">Indisponível no momento</div>';
  let pickLabel = '+ <span>Marcar</span>';
  if (fav) pickLabel = '✓ <span>Favorito</span>';
  else if (checked) pickLabel = '✓ <span>Marcado</span>';
  return `<article class="pcard${checked ? ' selected' : ''}${r.relevant && r.available ? '' : ' dim'}">
    <div class="pimg">
      ${productImage(r.image, r.title)}
      <div class="pbadges">
        ${isBest ? '<span class="badge best">Mais barato</span>' : ''}
        ${off >= 5 ? `<span class="badge off">-${off}%</span>` : ''}
        ${r.relevant ? '' : '<span class="badge muted">Outro produto?</span>'}
      </div>
      <div class="pick">
        <input type="checkbox" id="${id}" data-select="${escapeHtml(r.productKey)}" ${checked || fav ? 'checked' : ''} ${fav || !r.available ? 'disabled' : ''}>
        <label for="${id}" title="Marcar para acompanhar">${pickLabel}</label>
      </div>
    </div>
    <div class="pbody">
      <div class="pstore"><b>${escapeHtml(r.storeName || storeName(r.store))}</b>${r.seller ? `<span>vendido por ${escapeHtml(r.seller)}</span>` : ''}</div>
      <h3 class="ptitle" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</h3>
      <div class="pprice">${price}</div>
      <a class="btn btn-sm" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">Ver na loja ↗</a>
    </div>
  </article>`;
}

function renderSuggestions() {
  const terms = [...new Set([...state.searchAlerts.map((a) => a.term), ...state.radar.terms.filter((t) => !t.includes('-'))])].slice(0, 10);
  $('search-suggest-wrap').hidden = !terms.length;
  $('search-suggest').innerHTML = terms.map((t) => `<button type="button" class="chip-btn" data-term="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
}

function renderSearch() {
  const { term, loading, errors, selected } = state.search;
  $('search-hero').hidden = Boolean(term);
  $('search-results-wrap').hidden = !term;
  $('search-actions').hidden = !term || loading;
  $('search-clear').hidden = !term && !$('search-input').value;
  if (!term) {
    renderSuggestions();
    return;
  }

  if (loading) {
    $('search-title').innerHTML = `Buscando "${escapeHtml(term)}"…`;
    $('search-filters').innerHTML = '';
    $('search-errors').hidden = true;
    $('search-results').innerHTML = '<div class="panel empty" style="grid-column:1/-1"><b>Consultando as lojas…</b>Leva só alguns segundos.</div>';
    return;
  }

  const base = baseResults();
  const stores = [...new Set(base.map((r) => r.storeName || storeName(r.store)))].sort();
  if (state.search.store && !stores.includes(state.search.store)) state.search.store = null;
  $('search-filters').innerHTML = stores.length > 1
    ? ['', ...stores]
        .map((s) => {
          const n = s ? base.filter((r) => (r.storeName || storeName(r.store)) === s).length : base.length;
          return `<button type="button" class="chip-btn" data-store="${escapeHtml(s)}" aria-pressed="${String((state.search.store || '') === s)}">${escapeHtml(s || 'Todas')} <span class="n">${n}</span></button>`;
        })
        .join('')
    : '';

  const list = sortResults(base.filter((r) => !state.search.store || (r.storeName || storeName(r.store)) === state.search.store));
  const hidden = state.search.results.length - base.length;
  $('search-title').innerHTML = `"${escapeHtml(term)}" <span>${list.length} oferta(s)${hidden ? ` · ${hidden} escondida(s)` : ''}</span>`;
  const cheapest = base.filter((r) => r.relevant && r.available).sort((a, b) => a.price - b.price)[0]?.productKey;
  $('search-results').innerHTML = list.length
    ? list.map((r) => resultHtml(r, r.productKey === cheapest)).join('')
    : '<div class="panel empty" style="grid-column:1/-1"><b>Nada encontrado</b>Tente outras palavras ou desmarque "Esconder acessórios".</div>';
  $('search-errors').hidden = !errors.length;
  $('search-errors').textContent = errors.length ? `⚠️ Não consegui consultar agora: ${errors.map((e) => e.storeName).join(', ')}.` : '';

  $('sel-info').innerHTML = selected.size
    ? `${selected.size} produto(s) marcado(s)<small>Defina quanto pagaria e acompanhe todos com a mesma meta</small>`
    : 'Gostou de algo?<small>Marque produtos para acompanhar, ou crie um alerta para a busca inteira</small>';
  $('btn-follow').textContent = selected.size ? `Acompanhar ${selected.size}` : 'Acompanhar marcados';
}

$('search-results').addEventListener('change', (ev) => {
  const box = ev.target.closest('[data-select]');
  if (!box) return;
  if (box.checked) state.search.selected.add(box.dataset.select);
  else state.search.selected.delete(box.dataset.select);
  renderSearch();
});

$('search-actions').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const mode = ev.submitter?.dataset.mode;
  const target = parseBRL($('search-target').value);
  if (target == null) {
    $('search-target').focus();
    return toast('Informe o preço que você pagaria, ex.: 2.500,00.', true);
  }
  const { term, results, selected } = state.search;

  if (mode === 'alert') {
    if (state.searchAlerts.some((a) => normalizeTerm(a.term) === normalizeTerm(term))) {
      return toast('Já existe um alerta para essa busca — altere a meta dele mais abaixo.', true);
    }
    try {
      await db.collection('searchAlerts').add({ uid: state.user.uid, term, targetPrice: target, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast(`Alerta criado. Confiro "${term}" em todas as lojas ${CHECK_INTERVAL_TEXT}.`);
    } catch (err) {
      console.error('Erro ao criar alerta:', err);
      toast('Não consegui criar o alerta. Tente de novo.', true);
    }
    return;
  }

  const chosen = results.filter((r) => selected.has(r.productKey));
  if (!chosen.length) return toast('Marque os produtos que quer acompanhar.', true);
  // Vários marcados viram um grupo com a mesma meta; cada um continua sendo conferido na sua loja.
  const group = chosen.length > 1 ? term : null;
  let saved = 0;
  for (const r of chosen) {
    try {
      await db.collection('favorites').add({
        uid: state.user.uid,
        url: r.url,
        store: r.store,
        productKey: r.productKey,
        targetPrice: target,
        ...(group && { group }),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      saved++;
    } catch (err) {
      console.error('Erro ao salvar favorito:', err);
    }
  }
  state.search.selected = new Set();
  renderSearch();
  if (saved === chosen.length) toast(`${saved} produto(s) nos favoritos com meta ${brl(target)}.`);
  else toast(`Salvei ${saved} de ${chosen.length}. Tente de novo os que faltaram.`, true);
});

// ---------- alertas por busca ----------
function listenSearchAlerts() {
  state.searchAlertsUnsubscribe = db
    .collection('searchAlerts')
    .where('uid', '==', state.user.uid)
    .onSnapshot(
      (snap) => {
        state.searchAlerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderSearchAlerts();
        if (!state.search.term) renderSuggestions();
      },
      (err) => {
        console.error('Erro ao ler alertas por busca:', err);
        $('search-alerts').innerHTML = '<div class="panel empty">Não consegui carregar os alertas. Recarregue a página.</div>';
      },
    );
}

function searchAlertHtml(a) {
  const checked = toDate(a.checkedAt);
  let best;
  if (a.best) {
    best = `<a class="best" href="${escapeHtml(a.best.url)}" target="_blank" rel="noopener noreferrer">
      ${a.best.image ? `<img src="${escapeHtml(a.best.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div><div class="now">${brl(a.best.price)}</div><div class="what">${escapeHtml(a.best.storeName)} · ${escapeHtml(a.best.title)}</div></div>
    </a>`;
  } else if (checked) {
    best = '<span class="pill wait">Nenhuma loja tem agora</span>';
  } else {
    best = `<span class="pill wait">Aguardando a 1ª busca (${CHECK_INTERVAL_TEXT})</span>`;
  }
  let status = '';
  if (a.best) {
    status = a.best.price <= a.targetPrice ? '<span class="pill ok">🎯 Na sua meta</span>' : `<span class="pill gap">Faltam ${brl(a.best.price - a.targetPrice)}</span>`;
  }
  return `<article class="panel acard">
    <div class="acard-top"><h3>${escapeHtml(a.term)}</h3><span class="target">meta <b>${brl(a.targetPrice)}</b></span></div>
    ${best}
    <div>${status}${checked ? `<span class="when">conferido ${timeAgo(checked)}</span>` : ''}</div>
    ${a.lastError ? `<div class="error">⚠️ ${escapeHtml(a.lastError)}</div>` : ''}
    <div class="card-links">
      <button class="btn-link" type="button" data-alert-action="search" data-id="${a.id}">Ver resultados</button>
      <span>
        <button class="btn-link" type="button" data-alert-action="edit" data-id="${a.id}">Alterar meta</button>
        &nbsp;·&nbsp;
        <button class="btn-link danger" type="button" data-alert-action="remove" data-id="${a.id}">Remover</button>
      </span>
    </div>
  </article>`;
}

function renderSearchAlerts() {
  const alerts = [...state.searchAlerts].sort((a, b) => a.term.localeCompare(b.term));
  $('search-alerts').innerHTML = alerts.length
    ? alerts.map(searchAlertHtml).join('')
    : '<div class="panel empty" style="grid-column:1/-1"><b>Nenhum alerta ainda</b>Busque um produto e use "Alerta para esta busca".</div>';
}

$('search-alerts').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-alert-action]');
  if (!btn) return;
  const alert = state.searchAlerts.find((a) => a.id === btn.dataset.id);
  if (!alert) return;
  if (btn.dataset.alertAction === 'search') runSearch(alert.term);
  if (btn.dataset.alertAction === 'edit') {
    state.editingId = alert.id;
    state.editingKind = 'searchAlerts';
    $('target-input').value = alert.targetPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    $('target-dialog').showModal();
  }
  if (btn.dataset.alertAction === 'remove') {
    if (!confirm(`Remover o alerta "${alert.term}"?`)) return;
    try {
      await db.collection('searchAlerts').doc(alert.id).delete();
      toast('Alerta removido.');
    } catch (err) {
      console.error('Erro ao remover alerta:', err);
      toast('Não consegui remover. Tente de novo.', true);
    }
  }
});

// ---------- renderização dos favoritos ----------
function statusOf(f) {
  if (f.lastError && !f.lastCheckedAt) return { cls: 'err', text: `Não consegui ler: ${f.lastError}` };
  if (!f.lastCheckedAt) return { cls: 'wait', text: `Aguardando a 1ª verificação` };
  if (f.available === false) return { cls: 'err', text: 'Sem estoque' };
  const gap = f.price - f.targetPrice;
  if (gap <= 0) return { cls: 'ok', text: '🎯 Na sua meta' };
  return { cls: 'gap', text: `Faltam ${brl(gap)} (${Math.round((gap / f.price) * 100)}%)` };
}

function sortScore(f) {
  if (!f.lastCheckedAt) return 2;
  return f.price <= f.targetPrice ? -1 : (f.price - f.targetPrice) / f.price;
}

function sparkline(f) {
  const pts = (f.history || []).map((h) => ({ t: toDate(h.t).getTime(), p: h.p }));
  if (pts.length < 2) return '';
  const values = pts.map((p) => p.p).concat(f.targetPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const t0 = pts[0].t;
  const span = pts[pts.length - 1].t - t0 || 1;
  const y = (v) => (max === min ? 20 : 36 - ((v - min) / (max - min)) * 32);
  const line = pts.map((p) => `${(((p.t - t0) / span) * 100).toFixed(2)},${y(p.p).toFixed(2)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Histórico de preço, de ${brl(Math.min(...pts.map((p) => p.p)))} a ${brl(Math.max(...pts.map((p) => p.p)))}; linha tracejada é a meta">
    <line class="target" x1="0" x2="100" y1="${y(f.targetPrice)}" y2="${y(f.targetPrice)}"></line>
    <polyline class="line" points="${line}"></polyline></svg>`;
}

function cardHtml(f) {
  const st = statusOf(f);
  const store = STORES.find((s) => s.id === f.store)?.name || f.store;
  const checked = toDate(f.lastCheckedAt);
  const off = f.listPrice > f.price ? Math.round((1 - f.price / f.listPrice) * 100) : 0;
  const price = f.lastCheckedAt && f.available !== false
    ? `${f.listPrice ? `<s>${brl(f.listPrice)}</s>` : ''}
       <div class="now">${brl(f.price)}</div>
       <div class="how">${f.priceCard ? `<b>à vista no Pix</b> · ou ${brl(f.priceCard)} no cartão` : 'à vista'}</div>`
    : '';
  return `<article class="pcard fcard">
    <div class="pimg">
      ${productImage(f.image, f.title || '')}
      <div class="pbadges">
        ${off >= 5 ? `<span class="badge off">-${off}%</span>` : ''}
      </div>
    </div>
    <div class="pbody">
      <div class="pstore"><b>${escapeHtml(store)}</b>${checked ? `<span>conferido ${timeAgo(checked)}</span>` : ''}</div>
      ${f.group ? `<div class="group">${escapeHtml(f.group)}</div>` : ''}
      <h3 class="ptitle" title="${escapeHtml(f.title || f.url)}">${escapeHtml(f.title || f.url)}</h3>
      <div class="pprice">${price}</div>
      <div><span class="pill ${st.cls}">${escapeHtml(st.text)}</span></div>
      <div class="facts">
        <span>Meta <b>${brl(f.targetPrice)}</b></span>
        ${f.lowestPrice != null ? `<span>Menor visto <b>${brl(f.lowestPrice)}</b></span>` : ''}
      </div>
      ${sparkline(f)}
      ${f.lastError && f.lastCheckedAt ? `<div class="error">⚠️ Última leitura falhou: ${escapeHtml(f.lastError)}</div>` : ''}
      <a class="btn btn-sm" href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">Ver na loja ↗</a>
      <div class="card-links">
        <button class="btn-link" type="button" data-action="edit" data-id="${f.id}">Alterar meta</button>
        <button class="btn-link danger" type="button" data-action="remove" data-id="${f.id}">Remover</button>
      </div>
    </div>
  </article>`;
}

function render() {
  const favs = [...state.favorites].sort((a, b) => sortScore(a) - sortScore(b));
  const inTarget = favs.filter((f) => f.lastCheckedAt && f.price <= f.targetPrice && f.available !== false).length;
  setCount('count-favs', favs.length);
  $('list-info').innerHTML = favs.length
    ? `<div class="stat"><b>${favs.length}</b><span>acompanhando</span></div><div class="stat${inTarget ? ' good' : ''}"><b>${inTarget}</b><span>na meta</span></div>`
    : '';
  $('add-panel').open = !favs.length;
  $('list').innerHTML = favs.length
    ? favs.map(cardHtml).join('')
    : '<div class="panel empty" style="grid-column:1/-1"><b>Nenhum favorito ainda</b>Busque um produto e marque o que quer acompanhar, ou cole o link acima.</div>';
}

$('stores').innerHTML =
  STORES.map((s) => `<span class="on">✓ ${escapeHtml(s.name)}</span>`).join('') +
  COMING_SOON.map((c) => `<span>${escapeHtml(c.name)} · em breve</span>`).join('');

// Atualiza o "conferido há X" sem precisar recarregar.
setInterval(() => state.favorites.length && render(), 60000);
