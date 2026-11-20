(function(){
"use strict";
/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = p => (p||"") + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const clone = o => JSON.parse(JSON.stringify(o));
const todayISO = () => new Date().toISOString().slice(0,10);
const addDays = (iso, n) => { const d = new Date((iso||todayISO())+"T12:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const daysTo = iso => iso ? Math.round((new Date(iso+"T12:00:00") - new Date(todayISO()+"T12:00:00"))/864e5) : null;
const fDate = iso => { if(!iso) return ""; try{ return new Date(iso.length>10?iso:iso+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}); }catch(e){ return iso; } };
const fDT = t => { if(!t) return ""; try{ return new Date(t).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } };
const money = (n, cur) => { const c = cur || (S().currency||"EUR"); try{ return new Intl.NumberFormat("en-GB",{style:"currency",currency:c,maximumFractionDigits:2}).format(+n||0); }catch(e){ return c+" "+(+n||0).toFixed(2); } };
const sum = (a, f) => a.reduce((t,x)=>t+(+f(x)||0),0);
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true,2600); }
function vinOK(v){ return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(v||"").toUpperCase()); }

/* ================= car catalogue (shared with the load planner) ================= */
const CARS = (window.CAR_DB||[]).filter(d => !(d[6]==="Pickup" || (d[6]==="Van" && d[1]>=4.9)));
const CARINFO = {}; (window.CAR_DB||[]).forEach(d => CARINFO[d[0]] = {len:d[1],h:d[2],kg:d[3],body:d[6]});
const MULTI = ["Alfa Romeo","Land Rover","Aston Martin","Mercedes-Benz","Rolls-Royce"];
const brandOf = n => MULTI.find(b => n.indexOf(b+" ")===0) || n.split(" ")[0];
const BRANDS = [...new Set(CARS.map(d => brandOf(d[0])))].sort((a,b)=>a.localeCompare(b));
const shortModel = n => (n||"").replace(/\s*\([^)]*\)\s*$/,"");
function matchModel(txt){
  const t = String(txt||"").toLowerCase().trim(); if(!t) return "";
  const exact = CARS.find(d => d[0].toLowerCase()===t); if(exact) return exact[0];
  const words = t.split(/\s+/);
  const hits = CARS.filter(d => { const n = d[0].toLowerCase(); return words.every(w => n.includes(w)); });
  return hits.length ? hits[hits.length-1][0] : "";
}

/* ================= data store: shared online store when the page has it, else this browser ================= */
const COLS = ["customers","locations","trucks","drivers","orders","trips","handovers","photos","invoices","settings"];
const D = {}; COLS.forEach(c => D[c] = {});
const LKEY = "sbmf-tms-v1";
let db = null, mode = "starting", dbEmpty = true, gotSnap = {};
function S(){ return D.settings.main || {id:"main",company:{name:"Your transport company",address:"",country:"",vat:"",iban:"",email:"",phone:""},invPrefix:"INV-",nextInv:1,vat:21,fuelPct:0,currency:"EUR",terms:30}; }
function list(c){ return Object.values(D[c]); }
function get(c, id){ return D[c][id]; }
function loadLocal(){ try{ const o = JSON.parse(localStorage.getItem(LKEY)||"null"); if(o) COLS.forEach(c => D[c] = o[c]||{}); }catch(e){} }
let localTimer = null;
function saveLocal(){ clearTimeout(localTimer); localTimer = setTimeout(()=>{ try{ localStorage.setItem(LKEY, JSON.stringify(D)); }catch(e){ if(mode==="local") toast("This browser's storage is full: export a backup in Settings"); } }, 300); }
const writeQ = {};
function dbWrite(col, id, body){
  if(!db) return;
  const path = col+"/"+id;
  writeQ[path] = (writeQ[path]||Promise.resolve()).then(()=> body ? db.collection(col).doc(id).set(body) : db.collection(col).doc(id).delete())
    .catch(e => { if(e && e.code==="unavailable") return new Promise(r=>setTimeout(r,800+Math.random()*800)).then(()=> body ? db.collection(col).doc(id).set(body) : db.collection(col).doc(id).delete()).catch(()=>toast("Could not save online, try again"));
      toast(e && e.code==="quota_exceeded" ? "Online storage is full: delete old photos or invoices" : e && e.code==="invalid_argument" ? "You can view this data but not change it" : "Could not save online"); });
}
function put(col, obj, quiet){
  if(!obj.id) obj.id = uid(col[0]);
  obj.upd = Date.now();
  D[col][obj.id] = clone(obj); saveLocal(); dbWrite(col, obj.id, clone(obj));
  if(!quiet) refresh();
  return obj;
}
function del(col, id, quiet){ delete D[col][id]; saveLocal(); dbWrite(col, id, null); if(!quiet) refresh(); }
function setStore(m, txt){ mode = m; const el = $("store"); el.className = "store "+(m==="db"?"on":m==="local"?"local":""); el.lastElementChild.textContent = txt; el.title = m==="db" ? "Saved online with this page: the same data on every device you open it on" : "Saved in this browser only. Export a backup in Settings."; }
function startStore(){
  loadLocal(); setStore("starting","Connecting…");
  let use = null;
  try{ use = window.claude && typeof window.claude.use==="function" ? window.claude.use("db") : null; }catch(e){ use = null; }
  if(!use){ setStore("local","This browser"); refresh(); return; }
  const timer = setTimeout(()=>{ if(mode==="starting") setStore("local","This browser (online store not answering)"); }, 10000);
  Promise.resolve(use).then(x => {
    if(!x){ clearTimeout(timer); setStore("local","This browser"); refresh(); return; }
    db = x; const localCopy = clone(D);
    COLS.forEach(c => D[c] = {});
    COLS.forEach(c => db.collection(c).onSnapshot(snap => {
      const o = {}; snap.docs.forEach(d => { if(d.exists) o[d.id] = clone(d.data()); }); D[c] = o;
      if(!snap.metadata.fromCache){ gotSnap[c] = true; if(snap.size) dbEmpty = false; }
      if(COLS.every(k => gotSnap[k])){ clearTimeout(timer); setStore("db","Saved online"); }
      saveLocal(); schedule();
    }, e => { clearTimeout(timer); db = null; COLS.forEach(k => D[k] = localCopy[k]); setStore("local","This browser"); refresh(); }));
    window.__localCopy = localCopy;
  }).catch(()=>{ clearTimeout(timer); setStore("local","This browser"); refresh(); });
}
let schedT = null; function schedule(){ clearTimeout(schedT); schedT = setTimeout(()=>refresh(false,true), 60); }

/* ================= derived state ================= */
const OSTAT = {wait:["Waiting release","wait"],rel:["Released","rel"],plan:["Planned","plan"],load:["On truck","load"],del:["Delivered","del"],inv:["Invoiced","inv"]};
function oStatus(o){ return o.invoice ? "inv" : o.deliveredAt ? "del" : o.loadedAt ? "load" : o.trip && get("trips",o.trip) ? "plan" : o.released ? "rel" : "wait"; }
const pill = k => `<span class="st ${OSTAT[k][1]}">${OSTAT[k][0]}</span>`;
function tripOrders(t){ return (t.orders||[]).map(id => get("orders",id)).filter(Boolean); }
function tStatus(t){
  const os = tripOrders(t); if(!os.length) return ["Empty","wait"];
  if(os.every(o => o.deliveredAt)) return ["Completed","del"];
  if(os.some(o => o.loadedAt)) return ["On the road","load"];
  return ["Planning","plan"];
}
function tripStops(t){ // delivery locations in the order the driver will drive them
  const os = tripOrders(t), locs = [...new Set(os.map(o => o.to||"?"))];
  const order = (t.stops||[]).filter(l => locs.includes(l)).concat(locs.filter(l => !(t.stops||[]).includes(l)));
  return order;
}
function stopNo(t, o){ return tripStops(t).indexOf(o.to||"?")+1; }
const locName = id => (get("locations",id)||{}).name || "Unknown place";
const custName = id => (get("customers",id)||{}).name || "No customer";
const truckName = id => { const t = get("trucks",id); return t ? t.plate+(t.trailer?" + "+t.trailer:"") : "No truck"; };
const drvName = id => (get("drivers",id)||{}).name || "No driver";
function invTotal(inv){ const net = sum(inv.lines||[], l => (+l.qty||0)*(+l.price||0)); const vat = inv.reverse ? 0 : net*(+inv.vatPct||0)/100; return {net, vat, total:net+vat}; }
function invState(inv){ if(inv.paidAt) return ["Paid","del"]; if(inv.sentAt) return daysTo(inv.due)<0 ? ["Overdue","bad"] : ["Sent","plan"]; return ["Draft","wait"]; }
function expiry(iso){ const d = daysTo(iso); if(d===null) return ""; return d<0 ? `<span class="st bad">Expired ${fDate(iso)}</span>` : d<=30 ? `<span class="st warn">${fDate(iso)} · ${d} d</span>` : `<span class="hint">${fDate(iso)}</span>`; }

