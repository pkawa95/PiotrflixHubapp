/* PiotrFlix – SPA logic (diff rendering, device-aware commands) */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Config & storage ---------- */
const BASE_KEY   = "pf_base";
const TOKEN_KEY  = "pf_token";
const DEVICE_KEY = "pf_device";
const PLEX_KEY   = "pf_plex_client";

const baseInput = $("#baseUrl");
const getBase   = () => localStorage.getItem(BASE_KEY) || baseInput?.value || "https://api.pkportfolio.pl";
const setBase   = (v) => localStorage.setItem(BASE_KEY, v);

const getToken  = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken  = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

const getDevice = () => localStorage.getItem(DEVICE_KEY) || "";
const setDevice = (v) => (v ? localStorage.setItem(DEVICE_KEY, v) : localStorage.removeItem(DEVICE_KEY));

const getPlex   = () => localStorage.getItem(PLEX_KEY) || "";
const setPlex   = (v) => (v ? localStorage.setItem(PLEX_KEY, v) : localStorage.removeItem(PLEX_KEY));

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

// swipe between tabs
let sx=null, sy=null;
auth.addEventListener("touchstart",(e)=>{ const t=e.changedTouches[0]; sx=t.clientX; sy=t.clientY; },{passive:true});
auth.addEventListener("touchend",(e)=>{ if(sx==null) return; const t=e.changedTouches[0]; const dx=t.clientX-sx, dy=t.clientY-sy;
  if(Math.abs(dx)>40 && Math.abs(dy)<30) showAuthTab(dx<0?"register":"login"); sx=sy=null;
},{passive:true});

/* ---------- Login ---------- */
const loginMsg = $("#loginMsg");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginEmailErr").textContent = "";
  $("#loginPasswordErr").textContent = "";
  loginMsg.textContent = "";

  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  if (!email)   { $("#loginEmailErr").textContent = "Wprowadź email"; return; }
  if (!password){ $("#loginPasswordErr").textContent = "Wprowadź hasło"; return; }

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
const setErr = (id,msg)=>$(id).textContent = msg || "";
const emailOk = (e)=>/^\S+@\S+\.\S+$/.test(String(e||"").trim());

$("#registerForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  ["#regFirstErr","#regLastErr","#regEmailErr","#regPass1Err","#regPass2Err"].forEach(id=>setErr(id,""));
  regMsg.textContent = "";

  const first=$("#regFirst").value.trim();
  const last =$("#regLast").value.trim();
  const email=$("#regEmail").value.trim().toLowerCase();
  const p1   =$("#regPass1").value;
  const p2   =$("#regPass2").value;

  if(!first) setErr("#regFirstErr","Uzupełnij imię");
  if(!last)  setErr("#regLastErr","Uzupełnij nazwisko");
  if(!emailOk(email)) setErr("#regEmailErr","Nieprawidłowy email");
  if(p1.length<6) setErr("#regPass1Err","Min. 6 znaków");
  if(p1!==p2)      setErr("#regPass2Err","Hasła się różnią");
  if(!first||!last||!emailOk(email)||p1.length<6||p1!==p2) return;

  try{
    await api("/auth/register",{method:"POST",body:JSON.stringify({email,password:p1,first_name:first,last_name:last})});
    const j = await api("/auth/login",{method:"POST",body:JSON.stringify({email,password:p1})});
    setToken(j.access_token);
    regMsg.textContent="Konto utworzone. Logowanie...";
    await afterLogin();
  }catch(err){ regMsg.textContent="Błąd rejestracji: "+(err.message||err); }
});

/* ---------- App shell/nav ---------- */
const appHeader=$("#appHeader");
const appMain=$("#appMain");
const bottomNav=$("#bottomNav");
const who=$("#who");
const logoutBtn=$("#logoutBtn");

async function refreshUser(){
  try{ const j=await api("/auth/whoami",{method:"GET"}); who.textContent=`zalogowany: ${j.email}`; }
  catch{ who.textContent="—"; }
}

