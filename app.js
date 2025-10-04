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

/* ===================== DOSTĘPNE v2 — zgodne z HTML (av2-*) ===================== */
(function () {
  const section = document.getElementById("section-available");
  if (!section) return;

  // ---- API helpers ----
  const API =
    document.getElementById("auth-screen")?.dataset.apiBase ||
    localStorage.getItem("pf_base") ||
    "";
  const joinUrl = (b, p) =>
    `${(b || "").replace(/\/+$/, "")}/${String(p || "").replace(/^\/+/, "")}`;
  const tokenOk = () => !!(window.getAuthToken && window.getAuthToken());

  async function apiJson(path, opt = {}) {
    const headers = new Headers(opt.headers || {});
    if (
      !headers.has("Content-Type") &&
      opt.body &&
      typeof opt.body === "object" &&
      !(opt.body instanceof FormData)
    ) {
      headers.set("Content-Type", "application/json");
    }
    const init = { ...opt, headers };
    if (headers.get("Content-Type") === "application/json" && init.body && typeof init.body === "object") {
      init.body = JSON.stringify(init.body);
    }
    const res = await window.authFetch(joinUrl(API, path), init);
    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      try {
        const j = JSON.parse(txt);
        throw new Error(j.message || j.error || `${res.status}`);
      } catch {
        throw new Error(txt || `HTTP ${res.status}`);
      }
    }
    try { return JSON.parse(txt); } catch { return txt; }
  }

  // ---- UI refs ----
  const tabsHost = section.querySelector("#av2-tabs");
  const tabMovies = section.querySelector("#av2-tab-movies");
  const tabSeries = section.querySelector("#av2-tab-series");
  const infoEl = section.querySelector("#av2-info");
  const listEl = section.querySelector("#av2-list");

  const playerBox = section.querySelector("#av2-player");
  const plPoster = section.querySelector("#av2-pl-poster");
  const plSeek = section.querySelector("#av2-pl-seek");
  const plTime = section.querySelector("#av2-pl-time");
  const plPct = section.querySelector("#av2-pl-pct");
  const btnPlay = section.querySelector("#av2-btn-play");
  const btnPause = section.querySelector("#av2-btn-pause");
  const btnStop = section.querySelector("#av2-btn-stop");

  const dlg = section.querySelector("#av2-cast-modal");
  const castSel = section.querySelector("#av2-device");
  const castStart = section.querySelector("#av2-cast-start");

  // ---- utils ----
  const setText = (el, t) => { if (el) el.textContent = t; };
  const setHTML = (el, h) => { if (el) el.innerHTML = h; };
  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const parseDeleteAt = (val) => {
    if (val == null || val === "") return null;
    if (typeof val === "number") {
      const n = Number(val);
      if (!isFinite(n)) return null;
      return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
    }
    const s = String(val).trim();
    if (!s) return null;
    const asNum = Number(s.replace(",", "."));
    if (isFinite(asNum)) return asNum < 1e12 ? Math.round(asNum * 1000) : Math.round(asNum);
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  };

  // Format daty PL, z bezpiecznym fallbackiem
  const fmtDateShort = (ms) => {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString("pl-PL", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return new Date(ms).toLocaleString();
    }
  };

  // ---- DEL BADGE ----
  const TTL = {
    okDays: 3,     // >3 dni → ok
    warnMinDays: 1 // 1–3 dni → warn
  };

  // „usunie się za …”
  const fmtTTL = (diffMs) => {
    if (diffMs <= 0) return "do usunięcia";
    const s = Math.floor(diffMs / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d >= 2) return `usunie się za ${d} dni`;
    if (d === 1) return `usunie się za 1 dzień`;
    if (h >= 1) return `usunie się za ${h} h`;
    return `usunie się za ${m} min`;
  };

  // klasa koloru
  const delClass = (diffMs) => {
    if (diffMs <= 0) return "danger";
    const d = diffMs / 86400000;
    if (d < TTL.warnMinDays) return "danger";
    if (d <= TTL.okDays) return "warn";
    return "ok";
  };

  // ---- state ----
  let RAW = { films: [], series: [] };
  let activeKind = "movies";
  let selected = null;
  let currentClientId = localStorage.getItem("pf_cast_client") || "";
  let statusTimer = null;
  let badgeTimer = null;

  // ---- canon map ----
  function canon(r) {
    const title = r.display_title || r.title || r.name || "—";
    const poster = r.image_url || r.poster || r.poster_url || r.thumb || "";
    const isSeries =
      (r.kind || r.type || "").toLowerCase() === "series" ||
      !!r.season ||
      !!r.episode;
    const kind = isSeries ? "series" : "movie";
    const pos =
      (r.position_ms ?? r.view_offset_ms ?? 1000 * (r.position ?? r.watched_seconds ?? 0)) / 1000;
    const dur =
      (r.duration_ms ?? r.total_ms ?? 1000 * (r.duration ?? r.runtime ?? r.total_seconds ?? 0)) / 1000;
    let prog = r.progress ?? r.ratio ?? (dur > 0 ? pos / dur : 0);
    prog = clamp01(prog > 1.01 ? prog / 100 : prog);
    const id =
      (String(r.plex_id || r.ratingKey || "").match(/^\d+$/)
        ? String(r.plex_id || r.ratingKey)
        : String(r.id || ""));

    const delAt = parseDeleteAt(r.deleteAt ?? r.delete_at ?? null);
    const favorite = !!r.favorite;

    return {
      id, title, poster, kind, pos, dur, prog,
      season: r.season ?? null,
      episode: r.episode ?? null,
      year: r.year || r.release_year || null,
      deleteAt: delAt,
      favorite: favorite === true,
    };
  }
  const ep = (it) =>
    it.kind === "series"
      ? `S${String(it.season ?? "--").padStart(2, "0")}E${String(it.episode ?? "--").padStart(2, "0")}`
      : "";

  // ---- render ----
  function render() {
    const arrRaw =
      activeKind === "movies"
        ? (Array.isArray(RAW.films) ? RAW.films : (Array.isArray(RAW.movies) ? RAW.movies : []))
        : (Array.isArray(RAW.series) ? RAW.series : []);
    const arr = arrRaw.map(canon);

    if (!arr.length) {
      setHTML(listEl, "");
      setText(infoEl, "Brak pozycji do wyświetlenia.");
      return;
    }
    setText(infoEl, `Pozycji: ${arr.length}`);

    if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }

    const html = arr.map(it => {
      const pct  = Math.round((it.prog || 0) * 100);
      const year = it.year ? ` (${it.year})` : "";
      const sub  = (it.kind === "series" && it.season != null && it.episode != null) ? ep(it) : "";

      // PODBUDÓWKA (belka pod kartą) – tylko gdy nie ulubiony i jest deleteAt
      const showDel = !!(it.deleteAt && !it.favorite);
      const diff    = showDel ? (it.deleteAt - Date.now()) : 0;
      const delRow  = showDel ? `
        <div class="del-row ${delClass(diff)}" data-delete-at="${it.deleteAt}" role="note" aria-live="polite">
          <div class="del-row__left">
            <span class="del-badge">${fmtTTL(diff)}</span>
          </div>
          <div class="del-row__right">
            <span class="del-date" title="Planowana data usunięcia">${fmtDateShort(it.deleteAt)}</span>
          </div>
        </div>` : "";

      return `
        <article class="av-card">
          <div class="poster" style="position:relative">
            <img class="av-poster" src="${esc(it.poster)}" alt="">
            <div class="vprog" aria-hidden="true"><span style="width:${pct}%;"></span></div>
          </div>
          <div class="body">
            <div class="title" title="${esc(it.title)}">${esc(it.title)}${year}</div>
            ${sub ? `<div class="meta">${sub}</div>` : ""}
            <div class="av-progress-wrap">
              <div class="av-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
                <span class="av-bar" style="width:${pct}%;"></span>
              </div>
            </div>

            <div class="tiny">${pct}% ${
              it.dur ? `· ${Math.round((it.pos || 0)/60)} / ${Math.round((it.dur || 0)/60)} min` : ""
            }</div>
            <div class="actions">
              <button class="btn--cast" data-id="${esc(it.id)}" data-title="${esc(it.title)}" data-poster="${esc(it.poster)}">Cast ▶</button>
            </div>
          </div>

          ${delRow} <!-- 🔑 belka z info o usunięciu POD całą kartą -->
        </article>`;
    }).join("");

    setHTML(listEl, html);

    // USTAWIENIE KOLORÓW OD RAZU PO RENDERZE
    listEl.querySelectorAll(".del-row[data-delete-at]").forEach((row) => {
      const ts = Number(row.getAttribute("data-delete-at") || "");
      if (!isFinite(ts)) return;
      setDelState(row, ts - Date.now());
      const badge = row.querySelector(".del-badge");
      if (badge) badge.textContent = fmtTTL(ts - Date.now());
    });

    // auto-refresh co 20 s
    const refreshBadges = () => {
      listEl.querySelectorAll(".del-row[data-delete-at]").forEach(row => {
        const ts = Number(row.getAttribute("data-delete-at") || "");
        if (!isFinite(ts)) return;
        const diff = ts - Date.now();
        setDelState(row, diff);
        const badge = row.querySelector(".del-badge");
        if (badge) badge.textContent = fmtTTL(diff);
      });
    };
    badgeTimer = setInterval(refreshBadges, 20000);

    // Cast handlers
    listEl.querySelectorAll(".btn--cast").forEach(b => {
      b.addEventListener("click", () => {
        selected = {
          id: b.getAttribute("data-id") || "",
          title: b.getAttribute("data-title") || "",
          poster: b.getAttribute("data-poster") || "",
        };
        openCastModal();
      });
    });
  }

  // ---- load ----
  async function loadAvailable() {
    if (!tokenOk()) {
      setText(infoEl, "Musisz być zalogowany (brak tokenu).");
      setHTML(listEl, "");
      return;
    }
    setText(infoEl, "Ładuję listę…");
    setHTML(listEl, "");
    try {
      const j = await apiJson("/me/available", { method: "GET" });
      if (Array.isArray(j)) {
        RAW.films = j.filter(
          (x) => (x.kind || x.type || "").toLowerCase() !== "series"
        );
        RAW.series = j.filter(
          (x) => (x.kind || x.type || "").toLowerCase() === "series"
        );
      } else {
        RAW.films = Array.isArray(j?.films)
          ? j.films
          : Array.isArray(j?.movies)
          ? j.movies
          : [];
        RAW.series = Array.isArray(j?.series) ? j.series : [];
      }
      render();
    } catch (e) {
      setText(infoEl, `Błąd: ${e.message || e}`);
    }
  }

  // ---- tabs ----
  function setTab(kind) {
    activeKind = kind === "series" ? "series" : "movies";
    tabMovies?.classList.toggle("is-active", activeKind === "movies");
    tabSeries?.classList.toggle("is-active", activeKind === "series");
    render();
  }
  tabsHost?.addEventListener("click", (e) => {
    const t = e.target.closest("[data-av2-tab]");
    if (!t) return;
    const k = t.getAttribute("data-av2-tab");
    if (k === "movies" || k === "series") {
      e.preventDefault();
      setTab(k);
    }
  });

  // ---- CAST ----
  function openCastModal() {
    if (castSel) castSel.innerHTML = `<option value="">— ładuję… —</option>`;
    apiJson("/cast/players", { method: "GET" })
      .then((j) => {
        const list = Array.isArray(j?.devices) ? j.devices : [];
        if (!list.length) {
          castSel.innerHTML = `<option value="">(brak klientów)</option>`;
        } else {
          castSel.innerHTML =
            `<option value="">— wybierz —</option>` +
            list
              .map(
                (d) =>
                  `<option value="${d.id}">${esc(d.name || d.product || "Plex")} — ${esc(d.platform || "")}</option>`
              )
              .join("");
          const prev = localStorage.getItem("pf_cast_client") || "";
          if (prev && list.some((x) => String(x.id) === String(prev)))
            castSel.value = prev;
        }
      })
      .catch(() => {
        castSel.innerHTML = `<option value="">(błąd)</option>`;
      });

    if (typeof dlg?.showModal === "function") dlg.showModal();
    else dlg?.setAttribute("open", "");
  }

  castSel?.addEventListener("change", () => {
    currentClientId = castSel.value || "";
    if (currentClientId) localStorage.setItem("pf_cast_client", currentClientId);
  });

  castStart?.addEventListener("click", async (e) => {
    e.preventDefault();
    const cid = castSel?.value || "";
    if (!cid) return;
    if (!selected || !/^\d+$/.test(String(selected.id || ""))) return;
    try {
      await apiJson("/cast/start", {
        method: "POST",
        body: {
          item_id: String(selected.id),
          client_id: cid,
          client_name: castSel.options[castSel.selectedIndex]?.text || "",
        },
      });
      if (playerBox) playerBox.hidden = false;
      if (plPoster) plPoster.src = selected.poster || "";
      startStatusLoop();
    } catch (_) {
      /* opcjonalnie toast */
    } finally {
      dlg?.close?.();
    }
  });

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h ? String(h).padStart(2, "0") + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function updateFromStatus(st) {
    const sessions = Array.isArray(st?.sessions) ? st.sessions : [];
    const sess =
      sessions.find((s) => String(s.client_id || "") === String(currentClientId)) ||
      sessions[0];
    if (!sess) return;
    const dur = Number(sess.duration_ms || 0) / 1000;
    const pos = Number(sess.view_offset_ms || 0) / 1000;
    const pct = dur > 0 ? Math.round((pos / dur) * 100) : 0;
    if (plSeek) {
      plSeek.max = dur > 0 ? String(dur) : "100";
      plSeek.value = String(pos || 0);
    }
    if (plTime) setText(plTime, `${fmtTime(pos)} / ${fmtTime(dur)}`);
    if (plPct) setText(plPct, `${pct}%`);
  }
  function startStatusLoop() {
    stopStatusLoop();
    statusTimer = setInterval(async () => {
      try {
        const qs = currentClientId ? `?client_id=${encodeURIComponent(currentClientId)}` : "";
        const j = await apiJson("/cast/status" + qs, { method: "GET" });
        updateFromStatus(j);
      } catch (_) {}
    }, 1500);
  }
  function stopStatusLoop() {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  plSeek?.addEventListener("input", async () => {
    if (!currentClientId) return;
    const seekMs = Math.round(Number(plSeek.value || "0") * 1000);
    try {
      await apiJson("/cast/cmd", {
        method: "POST",
        body: { client_id: currentClientId, cmd: "seek", seek_ms: seekMs },
      });
    } catch (_) {}
  });
  btnPlay?.addEventListener("click", async () => {
    if (!currentClientId) return;
    try {
      await apiJson("/cast/cmd", {
        method: "POST",
        body: { client_id: currentClientId, cmd: "play" },
      });
    } catch (_) {}
  });
  btnPause?.addEventListener("click", async () => {
    if (!currentClientId) return;
    try {
      await apiJson("/cast/cmd", {
        method: "POST",
        body: { client_id: currentClientId, cmd: "pause" },
      });
    } catch (_) {}
  });
  btnStop?.addEventListener("click", async () => {
    if (!currentClientId) return;
    try {
      await apiJson("/cast/cmd", {
        method: "POST",
        body: { client_id: currentClientId, cmd: "stop" },
      });
    } catch (_) {}
    stopStatusLoop();
    if (playerBox) playerBox.hidden = true;
  });

  // ---- boot ----
  function boot() {
    if (playerBox) playerBox.hidden = true; // domyślnie ukryty
    setTab("movies");
    loadAvailable();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // ---- integracja z dolną nawigacją (opcjonalnie) ----
  window.showSection = window.showSection || function () {};
  const prevShow = window.showSection;
  window.showSection = function (name) {
    try {
      prevShow && prevShow(name);
    } catch (_) {}
    if (name === "available") {
      loadAvailable();
    }
  };
})();

/* ===================== Standalone kolorowanie belki ===================== */
function setDelState(row, diffMs){
  var state;
  if (diffMs <= 0) {
    state = 'danger';
  } else {
    var d = diffMs / 86400000; // ms -> dni
    if (d < 1) state = 'danger';
    else if (d <= 3) state = 'warn';
    else state = 'ok';
  }

  row.classList.remove('ok','warn','danger');
  row.classList.add(state);
  row.dataset.state = state;

  // badge (po lewej)
  var badge = row.querySelector('.del-badge');
  if (badge){
    badge.classList.remove('ok','warn','danger');
    badge.classList.add(state);
  }
}