/* ================= modal ================= */
let modalClose = null;
function openModal(title, body, footer, onMount, onClose){
  $("dlg").innerHTML = `<header><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></header><div id="mbody">${body}</div>${footer?`<footer>${footer}</footer>`:""}`;
  $("modal").hidden = false; modalClose = onClose||null;
  const f = $("dlg").querySelector("input:not([type=checkbox]),select,textarea"); if(f) setTimeout(()=>f.focus(),30);
  if(onMount) onMount($("dlg"));
}
function closeModal(){ $("modal").hidden = true; $("dlg").innerHTML = ""; if(modalClose){ const f = modalClose; modalClose = null; f(); } }
$("modal").addEventListener("click", e => { if(e.target.id==="modal" || e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("keydown", e => { if(e.key==="Escape" && !$("modal").hidden) closeModal(); });
function formVals(root){ const o = {}; root.querySelectorAll("[name]").forEach(el => o[el.name] = el.type==="checkbox" ? el.checked : el.value.trim()); return o; }
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v)===String(sel??"")?" selected":""}>${esc(label)}</option>`;
const fld = (label, name, val, type, extra) => `<label class="f">${esc(label)}<input name="${name}" type="${type||"text"}" value="${esc(val??"")}" ${extra||""}></label>`;
const sel = (label, name, opts, val) => `<label class="f">${esc(label)}<select name="${name}">${opts.map(o => opt(o[0],o[1],val)).join("")}</select></label>`;
// two-step delete inside the page (no browser confirm dialogs)
function confirmBtn(btn, msg, fn){ if(btn.dataset.armed){ fn(); return; } btn.dataset.armed = "1"; const t = btn.textContent; btn.textContent = msg||"Sure? Tap again"; setTimeout(()=>{ if(btn.isConnected){ btn.textContent = t; delete btn.dataset.armed; } }, 3000); }

/* ================= router, tabs, search ================= */
const VIEWS = [
  ["home","Home"],["orders","Orders"],["trips","Trips"],["planner","Load planner"],["handover","Handover"],
  ["ecmr","eCMR"],["invoices","Invoices"],["finance","Finance"],["fleet","Fleet & drivers"],["customers","Customers & places"],["settings","Settings"]];
const R = {}; // view renderers
let view = "home", param = "";
function parseHash(){ const h = (location.hash||"#home").slice(1); const m = h.match(/^(trip|handover)-([a-z0-9]+)$/i); if(m){ view = m[1]==="trip"?"trip":"handover"; param = m[2]; } else { view = VIEWS.some(v=>v[0]===h) ? h : "home"; param = ""; } }
function go(h){ if(location.hash==="#"+h) refresh(); else location.hash = h; }
window.addEventListener("hashchange", () => { parseHash(); refresh(true); });
function counts(){
  const os = list("orders");
  return {wait:os.filter(o=>oStatus(o)==="wait").length, rel:os.filter(o=>oStatus(o)==="rel").length, inv:os.filter(o=>oStatus(o)==="del").length,
    over:list("invoices").filter(i=>invState(i)[0]==="Overdue").length};
}
function renderTabs(){
  const c = counts(), badge = {orders:c.rel, invoices:c.inv};
  const cur = view==="trip" ? "trips" : view;
  $("tabs").innerHTML = VIEWS.map(([k,l]) => `<a href="#${k}" class="${cur===k?"on":""}"${cur===k?' aria-current="page"':""}>${l}${badge[k]?`<span class="ct">${badge[k]}</span>`:""}</a>`).join("");
}
let lastView = null;
function refresh(scrollTop, fromData){
  if(fromData && view==="handover" && param){ renderTabs(); return; }
  // keep typing focus: if an input inside main is focused, only re-render when the view changes
  renderTabs();
  if(view==="planner" && lastView==="planner" && !scrollTop){ R.plannerBar && R.plannerBar(); return; }
  const a = document.activeElement, keep = a && $("main").contains(a) && a.id ? {id:a.id, s:a.selectionStart} : null;
  const fn = R[view] || R.home; $("main").innerHTML = fn(param) || "";
  if(R["after_"+view]) R["after_"+view](param);
  if(keep){ const el = $(keep.id); if(el){ el.focus(); try{ if(keep.s!=null) el.setSelectionRange(keep.s,keep.s); }catch(e){} } }
  if(scrollTop && lastView!==view+param) window.scrollTo(0,0);
  lastView = view+param; if(view==="planner") lastView = "planner";
}
// global search
$("q").addEventListener("input", () => {
  const q = $("q").value.trim().toLowerCase(), box = $("sres");
  if(q.length<2){ box.hidden = true; return; }
  const res = [];
  list("orders").forEach(o => { if([o.vin,o.ref,o.model,custName(o.customer)].join(" ").toLowerCase().includes(q)) res.push([`order:${o.id}`, `${o.vin||o.ref} · ${shortModel(o.model)||o.modelText||"car"} · ${OSTAT[oStatus(o)][0]}`]); });
  list("trips").forEach(t => { if((t.name+" "+truckName(t.truck)).toLowerCase().includes(q)) res.push([`trip:${t.id}`, `Trip · ${t.name}`]); });
  list("trucks").forEach(t => { if((t.plate+" "+(t.trailer||"")).toLowerCase().includes(q)) res.push([`truck:${t.id}`, `Truck · ${t.plate}`]); });
  list("customers").forEach(c => { if(c.name.toLowerCase().includes(q)) res.push([`cust:${c.id}`, `Customer · ${c.name}`]); });
  list("invoices").forEach(i => { if((i.number+" "+custName(i.customer)).toLowerCase().includes(q)) res.push([`inv:${i.id}`, `Invoice · ${i.number} · ${custName(i.customer)}`]); });
  box.innerHTML = res.slice(0,12).map(r => `<button data-hit="${r[0]}">${esc(r[1])}</button>`).join("") || `<div class="hint" style="padding:10px">Nothing found</div>`;
  box.hidden = false;
});
$("sres").addEventListener("click", e => {
  const b = e.target.closest("[data-hit]"); if(!b) return; const [k,id] = b.dataset.hit.split(":");
  $("sres").hidden = true; $("q").value = "";
  if(k==="order") orderForm(id); else if(k==="trip") go("trip-"+id); else if(k==="truck") truckForm(id); else if(k==="cust") customerForm(id); else if(k==="inv") invoiceForm(id);
});
document.addEventListener("click", e => { if(!e.target.closest(".search")) $("sres").hidden = true; });
$("qOrder").addEventListener("click", () => orderForm());
$("qTrip").addEventListener("click", () => newTrip([]));

/* ================= home ================= */
const ICON = {
  orders:'<path d="M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4"/>',
  trips:'<path d="M3 15V7h11v8 M14 10h4l3 3v2h-7 M6.5 17.5a1.5 1.5 0 1 0 0 .1 M17.5 17.5a1.5 1.5 0 1 0 0 .1"/>',
  planner:'<path d="M3 6h18 M3 12h18 M3 18h18 M8 3v18 M16 3v18"/>',
  handover:'<path d="M4 13l5 5L20 7"/>',
  ecmr:'<path d="M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h3"/>',
  invoices:'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z M9 8h6 M9 12h6"/>',
  fleet:'<path d="M2 16V8h12v8 M14 11h4l3 3v2h-7 M6 18a2 2 0 1 0 0 .1 M17 18a2 2 0 1 0 0 .1 M5 5h7"/>',
  customers:'<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z M12 10a2 2 0 1 0 0 .1"/>',
  finance:'<path d="M4 20V10 M10 20V4 M16 20v-7 M22 20H2"/>',
  settings:'<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1"/>'};
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]||""}</svg>`;
R.home = () => {
  const os = list("orders"), trips = list("trips"), invs = list("invoices");
  const c = counts(), road = trips.filter(t => tStatus(t)[0]==="On the road");
  const unbilled = sum(os.filter(o=>oStatus(o)==="del"), o=>o.price);
  const open = sum(invs.filter(i=>i.sentAt && !i.paidAt), i=>invTotal(i).total);
  const alerts = [];
  os.filter(o => !o.deliveredAt && o.due && daysTo(o.due)<=1).forEach(o => alerts.push([daysTo(o.due)<0?"bad":"", `${esc(o.vin||o.ref)} ${esc(shortModel(o.model))} is ${daysTo(o.due)<0?"late (due "+fDate(o.due)+")":"due "+(daysTo(o.due)===0?"today":"tomorrow")}`, `order:${o.id}`, "Open"]));
  trips.filter(t => tStatus(t)[0]==="Planning" && t.plan && t.plan.cls && t.plan.cls!=="ok").forEach(t => alerts.push(["", `Trip ${esc(t.name)}: load plan says “${esc(t.plan.text)}”`, `trip:${t.id}`, "Check"]));
  trips.filter(t => tStatus(t)[0]==="Planning" && (t.orders||[]).length && t.planSig!==planSig(t)).forEach(t => alerts.push(["", `Trip ${esc(t.name)} has no up-to-date load plan`, `plan:${t.id}`, "Plan load"]));
  list("trucks").forEach(t => { if(t.inspection && daysTo(t.inspection)<=30) alerts.push([daysTo(t.inspection)<0?"bad":"", `Truck ${esc(t.plate)}: inspection ${daysTo(t.inspection)<0?"expired":"due"} ${fDate(t.inspection)}`, `truck:${t.id}`, "Open"]); });
  list("drivers").forEach(d => [["licence","driving licence"],["tacho","tachograph card"],["cpc","CPC"]].forEach(([k,l]) => { if(d[k] && daysTo(d[k])<=30) alerts.push([daysTo(d[k])<0?"bad":"", `${esc(d.name)}: ${l} ${daysTo(d[k])<0?"expired":"expires"} ${fDate(d[k])}`, `driver:${d.id}`, "Open"]); }));
  invs.filter(i => invState(i)[0]==="Overdue").forEach(i => alerts.push(["bad", `Invoice ${esc(i.number)} to ${esc(custName(i.customer))} is overdue (${money(invTotal(i).total)})`, `inv:${i.id}`, "Open"]));
  const h = new Date().getHours(), hi = h<12?"Good morning":h<18?"Good afternoon":"Good evening";
  const empty = !os.length && !trips.length;
  return `
  <section class="cover">
    <div><h1>${hi}${S().company.name && S().company.name!=="Your transport company" ? ", "+esc(S().company.name) : ""}</h1>
      <p>${new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} · ${road.length} truck${road.length===1?"":"s"} on the road · ${os.filter(o=>o.deliveredAt && new Date(o.deliveredAt).toISOString().slice(0,10)===todayISO()).length} cars delivered today</p></div>
    <div class="kpis">
      <button class="kpi ${c.wait?"pk":""}" data-go="orders:wait"><b>${c.wait}</b><span>Waiting for release</span></button>
      <button class="kpi" data-go="orders:rel"><b>${c.rel}</b><span>Ready to plan</span></button>
      <button class="kpi" data-go="orders:load"><b>${os.filter(o=>oStatus(o)==="load").length}</b><span>Cars on trucks</span></button>
      <button class="kpi" data-go="invoices"><b>${money(unbilled).replace(/\.00$/,"")}</b><span>Delivered, not invoiced</span></button>
      ${(()=>{ const mt = list("trips").filter(t=>t.date && t.date.slice(0,7)===todayISO().slice(0,7) && +t.km && tripOrders(t).length).map(tripMoney); const mg = sum(mt,x=>x.margin), rv = sum(mt,x=>x.rev);
        return `<button class="kpi ${mg<0?"pk":""}" data-go="finance"><b>${money(mg).replace(/\.00$/,"")}</b><span>Margin this month${rv?" · "+(mg/rv*100).toFixed(0)+"%":""}</span></button>`; })()}
      <button class="kpi ${c.over?"pk":""}" data-go="invoices"><b>${money(open).replace(/\.00$/,"")}</b><span>Unpaid${c.over?` · ${c.over} overdue`:""}</span></button>
    </div>
  </section>
  ${empty ? `<div class="note pk" style="margin-top:16px">No data yet. Start with your own customers and orders, or <button class="btn sm dark" data-act="demo">Load demo data</button> to try every module.</div>` : ""}
  ${mode==="db" && dbEmpty && window.__localCopy && Object.keys(window.__localCopy.orders||{}).length ? `<div class="note pk" style="margin-top:16px">This browser has ${Object.keys(window.__localCopy.orders).length} orders that are not in the online store yet. <button class="btn sm dark" data-act="push">Copy them online</button></div>`:""}
  <div class="two sec">
    <div><h2>Needs attention</h2>${alerts.length ? `<ul class="alerts">${alerts.slice(0,12).map(a=>`<li class="${a[0]}"><span>${a[1]}</span><button class="btn sm" data-hit="${a[2]}">${a[3]}</button></li>`).join("")}</ul>` : `<div class="empty">Nothing waiting on you.</div>`}</div>
    <div><h2>Trips today and on the road</h2>${tripCards(trips.filter(t => t.date===todayISO() || tStatus(t)[0]==="On the road").slice(0,4), true) || `<div class="empty">No trips today. <a href="#trips">See all trips</a></div>`}</div>
  </div>
  <section class="sec"><h2>Modules</h2><div class="tiles">
    ${[["orders","Orders","Every car by VIN, from release to invoice"],["trips","Trips","Group cars on a truck, set stops and driver"],["planner","Load planner","Which car goes where on the truck"],["handover","Handover","Photos, damage and signature at pickup and delivery"],["ecmr","eCMR","Consignment notes made from the handovers"],["invoices","Invoices","Bill delivered cars with proof attached"],["finance","Finance","Per-km prices, fuel surcharge, costs and margin"],["fleet","Fleet & drivers","Trucks, trailers, documents and expiry dates"],["customers","Customers & places","Customers, prices, compounds and dealers"],["settings","Settings","Company details, backup and demo data"]]
      .map(t => `<a class="tile" href="#${t[0]}">${icon(t[0])}<div><b>${t[1]}</b><span>${t[2]}</span></div></a>`).join("")}
  </div></section>`;
};
R.after_home = () => {
  $("main").querySelectorAll("[data-go]").forEach(b => b.onclick = () => { const [v,f] = b.dataset.go.split(":"); if(f) orderFilter.st = f; go(v); });
  $("main").querySelectorAll("[data-hit]").forEach(b => b.onclick = () => hit(b.dataset.hit));
  const d = $("main").querySelector('[data-act="demo"]'); if(d) d.onclick = loadDemo;
  const p = $("main").querySelector('[data-act="push"]'); if(p) p.onclick = pushLocal;
  bindTripCards();
};
function hit(s){ const [k,id] = s.split(":"); if(k==="order") orderForm(id); else if(k==="trip") go("trip-"+id); else if(k==="plan") openPlanner(id); else if(k==="truck") truckForm(id); else if(k==="driver") driverForm(id); else if(k==="inv") invoiceForm(id); }
function pushLocal(){ const lc = window.__localCopy; if(!lc) return; COLS.forEach(c => Object.values(lc[c]||{}).forEach(o => put(c, o, true))); dbEmpty = false; refresh(); toast("Copied online"); }

/* ================= orders ================= */
const orderFilter = {st:"all", q:"", cust:"", sel:new Set()};
R.orders = () => {
  const os = list("orders").sort((a,b) => (b.created||0)-(a.created||0));
  const cnt = k => os.filter(o => oStatus(o)===k).length;
  const q = orderFilter.q.toLowerCase();
  const rows = os.filter(o => (orderFilter.st==="all" || oStatus(o)===orderFilter.st) && (!orderFilter.cust || o.customer===orderFilter.cust) &&
    (!q || [o.vin,o.ref,o.model,o.modelText,locName(o.from),locName(o.to),custName(o.customer)].join(" ").toLowerCase().includes(q)));
  orderFilter.sel.forEach(id => { if(!get("orders",id)) orderFilter.sel.delete(id); });
  const nSel = orderFilter.sel.size;
  return `<div class="head"><div><h1>Orders</h1><p>One line per car. ${os.length} orders, ${cnt("rel")} ready to plan.</p></div>
    <div class="tools" style="margin:0"><button class="btn" data-act="import">Import list</button><button class="btn pri" data-act="new">+ New order</button></div></div>
  <div class="tools">
    <div class="chips">${[["all","All",os.length]].concat(Object.keys(OSTAT).map(k=>[k,OSTAT[k][0],cnt(k)])).map(c=>`<button class="fchip ${orderFilter.st===c[0]?"on":""}" data-st="${c[0]}">${c[1]} · ${c[2]}</button>`).join("")}</div>
  </div>
  <div class="tools">
    <input class="inp" id="oq" style="max-width:300px" placeholder="Filter by VIN, model, place…" value="${esc(orderFilter.q)}">
    <select class="inp" id="ocust" style="max-width:240px">${opt("","All customers",orderFilter.cust)}${list("customers").map(c=>opt(c.id,c.name,orderFilter.cust)).join("")}</select>
    ${nSel ? `<span class="hint">${nSel} selected</span><button class="btn sm" data-act="release">Mark released</button><button class="btn sm pri" data-act="totrip">Put on a new trip</button><button class="btn sm" data-act="unsel">Clear selection</button>` : `<span class="hint">Tick orders to release them or put them on a trip</span>`}
  </div>
  ${rows.length ? `<div class="tw"><table class="stack"><thead><tr><th><input type="checkbox" id="oall" aria-label="Select all shown"></th><th>VIN</th><th>Car</th><th>Customer</th><th>From → to</th><th>Ready</th><th>Due</th><th class="num">Price</th><th>Status</th></tr></thead><tbody>
    ${rows.map(o => { const st = oStatus(o), late = !o.deliveredAt && o.due && daysTo(o.due)<0;
      return `<tr class="click" data-o="${o.id}"><td><input type="checkbox" data-sel="${o.id}" ${orderFilter.sel.has(o.id)?"checked":""} aria-label="Select ${esc(o.vin)}"></td>
      <td class="vin">${esc(o.vin||"–")}${o.vin && !vinOK(o.vin)?' <span class="st warn">check</span>':""}</td>
      <td>${esc(shortModel(o.model)||o.modelText||"–")}${o.model?"":' <span class="st warn">unknown model</span>'}${o.nonRunner?' <span class="tag">non-runner</span>':""}</td>
      <td>${esc(custName(o.customer))}</td><td>${esc(locName(o.from))} → ${esc(locName(o.to))}</td>
      <td class="nowrap">${fDate(o.ready)}</td><td class="nowrap">${late?`<span class="st bad">${fDate(o.due)}</span>`:fDate(o.due)}</td>
      <td class="num">${money(o.price)}</td><td>${pill(st)}${st==="plan"||st==="load"?` <a href="#trip-${o.trip}" class="hint">${esc((get("trips",o.trip)||{}).name||"")}</a>`:""}</td></tr>`; }).join("")}
  </tbody></table></div>` : `<div class="empty">${os.length ? "No orders match this filter." : "No orders yet. Add one, import a list, or load demo data in Settings."}</div>`}`;
};
R.after_orders = () => {
  const m = $("main");
  m.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { orderFilter.st = b.dataset.st; refresh(); });
  $("oq").oninput = e => { orderFilter.q = e.target.value; refresh(); };
  $("ocust").onchange = e => { orderFilter.cust = e.target.value; refresh(); };
  m.querySelectorAll("[data-sel]").forEach(c => c.onclick = e => { e.stopPropagation(); c.checked ? orderFilter.sel.add(c.dataset.sel) : orderFilter.sel.delete(c.dataset.sel); refresh(); });
  const all = $("oall"); if(all) all.onclick = () => { m.querySelectorAll("[data-sel]").forEach(c => all.checked ? orderFilter.sel.add(c.dataset.sel) : orderFilter.sel.delete(c.dataset.sel)); refresh(); };
  m.querySelectorAll("tr[data-o]").forEach(r => r.onclick = e => { if(!e.target.closest("input,a")) orderForm(r.dataset.o); });
  const act = {new:()=>orderForm(), import:importOrders, unsel:()=>{ orderFilter.sel.clear(); refresh(); },
    release:()=>{ orderFilter.sel.forEach(id => { const o = get("orders",id); if(o && !o.released){ o.released = true; o.releasedAt = Date.now(); put("orders",o,true); } }); refresh(); toast("Marked released"); },
    totrip:()=>{ const ids = [...orderFilter.sel].filter(id => { const o = get("orders",id); return o && !o.loadedAt && !(o.trip && get("trips",o.trip)); });
      if(!ids.length){ toast("These cars are already on a trip"); return; } orderFilter.sel.clear(); newTrip(ids); }};
  m.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act[b.dataset.act] && act[b.dataset.act]());
};
function modelPicker(model){
  const b = model ? brandOf(model) : "";
  return `<label class="f">Brand<select name="brand" id="fbrand">${opt("","Pick a brand…",b)}${BRANDS.map(x=>opt(x,x,b)).join("")}</select></label>
    <label class="f">Model<select name="model" id="fmodel">${modelOpts(b, model)}</select></label>`;
}
function modelOpts(b, model){ if(!b) return opt("","Pick a brand first",""); return opt("","Model…",model)+CARS.filter(d=>brandOf(d[0])===b).map(d=>d[0]).sort().map(n=>opt(n,n.slice(b.length+1),model)).join(""); }
function bindModelPicker(root){ const b = root.querySelector("#fbrand"); if(b) b.onchange = () => { root.querySelector("#fmodel").innerHTML = modelOpts(b.value,""); }; }
function locOpts(){ return [["","Pick a place…"]].concat(list("locations").sort((a,b)=>a.name.localeCompare(b.name)).map(l=>[l.id,l.name+(l.country?" ("+l.country+")":"")])).concat([["__new","+ New place…"]]); }
function orderForm(id){
  const o = id ? clone(get("orders",id)) : {released:false, ready:todayISO(), due:addDays(todayISO(),5), customer:(list("customers")[0]||{}).id||""};
  if(id && !get("orders",id)) return;
  const st = id ? oStatus(o) : null, info = CARINFO[o.model];
  const tl = id ? [["Created",o.created],["Released",o.releasedAt],["Picked up",o.loadedAt],["Delivered",o.deliveredAt]].filter(x=>x[1]).map(x=>`${x[0]} ${fDT(x[1])}`).join(" · ") : "";
  openModal(id ? `Order ${o.vin||o.ref||""}` : "New order", `
    ${id ? `<p style="margin-top:-6px">${pill(st)} <span class="hint">${tl}</span>${o.trip&&get("trips",o.trip)?` · <a href="#trip-${o.trip}" data-close>Trip ${esc(get("trips",o.trip).name)}</a>`:""}${o.invoice&&get("invoices",o.invoice)?` · Invoice ${esc(get("invoices",o.invoice).number)}`:""}</p>`:""}
    <form id="of" class="grid2" autocomplete="off">
      <label class="f">VIN (17 characters)<input name="vin" value="${esc(o.vin||"")}" maxlength="17" style="text-transform:uppercase;letter-spacing:.04em" placeholder="e.g. WVWZZZCDZMW012345"><span class="hint" id="vinmsg"></span></label>
      ${fld("Customer reference","ref",o.ref)}
      ${modelPicker(o.model)}
      ${o.modelText && !o.model ? `<p class="note pk span2">Imported as “${esc(o.modelText)}”: pick the matching model so the load planner knows its size.</p>`:""}
      <p class="hint span2" id="carinfo">${info?`Length ${info.len} m · height ${info.h} m · ${info.kg} kg (approximate database specs)`:""}</p>
      ${sel("Customer","customer",[["","No customer"]].concat(list("customers").map(c=>[c.id,c.name])),o.customer)}
      <label class="f">Price for this car (${S().currency||"EUR"})<input name="price" type="number" step="0.01" min="0" value="${esc(o.price??"")}"><span class="hint" id="pricehow"></span></label>
      ${sel("Pick up at","from",locOpts(),o.from)}
      ${sel("Deliver to","to",locOpts(),o.to)}
      ${fld("Distance pickup → delivery (km)","km",o.km||dist(o.from,o.to)||"","number",'min="0" step="1"')}
      <p class="hint" style="align-self:end;margin:0 0 10px">Used for per-km prices. Saved for the next car on this lane.</p>
      ${fld("Ready from","ready",o.ready,"date")}
      ${fld("Deliver by","due",o.due,"date")}
      ${fld("Car value for insurance ("+(S().currency||"EUR")+", optional)","value",o.value,"number",'step="100" min="0"')}
      <div><label class="chk"><input type="checkbox" name="released" ${o.released?"checked":""}> Released for pickup</label>
      <label class="chk"><input type="checkbox" name="nonRunner" ${o.nonRunner?"checked":""}> Non-runner (needs winching)</label></div>
      <label class="f span2">Notes for the driver<textarea name="notes">${esc(o.notes||"")}</textarea></label>
    </form>`,
    `${id && !o.loadedAt && !o.invoice ? `<button class="btn danger left" id="odel">Delete order</button>`:""}<button class="btn" data-close>Cancel</button><button class="btn pri" id="osave">${id?"Save":"Add order"}</button>`,
    root => {
      bindModelPicker(root);
      const f = root.querySelector("#of");
      const vchk = () => { const v = f.vin.value.toUpperCase(); $("vinmsg").textContent = !v ? "" : vinOK(v) ? "✓ Looks like a valid VIN" : v.length!==17 ? `${v.length} of 17 characters` : "VINs never use I, O or Q: check it"; };
      f.vin.oninput = vchk; vchk();
      f.model.onchange = () => { const i = CARINFO[f.model.value]; $("carinfo").textContent = i?`Length ${i.len} m · height ${i.h} m · ${i.kg} kg (approximate database specs)`:""; };
      let manual = !!(id && o.price && (()=>{ const p = priceFor(o); return !p || p.price!==+o.price; })());
      const reprice = () => { const p = priceFor({customer:f.customer.value, from:f.from.value, to:f.to.value, km:+f.km.value});
        $("pricehow").textContent = manual ? (p && p.price!=null ? `Agreement says ${money(p.price)} (${p.how}). ` : "") + "Set by hand." : p ? p.how : "No price agreement for this customer";
        if(!manual && p && p.price!=null) f.price.value = p.price; };
      f.price.oninput = () => { manual = f.price.value!==""; reprice(); };
      f.customer.onchange = reprice; f.km.oninput = reprice;
      ["from","to"].forEach(k => f[k].onchange = () => { if(f[k].value==="__new"){ f[k].value = ""; locationForm(null, l => { f[k].innerHTML = locOpts().map(x=>opt(x[0],x[1],l.id)).join(""); }); return; } const d = dist(f.from.value, f.to.value); if(d!=null) f.km.value = d; reprice(); });
      reprice();
      $("osave").onclick = () => {
        const v = formVals(f); delete v.brand;
        if(!v.vin && !v.ref){ toast("Add a VIN or a reference"); return; }
        Object.assign(o, v, {vin:v.vin.toUpperCase(), price:+v.price||0, value:+v.value||0, km:+v.km||0});
        if(o.km && o.from && o.to && dist(o.from,o.to)==null) setDist(o.from, o.to, o.km);
        if(v.model) delete o.modelText;
        if(o.released && !o.releasedAt) o.releasedAt = Date.now();
        if(!o.created) o.created = Date.now();
        put("orders",o); closeModal(); toast(id?"Order saved":"Order added");
      };
      const d = $("odel"); if(d) d.onclick = () => confirmBtn(d, "Sure? Tap again", () => { const t = o.trip && get("trips",o.trip); if(t){ t.orders = t.orders.filter(x=>x!==o.id); put("trips",t,true); } del("orders",o.id); closeModal(); toast("Order deleted"); });
    });
}
function importOrders(){
  openModal("Import orders", `
    <p>Paste one car per line, columns separated by a semicolon, tab or comma (copy straight from Excel works):</p>
    <p class="note"><b>VIN ; Model ; Customer ; Pick up at ; Deliver to ; Ready date ; Deliver by ; Price</b><br><span class="hint">Example: WVWZZZCDZMW012345 ; VW Golf Mk8 ; Autohaus Weber ; Zeebrugge port ; Autohaus Weber München ; 2026-11-20 ; 2026-11-24 ; 185</span></p>
    <label class="f">Your list<textarea id="imp" style="min-height:180px;font-size:14px"></textarea></label>
    <label class="chk"><input type="checkbox" id="imprel" checked> Mark them released</label>
    <p class="hint" id="impmsg">Unknown customers and places are created for you. Models are matched to the car database; anything not matched is flagged so you can pick it.</p>`,
    `<button class="btn" data-close>Cancel</button><button class="btn pri" id="impgo">Import</button>`,
    () => {
      const parse = () => $("imp").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/\t|;|,(?=\s*\S)/).map(x => x.trim())).filter(r => r.length>=2 && !/^vin$/i.test(r[0]));
      $("imp").oninput = () => { const r = parse(); $("impmsg").textContent = r.length ? `${r.length} cars found, ${r.filter(x=>matchModel(x[1])).length} with a known model.` : "Nothing found yet."; };
      $("impgo").onclick = () => {
        const rows = parse(); if(!rows.length){ toast("Nothing to import"); return; }
        const byName = (col, name, extra) => { if(!name) return ""; const f = list(col).find(x => x.name.toLowerCase()===name.toLowerCase()); return f ? f.id : put(col, Object.assign({name}, extra||{}), true).id; };
        rows.forEach(r => { const m = matchModel(r[1]);
          const cust = byName("customers", r[2], {terms:S().terms||30});
          put("orders", {vin:(r[0]||"").toUpperCase(), model:m, modelText:m?undefined:r[1], customer:cust, from:byName("locations",r[3],{type:"Compound"}), to:byName("locations",r[4],{type:"Dealer"}),
            ready:/^\d{4}-\d\d-\d\d$/.test(r[5]||"")?r[5]:todayISO(), due:/^\d{4}-\d\d-\d\d$/.test(r[6]||"")?r[6]:addDays(todayISO(),5),
            price:0, priceIn:parseFloat(String(r[7]||"").replace(",", ".")), released:$("imprel").checked, releasedAt:$("imprel").checked?Date.now():null, created:Date.now()}, true); });
        list("orders").filter(o => "priceIn" in o).forEach(o => { const p = priceFor(o); o.price = o.priceIn || (p && p.price) || 0; delete o.priceIn; put("orders",o,true); });
        closeModal(); refresh(); toast(`${rows.length} orders imported`);
      };
    });
}