async function afterLogin(){
  auth.classList.add("hidden");
  appHeader.classList.remove("hidden");
  appMain.classList.remove("hidden");
  bottomNav.classList.remove("hidden");

  // init settings inputs
  if(baseInput) baseInput.value = getBase();
  $("#deviceIdInput").value = getDevice();
  $("#plexClientInput").value = getPlex();

  await refreshUser();
  await loadAvailable();
  await refreshQueue();   // first render
  await refreshActive();  // first render

  // gentle auto refresh (diff) – co 4s aktywne, co 6s kolejka
  setInterval(refreshActive, 4000);
  setInterval(refreshQueue, 6000);
}

logoutBtn.onclick = ()=>{ setToken(""); location.reload(); };

/* ---------- Theme ---------- */
const root = document.documentElement;
const THEME_KEY="pf_theme";
function setTheme(mode){ root.setAttribute("data-theme",mode); localStorage.setItem(THEME_KEY,mode); }
setTheme(localStorage.getItem(THEME_KEY)||"dark");
($("#themeToggle")||{}).onclick = ()=>setTheme(root.getAttribute("data-theme")==="dark"?"light":"dark");
($("#toggleTheme")||{}).onclick = ()=>setTheme(root.getAttribute("data-theme")==="dark"?"light":"dark");

/* ---------- Bottom nav routing ---------- */
function showPage(name){
  $$(".page").forEach(p=>p.classList.toggle("hidden",p.dataset.page!==name));
  $$("#bottomNav button").forEach(b=>b.classList.toggle("active",b.dataset.target===name));
}
$$("#bottomNav button").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.target)));
showPage("torrents");

/* ---------- Settings ---------- */
$("#saveBase").onclick = ()=>{ setBase($("#baseUrl").value.trim()); alert("Zapisano."); };
$("#saveDevices").onclick = ()=>{
  setDevice($("#deviceIdInput").value.trim());
  setPlex($("#plexClientInput").value.trim());
  alert("Zapisano urządzenia.");
};

/* ---------- Available ---------- */
const aGrid=$("#aGrid");
const aInfo=$("#aInfo");
function cardAvailable(it){
  const pct=Math.round((it.progress||0)*100);
  return `
    <div class="av" data-id="${it.id||''}">
      <img src="${it.image_url||it.poster||'assets/placeholder.png'}" alt="">
      <div class="in">
        <div class="title">${(it.display_title||it.title||'—')}</div>
        <div class="meta">${(it.kind||it.type||'').toString()} • ${it.year||''}</div>
        <div class="progress" style="margin-top:6px"><span style="width:${pct}%"></span></div>
        <div class="meta" style="margin-top:4px">${pct}% obejrzane</div>
      </div>
    </div>`;
}
async function loadAvailable(){
  aInfo.textContent="Ładuję...";
  aGrid.innerHTML="";
  try{
    const j=await api("/me/available",{method:"GET"});
    const films=Array.isArray(j?.films)?j.films:[];
    const series=Array.isArray(j?.series)?j.series:[];
    let items=[...films,...series];
    const filter=$("#aFilter").value?.toLowerCase()||"";
    const kind=$("#aKind").value||"all";
    const sort=$("#aSort").value||"recent";

    if(kind!=="all") items=items.filter(x=>(x.kind||x.type)===kind);
    if(filter) items=items.filter(x=>(x.display_title||x.title||"").toLowerCase().includes(filter));

    if(sort==="title") items.sort((a,b)=>(a.display_title||a.title||"").localeCompare(b.display_title||b.title||""));
    else if(sort==="progress") items.sort((a,b)=>(b.progress||0)-(a.progress||0));
    else items.sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));

    aGrid.innerHTML = items.map(cardAvailable).join("");
    aInfo.textContent=`Pozycji: ${items.length}`;
  }catch(err){ aInfo.textContent="Błąd: "+(err.message||err); }
}
$("#aRefresh").onclick=loadAvailable;
$("#aFilter").addEventListener("input",loadAvailable);
$("#aKind").addEventListener("change",loadAvailable);
$("#aSort").addEventListener("change",loadAvailable);

/* ---------- Search ---------- */
let provider="yts_html";
$("#providerSeg").addEventListener("click",(e)=>{
  const b=e.target.closest("button[data-provider]"); if(!b) return;
  provider=b.dataset.provider;
  $$("#providerSeg button").forEach(x=>x.classList.toggle("active",x===b));
});
$("#sBtn").onclick=doSearch;
$("#sQuery").addEventListener("keydown",e=>{ if(e.key==="Enter") doSearch(); });

