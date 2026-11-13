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
  search: { term: '', results: [], errors: [], selected: new Set(), loading: false },
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
document.querySelectorAll('.tabs button').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $('tab-favs').hidden = tab.dataset.tab !== 'favs';
    $('tab-radar').hidden = tab.dataset.tab !== 'radar';
    $('tab-search').hidden = tab.dataset.tab !== 'search';
    $('tab-coupons').hidden = tab.dataset.tab !== 'coupons';
  }),
);

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
  const stores = [...new Set(state.coupons.map((c) => c.store))].sort();
  $('coupon-stores').innerHTML = ['', ...stores]
    .map((s) => {
      const count = s ? state.coupons.filter((c) => c.store === s).length : state.coupons.length;
      return `<button type="button" class="filter" data-store="${escapeHtml(s)}" aria-pressed="${String((state.couponStore || '') === s)}">${escapeHtml(s || 'Todas')} (${count})</button>`;
    })
    .join('');

  const list = filteredCoupons();
  $('coupon-list').innerHTML = list.length
    ? list
        .map(
          (c) => `<article class="panel coupon">
            <div class="coupon-head">
              <span class="code">${escapeHtml(c.code)}</span>
              <button class="btn" type="button" data-copy="${escapeHtml(c.code)}">Copiar</button>
              <span class="store">${escapeHtml(c.store)}</span>
            </div>
            <p>${escapeHtml(c.text)}</p>
            <div class="meta">
              <span>Visto ${timeAgo(c.lastSeen)}${c.seenCount > 1 ? ` · ${c.seenCount}× nos canais` : ''}</span>
              <span>${escapeHtml(c.channel)}</span>
              <a class="btn-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">Ver o post</a>
            </div>
          </article>`,
        )
        .join('')
    : `<p class="panel empty">${state.coupons.length ? 'Nenhum cupom com esse filtro.' : 'Nenhum cupom ainda — eles aparecem conforme os canais postam.'}</p>`;
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
$('search-stores').textContent = STORES.map((s) => s.name).join(', ');
const storeName = (id) => STORES.find((s) => s.id === id)?.name || id;

$('search-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const term = $('search-input').value.replace(/\s+/g, ' ').trim();
  if (term.length < 2) return toast('Digite o que você procura.', true);
  state.search = { term, results: [], errors: [], selected: new Set(), loading: true };
  renderSearch();
  $('btn-search').disabled = true;
  try {
    const token = await state.user.getIdToken();
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    state.search.results = body.results || [];
    state.search.errors = body.errors || [];
  } catch (err) {
    console.error('Erro na busca:', err);
    toast(`A busca falhou: ${err.message}`, true);
  } finally {
    state.search.loading = false;
    $('btn-search').disabled = false;
    renderSearch();
  }
});

$('search-only-relevant').addEventListener('change', renderSearch);

function visibleResults() {
  const onlyRelevant = $('search-only-relevant').checked;
  return state.search.results.filter((r) => !onlyRelevant || (r.relevant && r.available));
}

function resultHtml(r, isBest) {
  const fav = state.favorites.some((f) => f.productKey === r.productKey);
  const checked = state.search.selected.has(r.productKey);
  const price = r.available
    ? `<span class="price">${brl(r.price)}</span> <span class="sub">à vista${r.priceCard ? ` · ${brl(r.priceCard)} cartão` : ''}${r.listPrice ? ` · <s>${brl(r.listPrice)}</s>` : ''}</span>`
    : '<span class="sub">Sem estoque</span>';
  return `<article class="panel result${r.relevant && r.available ? '' : ' dim'}">
    <input type="checkbox" data-select="${escapeHtml(r.productKey)}" ${checked ? 'checked' : ''} ${fav || !r.available ? 'disabled' : ''} aria-label="Marcar ${escapeHtml(r.title)}">
    <div class="thumb" ${r.image ? `style="background-image:url('${escapeHtml(r.image)}')"` : ''} role="img" aria-label=""></div>
    <div>
      <div class="card-top">
        <h3>${escapeHtml(r.title)}</h3>
        <span class="store">${escapeHtml(r.storeName || storeName(r.store))}</span>
      </div>
      <div class="prices">${price}</div>
      <div class="meta">
        ${isBest ? '<span class="badge best">Mais barato</span>' : ''}
        ${fav ? '<span class="badge">Já nos favoritos</span>' : ''}
        ${r.relevant ? '' : '<span class="badge">Parece acessório ou outro produto</span>'}
        ${r.seller ? `<span>Vendido por ${escapeHtml(r.seller)}</span>` : ''}
        <a class="btn-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">Abrir na loja</a>
      </div>
    </div>
  </article>`;
}