/* ================= customers & places ================= */
R.customers = () => {
  const cs = list("customers").sort((a,b)=>a.name.localeCompare(b.name)), ls = list("locations").sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="head"><div><h1>Customers & places</h1><p>Who pays, and the ports, compounds and dealers you drive between.</p></div></div>
  <section><div class="tools"><h2 style="margin-right:auto">Customers</h2><button class="btn pri" data-act="nc">+ Customer</button></div>
  ${cs.length ? `<div class="tw"><table class="stack"><thead><tr><th>Name</th><th>Country</th><th>VAT number</th><th>Pricing</th><th class="num">Payment terms</th><th class="num">Open orders</th></tr></thead><tbody>
  ${cs.map(c=>`<tr class="click" data-c="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.country||"")}</td><td>${esc(c.vat||"")}</td><td>${esc(priceDesc(c))}${(c.lanes||[]).length?` <span class="hint">+ ${c.lanes.length} lane price${c.lanes.length>1?"s":""}</span>`:""}${c.fuelClause===false?' <span class="tag">no fuel clause</span>':""}</td><td class="num">${c.terms||S().terms||30} days</td><td class="num">${list("orders").filter(o=>o.customer===c.id && !o.invoice).length}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">No customers yet.</div>`}</section>
  <section class="sec"><div class="tools"><h2 style="margin-right:auto">Places</h2><button class="btn pri" data-act="nl">+ Place</button></div>
  ${ls.length ? `<div class="tw"><table class="stack"><thead><tr><th>Name</th><th>Type</th><th>Address</th><th>Country</th><th>Opening hours</th></tr></thead><tbody>
  ${ls.map(l=>`<tr class="click" data-l="${l.id}"><td><b>${esc(l.name)}</b></td><td>${esc(l.type||"")}</td><td>${esc(l.address||"")}</td><td>${esc(l.country||"")}</td><td>${esc(l.hours||"")}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">No places yet.</div>`}</section>`;
};
R.after_customers = () => {
  const m = $("main");
  m.querySelector('[data-act="nc"]').onclick = () => customerForm();
  m.querySelector('[data-act="nl"]').onclick = () => locationForm();
  m.querySelectorAll("[data-c]").forEach(r => r.onclick = () => customerForm(r.dataset.c));
  m.querySelectorAll("[data-l]").forEach(r => r.onclick = () => locationForm(r.dataset.l));
};
function simpleForm(title, col, id, fieldsHtml, defaults, after){
  const o = id ? clone(get(col,id)) : Object.assign({}, defaults||{});
  openModal(title, `<form id="sf" class="grid2" autocomplete="off">${fieldsHtml(o)}</form>`,
    `${id?`<button class="btn danger left" id="sdel">Delete</button>`:""}<button class="btn" data-close>Cancel</button><button class="btn pri" id="ssave">Save</button>`,
    root => {
      $("ssave").onclick = () => { const v = formVals(root.querySelector("#sf")); if(!v.name && !v.plate){ toast("Give it a name"); return; } Object.assign(o, v); ["rate","terms","insurance","lPer100","fixedMonth"].forEach(k => { if(k in v) o[k] = +v[k]||0; }); const saved = put(col, o); closeModal(); toast("Saved"); if(after) after(saved); };
      const d = $("sdel"); if(d) d.onclick = () => confirmBtn(d, "Sure? Tap again", () => { del(col, id); closeModal(); toast("Deleted"); });
    });
}
function customerForm(id){
  const c = id ? clone(get("customers",id)) : {terms:S().terms||30, priceMode:"car", fuelClause:true, lanes:[]};
  if(id && !c) return; c.lanes = c.lanes||[];
  const cur = S().currency||"EUR", lo = locOpts().filter(x=>x[0]!=="__new");
  const lanesHtml = () => c.lanes.map((l,i) => `<tr><td><select class="inp" data-ln="${i}|from">${lo.map(x=>opt(x[0],x[1],l.from)).join("")}</select></td><td><select class="inp" data-ln="${i}|to">${lo.map(x=>opt(x[0],x[1],l.to)).join("")}</select></td><td style="width:120px"><input class="inp" type="number" step="0.01" min="0" data-ln="${i}|price" value="${esc(l.price??"")}"></td><td><button class="btn sm" type="button" data-rmln="${i}" aria-label="Remove lane">×</button></td></tr>`).join("") || `<tr><td colspan="4" class="hint">No lane prices. Add one for lanes you price separately.</td></tr>`;
  openModal(id?"Customer":"New customer", `<form id="sf" class="grid2" autocomplete="off">
    ${fld("Company name","name",c.name)}${fld("Country","country",c.country)}
    <label class="f span2">Address<textarea name="address" style="min-height:60px">${esc(c.address||"")}</textarea></label>
    ${fld("VAT number","vat",c.vat)}${fld("Invoice email","email",c.email,"email")}
    ${fld("Payment terms (days)","terms",c.terms??S().terms??30,"number",'min="0" step="1"')}
    <label class="chk" style="align-self:end"><input type="checkbox" name="fuelClause" ${c.fuelClause!==false?"checked":""}> Fuel surcharge applies (fuel clause)</label>
    <h3 class="span2" style="margin-top:8px">Price agreement</h3>
    ${sel("How you price this customer","priceMode",[["car","Fixed price per car"],["km","Price per km, per car"]],c.priceMode||"car")}
    <div id="pm-car">${fld("Price per car ("+cur+")","rate",c.rate,"number",'step="0.01" min="0"')}</div>
    <div id="pm-km" class="grid2 span2" style="gap:12px">${fld("Price per km per car ("+cur+")","rateKm",c.rateKm,"number",'step="0.001" min="0"')}${fld("Minimum price per car ("+cur+")","minPrice",c.minPrice,"number",'step="1" min="0"')}</div>
    <div class="span2"><p class="hint" style="margin:0 0 6px">Lane prices override the above for one pickup → delivery pair.</p>
      <div class="tw"><table><thead><tr><th>From</th><th>To</th><th>Price per car</th><th></th></tr></thead><tbody id="lanes">${lanesHtml()}</tbody></table></div>
      <button class="btn sm" type="button" id="addln" style="margin-top:6px">+ Lane price</button></div>
  </form>`,
  `${id?`<button class="btn danger left" id="sdel">Delete</button>`:""}<button class="btn" data-close>Cancel</button><button class="btn pri" id="ssave">Save</button>`,
  root => {
    const f = root.querySelector("#sf");
    const mode = () => { const km = f.priceMode.value==="km"; $("pm-car").hidden = km; $("pm-km").style.display = km ? "" : "none"; };
    f.priceMode.onchange = mode; mode();
    const bindLanes = () => { $("lanes").innerHTML = lanesHtml();
      $("lanes").querySelectorAll("[data-ln]").forEach(el => el.oninput = el.onchange = () => { const [i,k] = el.dataset.ln.split("|"); c.lanes[i][k] = k==="price" ? el.value : el.value; });
      $("lanes").querySelectorAll("[data-rmln]").forEach(b => b.onclick = () => { c.lanes.splice(+b.dataset.rmln,1); bindLanes(); }); };
    bindLanes();
    $("addln").onclick = () => { if(!lo.length){ toast("Add places first"); return; } c.lanes.push({from:lo[0][0], to:(lo[1]||lo[0])[0], price:""}); bindLanes(); };
    $("ssave").onclick = () => { const v = formVals(f); if(!v.name){ toast("Give it a name"); return; }
      Object.assign(c, v, {terms:+v.terms||0, rate:+v.rate||0, rateKm:+v.rateKm||0, minPrice:+v.minPrice||0, lanes:c.lanes.filter(l=>l.from && l.to && +l.price>0).map(l=>({from:l.from,to:l.to,price:+l.price}))});
      put("customers", c); closeModal(); toast("Saved"); };
    const d = $("sdel"); if(d) d.onclick = () => confirmBtn(d, "Sure? Tap again", () => { del("customers", id); closeModal(); toast("Deleted"); });
  });
}
const priceDesc = c => c.priceMode==="km" ? `${money(c.rateKm)}/km${c.minPrice?" · min "+money(c.minPrice):""}` : c.rate ? money(c.rate)+" per car" : "";
function locationForm(id, after){ simpleForm(id?"Place":"New place","locations",id, l => `
  ${fld("Name","name",l.name)}${sel("Type","type",["Port","Compound","Factory","Dealer","Private address","Other"].map(x=>[x,x]),l.type||"Dealer")}
  <label class="f span2">Address<textarea name="address" style="min-height:60px">${esc(l.address||"")}</textarea></label>
  ${fld("Country","country",l.country)}${fld("Opening hours","hours",l.hours,"text",'placeholder="e.g. Mon–Fri 07:00–17:00, key box after hours"')}
  ${fld("Contact person / phone","contact",l.contact)}`, {type:"Dealer"}, after); }

/* ================= fleet & drivers ================= */
const PROFILES = [["eurolohr200-low","Lohr Eurolohr 200 · low cab"],["eurolohr200-high","Lohr Eurolohr 200 · high cab"]];
R.fleet = () => {
  const ts = list("trucks").sort((a,b)=>a.plate.localeCompare(b.plate)), ds = list("drivers").sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="head"><div><h1>Fleet & drivers</h1><p>The truck type decides which load-planner layout a trip uses.</p></div></div>
  <section><div class="tools"><h2 style="margin-right:auto">Trucks</h2><button class="btn pri" data-act="nt">+ Truck</button></div>
  ${ts.length ? `<div class="tw"><table class="stack"><thead><tr><th>Truck</th><th>Trailer</th><th>Build</th><th>Load planner layout</th><th>Inspection due</th><th class="num">Cargo insurance</th></tr></thead><tbody>
  ${ts.map(t=>`<tr class="click" data-t="${t.id}"><td><b>${esc(t.plate)}</b></td><td>${esc(t.trailer||"")}</td><td>${esc([t.builder,t.model,t.cab?t.cab+" cab":""].filter(Boolean).join(" · "))}</td><td>${esc((PROFILES.find(p=>p[0]===t.profile)||[,"Eurolohr 200 low cab (closest available)"])[1])}</td><td>${expiry(t.inspection)}</td><td class="num">${t.insurance?money(t.insurance):""}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">No trucks yet.</div>`}</section>
  <section class="sec"><div class="tools"><h2 style="margin-right:auto">Drivers</h2><button class="btn pri" data-act="nd">+ Driver</button></div>
  ${ds.length ? `<div class="tw"><table class="stack"><thead><tr><th>Name</th><th>Phone</th><th>Languages</th><th>Driving licence</th><th>Tachograph card</th><th>CPC</th></tr></thead><tbody>
  ${ds.map(d=>`<tr class="click" data-d="${d.id}"><td><b>${esc(d.name)}</b></td><td>${esc(d.phone||"")}</td><td>${esc(d.langs||"")}</td><td>${expiry(d.licence)}</td><td>${expiry(d.tacho)}</td><td>${expiry(d.cpc)}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">No drivers yet.</div>`}</section>`;
};
R.after_fleet = () => {
  const m = $("main");
  m.querySelector('[data-act="nt"]').onclick = () => truckForm();
  m.querySelector('[data-act="nd"]').onclick = () => driverForm();
  m.querySelectorAll("[data-t]").forEach(r => r.onclick = () => truckForm(r.dataset.t));
  m.querySelectorAll("[data-d]").forEach(r => r.onclick = () => driverForm(r.dataset.d));
};
function truckForm(id){ simpleForm(id?"Truck":"New truck","trucks",id, t => `
  ${fld("Truck plate","plate",t.plate)}${fld("Trailer plate","trailer",t.trailer)}
  ${sel("Builder","builder",["Lohr","Kässbohrer","Rolfo","Other"].map(x=>[x,x]),t.builder||"Lohr")}${fld("Model","model",t.model,"text",'placeholder="e.g. Eurolohr 200"')}
  ${sel("Cab","cab",[["low","Low cab"],["high","High cab"]],t.cab||"low")}${sel("Load planner layout","profile",PROFILES,t.profile||"eurolohr200-low")}
  <p class="hint span2">The planner has Lohr Eurolohr 200 layouts so far. For a Kässbohrer or Rolfo, the closest Lohr layout is used until its own is added.</p>
  ${fld("Next inspection","inspection",t.inspection,"date")}${fld("Cargo insurance limit ("+(S().currency||"EUR")+")","insurance",t.insurance,"number",'step="1000" min="0"')}
  ${fld("Fuel use L/100 km (empty = default in Finance)","lPer100",t.lPer100||"","number",'step="0.5" min="0"')}${fld("Fixed costs per month (empty = default)","fixedMonth",t.fixedMonth||"","number",'step="50" min="0"')}`, {builder:"Lohr",model:"Eurolohr 200",cab:"low",profile:"eurolohr200-low"}); }
function driverForm(id){ simpleForm(id?"Driver":"New driver","drivers",id, d => `
  ${fld("Name","name",d.name)}${fld("Phone","phone",d.phone,"tel")}
  ${fld("Languages","langs",d.langs,"text",'placeholder="e.g. PL, EN, DE"')}${fld("Driving licence (CE) expires","licence",d.licence,"date")}
  ${fld("Tachograph card expires","tacho",d.tacho,"date")}${fld("CPC (Code 95) expires","cpc",d.cpc,"date")}`); }

/* ================= trips ================= */
const POSROWS = [["T1","T2","T3"],["R1","R2","R3"],["R4","R5","R6"]];
function planSig(t){ return JSON.stringify([tripOrders(t).map(o => [o.id,o.model,stopNo(t,o)]), (get("trucks",t.truck)||{}).profile||"", t.route||"base"]); }
function tripCards(trips, compact){
  if(!trips.length) return "";
  return `<div class="cards">${trips.map(t => { const os = tripOrders(t), s = tStatus(t), stops = tripStops(t);
    return `<button class="card" data-trip="${t.id}" style="text-align:left;cursor:pointer;display:block;width:100%">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3>${esc(t.name)}</h3><span class="st ${s[1]}">${s[0]}</span></div>
      <p class="hint" style="margin:4px 0 8px">${fDate(t.date)} · ${esc(truckName(t.truck))} · ${esc(drvName(t.driver))}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>${os.length} car${os.length===1?"":"s"}</b><span class="hint">${stops.length} stop${stops.length===1?"":"s"}</span>
      ${t.plan && t.plan.text ? `<span class="st ${t.plan.cls==="ok"?"del":t.plan.cls==="bad"?"bad":"warn"}">${esc(t.plan.text)}</span>` : os.length?`<span class="st wait">No load plan</span>`:""}
      ${compact?"":`<span class="num" style="margin-left:auto">${money(sum(os,o=>o.price))}</span>`}</div></button>`; }).join("")}</div>`;
}
function bindTripCards(){ $("main").querySelectorAll("[data-trip]").forEach(b => b.onclick = () => go("trip-"+b.dataset.trip)); }
let tripTab = "active";
R.trips = () => {
  const ts = list("trips").sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.created||0)-(a.created||0));
  const act = ts.filter(t => tStatus(t)[0]!=="Completed"), done = ts.filter(t => tStatus(t)[0]==="Completed");
  const shown = tripTab==="active" ? act : done;
  return `<div class="head"><div><h1>Trips</h1><p>A trip is one truck, one driver and the cars it carries, in stop order.</p></div>
    <button class="btn pri" data-act="new">+ New trip</button></div>
  <div class="tools chips"><button class="fchip ${tripTab==="active"?"on":""}" data-tab="active">Active · ${act.length}</button><button class="fchip ${tripTab==="done"?"on":""}" data-tab="done">Completed · ${done.length}</button></div>
  ${tripCards(shown) || `<div class="empty">${tripTab==="active" ? "No active trips. Tick released orders in Orders and choose “Put on a new trip”, or start an empty trip." : "No completed trips yet."}</div>`}`;
};
R.after_trips = () => { bindTripCards(); $("main").querySelector('[data-act="new"]').onclick = () => newTrip([]); $("main").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tripTab = b.dataset.tab; refresh(); }); };
function newTrip(orderIds){
  const os = orderIds.map(id => get("orders",id)).filter(Boolean);
  const from = os[0] ? locName(os[0].from) : "", to = os.length ? locName(os[os.length-1].to) : "";
  const truck = list("trucks")[0], drv = list("drivers")[0];
  const t = put("trips", {name: from && to ? `${from} → ${to}` : "Trip "+fDate(todayISO()), date: todayISO(), truck: truck?truck.id:"", driver: drv?drv.id:"", route:"base", orders: orderIds.slice(), stops:[], created: Date.now(), km:0}, true);
  os.forEach(o => { const old = o.trip && get("trips",o.trip); if(old && old.id!==t.id){ old.orders = old.orders.filter(x=>x!==o.id); put("trips",old,true); } o.trip = t.id; put("orders",o,true); });
  go("trip-"+t.id); toast("Trip created");
}
const ROUTES = [["base","As in your real loads"],["eu","EU minimum (18.75 m, 4.00 m)"],["de","Germany (20.75 m loaded)"],["fr","France (20.35 m loaded)"],["uk","UK (18.75 m)"]];
R.trip = id => {
  const t = get("trips", id);
  if(!t) return `<div class="empty">This trip no longer exists. <a href="#trips">All trips</a></div>`;
  const os = tripOrders(t), stops = tripStops(t), s = tStatus(t), truck = get("trucks",t.truck);
  const plan = t.plan || null, fresh = plan && t.planSig===planSig(t);
  const pos = {}; os.forEach(o => { const p = plan && plan.positions && plan.positions[o.id]; if(p) pos[p] = o; });
  const hos = list("handovers").filter(h => h.trip===t.id).sort((a,b)=>a.at-b.at);
  const picked = os.filter(o=>o.loadedAt).length, delivered = os.filter(o=>o.deliveredAt).length;
  const cell = p => { const o = pos[p]; return o ? `<div class="pos full"><b>${p}</b><span class="m">${esc(shortModel(o.model)||o.modelText)}</span><span class="hint">Stop ${stopNo(t,o)}</span></div>` : `<div class="pos${truck && truck.profile==="eurolohr200-high" && p==="T1"?" none":""}"><b>${p}</b><span class="hint">empty</span></div>`; };
  return `<div class="head"><div><p style="margin:0 0 4px"><a href="#trips">← Trips</a></p><h1>${esc(t.name)}</h1>
    <p>${fDate(t.date)} · ${esc(truckName(t.truck))} · ${esc(drvName(t.driver))} · <span class="st ${s[1]}">${s[0]}</span></p></div>
    <div class="tools" style="margin:0"><button class="btn" data-act="edit">Edit trip</button><button class="btn" data-act="add">+ Add cars</button><button class="btn pri" data-act="plan">Open in load planner</button></div></div>
  <div class="tripgrid">
    <section>
      <h2 style="margin-bottom:10px">Stops</h2>
      ${os.length ? `<div class="stop"><header><span class="n">P</span><b>Pickup</b><span class="hint">${[...new Set(os.map(o=>locName(o.from)))].map(esc).join(", ")}</span>
        <span style="margin-left:auto" class="hint">${picked}/${os.length} picked up</span>${picked<os.length?`<a class="btn sm pri" href="#handover-${t.id}" data-hk="pickup">Pickup handover</a>`:""}</header></div>` : ""}
      ${stops.map((l,i) => { const so = os.filter(o => (o.to||"?")===l), dn = so.filter(o=>o.deliveredAt).length;
        return `<div class="stop"><header><span class="n">${i+1}</span><b>${esc(locName(l))}</b><span class="hint">${esc((get("locations",l)||{}).hours||"")}</span>
          <span style="margin-left:auto;display:flex;gap:4px">${i>0?`<button class="btn sm" data-up="${i}" aria-label="Move stop up">↑</button>`:""}${i<stops.length-1?`<button class="btn sm" data-down="${i}" aria-label="Move stop down">↓</button>`:""}</span>
          ${dn<so.length && so.every(o=>o.loadedAt) ? `<a class="btn sm pri" href="#handover-${t.id}" data-hk="d:${l}">Delivery handover</a>` : dn===so.length ? `<span class="st del">Delivered</span>` : ""}</header>
          ${so.map(o => `<div class="carline"><span class="tag">${esc((plan&&plan.positions&&plan.positions[o.id])||"–")}</span><span class="grow"><b>${esc(shortModel(o.model)||o.modelText)}</b> <span class="hint vin">${esc(o.vin)}</span>${o.nonRunner?' <span class="tag">non-runner</span>':""}</span>${pill(oStatus(o))}
            ${!o.loadedAt?`<button class="btn sm" data-rm="${o.id}">Remove</button>`:""}</div>`).join("")}</div>`; }).join("") || `<div class="empty">No cars on this trip yet. <button class="btn sm pri" data-act="add">Add cars</button></div>`}
      ${hos.length ? `<h2 style="margin:22px 0 10px">Handovers done</h2><ul class="alerts">${hos.map(h=>`<li><span><b>${h.kind==="pickup"?"Pickup":"Delivery"}</b> at ${esc(locName(h.loc))} · ${fDT(h.at)} · ${h.orders.length} cars · ${h.unattended?"unattended":"signed by "+esc(h.name||"")}</span><a class="btn sm" href="#ecmr">eCMR</a></li>`).join("")}</ul>` : ""}
    </section>
    <aside>
      <div class="card">
        <h2 style="margin-bottom:8px">Load plan</h2>
        ${plan && plan.text ? `<div class="verdict"><span class="vbig ${plan.cls}">${esc(plan.text)}</span>${fresh?"":`<span class="st warn">Out of date: cars or truck changed</span>`}</div>` : `<p class="hint">No plan yet. Open the load planner: it gets this trip's cars and stop numbers, and the plan comes back here.</p>`}
        <div class="posmap">${POSROWS.map((r,i) => i===0 ? `<div class="posrow">${r.map(cell).join("")}<span></span><span></span><span></span><span></span></div>` : "").join("")}
          <div class="posrow">${POSROWS[1].map(cell).join("")}<span></span>${POSROWS[2].map(cell).join("")}</div>
          <p class="hint" style="margin:2px 0 0">Top: truck T1–T3. Bottom: trailer upper deck R1–R3 · lower deck R4–R6.${plan&&plan.at?` Planned ${fDT(plan.at)}.`:""}</p></div>
        <div style="margin-top:12px;display:grid;gap:6px"><button class="btn pri" data-act="plan" style="width:100%">${plan?"Change the plan":"Plan the load"}</button>${os.length?`<button class="btn" data-act="pdf" style="width:100%">Download load plan PDF</button>`:""}</div>
      </div>
      <div class="card" style="margin-top:12px">${tripMoneyHtml(t)}</div>
      <p class="hint" style="margin-top:10px">${delivered}/${os.length} delivered. Route rules: ${esc((ROUTES.find(r=>r[0]===(t.route||"base"))||ROUTES[0])[1])}.</p>
    </aside>
  </div>`;
};
R.after_trip = id => {
  const t = get("trips", id); if(!t) return; const m = $("main");
  m.querySelectorAll('[data-act="edit"]').forEach(b => b.onclick = () => tripForm(id));
  m.querySelectorAll('[data-act="add"]').forEach(b => b.onclick = () => addCars(id));
  m.querySelectorAll('[data-act="plan"]').forEach(b => b.onclick = () => openPlanner(id));
  m.querySelectorAll('[data-act="pdf"]').forEach(b => b.onclick = () => openPlanner(id, true));
  m.querySelectorAll("[data-hk]").forEach(a => a.onclick = () => { hoPick = {trip:id, stop:a.dataset.hk}; });
  m.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const o = get("orders",b.dataset.rm); t.orders = t.orders.filter(x=>x!==o.id); put("trips",t,true); delete o.trip; put("orders",o); toast("Removed from trip"); });
  m.querySelectorAll("[data-setkm]").forEach(b => b.onclick = () => { t.km = +b.dataset.setkm; put("trips",t); toast("Distance set"); });
  const mv = (i, d) => { const st = tripStops(t); [st[i], st[i+d]] = [st[i+d], st[i]]; t.stops = st; put("trips",t); };
  m.querySelectorAll("[data-up]").forEach(b => b.onclick = () => mv(+b.dataset.up, -1));
  m.querySelectorAll("[data-down]").forEach(b => b.onclick = () => mv(+b.dataset.down, 1));
};
function tripForm(id){
  const t = clone(get("trips",id));
  openModal("Edit trip", `<form id="tf" class="grid2">
    ${fld("Trip name","name",t.name)}${fld("Date","date",t.date,"date")}
    ${sel("Truck","truck",[["","No truck"]].concat(list("trucks").map(x=>[x.id,truckName(x.id)])),t.truck)}
    ${sel("Driver","driver",[["","No driver"]].concat(list("drivers").map(x=>[x.id,x.name])),t.driver)}
    ${sel("Route rules for the load planner","route",ROUTES,t.route||"base")}
    <label class="f">Distance incl. empty km (km)<input name="km" type="number" min="0" step="1" value="${esc(t.km||"")}"><span class="hint">${(()=>{ const r = tripRouteKm(t); return r.km!=null ? "Known distances: "+r.km+" km loaded" : r.missing.length ? "Missing distance: "+r.missing.map(p=>locName(p[0])+" → "+locName(p[1])).join(", ") : ""; })()}</span></label>
    ${fld("Days (empty = from km, 0.5 for half a day)","days",t.days||"","number",'min="0" step="0.5"')}
    ${fld("Tolls paid ("+(S().currency||"EUR")+", empty = estimate)","tolls",t.tolls??"","number",'min="0" step="0.01"')}
    ${fld("Other costs ("+(S().currency||"EUR")+")","otherCost",t.otherCost||"","number",'min="0" step="0.01"')}
    ${fld("What the other costs are","otherNote",t.otherNote,"text",'placeholder="e.g. ferry, parking, winch hire"')}
  </form>`, `${!tripOrders(t).some(o=>o.loadedAt)?`<button class="btn danger left" id="tdel">Delete trip</button>`:""}<button class="btn" data-close>Cancel</button><button class="btn pri" id="tsave">Save</button>`,
  root => {
    $("tsave").onclick = () => { const v = formVals(root.querySelector("#tf")); Object.assign(t, v, {km:+v.km||0, days:+v.days||0, tolls:v.tolls===""?"":+v.tolls, otherCost:+v.otherCost||0}); delete t.cost; put("trips",t); closeModal(); toast("Trip saved"); };
    const d = $("tdel"); if(d) d.onclick = () => confirmBtn(d, "Sure? Tap again", () => { tripOrders(t).forEach(o => { delete o.trip; put("orders",o,true); }); del("trips",t.id,true); closeModal(); go("trips"); toast("Trip deleted, its cars are back in Orders"); });
  });
}
function addCars(id){
  const t = get("trips",id);
  const avail = list("orders").filter(o => !o.loadedAt && !(o.trip && get("trips",o.trip)) && !o.deliveredAt);
  const pick = new Set();
  const froms = [...new Set(avail.map(o=>o.from))];
  openModal("Add cars to "+t.name, `
    ${avail.length ? `<div class="tools"><select class="inp" id="afrom" style="max-width:280px">${opt("","All pickup places","")}${froms.map(f=>opt(f,locName(f),"")).join("")}</select><label class="chk"><input type="checkbox" id="aonly" checked> Released only</label></div>
    <div class="tw"><table><thead><tr><th></th><th>VIN</th><th>Car</th><th>From → to</th><th>Due</th></tr></thead><tbody id="alist"></tbody></table></div>
    <p class="hint" id="acount"></p>` : `<div class="empty">No cars waiting. Add orders first.</div>`}`,
    `<button class="btn" data-close>Cancel</button><button class="btn pri" id="ago">Add to trip</button>`,
    () => {
      if(!avail.length){ $("ago").disabled = true; return; }
      const draw = () => { const f = $("afrom").value, only = $("aonly").checked;
        $("alist").innerHTML = avail.filter(o => (!f || o.from===f) && (!only || o.released)).map(o => `<tr><td><input type="checkbox" data-p="${o.id}" ${pick.has(o.id)?"checked":""} aria-label="Pick ${esc(o.vin)}"></td><td class="vin">${esc(o.vin)}</td><td>${esc(shortModel(o.model)||o.modelText)}${o.released?"":' <span class="st wait">not released</span>'}</td><td>${esc(locName(o.from))} → ${esc(locName(o.to))}</td><td>${fDate(o.due)}</td></tr>`).join("") || `<tr><td colspan="5" class="hint">None here.</td></tr>`;
        $("alist").querySelectorAll("[data-p]").forEach(c => c.onchange = () => { c.checked ? pick.add(c.dataset.p) : pick.delete(c.dataset.p); $("acount").textContent = pick.size+" picked"+(t.orders.length+pick.size>9?" · more than 9 cars will not fit one Eurolohr":""); }); };
      $("afrom").onchange = draw; $("aonly").onchange = draw; draw();
      $("ago").onclick = () => { if(!pick.size){ toast("Pick some cars"); return; }
        pick.forEach(oid => { const o = get("orders",oid); o.trip = t.id; put("orders",o,true); if(!t.orders.includes(oid)) t.orders.push(oid); });
        put("trips",t); closeModal(); toast(pick.size+" cars added"); };
    });
}

/* ================= load planner (the existing planner, embedded) ================= */
let planTrip = null, frameReady = false, planPdf = false;
function openPlanner(id, pdf){ planTrip = id||null; planPdf = !!pdf; frameReady = false; if(view==="planner"){ lastView = null; refresh(); } else go("planner"); }
R.planner = () => `<div id="pbar"></div><iframe class="planner" id="lpframe" src="planner.html" title="Car load planner"></iframe>`;
R.plannerBar = () => {
  const t = planTrip && get("trips",planTrip), el = $("pbar"); if(!el) return;
  el.innerHTML = t ? `<div class="plannerbar"><span><b>Planning ${esc(t.name)}</b> · ${tripOrders(t).length} cars · ${esc(truckName(t.truck))}. Moves you make are saved to the trip.</span>
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="preload">Reload trip cars</button><a class="btn sm dark" href="#trip-${t.id}">Done, back to trip</a></span></div>`
    : `<div class="plannerbar free"><span><b>Free planning.</b> Not linked to a trip: use it to try loads. To plan a trip, open the trip and choose “Open in load planner”.</span>
      ${list("trips").filter(x=>tStatus(x)[0]==="Planning").length ? `<select class="inp" id="ptrip" style="max-width:260px;margin-left:auto">${opt("","Or pick a trip…","")}${list("trips").filter(x=>tStatus(x)[0]==="Planning").map(x=>opt(x.id,x.name,"")).join("")}</select>`:""}</div>`;
  const r = $("preload"); if(r) r.onclick = () => sendTrip(true);
  const p = $("ptrip"); if(p) p.onchange = () => { if(p.value){ planTrip = p.value; R.plannerBar(); sendTrip(); } };
};
R.after_planner = () => { R.plannerBar(); };
function sendTrip(reset){
  const t = planTrip && get("trips",planTrip), fr = $("lpframe"); if(!t || !fr || !fr.contentWindow) return;
  const truck = get("trucks",t.truck)||{}, keep = {};
  if(!reset) (t.lpCars||[]).forEach(c => { if(c.ord) keep[c.ord] = c; });
  const cars = tripOrders(t).map(o => ({ord:o.id, model:o.model||o.modelText||"", stop:stopNo(t,o), keep: keep[o.id] && keep[o.id].model===o.model ? keep[o.id] : null}));
  const extra = [truck.plate ? truckName(t.truck) : "", t.driver ? drvName(t.driver) : ""].filter(Boolean).join(" · ");
  fr.contentWindow.postMessage({type:"lp-load", trip:t.id, name:t.name, profile:truck.profile||"eurolohr200-low", route:t.route||"base", cars, extra, pdf:planPdf}, "*"); planPdf = false;
}
let planWrite = {};
window.addEventListener("message", e => {
  const fr = $("lpframe"), d = e.data||{}; if(!fr || e.source!==fr.contentWindow) return;
  if(d.type==="lp-pdf" && d.blob){ saveFile(d.blob, d.name||"load-plan.pdf"); toast("Load plan PDF ready"); return; }
  if(d.type==="lp-ready"){ frameReady = true; if(planTrip) sendTrip(); }
  if(d.type==="lp-plan" && d.tmsTrip && d.tmsTrip===planTrip){
    const t = get("trips",d.tmsTrip); if(!t) return;
    const positions = {}; (d.cars||[]).forEach(c => { if(c.ord && d.positions && d.positions[c.id]) positions[c.ord] = d.positions[c.id]; });
    const plan = {text: d.verdict ? d.verdict.text : "", cls: d.verdict ? d.verdict.cls : "", positions, at: Date.now(), profile:d.profile, route:d.route};
    const lp = (d.cars||[]).map(c => { const x = Object.assign({}, c); delete x.id; return x; });
    if(t.plan && JSON.stringify([t.plan.text,t.plan.cls,t.plan.positions,t.route])===JSON.stringify([plan.text,plan.cls,plan.positions,d.route]) && JSON.stringify(t.lpCars)===JSON.stringify(lp)) return;
    clearTimeout(planWrite[t.id]);
    planWrite[t.id] = setTimeout(() => { const tt = get("trips",t.id); if(!tt) return; tt.plan = plan; tt.lpCars = lp; if(d.route) tt.route = d.route; tt.planSig = planSig(tt); put("trips",tt,true); renderTabs(); }, 700);
  }
});

/* ================= handover: photos, damage and signature at pickup and delivery ================= */
let hoPick = null, hoDraft = null, hoZone = {};
const ZONES = [["fb","Front bumper",18,4,84,16],["bo","Bonnet",18,20,84,50],["ws","Windscreen",22,70,76,20],["ro","Roof",22,90,76,60],["rw","Rear window",22,150,76,15],["tr","Boot / tailgate",18,165,84,50],["rb","Rear bumper",18,215,84,16],
  ["lf","Left front side",2,26,16,94],["lr","Left rear side",2,120,16,94],["rf","Right front side",102,26,16,94],["rr","Right rear side",102,120,16,94]];
const EXTRA_ZONES = [["wh","Wheels / rims"],["in","Interior"],["un","Underbody"],["gl","Glass / mirrors"]];
const zoneName = k => (ZONES.find(z=>z[0]===k)||EXTRA_ZONES.find(z=>z[0]===k)||[,k])[1];
const DTYPES = ["Scratch","Dent","Stone chip","Crack / broken","Missing part","Paint damage","Too dirty to inspect"];
const DSEV = ["Small (under 2 cm)","Medium (2–10 cm)","Large (over 10 cm)"];
function stopsFor(t){ // what can be handed over on this trip right now
  const os = tripOrders(t), out = [];
  const notPicked = os.filter(o => !o.loadedAt);
  if(notPicked.length) out.push({key:"pickup", kind:"pickup", label:`Pickup · ${[...new Set(notPicked.map(o=>locName(o.from)))].join(", ")}`, loc:notPicked[0].from, orders:notPicked});
  tripStops(t).forEach((l,i) => { const so = os.filter(o => (o.to||"?")===l && o.loadedAt && !o.deliveredAt); if(so.length) out.push({key:"d:"+l, kind:"delivery", label:`Stop ${i+1} · Delivery at ${locName(l)}`, loc:l, orders:so}); });
  return out;
}
R.handover = id => {
  if(!id){
    const ts = list("trips").filter(t => stopsFor(t).length).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    return `<div class="head"><div><h1>Handover</h1><p>For the driver at the compound or dealer: check each car, take photos, mark damage, get a signature. Made to use on a phone.</p></div></div>
    ${ts.length ? `<div class="cards">${ts.map(t => `<div class="card"><h3>${esc(t.name)}</h3><p class="hint" style="margin:4px 0 10px">${fDate(t.date)} · ${esc(truckName(t.truck))} · ${esc(drvName(t.driver))}</p>
      ${stopsFor(t).map(s => `<a class="btn ${s.kind==="pickup"?"pri":"dark"}" style="width:100%;margin-bottom:6px;justify-content:flex-start" href="#handover-${t.id}" data-hk="${t.id}|${esc(s.key)}">${esc(s.label)} · ${s.orders.length} car${s.orders.length>1?"s":""}</a>`).join("")}</div>`).join("")}</div>`
      : `<div class="empty">No handovers waiting. Cars on a trip show up here for pickup, and again for delivery once they are on the truck.</div>`}`;
  }
  const t = get("trips", id); if(!t) return `<div class="empty">Trip not found. <a href="#handover">Back</a></div>`;
  const stops = stopsFor(t);
  if(!stops.length) return `<div class="head"><div><p style="margin:0 0 4px"><a href="#trip-${t.id}">← ${esc(t.name)}</a></p><h1>All handovers done</h1></div></div><div class="empty">Every car on this trip is picked up and delivered. <a href="#ecmr">See the eCMRs</a></div>`;
  let st = stops.find(s => hoPick && hoPick.trip===id && s.key===hoPick.stop) || stops[0];
  hoPick = {trip:id, stop:st.key};
  if(!hoDraft || hoDraft.trip!==id || hoDraft.key!==st.key){
    hoDraft = {trip:id, key:st.key, kind:st.kind, loc:st.loc, checks:{}, name:"", sig:null, unattended:false, notes:"", keys:true};
    st.orders.forEach(o => hoDraft.checks[o.id] = {on:true, vin:false, damages:[], photos:[], km:""});
  }
  st.orders.forEach(o => { if(!hoDraft.checks[o.id]) hoDraft.checks[o.id] = {on:true, vin:false, damages:[], photos:[], km:""}; });
  const del = st.kind==="delivery", L = get("locations", st.loc)||{};
  const cars = st.orders, on = cars.filter(o => hoDraft.checks[o.id].on);
  const ready = on.filter(o => { const c = hoDraft.checks[o.id]; return c.vin && (!hoDraft.unattended || c.photos.length); }).length;
  return `<div class="head"><div><p style="margin:0 0 4px"><a href="#trip-${t.id}">← ${esc(t.name)}</a></p><h1>${del?"Delivery":"Pickup"} at ${esc(locName(st.loc))}</h1>
    <p>${esc(L.address||"")}${L.hours?" · "+esc(L.hours):""}${L.contact?" · "+esc(L.contact):""}</p></div>
    ${stops.length>1?`<select class="inp" id="hostop" style="max-width:340px">${stops.map(s=>opt(s.key,s.label,st.key)).join("")}</select>`:""}</div>
  <p class="note">${del ? "Check each car again before you hand it over. Anything new since pickup goes on the eCMR as a reservation." : "Record the condition of every car before it goes on the truck: what you mark here protects you if the customer claims damage later."}</p>
  ${cars.map((o,i) => hoCar(o, i, del)).join("")}
  <section class="card sec">
    <h2 style="margin-bottom:10px">${del?"Received by":"Handed over by"}</h2>
    ${del ? `<label class="chk"><input type="checkbox" id="unatt" ${hoDraft.unattended?"checked":""}> Unattended delivery: nobody there (photos of every car required)</label>` : ""}
    <div id="sigbox" ${hoDraft.unattended?"hidden":""}>
      <div class="grid2" style="margin-bottom:10px"><label class="f">Name<input id="hname" value="${esc(hoDraft.name)}" autocomplete="off"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" id="hkeys" ${hoDraft.keys?"checked":""}> Keys and papers handed over</label></div>
      <p class="hint" style="margin:0 0 4px">Signature</p>
      <canvas class="sig" id="sig" width="1040" height="340" aria-label="Signature pad"></canvas>
      <button class="btn sm" id="sigclear" style="margin-top:6px">Clear signature</button>
    </div>
    <label class="f" style="margin-top:12px">Notes<textarea id="hnotes" placeholder="e.g. car left at the key box, waited 45 min">${esc(hoDraft.notes)}</textarea></label>
    <p class="hint">Time is recorded when you complete. ${on.length} of ${cars.length} cars included, ${ready} ready.</p>
    <button class="btn pri" id="hodone" style="width:100%;min-height:52px;font-size:17px">Complete ${del?"delivery":"pickup"} of ${on.length} car${on.length===1?"":"s"}</button>
  </section>`;
};
function hoCar(o, i, del){
  const c = hoDraft.checks[o.id], z = hoZone[o.id];
  const before = del ? (o.dmgPickup||[]) : [];
  const hitZ = new Set(c.damages.map(d=>d.zone)), oldZ = new Set(before.map(d=>d.zone));
  const t = get("trips",hoDraft.trip), pos = t && t.plan && t.plan.positions ? t.plan.positions[o.id] : "";
  return `<article class="hcar ${c.on && c.vin?"done":""}" data-car="${o.id}">
    <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px">
      <div><h3>${i+1}. ${esc(shortModel(o.model)||o.modelText)}${pos?` <span class="tag">${esc(pos)}</span>`:""}</h3><p class="hint" style="margin:2px 0 0">${esc(custName(o.customer))} · to ${esc(locName(o.to))}${o.nonRunner?" · non-runner":""}${o.notes?" · "+esc(o.notes):""}</p></div>
      <label class="chk"><input type="checkbox" data-on="${o.id}" ${c.on?"checked":""}> Include this car</label>
    </div>
    ${c.on ? `<label class="chk" style="font-size:17px"><input type="checkbox" data-vin="${o.id}" ${c.vin?"checked":""}> VIN on the car matches <b class="vin" style="letter-spacing:.06em">${esc(o.vin)}</b></label>
    <div class="hgrid">
      <div>
        <svg class="carsvg" viewBox="0 0 120 236" role="group" aria-label="Car seen from above, front at the top. Tap where the damage is.">
          ${ZONES.map(zz => `<rect class="z ${hitZ.has(zz[0])?"hit":oldZ.has(zz[0])?"old":""}" data-zone="${o.id}|${zz[0]}" x="${zz[2]}" y="${zz[3]}" width="${zz[4]}" height="${zz[5]}" rx="${zz[0].length===2&&/^[lr]/.test(zz[0])?6:4}" tabindex="0" role="button" aria-label="${zz[1]}"><title>${zz[1]}</title></rect>`).join("")}
          <text x="60" y="47" text-anchor="middle">FRONT</text><text x="60" y="124" text-anchor="middle">roof</text><text x="60" y="194" text-anchor="middle">REAR</text>
        </svg>
        <div class="chips" style="margin-top:6px">${EXTRA_ZONES.map(zz=>`<button class="fchip ${hitZ.has(zz[0])?"on":""}" data-zone="${o.id}|${zz[0]}">${zz[1]}</button>`).join("")}</div>
      </div>
      <div>
        ${z ? `<div class="card" style="margin-bottom:10px"><b>${esc(zoneName(z))}</b>
          <div class="grid2" style="margin-top:8px"><label class="f">Damage<select id="dt-${o.id}">${DTYPES.map(x=>opt(x,x,"")).join("")}</select></label><label class="f">Size<select id="ds-${o.id}">${DSEV.map(x=>opt(x,x,"")).join("")}</select></label></div>
          <div style="display:flex;gap:6px;margin-top:8px"><button class="btn pri sm" data-adddmg="${o.id}">Add damage</button><button class="btn sm" data-nozone="${o.id}">Cancel</button></div></div>` : `<p class="hint" style="margin-top:0">Tap the drawing where there is damage.${del&&before.length?" Orange = already there at pickup.":""}</p>`}
        ${before.length ? `<p class="hint" style="margin:0">Known at pickup:</p><ul class="dmg">${before.map(d=>`<li>• ${esc(zoneName(d.zone))}: ${esc(d.type)}, ${esc(d.sev.split(" (")[0].toLowerCase())}</li>`).join("")}</ul>`:""}
        ${c.damages.length ? `<ul class="dmg">${c.damages.map((d,k)=>`<li class="${del && !before.some(b=>b.zone===d.zone&&b.type===d.type)?"new":""}">• ${esc(zoneName(d.zone))}: ${esc(d.type)}, ${esc(d.sev.split(" (")[0].toLowerCase())}${del && !before.some(b=>b.zone===d.zone&&b.type===d.type)?" (new)":""} <button class="btn sm" data-rmdmg="${o.id}|${k}">Remove</button></li>`).join("")}</ul>` : `<p style="margin:4px 0"><b>${before.length?"No new damage":"No damage"}</b> <span class="hint">recorded</span></p>`}
        <div class="thumbs">${c.photos.map(p => { const ph = get("photos",p); return ph ? `<figure><img src="${ph.data}" alt="Photo of ${esc(o.vin)}"><button data-rmph="${o.id}|${p}" aria-label="Remove photo">×</button></figure>` : ""; }).join("")}</div>
        <span class="btn filebtn">📷 Add photos (${c.photos.length})<input type="file" accept="image/*" capture="environment" multiple data-ph="${o.id}" aria-label="Add photos"></span>
        <p class="hint" style="margin:6px 0 0">Four corners, plus close-ups of any damage.</p>
      </div>
    </div>` : `<p class="hint">Not part of this ${del?"delivery":"pickup"}: it stays ${del?"on the truck":"at the pickup place"}.</p>`}
  </article>`;
}
function hoRedraw(){ const y = window.scrollY; $("main").innerHTML = R.handover(param); R.after_handover(param); window.scrollTo(0,y); }
function shrinkPhoto(file){ return new Promise((res, rej) => { const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { const k = Math.min(1, 1000/Math.max(img.width,img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg",0.62)); };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("not an image")); }; img.src = url; }); }
R.after_handover = id => {
  const m = $("main");
  m.querySelectorAll("[data-hk]").forEach(a => a.onclick = () => { const [tid,k] = a.dataset.hk.split("|"); hoPick = {trip:tid, stop:k}; });
  if(!id || !hoDraft) return;
  const s = $("hostop"); if(s) s.onchange = () => { hoPick = {trip:id, stop:s.value}; hoRedraw(); };
  m.querySelectorAll("[data-on]").forEach(c => c.onchange = () => { hoDraft.checks[c.dataset.on].on = c.checked; hoRedraw(); });
  m.querySelectorAll("[data-vin]").forEach(c => c.onchange = () => { hoDraft.checks[c.dataset.vin].vin = c.checked; c.closest(".hcar").classList.toggle("done", c.checked); });
  m.querySelectorAll("[data-zone]").forEach(z => { const f = () => { const [o,k] = z.dataset.zone.split("|"); hoZone[o] = k; hoRedraw(); }; z.addEventListener("click", f); z.addEventListener("keydown", e => { if(e.key==="Enter"||e.key===" "){ e.preventDefault(); f(); } }); });
  m.querySelectorAll("[data-nozone]").forEach(b => b.onclick = () => { delete hoZone[b.dataset.nozone]; hoRedraw(); });
  m.querySelectorAll("[data-adddmg]").forEach(b => b.onclick = () => { const o = b.dataset.adddmg; hoDraft.checks[o].damages.push({zone:hoZone[o], type:$("dt-"+o).value, sev:$("ds-"+o).value}); delete hoZone[o]; hoRedraw(); });
  m.querySelectorAll("[data-rmdmg]").forEach(b => b.onclick = () => { const [o,k] = b.dataset.rmdmg.split("|"); hoDraft.checks[o].damages.splice(+k,1); hoRedraw(); });
  m.querySelectorAll("[data-rmph]").forEach(b => b.onclick = () => { const [o,p] = b.dataset.rmph.split("|"); const c = hoDraft.checks[o]; c.photos = c.photos.filter(x=>x!==p); del("photos",p,true); hoRedraw(); });
  m.querySelectorAll("[data-ph]").forEach(inp => inp.onchange = async () => {
    const o = inp.dataset.ph, files = [...inp.files]; if(!files.length) return; toast("Saving photos…");
    for(const f of files){ try{ const data = await shrinkPhoto(f); const p = put("photos", {order:o, trip:id, kind:hoDraft.kind, data, at:Date.now()}, true); hoDraft.checks[o].photos.push(p.id); }catch(e){ toast("Could not read one of the photos"); } }
    hoRedraw(); toast(files.length+" photo"+(files.length>1?"s":"")+" added");
  });
  const un = $("unatt"); if(un) un.onchange = () => { hoDraft.unattended = un.checked; hoRedraw(); };
  const nm = $("hname"); if(nm) nm.oninput = () => hoDraft.name = nm.value;
  const ky = $("hkeys"); if(ky) ky.onchange = () => hoDraft.keys = ky.checked;
  $("hnotes").oninput = e => hoDraft.notes = e.target.value;
  // signature pad
  const cv = $("sig");
  if(cv){
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0,0,cv.width,cv.height); g.lineWidth = 4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#111";
    if(hoDraft.sig){ const im = new Image(); im.onload = () => g.drawImage(im,0,0,cv.width,cv.height); im.src = hoDraft.sig; }
    let drawing = false, last = null;
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX-r.left)*cv.width/r.width, (e.clientY-r.top)*cv.height/r.height]; };
    cv.onpointerdown = e => { drawing = true; last = pt(e); cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = e => { if(!drawing) return; const p = pt(e); g.beginPath(); g.moveTo(last[0],last[1]); g.lineTo(p[0],p[1]); g.stroke(); last = p; };
    cv.onpointerup = cv.onpointercancel = () => { if(!drawing) return; drawing = false; hoDraft.sig = cv.toDataURL("image/jpeg",0.7); };
    $("sigclear").onclick = () => { g.fillStyle = "#fff"; g.fillRect(0,0,cv.width,cv.height); hoDraft.sig = null; };
  }
  $("hodone").onclick = () => {
    const t = get("trips",id), st = stopsFor(t).find(x => x.key===hoDraft.key); if(!st){ toast("This stop is already done"); return; }
    const on = st.orders.filter(o => hoDraft.checks[o.id].on);
    if(!on.length){ toast("No cars included"); return; }
    const noVin = on.filter(o => !hoDraft.checks[o.id].vin); if(noVin.length){ toast(`Tick the VIN check for ${noVin.length} car${noVin.length>1?"s":""}`); m.querySelector(`[data-car="${noVin[0].id}"]`).scrollIntoView({behavior:"smooth",block:"center"}); return; }
    if(hoDraft.unattended){ const np = on.filter(o => !hoDraft.checks[o.id].photos.length); if(np.length){ toast("Unattended delivery: add photos of every car"); m.querySelector(`[data-car="${np[0].id}"]`).scrollIntoView({behavior:"smooth",block:"center"}); return; } }
    else { if(!hoDraft.name.trim()){ toast("Add the name of the person "+(st.kind==="delivery"?"receiving":"handing over")); $("hname").focus(); return; } if(!hoDraft.sig){ toast("Ask for a signature"); return; } }
    const now = Date.now();
    const h = put("handovers", {trip:id, kind:st.kind, loc:st.loc, orders:on.map(o=>o.id), at:now, name:hoDraft.unattended?"":hoDraft.name.trim(), sig:hoDraft.unattended?null:hoDraft.sig,
      unattended:!!hoDraft.unattended, keys:!!hoDraft.keys, notes:hoDraft.notes, driver:t.driver, truck:t.truck,
      checks:Object.fromEntries(on.map(o => [o.id, {damages:hoDraft.checks[o.id].damages, photos:hoDraft.checks[o.id].photos}]))}, true);
    on.forEach(o => { const c = hoDraft.checks[o.id];
      if(st.kind==="pickup"){ o.loadedAt = now; o.dmgPickup = c.damages; o.hoPickup = h.id; }
      else { o.deliveredAt = now; o.dmgDelivery = c.damages; o.hoDelivery = h.id; }
      put("orders", o, true); });
    hoDraft = null; hoZone = {}; hoPick = null;
    toast(`${st.kind==="pickup"?"Pickup":"Delivery"} of ${on.length} car${on.length>1?"s":""} saved`); go("trip-"+id);
  };
};

/* ================= finance: prices per km, fuel surcharge, costs and profit ================= */
const FIN_DEF = {
  diesel:{base:1.55, current:1.55, share:30, history:[]},   // fuel clause: surcharge % = (current - base) / base x fuel share of cost
  manualFuel:"",                                            // a fixed surcharge % instead of the diesel formula
  cost:{lPer100:32, maintKm:0.11, tollKm:0.17, driverDay:240, fixedMonth:4300, workDays:21, kmDay:650, emptyPct:25},
  distances:{}, target:15
};
function F(){ const f = clone(FIN_DEF), s = S().fin||{}; Object.keys(s).forEach(k => { f[k] = (s[k] && typeof s[k]==="object" && !Array.isArray(s[k])) ? Object.assign(f[k]||{}, s[k]) : s[k]; }); return f; }
function saveFin(f){ const s = clone(S()); s.fin = f; put("settings", s, true); }
const r2 = n => Math.round((+n||0)*100)/100;
function fuelPct(){ const f = F(); if(f.manualFuel!=="" && f.manualFuel!=null) return +f.manualFuel||0; const d = f.diesel; if(!+d.base || !+d.current) return 0; return Math.round((d.current-d.base)/d.base*d.share*100)/100; }
function fuelText(){ const f = F(), p = fuelPct(); return f.manualFuel!=="" && f.manualFuel!=null ? `Fuel surcharge ${p}%` : `Fuel surcharge ${p}% (diesel ${money(f.diesel.current)}/L vs base ${money(f.diesel.base)}/L, fuel ${f.diesel.share}% of cost)`; }
function dist(a, b){ if(!a || !b) return null; const d = F().distances; return d[a+"|"+b] ?? d[b+"|"+a] ?? null; }
function setDist(a, b, km){ if(!a || !b || !(+km>0)) return; const f = F(); if(f.distances[a+"|"+b]===+km) return; f.distances[a+"|"+b] = +km; delete f.distances[b+"|"+a]; saveFin(f); }
// what this car should cost the customer, from their price agreement
function priceFor(o){
  const c = get("customers", o.customer); if(!c) return null;
  const lane = (c.lanes||[]).find(l => l.from===o.from && l.to===o.to);
  if(lane && +lane.price) return {price:+lane.price, how:"Lane price "+locName(o.from)+" → "+locName(o.to)};
  const km = +o.km || dist(o.from, o.to);
  if(c.priceMode==="km"){ if(!km) return {price:null, how:"Per-km price: add the distance"}; const p = Math.max(+c.minPrice||0, km*(+c.rateKm||0)); return {price:r2(p), how:`${km} km × ${money(c.rateKm)}/km${+c.minPrice && p===+c.minPrice?" (minimum price)":""}`}; }
  if(+c.rate) return {price:+c.rate, how:"Fixed price per car"};
  return null;
}
function surchargeOf(o){ const c = get("customers", o.customer); return c && c.fuelClause===false ? 0 : r2((+o.price||0)*fuelPct()/100); }
// cost model: what a kilometre and a working day of this truck cost you
function costRates(truckId){
  const f = F(), c = f.cost, t = get("trucks", truckId)||{};
  const l = +t.lPer100 || +c.lPer100, fixed = +t.fixedMonth || +c.fixedMonth;
  const fuelKm = l/100*(+f.diesel.current||0);
  return {fuelKm, tollKm:+c.tollKm, maintKm:+c.maintKm, perKm:fuelKm+(+c.tollKm)+(+c.maintKm), driverDay:+c.driverDay, fixedDay:fixed/(+c.workDays||21), perDay:(+c.driverDay)+fixed/(+c.workDays||21), lPer100:l};
}
function tripDays(t){ return +t.days || Math.max(1, Math.ceil((+t.km||0)/(+F().cost.kmDay||650))); }
function tripCost(t){
  const k = costRates(t.truck), km = +t.km||0, days = tripDays(t);
  const parts = [["Fuel", km*k.fuelKm, `${km} km × ${k.lPer100} L/100 km × ${money(F().diesel.current)}/L`],
    ["Tolls", t.tolls!=null && t.tolls!=="" ? +t.tolls : km*k.tollKm, t.tolls!=null && t.tolls!=="" ? "actual" : `estimate ${money(k.tollKm)}/km`],
    ["Maintenance & tyres", km*k.maintKm, `${money(k.maintKm)}/km`],
    ["Driver", days*k.driverDay, `${days} day${days!==1?"s":""} × ${money(k.driverDay)}`],
    ["Truck fixed costs", days*k.fixedDay, `${days} day${days!==1?"s":""} × ${money(k.fixedDay)}`]];
  if(+t.otherCost) parts.push(["Other", +t.otherCost, t.otherNote||""]);
  return {parts, total:sum(parts, p=>p[1]), km, days};
}
function tripMoney(t){
  const os = tripOrders(t), base = sum(os, o=>o.price), fuel = sum(os, surchargeOf), rev = base+fuel, cost = tripCost(t);
  return {os, base, fuel, rev, cost, margin:rev-cost.total, pct: rev ? (rev-cost.total)/rev*100 : 0};
}
function tripRouteKm(t){ // suggested trip distance from the known place-to-place distances: pickup -> stop 1 -> stop 2 ...
  const os = tripOrders(t); if(!os.length) return {km:null, missing:[]};
  const pts = [os[0].from].concat(tripStops(t)), missing = []; let km = 0;
  for(let i=1;i<pts.length;i++){ const d = dist(pts[i-1], pts[i]); if(d==null) missing.push([pts[i-1],pts[i]]); else km += d; }
  return {km: missing.length ? null : km, missing, pts};
}
function tripMoneyHtml(t){
  const m = tripMoney(t), truck = get("trucks", t.truck), val = sum(m.os, o=>o.value), sug = tripRouteKm(t);
  return `<h2 style="margin-bottom:8px">Money</h2>
  <table><tbody>
    <tr><td>Transport price</td><td class="num">${money(m.base)}</td></tr>
    ${m.fuel?`<tr><td>Fuel surcharge (${fuelPct()}%)</td><td class="num">${money(m.fuel)}</td></tr>`:""}
    <tr><td><b>Revenue</b></td><td class="num"><b>${money(m.rev)}</b></td></tr>
    ${m.cost.km ? m.cost.parts.map(p=>`<tr><td>${esc(p[0])} <span class="hint">${esc(p[2])}</span></td><td class="num">−${money(p[1])}</td></tr>`).join("") + `
    <tr><td><b>Margin</b></td><td class="num"><b style="color:${m.margin<0?"var(--bad)":"var(--em-deep)"}">${money(m.margin)} · ${m.pct.toFixed(0)}%</b></td></tr>
    <tr><td>Revenue / cost per km</td><td class="num">${money(m.rev/m.cost.km)} / ${money(m.cost.total/m.cost.km)}</td></tr>
    <tr><td>Cost per car</td><td class="num">${m.os.length?money(m.cost.total/m.os.length):"–"}</td></tr>`
    : `<tr><td colspan="2"><span class="hint">Add the distance to see costs and margin.</span> ${sug.km!=null?`<button class="btn sm" data-setkm="${sug.km}">Use ${sug.km} km</button>`:""}<button class="btn sm" data-act="edit">Add km</button></td></tr>`}
    ${val?`<tr><td>Cargo value</td><td class="num">${money(val)}${truck&&truck.insurance&&val>truck.insurance?` <span class="st bad">over insurance ${money(truck.insurance)}</span>`:""}</td></tr>`:""}
  </tbody></table>
  ${m.cost.km && sug.km!=null && sug.km!==m.cost.km ? `<p class="hint" style="margin:8px 0 0">Known distances add up to ${sug.km} km loaded, without the way back. <button class="btn sm" data-setkm="${sug.km}">Use ${sug.km} km</button></p>`:""}`;
}

/* ----- finance tab ----- */
let finPeriod = "month";
const PERIODS = [["month","This month"],["last30","Last 30 days"],["quarter","Last 3 months"],["year","This year"],["all","All time"]];
function inPeriod(iso){ if(!iso) return false; const T = todayISO(); return finPeriod==="all" ? true : finPeriod==="month" ? iso.slice(0,7)===T.slice(0,7) : finPeriod==="year" ? iso.slice(0,4)===T.slice(0,4) : iso >= addDays(T, finPeriod==="last30"?-30:-91) && iso <= T; }
function bar(v, max, bad){ const w = max ? Math.max(2, Math.abs(v)/max*100) : 0; return `<div style="height:8px;border-radius:4px;background:var(--soft);min-width:60px"><div style="height:8px;border-radius:4px;width:${w}%;background:${bad?"var(--bad)":"var(--em)"}"></div></div>`; }
R.finance = () => {
  const f = F(), k = costRates(""), trips = list("trips").filter(t => inPeriod(t.date) && tripOrders(t).length);
  const ms = trips.map(t => [t, tripMoney(t)]);
  const rev = sum(ms, x=>x[1].rev), cost = sum(ms.filter(x=>x[1].cost.km), x=>x[1].cost.total), km = sum(ms, x=>x[1].cost.km), cars = sum(ms, x=>x[1].os.length);
  const noKm = ms.filter(x => !x[1].cost.km).length;
  // allocate each trip's cost to its cars by share of revenue, then group
  const group = keyFn => { const g = {}; ms.forEach(([t,m]) => { if(!m.cost.km) return; m.os.forEach(o => { const r = (+o.price||0)+surchargeOf(o), share = m.rev ? r/m.rev : 1/m.os.length, key = keyFn(o,t);
      const x = g[key] = g[key]||{rev:0,cost:0,cars:0}; x.rev += r; x.cost += m.cost.total*share; x.cars++; }); }); return Object.entries(g).map(([key,x]) => Object.assign({key, margin:x.rev-x.cost}, x)).sort((a,b)=>b.margin-a.margin); };
  const tbl = (title, rows, label) => { const mx = Math.max(1, ...rows.map(r=>Math.abs(r.margin)));
    return `<div><h3 style="margin-bottom:8px">${title}</h3>${rows.length ? `<div class="tw"><table class="stack"><thead><tr><th>${label}</th><th class="num">Cars</th><th class="num">Revenue</th><th class="num">Margin</th><th class="num">%</th><th></th></tr></thead><tbody>
    ${rows.slice(0,8).map(r=>`<tr><td>${esc(r.key)}</td><td class="num">${r.cars}</td><td class="num">${money(r.rev)}</td><td class="num">${money(r.margin)}</td><td class="num">${r.rev?(r.margin/r.rev*100).toFixed(0):0}%</td><td style="width:22%">${bar(r.margin,mx,r.margin<0)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No trips with a distance in this period.</div>`}</div>`; };
  const fp = fuelPct(), hist = (f.diesel.history||[]).slice(-6).reverse();
  return `<div class="head"><div><h1>Finance</h1><p>Prices, fuel surcharge, what a kilometre costs you, and what each trip, customer and lane earns.</p></div>
    <select class="inp" id="fper" style="max-width:200px">${PERIODS.map(p=>opt(p[0],p[1],finPeriod)).join("")}</select></div>
  <section class="cover" style="grid-template-columns:minmax(0,1fr)"><div class="kpis">
    <div class="kpi"><b>${money(rev).replace(/\.00$/,"")}</b><span>Revenue · ${trips.length} trips, ${cars} cars</span></div>
    <div class="kpi"><b>${money(cost).replace(/\.00$/,"")}</b><span>Costs${noKm?` · ${noKm} trip${noKm>1?"s":""} without km`:""}</span></div>
    <div class="kpi ${rev-cost<0?"pk":""}"><b>${money(rev-cost).replace(/\.00$/,"")}</b><span>Margin · ${rev?((rev-cost)/rev*100).toFixed(0):0}%</span></div>
    <div class="kpi"><b>${km?money(rev/km):"–"}</b><span>Revenue per km · ${km.toLocaleString("en-GB")} km</span></div>
    <div class="kpi"><b>${km?money(cost/km):money(k.perKm+k.perDay/(+f.cost.kmDay||650))}</b><span>Cost per km${km?"":" (from your cost model)"}</span></div>
  </div></section>
  <div class="two sec">${tbl("By customer", group(o=>custName(o.customer)), "Customer")}${tbl("By lane", group(o=>locName(o.from)+" → "+locName(o.to)), "Lane")}</div>
  <div class="two sec">${tbl("By truck", group((o,t)=>truckName(t.truck)), "Truck")}
    <div><h3 style="margin-bottom:8px">Trips</h3>${ms.length?`<div class="tw"><table class="stack"><thead><tr><th>Trip</th><th class="num">Km</th><th class="num">Revenue</th><th class="num">Margin</th></tr></thead><tbody>
      ${ms.sort((a,b)=>(b[0].date||"").localeCompare(a[0].date||"")).slice(0,10).map(([t,m])=>`<tr class="click" data-trip="${t.id}"><td>${esc(t.name)} <span class="hint">${fDate(t.date)}</span></td><td class="num">${m.cost.km||'<span class="st warn">add</span>'}</td><td class="num">${money(m.rev)}</td><td class="num">${m.cost.km?`<span style="color:${m.margin<0?"var(--bad)":"inherit"}">${money(m.margin)}</span>`:"–"}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">No trips in this period.</div>`}</div></div>
  <p class="hint">Each trip's cost is shared over its cars by their share of the revenue.</p>

  <div class="two sec">
    <section class="card"><h2 style="margin-bottom:6px">Fuel surcharge</h2>
      <p class="hint" style="margin-top:0">The usual fuel clause: when diesel moves away from the price in your agreement, the surcharge moves with it, weighted by how much of your cost is fuel. It can go negative when diesel drops. The EU Weekly Oil Bulletin gives a weekly diesel price per country.</p>
      <div style="font-size:clamp(30px,4vw,44px);font-weight:800;line-height:1.1;color:${fp<0?"var(--bad)":"var(--em-deep)"}">${fp>0?"+":""}${fp}%</div>
      <p class="hint" style="margin:2px 0 12px">${f.manualFuel!=="" && f.manualFuel!=null ? "Fixed % set by you" : `(${money(f.diesel.current)} − ${money(f.diesel.base)}) ÷ ${money(f.diesel.base)} × ${f.diesel.share}%`}</p>
      <form id="fuelf" class="grid2">
        ${fld("Diesel price now (per litre, excl. VAT)","current",f.diesel.current,"number",'step="0.001" min="0"')}${fld("Base price in your agreements","base",f.diesel.base,"number",'step="0.001" min="0"')}
        ${fld("Fuel share of your cost (%)","share",f.diesel.share,"number",'step="1" min="0" max="100"')}${fld("Or a fixed surcharge % (leave empty to use the formula)","manual",f.manualFuel,"number",'step="0.1"')}
        <div class="span2"><button class="btn pri" type="submit">Save fuel prices</button></div></form>
      ${hist.length?`<p class="hint" style="margin:12px 0 4px">Diesel price history</p><ul class="alerts">${hist.map(h=>`<li><span>${fDate(h.date)} ${h.date.slice(0,4)}</span><b>${money(h.price)}/L</b></li>`).join("")}</ul>`:""}
    </section>
    <section class="card"><h2 style="margin-bottom:6px">Your costs</h2>
      <p class="hint" style="margin-top:0">Defaults for every truck. Fuel use and fixed costs can be set per truck under Fleet.</p>
      <form id="costf" class="grid2">
        ${fld("Fuel use (L per 100 km)","lPer100",f.cost.lPer100,"number",'step="0.5" min="0"')}${fld("Tolls (average per km)","tollKm",f.cost.tollKm,"number",'step="0.01" min="0"')}
        ${fld("Maintenance & tyres (per km)","maintKm",f.cost.maintKm,"number",'step="0.01" min="0"')}${fld("Driver cost per day (wage, allowances)","driverDay",f.cost.driverDay,"number",'step="5" min="0"')}
        ${fld("Truck fixed costs per month (lease, insurance, tax)","fixedMonth",f.cost.fixedMonth,"number",'step="50" min="0"')}${fld("Working days per month","workDays",f.cost.workDays,"number",'step="1" min="1"')}
        ${fld("Km a truck drives in a day","kmDay",f.cost.kmDay,"number",'step="10" min="1"')}${fld("Target margin (%)","target",f.target,"number",'step="1" min="0" max="90"')}
        <div class="span2"><button class="btn pri" type="submit">Save costs</button></div></form>
      <p style="margin:12px 0 0">One km costs <b>${money(k.perKm)}</b> (fuel ${money(k.fuelKm)}, tolls ${money(k.tollKm)}, maintenance ${money(k.maintKm)}), one day <b>${money(k.perDay)}</b> (driver ${money(k.driverDay)}, truck ${money(k.fixedDay)}).</p>
    </section>
  </div>

  <section class="card sec"><h2 style="margin-bottom:6px">Price calculator</h2>
    <p class="hint" style="margin-top:0">What to charge per car on a lane so it covers your costs and your target margin.</p>
    <div class="grid3">
      <label class="f">Pick up at<select id="qf">${locOpts().filter(x=>x[0]!=="__new").map(x=>opt(x[0],x[1],"")).join("")}</select></label>
      <label class="f">Deliver to<select id="qt">${locOpts().filter(x=>x[0]!=="__new").map(x=>opt(x[0],x[1],"")).join("")}</select></label>
      <label class="f">Distance (km)<input id="qkm" type="number" min="0" step="1"></label>
      <label class="f">Cars on the truck<input id="qcars" type="number" min="1" max="10" step="1" value="7"></label>
      <label class="f">Empty km back (% of the trip)<input id="qempty" type="number" min="0" max="100" step="5" value="${f.cost.emptyPct}"></label>
      <label class="f">Target margin (%)<input id="qmargin" type="number" min="0" max="90" step="1" value="${f.target}"></label>
    </div>
    <div id="qout" style="margin-top:14px"></div>
  </section>

  <section class="card sec"><h2 style="margin-bottom:6px">Distances between places</h2>
    <p class="hint" style="margin-top:0">Saved distances fill in per-km prices on orders and suggest the km on trips. They also fill in automatically when you enter km on an order.</p>
    <div class="tools"><select class="inp" id="df" style="max-width:240px">${locOpts().filter(x=>x[0]!=="__new").map(x=>opt(x[0],x[1],"")).join("")}</select><span>→</span>
      <select class="inp" id="dt" style="max-width:240px">${locOpts().filter(x=>x[0]!=="__new").map(x=>opt(x[0],x[1],"")).join("")}</select>
      <input class="inp" id="dkm" type="number" min="1" step="1" placeholder="km" style="max-width:110px"><button class="btn" id="dadd">Save distance</button></div>
    ${Object.keys(f.distances).length ? `<div class="tw"><table><thead><tr><th>From</th><th>To</th><th class="num">Km</th><th></th></tr></thead><tbody>${Object.entries(f.distances).sort((a,b)=>locName(a[0].split("|")[0]).localeCompare(locName(b[0].split("|")[0]))).map(([key,km]) => { const [a,b] = key.split("|"); return `<tr><td>${esc(locName(a))}</td><td>${esc(locName(b))}</td><td class="num">${km}</td><td class="num"><button class="btn sm" data-rmd="${esc(key)}">Remove</button></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">No distances saved yet.</div>`}
  </section>`;
};
R.after_finance = () => {
  const m = $("main");
  $("fper").onchange = e => { finPeriod = e.target.value; refresh(); };
  bindTripCards();
  $("fuelf").onsubmit = e => { e.preventDefault(); const v = formVals($("fuelf")), f = F();
    if(+v.current && +v.current!==+f.diesel.current) f.diesel.history = (f.diesel.history||[]).concat([{date:todayISO(), price:+v.current}]).slice(-52);
    f.diesel.current = +v.current||0; f.diesel.base = +v.base||0; f.diesel.share = +v.share||0; f.manualFuel = v.manual; saveFin(f); refresh(); toast("Fuel surcharge now "+fuelPct()+"%"); };
  $("costf").onsubmit = e => { e.preventDefault(); const v = formVals($("costf")), f = F(); Object.keys(v).forEach(k => { if(k==="target") f.target = +v[k]||0; else f.cost[k] = +v[k]||0; }); saveFin(f); refresh(); toast("Costs saved"); };
  const q = () => { const k = costRates(""), f = F(), km = +$("qkm").value||0, cars = Math.max(1,+$("qcars").value||1), empty = (+$("qempty").value||0)/100, mg = Math.min(90,+$("qmargin").value||0)/100;
    if(!km){ $("qout").innerHTML = `<p class="hint">Enter the distance${dist($("qf").value,$("qt").value)==null?" (none saved for these two places yet)":""}.</p>`; return; }
    const tkm = km*(1+empty), days = Math.max(1, Math.ceil(tkm/(+f.cost.kmDay||650))), total = tkm*k.perKm + days*k.perDay, perCar = total/cars, price = perCar/(1-mg);
    $("qout").innerHTML = `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="card"><span class="hint">Cost per car</span><div style="font-size:26px;font-weight:800">${money(perCar)}</div><span class="hint">${Math.round(tkm)} km incl. empty · ${days} day${days>1?"s":""} · ${money(total)} per truck</span></div>
      <div class="card" style="border-color:var(--em)"><span class="hint">Price per car at ${Math.round(mg*100)}% margin</span><div style="font-size:26px;font-weight:800;color:var(--em-deep)">${money(price)}</div><span class="hint">${money(price/km)} per loaded km per car</span></div>
      <div class="card"><span class="hint">Break-even with 1 car fewer</span><div style="font-size:26px;font-weight:800">${money(total/Math.max(1,cars-1))}</div><span class="hint">if you load ${Math.max(1,cars-1)} instead of ${cars}</span></div></div>`; };
  const fillKm = () => { const d = dist($("qf").value, $("qt").value); if(d!=null) $("qkm").value = d; q(); };
  ["qf","qt"].forEach(id => $(id).onchange = fillKm); ["qkm","qcars","qempty","qmargin"].forEach(id => $(id).oninput = q); fillKm();
  $("dadd").onclick = () => { const a = $("df").value, b = $("dt").value, km = +$("dkm").value; if(!a || !b || a===b || !(km>0)){ toast("Pick two different places and a distance"); return; } setDist(a,b,km); refresh(); toast("Distance saved"); };
  m.querySelectorAll("[data-rmd]").forEach(b => b.onclick = () => { const f = F(); delete f.distances[b.dataset.rmd]; saveFin(f); refresh(); });
};

/* ================= PDF (plain text + JPEG images, no library) ================= */
const W1252 = {"€":128,"‚":130,"„":132,"…":133,"‘":145,"’":146,"“":147,"”":148,"•":149,"–":150,"—":151,"™":153};
function pdfStr(s){ let o = ""; for(const ch of String(s??"").replace(/→/g,"->").replace(/[✓✔]/g,"OK").replace(/≥/g,">=").replace(/×/g,"x")){ const c = ch.charCodeAt(0); const b = W1252[ch] || (c<256 ? c : 63); const x = String.fromCharCode(b); o += (x==="\\"||x==="("||x===")") ? "\\"+x : x; } return o; }
function wrap(s, size, width){ const max = Math.max(8, Math.floor(width/(size*0.5))), out = []; String(s??"").split("\n").forEach(par => { let line = ""; par.split(" ").forEach(w => { if((line+" "+w).trim().length>max){ if(line) out.push(line); line = w; } else line = (line+" "+w).trim(); }); out.push(line); }); return out; }
function b64bytes(dataUrl){ const b = atob(dataUrl.split(",")[1]); const u = new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i] = b.charCodeAt(i); return u; }
function makePdf(pages){ // pages: [{items:[...]}]; items: {t:"text",x,y,s,size,bold,rgb} {t:"img",x,y,w,h,data,pw,ph} {t:"rect",x,y,w,h,fill} {t:"line",x1,y1,x2,y2}
  const enc = s => { const u = new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i] = s.charCodeAt(i)&255; return u; };
  const objs = []; const add = parts => { objs.push(parts); return objs.length; };
  const fontR = add([enc("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")]);
  const fontB = add([enc("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")]);
  const pagesId = objs.length + 1; objs.push(null);
  const kids = [];
  pages.forEach(pg => {
    const imgs = {}; let ops = [];
    pg.items.forEach((it, k) => { const Y = y => (842 - y).toFixed(1);
      if(it.t==="text") ops.push(`BT ${it.rgb||"0 0 0"} rg /${it.bold?"F2":"F1"} ${it.size||10} Tf ${it.x.toFixed(1)} ${Y(it.y)} Td (${pdfStr(it.s)}) Tj ET`);
      else if(it.t==="rect") ops.push(`${it.fill?it.fill+" rg ":""}${it.stroke||"0.75 0.75 0.75"} RG 0.6 w ${it.x} ${Y(it.y+it.h)} ${it.w} ${it.h} re ${it.fill?"B":"S"}`);
      else if(it.t==="line") ops.push(`0.7 0.7 0.7 RG 0.6 w ${it.x1} ${Y(it.y1)} m ${it.x2} ${Y(it.y2)} l S`);
      else if(it.t==="img" && it.data){ const bytes = b64bytes(it.data); const id = add([enc(`<< /Type /XObject /Subtype /Image /Width ${it.pw} /Height ${it.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`), bytes, enc("\nendstream")]);
        imgs["Im"+k] = id; ops.push(`q ${it.w} 0 0 ${it.h} ${it.x} ${Y(it.y+it.h)} cm /Im${k} Do Q`); }
    });
    const stream = ops.join("\n");
    const cId = add([enc(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)]);
    const xo = Object.keys(imgs).map(k => `/${k} ${imgs[k]} 0 R`).join(" ");
    kids.push(add([enc(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >>${xo?` /XObject << ${xo} >>`:""} >> >>`)]));
  });
  objs[pagesId-1] = [enc(`<< /Type /Pages /Kids [${kids.map(k=>k+" 0 R").join(" ")}] /Count ${kids.length} >>`)];
  const cat = add([enc(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)]);
  const parts = [enc("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")]; let off = parts[0].length; const xref = [];
  objs.forEach((o, i) => { xref.push(off); const head = enc(`${i+1} 0 obj\n`), tail = enc("\nendobj\n"); parts.push(head, ...o, tail); off += head.length + o.reduce((t,p)=>t+p.length,0) + tail.length; });
  parts.push(enc(`xref\n0 ${objs.length+1}\n0000000000 65535 f \n${xref.map(x=>String(x).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size ${objs.length+1} /Root ${cat} 0 R >>\nstartxref\n${off}\n%%EOF`));
  return new Blob(parts, {type:"application/pdf"});
}
// a simple top-to-bottom writer for A4 pages
function Doc(){ const pages = [{items:[]}]; let y = 50; const M = 48, Wd = 595-2*M;
  const d = {
    get y(){ return y; }, set y(v){ y = v; },
    need(h){ if(y+h>800){ pages.push({items:[]}); y = 50; } },
    text(s, o){ o = o||{}; const size = o.size||10, lines = wrap(s, size, o.w||Wd); lines.forEach(l => { d.need(size+4); pages[pages.length-1].items.push({t:"text", x:(o.x||M), y:y+size, s:l, size, bold:o.bold, rgb:o.rgb}); y += size+4; }); },
    gap(h){ y += h; }, rule(){ d.need(8); pages[pages.length-1].items.push({t:"line",x1:M,y1:y,x2:595-M,y2:y}); y += 8; },
    box(title, body, o){ o = o||{}; const x = o.x||M, w = o.w||Wd, lines = []; String(body||" ").split("\n").forEach(p => wrap(p, 9.5, w-14).forEach(l => lines.push(l)));
      const h = 18 + lines.length*13 + (o.img?o.ih+6:0) + 6; d.need(h); const p = pages[pages.length-1].items, top = y;
      p.push({t:"rect",x,y:top,w,h}); p.push({t:"text",x:x+7,y:top+12,s:title,size:7.5,bold:true,rgb:"0.4 0.4 0.4"});
      lines.forEach((l,i) => p.push({t:"text",x:x+7,y:top+26+i*13,s:l,size:9.5}));
      if(o.img) p.push({t:"img",x:x+7,y:top+20+lines.length*13+2,w:o.iw,h:o.ih,data:o.img,pw:1040,ph:340});
      if(!o.keepY) y += h; return h; },
    table(cols, rows){ const ws = cols.map(c=>c[1]); const row = (cells, bold, fill) => { const lines = cells.map((c,i) => wrap(c, 9, ws[i]-8)); const h = Math.max(...lines.map(l=>l.length))*12+8; d.need(h); const p = pages[pages.length-1].items; let x = M;
        if(fill) p.push({t:"rect",x:M,y,w:Wd,h,fill:"0.94 0.95 0.94",stroke:"0.94 0.95 0.94"});
        lines.forEach((ls,i) => { const right = cols[i][2]==="r"; ls.forEach((l,k) => p.push({t:"text", x: right ? x+ws[i]-6-l.length*4.6 : x+4, y:y+12+k*12, s:l, size:9, bold})); x += ws[i]; }); y += h; p.push({t:"line",x1:M,y1:y,x2:595-M,y2:y}); };
      row(cols.map(c=>c[0]), true, true); rows.forEach(r => row(r)); },
    blob(){ return makePdf(pages); }, M, Wd };
  return d; }