async function doSearch(){
  const query=$("#sQuery").value.trim(); if(!query) return;
  const quality=$("#sQuality").value;
  const body={query,provider,type:"movie",page:1,extra:{}};
  $("#sResults").innerHTML="";
  try{
    const j=await api("/search",{method:"POST",body:JSON.stringify(body)});
    const items=j.results||[];
    $("#sResults").innerHTML=items.map(cardSearch).join("");
  }catch(err){ $("#sResults").innerHTML=`<p class="muted">Błąd: ${(err.message||err)}</p>`; }
}
function cardSearch(item){
  const id=btoa((item.url||item.magnet||item.title).slice(0,200)).replace(/=+/g,'');
  const hasMagnet=!!item.magnet;
  const qSel=`<select id="q_${id}">
    <option value="">auto</option>
    <option value="2160p">2160p</option>
    <option value="1080p" selected>1080p</option>
    <option value="720p">720p</option>
  </select>`;
  const resolveBtn=(!hasMagnet&&item.url)?`<button class="btn" onclick="resolveAndQueue('${encodeURIComponent(item.url)}','${item.provider}','${id}')">Resolve & dodaj</button>`:"";
  const addBtn=hasMagnet?`<button class="btn success" onclick="addToQueue('${encodeURIComponent(item.magnet)}','${id}')">Dodaj do kolejki</button>`:"";
  return `<article class="card">
    <img src="${item.image||'assets/placeholder.png'}" class="poster" alt="">
    <div class="body">
      <h3>${item.title||'—'}</h3>
      <div class="muted"><span class="badge">${item.provider||'—'}</span></div>
      <p class="desc">${item.description||''}</p>
      <div class="row">${resolveBtn}${addBtn}<span class="muted">Jakość: ${qSel}</span></div>
    </div></article>`;
}
window.resolveAndQueue=async(encodedUrl,provider,id)=>{
  const url=decodeURIComponent(encodedUrl);
  const quality=($("#q_"+id)?.value)||$("#sQuality").value||"";
  try{
    const j=await api("/search/resolve",{method:"POST",body:JSON.stringify({url,provider,quality})});
    if(!j.magnet){ alert("Nie udało się wyciągnąć magnet linku"); return; }
    await addToQueue(encodeURIComponent(j.magnet),id);
    await refreshQueue();
    showPage("torrents");
  }catch(err){ alert("Resolve error: "+(err.message||err)); }
};
window.addToQueue=async(encMagnet,id)=>{
  const magnet=decodeURIComponent(encMagnet);
  const quality=($("#q_"+id)?.value)||$("#sQuality").value||"";
  try{
    await api("/torrent/add",{method:"POST",body:JSON.stringify({magnet,download_kind:"movie",meta:{quality}})});
    alert("Dodano do kolejki.");
  }catch(err){ alert("Add error: "+(err.message||err)); }
};

/* ---------- Torrents (diff render) ---------- */
const tInfo=$("#tInfo");
const qWrap=$("#tQueue");
const aWrap=$("#tActive");
const PLACEHOLDER="assets/placeholder.png";

$('[data-t-tab="queue"]').onclick=()=>{ qWrap.classList.remove("hidden"); aWrap.classList.add("hidden"); setTTab("queue"); };
$('[data-t-tab="active"]').onclick=()=>{ aWrap.classList.remove("hidden"); qWrap.classList.add("hidden"); setTTab("active"); };
function setTTab(name){ $$('.tabs .tab').forEach(b=>b.classList.toggle('active',b.dataset.tTab===name)); }

let prevQueueMap=new Map();   // id -> data
let prevActiveMap=new Map();  // info_hash -> data

