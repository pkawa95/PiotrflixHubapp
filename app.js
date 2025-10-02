/* ====== CONFIG / HELPERS ====== */
const sel = (id)=>document.getElementById(id);
const qs = (s, root=document)=>root.querySelector(s);
const qsa = (s, root=document)=>[...root.querySelectorAll(s)];

const DEFAULT_BASE = "https://api.pkportfolio.pl";
const BASE_URL = localStorage.getItem("pf_base") || DEFAULT_BASE;
const token = ()=>localStorage.getItem("pf_token") || "";
const setToken = (t)=>{ t ? localStorage.setItem("pf_token", t) : localStorage.removeItem("pf_token"); };

function setBaseUrl(url){
  const clean = (url||"").trim() || DEFAULT_BASE;
  localStorage.setItem("pf_base", clean);
  sel("baseUrlLabel").textContent = clean;
  sel("baseUrlInput").value = clean;
}
setBaseUrl(BASE_URL);

async function api(path, opt={}){
  const headers = opt.headers || {};
  headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const t = token();
  if (t) headers["Authorization"] = "Bearer " + t;
  const url = path.startsWith("http") ? path : ( (localStorage.getItem("pf_base") || DEFAULT_BASE) + path );
  const res = await fetch(url, {...opt, headers});
  if(res.status === 401) throw new Error("401 Unauthorized");
  const ct = res.headers.get("content-type") || "";
  if(ct.includes("application/json")) return await res.json();
  return await res.text();
}

/* ====== THEME ====== */
function setTheme(mode){ // 'light' | 'dark' | 'auto'
  if(mode === "auto"){
    document.documentElement.setAttribute("data-theme", (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }else{
    document.documentElement.setAttribute("data-theme", mode);
  }
  localStorage.setItem("pf_theme", mode);
  qsa(".seg-btn").forEach(b=>b.classList.toggle("active", b.dataset.theme===mode));
}
sel("themeToggle").onclick = ()=>{
  const cur = document.documentElement.getAttribute("data-theme");
  setTheme(cur==="dark" ? "light" : "dark");
};
qsa(".seg-btn").forEach(b=> b.addEventListener("click", ()=> setTheme(b.dataset.theme)));
setTheme(localStorage.getItem("pf_theme") || "dark");

/* ====== AUTH VIEW (LOGIN / REGISTER + SWIPE) ====== */
const authEl = sel("auth");
const appEl  = sel("app");

// Tabs
const tabLogin = sel("tab-login");
const tabRegister = sel("tab-register");
const loginForm = sel("loginForm");
const registerForm = sel("registerForm");

function showLogin(){
  tabLogin.classList.add("active"); tabLogin.setAttribute("aria-selected","true");
  tabRegister.classList.remove("active"); tabRegister.setAttribute("aria-selected","false");
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
}
function showRegister(){
  tabRegister.classList.add("active"); tabRegister.setAttribute("aria-selected","true");
  tabLogin.classList.remove("active"); tabLogin.setAttribute("aria-selected","false");
  registerForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
}
tabLogin.onclick = showLogin;
tabRegister.onclick = showRegister;

// Swipe (touch) to toggle
let touchStartX = 0;
authEl.addEventListener("touchstart", e=>{ touchStartX = e.changedTouches[0].clientX; }, {passive:true});
authEl.addEventListener("touchend", e=>{
  const dx = e.changedTouches[0].clientX - touchStartX;
  if(Math.abs(dx) < 40) return;
  if(dx < 0) showRegister(); else showLogin();
});

// Validation helpers
const emailOk = e => /^\S+@\S+\.\S+$/.test(String(e||"").trim());
function setErr(id, msg){ const el=sel(id); if(!el) return; el.textContent = msg||""; }

// LOGIN submit
loginForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  setErr("loginEmailErr","");
  setErr("loginPassErr","");
  sel("loginMsg").textContent = "";

  const email = sel("loginEmail").value.trim();
  const password = sel("loginPass").value;

  let valid = true;
  if(!emailOk(email)){ setErr("loginEmailErr","Nieprawidłowy email."); valid=false; }
  if((password||"").length<1){ setErr("loginPassErr","Podaj hasło."); valid=false; }
  if(!valid) return;

  try{
    const j = await api("/auth/login", {method:"POST", body: JSON.stringify({email, password})});
    if(!j || !j.access_token) throw new Error("Brak tokenu w odpowiedzi.");
    setToken(j.access_token);
    sel("loginMsg").textContent = "Zalogowano.";
    await afterLogin();
  }catch(err){
    sel("loginMsg").innerHTML = `<span class="err">${err.message||err}</span>`;
  }
});

