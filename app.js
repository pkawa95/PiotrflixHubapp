/* ====== NAWIGACJA — izolowany JS ====== */
(function () {
  const root = document.getElementById("nawigacja");
  if (!root) return;

  const btns = Array.from(root.querySelectorAll(".nawigacja__btn"));
  const STORAGE_KEY = "nawigacja:lastSection";

  function setActive(section) {
    btns.forEach((b) => {
      const active = b.dataset.section === section;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });

    // pokaż/ukryj panele w <main>
    document.querySelectorAll("#content > section").forEach((sec) => {
      const key = (sec.id || "").replace("section-", "");
      const on = key === section;
      sec.hidden = !on;
      sec.setAttribute("aria-hidden", on ? "false" : "true");
    });

    try {
      localStorage.setItem(STORAGE_KEY, section);
    } catch (_) {}
    try {
      history.replaceState(null, "", "#" + section);
    } catch (_) {}
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest(".nawigacja__btn");
    if (!b) return;
    const section = b.dataset.section;
    setActive(section);
    if (typeof window.showSection === "function") {
      try {
        window.showSection(section);
      } catch (e) {}
    }
  });

  let start = "torrents";
  const hash = (location.hash || "").replace("#", "");
  if (/^(torrents|queue)$/.test(hash)) start = hash;
  else {
    try {
      const ls = localStorage.getItem(STORAGE_KEY);
      if (ls) start = ls;
    } catch (_) {}
  }
  setActive(start);

  window.nawigacjaSetActive = setActive;
})();

/* ===================== UTIL: tryb jasny/ciemny ===================== */
(function themeSetup() {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  const stored = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = stored || (prefersDark ? "dark" : "light");
  root.setAttribute("data-theme", initial);
  btn.setAttribute("aria-pressed", String(initial === "dark"));

  btn.addEventListener("click", () => {
    const now = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", now);
    btn.setAttribute("aria-pressed", String(now === "dark"));
    localStorage.setItem("theme", now);
  });
})();

