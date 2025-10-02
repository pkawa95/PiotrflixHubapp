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

    document.querySelectorAll('.section').forEach(sec=>{
      const key = (sec.id || '').replace('section-','');
      const on = key === section;
      sec.classList.toggle('active', on);
      sec.hidden = !on;
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

/* ===================== TORRENTY: helpers ===================== */
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);

  // Widok zakładek
  let activeTorrentView = 'active'; // 'active' | 'queue'

  // Prosty format bajtów/s
  function fmtBytes(x){
    x = Number(x||0);
    const u = ['B','KB','MB','GB','TB']; let i=0;
    while(x >= 1024 && i < u.length-1){ x/=1024; i++; }
    return `${x.toFixed(i?1:0)} ${u[i]}`;
  }
  const fmtSpeed = (bps)=> `${fmtBytes(bps)}/s`;

  // Animacja progressu
  function animateProgressBar(el, pct){
    if(!el) return;
    const v = Math.max(0, Math.min(100, pct));
    requestAnimationFrame(()=>{ el.style.width = v + '%'; });
  }

  // UI: przełączanie tabów AKTYWNE / KOLEJKA
  const tabsRoot = $('#torrent-tabs');
  if(tabsRoot){
    tabsRoot.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-torrent-tab]');
      if(!b) return;
      tabsRoot.querySelectorAll('.search-tab').forEach(btn=>btn.classList.remove('is-active'));
      b.classList.add('is-active');
      activeTorrentView = b.dataset.torrentTab; // 'active' lub 'queue'
      loadTorrents();
    });
  }

  // Globalny limit prędkości (MB/s) — tryb zaawansowany, w prostym tylko komunikat
  const limSel = $('#global-speed-limit');
  const limInfo = $('#global-speed-feedback');
  if(limSel){
    limSel.addEventListener('change', async ()=>{
      const val = parseFloat(limSel.value || '0'); // MB/s
      if(typeof window.activeDevice === 'function' && window.activeDevice()){
        try{
          await authFetch((authScreen?.dataset.apiBase||'') + '/torrents/commands/push', {
            method:'POST',
            body: { device_id: window.activeDevice(), kind:'set_rate_global', args:{ limit_mbs: isNaN(val)?0:val } }
          });
          limInfo.textContent = val>0 ? `Ustawiono globalny limit: ${val} MB/s` : 'Limit wyłączony';
        }catch(e){
          limInfo.textContent = 'Nie udało się ustawić limitu.';
        }
      }else{
        limInfo.textContent = val>0
          ? `Wybrano ${val} MB/s (do aktywacji wymagane API /torrents/commands/push).`
          : 'Limit wyłączony (wymagane API komend).';
      }
    });
  }

  // Render pojedynczego kafla
  function renderTorrentCard(t){
    const pct = (t.progress > 1 && t.progress <= 100) ? Math.round(t.progress) : Math.round((t.progress||0)*100);
    const speed = fmtSpeed(t.download_payload_rate || t.dl_speed || 0);
    const state = t.state || t.status || '';

    const wrapper = document.createElement('div');
    wrapper.className = 'torrent';
    wrapper.innerHTML = `
      <div class="torrent-name">${(t.name || t.display_title || '').replace(/</g,'&lt;')}</div>
      <div class="torrent-details">🚀 ${speed} &nbsp; • &nbsp; ${state}</div>
      <div class="progress-bar"><div class="progress-bar-inner" style="width:0%"></div></div>
      <div class="torrent-stats">
        <div class="left"></div>
        <div class="pct">${pct}%</div>
      </div>
    `;
    animateProgressBar($('.progress-bar-inner', wrapper), pct);
    return wrapper;
  }

  // Próba #1: prosty endpoint /status (mapa obiektów)
  async function fetchSimpleStatus(){
    const url = (authScreen?.dataset.apiBase||'') + '/status';
    const resp = await authFetch(url, { method:'GET' });
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    return resp.json();
  }

  // Próba #2: zaawansowany endpoint /torrents/status/list (wymaga device_id)
  async function fetchAdvancedList(){
    if(typeof window.activeDevice !== 'function' || !window.activeDevice()){
      throw new Error('Brak aktywnego urządzenia.');
    }
    const base = (authScreen?.dataset.apiBase||'');
    const qs = new URLSearchParams({device_id: window.activeDevice(), limit:'500', order:'desc'}).toString();
    const resp = await authFetch(base + '/torrents/status/list?' + qs, { method:'GET' });
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const j = await resp.json();
    if(!Array.isArray(j)) throw new Error('Nieprawidłowy format listy.');
    return j;
  }

  // Publiczny loader
  async function loadTorrents(){
    const container = $('#torrents');
    const summary   = $('#summary');
    if(!container || !summary) return;

    container.innerHTML = '';
    summary.textContent = 'Ładowanie…';

    let items = [];
    let mode = 'simple';

    // Najpierw spróbuj prosty /status
    try{
      const data = await fetchSimpleStatus(); // obiekt: { id: {...}, ... }
      const arr = Object.entries(data||{}).map(([id, v])=>({ id, ...v }));
      items = arr;
      mode = 'simple';
    }catch(_){
      // Jeśli się nie uda, spróbuj „zaawansowane”
      try{
        const list = await fetchAdvancedList(); // tablica rekordów
        items = list.map(r=>({
          id: r.info_hash,
          name: r.display_title || r.name,
          progress: r.progress,                 // 0..1
          download_payload_rate: r.dl_speed,    // B/s
          state: r.state || r.status
        }));
        mode = 'advanced';
      }catch(e2){
        summary.textContent = 'Brak danych (uruchom klienta lub sprawdź API).';
        return;
      }
    }

    // Sortowanie
    const sortKey = $('#sort')?.value || 'name';
    items.sort((a,b)=>{
      const A = a[sortKey], B = b[sortKey];
      if(typeof A === 'string') return A.localeCompare(B||'');
      return (A||0) - (B||0);
    });

    // Filtr widoków
    const filtered = items.filter(t=>{
      const pct = (t.progress > 1 ? t.progress : (t.progress||0)*100);
      const done = pct >= 100;
      return activeTorrentView === 'active' ? !done : done;
    });

    // Sumy
    let totalSpeed = 0, activeCount = 0;
    for(const t of items){
      totalSpeed += (t.download_payload_rate || 0);
      const st = (t.state || '').toLowerCase();
      if(st.includes('down') || st==='downloading') activeCount++;
    }

    // Render
    if(filtered.length === 0){
      container.innerHTML = `<div class="tor-help">Brak pozycji do wyświetlenia w tym widoku.</div>`;
    }else{
      const frag = document.createDocumentFragment();
      filtered.forEach(t=> frag.appendChild(renderTorrentCard(t)));
      container.appendChild(frag);
    }

    summary.textContent = `📊 Torrenty: ${items.length}  •  ⚡️ Prędkość: ${fmtSpeed(totalSpeed)}  •  🚀 Aktywne: ${activeCount}`;
  }

  // Eksport i start
  window.loadTorrents = loadTorrents;

  // Listeners
  const sortSel = $('#sort');
  if(sortSel) sortSel.addEventListener('change', loadTorrents);

  // Załaduj po zalogowaniu (jeśli app już widoczna, od razu)
  if(document.body.classList.contains('is-auth')) loadTorrents();
  // opcjonalnie: odśwież co X s
  setInterval(()=>{
    if(document.body.classList.contains('is-auth')) loadTorrents();
  }, 5000);
})();
