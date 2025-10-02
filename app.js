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