function renderSearch() {
  const { term, loading, errors, selected } = state.search;
  $('search-head').hidden = !term;
  $('search-title').textContent = term ? `Resultados para "${term}"` : '';
  if (loading) {
    $('search-info').textContent = '';
    $('search-results').innerHTML = '<p class="empty">Buscando nas lojas…</p>';
    $('search-actions').hidden = true;
    $('search-errors').hidden = true;
    return;
  }
  const list = visibleResults();
  const hidden = state.search.results.length - list.length;
  $('search-info').textContent = term ? `${list.length} resultado(s)${hidden ? ` · ${hidden} escondido(s)` : ''}` : '';
  const bestKey = list.find((r) => r.relevant && r.available)?.productKey;
  $('search-results').innerHTML = !term
    ? ''
    : list.length
      ? list.map((r) => resultHtml(r, r.productKey === bestKey)).join('')
      : '<p class="panel empty">Nada encontrado. Tente outras palavras ou desmarque "Esconder acessórios".</p>';
  $('search-errors').hidden = !errors.length;
  $('search-errors').textContent = errors.length ? `⚠️ Não consegui consultar: ${errors.map((e) => e.storeName).join(', ')}.` : '';
  $('search-actions').hidden = !term;
  $('btn-follow').textContent = selected.size ? `⭐ Acompanhar ${selected.size} marcado(s)` : '⭐ Acompanhar marcados';
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
  if (target == null) return toast('Informe o preço que você pagaria, ex.: 2.500,00.', true);
  const { term, results, selected } = state.search;

  if (mode === 'alert') {
    if (state.searchAlerts.some((a) => normalizeTerm(a.term) === normalizeTerm(term))) {
      return toast('Já existe um alerta para essa busca — altere a meta dele abaixo.', true);
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
      },
      (err) => {
        console.error('Erro ao ler alertas por busca:', err);
        $('search-alerts').innerHTML = '<p class="panel empty">Não consegui carregar os alertas. Recarregue a página.</p>';
      },
    );
}

function searchAlertHtml(a) {
  const checked = toDate(a.checkedAt);
  let best;
  if (a.best) {
    best = `<div class="prices"><span class="price">${brl(a.best.price)}</span> <span class="sub">na ${escapeHtml(a.best.storeName)} · <a href="${escapeHtml(a.best.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.best.title)}</a></span></div>`;
  } else if (checked) {
    best = '<span class="sub">Nenhuma loja tem agora.</span>';
  } else {
    best = `<span class="status wait">Aguardando a 1ª busca (${CHECK_INTERVAL_TEXT})</span>`;
  }
  let status = '';
  if (a.best) {
    status = a.best.price <= a.targetPrice ? '<span class="status ok">🎯 Na sua meta!</span>' : `<span class="status gap">Faltam ${brl(a.best.price - a.targetPrice)}</span>`;
  }
  return `<article class="panel">
    <div class="card-top"><h3>🔔 ${escapeHtml(a.term)}</h3><span class="store">meta ${brl(a.targetPrice)}</span></div>
    ${best}
    ${status}
    <div class="meta">
      ${checked ? `<span>Conferido ${timeAgo(checked)}</span>` : ''}
      ${a.lastError ? `<span>⚠️ ${escapeHtml(a.lastError)}</span>` : ''}
    </div>
    <div class="actions">
      <button class="btn-link" type="button" data-alert-action="edit" data-id="${a.id}">Alterar meta</button>
      <button class="btn-link" type="button" data-alert-action="remove" data-id="${a.id}">Remover</button>
    </div>
  </article>`;
}

function renderSearchAlerts() {
  const alerts = [...state.searchAlerts].sort((a, b) => a.term.localeCompare(b.term));
  $('search-alerts').innerHTML = alerts.length
    ? alerts.map(searchAlertHtml).join('')
    : '<p class="panel empty">Nenhum ainda. Busque um produto acima e use "Avisar quando qualquer loja tiver".</p>';
}

