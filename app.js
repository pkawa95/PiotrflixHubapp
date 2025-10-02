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

/* ===================== TORRENTY / KOLEJKA (sekcja) — v3) ===================== */
document.addEventListener("DOMContentLoaded", () => {
  const section = document.getElementById("section-torrents");
  if (!section) return;

  const API = document.getElementById("auth-screen")?.dataset.apiBase || "";
  const joinUrl = (b, p) =>
    `${(b || "").replace(/\/+$/, "")}/${String(p || "").replace(/^\/+/, "")}`;

  const elTorrents = section.querySelector("#tx-torrents");
  const elQueue = section.querySelector("#tx-queue");
  const sortSel = section.querySelector("#tx-sort");
  const speedSel = section.querySelector("#tx-speed");
  const speedFb = section.querySelector("#tx-speed-feedback");
  const qStatusSel = section.querySelector("#tx-q-status");
  const tabBar = section.querySelector(".tx-tabs");
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
    let i = 0,
      n = x;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${u[i]}`;
  };
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[m]);

  // tabs
  function setTab(tab) {
    currentTab = tab;
    elTorrents.hidden = tab !== "torrents";
    elQueue.hidden = tab !== "queue";
    toolbars.forEach((tb) => (tb.hidden = tb.dataset.txTools !== tab));
    tabBar.querySelectorAll(".tx-tab").forEach((b) => {
      const on = b.dataset.txTab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    kickRefresh();
  }
  tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tx-tab]");
    if (!btn) return;
    const tab = btn.dataset.txTab;
    if (tab && tab !== currentTab) setTab(tab);
  });

  // globalny limit DL
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

  // torrenty — WSZYSTKIE urządzenia (bez device_id)
  async function loadTorrents() {
    if (!window.getAuthToken || !window.getAuthToken()) return;
    try {
      const url = new URL(joinUrl(API, "/torrents/status/list"));
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", "200");
      const r = await window.authFetch(url.toString());
      const data = await r.json().catch(() => ({}));
      const raw = Array.isArray(data?.items) ? data.items : [];

      // deduplikacja po info_hash/hash/id
      const byKey = new Map();
      for (const it of raw) {
        const key = it.info_hash || it.hash || it.id || it.name;
        if (key && !byKey.has(key)) byKey.set(key, it);
      }
      let items = Array.from(byKey.values());

      // pomiń usunięte
      items = items.filter(
        (it) => String(it.state || "").toLowerCase() !== "removed"
      );

      // sort
      const s = sortSel?.value || "name";
      if (s === "progress") {
        items
          .sort(
            (a, b) =>
              pct(a.progress ?? a.progress_percent ?? a.percent) -
              pct(b.progress ?? b.progress_percent ?? b.percent)
          )
          .reverse();
      } else if (s === "state") {
        items.sort((a, b) =>
          String(a.state || "").localeCompare(String(b.state || ""))
        );
      } else {
        items.sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );
      }

      renderTorrents(items);
    } catch (e) {
      console.error("loadTorrents:", e);
      elTorrents.innerHTML =
        `<div class="tx-empty">Nie udało się pobrać torrentów.</div>`;
    }
  }

  function renderTorrents(items) {
    if (!items.length) {
      elTorrents.innerHTML = `<div class="tx-empty">Brak aktywnych torrentów.</div>`;
      return;
    }
    const html = items
      .map((it) => {
        const name = it.name || it.display_title || it.title || "Nieznany";
        const progress = pct(
          it.progress ?? it.progress_percent ?? it.percent ?? 0
        );
        const rate = humanSpeed(
          it.download_rate_bps ??
            it.downloadSpeedBps ??
            it.download_rate ??
            it.dl_rate ??
            it.download ??
            0
        );
        const state = (it.state || "unknown").toUpperCase();
        const ihash = it.info_hash || it.hash || it.id || name;

        return `
      <article class="tcard" data-ih="${esc(ihash)}">
        <div class="tcard__left">
          <div class="tcard__title">${esc(name)}</div>
          <div class="tcard__meta"><span>${progress.toFixed(
            0
          )}%</span><span>•</span><span>${esc(
          state
        )}</span><span>•</span><span>${esc(rate)}</span></div>
          <div class="tcard__progress"><div class="tcard__bar" style="width:${progress}%;"></div></div>
        </div>
        <div class="tcard__right">
          <button class="tbtn tbtn--ghost"  data-action="pause"  data-ih="${esc(
            ihash
          )}">Pauza/Wznów</button>
          <button class="tbtn tbtn--danger" data-action="remove" data-ih="${esc(
            ihash
          )}" data-rm="0">Usuń</button>
          <button class="tbtn tbtn--danger" data-action="remove" data-ih="${esc(
            ihash
          )}" data-rm="1" title="Usuń z danymi">Usuń + dane</button>
        </div>
      </article>`;
      })
      .join("");
    if (elTorrents.innerHTML !== html) elTorrents.innerHTML = html;
  }

  elTorrents?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const ih = btn.dataset.ih;
    const action = btn.dataset.action;
    try {
      if (action === "pause") {
        await window.authFetch(joinUrl(API, "/torrent/toggle"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ torrent_id: ih }),
        });
      } else if (action === "remove") {
        const rm = btn.dataset.rm === "1";
        await window.authFetch(joinUrl(API, "/torrent/remove"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ torrent_id: ih, remove_data: rm }),
        });
      }
      setTimeout(loadTorrents, 300);
    } catch (err) {
      console.error(err);
    }
  });
  sortSel?.addEventListener("change", loadTorrents);

  // kolejka
  async function loadQueue() {
    if (!window.getAuthToken || !window.getAuthToken()) return;
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
      elQueue.innerHTML =
        `<div class="tx-empty">Nie udało się pobrać kolejki.</div>`;
    }
  }

  function renderQueue(items) {
    if (!items.length) {
      elQueue.innerHTML = `<div class="tx-empty">Brak elementów w kolejce.</div>`;
      return;
    }
    const html = items
      .map((it) => {
        const title =
          it.display_title ||
          it.payload?.display_title ||
          it.payload?.title ||
          it.kind ||
          "Zadanie";
        const poster =
          it.image_url ||
          it.payload?.image_url ||
          it.payload?.poster ||
          it.payload?.thumb ||
          "https://via.placeholder.com/300x450?text=Poster";
        const when = it.created_at ? new Date(it.created_at).toLocaleString() : "";
        return `
      <article class="qcard" data-qid="${it.id}">
        <img class="qcard__img" src="${esc(
          poster
        )}" alt="" onerror="this.src='https://via.placeholder.com/300x450?text=Poster'">
        <div>
          <div class="qcard__title">${esc(title)}</div>
          <div class="qcard__meta"><span>ID: ${it.id}</span><span>•</span><span>Dodano: ${esc(
            when
          )}</span>${it.kind ? `<span>•</span><span>${esc(it.kind)}</span>` : ""}</div>
        </div>
        <div class="qcard__right"><button class="tbtn tbtn--danger" data-qdel="${it.id}">Usuń</button></div>
      </article>`;
      })
      .join("");
    if (elQueue.innerHTML !== html) elQueue.innerHTML = html;
  }

  elQueue?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-qdel]");
    if (!btn) return;
    try {
      await window.authFetch(joinUrl(API, `/queue/${btn.dataset.qdel}`), {
        method: "DELETE",
      });
      setTimeout(loadQueue, 200);
    } catch (err) {
      console.error(err);
    }
  });
  qStatusSel?.addEventListener("change", loadQueue);

  // auto-refresh tylko gdy zalogowany + tylko aktywna zakładka
  function tick() {
    currentTab === "torrents" ? loadTorrents() : loadQueue();
  }
  function kickRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (!window.getAuthToken || !window.getAuthToken()) return;
    tick();
    refreshTimer = setInterval(tick, 3000);
  }
  window.addEventListener("pf:authorized", kickRefresh);
  window.addEventListener("pf:unauthorized", () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  // start na Torrenty
  setTab("torrents");
});