/* ===================== AUTH & GATING (v3 z auto-refresh) ===================== */
document.addEventListener("DOMContentLoaded", () => {
  const authScreen = document.getElementById("auth-screen");
  const appRoot = document.getElementById("app");
  const navRoot = document.getElementById("nawigacja");

  const joinUrl = (base, path) => {
    if (!base) return path || "";
    if (!path) return base;
    return `${base.replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
  };

  const TOKEN_KEY = "pf_token";
  const REFRESH_KEY = "pf_refresh";
  const REMEMBER_KEY = "pf_remember";
  let inMemoryToken = null;
  let refreshingPromise = null;

  const apiBase = authScreen?.dataset.apiBase || "";
  const loginEndpoint = authScreen?.dataset.loginEndpoint || "/auth/login";
  const registerEndpoint =
    authScreen?.dataset.registerEndpoint || "/auth/register";
  const refreshEndpoint = "/auth/refresh";

  /* ------------ tokeny ------------- */
  const getStoredToken = () =>
    localStorage.getItem(TOKEN_KEY) ||
    sessionStorage.getItem(TOKEN_KEY) ||
    null;
  const getToken = () => inMemoryToken || getStoredToken();
  const getRefreshToken = () => localStorage.getItem(REFRESH_KEY) || null;

  function setToken(token, remember) {
    inMemoryToken = token || null;
    try {
      if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(REMEMBER_KEY, "1");
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {}
  }
  function setRefreshToken(rt) {
    try {
      if (rt) localStorage.setItem(REFRESH_KEY, rt);
      else localStorage.removeItem(REFRESH_KEY);
    } catch {}
  }
  function clearToken() {
    inMemoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(REMEMBER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
  }
  window.getAuthToken = getToken;
  window.clearAuthToken = () => {
    clearToken();
    showAuth();
  };

  /* --------- UI gating ---------- */
  function hardHide(el) {
    if (!el) return;
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.style.display = "none";
  }
  function hardShow(el, display = "block") {
    if (!el) return;
    el.hidden = false;
    el.removeAttribute("aria-hidden");
    el.style.display = display;
  }

  function showApp() {
    document.body.classList.add("is-auth");
    hardHide(authScreen);
    hardShow(appRoot);
    hardShow(navRoot, "grid");
  }
  function showAuth(msg) {
    document.body.classList.remove("is-auth");
    hardShow(authScreen);
    hardHide(appRoot);
    hardHide(navRoot);
    if (msg) {
      const el = document.getElementById("login-global-error");
      if (el) el.textContent = msg;
    }
  }

  function getJwtExpMs(token) {
    try {
      const b64 = token.split(".")[1];
      if (!b64) return null;
      const json = JSON.parse(
        atob(b64.replace(/-/g, "+").replace(/_/g, "/"))
      );
      return json?.exp ? json.exp * 1000 : null;
    } catch {
      return null;
    }
  }
  function scheduleAutoLogout(token) {
    const exp = getJwtExpMs(token);
    if (!exp) return;
    const delta = exp - Date.now();
    if (delta <= 0) {
      handleUnauthorized();
      return;
    }
    setTimeout(
      () => handleUnauthorized("Sesja wygasła. Zaloguj się ponownie."),
      Math.min(delta, 2147000000)
    );
  }

  function handleAuthorized(access, refresh) {
    setToken(access, localStorage.getItem(REMEMBER_KEY) === "1");
    if (refresh) setRefreshToken(refresh);
    showApp();
    scheduleAutoLogout(access);
    window.dispatchEvent(new CustomEvent("pf:authorized"));
  }
  function handleUnauthorized(msg) {
    clearToken();
    showAuth(msg || "Sesja wygasła lub nieautoryzowana.");
    window.dispatchEvent(new CustomEvent("pf:unauthorized"));
  }

  // start
  const existing = getStoredToken();
  if (existing) {
    inMemoryToken = existing;
    showApp();
    scheduleAutoLogout(existing);
  } else {
    showAuth();
  }

  /* --------- AUTO-REFRESH TOKENU + authFetch ---------- */
  async function refreshAccessTokenOnce() {
    if (refreshingPromise) return refreshingPromise;
    const rt = getRefreshToken();
    if (!rt) throw new Error("no-refresh");
    refreshingPromise = (async () => {
      const r = await fetch(joinUrl(apiBase, refreshEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!r.ok) throw new Error("refresh-failed:" + r.status);
      const data = await r.json().catch(() => ({}));
      const newAccess = data?.access_token || data?.token;
      const newRefresh = data?.refresh_token || rt;
      if (!newAccess) throw new Error("refresh-no-access");
      handleAuthorized(newAccess, newRefresh);
      return newAccess;
    })();
    try {
      return await refreshingPromise;
    } finally {
      refreshingPromise = null;
    }
  }

  function addTokenToUrl(u, token) {
    try {
      const url = new URL(u, location.href);
      if (token) url.searchParams.set("access_token", token);
      return url.toString();
    } catch {
      return u;
    }
  }

  async function authFetch(input, init = {}) {
    let token = getToken();
    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && typeof init.body === "object" && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(init.body);
    }

    const url = typeof input === "string" ? addTokenToUrl(input, token) : input;
    let resp = await fetch(url, { ...init, headers });
    if (resp.status !== 401) return resp;

    try {
      token = await refreshAccessTokenOnce();
      const headers2 = new Headers(init.headers || {});
      if (token) headers2.set("Authorization", `Bearer ${token}`);
      if (init.body && typeof init.body === "string") {
        headers2.set("Content-Type", "application/json");
      }
      const url2 =
        typeof input === "string" ? addTokenToUrl(input, token) : input;
      const retry = await fetch(url2, { ...init, headers: headers2 });
      if (retry.status === 401) {
        handleUnauthorized();
        throw new Error("Unauthorized");
      }
      return retry;
    } catch (e) {
      handleUnauthorized();
      throw e instanceof Error ? e : new Error("Unauthorized");
    }
  }
  window.authFetch = authFetch;

  /* ---------- Walidacja ---------- */
  function setFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const err = document.getElementById(`${inputId}-error`);
    if (input) input.classList.toggle("form__input--invalid", !!message);
    if (err) err.textContent = message || "";
  }
  function clearFormErrors(form) {
    form
      .querySelectorAll(".form__input")
      .forEach((el) => el.classList.remove("form__input--invalid"));
    form.querySelectorAll(".form__error").forEach((el) => (el.textContent = ""));
  }
  const isEmail = (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").toLowerCase());

  /* ---------- LOGOWANIE ---------- */
  const loginForm = document.getElementById("form-login");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.querySelector("#login-email")?.value?.trim();
    const password = loginForm.querySelector("#login-password")?.value;
    const remember = loginForm.querySelector("#login-remember")?.checked;
    const globalErr = document.getElementById("login-global-error");

    clearFormErrors(loginForm);
    if (!email || !isEmail(email) || !password) {
      setFieldError("login-email", !email ? "Podaj adres e-mail." : !isEmail(email) ? "Nieprawidłowy adres e-mail." : "");
      setFieldError("login-password", !password ? "Podaj hasło." : "");
      return;
    }

    const btn = loginForm.querySelector('[data-action="login-submit"]');
    btn?.setAttribute("disabled", "true");

    try {
      try {
        remember
          ? localStorage.setItem(REMEMBER_KEY, "1")
          : localStorage.removeItem(REMEMBER_KEY);
      } catch (_) {}

      const res = await fetch(joinUrl(apiBase, loginEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || `Błąd ${res.status}`;
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      const access = data?.access_token || data?.token;
      const refresh = data?.refresh_token || null;
      if (!access) {
        if (globalErr) globalErr.textContent = "Brak tokenu w odpowiedzi serwera.";
        return;
      }
      handleAuthorized(access, refresh);
    } catch (err) {
      if (globalErr) globalErr.textContent = "Błąd sieci / CORS. Uruchom przez http(s).";
      console.error(err);
    } finally {
      btn?.removeAttribute("disabled");
    }
  });

  /* ---------- REJESTRACJA (z automatycznym logowaniem) ---------- */
  const registerForm = document.getElementById("form-register");
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const first_name = registerForm.querySelector("#reg-firstname")?.value?.trim();
    const last_name = registerForm.querySelector("#reg-lastname")?.value?.trim();
    const email = registerForm.querySelector("#reg-email")?.value?.trim();
    const password = registerForm.querySelector("#reg-password")?.value;
    const password2 = registerForm.querySelector("#reg-password2")?.value;
    const globalErr = document.getElementById("register-global-error");

    clearFormErrors(registerForm);
    let bad = false;
    if (!first_name) {
      setFieldError("reg-firstname", "Podaj imię.");
      bad = true;
    }
    if (!last_name) {
      setFieldError("reg-lastname", "Podaj nazwisko.");
      bad = true;
    }
    if (!email || !isEmail(email)) {
      setFieldError("reg-email", !email ? "Podaj adres e-mail." : "Nieprawidłowy adres e-mail.");
      bad = true;
    }
    if (!password) {
      setFieldError("reg-password", "Ustaw hasło.");
      bad = true;
    }
    if (!password2 || password2 !== password) {
      setFieldError("reg-password2", !password2 ? "Powtórz hasło." : "Hasła muszą być identyczne.");
      bad = true;
    }
    if (bad) return;

    const btn = registerForm.querySelector('[data-action="register-submit"]');
    btn?.setAttribute("disabled", "true");

    try {
      const res = await fetch(joinUrl(apiBase, registerEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name, last_name, email, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || `Błąd ${res.status}`;
        if (globalErr) globalErr.textContent = msg;
        return;
      }

      const access = data?.access_token || data?.token;
      const refresh = data?.refresh_token || null;
      if (!access) {
        if (globalErr) globalErr.textContent = "Konto utworzone, ale brak tokenu.";
        return;
      }
      localStorage.setItem(REMEMBER_KEY, "1");
      handleAuthorized(access, refresh);
    } catch (err) {
      if (globalErr) globalErr.textContent = "Błąd sieci / CORS. Spróbuj ponownie.";
      console.error(err);
    } finally {
      btn?.removeAttribute("disabled");
    }
  });

  /* ---------- Cross-tab sync ---------- */
  window.addEventListener("storage", (e) => {
    if (e.key === TOKEN_KEY || e.key === REMEMBER_KEY) {
      const t = getStoredToken();
      if (!t) handleUnauthorized();
      else handleAuthorized(t, getRefreshToken());
    }
  });
});
/* -------------------- TORRENTS & QUEUE (v3 z auto-refresh) -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const section = document.getElementById("section-torrents");
  if (!section) return;

  // ✅ API base także z pf_base (jak w test panelu)
  const API =
    document.getElementById("auth-screen")?.dataset.apiBase ||
    localStorage.getItem("pf_base") ||
    "";

  const joinUrl = (b, p) =>
    `${(b || "").replace(/\/+$/, "")}/${String(p || "").replace(/^\/+/, "")}`;

  const elTorrents = section.querySelector("#tx-torrents");
  const elQueue = section.querySelector("#tx-queue");
  const sortSel = section.querySelector("#tx-sort");
  const speedSel = section.querySelector("#tx-speed");
  const speedFb = section.querySelector("#tx-speed-feedback");
  const qStatusSel = section.querySelector("#tx-q-status");

  // ✅ ZAWSZE zdefiniuj tabBar z guardem (usuwa błąd z konsoli)
  const tabBar = section.querySelector(".tx-tabs") || null;
  const toolbars = section.querySelectorAll(".tx-toolbar");

  let currentTab = "torrents";
  let refreshTimer = null;

  // helpers
  const pct = (p) => {
    const v = Number(p ?? 0);
    if (Number.isFinite(v)) {
      if (v <= 1.01) return Math.max(0, Math.min(100, v * 100));
      return Math.max(0, Math.min(100, v));
    }
    return 0;
  };
  const humanSpeed = (bps) => {
    const x = Number(bps || 0);
    if (x <= 0) return "0 B/s";
    const u = ["B/s", "KB/s", "MB/s", "GB/s"];
    let i = 0, n = x;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${u[i]}`;
  };
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => (
      { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]
    ));

  // ✅ UI — bezpieczne taby
  function setTab(tab) {
    currentTab = tab;
    elTorrents.hidden = tab !== "torrents";
    elQueue.hidden = tab !== "queue";
    toolbars.forEach((tb) => (tb.hidden = tb.dataset.txTools !== tab));
    if (tabBar) {
      tabBar.querySelectorAll(".tx-tab").forEach((b) => {
        const on = b.dataset.txTab === tab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    kickRefresh();
  }
  if (tabBar) {
    tabBar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tx-tab]");
      if (!btn) return;
      const tab = btn.dataset.txTab;
      if (tab && tab !== currentTab) setTab(tab);
    });
  }

  // ✅ limit downloadu (globalny)
  speedSel?.addEventListener("change", async () => {
    const val = Number(speedSel.value || 0); // MB/s
    const kib = val > 0 ? Math.round(val * 1024) : 0; // KiB/s
    speedFb.textContent = "Ustawianie limitu…";
    try {
      const r = await window.authFetch(joinUrl(API, "/torrent/set-limit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit_kib_per_s: kib }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      speedFb.textContent = kib > 0 ? `Limit: ${val} MB/s` : "Limit zdjęty";
    } catch {
      speedFb.textContent = "Błąd ustawiania limitu";
    } finally {
      setTimeout(() => (speedFb.textContent = ""), 1600);
    }
  });

  // ── AUTH guard (unikamy 401 i mówimy userowi co jest grane)
  const tokenOk = () => !!(window.getAuthToken && window.getAuthToken());
  function showNeedLogin() {
    elTorrents.innerHTML = `<div class="tx-empty">Musisz się zalogować (brak tokenu).</div>`;
  }

  // ── Devices
  async function fetchDeviceIds() {
    if (!tokenOk()) return [];
    try {
      const r = await window.authFetch(joinUrl(API, "/torrents/devices"));
      const data = await r.json().catch(() => ([]));
      if (Array.isArray(data) && data.length) {
        return data.map(d => d?.device_id).filter(Boolean).map(String);
      }
    } catch (_) {}
    // fallback na /devices/online
    try {
      const r2 = await window.authFetch(joinUrl(API, "/devices/online"));
      const data2 = await r2.json().catch(() => ([]));
      if (Array.isArray(data2) && data2.length) {
        return data2.map(d => d?.device_id || d?.id).filter(Boolean).map(String);
      }
    } catch (_) {}
    return [];
  }

  async function fetchTorrentsForDevice(devId) {
    try {
      const url = new URL(joinUrl(API, "/torrents/status/list"));
      url.searchParams.set("device_id", devId);
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", "200");
      url.searchParams.set("order", "desc");
      const r = await window.authFetch(url.toString());
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
      arr.forEach(it => { if (!it.device_id) it.device_id = devId; });
      return arr;
    } catch {
      return [];
    }
  }

  // ── GŁÓWNY loader — agregacja po wszystkich device_id
  async function loadTorrents() {
    if (!tokenOk()) { showNeedLogin(); return; }
    try {
      let items = [];
      const devices = await fetchDeviceIds();

      if (devices.length) {
        const jobs = devices.map(fetchTorrentsForDevice);
        const res = await Promise.allSettled(jobs);
        items = res.flatMap(x => x.status === "fulfilled" ? x.value : []);
      } else {
        // fallback: globalne listowanie (gdy backend tak zwraca)
        const url = new URL(joinUrl(API, "/torrents/status/list"));
        url.searchParams.set("page", "1");
        url.searchParams.set("limit", "200");
        const r = await window.authFetch(url.toString());
        const j = await r.json().catch(() => ({}));
        items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
      }

      // pomiń usunięte
      items = items.filter(it => String(it.state || "").toLowerCase() !== "removed");

      // sort
      const s = sortSel?.value || "name";
      if (s === "progress") {
        items.sort((a, b) =>
          pct(a.progress ?? a.progress_percent ?? a.percent) -
          pct(b.progress ?? b.progress_percent ?? b.percent)
        ).reverse();
      } else if (s === "state") {
        items.sort((a, b) => String(a.state || "").localeCompare(String(b.state || "")));
      } else {
        items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      }

      renderTorrents(items);
    } catch (e) {
      console.error("loadTorrents:", e);
      elTorrents.innerHTML = `<div class="tx-empty">Nie udało się pobrać torrentów.</div>`;
    }
  }

  function renderTorrents(items) {
    if (!items.length) {
      elTorrents.innerHTML = `<div class="tx-empty">Brak aktywnych torrentów.</div>`;
      return;
    }
    const html = items.map((it) => {
      const name = it.name || it.display_title || it.title || "Nieznany";
      const progress = pct(it.progress ?? it.progress_percent ?? it.percent ?? 0);
      const rate = humanSpeed(
        it.download_rate_bps ??
        it.downloadSpeedBps ??
        it.download_rate ??
        it.dl_rate ??
        it.download ?? 0
      );
      const state = (it.state || "unknown").toUpperCase();
      const ihash = it.info_hash || it.hash || it.id || name;
      const devId = it.device_id || it.device || "";

      return `
      <article class="tcard" data-ih="${esc(ihash)}" data-dev="${esc(devId)}">
        <div class="tcard__left">
          <div class="tcard__title">${esc(name)}</div>
          <div class="tcard__meta">
            <span>${progress.toFixed(0)}%</span><span>•</span>
            <span>${esc(state)}</span><span>•</span>
            <span>${esc(rate)}</span>
            ${devId ? `<span>•</span><span class="tbadge"><span class="tbadge__dot"></span>${esc(devId)}</span>` : ""}
          </div>
          <div class="tcard__progress"><div class="tcard__bar" style="width:${progress}%;"></div></div>
        </div>
        <div class="tcard__right">
          <button class="tbtn tbtn--ghost"  data-action="pause">Pauza/Wznów</button>
          <button class="tbtn tbtn--danger" data-action="remove" data-rm="0">Usuń</button>
          <button class="tbtn tbtn--danger" data-action="remove" data-rm="1" title="Usuń z danymi">Usuń + dane</button>
        </div>
      </article>`;
    }).join("");
    if (elTorrents.innerHTML !== html) elTorrents.innerHTML = html;
  }

  // ✅ Akcje: zawsze z device_id (trafiamy w właściwego klienta)
  elTorrents?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".tcard");
    const ih = card?.dataset.ih || "";
    const dev = card?.dataset.dev || "";
    const action = btn.dataset.action;

    try {
      if (action === "pause") {
        await window.authFetch(joinUrl(API, "/torrent/toggle"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ torrent_id: ih, device_id: dev || undefined }),
        });
      } else if (action === "remove") {
        const rm = btn.dataset.rm === "1";
        await window.authFetch(joinUrl(API, "/torrent/remove"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ torrent_id: ih, remove_data: rm, device_id: dev || undefined }),
        });
      }
      setTimeout(loadTorrents, 300);
    } catch (err) {
      console.error(err);
    }
  });

  sortSel?.addEventListener("change", loadTorrents);

  // ── Auto-refresh: tylko gdy jest token
  function tick() { currentTab === "torrents" ? loadTorrents() : loadQueue(); }
  function kickRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (!tokenOk()) { showNeedLogin(); return; }
    tick();
    refreshTimer = setInterval(tick, 3000);
  }
  window.addEventListener("pf:authorized", kickRefresh);
  window.addEventListener("pf:unauthorized", () => {
    if (refreshTimer) clearInterval(refreshTimer);
    showNeedLogin();
  });

  // start
  setTab("torrents");

  // ── kolejka (bez zmian)
  async function loadQueue() {
    if (!tokenOk()) { elQueue.innerHTML = `<div class="tx-empty">Musisz się zalogować.</div>`; return; }
    try {
      const url = new URL(joinUrl(API, "/queue/list"));
      url.searchParams.set("status", qStatusSel?.value || "all");
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", "50");
      const r = await window.authFetch(url.toString());
      const data = await r.json().catch(() => ({}));
      renderQueue(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      console.error("loadQueue:", e);
      elQueue.innerHTML = `<div class="tx-empty">Nie udało się pobrać kolejki.</div>`;
    }
  }
  function renderQueue(items) {
    if (!items.length) {
      elQueue.innerHTML = `<div class="tx-empty">Brak elementów w kolejce.</div>`;
      return;
    }
    const html = items.map((it) => {
      const title = it.display_title || it.payload?.display_title || it.payload?.title || it.kind || "Zadanie";
      const poster = it.image_url || it.payload?.image_url || it.payload?.poster || it.payload?.thumb || "https://via.placeholder.com/300x450?text=Poster";
      const when = it.created_at ? new Date(it.created_at).toLocaleString() : "";
      return `
      <article class="qcard" data-qid="${it.id}">
        <img class="qcard__img" src="${esc(poster)}" alt="" onerror="this.src='https://via.placeholder.com/300x450?text=Poster'">
        <div>
          <div class="qcard__title">${esc(title)}</div>
          <div class="qcard__meta"><span>ID: ${it.id}</span><span>•</span><span>Dodano: ${esc(when)}</span>${it.kind ? `<span>•</span><span>${esc(it.kind)}</span>` : ""}</div>
        </div>
        <div class="qcard__right"><button class="tbtn tbtn--danger" data-qdel="${it.id}">Usuń</button></div>
      </article>`;
    }).join("");
    if (elQueue.innerHTML !== html) elQueue.innerHTML = html;
  }
  elQueue?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-qdel]");
    if (!btn) return;
    try {
      await window.authFetch(joinUrl(API, `/queue/${btn.dataset.qdel}`), { method: "DELETE" });
      setTimeout(loadQueue, 200);
    } catch (err) {
      console.error(err);
    }
  });
});