// REGISTER submit
registerForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  ["regFirstErr","regLastErr","regEmailErr","regPassErr","regPass2Err"].forEach(id=>setErr(id,""));
  sel("regMsg").textContent = "";

  const first = sel("regFirst").value.trim();
  const last  = sel("regLast").value.trim();
  const email = sel("regEmail").value.trim().toLowerCase();
  const p1 = sel("regPass").value;
  const p2 = sel("regPass2").value;

  let ok = true;
  if(!first){ setErr("regFirstErr","Wymagane."); ok=false; }
  if(!last){ setErr("regLastErr","Wymagane."); ok=false; }
  if(!emailOk(email)){ setErr("regEmailErr","Nieprawidłowy email."); ok=false; }
  if((p1||"").length<6){ setErr("regPassErr","Min. 6 znaków."); ok=false; }
  if(p1!==p2){ setErr("regPass2Err","Hasła się różnią."); ok=false; }
  if(!ok) return;

  try{
    // jeżeli backend akceptuje pola imię/nazwisko – można je przesłać dodatkowo
    await api("/auth/register", {method:"POST", body: JSON.stringify({email, password:p1, first_name:first, last_name:last})});
    // auto-login
    const j = await api("/auth/login", {method:"POST", body: JSON.stringify({email, password:p1})});
    if(j && j.access_token){
      setToken(j.access_token);
      sel("regMsg").textContent = "Konto utworzone. Zalogowano.";
      await afterLogin();
    }else{
      sel("regMsg").textContent = "Konto utworzone. Zaloguj się.";
      showLogin();
    }
  }catch(err){
    sel("regMsg").innerHTML = `<span class="err">${err.message||err}</span>`;
  }
});

sel("logoutBtn").onclick = async ()=>{ setToken(""); showAuth(); };

/* ====== POST-LOGIN BOOT ====== */
async function refreshUser(){
  try{
    const j = await api("/auth/whoami", {method:"GET"});
    sel("who").innerHTML = `<span class="muted">zalogowany:</span> ${j.email} (id: ${j.user_id})`;
  }catch(_){
    sel("who").textContent = "niezalogowany";
  }
}
function showApp(){ authEl.classList.add("hidden"); appEl.classList.remove("hidden"); }
function showAuth(){ appEl.classList.add("hidden"); authEl.classList.remove("hidden"); }

async function afterLogin(){
  await refreshUser();
  showApp();
  setBaseUrl(localStorage.getItem("pf_base") || DEFAULT_BASE);
  await loadDevices();
  await loadTorrents();
  await loadAvailable();
}

/* ====== BOTTOM NAV (single page) ====== */
const views = qsa(".view");
const navBtns = qsa(".nav-btn");
function setTab(name){
  views.forEach(v=> v.classList.toggle("active", v.dataset.tab === name));
  navBtns.forEach(b=> b.classList.toggle("active", b.dataset.target === name));
  window.history.replaceState({}, "", "#"+name);
}
navBtns.forEach(b=> b.addEventListener("click", ()=> setTab(b.dataset.target)));
window.addEventListener("hashchange", ()=>{
  const h = (location.hash||"").replace("#","");
  if(["torrents","search","available","options"].includes(h)) setTab(h);
});
setTab((location.hash||"").replace("#","") || "torrents");

/* ====== OPTIONS ====== */
sel("saveBaseUrl").onclick = ()=>{ setBaseUrl(sel("baseUrlInput").value); };
sel("baseUrlInput").value = localStorage.getItem("pf_base") || DEFAULT_BASE;