function mkQueueRow(row){
  const canDelete=!row.status||["new","picked","error"].includes(row.status);
  const meta=row.payload?.meta||{};
  const title=row.display_title||meta.display_title||row.payload?.title||"—";
  const img = meta.image_url || row.image_url || PLACEHOLDER;

  const el=document.createElement("div");
  el.className="t-row";
  el.dataset.id=row.id;
  el.innerHTML=`
    <div class="t-poster"><img alt=""></div>
    <div class="t-name"></div>
    <div class="stat data-no"></div>
    <div class="t-ops">
      <button class="btn danger" ${canDelete?"":"disabled"} data-del>Usuń</button>
    </div>`;
  el.querySelector(".t-poster img").src=img;
  el.querySelector(".t-name").textContent=title;
  el.querySelector(".data-no").textContent=`NO: ${row.task_no ?? "—"} · ${row.kind||''} · ${row.status||'new'}`;
  el.querySelector("[data-del]").onclick=()=>deleteTask(row.id);
  return el;
}
function patchQueueRow(el,row){
  const meta=row.payload?.meta||{};
  const title=row.display_title||meta.display_title||row.payload?.title||"—";
  const img=meta.image_url||row.image_url||PLACEHOLDER;
  const canDelete=!row.status||["new","picked","error"].includes(row.status);

  const imgEl=el.querySelector(".t-poster img");
  if(imgEl.src!==new URL(img,location.href).href) imgEl.src=img;
  const nameEl=el.querySelector(".t-name");
  if(nameEl.textContent!==title) nameEl.textContent=title;
  const noEl=el.querySelector(".data-no");
  const txt=`NO: ${row.task_no ?? "—"} · ${row.kind||''} · ${row.status||'new'}`;
  if(noEl.textContent!==txt) noEl.textContent=txt;
  el.querySelector("[data-del]").disabled=!canDelete;
}
async function refreshQueue(){
  try{
    const j=await api("/queue/list?status=all&limit=200",{method:"GET"});
    const items=Array.isArray(j)?j:(j.items||[]);
    const newMap=new Map(items.map(r=>[String(r.id),r]));

    // remove missing
    [...prevQueueMap.keys()].forEach(id=>{ if(!newMap.has(id)){ const el=qWrap.querySelector(`.t-row[data-id="${id}"]`); if(el) el.remove(); }});

    // add / patch
    for(const r of items){
      const id=String(r.id);
      let el=qWrap.querySelector(`.t-row[data-id="${id}"]`);
      if(!el){ el=mkQueueRow(r); qWrap.appendChild(el); }
      else patchQueueRow(el,r);
    }
    prevQueueMap=newMap;
  }catch(err){
    qWrap.innerHTML=`<p class="muted">Błąd: ${(err.message||err)}</p>`;
    prevQueueMap.clear();
  }
}
window.deleteTask=async(id)=>{
  if(!confirm("Usunąć z kolejki?")) return;
  try{ await api(`/queue/${id}`,{method:"DELETE"}); await refreshQueue(); }
  catch(err){ alert(err.message||err); }
};