/* ===================== PIOTRFLIX — SEARCH (final) ===================== */
(function(){
  const section = document.getElementById('section-search');
  if (!section) return;

  // --- API / auth ---
  const API =
    document.getElementById('auth-screen')?.dataset.apiBase ||
    localStorage.getItem('pf_base') || '';
  const joinUrl = (b, p) => `${(b||'').replace(/\/+$/,'')}/${String(p||'').replace(/^\/+/, '')}`;
  const tokenOk = () => !!(window.getAuthToken && window.getAuthToken());
  const getTmdbKey = () =>
    document.getElementById('auth-screen')?.dataset.tmdbKey ||
    localStorage.getItem('tmdb_api_key') || '';

  // --- Elements ---
  const tabs = Array.from(section.querySelectorAll('.tx-tab')); // data-mode: yts_html | tpb_premium | tpb_series
  const inputQ = section.querySelector('#sx-q');
  const selQuality = section.querySelector('#sx-quality');
  const qualityWrap = section.querySelector('#sx-quality-wrap');
  const btnSearch = section.querySelector('#sx-btn-search');
  const results = section.querySelector('#sx-results');
  const toast = section.querySelector('#sx-toast');

  // --- State ---
  let mode = 'yts_html'; // default
  let busy = false;

  // --- Helpers ---
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]
  ));
  const pick = (o, ...k) => { for (const key of k){ if (o && o[key] != null) return o[key]; } };
  const inferQuality = (s) => {
    const m = String(s||'').match(/(2160p|1080p|720p)/i);
    return m ? m[1].toLowerCase() : '';
  };
  const showToast = (msg, ok=true) => {
    if (!toast) return;
    toast.textContent = msg || '';
    toast.classList.toggle('is-error', !ok);
    toast.classList.add('is-show');
    setTimeout(() => toast.classList.remove('is-show'), 1800);
  };
  const providerForMode = (m) =>
    m === 'tpb_premium' ? 'tpb_premium' :
    m === 'tpb_series'  ? 'tpb_series'  :
    'yts_html';
  const typeForMode = (m) => (m === 'tpb_series' ? 'series' : 'movie');

  function setMode(newMode){
    if (mode === newMode) return;
    mode = newMode;
    tabs.forEach(t => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const isYts = (mode === 'yts_html');
    qualityWrap.style.display = isYts ? '' : 'none';
    qualityWrap.setAttribute('aria-hidden', isYts ? 'false' : 'true');

    if (inputQ.value.trim()) doSearch().catch(()=>{});
  }

  section.querySelector('.tx-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tx-tab'); if (!btn) return;
    setMode(btn.dataset.mode);
  });

  function setBusy(on){
    busy = !!on;
    results?.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // --------- Render ---------
  function renderResults(items, ctx){
    if (!Array.isArray(items) || !items.length){
      results.innerHTML = `<div class="tx-empty">Brak wyników dla podanego zapytania.</div>`;
      return;
    }
    const html = items.map((it) => {
      const title = esc(pick(it,'title','name','display_title') || '—');
      const desc  = esc(pick(it,'description','overview','summary') || '');
      const img   = pick(it,'image','poster','thumb','poster_url') || 'https://via.placeholder.com/300x450?text=Poster';
      const url   = pick(it,'url','link','href') || '';
      const magnet= pick(it,'magnet','magnet_uri') || '';
      const rating= it.rating ? `★ ${esc(String(it.rating))}` : '';
      const provider = esc(it.provider || ctx.provider || '—');

      return `
        <article class="qcard" data-provider="${esc(ctx.provider)}" data-type="${esc(ctx.type)}"
                 ${url ? `data-url="${esc(url)}"` : ''} ${magnet ? `data-magnet="${esc(magnet)}"` : ''}>
          <img class="qcard__img" src="${esc(img)}" alt="" onerror="this.src='https://via.placeholder.com/300x450?text=Poster'">
          <div>
            <div class="qcard__title">${title}</div>
            <p class="qcard__desc">${desc}</p>
            <div class="qcard__meta">
              ${rating ? `${rating} • ` : ''}<span class="tbadge"><span class="tbadge__dot"></span>${provider}</span>
            </div>
          </div>
          <div class="qcard__actions">
            <button class="tbtn sx-btn-get">Pobierz</button>
          </div>
        </article>`;
    }).join('');
    results.innerHTML = html;
  }

  // --------- Search ---------
  async function doSearch(){
    if (!tokenOk()){
      results.innerHTML = `<div class="tx-empty">Musisz być zalogowany, aby wyszukiwać.</div>`;
      return;
    }
    const qRaw = inputQ.value.trim();
    if (!qRaw){
      results.innerHTML = `<div class="tx-empty">Wpisz tytuł, aby rozpocząć.</div>`;
      return;
    }

    const provider = providerForMode(mode);
    const type = typeForMode(mode);

    const headers = { 'Content-Type': 'application/json' };
    const tmdb = getTmdbKey();
    if (tmdb) headers['X-TMDB-Key'] = tmdb;

    setBusy(true);
    results.innerHTML = `<div class="tx-empty">Szukam „${esc(qRaw)}”…</div>`;

    try{
      const r = await window.authFetch(joinUrl(API, '/search'), {
        method: 'POST',
        headers,
        // <<<<<< KLUCZOWE: wysyłamy dokładnie to, co wpisał użytkownik >>>>>>
        body: JSON.stringify({
          query: qRaw,                 // backend sam tłumaczy + czyści sequele/cyfry
          provider,                    // yts_html | tpb_premium | tpb_series
          type,                        // movie | series
          page: 1,
          extra: {}                    // TMDb idzie w nagłówku
        })
      });
      const data = await r.json().catch(() => ({}));
      const arr = Array.isArray(data) ? data
                : Array.isArray(data.results) ? data.results
                : Array.isArray(data.items) ? data.items
                : [];
      renderResults(arr, { provider, type });
    } catch (err){
      console.error(err);
      results.innerHTML = `<div class="tx-empty">Błąd wyszukiwania. Spróbuj ponownie.</div>`;
    } finally {
      setBusy(false);
    }
  }

  btnSearch?.addEventListener('click', () => { if (!busy) doSearch(); });
  inputQ?.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); if (!busy) doSearch(); } });

  // --------- Download / Add ---------
  async function addMagnet(magnet, type, title, image, wantedQuality){
    const meta = {
      display_title: title || undefined,
      image_url: image || undefined,
      quality: wantedQuality || undefined
    };
    const r = await window.authFetch(joinUrl(API, '/torrent/add'), {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ magnet, download_kind: type, meta })
    });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error('torrent/add failed: ' + t);
    }
  }

  results?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sx-btn-get'); if (!btn) return;
    const card = btn.closest('.qcard'); if (!card) return;

    const provider = card.dataset.provider || providerForMode(mode);
    const type = card.dataset.type || typeForMode(mode);
    const title = card.querySelector('.qcard__title')?.textContent?.trim() || '';
    const image = card.querySelector('.qcard__img')?.getAttribute('src') || '';

    const headers = { 'Content-Type': 'application/json' };
    const tmdb = getTmdbKey();
    if (tmdb) headers['X-TMDB-Key'] = tmdb;

    try{
      btn.disabled = true; btn.textContent = 'Dodaję…';

      let magnet = card.dataset.magnet || '';

      if (provider === 'yts_html'){
        const url = card.dataset.url || '';
        if (!url) { showToast('Brak URL do YTS.', false); return; }

        const wanted = selQuality.value || '';

        // Resolve z uwzględnieniem jakości
        const r1 = await window.authFetch(joinUrl(API, '/search/resolve'), {
          method:'POST', headers,
          body: JSON.stringify({ url, provider:'yts_html', quality: wanted || undefined })
        });
        const j1 = await r1.json().catch(()=> ({}));
        magnet = j1?.magnet || j1?.magnet_uri || j1?.result?.magnet || j1?.result?.magnet_uri || '';
        const resolvedName = j1?.name || j1?.result?.name || '';
        let resolvedQuality = j1?.quality || j1?.resolved_quality || j1?.result?.quality || '';
        if (!resolvedQuality) resolvedQuality = inferQuality(magnet || resolvedName);

        if (!magnet){ showToast('Nie udało się pobrać linku magnet.', false); return; }

        await addMagnet(magnet, type, title, image, wanted || resolvedQuality || undefined);

        if (wanted && resolvedQuality && wanted.toLowerCase() !== resolvedQuality.toLowerCase()){
          showToast(`Brak ${wanted} — pobrano ${resolvedQuality.toUpperCase()}`, true);
        } else if (wanted && !resolvedQuality){
          showToast(`Żądana jakość ${wanted} niedostępna — pobrano najlepszą`, true);
        } else {
          showToast('Torrent dodany ✅', true);
        }
        return;
      }

      // TPB (Filmy+ / Seriale) — magnet musi być w wyniku
      if (!magnet){ showToast('Brak magnet linku w wyniku TPB.', false); return; }
      await addMagnet(magnet, type, title, image, undefined);
      showToast('Torrent dodany ✅', true);

    } catch(err){
      console.error(err);
      showToast('Błąd podczas dodawania.', false);
    } finally {
      btn.disabled = false; btn.textContent = 'Pobierz';
    }
  });

  // --- Integracja z główną nawigacją (focus po wejściu w sekcję) ---
  window.showSection = window.showSection || function(){};
  const prevShow = window.showSection;
  window.showSection = function(name){
    try{ if (typeof prevShow === 'function') prevShow(name); }catch(e){}
    if (name === 'search'){
      setTimeout(()=> inputQ?.focus({ preventScroll:true }), 80);
    }
  };

  // Start: dopasuj tryb do aktywnej zakładki w HTML (jeśli już podświetlona)
  const active = tabs.find(t => t.classList.contains('is-active'));
  if (active) mode = active.dataset.mode || mode;

})();

