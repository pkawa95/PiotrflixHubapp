/* ====== NAWIGACJA — izolowany JS ====== */
(function(){
  const root = document.getElementById('nawigacja');
  if(!root) return;

  const btns = Array.from(root.querySelectorAll('.nawigacja__btn'));
  const STORAGE_KEY = 'nawigacja:lastSection';

function setActive(section){
  btns.forEach(b=>{
    const active = b.dataset.section === section;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // pokaż/ukryj prawdziwe panele w <main>
  document.querySelectorAll('#content > section').forEach(sec=>{
    const key = (sec.id || '').replace('section-','');
    const on = key === section;
    sec.hidden = !on;
    sec.setAttribute('aria-hidden', on ? 'false' : 'true');
  });

  try{ localStorage.setItem(STORAGE_KEY, section); }catch(_){}
  try{ history.replaceState(null, '', '#'+section); }catch(_){}
}


  root.addEventListener('click', (e)=>{
    const b = e.target.closest('.nawigacja__btn');
    if(!b) return;
    const section = b.dataset.section;
    setActive(section);
    if (typeof window.showSection === 'function') {
      try { window.showSection(section); } catch(e) {}
    }
  });

  let start = 'torrents';
  const hash = (location.hash || '').replace('#','');
  if (/^(torrents|search|browse|available)$/.test(hash)) start = hash;
  else {
    try{
      const ls = localStorage.getItem(STORAGE_KEY);
      if (ls) start = ls;
    }catch(_){}
  }
  setActive(start);

  window.nawigacjaSetActive = setActive;
})();

/* ===================== UTIL: tryb jasny/ciemny ===================== */
(function themeSetup() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const stored = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = stored || (prefersDark ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);
  btn.setAttribute('aria-pressed', String(initial === 'dark'));

  btn.addEventListener('click', () => {
    const now = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', now);
    btn.setAttribute('aria-pressed', String(now === 'dark'));
    localStorage.setItem('theme', now);
  });
})();

/* ===================== AUTH & GATING ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const authScreen = document.getElementById('auth-screen');
  const appRoot    = document.getElementById('app');
  const navRoot    = document.getElementById('nawigacja');

  const qs = sel => document.querySelector(sel);
  const joinUrl = (base, path) => {
    if (!base) return path || '';
    if (!path) return base;
    return `${base.replace(/\/+$/,'')}/${String(path).replace(/^\/+/,'')}`;
  };

  const TOKEN_KEY    = 'pf_token';
  const REMEMBER_KEY = 'pf_remember';
  let inMemoryToken  = null;

  /* ---------- Token helpers ---------- */
  const getStoredToken = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
  const getToken       = () => inMemoryToken || getStoredToken();
  function setToken(token, remember){
    inMemoryToken = token || null;
    try {
      if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(REMEMBER_KEY, '1');
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch (e) { console.warn('Storage error:', e); }
  }
  function clearToken(){
    inMemoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch(e){}
  }

  window.getAuthToken   = getToken;
  window.clearAuthToken = () => { clearToken(); showAuth(); };

  /* ---------- JWT auto-logout (opcjonalnie) ---------- */
  function getJwtExpMs(token) {
    try {
      const base64 = token.split('.')[1];
      if (!base64) return null;
      const json = JSON.parse(atob(base64.replace(/-/g,'+').replace(/_/g,'/')));
      if (!json || !json.exp) return null;
      return json.exp * 1000;
    } catch { return null; }
  }
  function scheduleAutoLogout(token) {
    const expMs = getJwtExpMs(token);
    if (!expMs) return;
    const delta = expMs - Date.now();
    if (delta <= 0) { handleUnauthorized(); return; }
    setTimeout(() => handleUnauthorized('Sesja wygasła. Zaloguj się ponownie.'), Math.min(delta, 2147000000));
  }

  /* ---------- HARD GATING (klasa + hidden + display + aria) ---------- */
  function hardHide(el){
    if(!el) return;
    el.hidden = true;
    el.setAttribute('aria-hidden','true');
    el.style.display = 'none';
  }
  function hardShow(el, display='block'){
    if(!el) return;
    el.hidden = false;
    el.removeAttribute('aria-hidden');
    el.style.display = display;
  }

  function showApp(){
    document.body.classList.add('is-auth');
    hardHide(authScreen);
    hardShow(appRoot);
    hardShow(navRoot, 'grid'); // nawigacja ma grid
  }
  function showAuth(message){
    document.body.classList.remove('is-auth');
    hardShow(authScreen);
    hardHide(appRoot);
    hardHide(navRoot);
    if (message) {
      const el = document.getElementById('login-global-error');
      if (el) el.textContent = message;
    }
  }
  function handleAuthorized(token){
    setToken(token, (localStorage.getItem(REMEMBER_KEY) === '1'));
    showApp();
    scheduleAutoLogout(token);
  }
  function handleUnauthorized(msg){
    clearToken();
    showAuth(msg || 'Sesja wygasła lub nieautoryzowana.');
  }

  // Start
  const existing = getStoredToken();
  if (existing) { inMemoryToken = existing; showApp(); scheduleAutoLogout(existing); }
  else { showAuth(); }

  /* ---------- authFetch z Authorization ---------- */
  async function authFetch(input, init = {}) {
    const token   = getToken();
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(init.body);
    }
    const resp = await fetch(input, { ...init, headers });
    if (resp.status === 401) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }
    return resp;
  }
  window.authFetch = authFetch;

  /* ---------- Konfiguracja endpointów ---------- */
  const apiBase          = authScreen?.dataset.apiBase          || '';
  const loginEndpoint    = authScreen?.dataset.loginEndpoint    || '/auth/login';
  const registerEndpoint = authScreen?.dataset.registerEndpoint || '/auth/register';
  const LOGIN_URL        = joinUrl(apiBase, loginEndpoint);
  const REGISTER_URL     = joinUrl(apiBase, registerEndpoint);

  /* ---------- Zakładki / slider ---------- */
  const tabLogin      = document.getElementById('tab-login');
  const tabRegister   = document.getElementById('tab-register');
  const panelLogin    = document.getElementById('panel-login');
  const panelRegister = document.getElementById('panel-register');
  const panels        = qs('.auth__panels');
  const card          = qs('.auth__card');

  function setActiveTab(view){
    const isLogin = view === 'login';
    tabLogin?.classList.toggle('is-active', isLogin);
    tabLogin?.setAttribute('aria-selected', String(isLogin));
    tabLogin?.setAttribute('tabindex', isLogin ? '0' : '-1');

    tabRegister?.classList.toggle('is-active', !isLogin);
    tabRegister?.setAttribute('aria-selected', String(!isLogin));
    tabRegister?.setAttribute('tabindex', !isLogin ? '0' : '-1');

    panelLogin?.setAttribute('aria-hidden',  String(!isLogin));
    panelRegister?.setAttribute('aria-hidden',String( isLogin));

    if (panels) panels.style.transform = `translateX(${isLogin ? '0%' : '-100%'})`;
  }
  tabLogin?.addEventListener('click',   () => setActiveTab('login'));
  tabRegister?.addEventListener('click',() => setActiveTab('register'));

  if (card && panels) {
    let startX = 0, currentX = 0, isDragging = false;
    let active = 'login';
    const onStart = (x)=>{ isDragging = true; startX = currentX = x; panels.style.transition = 'none'; };
    const onMove  = (x)=>{ if(!isDragging) return; currentX = x; const dx = currentX - startX; const base = active === 'login' ? 0 : -window.innerWidth; panels.style.transform = `translateX(${base + dx}px)`; };
    const onEnd   = ()=>{ if(!isDragging) return; const dx = currentX - startX; panels.style.transition = ''; const threshold = Math.min(160, window.innerWidth * 0.25); if(active==='login' && dx < -threshold){ active='register'; setActiveTab('register'); } else if(active==='register' && dx > threshold){ active='login'; setActiveTab('login'); } else { setActiveTab(active); } isDragging=false; };
    card.addEventListener('touchstart', e=>onStart(e.touches[0].clientX), {passive:true});
    card.addEventListener('touchmove',  e=>onMove(e.touches[0].clientX), {passive:true});
    card.addEventListener('touchend',   onEnd);
    card.addEventListener('mousedown', e=>onStart(e.clientX));
    window.addEventListener('mousemove', e=>onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);
    tabLogin?.addEventListener('click',   ()=>{ active='login'; });
    tabRegister?.addEventListener('click',()=>{ active='register'; });
  }

  /* ---------- Walidacja ---------- */
  function setFieldError(inputId, message){
    const input = document.getElementById(inputId);
    const err   = document.getElementById(`${inputId}-error`);
    if (input) input.classList.toggle('form__input--invalid', !!message);
    if (err)   err.textContent = message || '';
  }
  function clearFormErrors(form){
    form.querySelectorAll('.form__input').forEach(el => el.classList.remove('form__input--invalid'));
    form.querySelectorAll('.form__error').forEach(el => (el.textContent = ''));
  }
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').toLowerCase());

  /* ---------- LOGOWANIE ---------- */
  const loginForm = document.getElementById('form-login');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = (loginForm.querySelector('#login-email') || {}).value?.trim();
    const password = (loginForm.querySelector('#login-password') || {}).value;
    const remember = (loginForm.querySelector('#login-remember') || {}).checked;
    const globalErr= document.getElementById('login-global-error');

    clearFormErrors(loginForm);
    let hasErr = false;
    if (!email)            { setFieldError('login-email', 'Podaj adres e-mail.'); hasErr = true; }
    else if (!isEmail(email)) { setFieldError('login-email', 'Nieprawidłowy adres e-mail.'); hasErr = true; }
    if (!password)         { setFieldError('login-password', 'Podaj hasło.'); hasErr = true; }
    if (hasErr) return;

    const btn = loginForm.querySelector('[data-action="login-submit"]');
    btn?.setAttribute('disabled', 'true');

    try {
      try { remember ? localStorage.setItem(REMEMBER_KEY,'1') : localStorage.removeItem(REMEMBER_KEY); } catch(_){}

      const res = await fetch(joinUrl(apiBase, loginEndpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      let data = {};
      const txt = await res.text();
      try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }

      if (!res.ok) {
        const msg = data?.message || data?.error || `Błąd ${res.status}`;
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      const token = data?.access_token || data?.token;
      if (!token) { if (globalErr) globalErr.textContent = 'Brak tokenu w odpowiedzi serwera.'; return; }

      handleAuthorized(token); // <<< TU CHOWAMY AUTH „na twardo”
    } catch (err) {
      if (globalErr) globalErr.textContent = 'Błąd sieci / CORS. Uruchom przez http(s).';
      console.error(err);
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  /* ---------- REJESTRACJA (z automatycznym logowaniem) ---------- */
  const registerForm = document.getElementById('form-register');
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstname = (registerForm.querySelector('#reg-firstname') || {}).value?.trim();
    const lastname  = (registerForm.querySelector('#reg-lastname')  || {}).value?.trim();
    const email     = (registerForm.querySelector('#reg-email')     || {}).value?.trim();
    const password  = (registerForm.querySelector('#reg-password')  || {}).value;
    const password2 = (registerForm.querySelector('#reg-password2') || {}).value;
    const globalErr = document.getElementById('register-global-error');

    clearFormErrors(registerForm);

    let hasErr = false;
    if (!firstname) { setFieldError('reg-firstname', 'Podaj imię.'); hasErr = true; }
    if (!lastname)  { setFieldError('reg-lastname',  'Podaj nazwisko.'); hasErr = true; }
    if (!email)     { setFieldError('reg-email',     'Podaj adres e-mail.'); hasErr = true; }
    else if (!isEmail(email)) { setFieldError('reg-email', 'Nieprawidłowy adres e-mail.'); hasErr = true; }
    if (!password)  { setFieldError('reg-password',  'Ustaw hasło.'); hasErr = true; }
    if (!password2) { setFieldError('reg-password2', 'Powtórz hasło.'); hasErr = true; }
    if (password && password2 && password !== password2) {
      setFieldError('reg-password2', 'Hasła muszą być identyczne.');
      hasErr = true;
    }
    if (hasErr) return;

    const btn = registerForm.querySelector('[data-action="register-submit"]');
    btn?.setAttribute('disabled', 'true');

    try {
      const res = await fetch(joinUrl(apiBase, registerEndpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstname, lastname, email, password })
      });

      let data = {};
      const txt = await res.text();
      try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }

      if (!res.ok) {
        if (data?.errors && typeof data.errors === 'object') {
          for (const [key, msg] of Object.entries(data.errors)) {
            const map = { firstName:'reg-firstname', firstname:'reg-firstname', lastName:'reg-lastname', lastname:'reg-lastname', email:'reg-email', password:'reg-password' };
            const inputId = map[key] || '';
            if (inputId) setFieldError(inputId, String(msg));
          }
        }
        const msg = data?.message || data?.error || `Błąd ${res.status}`;
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      // token bezpośrednio z rejestracji albo do-logowanie
      let token = data?.access_token || data?.token;
      if (!token) {
        const loginRes = await fetch(joinUrl(apiBase, loginEndpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        let loginData = {};
        const loginTxt = await loginRes.text();
        try { loginData = loginTxt ? JSON.parse(loginTxt) : {}; } catch { loginData = { message: loginTxt }; }
        if (!loginRes.ok) {
          const msg = loginData?.message || loginData?.error || `Błąd ${loginRes.status}`;
          if (globalErr) globalErr.textContent = `Konto utworzone, ale logowanie nie powiodło się: ${msg}`;
          return;
        }
        token = loginData?.access_token || loginData?.token;
      }

      if (!token) {
        if (globalErr) globalErr.textContent = 'Konto utworzone, brak tokenu logowania.';
        return;
      }

      try { localStorage.setItem(REMEMBER_KEY, '1'); } catch(_){}
      handleAuthorized(token); // <<< TU TAKŻE CHOWAMY AUTH
    } catch (err) {
      if (globalErr) globalErr.textContent = 'Błąd sieci / CORS. Spróbuj ponownie.';
      console.error(err);
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  /* ---------- Cross-tab sync ---------- */
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY || e.key === REMEMBER_KEY) {
      const t = getStoredToken();
      if (!t) handleUnauthorized();
      else handleAuthorized(t);
    }
  });

  /* ---------- Przykład: użycie tokenu ----------
     // authFetch(joinUrl(apiBase, '/protected/endpoint'))
     //   .then(r => r.json())
     //   .then(console.log)
     //   .catch(console.error);
  ------------------------------------------------ */
});