function saveFile(blob, name){
  const plain = () => { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u), 60000); };
  let use = null; try{ use = window.claude && typeof window.claude.use==="function" ? window.claude.use("downloads") : null; }catch(e){}
  if(!use){ plain(); return; }
  Promise.resolve(use).then(dl => { if(!dl){ plain(); return; } return dl.save({filename:name, data:blob}).catch(e => { if(e && (e.code==="declined")) return; if(e && e.code==="rate_limited"){ toast("A save prompt is already open"); return; } plain(); }); }).catch(plain);
}
const fileName = s => String(s).replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").slice(0,60) || "file";

/* ================= eCMR ================= */
function consignments(){
  const out = [];
  list("trips").forEach(t => { const groups = {};
    tripOrders(t).forEach(o => { const k = [o.customer,o.from,o.to].join("|"); (groups[k] = groups[k]||[]).push(o); });
    Object.keys(groups).sort().forEach((k, i) => { const os = groups[k], o = os[0];
      const d = new Date(t.created||Date.now()); const no = `ECMR-${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,"0")}-${t.id.slice(-4).toUpperCase()}-${i+1}`;
      const pu = get("handovers", o.hoPickup), dl = os.every(x=>x.deliveredAt) ? get("handovers", os[os.length-1].hoDelivery) : null;
      out.push({no, trip:t, orders:os, customer:o.customer, from:o.from, to:o.to, pu, dl,
        state: dl ? ["Delivered","del"] : os.some(x=>x.loadedAt) ? ["In transit","load"] : ["Draft","wait"]}); });
  });
  return out.sort((a,b) => (b.trip.date||"").localeCompare(a.trip.date||""));
}
let ecmrTab = "all";
R.ecmr = () => {
  const cs = consignments(), shown = cs.filter(c => ecmrTab==="all" || c.state[1]===ecmrTab);
  return `<div class="head"><div><h1>eCMR</h1><p>One consignment note per customer, pickup and delivery place on a trip. Filled in from orders and handovers.</p></div></div>
  <p class="note pk">From 9 July 2027 EU authorities must accept transport documents shared through certified eFTI platforms. This MVP makes the eCMR content and a PDF copy; for legal use it would hand the data to a certified eCMR provider.</p>
  <div class="tools chips">${[["all","All"],["wait","Draft"],["load","In transit"],["del","Delivered"]].map(x=>`<button class="fchip ${ecmrTab===x[0]?"on":""}" data-et="${x[0]}">${x[1]} · ${x[0]==="all"?cs.length:cs.filter(c=>c.state[1]===x[0]).length}</button>`).join("")}</div>
  ${shown.length ? `<div class="tw"><table class="stack"><thead><tr><th>Number</th><th>Customer</th><th>From → to</th><th class="num">Cars</th><th>Trip</th><th>Status</th><th></th></tr></thead><tbody>
  ${shown.map((c,i)=>`<tr class="click" data-ec="${esc(c.no)}"><td class="nowrap"><b>${esc(c.no)}</b></td><td>${esc(custName(c.customer))}</td><td>${esc(locName(c.from))} → ${esc(locName(c.to))}</td><td class="num">${c.orders.length}</td><td>${esc(c.trip.name)}</td><td><span class="st ${c.state[1]}">${c.state[0]}</span>${c.orders.some(o=>(o.dmgDelivery||[]).length>(o.dmgPickup||[]).length)?' <span class="st bad">reservation</span>':""}</td><td><button class="btn sm" data-ecpdf="${esc(c.no)}">PDF</button></td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty">No consignments yet. They appear as soon as a trip has cars.</div>`}`;
};
R.after_ecmr = () => {
  const m = $("main");
  m.querySelectorAll("[data-et]").forEach(b => b.onclick = () => { ecmrTab = b.dataset.et; refresh(); });
  m.querySelectorAll("[data-ec]").forEach(r => r.onclick = e => { if(!e.target.closest("[data-ecpdf]")) ecmrView(r.dataset.ec); });
  m.querySelectorAll("[data-ecpdf]").forEach(b => b.onclick = () => ecmrPdf(consignments().find(c => c.no===b.dataset.ecpdf)));
};
function ecmrFields(c){
  const co = S().company, cu = get("customers",c.customer)||{}, F = get("locations",c.from)||{}, T = get("locations",c.to)||{}, trk = get("trucks",c.trip.truck)||{};
  const goods = c.orders.map(o => `${o.vin}  ${shortModel(o.model)||o.modelText}${CARINFO[o.model]?"  ·  "+CARINFO[o.model].kg+" kg":""}${o.nonRunner?"  ·  non-runner":""}`).join("\n");
  const kg = sum(c.orders, o => (CARINFO[o.model]||{}).kg);
  const resP = c.orders.flatMap(o => (o.dmgPickup||[]).map(d => `${o.vin.slice(-6)}: ${zoneName(d.zone)}, ${d.type.toLowerCase()}, ${d.sev.split(" (")[0].toLowerCase()}`));
  const resD = c.orders.flatMap(o => (o.dmgDelivery||[]).filter(d => !(o.dmgPickup||[]).some(b => b.zone===d.zone && b.type===d.type)).map(d => `${o.vin.slice(-6)}: ${zoneName(d.zone)}, ${d.type.toLowerCase()}, ${d.sev.split(" (")[0].toLowerCase()} (NEW at delivery)`));
  return [
    ["1 Sender", `${cu.name||""}\n${cu.address||""}${cu.country?"\n"+cu.country:""}`],
    ["2 Consignee", `${T.name||""}\n${T.address||""}${T.country?"\n"+T.country:""}`],
    ["3 Place of delivery", `${T.name||""}${T.country?", "+T.country:""}`],
    ["4 Place and date of taking over", `${F.name||""}${F.country?", "+F.country:""}\n${c.pu?fDT(c.pu.at):"Not picked up yet"}`],
    ["5 Documents attached", c.pu && c.pu.keys ? "Vehicle papers and keys" : "–"],
    ["6–11 Goods: "+c.orders.length+" passenger car"+(c.orders.length>1?"s":"")+(kg?", about "+kg+" kg":""), goods, "w"],
    ["13 Sender's instructions", c.orders.map(o=>o.notes).filter(Boolean).join("\n") || "–"],
    ["16 Carrier", `${co.name||""}\n${co.address||""}\nTruck ${trk.plate||"–"}${trk.trailer?" · trailer "+trk.trailer:""}`],
    ["18 Carrier's reservations at pickup", resP.join("\n") || "No damage recorded", "w"],
    ["Reservations at delivery", c.dl ? (resD.join("\n") || "No new damage") : "–", "w"],
    ["21 Established in / on", `${F.name||""}, ${c.pu?fDate(new Date(c.pu.at).toISOString()):fDate(c.trip.date)}`],
    ["Reference", `${c.no} · trip ${c.trip.name}${c.orders.some(o=>o.ref)?" · refs "+c.orders.map(o=>o.ref).filter(Boolean).join(", "):""}`],
    ["22 Signature of sender", c.pu ? (c.pu.unattended?"–":c.pu.name+" · "+fDT(c.pu.at)) : "Not signed yet", "", c.pu && c.pu.sig],
    ["23 Carrier (driver)", drvName(c.trip.driver)],
    ["24 Goods received", c.dl ? (c.dl.unattended ? "Unattended delivery · "+fDT(c.dl.at)+"\nPhoto proof kept in the TMS" : c.dl.name+" · "+fDT(c.dl.at)) : "Not delivered yet", "", c.dl && c.dl.sig]
  ];
}
function ecmrView(no){
  const c = consignments().find(x => x.no===no); if(!c) return;
  const f = ecmrFields(c);
  openModal(c.no, `<p style="margin-top:-6px"><span class="st ${c.state[1]}">${c.state[0]}</span> <span class="hint">CMR consignment note content</span></p>
    <div class="cmr">${f.map(x => `<div class="${x[2]==="w"?"w":""}"><i>${esc(x[0])}</i>${esc(x[1]).replace(/\n/g,"<br>")}${x[3]?`<br><img src="${x[3]}" alt="Signature">`:""}</div>`).join("")}</div>`,
    `<a class="btn left" href="#trip-${c.trip.id}" data-close>Open trip</a><button class="btn" data-close>Close</button><button class="btn pri" id="ecdl">Download PDF</button>`,
    () => { $("ecdl").onclick = () => ecmrPdf(c); });
}
function ecmrPdf(c){
  if(!c) return; const d = Doc(), f = ecmrFields(c), half = (d.Wd-6)/2;
  d.text("CMR · Consignment note (electronic copy)", {size:16, bold:true}); d.text(c.no+" · "+c.state[0], {size:10, rgb:"0.3 0.3 0.3"}); d.gap(8);
  for(let i=0;i<f.length;i++){ const a = f[i];
    if(a[2]==="w"){ d.box(a[0], a[1]); continue; }
    const b = f[i+1] && f[i+1][2]!=="w" ? f[i+1] : null;
    if(!b){ d.box(a[0], a[1], {img:a[3], iw:150, ih:49}); continue; }
    const y0 = d.y; const ha = d.box(a[0], a[1], {w:half, keepY:true, img:a[3], iw:150, ih:49}); const y1 = d.y;
    if(y1!==y0){ d.y = y1; } // page break happened: continue on new page
    const hb = d.box(b[0], b[1], {x:d.M+half+6, w:half, keepY:true, img:b[3], iw:150, ih:49});
    d.y = y1 + Math.max(ha,hb); i++;
  }
  d.gap(6); d.text("Made with SBMF TMS. Photos of each car are kept with the handover record. Not an eFTI-certified submission.", {size:8, rgb:"0.4 0.4 0.4"});
  saveFile(d.blob(), fileName(c.no)+".pdf");
}

/* ================= invoices ================= */
R.invoices = () => {
  const ready = list("orders").filter(o => oStatus(o)==="del"), by = {};
  ready.forEach(o => (by[o.customer||""] = by[o.customer||""]||[]).push(o));
  const invs = list("invoices").sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.number||"").localeCompare(a.number||""));
  return `<div class="head"><div><h1>Invoices</h1><p>Bill each delivered car per lane, with the delivery proof listed on the invoice.</p></div></div>
  <section><h2 style="margin-bottom:10px">Ready to invoice</h2>
  ${Object.keys(by).length ? `<div class="cards">${Object.keys(by).map(cid => `<div class="card"><h3>${esc(custName(cid))}</h3><p class="hint" style="margin:4px 0 10px">${by[cid].length} car${by[cid].length>1?"s":""} delivered · ${money(sum(by[cid],o=>o.price))}</p>
    <button class="btn pri" data-mk="${cid}" style="width:100%">Make invoice</button></div>`).join("")}</div>` : `<div class="empty">Nothing waiting: every delivered car is invoiced.</div>`}</section>
  <section class="sec"><h2 style="margin-bottom:10px">All invoices</h2>
  ${invs.length ? `<div class="tw"><table class="stack"><thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
  ${invs.map(i => { const s = invState(i); return `<tr class="click" data-inv="${i.id}"><td><b>${esc(i.number)}</b></td><td>${esc(custName(i.customer))}</td><td>${fDate(i.date)}</td><td>${fDate(i.due)}</td><td class="num">${money(invTotal(i).total)}</td><td><span class="st ${s[1]}">${s[0]}</span></td></tr>`; }).join("")}
  </tbody></table></div>
  <p class="hint">Unpaid: ${money(sum(invs.filter(i=>i.sentAt&&!i.paidAt),i=>invTotal(i).total))} · paid this month: ${money(sum(invs.filter(i=>i.paidAt && i.paidAt.slice(0,7)===todayISO().slice(0,7)),i=>invTotal(i).total))}</p>` : `<div class="empty">No invoices yet.</div>`}</section>`;
};
R.after_invoices = () => {
  const m = $("main");
  m.querySelectorAll("[data-mk]").forEach(b => b.onclick = () => makeInvoice(b.dataset.mk));
  m.querySelectorAll("[data-inv]").forEach(r => r.onclick = () => invoiceForm(r.dataset.inv));
};
function makeInvoice(cid){
  const os = list("orders").filter(o => oStatus(o)==="del" && (o.customer||"")===cid), s = clone(S()), cu = get("customers",cid)||{};
  if(!os.length) return;
  const lines = os.map(o => ({order:o.id, desc:`Transport ${shortModel(o.model)||o.modelText} · VIN ${o.vin} · ${locName(o.from)} → ${locName(o.to)} · delivered ${fDate(new Date(o.deliveredAt).toISOString())}`, qty:1, price:+o.price||0}));
  if(os.some(o=>o.nonRunner)) os.filter(o=>o.nonRunner).forEach(o => lines.push({desc:`Non-runner surcharge · VIN ${o.vin}`, qty:1, price:25}));
  const fs = r2(sum(os, surchargeOf)); if(fs) lines.push({desc:fuelText(), qty:1, price:fs});
  const cross = cu.country && S().company.country && cu.country.trim().toLowerCase()!==S().company.country.trim().toLowerCase() && !!cu.vat;
  const inv = put("invoices", {number:(s.invPrefix||"INV-")+String(s.nextInv||1).padStart(4,"0"), customer:cid, date:todayISO(), due:addDays(todayISO(), +(cu.terms??s.terms??30)), lines, vatPct:+s.vat||0, reverse:cross, created:Date.now()}, true);
  s.nextInv = (+s.nextInv||1)+1; put("settings", s, true);
  os.forEach(o => { o.invoice = inv.id; put("orders", o, true); });
  refresh(); invoiceForm(inv.id);
}
function invoiceForm(id){
  const inv = clone(get("invoices",id)); if(!inv) return; const s = invState(inv);
  const draw = () => { const t = invTotal(inv);
    $("ilines").innerHTML = inv.lines.map((l,i) => `<tr><td><input class="inp" data-l="${i}|desc" value="${esc(l.desc)}" ${inv.sentAt?"disabled":""}></td><td style="width:70px"><input class="inp" type="number" step="1" data-l="${i}|qty" value="${l.qty}" ${inv.sentAt?"disabled":""}></td><td style="width:110px"><input class="inp" type="number" step="0.01" data-l="${i}|price" value="${l.price}" ${inv.sentAt?"disabled":""}></td><td class="num">${money(l.qty*l.price)}</td><td>${inv.sentAt?"":`<button class="btn sm" data-rml="${i}" aria-label="Remove line">×</button>`}</td></tr>`).join("");
    $("itot").innerHTML = `Net ${money(t.net)} · VAT ${inv.reverse?"reverse charged":inv.vatPct+"% "+money(t.vat)} · <b>Total ${money(t.total)}</b>`;
    $("ilines").querySelectorAll("[data-l]").forEach(el => el.oninput = () => { const [i,k] = el.dataset.l.split("|"); inv.lines[i][k] = k==="desc" ? el.value : +el.value||0; const tt = invTotal(inv); $("itot").innerHTML = `Net ${money(tt.net)} · VAT ${inv.reverse?"reverse charged":inv.vatPct+"% "+money(tt.vat)} · <b>Total ${money(tt.total)}</b>`; });
    $("ilines").querySelectorAll("[data-rml]").forEach(b => b.onclick = () => { inv.lines.splice(+b.dataset.rml,1); draw(); });
  };
  openModal(`Invoice ${inv.number}`, `
    <p style="margin-top:-6px"><span class="st ${s[1]}">${s[0]}</span> <span class="hint">${esc(custName(inv.customer))} · dated ${fDate(inv.date)} · due ${fDate(inv.due)}${inv.sentAt?" · sent "+fDate(inv.sentAt):""}${inv.paidAt?" · paid "+fDate(inv.paidAt):""}</span></p>
    <div class="tw"><table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th class="num">Amount</th><th></th></tr></thead><tbody id="ilines"></tbody></table></div>
    ${inv.sentAt?"":`<div class="tools" style="margin-top:8px"><select class="inp" id="iextra" style="max-width:260px">${opt("","+ Add an extra line…","")}${["Waiting time (per hour)","Non-runner surcharge","Failed pickup","Extra stop","Cleaning"].map(x=>opt(x,x,"")).join("")}</select>
      <label class="chk"><input type="checkbox" id="irev" ${inv.reverse?"checked":""}> VAT reverse charge (EU business customer in another country)</label>
      ${!inv.reverse?`<label class="f" style="flex-direction:row;align-items:center">VAT %<input id="ivat" type="number" step="0.1" value="${inv.vatPct}" style="width:80px"></label>`:""}</div>`}
    <p id="itot" style="text-align:right;font-size:17px"></p>`,
    `${!inv.sentAt?`<button class="btn danger left" id="idel">Delete draft</button>`:""}<button class="btn" id="ipdf">Download PDF</button>
     ${!inv.sentAt?`<button class="btn" id="isave">Save draft</button><button class="btn pri" id="isent">Mark as sent</button>`:!inv.paidAt?`<button class="btn pri" id="ipaid">Mark as paid</button>`:`<button class="btn" data-close>Close</button>`}`,
    () => {
      draw();
      const ex = $("iextra"); if(ex) ex.onchange = () => { if(ex.value){ inv.lines.push({desc:ex.value, qty:1, price:ex.value.startsWith("Waiting")?45:ex.value.startsWith("Non")?25:ex.value.startsWith("Failed")?90:ex.value.startsWith("Extra")?40:30}); ex.value = ""; draw(); } };
      const rv = $("irev"); if(rv) rv.onchange = () => { inv.reverse = rv.checked; put("invoices",inv,true); invoiceForm(id); };
      const vt = $("ivat"); if(vt) vt.oninput = () => { inv.vatPct = +vt.value||0; draw(); };
      const save = () => put("invoices", inv);
      if($("isave")) $("isave").onclick = () => { save(); closeModal(); toast("Draft saved"); };
      if($("isent")) $("isent").onclick = () => { inv.sentAt = todayISO(); save(); closeModal(); toast("Marked as sent"); };
      if($("ipaid")) $("ipaid").onclick = () => { inv.paidAt = todayISO(); save(); closeModal(); toast("Marked as paid"); };
      $("ipdf").onclick = () => { if(!inv.sentAt) put("invoices",inv,true); invoicePdf(inv); };
      const d = $("idel"); if(d) d.onclick = () => confirmBtn(d, "Sure? Tap again", () => { list("orders").filter(o=>o.invoice===inv.id).forEach(o => { delete o.invoice; put("orders",o,true); }); del("invoices",inv.id); closeModal(); toast("Draft deleted, cars back in Ready to invoice"); });
    });
}
function invoicePdf(inv){
  const d = Doc(), co = S().company, cu = get("customers",inv.customer)||{}, t = invTotal(inv), M = d.M;
  d.text(co.name||"Your company", {size:16, bold:true});
  d.text([co.address, co.country].filter(Boolean).join("\n"), {size:9.5}); d.text([co.vat?"VAT "+co.vat:"", co.email, co.phone].filter(Boolean).join(" · "), {size:9, rgb:"0.35 0.35 0.35"});
  d.gap(14); const y0 = d.y;
  d.text("INVOICE", {size:20, bold:true}); d.text(`Number ${inv.number}\nDate ${fDate(inv.date)} ${inv.date.slice(0,4)}\nDue ${fDate(inv.due)} ${inv.due.slice(0,4)}`, {size:10});
  const yA = d.y; d.y = y0; d.text("Bill to", {x:M+300, size:8, bold:true, rgb:"0.4 0.4 0.4"}); d.text(cu.name||"", {x:M+300, size:11, bold:true, w:200}); d.text([cu.address,cu.country,cu.vat?"VAT "+cu.vat:""].filter(Boolean).join("\n"), {x:M+300, size:9.5, w:200});
  d.y = Math.max(yA, d.y) + 14;
  d.table([["Description",300],["Qty",40,"r"],["Price",79,"r"],["Amount",80,"r"]], inv.lines.map(l => [l.desc, String(l.qty), money(l.price), money(l.qty*l.price)]));
  d.gap(8);
  [["Net", money(t.net)], [inv.reverse ? "VAT: reverse charged" : `VAT ${inv.vatPct}%`, money(t.vat)], ["Total", money(t.total)]].forEach((r,i) => { d.need(16); const yy = d.y; d.text(r[0], {x:M+300, size:i===2?12:10, bold:i===2}); d.y = yy; d.text(r[1], {x:M+420, size:i===2?12:10, bold:i===2}); });
  if(inv.reverse){ d.gap(6); d.text("VAT reverse charge: the customer accounts for VAT (Art. 196 and 44 of Directive 2006/112/EC).", {size:8.5, rgb:"0.3 0.3 0.3"}); }
  d.gap(10); d.text(`Please pay ${money(t.total)} by ${fDate(inv.due)} ${inv.due.slice(0,4)}${co.iban?" to IBAN "+co.iban:""}, quoting ${inv.number}.`, {size:10});
  const os = list("orders").filter(o => o.invoice===inv.id);
  if(os.length){ d.gap(14); d.text("Proof of delivery", {size:11, bold:true});
    d.table([["VIN",130],["Car",120],["Delivered",95],["Received by",154]], os.map(o => { const h = get("handovers",o.hoDelivery); return [o.vin, shortModel(o.model)||o.modelText||"", o.deliveredAt?fDT(o.deliveredAt):"", h?(h.unattended?"Unattended, photo proof":h.name):""]; })); }
  saveFile(d.blob(), fileName(inv.number)+".pdf");
}

/* ================= settings, backup, demo ================= */
R.settings = () => { const s = S(), c = s.company;
  return `<div class="head"><div><h1>Settings</h1><p>Your company details go on invoices and eCMRs.</p></div></div>
  <form id="setf" class="card"><h2 style="margin-bottom:12px">Company</h2><div class="grid2">
    ${fld("Company name","c.name",c.name==="Your transport company"?"":c.name)}${fld("Country","c.country",c.country)}
    <label class="f span2">Address<textarea name="c.address" style="min-height:60px">${esc(c.address||"")}</textarea></label>
    ${fld("VAT number","c.vat",c.vat)}${fld("IBAN","c.iban",c.iban)}${fld("Email","c.email",c.email,"email")}${fld("Phone","c.phone",c.phone,"tel")}</div>
    <h2 style="margin:20px 0 12px">Invoicing</h2><div class="grid3">
    ${fld("Invoice number prefix","invPrefix",s.invPrefix)}${fld("Next invoice number","nextInv",s.nextInv,"number",'min="1" step="1"')}${sel("Currency","currency",["EUR","GBP","PLN","CZK","CHF","DKK","SEK","HUF","RON"].map(x=>[x,x]),s.currency)}
    ${fld("VAT %","vat",s.vat,"number",'step="0.1" min="0"')}<p class="hint" style="align-self:end">Fuel surcharge, prices per km and costs are set under <a href="#finance">Finance</a>.</p>${fld("Default payment terms (days)","terms",s.terms,"number",'min="0" step="1"')}</div>
    <div style="margin-top:16px"><button class="btn pri" type="submit">Save settings</button></div></form>
  <section class="card sec"><h2 style="margin-bottom:8px">Where your data is kept</h2>
    <p>${mode==="db" ? "Saved online with this page, so it is the same on your phone and your laptop. Only you (and people you share the page with as editors) can change it." : "Saved in this browser only. Open the page in the Claude app to keep it online, and export a backup now and then."}</p>
    <div class="tools"><button class="btn" id="exp">Download backup (.json)</button><button class="btn" id="expc">Copy backup</button>
      <span class="btn filebtn">Restore backup<input type="file" accept=".json,application/json" id="imp" aria-label="Restore backup"></span></div>
    <p class="hint">${list("orders").length} orders · ${list("trips").length} trips · ${list("photos").length} photos · ${list("invoices").length} invoices</p></section>
  <section class="card sec"><h2 style="margin-bottom:8px">Try it out</h2><p>Load a demo company: customers, compounds and dealers, two trucks, drivers and orders in every stage, one trip ready to plan.</p>
    <div class="tools"><button class="btn dark" id="demo">Load demo data</button><button class="btn danger" id="wipe">Delete all data</button></div></section>`;
};
R.after_settings = () => {
  $("setf").onsubmit = e => { e.preventDefault(); const v = formVals($("setf")), s = clone(S());
    Object.keys(v).forEach(k => { if(k.startsWith("c.")) s.company[k.slice(2)] = v[k]; else s[k] = ["nextInv","vat","fuelPct","terms"].includes(k) ? +v[k]||0 : v[k]; });
    if(!s.company.name) s.company.name = "Your transport company"; put("settings", s); toast("Settings saved"); };
  const json = () => JSON.stringify({app:"sbmf-tms", v:1, at:new Date().toISOString(), data:D});
  $("exp").onclick = () => saveFile(new Blob([json()],{type:"application/json"}), "sbmf-tms-backup-"+todayISO()+".json");
  $("expc").onclick = () => { navigator.clipboard.writeText(json()).then(()=>toast("Backup copied: paste it into a file to keep it"), ()=>toast("Copy was blocked here: use Download")); };
  $("imp").onchange = e => { const f = e.target.files[0]; if(!f) return; f.text().then(txt => { const o = JSON.parse(txt); if(!o || !o.data) throw 0; let n = 0; COLS.forEach(c => Object.values(o.data[c]||{}).forEach(x => { put(c, x, true); n++; })); refresh(); toast(n+" records restored"); }).catch(()=>toast("That file is not a TMS backup")); };
  $("demo").onclick = loadDemo;
  $("wipe").onclick = () => confirmBtn($("wipe"), "Delete everything? Tap again", () => { COLS.forEach(c => Object.keys(D[c]).forEach(id => del(c, id, true))); refresh(); toast("All data deleted"); });
};
function demoSig(name){ const c = document.createElement("canvas"); c.width = 1040; c.height = 340; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0,0,1040,340); g.strokeStyle = "#111"; g.lineWidth = 5; g.beginPath();
  let x = 80; g.moveTo(x, 220); for(const ch of name){ const k = ch.charCodeAt(0); g.bezierCurveTo(x+20, 120+(k%7)*12, x+45, 260-(k%5)*14, x+60, 200); x += 52; } g.stroke(); return c.toDataURL("image/jpeg",0.7); }
function loadDemo(){
  const T = todayISO(), ago = n => Date.now()-n*864e5;
  const s = clone(S()); s.company = {name:"Brimbois Car Transport", address:"Via Roma 12\n46043 Castiglione delle Stiviere (MN)", country:"Italy", vat:"IT01234567890", iban:"IT60 X054 2811 1010 0000 0123 456", email:"office@example.com", phone:"+39 0376 000000"}; s.nextInv = Math.max(+s.nextInv||1, 3); s.vat = 22; put("settings", s, true);
  const C = (name, country, vat, rate, terms, address) => put("customers", {name, country, vat, rate, terms, address, email:""}, true).id;
  const weber = C("Autohaus Weber GmbH","Germany","DE123456789",0,30,"Leopoldstraße 50\n80802 München"), dupont = C("Garage Dupont SA","Belgium","BE0123456789",145,30,"Rue de Liège 8\n4000 Liège"), rossi = C("Concessionaria Rossi Srl","Italy","IT09876543210",120,60,"Viale del Lavoro 3\n37135 Verona");
  [[weber,{priceMode:"km", rateKm:0.34, minPrice:150}],[rossi,{fuelClause:false}]].forEach(([id,x]) => put("customers", Object.assign(clone(get("customers",id)), x), true));
  const L = (name, type, country, address, hours) => put("locations", {name, type, country, address, hours}, true).id;
  const zee = L("Zeebrugge port compound","Port","Belgium","Zeebrugge port, 8380 Brugge","Mon–Fri 06:00–22:00, Sat 06:00–14:00"), ant = L("Antwerp vehicle terminal","Port","Belgium","Antwerp port, 2030 Antwerpen","24/7"), mn = L("Mantova compound","Compound","Italy","Strada Cipata, 46100 Mantova","Mon–Fri 07:00–18:00");
  const wm = L("Autohaus Weber München","Dealer","Germany","Leopoldstraße 50, 80802 München","Mon–Fri 08:00–18:00, key box after hours"), wa = L("Autohaus Weber Augsburg","Dealer","Germany","Haunstetter Str. 21, 86161 Augsburg","Mon–Fri 08:00–18:00");
  const dl = L("Garage Dupont Liège","Dealer","Belgium","Rue de Liège 8, 4000 Liège","Mon–Sat 08:30–18:00"), rv = L("Concessionaria Rossi Verona","Dealer","Italy","Viale del Lavoro 3, 37135 Verona","Mon–Sat 08:30–19:00"), rb = L("Concessionaria Rossi Brescia","Dealer","Italy","Via Triumplina 40, 25123 Brescia","Mon–Sat 08:30–19:00");
  const fin = F(); fin.diesel = {base:1.48, current:1.55, share:30, history:[{date:addDays(T,-14),price:1.52},{date:addDays(T,-7),price:1.53},{date:T,price:1.55}]};
  fin.distances = {[zee+"|"+wm]:830, [zee+"|"+wa]:780, [wa+"|"+wm]:70, [ant+"|"+dl]:125, [mn+"|"+rv]:45, [mn+"|"+rb]:70, [rb+"|"+rv]:70};
  { const s2 = clone(S()); s2.fin = fin; put("settings", s2, true); }
  const dupl = clone(get("customers",dupont)); dupl.lanes = [{from:ant, to:dl, price:165}]; put("customers", dupl, true);
  const t1 = put("trucks", {plate:"GA 123 BC", trailer:"XA 456 DE", builder:"Lohr", model:"Eurolohr 200", cab:"low", profile:"eurolohr200-low", inspection:addDays(T,120), insurance:600000}, true).id;
  const t2 = put("trucks", {plate:"GB 789 FG", trailer:"XB 012 HI", builder:"Lohr", model:"Eurolohr 200", cab:"high", profile:"eurolohr200-high", inspection:addDays(T,18), insurance:500000}, true).id;
  const d1 = put("drivers", {name:"Marek Nowak", phone:"+48 600 000 000", langs:"PL, EN, DE", licence:addDays(T,900), tacho:addDays(T,400), cpc:addDays(T,700)}, true).id;
  const d2 = put("drivers", {name:"Andrei Popescu", phone:"+40 700 000 000", langs:"RO, IT, EN", licence:addDays(T,600), tacho:addDays(T,21), cpc:addDays(T,300)}, true).id;
  let n = 0; const vins = ["WVWZZZCDZMW","WVGZZZ5NZJW","WVWZZZAWZKU","WAUZZZGY0NA","TMBJJ7NX5MY","YV1LFA2BCH1","WBACV610X09","VF1RJA00X61","VF3UPHNSKL4","7SAYGDEE5PF","JTMW43FV40D","WP0ZZZ99ZNS","ZFA3120000J","WVWZZZCDZNW","YV1ZWA8UDL1","SJNFAAJ10U2"];
  const O = (model, cust, from, to, price, extra) => { const v = (vins[n%vins.length] + String(100000+n*7919).slice(-6)).slice(0,17); n++; return put("orders", Object.assign({vin:v, model, customer:cust, from, to, price, ready:addDays(T,-2), due:addDays(T,4), released:true, releasedAt:ago(2), created:ago(3)-n*1000, ref:"PO-"+(4100+n)}, extra||{}), true); };
  // trip 1: today, ready to plan (Zeebrugge -> Munich / Augsburg)
  const a = [O("Volkswagen Golf Mk8 (CD1) (2020-)",weber,zee,wm,282.2), O("Volkswagen Tiguan AD1 (2016-2024)",weber,zee,wm,282.2), O("Volkswagen Polo AW (2017-)",weber,zee,wa,265.2), O("Audi A3 Sportback 8Y (2020-)",weber,zee,wa,265.2,{value:38000}), O("Skoda Octavia Combi NX (2019-)",weber,zee,wm,282.2), O("Volvo XC90 256 (2015-)",weber,zee,wa,265.2,{value:82000}), O("BMW X5 G05 (2018-)",weber,zee,wm,282.2,{value:91000})];
  const trip1 = put("trips", {name:"Zeebrugge → München / Augsburg", date:T, truck:t1, driver:d1, route:"de", orders:a.map(o=>o.id), stops:[wa,wm], created:ago(1), km:1060, days:2}, true);
  a.forEach(o => { o.trip = trip1.id; put("orders",o,true); });
  // trip 2: on the road (Antwerp -> Liège), picked up yesterday with one scratch noted
  const b = [O("Renault Clio BF (2019-)",dupont,ant,dl,165), O("Peugeot 208 P21 (2019-)",dupont,ant,dl,165), O("Peugeot 3008 P84 (2016-2023)",dupont,ant,dl,165)];
  const trip2 = put("trips", {name:"Antwerp → Liège", date:addDays(T,-1), truck:t2, driver:d2, route:"base", orders:b.map(o=>o.id), stops:[dl], created:ago(2), km:160, days:0.5}, true);
  const h2 = put("handovers", {trip:trip2.id, kind:"pickup", loc:ant, orders:b.map(o=>o.id), at:ago(1), name:"J. Peeters", sig:demoSig("JPeeters"), keys:true, driver:d2, truck:t2, checks:{}}, true);
  b.forEach((o,i) => { o.trip = trip2.id; o.loadedAt = ago(1); o.hoPickup = h2.id; o.dmgPickup = i===2 ? [{zone:"rb", type:"Scratch", sev:"Small (under 2 cm)"}] : []; put("orders",o,true); });
  // trip 3: completed (Mantova -> Verona / Brescia), not invoiced yet
  const c = [O("Fiat 500 312 (2007-2024)",rossi,mn,rv,120), O("Toyota Yaris XP210 (2020-)",rossi,mn,rv,120), O("Alfa Romeo Stelvio 949 (2017-)",rossi,mn,rb,130), O("Ford Puma J2K (2019-)",rossi,mn,rb,120)];
  const trip3 = put("trips", {name:"Mantova → Verona / Brescia", date:addDays(T,-3), truck:t1, driver:d1, route:"base", orders:c.map(o=>o.id), stops:[rb,rv], created:ago(4), km:160, days:0.5, tolls:21.4}, true);
  const h3 = put("handovers", {trip:trip3.id, kind:"pickup", loc:mn, orders:c.map(o=>o.id), at:ago(3), name:"L. Bianchi", sig:demoSig("LBianchi"), keys:true, driver:d1, truck:t1, checks:{}}, true);
  const h4 = put("handovers", {trip:trip3.id, kind:"delivery", loc:rb, orders:[c[2].id,c[3].id], at:ago(3)+3*36e5, name:"M. Ferri", sig:demoSig("MFerri"), keys:true, driver:d1, truck:t1, checks:{}}, true);
  const h5 = put("handovers", {trip:trip3.id, kind:"delivery", loc:rv, orders:[c[0].id,c[1].id], at:ago(3)+5*36e5, name:"", unattended:true, keys:true, notes:"Keys in the dealer's key box", driver:d1, truck:t1, checks:{}}, true);
  c.forEach((o,i) => { o.trip = trip3.id; o.loadedAt = ago(3); o.hoPickup = h3.id; o.dmgPickup = []; o.deliveredAt = i<2 ? ago(3)+5*36e5 : ago(3)+3*36e5; o.hoDelivery = i<2 ? h5.id : h4.id; o.dmgDelivery = []; put("orders",o,true); });
  // older invoiced cars: one invoice overdue, one paid
  const old = [O("Tesla Model Y Pre-facelift (2020-2025)",dupont,ant,dl,150,{loadedAt:ago(42), deliveredAt:ago(41)}), O("Toyota RAV4 XA50 (2018-2025)",dupont,ant,dl,150,{loadedAt:ago(42), deliveredAt:ago(41)})];
  const inv1 = put("invoices", {number:"INV-0001", customer:dupont, date:addDays(T,-40), due:addDays(T,-10), sentAt:addDays(T,-40), vatPct:21, reverse:true, created:ago(40), lines:old.map(o=>({order:o.id, desc:`Transport ${shortModel(o.model)} · VIN ${o.vin} · Antwerp vehicle terminal → Garage Dupont Liège`, qty:1, price:150}))}, true);
  old.forEach(o => { o.invoice = inv1.id; put("orders",o,true); });
  const old2 = O("Mercedes-Benz GLC X254 (2022-)",weber,zee,wm,210,{loadedAt:ago(25), deliveredAt:ago(24)});
  const inv2 = put("invoices", {number:"INV-0002", customer:weber, date:addDays(T,-23), due:addDays(T,7), sentAt:addDays(T,-23), paidAt:addDays(T,-2), vatPct:21, reverse:true, created:ago(23), lines:[{order:old2.id, desc:`Transport ${shortModel(old2.model)} · VIN ${old2.vin} · Zeebrugge port compound → Autohaus Weber München`, qty:1, price:210}]}, true);
  old2.invoice = inv2.id; put("orders",old2,true);
  // waiting: released and not released
  O("Tesla Model Y Pre-facelift (2020-2025)",weber,zee,wa,265.2); O("Toyota RAV4 XA50 (2018-2025)",dupont,ant,dl,165);
  O("Porsche 911 992 (2019-)",weber,zee,wm,260,{released:false, releasedAt:null, value:145000, notes:"Very low car: R6 only"}); O("Kia Sportage NQ5 (2021-)",rossi,mn,rv,120,{released:false, releasedAt:null});
  dbEmpty = false; refresh(); toast("Demo data loaded");
}

/* ================= start ================= */
parseHash(); startStore(); refresh(true);
})();
