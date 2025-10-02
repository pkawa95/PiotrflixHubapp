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


/* ====== TORRENTS + QUEUE MODULE ====== */
(function(){
  const sec = document.getElementById('section-torrents');
  if (!sec) return;

  const devSel  = document.getElementById('t-devices');
  const btnRef  = document.getElementById('t-refresh');
  const listT   = document.getElementById('t-list');
  const emptyT  = document.getElementById('t-empty');
  const aggEl   = document.getElementById('t-agg');
  const listQ   = document.getElementById('q-list');
  const emptyQ  = document.getElementById('q-empty');

  const LS_DEVICE = 'pf_selected_device';

  const apiBase = (document.getElementById('auth-screen')?.dataset.apiBase || '').replace(/\/+$/,'');
  const u = (p) => apiBase + p;

  function fmtBytes(b){
    const n = Number(b||0);
    if (!isFinite(n) || n<=0) return '0 B/s';
    const k = 1024; const units = ['B/s','KiB/s','MiB/s','GiB/s','TiB/s'];
    const i = Math.floor(Math.log(n)/Math.log(k));
    return `${(n/Math.pow(k,i)).toFixed(i?1:0)} ${units[i]}`;
  }
  function fmtPct(x){ const n = Math.max(0, Math.min(1, Number(x||0))); return (n*100).toFixed(1) + '%'; }
  function isoToLocal(dt){
    try { return new Date(dt).toLocaleString(); } catch { return dt || ''; }
  }

  /* ---------- DEVICES ---------- */
  async function loadDevices(){
    try {
      const r = await authFetch(u('/torrents/devices'));
      const data = await r.json();
      const prev = localStorage.getItem(LS_DEVICE) || '';
      devSel.innerHTML = `<option value="">Wszystkie</option>`;
      (data||[]).forEach(d=>{
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = d.device_id + (d.torrents ? ` (${d.torrents})` : '');
        devSel.appendChild(opt);
      });
      if (prev && [...devSel.options].some(o=>o.value===prev)) devSel.value = prev;
    } catch(e){ console.warn('devices error', e); }
  }

  /* ---------- STATUS SUMMARY ---------- */
  async function loadSummary(){
    try {
      const q = devSel.value ? `?device_id=${encodeURIComponent(devSel.value)}` : '';
      const r = await authFetch(u('/torrents/status/summary'+q));
      const s = await r.json();
      const dl = fmtBytes(s.aggregate_dl_speed);
      const ul = fmtBytes(s.aggregate_ul_speed);
      aggEl.textContent = `Łącznie: ${s.total} • Pobieranie: ${dl} • Wysyłanie: ${ul}`;
    } catch(e){ aggEl.textContent = ''; }
  }

  /* ---------- TORRENTS LIST ---------- */
  function tRow(t){
    const img = t.image_url || 'https://placehold.co/240x360?text=No+Image';
    const title = t.display_title || t.name || '(bez tytułu)';
    const pct = Math.max(0, Math.min(1, Number(t.progress||0)));
    const pctTxt = fmtPct(pct);
    const eta = (t.eta && t.eta>0) ? ` • ETA: ${Math.max(0, Math.floor(t.eta/60))} min` : '';
    const rate = `${fmtBytes(t.dl_speed)} / ${fmtBytes(t.ul_speed)}`;

    const card = document.createElement('article');
    card.className = 'tcard';
    card.innerHTML = `
      <img class="tcard__img" src="${img}" alt="" />
      <div class="tcard__body">
        <h3 class="tcard__title">${escapeHtml(title)}</h3>
        <div class="tcard__meta">
          <span class="tbadge"><span class="tbadge__dot"></span>${escapeHtml(t.state)}</span>
          <span>${rate}${eta}</span>
          <span>Peers: ${Number(t.peers||0)} / Seeds: ${Number(t.seeds||0)}</span>
        </div>
        <div class="progress" aria-label="Postęp">
          <div class="progress__bar" style="width:${(pct*100).toFixed(3)}%"></div>
        </div>
        <div class="progress__label">${pctTxt} • ${((t.downloaded_bytes||0)/1024/1024).toFixed(1)} / ${((t.size_bytes||0)/1024/1024).toFixed(1)} MiB</div>
      </div>
      <div class="tcard__actions">
        <button class="btn btn--ghost" data-act="pause"  title="Pauzuj">⏸</button>
        <button class="btn btn--ghost" data-act="resume" title="Wznów">▶️</button>
        <button class="btn btn--ghost" data-act="recheck" title="Sprawdź">🔁</button>
        <button class="btn btn--danger" data-act="remove" title="Usuń">🗑</button>
        <button class="btn btn--danger" data-act="remove_data" title="Usuń z danymi">🗑💾</button>
      </div>
    `;

    // actions
    card.querySelectorAll('[data-act]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const kind = btn.getAttribute('data-act');
        try{
          await authFetch(u('/torrents/commands/push'), {
            method: 'POST',
            body: {
              device_id: devSel.value || t.device_id || undefined, // prefer wybrane urządzenie
              info_hash: t.info_hash,
              kind,
              args: {}
            }
          });
          // szybkie odświeżenie
          await Promise.all([loadTorrents(), loadQueue(), loadSummary()]);
        }catch(e){ console.error(e); }
      });
    });

    return card;
  }

  async function loadTorrents(){
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', '200');
    params.set('order', 'desc');
    if (devSel.value) params.set('device_id', devSel.value);

    const r = await authFetch(u('/torrents/status/list?'+params.toString()));
    const data = await r.json();

    listT.innerHTML = '';
    if (!data || !data.length){
      emptyT.hidden = false;
      return;
    }
    emptyT.hidden = true;
    data.forEach(t => listT.appendChild(tRow(t)));
  }

  /* ---------- QUEUE LIST ---------- */
  function qRow(q){
    const img = q.image_url || 'https://placehold.co/160x240?text=No+Image';
    const title = q.display_title || q.kind;
    const dt = q.created_at ? isoToLocal(q.created_at) : '';
    const status = q.status || 'new';

    const row = document.createElement('article');
    row.className = 'qcard';
    row.innerHTML = `
      <img class="qcard__img" src="${img}" alt="">
      <div>
        <h3 class="qcard__title">${escapeHtml(title)}</h3>
        <div class="qcard__meta">Rodzaj: ${escapeHtml(q.kind)} • Status: ${escapeHtml(status)} • Dodano: ${escapeHtml(dt)}</div>
      </div>
      <div class="qcard__actions">
        <button class="btn btn--danger" data-del="${q.id}" title="Usuń zadanie">Usuń</button>
      </div>
    `;

    row.querySelector('[data-del]').addEventListener('click', async ()=>{
      try {
        await authFetch(u(`/torrents/commands/${q.id}`), { method: 'DELETE' });
        await loadQueue();
      } catch(e){ console.error(e); }
    });

    return row;
  }

  async function loadQueue(){
    const params = new URLSearchParams();
    if (devSel.value) params.set('device_id', devSel.value);
    params.set('status','all'); // pokazujemy wszystkie
    params.set('page','1');
    params.set('limit','100');

    const r = await authFetch(u('/torrents/commands/list?'+params.toString()));
    const data = await r.json();

    listQ.innerHTML = '';
    if (!data || !data.length){ emptyQ.hidden = false; return; }
    emptyQ.hidden = true;
    data.forEach(q => listQ.appendChild(qRow(q)));
  }

  /* ---------- helpers ---------- */
  function escapeHtml(s){
    return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
  }

  /* ---------- events ---------- */
  devSel.addEventListener('change', ()=>{
    try{ localStorage.setItem(LS_DEVICE, devSel.value || ''); }catch(_){}
    Promise.all([loadTorrents(), loadQueue(), loadSummary()]);
  });
  btnRef.addEventListener('click', ()=> Promise.all([loadDevices(), loadTorrents(), loadQueue(), loadSummary()]));

  // hook na przełączanie sekcji (Twoja nawigacja wywołuje window.showSection)
  const origShow = window.showSection;
  window.showSection = function(name){
    if (typeof origShow === 'function') try{ origShow(name); }catch(_){}
    if (name === 'torrents'){
      // init once + refresh
      loadDevices().then(()=> {
        const saved = localStorage.getItem(LS_DEVICE);
        if (saved && [...devSel.options].some(o=>o.value===saved)) devSel.value = saved;
        return Promise.all([loadTorrents(), loadQueue(), loadSummary()]);
      });
    }
  };

  // jeśli sekcja startowa to „torrents”
  if ((location.hash||'').replace('#','') === 'torrents'){
    loadDevices().then(()=> Promise.all([loadTorrents(), loadQueue(), loadSummary()]));
  }
})();