/* ==== DOSTĘPNE + CAST (robust, DOMContentLoaded-safe) =================== */
(function(){
  // --- helpers ---
  const onceReady = (fn)=> (document.readyState==='loading'
    ? document.addEventListener('DOMContentLoaded', fn, {once:true})
    : fn());

  const PLACEHOLDER = 'https://placehold.co/300x450?text=Brak';

  // zewnętrzne zależności:
  const hasFn = (name)=> typeof window[name] === 'function';

  async function fetchJsonSmart(path, method='GET'){
    try{
      const res = await api(path, {method});
      if (typeof res === 'string') { try{ return JSON.parse(res); }catch{ return null; } }
      return res;
    }catch{ return null; }
  }

  async function detectAvailableEndpoint(){
    const cached = localStorage.getItem('pf_available_ep');
    if (cached) return JSON.parse(cached);

    const candidates = [
      {u:'/me/available',        mode:'split'},
      {u:'/available',           mode:'flat'},
      {u:'/library/available',   mode:'flat'},
      {u:'/media/available',     mode:'flat'},
      {u:'/available/list',      mode:'flat'},
      {u:'/content/available',   mode:'flat'},
    ];

    for(const c of candidates){
      const j = await fetchJsonSmart(c.u,'GET') || await fetchJsonSmart(c.u,'POST');
      if(!j) continue;
      const looksOk =
        (Array.isArray(j) && j.length) ||
        (Array.isArray(j?.items) && j.items.length) ||
        Array.isArray(j?.films) || Array.isArray(j?.movies) ||
        Array.isArray(j?.series) || Array.isArray(j?.shows);
      if(looksOk){
        const mode =
          Array.isArray(j) ? 'flat' :
          (j.items ? 'items' :
          (j.films||j.movies||j.series||j.shows ? 'split' : c.mode));
        const ep = {u:c.u, mode};
        localStorage.setItem('pf_available_ep', JSON.stringify(ep));
        return ep;
      }
    }

    // starszy układ: osobne filmy/seriale
    const pairs = [
      ['/library/movies','/library/series'],
      ['/library/movies','/library/shows'],
      ['/me/movies','/me/series'],
    ];
    for(const [m,s] of pairs){
      const jm = await fetchJsonSmart(m,'GET') || await fetchJsonSmart(m,'POST');
      const js = await fetchJsonSmart(s,'GET') || await fetchJsonSmart(s,'POST');
      if( (Array.isArray(jm)&&jm.length) || (Array.isArray(js)&&js.length) ){
        const ep = {u:`${m}|${s}`, mode:'pair'};
        localStorage.setItem('pf_available_ep', JSON.stringify(ep));
        return ep;
      }
    }
    return {u:'/me/available', mode:'split'};
  }

  function normalizeAvailable(payload, mode){
    if(mode==='split'){
      const films  = payload?.films  ?? payload?.movies ?? [];
      const series = payload?.series ?? payload?.shows  ?? [];
      return {films: Array.isArray(films)?films:[], series: Array.isArray(series)?series:[]};
    }
    if(mode==='items'){
      const arr = Array.isArray(payload?.items) ? payload.items : [];
      return {films: arr, series: []};
    }
    if(mode==='flat'){
      const arr = Array.isArray(payload) ? payload
                : (Array.isArray(payload?.items) ? payload.items : []);
      return {films: arr, series: []};
    }
    return {films: [], series: []};
  }

  // canonicalizer
  const _first = (o,keys,d='')=>{ for(const k of keys){ if(o && o[k]!=null && o[k] !== '') return o[k]; } return d; };
  const _num   = (x,d=0)=>{ const n=Number(String(x).replace(',','.')); return isFinite(n)?n:d; };
  const _bool  = x => !!(x===true || x==='1' || x===1 || String(x).toLowerCase()==='true');
  function _parseDeleteAt(v){ if(v==null||v==='') return null; const n=Number(String(v).replace(',','.')); if(isFinite(n)) return n<1e12?Math.round(n*1000):Math.round(n); const t=Date.parse(String(v)); return isNaN(t)?null:t; }

  function canon(r){
    const title  = _first(r, ['display_title','title','name'], '—');
    const poster = _first(r, ['image_url','poster','poster_url','thumb','cover','cover_url'], PLACEHOLDER);

    const kindRaw = (_first(r, ['kind','type','mtype','media_type'],'')||'').toLowerCase();
    const isSeries = kindRaw==='series' || _bool(r.is_series) || !!r.season || !!r.episode;
    const kind = isSeries ? 'series' : 'movie';

    const year = _first(r, ['year','release_year','y'], null);

    let pos=null, dur=null;
    if (r.position_ms != null) pos = _num(r.position_ms)/1000;
    else if (r.view_offset_ms != null) pos = _num(r.view_offset_ms)/1000;
    else pos = _num(_first(r, ['watched_seconds','position','pos'], 0));

    if (r.duration_ms != null) dur = _num(r.duration_ms)/1000;
    else                        dur = _num(_first(r, ['duration','runtime','total_seconds'], 0));

    let prog=null;
    const rawProg = _first(r, ['progress','ratio'], null);
    const rawPerc = _first(r, ['percent'], null);
    if (rawProg != null && rawProg!==''){ let v=Number(String(rawProg).replace(',','.')); if(isFinite(v)) prog = v>1.01 ? v/100 : v; }
    else if (rawPerc != null && rawPerc!==''){ const v=parseFloat(String(rawPerc).replace('%','').replace(',','.')); if(isFinite(v)) prog=v/100; }
    if (prog==null) { prog = (isFinite(pos)&&isFinite(dur)&&dur>0) ? Math.max(0,Math.min(1,pos/dur)) : 0; }
    else            { prog = Math.max(0,Math.min(1,prog)); }

    const season     = _num(_first(r, ['season','s'], null), null);
    const episode    = _num(_first(r, ['episode','e'], null), null);
    const updated_at = _first(r, ['updated_at','mtime','added_at','ts','last_update','watchedAt'], null);

    let idCand = _first(r, ['plex_id','ratingKey','plex_rating_key','id','item_id','video_id','hash'], null);
    let id;
    if (idCand && /^\d+$/.test(String(idCand))) id = String(idCand);
    else {
      const basis = (title||'') + '|' + (year||'') + '|' + (season??'') + '|' + (episode??'');
      id = btoa(unescape(encodeURIComponent(basis))).replace(/=+$/,'');
    }

    const size_bytes = _num(_first(r, ['size_bytes','filesize','size'], 0));
    const deleteAt   = _parseDeleteAt(_first(r, ['deleteAt','delete_at'], null));
    const favorite   = _bool(_first(r, ['favorite'], false));

    return { id, title, poster, kind, year, duration: isFinite(dur)?dur:0, position: isFinite(pos)?pos:0,
             progress: prog, season, episode, updated_at, size_bytes, deleteAt, favorite };
  }

  const epLabel = it => (it.kind!=='series') ? '' : `S${(it.season!=null?String(it.season).padStart(2,'0'):'--')}E${(it.episode!=null?String(it.episode).padStart(2,'0'):'--')}`;
  const bytes = (n)=>{ n=Number(n||0); const u=['B','KiB','MiB','GiB','TiB']; let i=0; while(n>=1024 && i<u.length-1){ n/=1024; i++; } return `${n.toFixed(n<10?2:1)} ${u[i]}`; };
  const dcls  = ms => (ms<=0 ? 'danger' : ((ms/86400000)<=1 ? 'warn' : 'ok'));
  const ttl   = ms => { if(ms<=0) return 'do usunięcia'; const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60); if(d>=2) return `za ${d} dni`; if(d===1) return 'za 1 dzień'; if(h>=1) return `za ${h} h`; return `za ${m} min`; };

  // --- stan modułu (w zasięgu) ---
  let DOM = {};
  let _availableRaw = [];
  let _availableIndex = {};
  let _posterByPlexId = {};
  let _delTimer = null;

  function wireUI(){
    const byId = (id)=> document.getElementById(id);
    DOM = {
      grid:   byId('availableGrid'),
      info:   byId('avInfo'),
      q:      byId('avQuery'),
      kind:   byId('avKind'),
      sort:   byId('avSort'),
      btn:    byId('avRefresh'),
      auto:   byId('avAuto'),
    };

    // ochronne bindy (jeśli skrypt w <head/>)
    if (DOM.btn)  DOM.btn.onclick  = loadAvailable;
    if (DOM.auto) DOM.auto.onclick = function(){ 
      if(this._t){ clearInterval(this._t); this._t=null; this.textContent='Auto: OFF'; }
      else { this._t=setInterval(loadAvailable, 10000); this.textContent='Auto: ON'; loadAvailable(); }
    };
    if (DOM.q)    DOM.q.addEventListener('input', ()=>renderAvailable(_availableRaw));
    if (DOM.kind) DOM.kind.addEventListener('change', ()=>renderAvailable(_availableRaw));
    if (DOM.sort) DOM.sort.addEventListener('change', ()=>renderAvailable(_availableRaw));
  }

  function renderAvailable(list){
    if(_delTimer){ clearInterval(_delTimer); _delTimer=null; }
    if(!Array.isArray(list) || !list.length){
      if(DOM.grid) DOM.grid.innerHTML = '';
      if(DOM.info) DOM.info.textContent = 'Brak pozycji.';
      return;
    }

    const q = (DOM.q?.value||'').toLowerCase();
    const k = DOM.kind?.value || 'all';
    const srt = DOM.sort?.value || 'recent';

    _availableIndex = {};
    let items = list.map(r => { const c = canon(r); _availableIndex[c.id]=r; return c; });

    if(k!=='all') items = items.filter(x => x.kind===k);
    if(q) items = items.filter(x => (x.title||'').toLowerCase().includes(q));

    _posterByPlexId = {};
    for(const raw of list){
      const pid = [raw?.plex_id, raw?.ratingKey, raw?.plex_rating_key].find(v=>v!=null && /^\d+$/.test(String(v)));
      if(pid){ const c = canon(raw); if(c.poster) _posterByPlexId[String(pid)] = c.poster; }
    }

    if(srt==='title') items.sort((a,b)=> (a.title||'').localeCompare(b.title||''));
    else if(srt==='progress') items.sort((a,b)=> (b.progress||0) - (a.progress||0));
    else items.sort((a,b)=> String(b.updated_at||'').localeCompare(String(a.updated_at||'')));

    if(DOM.grid) DOM.grid.innerHTML = items.map(it=>{
      const pct = Math.max(0, Math.min(100, Math.round((it.progress||0)*100)));
      const year = it.year ? ` (${it.year})` : '';
      const ep = epLabel(it);
      const metaL = `${it.kind}${ep? ' · '+ep:''}${it.size_bytes? ' · '+bytes(it.size_bytes):''}`;
      const delDiff = it.deleteAt ? (it.deleteAt - Date.now()) : null;
      const delTxt  = (it.deleteAt && !it.favorite) ? ttl(delDiff) : '';
      const delCls  = (it.deleteAt && !it.favorite) ? dcls(delDiff) : '';
      const delDate = (it.deleteAt && !it.favorite) ? ` · usunie: ${new Date(it.deleteAt).toLocaleString()}` : '';
      const delBadge = (it.deleteAt && !it.favorite) ? `<div class="del-badge ${delCls}" data-delete-at="${it.deleteAt}">${delTxt}</div>` : '';

      const canAutoId = /^\d+$/.test(String(it.id));
      const tip = canAutoId ? `Cast ratingKey=${it.id}` : `Wpisz ratingKey przy starcie`;

      return `
        <div class="av-card">
          <div class="poster">
            <img src="${it.poster||PLACEHOLDER}" alt="">
            ${delBadge}
            <div class="vprog"><span style="width:${pct}%;"></span></div>
          </div>
          <div class="body">
            <div class="title">${(it.title||'—').replace(/</g,'&lt;')}${year}</div>
            <div class="meta">${metaL}${delDate}</div>
            <div class="tiny">Postęp: ${pct}% ${it.duration? `· ${Math.round((it.position||0)/60)} / ${Math.round((it.duration||0)/60)} min` : ''}</div>
            <div class="actions">
              <button class="green" title="${tip}" onclick="castFromAvailable('${it.id}')">Cast ▶</button>
            </div>
          </div>
        </div>`;
    }).join('');

    if(DOM.info) DOM.info.textContent = `Pozycji: ${items.length}`;

    _delTimer = setInterval(() => {
      document.querySelectorAll('.del-badge[data-delete-at]').forEach(el=>{
        const ts = Number(el.getAttribute('data-delete-at'));
        if(!isFinite(ts)) return;
        const diff = ts - Date.now();
        el.textContent = ttl(diff);
        el.classList.remove('ok','warn','danger');
        el.classList.add(dcls(diff));
      });
    }, 30000);
  }

  async function loadAvailable(){
    if(DOM.info){ DOM.info.textContent = 'Ładuję...'; }
    if(DOM.grid){ DOM.grid.innerHTML = ''; }

    const ep = await detectAvailableEndpoint();
    console.info('[Dostępne] endpoint:', ep);

    try{
      if(ep.mode === 'pair'){
        const [m,s] = ep.u.split('|');
        const jm = await fetchJsonSmart(m,'GET') || await fetchJsonSmart(m,'POST') || [];
        const js = await fetchJsonSmart(s,'GET') || await fetchJsonSmart(s,'POST') || [];
        _availableRaw = ([]).concat(Array.isArray(jm)?jm:(jm?.items||[]), Array.isArray(js)?js:(js?.items||[]));
      }else{
        const j = await fetchJsonSmart(ep.u,'GET') || await fetchJsonSmart(ep.u,'POST') || {};
        const ns = normalizeAvailable(j, ep.mode);
        _availableRaw = (ns.films||[]).concat(ns.series||[]);
      }
      renderAvailable(_availableRaw);
    }catch(e){
      if(DOM.info) DOM.info.innerHTML = `<span class="err">${e.message||e}</span>`;
    }
  }

  // Cast z karty
  window.castFromAvailable = async (canonId)=>{
    const raw = _availableIndex[canonId] || {};
    let itemId = [raw?.plex_id, raw?.ratingKey, raw?.plex_rating_key].find(v=>v!=null && /^\d+$/.test(String(v)));
    if(!itemId && /^\d+$/.test(String(canonId))) itemId = String(canonId);
    if(!itemId){
      itemId = prompt('Brak plex_id w pozycji. Podaj Plex ratingKey (item_id):', '');
    }
    if(!itemId || !/^\d+$/.test(String(itemId))){
      alert('Nieprawidłowy item_id (ratingKey).'); return;
    }
    if (hasFn('castStart')) await window.castStart(itemId);
  };

  // debug w konsoli
  window.piotrflixAvailable = {
    endpoint: detectAvailableEndpoint,
    reload:   loadAvailable,
    get last(){ return _availableRaw; }
  };

  // start kiedy DOM gotowy
  onceReady(() => {
    wireUI();
    loadAvailable();
  });
})();
