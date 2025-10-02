/* ====== NAWIGACJA — izolowany JS ======
   - brak globalnych kolizji; używa tylko #nawigacja
   - jeżeli istnieje window.showSection, wywoła go
   - sekcje rozpoznaje po klasie .section i id: section-<name>
*/
(function(){
  const root = document.getElementById('nawigacja');
  if(!root) return;

  const btns = Array.from(root.querySelectorAll('.nawigacja__btn'));
  const STORAGE_KEY = 'nawigacja:lastSection';

  function setActive(section){
    // przyciski
    btns.forEach(b=>{
      const active = b.dataset.section === section;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // sekcje (jeśli są na stronie)
    document.querySelectorAll('.section').forEach(sec=>{
      const key = (sec.id || '').replace('section-','');
      const on = key === section;
      sec.classList.toggle('active', on);
      sec.hidden = !on;
    });

    try{ localStorage.setItem(STORAGE_KEY, section); }catch(_){}
    try{ history.replaceState(null, '', '#'+section); }catch(_){}
  }

  // podpinamy na klik
  root.addEventListener('click', (e)=>{
    const b = e.target.closest('.nawigacja__btn');
    if(!b) return;
    const section = b.dataset.section;
    setActive(section);

    // współpraca z istniejącą showSection()
    if (typeof window.showSection === 'function') {
      try { window.showSection(section); } catch(e) {}
    }
  });

  // start: hash > localStorage > domyślnie torrents
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

  // opcjonalnie udostępniamy API
  window.nawigacjaSetActive = setActive;
})();

/* ===================== UTIL: tryb jasny/ciemny ===================== */
(function themeSetup() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  // Wczytaj preferencję
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
  const appRoot = document.getElementById('app');
  const navRoot = document.getElementById('nawigacja');

  // helpery
  const qs = sel => document.querySelector(sel);

  // Klucze storage
  const TOKEN_KEY = 'pf_token';
  const REMEMBER_KEY = 'pf_remember';

  // Pamięć procesu (szybki dostęp)
  let inMemoryToken = null;

  /* ---------- Token helpers ---------- */
  function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
  }
  function hasToken() {
    return Boolean(inMemoryToken || getStoredToken());
  }
  function getToken() {
    return inMemoryToken || getStoredToken();
  }
  function setToken(token, remember) {
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
  function clearToken() {
    inMemoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch(e){}
  }

  // udostępnij minimalistyczne API globalnie
  window.getAuthToken = getToken;
  window.clearAuthToken = () => { clearToken(); showAuth(); };

  /* ---------- JWT expiry (jeśli API zwraca JWT) ---------- */
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
    if (!expMs) return; // jeśli nie JWT — pomiń
    const delta = expMs - Date.now();
    if (delta <= 0) {
      // już nieważny
      handleUnauthorized();
      return;
    }
    // delikatny limit, by nie ustawiać ekstremalnych timeoutów
    setTimeout(() => {
      // po wygaśnięciu jeszcze raz potwierdź 401 przy odświeżeniu danych, a tu tylko gating:
      handleUnauthorized('Sesja wygasła. Zaloguj się ponownie.');
    }, Math.min(delta, 2_147_000_000)); // ~24 dni max
  }

  /* ---------- Gating widoków ---------- */
  function showApp() {
    if (authScreen) authScreen.hidden = true;
    if (appRoot) appRoot.hidden = false;
    if (navRoot) navRoot.hidden = false;
  }
  function showAuth(message) {
    if (authScreen) authScreen.hidden = false;
    if (appRoot) appRoot.hidden = true;
    if (navRoot) navRoot.hidden = true;
    if (message) {
      const el = document.getElementById('login-global-error');
      if (el) el.textContent = message;
    }
  }
  function handleAuthorized(token) {
    setToken(token, (localStorage.getItem(REMEMBER_KEY) === '1')); // zachowaj preferencję
    showApp();
    scheduleAutoLogout(token);
  }
  function handleUnauthorized(msg) {
    clearToken();
    showAuth(msg || 'Sesja wygasła lub nieautoryzowana.');
  }

  // Start — ustaw token i gating
  const existing = getStoredToken();
  if (existing) {
    inMemoryToken = existing;
    showApp();
    scheduleAutoLogout(existing);
  } else {
    showAuth();
  }

  /* ---------- authFetch: automatyczne Authorization + 401 ---------- */
  async function authFetch(input, init = {}) {
    const token = getToken();
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // JSON helper (jeśli body jest obiektem)
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
  // udostępnij globalnie
  window.authFetch = authFetch;

  /* ---------- Konfiguracja endpointów z data-* ---------- */
  const apiBase = authScreen?.dataset.apiBase || '';
  const loginEndpoint = authScreen?.dataset.loginEndpoint || '/auth/login';
  const registerEndpoint = authScreen?.dataset.registerEndpoint || '/auth/register';

  const LOGIN_URL = apiBase + loginEndpoint;
  const REGISTER_URL = apiBase + registerEndpoint;

  /* ---------- Zakładki & Slider (Zaloguj | Zarejestruj) ---------- */
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const panelLogin = document.getElementById('panel-login');
  const panelRegister = document.getElementById('panel-register');
  const panels = qs('.auth__panels');
  const card = qs('.auth__card');

  function setActiveTab(view) {
    const isLogin = view === 'login';

    // zakładki
    tabLogin?.classList.toggle('is-active', isLogin);
    tabLogin?.setAttribute('aria-selected', String(isLogin));
    tabLogin?.setAttribute('tabindex', isLogin ? '0' : '-1');

    tabRegister?.classList.toggle('is-active', !isLogin);
    tabRegister?.setAttribute('aria-selected', String(!isLogin));
    tabRegister?.setAttribute('tabindex', !isLogin ? '0' : '-1');

    // panele
    panelLogin?.setAttribute('aria-hidden', String(!isLogin));
    panelRegister?.setAttribute('aria-hidden', String(isLogin));

    // slider
    if (panels) panels.style.transform = `translateX(${isLogin ? '0%' : '-100%'})`;
  }

  tabLogin?.addEventListener('click', () => setActiveTab('login'));
  tabRegister?.addEventListener('click', () => setActiveTab('register'));

  // Gesty przesunięcia (swipe)
  if (card && panels) {
    let startX = 0, currentX = 0, isDragging = false;
    let active = 'login';

    const onStart = (x) => { isDragging = true; startX = currentX = x; panels.style.transition = 'none'; };
    const onMove  = (x) => { if (!isDragging) return; currentX = x; const dx = currentX - startX; const base = active === 'login' ? 0 : -window.innerWidth; panels.style.transform = `translateX(${base + dx}px)`; };
    const onEnd   = () => {
      if (!isDragging) return;
      const dx = currentX - startX; panels.style.transition = '';
      const threshold = Math.min(160, window.innerWidth * 0.25);
      if (active === 'login' && dx < -threshold) { active = 'register'; setActiveTab('register'); }
      else if (active === 'register' && dx > threshold) { active = 'login'; setActiveTab('login'); }
      else { setActiveTab(active); }
      isDragging = false;
    };

    // touch
    card.addEventListener('touchstart', e => onStart(e.touches[0].clientX), {passive: true});
    card.addEventListener('touchmove',  e => onMove(e.touches[0].clientX), {passive: true});
    card.addEventListener('touchend',   onEnd);
    // mouse
    card.addEventListener('mousedown', e => onStart(e.clientX));
    window.addEventListener('mousemove', e => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    tabLogin?.addEventListener('click', () => { active = 'login'; });
    tabRegister?.addEventListener('click', () => { active = 'register'; });
  }

  /* ---------- Walidacja i helpery błędów ---------- */
  function setFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const err = document.getElementById(`${inputId}-error`);
    if (input) input.classList.toggle('form__input--invalid', !!message);
    if (err) err.textContent = message || '';
  }
  function clearFormErrors(form) {
    form.querySelectorAll('.form__input').forEach(el => el.classList.remove('form__input--invalid'));
    form.querySelectorAll('.form__error').forEach(el => (el.textContent = ''));
  }
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').toLowerCase());

  /* ---------- LOGOWANIE ---------- */
  const loginForm = document.getElementById('form-login');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (loginForm.querySelector('#login-email') || {}).value?.trim();
    const password = (loginForm.querySelector('#login-password') || {}).value;
    const remember = (loginForm.querySelector('#login-remember') || {}).checked;
    const globalErr = document.getElementById('login-global-error');

    clearFormErrors(loginForm);
    let hasErr = false;

    if (!email) { setFieldError('login-email', 'Podaj adres e-mail.'); hasErr = true; }
    else if (!isEmail(email)) { setFieldError('login-email', 'Nieprawidłowy adres e-mail.'); hasErr = true; }
    if (!password) { setFieldError('login-password', 'Podaj hasło.'); hasErr = true; }
    if (hasErr) return;

    // Zablokuj UI
    const btn = loginForm.querySelector('[data-action="login-submit"]');
    btn?.setAttribute('disabled', 'true');

    try {
      const res = await fetch(apiBase + loginEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.message || data?.error || 'Logowanie nie powiodło się.';
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      // oczekujemy { token: '...' }
      const token = data?.token;
      if (!token) { if (globalErr) globalErr.textContent = 'Brak tokenu w odpowiedzi serwera.'; return; }

      // zapisz preferencję remember zanim setToken
      try { remember ? localStorage.setItem(REMEMBER_KEY,'1') : localStorage.removeItem(REMEMBER_KEY); } catch(_){}
      setToken(token, remember);
      handleAuthorized(token);
    } catch (err) {
      if (globalErr) globalErr.textContent = 'Błąd sieci. Spróbuj ponownie.';
      console.error(err);
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  /* ---------- REJESTRACJA ---------- */
  const registerForm = document.getElementById('form-register');
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstname = (registerForm.querySelector('#reg-firstname') || {}).value?.trim();
    const lastname  = (registerForm.querySelector('#reg-lastname') || {}).value?.trim();
    const email     = (registerForm.querySelector('#reg-email') || {}).value?.trim();
    const password  = (registerForm.querySelector('#reg-password') || {}).value;
    const password2 = (registerForm.querySelector('#reg-password2') || {}).value;
    const globalErr = document.getElementById('register-global-error');

    clearFormErrors(registerForm);

    let hasErr = false;
    if (!firstname) { setFieldError('reg-firstname', 'Podaj imię.'); hasErr = true; }
    if (!lastname)  { setFieldError('reg-lastname', 'Podaj nazwisko.'); hasErr = true; }
    if (!email)     { setFieldError('reg-email', 'Podaj adres e-mail.'); hasErr = true; }
    else if (!isEmail(email)) { setFieldError('reg-email', 'Nieprawidłowy adres e-mail.'); hasErr = true; }
    if (!password)  { setFieldError('reg-password', 'Ustaw hasło.'); hasErr = true; }
    if (!password2) { setFieldError('reg-password2', 'Powtórz hasło.'); hasErr = true; }
    if (password && password2 && password !== password2) {
      setFieldError('reg-password2', 'Hasła muszą być identyczne.');
      hasErr = true;
    }
    if (hasErr) return;

    // Zablokuj UI
    const btn = registerForm.querySelector('[data-action="register-submit"]');
    btn?.setAttribute('disabled', 'true');

    try {
      const res = await fetch(apiBase + registerEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstname, lastname, email, password })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.errors && typeof data.errors === 'object') {
          for (const [key, msg] of Object.entries(data.errors)) {
            const map = { firstName:'reg-firstname', firstname:'reg-firstname', lastName:'reg-lastname', lastname:'reg-lastname', email:'reg-email', password:'reg-password' };
            const inputId = map[key] || '';
            if (inputId) setFieldError(inputId, String(msg));
          }
        }
        const msg = data?.message || data?.error || 'Rejestracja nie powiodła się.';
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      // Jeśli API zwraca token po rejestracji → zaloguj od razu
      if (data?.token) {
        try { localStorage.setItem(REMEMBER_KEY,'1'); } catch(_){}
        setToken(data.token, true);
        handleAuthorized(data.token);
        return;
      }

      // W innym wypadku przełącz na logowanie
      const loginGlobal = document.getElementById('login-global-error');
      if (loginGlobal) loginGlobal.textContent = 'Konto utworzone. Możesz się zalogować.';
      setActiveTab('login');
    } catch (err) {
      if (globalErr) globalErr.textContent = 'Błąd sieci. Spróbuj ponownie.';
      console.error(err);
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  /* ---------- Cross-tab sync (wylogowanie w innych kartach) ---------- */
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY || e.key === REMEMBER_KEY) {
      // gdy token zniknie w innej karcie → wyloguj i schowaj app
      if (!getStoredToken()) handleUnauthorized();
      else handleAuthorized(getStoredToken());
    }
  });

  /* ---------- Przykład: użycie tokenu w dalszych zapytaniach ----------
     authFetch(apiBase + '/protected/endpoint')
       .then(r => r.json())
       .then(console.log)
       .catch(console.error);
  --------------------------------------------------------------------- */
});