/* ====== TORRENTS + QUEUE v2 (bez migania, plakaty z /search) ====== */
(function(){
  const sec = document.getElementById('section-torrents'); if (!sec) return;

  // tabs
  const tabBtns  = [...sec.querySelectorAll('.tsticky__tab')];
  const viewT    = document.getElementById('t-view');
  const viewQ    = document.getElementById('q-view');

  // torrents controls
  const tDevSel  = document.getElementById('t-devices');
  const tSortSel = document.getElementById('t-sort');
  const tLimit   = document.getElementById('t-limit');
  const tLimitFb = document.getElementById('t-limit-feedback');
  const tAgg     = document.getElementById('t-agg');
  const tList    = document.getElementById('t-list');
  const tEmpty   = document.getElementById('t-empty');
  const tBtnRef  = document.getElementById('t-refresh');

  // queue controls
  const qDevSel  = document.getElementById('q-devices');
  const qList    = document.getElementById('q-list');
  const qEmpty   = document.getElementById('q-empty');
  const qBtnRef  = document.getElementById('q-refresh');

  const apiBase  = (document.getElementById('auth-screen')?.dataset.apiBase || '').replace(/\/+$/,'');
  const u        = p => apiBase + p;

  const posterCache = new Map();        // tytuł -> url
  const searching   = new Map();        // tytuł -> Promise
  let refreshTimer  = null;
  const REFRESH_MS  = 5000;

  const LS_T_DEV='pf_t_dev', LS_T_SORT='pf_t_sort', LS_Q_DEV='pf_q_dev';

  // utils
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
  const fmtBytesPerSec = b => { const n=+b||0; if(n<=0) return '0 B/s'; const k=1024, u=['B/s','KiB/s','MiB/s','GiB/s']; const i=Math.floor(Math.log(n)/Math.log(k)); return `${(n/Math.pow(k,i)).toFixed(i?1:0)} ${u[i]}`; };
  const fmtPct = x => (Math.max(0,Math.min(1,+x||0))*100).toFixed(1)+'%';
  const isoLocal = s => { try{ return new Date(s).toLocaleString(); }catch{ return s||''; } };

  async function authJson(url, init){ const r = await authFetch(url, init||{}); const t = await r.text(); try{return t?JSON.parse(t):{};}catch{return{};} }

  // posters
  async function posterFromSearch(title){
    if (!title) return null;
    if (posterCache.has(title)) return posterCache.get(title);
    if (searching.has(title)) return searching.get(title);

    const p = (async ()=>{
      try{
        const j = await authJson(u('/search'), { method:'POST', body:{ query:title, type:'movie', provider:'default', page:1, extra:{} } });
        const img = j?.results?.[0]?.image || null;
        if (img) posterCache.set(title, img);
        return img;
      }catch{ return null; }
    })();
    searching.set(title, p);
    const out = await p; searching.delete(title); return out;
  }

  /* ---------- DEVICES ---------- */
  async function loadDevicesInto(selectEl){
    try{
      const data = await authJson(u('/torrents/devices'));
      const prev = (selectEl === tDevSel ? localStorage.getItem(LS_T_DEV) : localStorage.getItem(LS_Q_DEV)) || '';
      selectEl.innerHTML = `<option value="">Wszystkie</option>`;
      (data||[]).forEach(d=>{
        const opt = document.createElement('option');
        opt.value = d.device_id; opt.textContent = d.device_id + (d.torrents?` (${d.torrents})`:'');
        selectEl.appendChild(opt);
      });
      if (prev && [...selectEl.options].some(o=>o.value===prev)) selectEl.value = prev;
    }catch{}
  }

  /* ---------- SUMMARY ---------- */
  async function loadSummary(){
    try{
      const q = tDevSel.value ? `?device_id=${encodeURIComponent(tDevSel.value)}` : '';
      const s = await authJson(u('/torrents/status/summary'+q));
      tAgg.textContent = `Łącznie: ${s.total} • DL: ${fmtBytesPerSec(s.aggregate_dl_speed)} • UL: ${fmtBytesPerSec(s.aggregate_ul_speed)}`;
    }catch{ tAgg.textContent=''; }
  }

  /* ---------- TORRENTS: patch render ---------- */
  const tIndex = new Map(); // info_hash -> element

  function applyTorrentIntoCard(card, t){
    const title = t.display_title || t.name || '(bez tytułu)';
    const pct   = +t.progress || 0;
    const state = (t.state||'unknown').toLowerCase();
    // teksty
    card.querySelector('.tcard__title').textContent = title;
    const meta = card.querySelector('.tcard__meta');
    const rate = `${fmtBytesPerSec(t.dl_speed)} / ${fmtBytesPerSec(t.ul_speed)}`;
    const eta = (t.eta>0)?` • ETA: ${Math.max(0,Math.floor(t.eta/60))} min`:'';
    meta.innerHTML = `
      <span class="tbadge ${state==='seeding'?'tbadge--ok':''}">
        <span class="tbadge__dot"></span>${escapeHtml(state)}
      </span>
      <span>${rate}${eta}</span>
      <span>Peers: ${+t.peers||0} / Seeds: ${+t.seeds||0}</span>
    `;
    // progress
    card.querySelector('.progress__bar').style.width = (pct*100).toFixed(3)+'%';
    card.querySelector('.progress__label').textContent =
      `${fmtPct(pct)} • ${((t.downloaded_bytes||0)/1024/1024).toFixed(1)} / ${((t.size_bytes||0)/1024/1024).toFixed(1)} MiB`;

    // obraz
    const imgEl = card.querySelector('img.tcard__img');
    if (t.image_url && imgEl.getAttribute('src') !== t.image_url){
      imgEl.src = t.image_url; imgEl.removeAttribute('data-missing');
    } else if (!t.image_url && !imgEl.getAttribute('src') && !imgEl.dataset.loading) {
      imgEl.dataset.loading = '1';
      posterFromSearch(title).then(src=>{
        if (src && !imgEl.getAttribute('src')) imgEl.src = src;
        delete imgEl.dataset.loading;
      });
    }

    // actions
    card.querySelectorAll('[data-act]').forEach(btn=>{
      btn.onclick = async ()=>{
        const kind = btn.getAttribute('data-act');
        try{
          await authFetch(u('/torrents/commands/push'), {
            method:'POST',
            body:{ device_id: tDevSel.value || undefined, info_hash: t.info_hash, kind, args:{}, display_title:title, image_url: t.image_url || imgEl.getAttribute('src') || '' }
          });
          // po komendzie nie kasujemy listy – kolejka odświeży się sama w cyklu
        }catch(e){ console.error(e); }
      };
    });
  }

  function makeTorrentCard(t){
    const title = t.display_title || t.name || '(bez tytułu)';
    const el = document.createElement('article');
    el.className = 'tcard'; el.dataset.key = t.info_hash;
    el.innerHTML = `
      <img class="tcard__img" alt="" loading="lazy" ${t.image_url?`src="${escapeHtml(t.image_url)}"`:''} ${t.image_url?'':'data-missing="1"'} />
      <div class="tcard__body">
        <h3 class="tcard__title"></h3>
        <div class="tcard__meta"></div>
        <div class="progress"><div class="progress__bar"></div></div>
        <div class="progress__label"></div>
      </div>
      <div class="tcard__actions">
        <button class="btn btn--ghost" data-act="pause"  title="Pauzuj">⏸</button>
        <button class="btn btn--ghost" data-act="resume" title="Wznów">▶️</button>
        <button class="btn btn--ghost" data-act="recheck" title="Sprawdź">🔁</button>
        <button class="btn btn--danger" data-act="remove" title="Usuń">🗑</button>
        <button class="btn btn--danger" data-act="remove_data" title="Usuń z danymi">🗑💾</button>
      </div>
    `;
    applyTorrentIntoCard(el, t);
    return el;
  }

  async function loadTorrents(){
    tList.classList.add('updating');
    const params = new URLSearchParams({ page:'1', limit:'200', order:'desc' });
    if (tDevSel.value) params.set('device_id', tDevSel.value);
    const data = await authJson(u('/torrents/status/list?'+params.toString()));

    // sort
    const s = tSortSel.value;
    data.sort((a,b)=>{
      if (s==='name')    return (a.display_title||a.name||'').localeCompare(b.display_title||b.name||'');
      if (s==='progress')return (+b.progress||0)-(+a.progress||0);
      if (s==='state')   return (a.state||'').localeCompare(b.state||'');
      return 0;
    });

    // patch: dodaj/aktualizuj/usuń
    const seen = new Set();
    for (const t of (data||[])){
      seen.add(t.info_hash);
      let card = tIndex.get(t.info_hash);
      if (!card){
        card = makeTorrentCard(t);
        tIndex.set(t.info_hash, card);
        tList.appendChild(card);
      } else {
        applyTorrentIntoCard(card, t);
      }
    }
    // usuwamy nieobecne
    [...tIndex.keys()].forEach(k=>{
      if (!seen.has(k)){
        const el = tIndex.get(k);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        tIndex.delete(k);
      }
    });

    tEmpty.hidden = (data && data.length > 0);
    tList.classList.remove('updating');
  }

  /* ---------- QUEUE: patch render (status=new) ---------- */
  const qIndex = new Map(); // id -> element

  function applyQueueIntoCard(card, q){
    const title = q.display_title || q.kind;
    const imgEl = card.querySelector('img.qcard__img');
    card.querySelector('.qcard__title').textContent = title;
    card.querySelector('.qcard__meta').textContent = `Rodzaj: ${q.kind} • Dodano: ${isoLocal(q.created_at)}`;

    if (q.image_url && imgEl.getAttribute('src') !== q.image_url){
      imgEl.src = q.image_url; imgEl.removeAttribute('data-missing');
    } else if (!q.image_url && !imgEl.getAttribute('src') && !imgEl.dataset.loading){
      imgEl.dataset.loading = '1';
      posterFromSearch(title).then(src=>{
        if (src && !imgEl.getAttribute('src')) imgEl.src = src;
        delete imgEl.dataset.loading;
      });
    }

    const btn = card.querySelector('[data-del]');
    btn.onclick = async ()=>{
      try{ await authFetch(u(`/torrents/commands/${q.id}`), { method:'DELETE' }); }catch(e){ console.error(e); }
      // nie czyścimy brutalnie – kolejny refresh zdejmie kartę
    };
  }

  function makeQueueCard(q){
    const el = document.createElement('article');
    el.className='qcard'; el.dataset.key = String(q.id);
    el.innerHTML = `
      <img class="qcard__img" alt="" loading="lazy" ${q.image_url?`src="${escapeHtml(q.image_url)}"`:''} ${q.image_url?'':'data-missing="1"'} />
      <div>
        <h3 class="qcard__title"></h3>
        <div class="qcard__meta"></div>
      </div>
      <div class="qcard__actions"><button class="btn btn--danger" data-del>Usuń</button></div>
    `;
    applyQueueIntoCard(el, q);
    return el;
  }

  async function loadQueue(){
    qList.classList.add('updating');
    const params = new URLSearchParams({ status:'new', page:'1', limit:'100' });
    if (qDevSel.value) params.set('device_id', qDevSel.value);
    const data = await authJson(u('/torrents/commands/list?'+params.toString()));

    const seen = new Set();
    for (const q of (data||[])){
      seen.add(String(q.id));
      let card = qIndex.get(String(q.id));
      if (!card){
        card = makeQueueCard(q);
        qIndex.set(String(q.id), card);
        qList.appendChild(card);
      } else {
        applyQueueIntoCard(card, q);
      }
    }
    [...qIndex.keys()].forEach(k=>{
      if (!seen.has(k)){
        const el = qIndex.get(k);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        qIndex.delete(k);
      }
    });

    qEmpty.hidden = (data && data.length>0);
    qList.classList.remove('updating');
  }

  /* ---------- LIMIT ---------- */
  async function applyGlobalLimit(){
    const val = parseInt(tLimit.value || '0', 10) || 0;
    tLimitFb.textContent = 'Ustawianie limitu…';
    try{
      await authFetch(u('/torrent/set-limit'), { method:'POST', body:{ limit_kib_per_s: val, device_id: tDevSel.value || undefined } });
      tLimitFb.textContent = val>0 ? `Limit ustawiony na ${(val/1024).toFixed(0)} MB/s` : 'Limit zdjęty (Unlimited)';
    }catch{ tLimitFb.textContent = 'Nie udało się ustawić limitu.'; }
    setTimeout(()=>{ tLimitFb.textContent=''; }, 2400);
  }

  /* ---------- TABS ---------- */
  function setTab(which){
    tabBtns.forEach(b=>{
      const on = b.dataset.txTab===which;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const showT = (which==='torrents');
    viewT.hidden = !showT;
    viewQ.hidden = showT;
    restartRefresh();
  }
  sec.querySelector('.tsticky__tabs').addEventListener('click', e=>{
    const b = e.target.closest('.tsticky__tab'); if (!b) return;
    setTab(b.dataset.txTab);
  });

  /* ---------- REFRESH CYCLE ---------- */
  async function refreshNow(){
    if (!viewT.hidden){
      await Promise.all([
        loadDevicesInto(tDevSel),
        loadSummary(),
        loadTorrents()
      ]);
    } else {
      await Promise.all([
        loadDevicesInto(qDevSel),
        loadQueue()
      ]);
    }
  }
  function restartRefresh(){
    if (refreshTimer) clearInterval(refreshTimer);
    refreshNow();
    refreshTimer = setInterval(()=>{ refreshNow(); }, REFRESH_MS);
  }

  /* ---------- EVENTS ---------- */
  tDevSel.addEventListener('change', ()=>{ try{localStorage.setItem(LS_T_DEV, tDevSel.value||'');}catch{} loadSummary(); loadTorrents(); });
  tSortSel.addEventListener('change', ()=>{ try{localStorage.setItem(LS_T_SORT, tSortSel.value||'name');}catch{} loadTorrents(); });
  tLimit.addEventListener('change', applyGlobalLimit);
  tBtnRef.addEventListener('click', refreshNow);

  qDevSel.addEventListener('change', ()=>{ try{localStorage.setItem(LS_Q_DEV, qDevSel.value||'');}catch{} loadQueue(); });
  qBtnRef.addEventListener('click', refreshNow);

  /* ---------- INIT (gdy pokażesz sekcję) ---------- */
  const origShow = window.showSection;
  window.showSection = function(name){
    if (typeof origShow === 'function') { try{ origShow(name); }catch{} }
    if (name==='torrents') { initOnce(); restartRefresh(); }
    else { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer=null; } }
  };

  let inited=false;
  function initOnce(){
    if (inited) return; inited=true;
    // restore
    try{
      tDevSel.value = localStorage.getItem(LS_T_DEV) || '';
      tSortSel.value = localStorage.getItem(LS_T_SORT) || 'name';
      qDevSel.value = localStorage.getItem(LS_Q_DEV) || '';
    }catch{}
    setTab('torrents');
  }

  // jeśli startujesz na #torrents
  if ((location.hash||'').replace('#','')==='torrents'){ initOnce(); restartRefresh(); }
})();