/* ====== DEVICES (torrent klienci) ====== */
function activeDevice(){ return localStorage.getItem("pf_device") || ""; }
function setActiveDevice(id){
  if(id) localStorage.setItem("pf_device", id); else localStorage.removeItem("pf_device");
  const selEl = sel("deviceSel"); if (selEl && selEl.value !== id) selEl.value = id || "";
  sel("devInfo").textContent = id ? `Aktywne: ${id}` : "Wybierz urządzenie";
  loadTorrents();
}
async function loadDevices(){
  const deviceSel = sel("deviceSel");
  deviceSel.innerHTML = "";
  try{
    let list = [];
    try{
      list = await api("/torrents/devices",{method:"GET"});
    }catch(_){
      const j = await api("/torrents/status/list?limit=1&order=desc",{method:"GET"});
      const one = Array.isArray(j) ? j[0] : null;
      if(one?.device_id) list = [{device_id: one.device_id, torrents:1, last_status_at: one.updated_at, pending_commands:0}];
    }
    if(!Array.isArray(list)) list = [];
    const options = [`<option value="">— wybierz urządzenie —</option>`]
      .concat(list.map(d=>{
        const label = `${d.device_id}  —  torrents:${d.torrents||0}  pending:${d.pending_commands||0}  ${d.last_status_at?`(${new Date(d.last_status_at).toLocaleString()})`:''}`;
        return `<option value="${d.device_id}">${label}</option>`;
      }));
    deviceSel.innerHTML = options.join("");
    const prev = activeDevice();
    if(prev && list.some(x=>x.device_id===prev)) deviceSel.value = prev;
    else if(list.length===1) deviceSel.value = list[0].device_id;
    setActiveDevice(deviceSel.value);
  }catch(e){
    deviceSel.innerHTML = `<option value="">(błąd: ${e.message||e})</option>`;
  }
}
sel("deviceSel").addEventListener("change", e=> setActiveDevice(e.target.value));
sel("setGlobRate").onclick = async ()=>{
  const v = parseFloat(sel("globRate").value || "0");
  const dev = activeDevice(); if(!dev){ alert("Najpierw wybierz urządzenie."); return; }
  await api("/torrents/commands/push",{method:"POST", body: JSON.stringify({device_id: dev, info_hash:null, kind:"set_rate_global", args:{limit_mbs:isNaN(v)?0:v}})});
};

/* ====== TORRENTS ====== */
const tBody = sel("tBody");
const tInfo = sel("tInfo");
let tAutoTimer = null;
sel("tRefresh").onclick = loadTorrents;
sel("tAuto").onclick = ()=>{
  if(tAutoTimer){ clearInterval(tAutoTimer); tAutoTimer=null; sel("tAuto").textContent="Auto: OFF"; }
  else{ tAutoTimer=setInterval(loadTorrents, 4000); sel("tAuto").textContent="Auto: ON"; loadTorrents(); }
};

