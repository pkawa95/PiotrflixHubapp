/* PiotrFlix – SPA logic */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- Config & storage ---------- */
const BASE_KEY = "pf_base";
const TOKEN_KEY = "pf_token";
const baseInput = $("#baseUrl");
const getBase = () => localStorage.getItem(BASE_KEY) || baseInput?.value || "https://api.pkportfolio.pl";
const setBase = (v) => localStorage.setItem(BASE_KEY, v);
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/* ---------- Simple API helper ---------- */
async function api(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${getBase()}${path}`;
  const headers = opts.headers || {};
  headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const t = getToken();
  if (t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) throw new Error("401 Unauthorized");
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

/* ---------- Auth screen switch (tabs + swipe) ---------- */
const auth = $("#auth");
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const tabLogin = $("#tab-login");
const tabRegister = $("#tab-register");
let authTab = "login";

function showAuthTab(tab) {
  authTab = tab;
  tabLogin.classList.toggle("active", tab === "login");
  tabRegister.classList.toggle("active", tab === "register");
  loginForm.classList.toggle("hidden", tab !== "login");
  registerForm.classList.toggle("hidden", tab !== "register");
}
tabLogin.onclick = () => showAuthTab("login");
tabRegister.onclick = () => showAuthTab("register");

// swipe gesture
let sx = null, sy = null;
auth.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY;
}, {passive:true});
auth.addEventListener("touchend", (e) => {
  if (sx==null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.abs(dx) > 40 && Math.abs(dy) < 30) {
    showAuthTab(dx < 0 ? "register" : "login");
  }
  sx = sy = null;
});

/* ---------- Login ---------- */
const loginMsg = $("#loginMsg");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginEmailErr").textContent = "";
  $("#loginPasswordErr").textContent = "";
  loginMsg.textContent = "";

  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;

  if (!email) { $("#loginEmailErr").textContent = "Wprowadź email"; return; }
  if (!password) { $("#loginPasswordErr").textContent = "Wprowadź hasło"; return; }

  try {
    const j = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!j?.access_token) throw new Error("Brak tokenu w odpowiedzi");
    setToken(j.access_token);
    loginMsg.textContent = "Zalogowano.";
    await afterLogin();
  } catch (err) {
    loginMsg.textContent = "Błąd logowania: " + (err.message || err);
  }
});

/* ---------- Register ---------- */
const regMsg = $("#regMsg");
function setErr(id, msg){ $(id).textContent = msg || ""; }
function emailOk(e){ return /^\S+@\S+\.\S+$/.test(String(e||"").trim()); }

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  // clear errors
  ["#regFirstErr","#regLastErr","#regEmailErr","#regPass1Err","#regPass2Err"].forEach(id=>setErr(id,""));
  regMsg.textContent = "";

  const first = $("#regFirst").value.trim();
  const last = $("#regLast").value.trim();
  const email = $("#regEmail").value.trim().toLowerCase();
  const p1 = $("#regPass1").value;
  const p2 = $("#regPass2").value;

  if(!first) setErr("#regFirstErr","Uzupełnij imię");
  if(!last) setErr("#regLastErr","Uzupełnij nazwisko");
  if(!emailOk(email)) setErr("#regEmailErr","Nieprawidłowy email");
  if(p1.length < 6) setErr("#regPass1Err","Min. 6 znaków");
  if(p1 !== p2) setErr("#regPass2Err","Hasła się różnią");

  if(!first || !last || !emailOk(email) || p1.length<6 || p1!==p2) return;

  try{
    // backend może przyjmować tylko email/hasło – imię i nazwisko zachowujemy tu na przyszłość
    await api("/auth/register", { method:"POST", body: JSON.stringify({ email, password:p1, first_name:first, last_name:last }) });
    // auto login
    const j = await api("/auth/login", { method:"POST", body: JSON.stringify({ email, password:p1 }) });
    setToken(j.access_token);
    regMsg.textContent = "Konto utworzone. Logowanie...";
    await afterLogin();
  }catch(err){
    regMsg.textContent = "Błąd rejestracji: " + (err.message || err);
  }
});

/* ---------- App shell/nav ---------- */
const appHeader = $("#appHeader");
const appMain = $("#appMain");
const bottomNav = $("#bottomNav");
const who = $("#who");
const logoutBtn = $("#logoutBtn");

async function refreshUser(){
  try{
    const j = await api("/auth/whoami", { method:"GET" });
    who.textContent = `zalogowany: ${j.email}`;
  }catch{
    who.textContent = "—";
  }
}

async function afterLogin(){
  // pokaż app, schowaj auth
  auth.classList.add("hidden");
  appHeader.classList.remove("hidden");
  appMain.classList.remove("hidden");
  bottomNav.classList.remove("hidden");

  await refreshUser();
  await loadAvailable();
  await loadQueue();
  await loadActive();
}

logoutBtn.onclick = () => {
  setToken("");
  location.reload();
};

/* ---------- Theme ---------- */
const bodyEl = document.documentElement;
const themeToggle = $("#themeToggle");
const themeBtn = $("#toggleTheme");
const THEME_KEY = "pf_theme";
function setTheme(mode){
  bodyEl.setAttribute("data-theme", mode);
  localStorage.setItem(THEME_KEY, mode);
}
setTheme(localStorage.getItem(THEME_KEY) || "dark");
(themeToggle||{}).onclick = () => setTheme(bodyEl.getAttribute("data-theme")==="dark" ? "light":"dark");
(themeBtn||{}).onclick = () => setTheme(bodyEl.getAttribute("data-theme")==="dark" ? "light":"dark");

/* ---------- Bottom nav routing ---------- */
function showPage(name){
  $$(".page").forEach(p => p.classList.toggle("hidden", p.dataset.page !== name));
  $$("#bottomNav button").forEach(b => b.classList.toggle("active", b.dataset.target===name));
}
$$("#bottomNav button").forEach(b => b.addEventListener("click", () => showPage(b.dataset.target)));
showPage("torrents");

/* ---------- Settings ---------- */
$("#saveBase").onclick = () => { setBase($("#baseUrl").value.trim()); alert("Zapisano."); };

/* ---------- Available ---------- */
const aGrid = $("#aGrid");
const aInfo = $("#aInfo");

function cardAvailable(it){
  const pct = Math.round((it.progress||0)*100);
  return `
  <div class="av">
    <img src="${it.image_url||it.poster||''}" alt="">
    <div class="in">
      <div class="title">${(it.display_title||it.title||'—')}</div>
      <div class="meta">${(it.kind||it.type||'').toString()} • ${it.year||''}</div>
      <div class="progress" style="margin-top:6px"><span style="width:${pct}%"></span></div>
      <div class="meta" style="margin-top:4px">${pct}% obejrzane</div>
    </div>
  </div>`;
}

async function loadAvailable(){
  aInfo.textContent = "Ładuję...";
  aGrid.innerHTML = "";
  try{
    const j = await api("/me/available", { method:"GET" });
    const films = Array.isArray(j?.films) ? j.films : [];
    const series = Array.isArray(j?.series) ? j.series : [];
    let items = [...films, ...series];

    const filter = $("#aFilter").value?.toLowerCase() || "";
    const kind = $("#aKind").value || "all";
    const sort = $("#aSort").value || "recent";

    if (kind!=="all") items = items.filter(x => (x.kind||x.type)===kind);
    if (filter) items = items.filter(x => (x.display_title||x.title||"").toLowerCase().includes(filter));

    if (sort==="title") items.sort((a,b)=> (a.display_title||a.title||"").localeCompare(b.display_title||b.title||""));
    else if (sort==="progress") items.sort((a,b)=>(b.progress||0)-(a.progress||0));
    else items.sort((a,b)=> String(b.updated_at||"").localeCompare(String(a.updated_at||"")));

    aGrid.innerHTML = items.map(cardAvailable).join("");
    aInfo.textContent = `Pozycji: ${items.length}`;
  }catch(err){
    aInfo.textContent = "Błąd: " + (err.message||err);
  }
}
$("#aRefresh").onclick = loadAvailable;
$("#aFilter").addEventListener("input", loadAvailable);
$("#aKind").addEventListener("change", loadAvailable);
$("#aSort").addEventListener("change", loadAvailable);

/* ---------- Search ---------- */
let provider = "yts_html";
$("#providerSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-provider]");
  if(!b) return;
  provider = b.dataset.provider;
  $$("#providerSeg button").forEach(x=>x.classList.toggle("active", x===b));
});

$("#sBtn").onclick = doSearch;
$("#sQuery").addEventListener("keydown", e => { if(e.key==="Enter") doSearch(); });

async function doSearch(){
  const query = $("#sQuery").value.trim();
  if(!query) return;
  const quality = $("#sQuality").value;
  const body = { query, provider, type: "movie", page: 1, extra: {} };

  $("#sResults").innerHTML = "";
  try{
    const j = await api("/search", { method:"POST", body: JSON.stringify(body) });
    const items = j.results || [];
    $("#sResults").innerHTML = items.map(cardSearch).join("");
  }catch(err){
    $("#sResults").innerHTML = `<p class="muted">Błąd: ${(err.message||err)}</p>`;
  }
}

function cardSearch(item){
  const id = btoa((item.url || item.magnet || item.title).slice(0,200)).replace(/=+/g,'');
  const hasMagnet = !!item.magnet;
  const qSel = `
    <select id="q_${id}">
      <option value="">auto</option>
      <option value="2160p">2160p</option>
      <option value="1080p" selected>1080p</option>
      <option value="720p">720p</option>
    </select>`;
  const resolveBtn = (!hasMagnet && item.url)
    ? `<button class="btn" onclick="resolveAndQueue('${encodeURIComponent(item.url)}','${item.provider}','${id}')">Resolve & dodaj</button>`
    : "";
  const addBtn = hasMagnet
    ? `<button class="btn success" onclick="addToQueue('${encodeURIComponent(item.magnet)}','${id}')">Dodaj do kolejki</button>`
    : "";
  return `
  <article class="card">
    <img src="${item.image||''}" class="poster" alt="">
    <div class="body">
      <h3>${item.title||'—'}</h3>
      <div class="muted"><span class="badge">${item.provider||'—'}</span></div>
      <p class="desc">${item.description||''}</p>
      <div class="row">
        ${resolveBtn}${addBtn}
        <span class="muted">Jakość: ${qSel}</span>
      </div>
    </div>
  </article>`;
}

window.resolveAndQueue = async (encodedUrl, provider, id) => {
  const url = decodeURIComponent(encodedUrl);
  const quality = ($("#q_"+id)?.value) || $("#sQuality").value || "";
  try{
    const j = await api("/search/resolve", { method:"POST", body: JSON.stringify({ url, provider, quality }) });
    if(!j.magnet) { alert("Nie udało się wyciągnąć magnet linku"); return; }
    await addToQueue(encodeURIComponent(j.magnet), id);
    await loadQueue();
    showPage("torrents");
  }catch(err){ alert("Resolve error: " + (err.message||err)); }
};

window.addToQueue = async (encMagnet, id) => {
  const magnet = decodeURIComponent(encMagnet);
  const quality = ($("#q_"+id)?.value) || $("#sQuality").value || "";
  try{
    await api("/torrent/add", {
      method:"POST",
      body: JSON.stringify({ magnet, download_kind:"movie", meta:{ quality } })
    });
    alert("Dodano do kolejki.");
  }catch(err){ alert("Add error: " + (err.message||err)); }
};

/* ---------- Torrents ---------- */
/* Kolejka (API /queue/list) i aktywne (API /torrents/status/list) */
const tInfo = $("#tInfo");
const qWrap = $("#tQueue");
const aWrap = $("#tActive");

$('[data-t-tab="queue"]').onclick = () => { qWrap.classList.remove("hidden"); aWrap.classList.add("hidden"); setTTab("queue"); };
$('[data-t-tab="active"]').onclick = () => { aWrap.classList.remove("hidden"); qWrap.classList.add("hidden"); setTTab("active"); };
function setTTab(name){
  $$('.tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tTab===name));
}

async function loadQueue(){
  try{
    const j = await api("/queue/list?status=all&limit=200", { method:"GET" });
    const items = Array.isArray(j) ? j : (j.items || []);
    qWrap.innerHTML = items.map(row => {
      const canDelete = !row.status || ["new","picked","error"].includes(row.status);
      const meta = row.payload?.meta || {};
      const title = row.display_title || meta.display_title || row.payload?.title || "—";
      const img = meta.image_url || row.image_url || "";
      return `
        <div class="t-row">
          <div class="t-name">${title}</div>
          <div class="stat">NO: ${row.task_no ?? "—"} · ${row.kind||''}</div>
          <div class="stat">${row.status||'new'}</div>
          <div class="t-ops">
            <button class="btn danger" ${canDelete? "":"disabled"} onclick="deleteTask(${row.id})">Usuń</button>
          </div>
        </div>`;
    }).join("");
  }catch(err){
    qWrap.innerHTML = `<p class="muted">Błąd: ${(err.message||err)}</p>`;
  }
}
window.deleteTask = async (id) => {
  if(!confirm("Usunąć z kolejki?")) return;
  try{ await api(`/queue/${id}`, { method:"DELETE" }); await loadQueue(); }catch(err){ alert(err.message||err); }
};

async function loadActive(){
  try{
    const j = await api("/torrents/status/list?limit=400&order=desc", { method:"GET" });
    const rows = Array.isArray(j) ? j : [];
    const sort = $("#tSort").value || "name";
    rows.sort((a,b) => {
      if (sort==="progress") return (b.progress||0)-(a.progress||0);
      if (sort==="state") return String(a.state||"").localeCompare(String(b.state||""));
      return String(a.display_title||a.name||"").localeCompare(b.display_title||b.name||"");
    });

    aWrap.innerHTML = rows.map(r => {
      const p = Math.round((r.progress||0)*100);
      const speeds = `<span class="stat">DL ${fmtBytes(r.dl_speed)}/s</span> <span class="stat">UL ${fmtBytes(r.ul_speed)}/s</span>`;
      return `
        <div class="t-row">
          <div class="t-name">${(r.display_title||r.name||"—")}</div>
          <div>
            <div class="progress"><span style="width:${p}%"></span></div>
            <div class="stat">${p}% (${fmtBytes(r.downloaded_bytes)}/${fmtBytes(r.size_bytes)})</div>
          </div>
          <div class="stat">${(r.state||"").toUpperCase()} · ${speeds}</div>
          <div class="t-ops">
            <button class="btn" onclick="tPause('${r.info_hash}')">Pauza</button>
            <button class="btn success" onclick="tResume('${r.info_hash}')">Wznów</button>
            <button class="btn danger" onclick="tRemove('${r.info_hash}', false)">Usuń</button>
            <button class="btn danger" onclick="tRemove('${r.info_hash}', true)">Usuń + dane</button>
          </div>
        </div>`;
    }).join("");
    tInfo.textContent = `Aktywnych: ${rows.length}`;
  }catch(err){
    aWrap.innerHTML = `<p class="muted">Błąd: ${(err.message||err)}</p>`;
  }
}
function fmtBytes(n){
  n = Number(n||0); const u=['B','KiB','MiB','GiB','TiB']; let i=0;
  while(n>=1024 && i<u.length-1){ n/=1024; i++; }
  return `${n.toFixed(n<10?2:1)} ${u[i]}`;
}
async function pushCmd(kind, info_hash=null, args={}){
  await api("/torrents/commands/push", { method:"POST", body: JSON.stringify({ device_id:"default", info_hash, kind, args }) });
}
window.tPause = async (ih)=>{ await pushCmd("pause", ih); setTimeout(loadActive, 400); };
window.tResume = async (ih)=>{ await pushCmd("resume", ih); setTimeout(loadActive, 400); };
window.tRemove = async (ih, withData)=>{ if(!confirm(withData?"Usunąć torrent + dane?":"Usunąć torrent?")) return;
  await pushCmd(withData?"remove_data":"remove", ih); setTimeout(loadActive, 600); };

$("#tApplyRate").onclick = async ()=>{
  const v = Number($("#tRate").value||"0"); // MiB/s
  await pushCmd("set_rate_global", null, { limit_mbs: v });
  alert("Ustawiono globalny limit: " + (v ? v + " MiB/s" : "unlimited"));
};

$("#tSort").addEventListener("change", loadActive);

/* ---------- Startup ---------- */
(function boot(){
  // zapisz ustawiony base url
  if (!localStorage.getItem(BASE_KEY)) setBase(getBase());
  if (baseInput) baseInput.value = getBase();

  if (getToken()) {
    // użytkownik zalogowany — pokaż app
    afterLogin();
  } else {
    // zostajemy na ekranie auth
    auth.classList.remove("hidden");
  }
})();