function mkActiveRow(r){
  const p=Math.round((r.progress||0)*100);
  const el=document.createElement("div");
  el.className="t-row";
  el.dataset.hash=r.info_hash;
  el.innerHTML=`
    <div class="t-poster"><img alt=""></div>
    <div class="t-name"></div>
    <div>
      <div class="progress"><span></span></div>
      <div class="stat data-bytes"></div>
    </div>
    <div class="t-ops">
      <button class="btn" data-pause>Pauza</button>
      <button class="btn success" data-resume>Wznów</button>
      <button class="btn danger" data-rem>Usuń</button>
      <button class="btn danger" data-remd>Usuń + dane</button>
    </div>`;
  el.querySelector(".t-name").textContent=(r.display_title||r.name||"—");
  el.querySelector(".progress span").style.width=p+"%";
  el.querySelector(".data-bytes").textContent=`${p}% (${fmtBytes(r.downloaded_bytes)}/${fmtBytes(r.size_bytes)}) · ${String(r.state||"").toUpperCase()} · DL ${fmtBytes(r.dl_speed)}/s · UL ${fmtBytes(r.ul_speed)}/s`;
  el.querySelector("[data-pause]").onclick=()=>tPause(r.info_hash);
  el.querySelector("[data-resume]").onclick=()=>tResume(r.info_hash);
  el.querySelector("[data-rem]").onclick=()=>tRemove(r.info_hash,false);
  el.querySelector("[data-remd]").onclick=()=>tRemove(r.info_hash,true);
  // poster (jeśli backend kiedyś doda), placeholder na razie
  el.querySelector(".t-poster img").src = r.image_url || PLACEHOLDER;
  return el;
}
function patchActiveRow(el,r){
  const p=Math.round((r.progress||0)*100);
  const name=(r.display_title||r.name||"—");
  const nameEl=el.querySelector(".t-name");
  if(nameEl.textContent!==name) nameEl.textContent=name;
  const bar=el.querySelector(".progress span");
  const want=p+"%"; if(bar.style.width!==want) bar.style.width=want;
  const bytes=`${p}% (${fmtBytes(r.downloaded_bytes)}/${fmtBytes(r.size_bytes)}) · ${String(r.state||"").toUpperCase()} · DL ${fmtBytes(r.dl_speed)}/s · UL ${fmtBytes(r.ul_speed)}/s`;
  const bytesEl=el.querySelector(".data-bytes"); if(bytesEl.textContent!==bytes) bytesEl.textContent=bytes;
}
async function refreshActive(){
  try{
    const j=await api("/torrents/status/list?limit=400&order=desc",{method:"GET"});
    const rows=Array.isArray(j)?j:[];
    const sort=$("#tSort").value||"name";
    rows.sort((a,b)=> sort==="progress" ? (b.progress||0)-(a.progress||0) : sort==="state" ? String(a.state||"").localeCompare(String(b.state||"")) : String(a.display_title||a.name||"").localeCompare(b.display_title||b.name||""));

    const newMap=new Map(rows.map(r=>[String(r.info_hash),r]));

    // remove missing
    [...prevActiveMap.keys()].forEach(h=>{ if(!newMap.has(h)){ const el=aWrap.querySelector(`.t-row[data-hash="${h}"]`); if(el) el.remove(); }});

    // add/patch
    for(const r of rows){
      const h=String(r.info_hash);
      let el=aWrap.querySelector(`.t-row[data-hash="${h}"]`);
      if(!el){ el=mkActiveRow(r); aWrap.appendChild(el); }
      else patchActiveRow(el,r);
    }
    tInfo.textContent=`Aktywnych: ${rows.length}`;
    prevActiveMap=newMap;
  }catch(err){
    aWrap.innerHTML=`<p class="muted">Błąd: ${(err.message||err)}</p>`;
    prevActiveMap.clear();
  }
}
$("#tSort").addEventListener("change",refreshActive);

function fmtBytes(n){ n=Number(n||0); const u=['B','KiB','MiB','GiB','TiB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return `${n.toFixed(n<10?2:1)} ${u[i]}`; }

/* ----- Commands (device aware) ----- */
async function pushCmd(kind, info_hash=null, args={}){
  const dev=getDevice();
  if(!dev){ alert("Ustaw najpierw device_id w Opcjach."); throw new Error("Brak device_id"); }
  await api("/torrents/commands/push",{method:"POST",body:JSON.stringify({device_id:dev,info_hash,kind,args})});
}
window.tPause = async(ih)=>{ await pushCmd("pause",ih); setTimeout(refreshActive,400); };
window.tResume= async(ih)=>{ await pushCmd("resume",ih); setTimeout(refreshActive,400); };
window.tRemove= async(ih,withData)=>{ if(!confirm(withData?"Usunąć torrent + dane?":"Usunąć torrent?")) return; await pushCmd(withData?"remove_data":"remove",ih); setTimeout(refreshActive,600); };

/* ----- Global rate (FIX) ----- */
$("#tApplyRate").onclick = async ()=>{
  const mibs = Number($("#tRate").value||"0");   // dropdown MiB/s
  // backend oczekuje limit_mbs (MiB/s). 0/<=0 = unlimited
  await pushCmd("set_rate_global", null, { limit_mbs: isNaN(mibs)?0:mibs });
  alert("Ustawiono globalny limit: " + (mibs>0 ? `${mibs} MiB/s` : "unlimited"));
};

/* ---------- Startup ---------- */
(function boot(){
  if(!localStorage.getItem(BASE_KEY)) setBase(getBase());
  if(baseInput) baseInput.value=getBase();

  if(getToken()){ afterLogin(); }
  else { auth.classList.remove("hidden"); }
})();