function fmtBytes(n){ n=Number(n||0); const u=['B','KiB','MiB','GiB','TiB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return `${n.toFixed(n<10?2:1)} ${u[i]}`; }
function fmtSpeed(bps){ return fmtBytes(bps) + "/s"; }
function fmtETA(sec){ sec=Number(sec||-1); if(sec<0) return "—"; const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return `${h? h+'h ':''}${m? m+'m ':''}${s?s+'s':''}`.trim()||"0s"; }
function pill(status){ const s=(status||"").toLowerCase(); return `<span class="badge">${s||"?"}</span>`; }

async function pushCmd(kind, info_hash=null, args={}){
  const dev = activeDevice(); if(!dev){ alert("Najpierw wybierz urządzenie."); return; }
  await api("/torrents/commands/push",{method:"POST", body: JSON.stringify({device_id: dev, info_hash, kind, args})});
}
window.tcmd_pause = async (ih)=>{ await pushCmd("pause", ih); setTimeout(loadTorrents, 500); };
window.tcmd_resume = async (ih)=>{ await pushCmd("resume", ih); setTimeout(loadTorrents, 500); };
window.tcmd_remove = async (ih, withData)=>{ if(!confirm(withData?"Usunąć TORRENT + DANE?":"Usunąć torrent z klienta?")) return; await pushCmd(withData?"remove_data":"remove", ih); setTimeout(loadTorrents, 700); };
window.tcmd_recheck = async (ih)=>{ await pushCmd("recheck", ih); setTimeout(loadTorrents, 500); };
window.tcmd_set_rate = async (ih, inputId)=>{ const v=parseFloat(sel(inputId).value||"0"); await pushCmd("set_rate", ih, {limit_mbs:isNaN(v)?0:v}); setTimeout(loadTorrents, 400); };

function renderTorrents(items){
  if(!Array.isArray(items) || !items.length){
    tBody.innerHTML = "";
    tInfo.textContent = "Brak danych (uruchom klienta lub poczekaj na raport).";
    return;
  }
  tInfo.textContent = `Pozycje: ${items.length}`;
  tBody.innerHTML = items.map(r=>{
    const p = Math.round((r.progress||0)*100);
    const size = fmtBytes(r.size_bytes);
    const dled = fmtBytes(r.downloaded_bytes);
    const sp = `<div class="hint"><strong>DL:</strong> ${fmtSpeed(r.dl_speed)} &nbsp; <strong>UL:</strong> ${fmtSpeed(r.ul_speed)} &nbsp; <strong>ETA:</strong> ${fmtETA(r.eta)}</div>`;
    const peers = `${r.peers||0} / ${r.seeds||0}`;
    const rateId = "rate_" + r.info_hash;
    return `
      <tr>
        <td><code>${r.info_hash}</code></td>
        <td>${(r.display_title||r.name||"").replace(/</g,"&lt;")}</td>
        <td style="min-width:180px">
          <div class="progress"><span style="width:${p}%"></span></div>
          <div class="hint">${p}% &nbsp; (${dled}/${size})</div>
        </td>
        <td>${sp}</td>
        <td>${peers}</td>
        <td>${size}</td>
        <td>${(r.ratio||0).toFixed(2)}</td>
        <td>${pill(r.state)}</td>
        <td class="nowrap">
          <button class="btn" onclick="tcmd_pause('${r.info_hash}')">Pause</button>
          <button class="btn success" onclick="tcmd_resume('${r.info_hash}')">Resume</button>
          <button class="btn" onclick="tcmd_recheck('${r.info_hash}')">Recheck</button>
          <button class="btn" onclick="tcmd_set_rate('${r.info_hash}','${rateId}')">Limit</button>
          <input id="${rateId}" type="number" step="0.1" style="width:90px; margin-left:6px" placeholder="MiB/s">
          <button class="btn" onclick="tcmd_remove('${r.info_hash}', false)">Remove</button>
          <button class="btn" onclick="tcmd_remove('${r.info_hash}', true)">Remove+Data</button>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadTorrents(){
  const dev = activeDevice();
  if(!dev){ tInfo.textContent = "Wybierz urządzenie"; tBody.innerHTML=""; return; }
  try{
    const j = await api(`/torrents/status/list?device_id=${encodeURIComponent(dev)}&limit=500&order=desc`,{method:"GET"});
    renderTorrents(Array.isArray(j)?j:[]);
  }catch(e){
    tInfo.innerHTML = `<span class="err">${e.message||e}</span>`;
  }
}

/* ====== SEARCH ====== */
const results = sel("results");
function cardTemplate(item){
  const img = item.image || "";
  const title = item.title || "—";
  const desc = item.description || "";
  const provider = item.provider || "—";
  const hasMagnet = !!item.magnet;
  const url = item.url || "";
  const rating = item.rating ? `★ ${item.rating}` : "";
  const id = btoa((url || item.magnet || title).slice(0,200)).replace(/=+/g,"");
  const qSel = `<select id="q_${id}">
      <option value="">auto</option>
      <option value="2160p">2160p</option>
      <option value="1080p" selected>1080p</option>
      <option value="720p">720p</option>
    </select>`;
  const resolveBtn = (!hasMagnet && url)
    ? `<button class="btn" onclick="resolveAndQueue('${encodeURIComponent(url)}','${provider}','${id}')">Resolve + Queue</button>` : "";
  const addBtn = hasMagnet
    ? `<button class="btn success" onclick="addToQueue('${encodeURIComponent(item.magnet)}','${id}')">Dodaj do kolejki</button>` : "";
  return `
    <div class="card">
      <img src="${img}" alt="">
      <div class="body">
        <h3>${title}</h3>
        <div class="muted"><span class="badge">${provider}</span> ${rating}</div>
        <p class="desc">${desc}</p>
        <div class="actions">${resolveBtn}${addBtn}<span class="hint">Jakość: ${qSel}</span></div>
      </div>
    </div>`;
}
function extractCardMeta(id){
  const card = results.querySelector(`#q_${id}`)?.closest(".card");
  if(!card) return {title:"", image:""};
  const title = (card.querySelector("h3")?.textContent||"").trim();
  const image = (card.querySelector("img")?.getAttribute("src")||"").trim();
  return {title, image};
}
async function searchNow(){
  results.innerHTML = "";
  sel("countInfo").textContent = "szukam...";
  const body = {
    query: sel("query").value.trim(),
    provider: sel("provider").value.trim(),
    type: sel("mtype").value.trim(),
    page: 1,
    extra: {}
  };
  const tmdb = (sel("tmdb").value||"").trim(); if(tmdb) body.extra.tmdb_api_key = tmdb;
  if(!body.query){ sel("countInfo").textContent = "wpisz frazę"; return; }
  try{
    const j = await api("/search",{method:"POST", body: JSON.stringify(body)});
    const items = j.results || [];
    sel("countInfo").textContent = `Wyniki: ${items.length}`;
    results.innerHTML = items.map(cardTemplate).join("");
  }catch(e){
    sel("countInfo").innerHTML = `<span class="err">${e.message||e}</span>`;
  }
}
sel("searchBtn").onclick = searchNow;
sel("query").addEventListener("keydown", e=>{ if(e.key==="Enter") searchNow(); });

window.resolveAndQueue = async (encodedUrl, provider, id)=>{
  const url = decodeURIComponent(encodedUrl);
  const quality = (sel("q_"+id)?.value) || sel("quality").value || "";
  try{
    const j = await api("/search/resolve",{method:"POST", body: JSON.stringify({url, provider, quality})});
    if(!j.magnet){ alert("Nie udało się wyciągnąć magnet linku."); return; }
    await addToQueue(encodeURIComponent(j.magnet), id);
  }catch(e){ alert("Resolve error: " + (e.message||e)); }
};

window.addToQueue = async (encMagnet, id)=>{
  const magnet = decodeURIComponent(encMagnet);
  const download_kind = sel("mtype").value || "movie";
  const qsel = (id && sel("q_"+id)) ? sel("q_"+id).value : (sel("quality").value || "");
  const metaFromCard = id ? extractCardMeta(id) : {title:"", image:""};
  try{
    const meta = { display_title: metaFromCard.title||undefined, image_url: metaFromCard.image||undefined, quality:qsel||undefined };
    const payload = { magnet, download_kind, meta };
    await api("/torrent/add",{method:"POST", body: JSON.stringify(payload)});
    alert("Dodano do kolejki.");
  }catch(e){ alert("Add error: " + (e.message||e)); }
};

/* ====== AVAILABLE ====== */
const availableGrid = sel("availableGrid");
const avInfo = sel("avInfo");
let _availableRaw = [];

function _first(obj, keys, dflt=""){ for(const k of keys){ if(obj && obj[k]!=null && obj[k]!== "") return obj[k]; } return dflt; }
function _num(x,d=0){ const n=Number(String(x).replace(",",".")); return isFinite(n)?n:d; }
function _bool(x){ return !!(x===true || x==="1" || x===1 || String(x).toLowerCase()==="true"); }

function _canon(r){
  const title  = _first(r, ["display_title","title","name"],"—");
  const poster = _first(r, ["image_url","poster","poster_url","thumb","cover","cover_url"],"");
  const kindRaw = (_first(r, ["kind","type","mtype","media_type"],"")||"").toLowerCase();
  const isSeries = kindRaw==="series" || _bool(r.is_series) || !!r.season || !!r.episode;
  const kind = isSeries ? "series" : "movie";
  const year = _first(r,["year","release_year","y"], null);

  let pos = _num(_first(r,["watched_seconds","position","last_position","pos","position_ms"],0));
  let dur = _num(_first(r,["duration","runtime","total_seconds","duration_sec","duration_ms"],0));
  if(String(_first(r,["position_ms"],"")).trim()!=="") pos = _num(r.position_ms)/1000;
  if(String(_first(r,["duration_ms"],"")).trim()!=="") dur = _num(r.duration_ms)/1000;
  const prog = (dur>0) ? Math.max(0,Math.min(1,pos/dur)) : 0;

  const season=_num(_first(r,["season","s"], null), null);
  const episode=_num(_first(r,["episode","e"], null), null);
  const updated_at=_first(r,["updated_at","mtime","added_at","ts","last_update","watchedAt"], null);
  const size_bytes=_num(_first(r,["size_bytes","filesize","size"],0));

  return {title,poster,kind,year,progress:prog,season,episode,updated_at,size_bytes};
}
function _ep(it){ if(it.kind!=="series") return ""; const s=it.season!=null?String(it.season).padStart(2,"0"):"--"; const e=it.episode!=null?String(it.episode).padStart(2,"0"):"--"; return ` · S${s}E${e}`; }
function fmtBytes(n){ n=Number(n||0); const u=['B','KiB','MiB','GiB','TiB']; let i=0; while(n>=1024&&i<u.length-1){ n/=1024; i++; } return `${n.toFixed(n<10?2:1)} ${u[i]}`; }

function renderAvailable(list){
  if(!Array.isArray(list) || !list.length){
    availableGrid.innerHTML = "";
    avInfo.textContent = "Brak danych.";
    return;
  }
  const q = (sel("avQuery").value||"").toLowerCase();
  const k = sel("avKind").value || "all";
  const sort = sel("avSort").value || "recent";

  let items = list.map(_canon);
  if(k!=="all") items = items.filter(x=>x.kind===k);
  if(q) items = items.filter(x=>(x.title||"").toLowerCase().includes(q));

  if(sort==="title") items.sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  else if(sort==="progress") items.sort((a,b)=>(b.progress||0)-(a.progress||0));
  else items.sort((a,b)=> String(b.updated_at||"").localeCompare(String(a.updated_at||"")));

  availableGrid.innerHTML = items.map(it=>{
    const pct = Math.max(0, Math.min(100, Math.round((it.progress||0)*100)));
    const year = it.year ? ` (${it.year})` : "";
    const meta = `${it.kind}${_ep(it)}${it.size_bytes? " · "+fmtBytes(it.size_bytes):""}`;
    return `
      <div class="av-card">
        <div class="poster"><img src="${it.poster||""}" alt=""><div class="vprog"><span style="width:${pct}%"></span></div></div>
        <div class="body">
          <div class="title">${(it.title||"—").replace(/</g,"&lt;")}${year}</div>
          <div class="meta">${meta}</div>
          <div class="tiny">Postęp: ${pct}%</div>
          <div class="actions"><button class="btn success" disabled>Cast ▶ (demo)</button></div>
        </div>
      </div>
    `;
  }).join("");
  avInfo.textContent = `Pozycji: ${items.length}`;
}

async function loadAvailable(){
  avInfo.textContent = "Ładuję...";
  availableGrid.innerHTML = "";
  try{
    const j = await api("/me/available",{method:"GET"});
    const films = Array.isArray(j?.films) ? j.films : [];
    const series = Array.isArray(j?.series) ? j.series : [];
    _availableRaw = films.concat(series);
    renderAvailable(_availableRaw);
  }catch(e){
    avInfo.innerHTML = `<span class="err">${e.message||e}</span>`;
  }
}
["avQuery","avKind","avSort"].forEach(id=> sel(id).addEventListener("input", ()=>renderAvailable(_availableRaw)));
sel("avRefresh").onclick = loadAvailable;
let avAutoTimer=null;
sel("avAuto").onclick = ()=>{
  if(avAutoTimer){ clearInterval(avAutoTimer); avAutoTimer=null; sel("avAuto").textContent="Auto: OFF"; }
  else{ avAutoTimer=setInterval(loadAvailable, 10000); sel("avAuto").textContent="Auto: ON"; loadAvailable(); }
};

/* ====== STARTUP ====== */
(async ()=>{
  if(token()){
    try{
      await refreshUser();
      showApp();
      await loadDevices();
      await loadTorrents();
      await loadAvailable();
    }catch(_){
      showAuth();
    }
  }else{
    showAuth();
  }
})();

/* ===== ACCESSIBILITY: klawisze ↔ dla tabów auth */
document.addEventListener("keydown", (e)=>{
  if(appEl.classList.contains("hidden")){
    if(e.key==="ArrowLeft") showLogin();
    if(e.key==="ArrowRight") showRegister();
  }
});
