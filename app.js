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

  // helpery
  const qs = sel => document.querySelector(sel);
  const qsa = sel => Array.from(document.querySelectorAll(sel));

  // Jeśli mamy token — pokaż app, ukryj auth
  const TOKEN_KEY = 'pf_token';
  const REMEMBER_KEY = 'pf_remember';

  function hasToken() {
    const t = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    return Boolean(t);
  }
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  }
  function setToken(token, remember) {
    // remember => localStorage, else => sessionStorage
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
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  function showApp() {
    if (authScreen) authScreen.hidden = true;
    if (appRoot) appRoot.hidden = false;
  }
  function showAuth() {
    if (authScreen) authScreen.hidden = false;
    if (appRoot) appRoot.hidden = true;
  }

  if (hasToken()) showApp();
  else showAuth();

  // ===================== Konfiguracja endpointów z data-*= =====================
  const apiBase = authScreen?.dataset.apiBase || '';
  const loginEndpoint = authScreen?.dataset.loginEndpoint || '/auth/login';
  const registerEndpoint = authScreen?.dataset.registerEndpoint || '/auth/register';

  const LOGIN_URL = apiBase + loginEndpoint;
  const REGISTER_URL = apiBase + registerEndpoint;

  // ===================== Zakładki & Slider (Zaloguj | Zarejestruj) =====================
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

    // przesunięcie slidera (0% lub -100%)
    if (panels) {
      panels.style.transform = `translateX(${isLogin ? '0%' : '-100%'})`;
    }
  }

  tabLogin?.addEventListener('click', () => setActiveTab('login'));
  tabRegister?.addEventListener('click', () => setActiveTab('register'));

  // Gesty przesunięcia (swipe)
  if (card && panels) {
    let startX = 0, currentX = 0, isDragging = false;
    let active = 'login';

    const onStart = (x) => {
      isDragging = true;
      startX = currentX = x;
      panels.style.transition = 'none';
    };
    const onMove = (x) => {
      if (!isDragging) return;
      currentX = x;
      const dx = currentX - startX;
      const base = active === 'login' ? 0 : -window.innerWidth;
      panels.style.transform = `translateX(${base + dx}px)`;
    };
    const onEnd = () => {
      if (!isDragging) return;
      const dx = currentX - startX;
      panels.style.transition = '';
      const threshold = Math.min(160, window.innerWidth * 0.25);
      if (active === 'login' && dx < -threshold) {
        active = 'register'; setActiveTab('register');
      } else if (active === 'register' && dx > threshold) {
        active = 'login'; setActiveTab('login');
      } else {
        setActiveTab(active);
      }
      isDragging = false;
    };

    // touch
    card.addEventListener('touchstart', e => onStart(e.touches[0].clientX), {passive: true});
    card.addEventListener('touchmove',  e => onMove(e.touches[0].clientX), {passive: true});
    card.addEventListener('touchend',   onEnd);

    // mouse (opcjonalnie)
    card.addEventListener('mousedown', e => onStart(e.clientX));
    window.addEventListener('mousemove', e => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    // zsynchronizuj aktywny ekran przy kliknięciu tabów
    tabLogin?.addEventListener('click', () => { active = 'login'; });
    tabRegister?.addEventListener('click', () => { active = 'register'; });
  }

  // ===================== Walidacja i helpery błędów =====================
  function setFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const err = document.getElementById(`${inputId}-error`);
    if (input) input.classList.toggle('form__input--invalid', Boolean(message));
    if (err) err.textContent = message || '';
  }
  function clearFormErrors(form) {
    form.querySelectorAll('.form__input').forEach(el => el.classList.remove('form__input--invalid'));
    form.querySelectorAll('.form__error').forEach(el => (el.textContent = ''));
  }
  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').toLowerCase());
  }

  // ===================== LOGOWANIE =====================
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
      const res = await fetch(LOGIN_URL, {
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

      // oczekujemy { token: '...' } — dostosuj jeśli API zwraca inaczej
      const token = data?.token;
      if (!token) {
        if (globalErr) globalErr.textContent = 'Brak tokenu w odpowiedzi serwera.';
        return;
      }

      setToken(token, remember);
      showApp();
    } catch (err) {
      if (globalErr) globalErr.textContent = 'Błąd sieci. Spróbuj ponownie.';
      console.error(err);
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  // ===================== REJESTRACJA =====================
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
      const res = await fetch(REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstname, lastname, email, password
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Spróbuj wyświetlić błędy per pole jeśli API zwraca słownik
        if (data?.errors && typeof data.errors === 'object') {
          for (const [key, msg] of Object.entries(data.errors)) {
            // mapowanie ewentualnych nazw z API -> ID inputów
            const map = {
              firstName: 'reg-firstname',
              firstname: 'reg-firstname',
              lastName:  'reg-lastname',
              lastname:  'reg-lastname',
              email:     'reg-email',
              password:  'reg-password',
            };
            const inputId = map[key] || '';
            if (inputId) setFieldError(inputId, String(msg));
          }
        }
        const msg = data?.message || data?.error || 'Rejestracja nie powiodła się.';
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      // Sukces — przełącz na panel logowania i pokaż komunikat
      setActiveTab('login');
      const loginGlobal = document.getElementById('login-global-error');
      if (loginGlobal) loginGlobal.textContent = 'Konto utworzone. Możesz się zalogować.';
    } catch (err) {
      if (globalErr) globalErr.textContent = 'Błąd sieci. Spróbuj ponownie.';
      console.error(err);
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  // ===================== Przykład użycia tokenu dalej =====================
  // Dla Twoich dalszych fetchy używaj getToken():
  // fetch(apiBase + '/protected', { headers: { Authorization: 'Bearer ' + getToken() }})
});
