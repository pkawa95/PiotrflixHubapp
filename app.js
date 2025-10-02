// ====== Config ======
const API_BASE = "https://api.pkportfolio.pl";
const STORAGE_KEY = "pkp_auth_token";

// ====== Helpers ======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const setTheme = (mode) => {
  const html = document.documentElement;
  html.setAttribute("data-theme", mode);
  localStorage.setItem("pkp_theme", mode);
  const optDark = $("#opt-dark");
  if (optDark) optDark.checked = mode === "dark";
};

const toggleTheme = () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");

const showView = (idToShow) => {
  $$(".view").forEach(v => v.classList.add("is-hidden"));
  $(idToShow)?.classList.remove("is-hidden");
};

const showTab = (name) => {
  $$(".tab").forEach(t => t.classList.remove("is-active"));
  $(`#tab-${name}`)?.classList.add("is-active");
  $$(".nav-item").forEach(b => b.classList.remove("is-active"));
  $(`.nav-item[data-tab='${name}']`)?.classList.add("is-active");
};

const saveToken = (token) => localStorage.setItem(STORAGE_KEY, token);
const getToken = () => localStorage.getItem(STORAGE_KEY);
const clearToken = () => localStorage.removeItem(STORAGE_KEY);

const authFetch = async (url, options = {}) => {
  const token = getToken();
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || res.statusText);
  return res.json().catch(() => ({}));
};

// ====== Auth Screen Logic ======
const authCard = () => document.getElementById("auth-card");
const authTabsSel = () => $$(".auth-tab", authCard());
const panesSel = () => $$(".form-pane", authCard());
let currentPane = "login";

const activatePane = (name) => {
  currentPane = name;
  panesSel().forEach(p => p.classList.toggle("is-hidden", p.dataset.pane !== name));
  authTabsSel().forEach(t => {
    const on = t.dataset.tabTarget === name;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
};

const bindAuthUI = () => {
  const card = document.getElementById("auth-card");
  if (!card) return;

  // Delegacja clicków na zakładki
  card.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".auth-tab");
    if (!tabBtn || !card.contains(tabBtn)) return;
    const name = tabBtn.dataset.tabTarget;
    if (!name || name === currentPane) return;
    activatePane(name);
  });

  // Swipe (zostawiamy jak było)
  let startX = 0; let startY = 0; let dx = 0; let dy = 0; const threshold = 40;
  card.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0]; startX = t.clientX; startY = t.clientY; dx = dy = 0;
  }, { passive: true });
  card.addEventListener("touchmove", (e) => {
    const t = e.changedTouches[0]; dx = t.clientX - startX; dy = t.clientY - startY;
  }, { passive: true });
  card.addEventListener("touchend", () => {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      const names = ["login", "register"];
      const i = names.indexOf(currentPane);
      const next = dx < 0 ? Math.min(i + 1, names.length - 1) : Math.max(i - 1, 0);
      activatePane(names[next]);
    }
  });

  // Ustaw stan początkowy zgodnie z DOM
  const initiallyVisible = card.querySelector(".form-pane:not(.is-hidden)")?.dataset.pane || "login";
  activatePane(initiallyVisible);
};

// Validate helpers
const setError = (id, msg) => {
  const el = document.querySelector(`[data-error-for='${id}']`);
  if (el) el.textContent = msg || "";
  const input = document.getElementById(id);
  const group = input ? input.closest('.input-group') : null;
  if (group) group.classList.toggle('has-error', !!msg);
};
const required = (val) => !!(val && String(val).trim().length);

// Login
const bindAuthForms = () => {
  $("#login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    setError("login-email"); setError("login-password");
    let ok = true;
    if (!required(email)) { setError("login-email", "Podaj email"); ok = false; }
    if (!required(password)) { setError("login-password", "Podaj hasło"); ok = false; }
    if (!ok) return;

    const note = $("#login-status"); note.textContent = "Logowanie…";
    try {
      const data = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }).then(async r => { if (!r.ok) throw new Error(await r.text().catch(()=>"") || r.statusText); return r.json(); });
      const token = data.token || data.accessToken || data.jwt || null;
      if (!token) throw new Error("Brak tokenu w odpowiedzi API");
      saveToken(token);
      note.textContent = "Zalogowano ✔";
      bootApp();
    } catch (err) {
      note.textContent = `Błąd: ${err.message || err}`;
    }
  });

  // Register
  $("#register-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const firstName = $("#reg-firstname").value.trim();
    const lastName = $("#reg-lastname").value.trim();
    const email = $("#reg-email").value.trim();
    const password = $("#reg-password").value;
    const password2 = $("#reg-password2").value;

    ["reg-firstname","reg-lastname","reg-email","reg-password","reg-password2"].forEach(id => setError(id));
    let ok = true;
    if (!required(firstName)) { setError("reg-firstname", "Wymagane"); ok = false; }
    if (!required(lastName)) { setError("reg-lastname", "Wymagane"); ok = false; }
    if (!required(email)) { setError("reg-email", "Podaj email"); ok = false; }
    if (!required(password)) { setError("reg-password", "Podaj hasło"); ok = false; }
    if (password !== password2) { setError("reg-password2", "Hasła nie są identyczne"); ok = false; }
    if (!ok) return;

    const note = $("#register-status"); note.textContent = "Rejestracja…";
    try {
      await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password })
      }).then(async r => { if (!r.ok) throw new Error(await r.text().catch(()=>"") || r.statusText); return r.json(); });
      note.textContent = "Konto utworzone! Możesz się zalogować.";
      activatePane("login");
    } catch (err) {
      note.textContent = `Błąd: ${err.message || err}`;
    }
  });
};