$('search-alerts').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-alert-action]');
  if (!btn) return;
  const alert = state.searchAlerts.find((a) => a.id === btn.dataset.id);
  if (!alert) return;
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

// ---------- renderização ----------
function statusOf(f) {
  if (f.lastError && !f.lastCheckedAt) return { cls: 'err', text: `Não consegui ler: ${f.lastError}` };
  if (!f.lastCheckedAt) return { cls: 'wait', text: `Aguardando a 1ª verificação (${CHECK_INTERVAL_TEXT})` };
  if (f.available === false) return { cls: 'err', text: 'Sem estoque' };
  const gap = f.price - f.targetPrice;
  if (gap <= 0) return { cls: 'ok', text: '🎯 Na sua meta!' };
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
  const y = (v) => (max === min ? 20 : 38 - ((v - min) / (max - min)) * 34);
  const line = pts.map((p) => `${(((p.t - t0) / span) * 100).toFixed(2)},${y(p.p).toFixed(2)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label="Histórico de preço, de ${brl(Math.min(...pts.map((p) => p.p)))} a ${brl(Math.max(...pts.map((p) => p.p)))}">
    <line class="target" x1="0" x2="100" y1="${y(f.targetPrice)}" y2="${y(f.targetPrice)}"></line>
    <polyline class="line" points="${line}"></polyline></svg>`;
}

function cardHtml(f) {
  const st = statusOf(f);
  const store = STORES.find((s) => s.id === f.store)?.name || f.store;
  const checked = toDate(f.lastCheckedAt);
  const lowest = f.lowestPrice != null ? `Menor: ${brl(f.lowestPrice)}` : '';
  const errorLine = f.lastError && f.lastCheckedAt ? `<span>⚠️ Última leitura falhou: ${escapeHtml(f.lastError)}</span>` : '';
  const prices = f.lastCheckedAt
    ? `<div class="prices"><span class="price">${brl(f.price)}</span>
        <span class="sub">à vista${f.priceCard ? ` · ${brl(f.priceCard)} cartão` : ''}${f.listPrice ? ` · <s>${brl(f.listPrice)}</s>` : ''}</span></div>`
    : '';
  return `<article class="panel card">
    <div class="thumb" ${f.image ? `style="background-image:url('${escapeHtml(f.image)}')"` : ''} role="img" aria-label=""></div>
    <div>
      <div class="card-top">
        <h3>${escapeHtml(f.title || f.url)}</h3>
        <span class="store">${escapeHtml(store)}</span>
      </div>
      ${f.group ? `<div class="group">Grupo: ${escapeHtml(f.group)}</div>` : ''}
      ${prices}
      <span class="status ${st.cls}">${escapeHtml(st.text)}</span>
      <div class="meta">
        <span>Meta: <b>${brl(f.targetPrice)}</b></span>
        ${lowest ? `<span>${lowest}</span>` : ''}
        ${checked ? `<span>Verificado ${timeAgo(checked)}</span>` : ''}
        ${errorLine}
      </div>
      ${sparkline(f)}
      <div class="actions">
        <a class="btn-link" href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">Abrir na loja</a>
        <button class="btn-link" type="button" data-action="edit" data-id="${f.id}">Alterar meta</button>
        <button class="btn-link" type="button" data-action="remove" data-id="${f.id}">Remover</button>
      </div>
    </div>
  </article>`;
}

function render() {
  const favs = [...state.favorites].sort((a, b) => sortScore(a) - sortScore(b));
  const inTarget = favs.filter((f) => f.lastCheckedAt && f.price <= f.targetPrice).length;
  $('list-info').textContent = favs.length ? `${favs.length} produto(s)${inTarget ? ` · ${inTarget} na meta` : ''}` : '';
  $('list').innerHTML = favs.length
    ? favs.map(cardHtml).join('')
    : '<p class="panel empty">Nenhum favorito ainda. Cole o link de um produto acima para começar.</p>';
}

$('stores').innerHTML =
  STORES.map((s) => `<span class="chip on">✓ ${s.name}</span>`).join('') +
  COMING_SOON.map((c) => `<span class="chip">${c.name} · em breve</span>`).join('');

// Atualiza o "verificado há X" sem precisar recarregar.
setInterval(() => state.favorites.length && render(), 60000);