/* ===================== TORRENTY / KOLEJKA (sekcja) — v2 z authFetch ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const section = document.getElementById('section-torrents');
  if (!section) return;

  const API = document.getElementById('auth-screen')?.dataset.apiBase || '';
  const joinUrl = (b,p)=>`${(b||'').replace(/\/+$/,'')}/${String(p||'').replace(/^\/+/,'')}`;

  // preferuj globalne authFetch; w razie czego fallback z Bearer
  async function afetch(url, init={}) {
    if (typeof window.authFetch === 'function') {
      return window.authFetch(url, init);
    }
    const t = (window.getAuthToken && window.getAuthToken()) || null;
    const headers = new Headers(init.headers || {});
    if (t) headers.set('Authorization', `Bearer ${t}`);
    return fetch(url, { ...init, headers });
  }

  const elTorrents = section.querySelector('#tx-torrents');
  const elQueue    = section.querySelector('#tx-queue');
  const sortSel    = section.querySelector('#tx-sort');
  const speedSel   = section.querySelector('#tx-speed');
  const speedFb    = section.querySelector('#tx-speed-feedback');
  const qStatusSel = section.querySelector('#tx-q-status');
  const tabBar     = section.querySelector('.tx-tabs');
  const toolbars   = section.querySelectorAll('.tx-toolbar');

  let currentTab = 'torrents';
  let refreshTimer = null;

  function setTab(tab){
    currentTab = tab;
    elTorrents.hidden = (tab !== 'torrents');
    elQueue.hidden    = (tab !== 'queue');
    toolbars.forEach(tb => tb.hidden = (tb.dataset.txTools !== tab));
    tabBar.querySelectorAll('.tx-tab').forEach(b=>{
      const on = (b.dataset.txTab === tab);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true':'false');
    });
    kickRefresh();
  }
  tabBar.addEventListener('click', e=>{
    const btn = e.target.closest('[data-tx-tab]');
    if(!btn) return;
    const tab = btn.dataset.txTab;
    if(tab && tab !== currentTab) setTab(tab);
  });

  // —— limit prędkości (global)
  speedSel?.addEventListener('change', async ()=>{
    const val = Number(speedSel.value || 0);           // MB/s
    const kib = val > 0 ? Math.round(val * 1024) : 0;  // KiB/s
    speedFb.textContent = 'Ustawianie limitu…';
    try{
      const r = await afetch(joinUrl(API, '/torrent/set-limit'), {
        method:'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ limit_kib_per_s: kib })
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      speedFb.textContent = kib>0 ? `Limit: ${val} MB/s` : 'Limit zdjęty';
    }catch(e){
      console.error(e);
      speedFb.textContent = 'Błąd ustawiania limitu';
    }finally{
      setTimeout(()=>speedFb.textContent='', 1800);
    }
  });

  // —— helpers
  const pct = p => {
    const v = Number(p ?? 0);
    if(Number.isFinite(v)){
      if(v <= 1.01) return Math.max(0, Math.min(100, v*100));
      return Math.max(0, Math.min(100, v));
    }
    return 0;
  };
  function humanSpeed(bps){
    const x = Number(bps||0);
    if(x<=0) return '0 B/s';
    const u=['B/s','KB/s','MB/s','GB/s']; let i=0, n=x;
    while(n>=1024 && i<u.length-1){ n/=1024; i++; }
    return `${n.toFixed(n>=10?0:1)} ${u[i]}`;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))

  // —— TORRENTY (wszystkie urządzenia: BEZ device_id)
  async function loadTorrents(){
    try{
      const url = new URL(joinUrl(API, '/torrents/status/list'));
      url.searchParams.set('page','1');
      url.searchParams.set('limit','200');
      const r = await afetch(url.toString());
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      const raw = Array.isArray(data?.items) ? data.items : [];

      // deduplikacja po info_hash/hash/id
      const byKey = new Map();
      for(const it of raw){
        const key = it.info_hash || it.hash || it.id || it.name;
        if(!key) continue;
        if(!byKey.has(key)) byKey.set(key, it);
      }
      let items = Array.from(byKey.values());

      // filtr: pokazuj tylko aktywne (opcjonalnie – jeśli backend zwraca state)
      items = items.filter(it => String(it.state||'').toLowerCase() !== 'removed');

      // sort
      const s = (sortSel?.value || 'name');
      if(s === 'progress'){
        items.sort((a,b)=> (pct(a.progress ?? a.progress_percent ?? a.percent) - pct(b.progress ?? b.progress_percent ?? b.percent))).reverse();
      }else if(s === 'state'){
        items.sort((a,b)=> String(a.state||'').localeCompare(String(b.state||'')));
      }else{
        items.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
      }

      renderTorrents(items);
    }catch(e){
      console.error('loadTorrents:', e);
      elTorrents.innerHTML = `<div class="tx-empty">Nie udało się pobrać torrentów (czy jesteś zalogowany?).</div>`;
    }
  }

  function renderTorrents(items){
    if(!items.length){
      elTorrents.innerHTML = `<div class="tx-empty">Brak aktywnych torrentów.</div>`;
      return;
    }
    const html = items.map(it=>{
      const name = it.name || it.display_title || it.title || 'Nieznany';
      const progress = pct(it.progress ?? it.progress_percent ?? it.percent ?? 0);
      const rate = humanSpeed(
        it.download_rate_bps ?? it.downloadSpeedBps ?? it.download_rate ?? it.dl_rate ?? it.download ?? 0
      );
      const state = (it.state || 'unknown').toUpperCase();
      const ihash = it.info_hash || it.hash || it.id || name;

      return `
      <article class="tcard" data-ih="${esc(ihash)}">
        <div class="tcard__left">
          <div class="tcard__title">${esc(name)}</div>
          <div class="tcard__meta">
            <span>${progress.toFixed(0)}%</span>
            <span>•</span>
            <span>${esc(state)}</span>
            <span>•</span>
            <span>${esc(rate)}</span>
          </div>
          <div class="tcard__progress" aria-label="Postęp">
            <div class="tcard__bar" style="width:${progress}%;"></div>
          </div>
        </div>
        <div class="tcard__right">
          <button class="tbtn tbtn--ghost" data-action="pause" data-ih="${esc(ihash)}">Pauza/Wznów</button>
          <button class="tbtn tbtn--danger" data-action="remove" data-ih="${esc(ihash)}" data-rm="0">Usuń</button>
          <button class="tbtn tbtn--danger" data-action="remove" data-ih="${esc(ihash)}" data-rm="1" title="Usuń z danymi">Usuń + dane</button>
        </div>
      </article>`;
    }).join('');
    if(elTorrents.innerHTML !== html) elTorrents.innerHTML = html;
  }

  elTorrents?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const ih = btn.dataset.ih;
    const action = btn.dataset.action;
    try{
      if(action === 'pause'){
        await afetch(joinUrl(API, '/torrent/toggle'), {
          method:'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ torrent_id: ih })
        });
      }else if(action === 'remove'){
        const rm = btn.dataset.rm === '1';
        await afetch(joinUrl(API, '/torrent/remove'), {
          method:'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ torrent_id: ih, remove_data: rm })
        });
      }
      setTimeout(loadTorrents, 300);
    }catch(err){ console.error(err); }
  });
  sortSel?.addEventListener('change', loadTorrents);

  // —— KOLEJKA
  async function loadQueue(){
    try{
      const url = new URL(joinUrl(API, '/queue/list'));
      url.searchParams.set('status', qStatusSel?.value || 'new');
      url.searchParams.set('page','1');
      url.searchParams.set('limit','50');

      const r = await afetch(url.toString());
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      renderQueue(items);
    }catch(e){
      console.error('loadQueue:', e);
      elQueue.innerHTML = `<div class="tx-empty">Nie udało się pobrać kolejki (czy jesteś zalogowany?).</div>`;
    }
  }

  function renderQueue(items){
    if(!items.length){
      elQueue.innerHTML = `<div class="tx-empty">Brak elementów w kolejce.</div>`;
      return;
    }
    const html = items.map(it=>{
      const title  = it.display_title || it.payload?.display_title || it.payload?.title || it.kind || 'Zadanie';
      const poster = it.image_url || it.payload?.image_url || it.payload?.poster || it.payload?.thumb || 'https://via.placeholder.com/300x450?text=Poster';
      const when   = it.created_at ? new Date(it.created_at).toLocaleString() : '';
      return `
      <article class="qcard" data-qid="${it.id}">
        <img class="qcard__img" src="${esc(poster)}" alt="" onerror="this.src='https://via.placeholder.com/300x450?text=Poster'">
        <div>
          <div class="qcard__title">${esc(title)}</div>
          <div class="qcard__meta">
            <span>ID: ${it.id}</span>
            <span>•</span>
            <span>Dodano: ${esc(when)}</span>
            ${it.kind ? `<span>•</span><span>${esc(it.kind)}</span>` : ''}
          </div>
        </div>
        <div class="qcard__right">
          <button class="tbtn tbtn--danger" data-qdel="${it.id}">Usuń</button>
        </div>
      </article>`;
    }).join('');
    if(elQueue.innerHTML !== html) elQueue.innerHTML = html;
  }

  elQueue?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-qdel]');
    if(!btn) return;
    const id = btn.dataset.qdel;
    try{
      await afetch(joinUrl(API, `/queue/${id}`), { method:'DELETE' });
      setTimeout(loadQueue, 200);
    }catch(err){ console.error(err); }
  });

  qStatusSel?.addEventListener('change', loadQueue);

  // —— auto-refresh tylko aktywnej karty
  function tick(){ currentTab === 'torrents' ? loadTorrents() : loadQueue(); }
  function kickRefresh(){
    if (refreshTimer) clearInterval(refreshTimer);
    tick();
    refreshTimer = setInterval(tick, 3000);
  }

  // start
  setTab('torrents');
});