// ====== App Logic ======
const bootApp = () => {
  if (getToken()) {
    showView("#app-view");
    // Initialize once the app view is visible
    setTheme(localStorage.getItem("pkp_theme") || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    wireApp();
  } else {
    showView("#auth-view");
  }
};

const wireApp = () => {
  // Elements (with guards so we don't throw if something's missing)
  const content = $(".content");
  if (!content) return;

  // Tabs click
  $$(".nav-item").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // Swipe between tabs in content
  let startX = 0; let startY = 0; let dx = 0; let dy = 0; const threshold = 60;
  const order = ["torrenty","wyszukaj","dostepne","opcje"];
  const currentIndex = () => order.findIndex(n => $(`#tab-${n}`)?.classList.contains("is-active"));

  content.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; startX = t.clientX; startY = t.clientY; dx = dy = 0; }, { passive: true });
  content.addEventListener("touchmove", (e) => { const t = e.changedTouches[0]; dx = t.clientX - startX; dy = t.clientY - startY; }, { passive: true });
  content.addEventListener("touchend", () => {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      const i = currentIndex();
      const next = dx < 0 ? Math.min(i + 1, order.length - 1) : Math.max(i - 1, 0);
      if (next !== i) showTab(order[next]);
    }
  });

  // Theme toggle
  $("#theme-toggle")?.addEventListener("click", toggleTheme);
  const optDark = $("#opt-dark");
  if (optDark) optDark.checked = document.documentElement.getAttribute("data-theme") === "dark";
  optDark?.addEventListener("change", (e) => setTheme(e.target.checked ? "dark" : "light"));

  // Logout
  $("#logout-btn")?.addEventListener("click", () => { clearToken(); showView("#auth-view"); });

  // Refresh token (placeholder: adjust to your API)
  $("#btn-refresh-token")?.addEventListener("click", async () => {
    try {
      const data = await authFetch(`${API_BASE}/auth/refresh`, { method: "POST" });
      const token = data.token || data.accessToken || data.jwt;
      if (token) { saveToken(token); alert("Token odświeżony"); }
      else { alert("API nie zwróciło nowego tokenu"); }
    } catch (e) { alert(`Nie udało się odświeżyć: ${e.message}`); }
  });

  // Search (replace with real endpoint)
  $("#search-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#search-input").value.trim();
    const box = $("#search-results");
    box.innerHTML = "Szukam…";
    try {
      const data = await authFetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
      const items = Array.isArray(data) ? data : (data.items || []);
      box.innerHTML = items.length ? items.map(it => `<div class='card' style='padding:12px'>${it.title || JSON.stringify(it)}</div>`).join("") : "Brak wyników";
    } catch (e) {
      box.innerHTML = `<span style='color:var(--error)'>Błąd wyszukiwania: ${e.message}</span>`;
    }
  });
};

// Example loader for "Dostępne" (adjust to your API shape)
async function loadAvailable() {
  try {
    const data = await authFetch(`${API_BASE}/available`);
    const items = Array.isArray(data) ? data : (data.items || []);
    const grid = $("#available-grid");
    if (!grid) return;
    grid.innerHTML = items.map(it => `
      <article class="card" style="padding:10px">
        <h3 style="margin:6px 6px 4px">${it.title || it.name || "Pozycja"}</h3>
        <p class="form-note" style="margin:0 6px 8px">${it.description || ""}</p>
      </article>`).join("");
  } catch (e) {
    const grid = $("#available-grid");
    if (grid) grid.innerHTML = `<div class='empty'><p>Nie udało się pobrać: ${e.message}</p></div>`;
  }
}

// Start
window.addEventListener("DOMContentLoaded", () => {
  // Theme from storage / system
  setTheme(localStorage.getItem("pkp_theme") || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  // Bind auth UI regardless (safe)
  bindAuthUI();
  bindAuthForms();

  // Auth gate
  if (getToken()) { showView("#app-view"); wireApp(); }
  else { showView("#auth-view"); }
});