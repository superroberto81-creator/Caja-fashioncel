// Caja de Bolsillo — punto de venta multiusuario con tickets impresos por Bluetooth.
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  runTransaction, writeBatch, serverTimestamp, getDocs, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { ThermalPrinter, bluetoothSupport, escpos, rawbtUrl } from "./printer.js";
import { formHTML, leerForm, validar, limpiarRFC, nombreRegimen, nombreUso, FORMA_PAGO, formaDe, claveForma, interpretarSheet,
  formatoListo, respuestasContador, linkContador, enviarContador, leerFormato, CAMPOS_CONTADOR } from "./fiscal.js";

/* ================= utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const money = n => fmt.format(Math.round((+n || 0) * 100) / 100);
const r2 = n => Math.round((+n || 0) * 100) / 100;
const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const pad = (n, w = 5) => String(n).padStart(w, "0");
const hoyStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
const fechaLarga = iso => { const d = new Date(iso); return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); };
const diaLargo = s => new Date(s + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const LS = {
  get(k, d) { try { const v = localStorage.getItem("caja:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("caja:" + k, JSON.stringify(v)); } catch (e) {} },
};
const isAndroid = /Android/i.test(navigator.userAgent);
const ERR = e => {
  const c = e && (e.code || "");
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Correo o contraseña incorrectos.";
  if (c.includes("email-already-in-use")) return "Ese correo ya tiene una cuenta.";
  if (c.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (c.includes("invalid-email")) return "El correo no es válido.";
  if (c.includes("too-many-requests")) return "Demasiados intentos. Espera unos minutos.";
  if (c.includes("network") || c.includes("unavailable")) return "Sin conexión a internet. Revisa tu señal e intenta de nuevo.";
  if (c.includes("permission-denied")) return "No tienes permiso para hacer esto.";
  return (e && e.message) || "Ocurrió un error.";
};

/* ================= Firebase ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PEGA_AQUI");
let app, auth, db;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  const useEmu = location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");
  db = initializeFirestore(app, useEmu ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (useEmu) { connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "localhost", 8080); }
}

/* ================= estado ================= */
const DEFAULT_CONFIG = { nombre: "Mi Negocio", direccion: "", telefono: "", rfc: "", pie: "¡Gracias por su compra!", iva: "incluido", cupon: "FASHION10" };
const S = {
  screen: "loading", tab: "vender",
  user: null, perfil: null,
  config: { ...DEFAULT_CONFIG }, productos: [], ticketsDia: [], usuarios: [],
  dia: hoyStr(), buscar: "",
  cart: [], descuento: "", facturas: [], facFiltro: "pendiente", facBuscar: "", formato: null,
  online: navigator.onLine,
  prn: { ancho: 32, acentos: true, auto: true, corte: false, copias: 1, ...LS.get("printer", {}) },
};
const unsubs = [];
const printer = new ThermalPrinter();
printer.onchange = () => renderHeader();
const isAdmin = () => S.perfil && S.perfil.rol === "admin";

/* ================= ticket: líneas (pantalla, impresora, texto) ================= */
function wrap(s, w) {
  const out = []; let line = "";
  String(s).split(/\s+/).forEach(word => {
    while (word.length > w) { if (line) { out.push(line); line = ""; } out.push(word.slice(0, w)); word = word.slice(w); }
    if (!word) return;
    if ((line + " " + word).trim().length > w) { out.push(line); line = word; } else line = (line ? line + " " : "") + word;
  });
  if (line) out.push(line);
  return out;
}
function lr(a, b, W) { a = String(a); b = String(b); const sp = W - a.length - b.length; return sp >= 1 ? a + " ".repeat(sp) + b : a.slice(0, Math.max(0, W - b.length - 1)) + " " + b; }

function calc(items, descuento, ivaMode) {
  const sub = r2(items.reduce((a, i) => a + i.cant * i.precio, 0));
  const desc = Math.min(r2(num(descuento)), sub);
  const base = r2(sub - desc);
  let iva = 0, total = base;
  if (ivaMode === "incluido") iva = r2(base - base / 1.16);
  else if (ivaMode === "agregar") { iva = r2(base * 0.16); total = r2(base + iva); }
  return { sub, desc, base, iva, total };
}

function ticketLines(t, cfg, W = S.prn.ancho) {
  const L = [], add = (text, o = {}) => L.push({ text, ...o }), HR = "-".repeat(W);
  add(cfg.nombre || "Mi Negocio", { logo: true, center: true, bold: true });
  if (cfg.direccion) wrap(cfg.direccion, W).forEach(s => add(s, { center: true }));
  if (cfg.telefono) add("Tel. " + cfg.telefono, { center: true });
  if (cfg.rfc) add("RFC " + cfg.rfc, { center: true });
  add(HR);
  add("Folio: " + pad(t.folio), { bold: true });
  add("Fecha: " + fechaLarga(t.fechaLocal));
  if (t.vendedorNombre) wrap("Atendió: " + t.vendedorNombre, W).forEach(s => add(s));
  if (t.cliente) wrap("Cliente: " + t.cliente, W).forEach(s => add(s));
  if (t.estado === "cancelado") { add("=".repeat(W)); add("*** CANCELADO ***", { center: true, bold: true }); add("=".repeat(W)); }
  add(HR);
  add(lr("CANT DESCRIPCION", "IMPORTE", W), { bold: true });
  t.items.forEach(i => {
    wrap(i.nombre, W - 5).forEach((s, k) => add(k === 0 ? String(i.cant).padEnd(4) + " " + s : "     " + s));
    add(lr("     @ " + money(i.precio), money(i.cant * i.precio), W));
  });
  add(HR);
  const c = t.calc;
  add(lr("Artículos:", String(t.items.reduce((a, i) => a + i.cant, 0)), W));
  add(lr("Subtotal:", money(c.sub), W));
  if (c.desc > 0) add(lr("Descuento:", "-" + money(c.desc), W));
  if (t.ivaMode === "agregar") add(lr("IVA 16%:", money(c.iva), W));
  add(lr("TOTAL:", money(c.total), W), { bold: true });
  if (t.ivaMode === "incluido") add(lr("IVA incluido (16%):", money(c.iva), W));
  add(HR);
  add(lr("Pago:", t.metodo, W));
  if (t.metodo === "Tarjeta" && t.autorizacion) add(lr("Autorización:", t.autorizacion, W));
  if (t.metodo === "Efectivo" && t.recibido > 0) { add(lr("Recibido:", money(t.recibido), W)); add(lr("Cambio:", money(t.cambio), W), { bold: true }); }
  add("");
  if (cfg.pie) wrap(cfg.pie, W).forEach(s => add(s, { center: true }));
  add("");
  wrap("También puedes comprar en", W).forEach(s => add(s, { center: true }));
  add("fashioncel.com.mx", { center: true, bold: true });
  if (cfg.cupon) {
    // Cortes de línea a mano para que en 58 mm se lea en frases completas.
    const antes = W < 40 ? ["Usa este cupón en tu primera", "compra en línea y recibe 10%:"] : wrap("Usa este cupón en tu primera compra en línea y recibe 10%:", W);
    const despues = W < 40 ? ["Válido solo en fashioncel.com.mx", "No aplica en tienda física"] : wrap("Válido solo en fashioncel.com.mx. No aplica en tienda física.", W);
    antes.forEach(s => add(s, { center: true }));
    add(cfg.cupon, { center: true, bold: true, big: cfg.cupon.length <= Math.floor(W / 2) - 1 });
    despues.forEach(s => add(s, { center: true }));
  } else {
    wrap("Recibe 10% de descuento en tu primera compra", W).forEach(s => add(s, { center: true }));
  }
  add("");
  wrap("Esto no es un comprobante fiscal", W).forEach(s => add(s, { center: true }));
  return L;
}

function corteLines(dia, tickets, cfg, W = S.prn.ancho) {
  const L = [], add = (text, o = {}) => L.push({ text, ...o }), HR = "-".repeat(W);
  const ok = tickets.filter(t => t.estado !== "cancelado");
  const sum = arr => r2(arr.reduce((a, t) => a + t.calc.total, 0));
  wrap(cfg.nombre || "Mi Negocio", Math.floor(W / 2)).forEach(s => add(s, { center: true, bold: true, big: true }));
  add("CORTE DEL DIA", { center: true, bold: true });
  add(dia, { center: true });
  add("Impreso: " + fechaLarga(new Date().toISOString()));
  add(HR);
  add(lr("Tickets pagados:", String(ok.length), W));
  add(lr("Tickets cancelados:", String(tickets.length - ok.length), W));
  if (ok.length) add(lr("Folios:", pad(Math.min(...tickets.map(t => t.folio))) + "-" + pad(Math.max(...tickets.map(t => t.folio))), W));
  add(HR);
  ["Efectivo", "Tarjeta", "Transferencia"].forEach(m => add(lr(m + ":", money(sum(ok.filter(t => t.metodo === m))), W)));
  add(lr("TOTAL VENDIDO:", money(sum(ok)), W), { bold: true });
  add(HR);
  add("POR VENDEDOR", { bold: true });
  const porV = {};
  ok.forEach(t => { const k = t.vendedorNombre || "—"; porV[k] = porV[k] || { n: 0, tot: 0 }; porV[k].n++; porV[k].tot += t.calc.total; });
  Object.entries(porV).sort((a, b) => b[1].tot - a[1].tot).forEach(([k, v]) => add(lr(`${k.slice(0, W - 16)} (${v.n})`, money(v.tot), W)));
  add("");
  return L;
}

const linesHTML = L => L.map(l => l.logo ? `<div class="l c logo"><img src="logo.png" alt="${esc(l.text)}" style="width:${Math.round(S.prn.ancho * 0.75)}ch"></div>` : `<div class="l${l.center ? " c" : ""}${l.bold ? " b" : ""}${l.big ? " g" : ""}">${esc(l.text) || " "}</div>`).join("");
const linesText = L => L.map(l => l.text).join("\n");

/* ================= impresión ================= */
// Logo convertido a puntos blanco/negro para la impresora (se calcula una vez por ancho de papel).
const logoImg = new Image();
const logoReady = new Promise(res => { logoImg.onload = () => res(true); logoImg.onerror = () => res(false); });
logoImg.src = "logo.png";
const logoCache = {};
async function logoRaster() {
  const dots = S.prn.ancho >= 48 ? 576 : 384;          // 80 mm = 576 puntos, 58 mm = 384
  if (logoCache[dots] !== undefined) return logoCache[dots];
  if (!(await logoReady)) return (logoCache[dots] = null);
  const w = Math.floor(dots * 0.8 / 8) * 8;              // 80% del ancho, múltiplo de 8
  const h = Math.round(logoImg.naturalHeight * w / logoImg.naturalWidth);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(logoImg, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data, bw = w / 8, data = new Uint8Array(bw * h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const k = (y * w + i) * 4, lum = 0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2];
    if (lum < 150) data[y * bw + (i >> 3)] |= 0x80 >> (i & 7);
  }
  return (logoCache[dots] = { bw, h, data });
}
async function toBytes(L, feed) {
  const logo = L.some(l => l.logo) ? await logoRaster() : null;
  return escpos(L, { accents: S.prn.acentos, cut: S.prn.corte, feed, logo });
}
async function rawbt(L) { location.href = rawbtUrl(await toBytes(L)); }
async function printLines(L, { silent = false } = {}) {
  try {
    const bytes = await toBytes(L, 4);
    if (!printer.connected && !printer.device) await printer.connect();
    for (let i = 0; i < Math.max(1, S.prn.copias | 0); i++) await printer.write(bytes);
    if (!silent) toast("Enviado a " + printer.name);
    return true;
  } catch (e) {
    if (e && e.name === "NotFoundError") return false; // el usuario cerró la lista de dispositivos
    toast("No se pudo imprimir: " + (e.message || e));
    return false;
  } finally { renderHeader(); }
}
function systemPrint(L) {
  $("#printArea").innerHTML = `<div class="receipt">${linesHTML(L)}</div>`;
  setTimeout(() => window.print(), 50);
}

/* ================= UI común ================= */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
async function copyText(txt) { try { await navigator.clipboard.writeText(txt); toast("Ticket copiado"); } catch (e) { toast("No se pudo copiar"); } }
function closeSheet() { const sh = $("#sheet"); sh.hidden = true; sh.innerHTML = ""; }
function openSheet(html) {
  const sh = $("#sheet");
  sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  sh.hidden = false;
  sh.onclick = e => { if (e.target === sh) closeSheet(); };
  const c = $("[data-close]", sh); if (c) c.onclick = closeSheet;
}

const ICONS = {
  vender: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  tickets: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  productos: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  equipo: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  facturas: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};
const TAB_NAMES = { vender: "Vender", tickets: "Tickets", productos: "Productos", equipo: "Equipo", facturas: "Facturas", ajustes: "Ajustes" };
const tabsFor = () => isAdmin() ? ["vender", "tickets", "facturas", "productos", "equipo", "ajustes"] : ["vender", "tickets", "ajustes"];

function renderTabs() {
  const nav = $("#tabs");
  if (S.screen !== "main") { nav.hidden = true; return; }
  nav.hidden = false;
  nav.innerHTML = tabsFor().map(t => `<button data-tab="${t}" aria-current="${S.tab === t ? "page" : "false"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[t]}</svg>${TAB_NAMES[t]}${t === "facturas" && S.facturas.some(f => f.estado === "pendiente") ? `<span class="tab-badge">${S.facturas.filter(f => f.estado === "pendiente").length}</span>` : ""}</button>`).join("");
  $$("button", nav).forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); scrollTo(0, 0); });
}

function renderHeader() {
  const h = $("#hdr"); if (!h) return;
  const p = $("#prnPill");
  if (printer.connected) { p.className = "pill ok"; p.innerHTML = `<span class="dot"></span>${esc(printer.name).slice(0, 14)}`; }
  else if (printer.device) { p.className = "pill warn"; p.innerHTML = `<span class="dot"></span>Reconectar`; }
  else { p.className = "pill"; p.innerHTML = `<span class="dot"></span>Sin impresora`; }
  const o = $("#netPill"); o.hidden = S.online;
}

/* ================= pantallas ================= */
function render() {
  document.documentElement.style.setProperty("--cols", S.prn.ancho);
  const a = $("#app");
  a.classList.toggle("solo", S.screen !== "main");
  if (S.screen === "noconfig") a.innerHTML = viewNoConfig();
  else if (S.screen === "loading") a.innerHTML = `<p class="empty">Cargando…</p>`;
  else if (S.screen === "setup") { a.innerHTML = viewSetup(); bindSetup(); }
  else if (S.screen === "login") { a.innerHTML = viewLogin(); bindLogin(); }
  else if (S.screen === "noaccess") { a.innerHTML = viewNoAccess(); $("#out").onclick = () => signOut(auth); }
  else {
    a.innerHTML = `
      <header class="top" id="hdr">
        <div class="brandbox"><img class="hdr-logo" src="logo.png" alt="${esc(S.config.nombre)}"><div class="biz"><b>${TAB_NAMES[S.tab]}</b> · ${esc(S.perfil.nombre)}</div></div>
        <div class="row" style="justify-content:flex-end">
          <span class="pill bad" id="netPill" hidden>Sin internet</span>
          <button class="pill" id="prnPill" aria-label="Impresora"></button>
        </div>
      </header>
      <main id="view"></main>`;
    $("#prnPill").onclick = openPrinterSheet;
    const v = $("#view");
    ({ vender: viewVender, tickets: viewTickets, productos: viewProductos, equipo: viewEquipo, facturas: viewFacturas, ajustes: viewAjustes })[S.tab](v);
    renderHeader();
  }
  renderTabs();
}

function viewNoConfig() {
  return `<div class="auth stack"><img class="brand-logo" src="logo.png" alt="Fashioncel"><p class="brand">Caja de Bolsillo</p>
  <div class="notice">Falta conectar Firebase. Abre el archivo <b>firebase-config.js</b> y pega los datos de tu proyecto, como explica la guía (paso 3).</div></div>`;
}

function viewSetup() {
  return `<div class="auth stack">
    <div><img class="brand-logo" src="logo.png" alt="Fashioncel"><p class="brand">Caja de Bolsillo</p><p class="note" style="margin:0">Primera vez: crea la cuenta del administrador (dueño). Después podrás dar de alta a tus empleados.</p></div>
    <form class="card stack" id="setupForm" autocomplete="on">
      <label class="f">Nombre del negocio<input id="sNeg" required value="Mi Negocio"></label>
      <label class="f">Tu nombre<input id="sNom" required autocomplete="name"></label>
      <label class="f">Correo<input id="sMail" type="email" required autocomplete="email"></label>
      <label class="f">Contraseña (mínimo 6)<input id="sPass" type="password" minlength="6" required autocomplete="new-password"></label>
      <div class="err" id="sErr"></div>
      <button class="btn-primary" type="submit">Crear administrador</button>
    </form>
    <button class="btn-ghost" id="toLogin">Ya tengo cuenta</button>
  </div>`;
}
function bindSetup() {
  $("#toLogin").onclick = () => { S.screen = "login"; render(); };
  $("#setupForm").onsubmit = async e => {
    e.preventDefault();
    const btn = $("#setupForm button"); btn.disabled = true; $("#sErr").textContent = "";
    try {
      settingUp = true;
      let cred;
      try { cred = await createUserWithEmailAndPassword(auth, $("#sMail").value.trim(), $("#sPass").value); }
      catch (err) { if (String(err.code).includes("email-already-in-use")) cred = await signInWithEmailAndPassword(auth, $("#sMail").value.trim(), $("#sPass").value); else throw err; }
      const uid = cred.user.uid;
      const b = writeBatch(db);
      b.set(doc(db, "sistema", "init"), { creadoPor: uid, creadoEn: serverTimestamp() });
      b.set(doc(db, "usuarios", uid), { nombre: $("#sNom").value.trim(), email: cred.user.email, rol: "admin", activo: true, creadoEn: serverTimestamp() });
      await b.commit();
      await setDoc(doc(db, "config", "negocio"), { ...DEFAULT_CONFIG, nombre: $("#sNeg").value.trim() || "Mi Negocio" });
      settingUp = false;
      await startSession(cred.user);
    } catch (err) {
      settingUp = false;
      $("#sErr").textContent = String(err.code).includes("permission-denied") ? "El sistema ya tiene administrador. Inicia sesión." : ERR(err);
      btn.disabled = false;
    }
  };
}

function viewLogin() {
  return `<div class="auth stack">
    <div><img class="brand-logo" src="logo.png" alt="Fashioncel"><p class="brand">Caja de Bolsillo</p><p class="note" style="margin:0">Entra con el correo y contraseña que te dio el administrador.</p></div>
    <form class="card stack" id="loginForm" autocomplete="on">
      <label class="f">Correo<input id="lMail" type="email" required autocomplete="username"></label>
      <label class="f">Contraseña<input id="lPass" type="password" required autocomplete="current-password"></label>
      <div class="err" id="lErr"></div>
      <button class="btn-primary" type="submit">Entrar</button>
    </form>
    <button class="btn-ghost" id="forgot">Olvidé mi contraseña</button>
  </div>`;
}
function bindLogin() {
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); const btn = $("#loginForm button"); btn.disabled = true; $("#lErr").textContent = "";
    try { await signInWithEmailAndPassword(auth, $("#lMail").value.trim(), $("#lPass").value); }
    catch (err) { $("#lErr").textContent = ERR(err); btn.disabled = false; }
  };
  $("#forgot").onclick = async () => {
    const m = $("#lMail").value.trim();
    if (!m) { $("#lErr").textContent = "Escribe tu correo arriba y vuelve a tocar “Olvidé mi contraseña”."; return; }
    try { await sendPasswordResetEmail(auth, m); toast("Te enviamos un correo para cambiar la contraseña"); } catch (err) { $("#lErr").textContent = ERR(err); }
  };
}

function viewNoAccess() {
  return `<div class="auth stack"><img class="brand-logo" src="logo.png" alt="Fashioncel"><p class="brand">Caja de Bolsillo</p>
  <div class="notice">Tu cuenta no está activa en este negocio. Pide al administrador que te dé acceso.</div>
  <button id="out">Cerrar sesión</button></div>`;
}

/* ---------- Vender ---------- */
function viewVender(v) {
  const c = calc(S.cart, S.descuento, S.config.iva);
  const prods = S.productos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const q = S.buscar.trim().toLowerCase();
  const shown = q ? prods.filter(p => p.nombre.toLowerCase().includes(q)) : prods;
  const piezas = S.cart.reduce((a, i) => a + i.cant, 0);
  v.innerHTML = `
  <div class="sell${S.cart.length ? " has-cart" : ""}">
    <section class="sell-pick" aria-label="Productos">
      ${prods.length > 6 ? `<input id="pBuscar" type="search" placeholder="Buscar producto" value="${esc(S.buscar)}" aria-label="Buscar producto">` : ""}
      ${shown.length ? `<div class="chips">${shown.map(p => {
        const n = (S.cart.find(i => i.pid === p.id) || {}).cant || 0;
        return `<button class="chip${n ? " on" : ""}" data-add="${esc(p.id)}"><span class="n">${esc(p.nombre)}</span><small>${money(p.precio)}</small>${n ? `<span class="badge">${n}</span>` : ""}</button>`;
      }).join("")}</div>`
        : `<div class="card empty">${prods.length ? "Ningún producto coincide." : (isAdmin() ? "Agrega tus productos en la pestaña Productos, o usa un artículo libre." : "Aún no hay productos. Usa un artículo libre.")}</div>`}
      <h2>Artículo libre</h2>
      <form class="row nowrap" id="freeForm" autocomplete="off">
        <input id="freeName" class="grow" placeholder="Descripción" aria-label="Descripción">
        <input id="freePrice" inputmode="decimal" placeholder="$ Precio" aria-label="Precio" style="width:104px">
        <button class="btn-primary" type="submit" aria-label="Agregar">+</button>
      </form>
    </section>
    <section class="sell-cart" aria-label="Venta actual">
      <div class="cart-head"><h2>Venta actual</h2>${S.cart.length ? `<button class="link" id="vaciar">Vaciar</button>` : ""}</div>
      <div class="card">
        ${S.cart.length ? S.cart.map((i, k) => `
          <div class="line">
            <div><div class="nm">${esc(i.nombre)}</div><div class="sub">${i.cant} × ${money(i.precio)}</div></div>
            <div class="amt">${money(i.cant * i.precio)}</div>
            <div class="qty"><button data-dec="${k}" aria-label="Quitar uno">−</button><span class="q">${i.cant}</span><button data-inc="${k}" aria-label="Agregar uno">+</button><button class="rm" data-rm="${k}">Quitar</button></div>
          </div>`).join("") : `<div class="empty">Toca un producto para empezar.</div>`}
        <div class="desc-row"><label for="descuento">Descuento $</label><input id="descuento" inputmode="decimal" value="${esc(S.descuento)}" placeholder="0.00"></div>
        <div class="totals" id="totals">${totalsHTML(c)}</div>
      </div>
      <div class="paybar${S.cart.length ? " float" : ""}"><button class="btn-primary" id="cobrar" ${S.cart.length ? "" : "disabled"}>
        <span class="pb-l">Cobrar${piezas ? `<small>${piezas} artículo${piezas === 1 ? "" : "s"}</small>` : ""}</span><span class="pb-amt" id="pbAmt">${money(c.total)}</span>
      </button></div>
    </section>
  </div>`;

  const bs = $("#pBuscar");
  if (bs) bs.oninput = e => { S.buscar = e.target.value; const p = e.target.selectionStart; render(); const n = $("#pBuscar"); n.focus(); try { n.setSelectionRange(p, p); } catch (_) {} };
  $$("[data-add]", v).forEach(b => b.onclick = () => {
    const p = S.productos.find(x => x.id === b.dataset.add); if (!p) return;
    const ex = S.cart.find(i => i.pid === p.id && i.precio === p.precio);
    if (ex) ex.cant++; else S.cart.push({ pid: p.id, nombre: p.nombre, precio: p.precio, cant: 1 });
    render();
  });
  $$("[data-inc]", v).forEach(b => b.onclick = () => { S.cart[+b.dataset.inc].cant++; render(); });
  $$("[data-dec]", v).forEach(b => b.onclick = () => { const k = +b.dataset.dec; if (--S.cart[k].cant <= 0) S.cart.splice(k, 1); render(); });
  $$("[data-rm]", v).forEach(b => b.onclick = () => { S.cart.splice(+b.dataset.rm, 1); render(); });
  const vc = $("#vaciar"); if (vc) vc.onclick = () => {
    if (vc.dataset.armed) { S.cart = []; S.descuento = ""; render(); return; }
    vc.dataset.armed = "1"; vc.textContent = "¿Vaciar todo?"; setTimeout(() => { if (vc.isConnected) { delete vc.dataset.armed; vc.textContent = "Vaciar"; } }, 3000);
  };
  $("#freeForm").onsubmit = e => {
    e.preventDefault();
    const n = $("#freeName").value.trim(), p = num($("#freePrice").value);
    if (!n || p <= 0) { toast("Escribe descripción y precio"); return; }
    S.cart.push({ pid: null, nombre: n, precio: r2(p), cant: 1 }); render();
  };
  $("#descuento").oninput = e => {
    S.descuento = e.target.value;
    const c2 = calc(S.cart, S.descuento, S.config.iva);
    $("#totals").innerHTML = totalsHTML(c2); $("#pbAmt").textContent = money(c2.total);
  };
  $("#cobrar").onclick = openCobro;
}
function totalsHTML(c) {
  return `<div class="r"><span>Subtotal</span><span>${money(c.sub)}</span></div>
    ${c.desc > 0 ? `<div class="r"><span>Descuento</span><span>-${money(c.desc)}</span></div>` : ""}
    ${S.config.iva === "agregar" ? `<div class="r"><span>IVA 16%</span><span>${money(c.iva)}</span></div>` : ""}
    ${S.config.iva === "incluido" ? `<div class="r note"><span>IVA incluido</span><span>${money(c.iva)}</span></div>` : ""}
    <div class="r grand"><span>Total</span><span>${money(c.total)}</span></div>`;
}

/* ---------- Pantalla de cobro ---------- */
const nuevoCobro = () => ({ metodo: "Efectivo", recibido: "", auth: "", cliente: "", tel: "", email: "" });
S.cobro = nuevoCobro();
function billetes(total) {
  // Montos rápidos: exacto y los billetes/redondeos más cercanos por arriba del total.
  const out = [], add = v => { v = r2(v); if (v > total && !out.includes(v)) out.push(v); };
  [20, 50, 100, 200, 500, 1000].forEach(m => add(Math.ceil(total / m) * m));
  return out.sort((a, b) => a - b).slice(0, 5);
}
function openCobro() {
  if (!S.cart.length) return;
  const c = calc(S.cart, S.descuento, S.config.iva), k = S.cobro;
  openSheet(`
    <div class="row between" style="margin-bottom:6px">
      <strong class="sheet-title">Cobrar</strong>
      <button class="btn-ghost" data-close>Volver</button>
    </div>
    <div class="bigtotal"><span class="lbl">Total a cobrar</span><span class="amt">${money(c.total)}</span></div>
    <div class="seg" role="group" aria-label="Forma de pago">${["Efectivo", "Tarjeta", "Transferencia"].map(m => `<button type="button" data-met="${m}" aria-pressed="${k.metodo === m}">${m}</button>`).join("")}</div>
    <div id="payBox" class="stack" style="margin-top:14px"></div>
    <details class="cliente" ${k.cliente || k.tel || k.email ? "open" : ""}>
      <summary>Cliente y envío del ticket <span class="note">(opcional)</span></summary>
      <div class="stack" style="margin-top:10px">
        <label class="f">Nombre<input id="kCli" value="${esc(k.cliente)}" placeholder="Público en general" autocomplete="off"></label>
        <div class="grid2">
          <label class="f">WhatsApp<input id="kTel" type="tel" inputmode="tel" value="${esc(k.tel)}" placeholder="10 dígitos" autocomplete="off"></label>
          <label class="f">Correo<input id="kMail" type="email" value="${esc(k.email)}" placeholder="cliente@correo.com" autocomplete="off"></label>
        </div>
      </div>
    </details>
    <button class="btn-primary confirm-btn" id="kOk">Confirmar cobro · ${money(c.total)}</button>`);
  const pay = () => {
    const box = $("#payBox");
    if (k.metodo === "Efectivo") {
      box.innerHTML = `
        <label class="f">Recibido $<input id="kRec" inputmode="decimal" value="${esc(k.recibido)}" placeholder="${c.total.toFixed(2)}"></label>
        <div class="quick">${[c.total, ...billetes(c.total)].map((v, i) => `<button type="button" data-q="${v}">${i === 0 ? "Exacto" : money(v).replace(".00", "")}</button>`).join("")}</div>
        <div class="bigchange" id="kCh"></div>`;
      const upd = () => {
        const rc = num(k.recibido), ch = r2(rc - c.total), el = $("#kCh");
        if (!rc) { el.className = "bigchange"; el.innerHTML = `<span class="lbl">Cambio</span><span class="amt">—</span>`; return; }
        el.className = "bigchange " + (ch < 0 ? "neg" : "ok");
        el.innerHTML = ch < 0 ? `<span class="lbl">Faltan</span><span class="amt">${money(-ch)}</span>` : `<span class="lbl">Cambio</span><span class="amt">${money(ch)}</span>`;
      };
      $("#kRec").oninput = e => { k.recibido = e.target.value; upd(); };
      $$("[data-q]", box).forEach(b => b.onclick = () => { k.recibido = String(b.dataset.q); $("#kRec").value = k.recibido; upd(); });
      upd();
    } else if (k.metodo === "Tarjeta") {
      box.innerHTML = `<label class="f">Número de autorización del voucher <span class="note">(opcional)</span><input id="kAuth" inputmode="numeric" value="${esc(k.auth)}" placeholder="Ej. 123456" autocomplete="off"></label>
        <p class="note" style="margin:0">Cobra ${money(c.total)} en la terminal y, cuando salga aprobado, confirma aquí.</p>`;
      $("#kAuth").oninput = e => (k.auth = e.target.value.trim());
    } else {
      box.innerHTML = `<p class="note" style="margin:0">Confirma cuando veas la transferencia de ${money(c.total)} reflejada.</p>`;
    }
  };
  $$("[data-met]").forEach(b => b.onclick = () => { k.metodo = b.dataset.met; $$("[data-met]").forEach(x => x.setAttribute("aria-pressed", x === b)); pay(); });
  $("#kCli").oninput = e => (k.cliente = e.target.value);
  $("#kTel").oninput = e => (k.tel = e.target.value);
  $("#kMail").oninput = e => (k.email = e.target.value.trim());
  $("#kOk").onclick = cobrar;
  pay();
}

const token = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map(b => "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[b % 62]).join(""); };
const ticketUrl = tk => location.origin + "/t/" + tk;
const soloDigitos = s => String(s || "").replace(/\D/g, "");
const waNumber = s => { const d = soloDigitos(s); return d.length === 10 ? "52" + d : d; };
function publicDoc(t) {
  return { folio: t.folio, fechaLocal: t.fechaLocal, dia: t.dia || "", metodo: t.metodo || "", total: t.calc.total, negocio: S.config.nombre || "", estado: t.estado,
    lineas: ticketLines(t, S.config, 32).map(l => ({ text: l.text, ...(l.center ? { center: true } : {}), ...(l.bold ? { bold: true } : {}), ...(l.logo ? { logo: true } : {}), ...(l.big ? { big: true } : {}) })), cupon: S.config.cupon || "" };
}

let cobrando = false;
async function cobrar() {
  if (!S.cart.length || cobrando) return;
  const k = S.cobro, c = calc(S.cart, S.descuento, S.config.iva);
  const recibido = k.metodo === "Efectivo" ? (num(k.recibido) || c.total) : 0;
  if (k.metodo === "Efectivo" && recibido < c.total) { toast("El efectivo recibido no cubre el total"); return; }
  if (k.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k.email)) { toast("Revisa el correo del cliente"); return; }
  if (k.tel && soloDigitos(k.tel).length < 10) { toast("El WhatsApp debe tener 10 dígitos"); return; }
  if (!navigator.onLine) { toast("Sin internet: se necesita conexión para asignar el folio."); return; }
  cobrando = true; const btn = $("#kOk"); btn.disabled = true; btn.textContent = "Guardando…";
  const now = new Date(), tk = token();
  const base = {
    fecha: serverTimestamp(), fechaLocal: now.toISOString(), dia: hoyStr(now),
    vendedorUid: S.user.uid, vendedorNombre: S.perfil.nombre,
    cliente: k.cliente.trim(), items: S.cart.map(i => ({ nombre: i.nombre, cant: i.cant, precio: i.precio })),
    ivaMode: S.config.iva, calc: c, metodo: k.metodo,
    recibido: r2(recibido), cambio: k.metodo === "Efectivo" ? r2(recibido - c.total) : 0, estado: "pagado",
    autorizacion: k.metodo === "Tarjeta" ? k.auth : "", contacto: { tel: soloDigitos(k.tel), email: k.email }, linkToken: tk,
  };
  try {
    const folio = await runTransaction(db, async tx => {
      const cref = doc(db, "contadores", "folio");
      const cs = await tx.get(cref);
      const n = cs.exists() ? cs.data().ultimo + 1 : 1;
      tx.set(doc(db, "tickets", String(n)), { ...base, folio: n });
      tx.set(doc(db, "publicos", tk), publicDoc({ ...base, folio: n }));
      tx.set(cref, { ultimo: n });
      return n;
    });
    const t = { ...base, folio, id: String(folio) };
    S.cart = []; S.descuento = ""; S.cobro = nuevoCobro();
    render();
    openTicket(t, true);
    if (S.prn.auto && printer.device) printLines(ticketLines(t, S.config), { silent: false });
  } catch (e) {
    toast("No se guardó la venta: " + ERR(e));
    btn.disabled = false; btn.textContent = "Confirmar cobro · " + money(c.total);
  } finally { cobrando = false; }
}

/* ---------- Ticket (hoja inferior) ---------- */
const linkCache = {};
async function ensureLink(t) {
  if (t.linkToken) return t.linkToken;
  if (linkCache[t.id]) return linkCache[t.id];
  const tk = token();
  await setDoc(doc(db, "publicos", tk), publicDoc(t));
  return (linkCache[t.id] = tk);
}
function mensajeCliente(t, url) {
  const hola = t.cliente ? `Hola ${t.cliente.split(" ")[0]}, gracias` : "Gracias";
  return `${hola} por tu compra en ${S.config.nombre}.\n\nTu ticket #${pad(t.folio)} por ${money(t.calc.total)}:\n${url}\n\nTambién puedes comprar en fashioncel.com.mx y recibe 10% de descuento en tu primera compra${S.config.cupon ? ` con el cupón ${S.config.cupon} (válido solo en la tienda en línea, no aplica en tienda física)` : ""}.`;
}
function openTicket(t, justCreated) {
  const L = ticketLines(t, S.config);
  const bt = bluetoothSupport();
  const ct = t.contacto || {};
  openSheet(`
    <div class="row between" style="margin-bottom:12px">
      <strong class="sheet-title">${justCreated ? "Venta registrada · #" + pad(t.folio) : "Ticket #" + pad(t.folio)}</strong>
      <button class="btn-ghost" data-close>Cerrar</button>
    </div>
    ${justCreated && t.metodo === "Efectivo" && t.cambio > 0 ? `<div class="bigchange ok" style="margin-bottom:14px"><span class="lbl">Entrega de cambio</span><span class="amt">${money(t.cambio)}</span></div>` : ""}
    <div class="ticket-grid">
      <div class="receipt">${linesHTML(L)}</div>
      <div>
        <div class="card stack send">
          <strong>Enviar al cliente</strong>
          <div class="grid2">
            <label class="f">WhatsApp<input id="sTel" type="tel" inputmode="tel" value="${esc(ct.tel || "")}" placeholder="10 dígitos" autocomplete="off"></label>
            <label class="f">Correo<input id="sMail" type="email" value="${esc(ct.email || "")}" placeholder="cliente@correo.com" autocomplete="off"></label>
          </div>
          <div class="grid2">
            <button id="sWa" class="btn-wa">WhatsApp</button>
            <button id="sEm">Correo</button>
          </div>
          <button id="sLink" class="btn-ghost small">Copiar link del ticket</button>
        </div>
        <div class="actions">
          ${bt.ok ? `<button class="btn-primary full" id="tPrint">${printer.device ? "Imprimir" : "Conectar impresora e imprimir"}</button>` : ""}
          ${isAndroid ? `<button class="${bt.ok ? "" : "btn-primary "}full" id="tRaw">Imprimir con RawBT</button>` : ""}
          <button id="tSys">Imprimir (sistema)</button>
          <button id="tFac">Factura</button>
          ${justCreated ? `<button class="full btn-dark" data-close2>Nueva venta</button>` : ""}
          ${!justCreated && isAdmin() && t.estado !== "cancelado" ? `<button class="btn-danger full" id="tCancel">Cancelar ticket</button><div id="cancelBox" class="full"></div>` : ""}
        </div>
        ${!bt.ok && !isAndroid ? `<p class="note" style="margin-top:12px">${esc(bt.reason)}</p>` : ""}
      </div>
    </div>`);
  const p = $("#tPrint"); if (p) p.onclick = async () => { await printLines(L); p.textContent = "Imprimir"; };
  const r = $("#tRaw"); if (r) r.onclick = () => rawbt(L);
  $("#tFac").onclick = () => openFactura(t);
  $("#tSys").onclick = () => systemPrint(L);
  const withLink = async (fn, onErr) => { try { fn(ticketUrl(await ensureLink(t))); } catch (e) { if (onErr) onErr(); toast("No se pudo crear el link: " + ERR(e)); } };
  // Se abre la ventana en el mismo toque (antes de esperar a la red) para que el navegador no la bloquee.
  $("#sWa").onclick = () => {
    const tel = $("#sTel").value; if (tel && soloDigitos(tel).length < 10) { toast("El WhatsApp debe tener 10 dígitos"); return; }
    const w = window.open("", "_blank");
    withLink(url => { const href = `https://wa.me/${waNumber(tel)}?text=${encodeURIComponent(mensajeCliente(t, url))}`; if (w) w.location.href = href; else location.href = href; }, () => w && w.close());
  };
  $("#sEm").onclick = () => {
    const em = $("#sMail").value.trim(); if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast("Revisa el correo"); return; }
    withLink(url => { location.href = `mailto:${encodeURIComponent(em)}?subject=${encodeURIComponent(`Tu ticket de ${S.config.nombre} #${pad(t.folio)}`)}&body=${encodeURIComponent(mensajeCliente(t, url))}`; });
  };
  $("#sLink").onclick = () => withLink(async url => { try { await navigator.clipboard.writeText(url); toast("Link copiado"); } catch (e) { toast(url); } });
  const n = $("[data-close2]"); if (n) n.onclick = closeSheet;
  const cc = $("#tCancel");
  if (cc) cc.onclick = () => {
    cc.hidden = true;
    $("#cancelBox").innerHTML = `<div class="confirm">Cancelar el ticket #${pad(t.folio)}. Queda en el historial marcado como cancelado.
      <input id="cMot" placeholder="Motivo (opcional)" style="color:var(--ink)">
      <div class="row"><button class="btn-danger grow" id="cYes">Sí, cancelar</button><button class="grow" id="cNo">No</button></div></div>`;
    $("#cNo").onclick = () => { $("#cancelBox").innerHTML = ""; cc.hidden = false; };
    $("#cYes").onclick = async () => {
      try {
        const upd = { estado: "cancelado", canceladoPor: S.perfil.nombre, canceladoEn: new Date().toISOString(), motivo: $("#cMot").value.trim() };
        await updateDoc(doc(db, "tickets", t.id), upd);
        const tk = t.linkToken || linkCache[t.id];
        if (tk) updateDoc(doc(db, "publicos", tk), { estado: "cancelado", canceladoEn: upd.canceladoEn }).catch(() => {});
        toast("Ticket cancelado"); closeSheet();
      } catch (e) { toast(ERR(e)); }
    };
  };
}

/* ---------- Facturas ---------- */
const ESTADO_FAC = { pendiente: "Pendiente", facturada: "Facturada" };
async function autocompletarRFC(root) {
  const rfc = limpiarRFC($("#fRfc", root).value);
  if (rfc.length < 12) return;
  try {
    const s = await getDoc(doc(db, "clientesFiscales", rfc));
    if (!s.exists()) return;
    const c = s.data();
    const set = (id, v) => { const el = $("#" + id, root); if (el && v && !el.value.trim()) el.value = v; };
    set("fRazon", c.razonSocial); set("fCp", c.cp); set("fMail", c.email); set("fCel", c.celular);
    if (c.regimen && !$("#fReg", root).value) $("#fReg", root).value = c.regimen;
    if (c.usoCfdi) $("#fUso", root).value = c.usoCfdi;
    toast("Datos de " + c.razonSocial + " cargados");
  } catch (e) {}
}
// Ficha del cliente para autollenar la próxima vez (solo se guardan los campos que traen dato).
const fichaCliente = d => {
  const o = { rfc: d.rfc };
  ["razonSocial", "cp", "regimen", "usoCfdi", "email", "celular"].forEach(k => { if (d[k]) o[k] = d[k]; });
  return o;
};
async function guardarClienteFiscal(d) {
  if (!d.rfc || d.rfc.length < 12 || /[\/.]/.test(d.rfc)) return;
  try { await setDoc(doc(db, "clientesFiscales", d.rfc), { ...fichaCliente(d), actualizado: serverTimestamp() }, { merge: true }); } catch (e) {}
}
const txtRegimen = f => f.regimen ? `${f.regimen} ${nombreRegimen(f.regimen)}` : f.regimenTxt || "";
const txtUso = f => f.usoCfdi ? `${f.usoCfdi} ${nombreUso(f.usoCfdi)}` : f.usoTxt || "";
const txtForma = f => { const n = formaDe(f), c = claveForma(n); return c ? `${c} ${n}` : (FORMA_PAGO[n] || n); };
// Fecha en que se pidió la factura (la que aparece en la primera columna de la hoja).
function fechaSolicitud(f) {
  const c = f.creadoEn;
  const d = f.origen === "sheet" && f.fechaVenta ? new Date(f.fechaVenta)
    : c && c.toDate ? c.toDate() : c && c.__ts ? new Date(c.__ts) : f.fechaVenta ? new Date(f.fechaVenta) : null;
  return d && !isNaN(d) ? d : null;
}
const fechaHoja = d => d ? `${pad(d.getDate(), 2)}/${pad(d.getMonth() + 1, 2)}/${d.getFullYear()} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}` : "";
/* Formato del contador: cada solicitud se envía al formulario de Google "Facturación Electrónica". */
const contadorListo = () => formatoListo(S.formato);
const contadorAuto = () => contadorListo() && S.formato.auto !== false;
// Envía y deja anotado en la solicitud cuándo se mandó. Devuelve "" o el motivo por el que no salió.
async function mandarAlContador(id, f) {
  const msg = await enviarContador(S.formato, f);
  if (msg) return msg;
  try { await updateDoc(doc(db, "facturas", id), { contador: new Date().toISOString() }); } catch (e) { return "Se envió al contador, pero no se pudo anotar aquí."; }
  return "";
}
const txtContador = f => !f.contador ? "Sin enviar" : f.contador === "hoja" ? "Enviada con el formulario anterior" : "Enviada · " + fechaLarga(f.contador);
function datosTexto(f) {
  return [`RFC: ${f.rfc}`, `Razón social: ${f.razonSocial}`, `C.P. fiscal: ${f.cp}`, `Régimen: ${txtRegimen(f)}`,
    `Uso CFDI: ${txtUso(f)}`, `Forma de pago: ${txtForma(f)}`, `Monto: ${money(f.total)}`, `Celular: ${f.celular || ""}`, `Correo: ${f.email}`,
    f.folio ? `Ticket: #${pad(f.folio)}` : "Registro importado del Sheet",
    `Fecha de venta: ${f.fechaVenta ? fechaLarga(f.fechaVenta) : ""}`].join("\n");
}
async function openFactura(t) {
  openSheet(`<div class="row between" style="margin-bottom:12px"><strong class="sheet-title">Factura · ticket #${pad(t.folio)}</strong><button class="btn-ghost" data-close>Volver</button></div><p class="empty">Cargando…</p>`);
  let tk, f = null;
  try { tk = await ensureLink(t); const s = await getDoc(doc(db, "facturas", tk)); if (s.exists()) f = s.data(); }
  catch (e) { toast(ERR(e)); closeSheet(); return; }
  const editable = !f || f.estado === "pendiente";
  openSheet(`
    <div class="row between" style="margin-bottom:12px"><strong class="sheet-title">Factura · ticket #${pad(t.folio)}</strong><button class="btn-ghost" data-close>Volver</button></div>
    ${f ? `<div class="notice ${f.estado === "facturada" ? "ok" : ""}" style="margin-bottom:12px">${f.estado === "facturada" ? "Ya se facturó" + (f.folioFiscal ? ` · folio fiscal ${esc(f.folioFiscal)}` : "") : `Solicitud pendiente${f.origen === "cliente" ? " (la llenó el cliente)" : ""}`}</div>` : ""}
    <p class="note" style="margin:0 0 10px">Ticket por ${money(t.calc.total)} · ${esc(t.metodo)} · ${fechaLarga(t.fechaLocal)}</p>
    ${editable ? `<form id="facForm" class="stack card" autocomplete="off">
      ${formHTML(f || { celular: (t.contacto && t.contacto.tel) || "", email: (t.contacto && t.contacto.email) || "" }, t.metodo)}
      <p class="note" style="margin:0">Escribe el RFC: si el cliente ya facturó antes, sus datos se llenan solos.</p>
      <div class="err" id="fErr"></div>
      <button class="btn-primary" type="submit">${f ? "Guardar cambios" : "Registrar solicitud"}</button>
    </form>` : `<pre class="datos">${esc(datosTexto(f))}</pre>`}`);
  if (!editable) return;
  const form = $("#facForm");
  form.addEventListener("input", () => { $("#fErr").textContent = ""; });
  $("#fRfc", form).addEventListener("change", () => autocompletarRFC(form));
  $("#fRfc", form).addEventListener("input", e => { if (limpiarRFC(e.target.value).length >= 12) autocompletarRFC(form); });
  form.onsubmit = async e => {
    e.preventDefault();
    const d = leerForm(form), msg = validar(d);
    if (msg) { $("#fErr").textContent = msg; return; }
    const btn = $("button[type=submit]", form); btn.disabled = true;
    try {
      const base = { ...d, folio: t.folio, total: t.calc.total, metodo: t.metodo, fechaVenta: t.fechaLocal, dia: t.dia, estado: "pendiente" };
      if (f) await updateDoc(doc(db, "facturas", tk), { ...d, actualizado: serverTimestamp() });
      else await setDoc(doc(db, "facturas", tk), { ...base, origen: "caja", capturo: S.perfil.nombre, creadoEn: serverTimestamp() });
      await guardarClienteFiscal(d);
      let aviso = f ? "Solicitud actualizada" : "Solicitud de factura registrada";
      if (contadorAuto() && !(f && f.contador)) {
        const m = await mandarAlContador(tk, { ...(f || {}), ...base });
        aviso = m ? `${aviso}. ${m}` : `${aviso} y enviada al contador`;
      } else if (f && f.contador) aviso += ". Ya se había enviado al contador: avísale del cambio";
      toast(aviso); closeSheet();
    } catch (err) { $("#fErr").textContent = ERR(err); btn.disabled = false; }
  };
}

function viewFacturas(v) {
  const q = S.facBuscar.trim().toUpperCase();
  let list = S.facturas;
  if (S.facFiltro !== "todas") list = list.filter(f => f.estado === S.facFiltro);
  if (q) list = list.filter(f => (f.rfc || "").includes(q) || (f.razonSocial || "").toUpperCase().includes(q) || (f.celular || "").includes(q) || (f.folio && String(f.folio).includes(q.replace(/^0+/, ""))));
  const pend = S.facturas.filter(f => f.estado === "pendiente").length;
  v.innerHTML = `
  <div class="seg" role="group" aria-label="Filtro">${[["pendiente", `Pendientes (${pend})`], ["facturada", "Facturadas"], ["todas", "Todas"]].map(([k, l]) => `<button type="button" data-ff="${k}" aria-pressed="${S.facFiltro === k}">${l}</button>`).join("")}</div>
  <div class="row nowrap" style="margin-top:10px">
    <input id="facBuscar" type="search" class="grow" placeholder="Buscar RFC, nombre, celular o folio" value="${esc(S.facBuscar)}" aria-label="Buscar">
    <button id="facCsv" ${S.facturas.length ? "" : "disabled"}>Excel</button>
  </div>
  <h2>${list.length} solicitud${list.length === 1 ? "" : "es"}</h2>
  ${list.length ? `<div class="tlist">${list.map(f => `
    <div class="card fac" data-fid="${esc(f.id)}">
      <div class="row between"><strong>${esc(f.razonSocial)}</strong><span class="tag ${f.estado === "facturada" ? "done" : ""}">${ESTADO_FAC[f.estado] || f.estado}</span></div>
      <div class="fac-grid">
        <span class="k">RFC</span><span class="mono">${esc(f.rfc)}</span>
        <span class="k">${f.folio ? "Ticket" : "Monto"}</span><span>${f.folio ? `#${pad(f.folio)} · ` : ""}${money(f.total)}${formaDe(f) ? " · " + esc(formaDe(f)) : ""}</span>
        <span class="k">C.P. / Régimen</span><span>${esc(f.cp)} · ${esc(txtRegimen(f))}</span>
        <span class="k">Uso CFDI</span><span>${esc(txtUso(f))}</span>
        <span class="k">Correo</span><span>${esc(f.email)}</span>
        ${f.celular ? `<span class="k">Celular</span><span>${esc(f.celular)}</span>` : ""}
        <span class="k">Solicitó</span><span>${f.origen === "sheet" ? "Importada del Sheet" + (fechaSolicitud(f) ? " · " + esc(fechaSolicitud(f).toLocaleDateString("es-MX")) : "") : (f.origen === "cliente" ? "El cliente, desde su ticket" : "En caja" + (f.capturo ? " · " + esc(f.capturo) : "")) + (f.fechaVenta ? " · venta del " + esc(new Date(f.fechaVenta).toLocaleDateString("es-MX")) : "")}</span>
        ${contadorListo() || f.contador ? `<span class="k">Contador</span><span>${esc(txtContador(f))}${contadorListo() ? ` · <a data-form style="color:inherit" href="${esc(linkContador(S.formato, f))}" target="_blank" rel="noopener">abrir formulario lleno</a>` : ""}</span>` : ""}
        ${f.folioFiscal ? `<span class="k">Folio fiscal</span><span class="mono">${esc(f.folioFiscal)}</span>` : ""}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
        <button data-copy class="grow">Copiar datos</button>
        ${f.folio ? `<button data-ver class="grow">Ver ticket</button>` : ""}
        ${contadorListo() && !f.contador && f.estado === "pendiente" ? `<button data-cont class="grow">Enviar al contador</button>` : ""}
        ${f.estado === "pendiente" ? `<button data-done class="btn-primary grow">Marcar facturada</button>` : `<button data-undo class="btn-ghost grow">Regresar a pendiente</button>`}
      </div>
      <div data-box></div>
    </div>`).join("")}</div>` : `<div class="card empty">${S.facFiltro === "pendiente" ? "No hay solicitudes pendientes." : "No hay solicitudes."}</div>`}
  <p class="note">Los clientes piden factura desde el link de su ticket, o el empleado la registra en la caja desde el ticket → <b>Factura</b>. El botón <b>Excel</b> descarga todo con las mismas columnas de tu hoja de facturación.</p>
  <button id="facImp" class="btn-ghost" style="width:100%">Importar base de datos del Sheet</button>`;
  $$("[data-ff]", v).forEach(b => b.onclick = () => { S.facFiltro = b.dataset.ff; render(); });
  $("#facBuscar").oninput = e => { S.facBuscar = e.target.value; const p = e.target.selectionStart; render(); const n = $("#facBuscar"); n.focus(); try { n.setSelectionRange(p, p); } catch (_) {} };
  $("#facCsv").onclick = exportFacturas;
  $("#facImp").onclick = openImportar;
  $$(".fac", v).forEach(card => {
    const f = S.facturas.find(x => x.id === card.dataset.fid); if (!f) return;
    $("[data-copy]", card).onclick = async () => { try { await navigator.clipboard.writeText(datosTexto(f)); toast("Datos copiados"); } catch (e) { toast("No se pudo copiar"); } };
    const ver = $("[data-ver]", card);
    if (ver) ver.onclick = async () => {
      try { const s = await getDoc(doc(db, "tickets", String(f.folio))); if (s.exists()) openTicket({ id: s.id, ...s.data() }, false); else toast("No se encontró el ticket"); } catch (e) { toast(ERR(e)); }
    };
    const cont = $("[data-cont]", card);
    if (cont) cont.onclick = async () => { cont.disabled = true; cont.textContent = "Enviando…"; const m = await mandarAlContador(f.id, f); toast(m || "Enviada al contador"); if (m) { cont.disabled = false; cont.textContent = "Enviar al contador"; } };
    const done = $("[data-done]", card);
    if (done) done.onclick = () => {
      $("[data-box]", card).innerHTML = `<div class="stack" style="margin-top:10px"><label class="f">Folio fiscal (UUID) <span class="hint">(opcional)</span><input data-uuid placeholder="Ej. 6F9A1C2B-…" autocomplete="off"></label><button data-ok class="btn-primary">Confirmar: ya se facturó</button></div>`;
      $("[data-ok]", card).onclick = async () => {
        try {
          await updateDoc(doc(db, "facturas", f.id), { estado: "facturada", folioFiscal: $("[data-uuid]", card).value.trim().toUpperCase(), facturadaPor: S.perfil.nombre, facturadaEn: new Date().toISOString() });
          await guardarClienteFiscal(f); toast("Marcada como facturada");
        } catch (e) { toast(ERR(e)); }
      };
    };
    const undo = $("[data-undo]", card);
    if (undo) undo.onclick = async () => { try { await updateDoc(doc(db, "facturas", f.id), { estado: "pendiente" }); toast("Regresó a pendientes"); } catch (e) { toast(ERR(e)); } };
  });
}
// Mismas columnas y orden que la pestaña "Respuestas" del Sheet de facturación (A–J); lo que agrega la caja va al final.
const COLS_HOJA = ["Fecha", "RFC", "Nombre", "RegimenFiscal", "CP", "UsoCFDI", "FormaPago", "Monto", "Celular", "Correo", "Ticket", "Estado", "FolioFiscal", "Contador"];
const filaHoja = f => [fechaHoja(fechaSolicitud(f)), f.rfc, f.razonSocial, nombreRegimen(f.regimen) || f.regimenTxt || "", f.cp, nombreUso(f.usoCfdi) || f.usoTxt || "",
  formaDe(f), f.total, f.celular || "", f.email, f.folio ? pad(f.folio) : "", ESTADO_FAC[f.estado] || f.estado, f.folioFiscal || "", txtContador(f)];
function exportFacturas() {
  const t = f => { const d = fechaSolicitud(f); return d ? d.getTime() : 0; };
  const rows = [COLS_HOJA, ...S.facturas.slice().sort((a, b) => t(a) - t(b)).map(filaHoja)];
  const csv = "﻿" + rows.map(r => r.map(x => '"' + String(x ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `facturas_${hoyStr()}.csv`; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Importar la base de datos del Sheet ---------- */
const hashId = s => { let a = 2166136261, b = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 33) ^ c) | 0; } return (a >>> 0).toString(36) + (b >>> 0).toString(36); };
function openImportar() {
  let filas = [], estado = "facturada";
  openSheet(`
    <div class="row between" style="margin-bottom:12px"><strong class="sheet-title">Importar del Sheet</strong><button class="btn-ghost" data-close>Volver</button></div>
    <div class="stack">
      <p class="note" style="margin:0">Trae a la caja lo que ya tienes en tu hoja de facturación: el historial queda en esta pestaña y los clientes se autollenan al escribir su RFC.</p>
      <ol class="note" style="margin:0;padding-left:20px">
        <li>Abre tu Google Sheet, pestaña <b>Respuestas</b>.</li>
        <li>Selecciona todas las filas, con encabezados, y cópialas.</li>
        <li>Pégalas aquí abajo. También puedes subir el archivo .csv de la hoja.</li>
      </ol>
      <label class="f">Filas de la hoja<textarea id="impTxt" rows="5" spellcheck="false" autocomplete="off" placeholder="Pega aquí las filas copiadas"></textarea></label>
      <label class="f">O sube el archivo<input id="impFile" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label>
      <div id="impPrev"></div>
    </div>`);
  const prev = $("#impPrev");
  const pinta = () => {
    const r = interpretarSheet($("#impTxt").value); filas = r.filas;
    if (!$("#impTxt").value.trim()) { prev.innerHTML = ""; return; }
    if (!filas.length) { prev.innerHTML = `<div class="notice">${esc(r.error || "No encontré filas con RFC. Copia también la fila de encabezados.")}</div>`; return; }
    const clientes = new Set(filas.filter(f => f.rfcOk).map(f => f.rfc)).size;
    const conAviso = filas.filter(f => f.avisos.length);
    prev.innerHTML = `<div class="stack">
      <div class="notice ok">${filas.length} fila${filas.length === 1 ? "" : "s"} · ${clientes} cliente${clientes === 1 ? "" : "s"} distinto${clientes === 1 ? "" : "s"} · ${money(filas.reduce((a, f) => a + f.total, 0))}</div>
      <div class="tlist">${filas.slice(0, 3).map(f => `<div class="card fac"><strong>${esc(f.razonSocial)}</strong><div class="fac-grid">
        <span class="k">RFC</span><span class="mono">${esc(f.rfc)}</span>
        <span class="k">Fecha</span><span>${esc(fechaHoja(f.fecha) || f.fechaTxt)}</span>
        <span class="k">Régimen</span><span>${esc(f.regimen ? f.regimen + " " + nombreRegimen(f.regimen) : f.regimenTxt)}</span>
        <span class="k">Uso CFDI</span><span>${esc(f.usoCfdi ? f.usoCfdi + " " + nombreUso(f.usoCfdi) : f.usoTxt)}</span>
        <span class="k">Pago</span><span>${money(f.total)} · ${esc(f.formaPago)}</span>
        <span class="k">Contacto</span><span>${esc(f.celular)} · ${esc(f.email)}</span></div></div>`).join("")}</div>
      ${filas.length > 3 ? `<p class="note" style="margin:0">Se muestran las primeras 3 para que revises que cada dato cayó en su lugar.</p>` : ""}
      ${conAviso.length ? `<div class="notice">Revisa ${conAviso.length === 1 ? "esta fila" : "estas filas"} (se importa${conAviso.length === 1 ? "" : "n"} igual, tal como está${conAviso.length === 1 ? "" : "n"} en la hoja):<br>${conAviso.slice(0, 8).map(f => `Fila ${f.n}: ${esc(f.avisos.join(", "))}`).join("<br>")}${conAviso.length > 8 ? `<br>…y ${conAviso.length - 8} más` : ""}</div>` : ""}
      <div><div class="note" style="margin:0 0 6px">Estas facturas de la hoja…</div>
        <div class="seg" style="grid-template-columns:1fr 1fr" role="group" aria-label="Estado de las importadas">
          <button type="button" data-ie="facturada" aria-pressed="${estado === "facturada"}">Ya se facturaron</button>
          <button type="button" data-ie="pendiente" aria-pressed="${estado === "pendiente"}">Siguen pendientes</button></div></div>
      <div class="err" id="impErr"></div>
      <button class="btn-primary" id="impOk">Importar ${filas.length} fila${filas.length === 1 ? "" : "s"}</button></div>`;
    $$("[data-ie]", prev).forEach(b => b.onclick = () => { estado = b.dataset.ie; $$("[data-ie]", prev).forEach(x => x.setAttribute("aria-pressed", x === b)); });
    $("#impOk").onclick = () => importar(filas, estado);
  };
  $("#impTxt").oninput = pinta;
  $("#impFile").onchange = async e => { const file = e.target.files[0]; if (!file) return; $("#impTxt").value = await file.text(); pinta(); };
}
async function importar(filas, estado) {
  const btn = $("#impOk"), err = $("#impErr"); btn.disabled = true; btn.textContent = "Importando…"; err.textContent = "";
  // Un cliente por RFC: se queda con los datos de su fila más reciente.
  const clientes = new Map();
  filas.filter(f => f.rfcOk).slice().sort((a, b) => (a.fecha ? a.fecha.getTime() : 0) - (b.fecha ? b.fecha.getTime() : 0)).forEach(f => clientes.set(f.rfc, { ...(clientes.get(f.rfc) || {}), ...fichaCliente(f) }));
  const ops = [];
  filas.forEach(f => {
    const fecha = f.fecha || new Date();
    // El id sale de la propia fila: volver a importar la misma hoja no duplica nada.
    const id = "sheet" + hashId([f.fechaTxt, f.rfc, f.total, f.razonSocial].join("|"));
    const d = { rfc: f.rfc, razonSocial: f.razonSocial, cp: f.cp, email: f.email, regimen: f.regimen, usoCfdi: f.usoCfdi, celular: f.celular, formaPago: f.formaPago,
      total: f.total, fechaVenta: fecha.toISOString(), dia: hoyStr(fecha), estado, origen: "sheet", creadoEn: fecha, capturo: S.perfil.nombre, contador: "hoja" };
    if (!f.regimen && f.regimenTxt) d.regimenTxt = f.regimenTxt;
    if (!f.usoCfdi && f.usoTxt) d.usoTxt = f.usoTxt;
    ops.push([doc(db, "facturas", id), d, id]);
  });
  try {
    // Las que ya estaban importadas no se tocan (para no regresar a "pendiente" algo que ya marcaste).
    const ya = new Set(S.facturas.map(f => f.id));
    const nuevas = ops.filter(o => !ya.has(o[2]));
    const todo = [...nuevas.map(([r, d]) => [r, d, false]), ...[...clientes].map(([rfc, c]) => [doc(db, "clientesFiscales", rfc), { ...c, actualizado: serverTimestamp() }, true])];
    for (let i = 0; i < todo.length; i += 400) {
      const batch = writeBatch(db);
      todo.slice(i, i + 400).forEach(([r, d, merge]) => merge ? batch.set(r, d, { merge: true }) : batch.set(r, d));
      await batch.commit();
    }
    S.facFiltro = estado === "pendiente" ? "pendiente" : "todas";
    closeSheet(); render();
    toast(`${nuevas.length} factura${nuevas.length === 1 ? "" : "s"} importada${nuevas.length === 1 ? "" : "s"}${ops.length - nuevas.length ? ` (${ops.length - nuevas.length} ya estaban)` : ""} · ${clientes.size} cliente${clientes.size === 1 ? "" : "s"}`);
  } catch (e) {
    err.textContent = String(e && e.code || "").includes("permission-denied") ? "Firebase no lo permitió: falta publicar las reglas nuevas (Firestore → Reglas)." : ERR(e);
    btn.disabled = false; btn.textContent = `Importar ${filas.length} fila${filas.length === 1 ? "" : "s"}`;
  }
}

/* ---------- Tickets del día ---------- */
function viewTickets(v) {
  const list = S.ticketsDia.slice().sort((a, b) => b.folio - a.folio);
  const ok = list.filter(t => t.estado !== "cancelado");
  const mine = ok.filter(t => t.vendedorUid === S.user.uid);
  const sum = arr => r2(arr.reduce((a, t) => a + t.calc.total, 0));
  v.innerHTML = `
  <div class="row" style="flex-wrap:nowrap">
    <input type="date" id="dia" value="${S.dia}" max="${hoyStr()}" class="grow" aria-label="Día">
    <form id="folioForm" class="row" style="flex-wrap:nowrap"><input id="folioQ" inputmode="numeric" placeholder="Folio" style="width:90px" aria-label="Buscar folio"><button type="submit">Ver</button></form>
  </div>
  <p class="note" style="margin:8px 2px 0">${cap(diaLargo(S.dia))}</p>
  <div class="stats" style="margin-top:8px">
    <div class="stat"><div class="k">Vendido</div><div class="v">${money(sum(ok))}</div></div>
    <div class="stat"><div class="k">Tickets</div><div class="v">${ok.length}</div></div>
    <div class="stat"><div class="k">${isAdmin() ? "Efectivo" : "Mis ventas"}</div><div class="v">${money(isAdmin() ? sum(ok.filter(t => t.metodo === "Efectivo")) : sum(mine))}</div></div>
  </div>
  ${isAdmin() ? `<div class="row" style="margin-top:10px"><button class="grow" id="corte">Corte del día</button><button class="grow" id="csv">Exportar CSV</button></div>` : ""}
  <h2>${list.length} ticket${list.length === 1 ? "" : "s"}</h2>
  ${list.length ? `<div class="tlist">${list.map(t => `
    <button class="titem ${t.estado === "cancelado" ? "cancel" : ""}" data-open="${esc(t.id)}">
      <span class="fo">#${pad(t.folio)}</span>
      <span class="who">${esc(t.cliente || "Público en general")}</span>
      <span class="tt">${money(t.calc.total)}</span>
      <span class="when">${new Date(t.fechaLocal).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · ${esc(t.metodo)} · ${esc(t.vendedorNombre || "")}${t.estado === "cancelado" ? " · <span style='color:var(--bad)'>Cancelado</span>" : ""}</span>
    </button>`).join("")}</div>` : `<div class="card empty">No hay tickets este día.</div>`}`;
  $("#dia").onchange = e => { S.dia = e.target.value || hoyStr(); listenDia(); render(); };
  $("#folioForm").onsubmit = async e => {
    e.preventDefault();
    const n = parseInt($("#folioQ").value, 10); if (!n) return;
    try { const s = await getDoc(doc(db, "tickets", String(n))); if (s.exists()) openTicket({ id: s.id, ...s.data() }, false); else toast("No existe el folio " + pad(n)); }
    catch (err) { toast(ERR(err)); }
  };
  $$("[data-open]", v).forEach(b => b.onclick = () => { const t = S.ticketsDia.find(x => x.id === b.dataset.open); if (t) openTicket(t, false); });
  const co = $("#corte"); if (co) co.onclick = openCorte;
  const cs = $("#csv"); if (cs) cs.onclick = openExport;
}

function openCorte() {
  const L = corteLines(diaLargo(S.dia), S.ticketsDia, S.config);
  openSheet(`<div class="row" style="justify-content:space-between;margin-bottom:12px"><strong style="font-size:17px">Corte del día</strong><button class="btn-ghost" data-close>Cerrar</button></div>
    <div class="receipt">${linesHTML(L)}</div>
    <div class="actions">
      ${bluetoothSupport().ok ? `<button class="btn-primary full" id="kPrint">Imprimir corte</button>` : ""}
      ${isAndroid ? `<a class="btn full" id="kRaw" href="#">Imprimir con RawBT</a>` : ""}
      <button class="full" id="kSys">Imprimir (sistema)</button>
    </div>`);
  const p = $("#kPrint"); if (p) p.onclick = () => printLines(L);
  const r = $("#kRaw"); if (r) r.onclick = e => { e.preventDefault(); rawbt(L); };
  $("#kSys").onclick = () => systemPrint(L);
}

function openExport() {
  const first = S.dia.slice(0, 8) + "01";
  openSheet(`<div class="row" style="justify-content:space-between;margin-bottom:12px"><strong style="font-size:17px">Exportar tickets</strong><button class="btn-ghost" data-close>Cerrar</button></div>
    <form class="card stack" id="expForm">
      <div class="grid2"><label class="f">Desde<input type="date" id="eDe" value="${first}"></label><label class="f">Hasta<input type="date" id="eA" value="${S.dia}"></label></div>
      <button class="btn-primary" type="submit">Descargar CSV (Excel)</button>
    </form>`);
  $("#expForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const snap = await getDocs(query(collection(db, "tickets"), where("dia", ">=", $("#eDe").value), where("dia", "<=", $("#eA").value)));
      const rows = [["Folio", "Fecha", "Vendedor", "Cliente", "Artículos", "Subtotal", "Descuento", "IVA", "Total", "Pago", "Recibido", "Cambio", "Estado", "Motivo cancelación"]];
      snap.docs.map(d => d.data()).sort((a, b) => a.folio - b.folio).forEach(t => rows.push([pad(t.folio), fechaLarga(t.fechaLocal), t.vendedorNombre, t.cliente || "Público en general", t.items.map(i => `${i.cant}x ${i.nombre} @${i.precio}`).join(" | "), t.calc.sub, t.calc.desc, t.calc.iva, t.calc.total, t.metodo, t.recibido, t.cambio, t.estado, t.motivo || ""]));
      const csv = "﻿" + rows.map(r => r.map(v => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `tickets_${$("#eDe").value}_a_${$("#eA").value}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      toast(`${snap.size} tickets exportados`);
    } catch (err) { toast(ERR(err)); }
  };
}

/* ---------- Productos (admin) ---------- */
function viewProductos(v) {
  const prods = S.productos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  v.innerHTML = `
  <form class="card stack" id="prodForm" autocomplete="off">
    <div class="grid2" style="grid-template-columns:1fr 110px">
      <label class="f">Nombre<input id="pNombre" required placeholder="Ej. Funda transparente"></label>
      <label class="f">Precio $<input id="pPrecio" required inputmode="decimal" placeholder="0.00"></label>
    </div>
    <button class="btn-primary" type="submit">Agregar producto</button>
  </form>
  <h2>${prods.length} producto${prods.length === 1 ? "" : "s"}</h2>
  ${prods.length ? `<div class="card plist">${prods.map(p => `
    <div class="p" data-pid="${esc(p.id)}">
      <input value="${esc(p.nombre)}" data-pn aria-label="Nombre">
      <input value="${p.precio}" inputmode="decimal" data-pp aria-label="Precio">
      <button class="btn-ghost" data-pdel="${esc(p.id)}" aria-label="Eliminar" style="color:var(--bad);padding:10px">✕</button>
    </div>`).join("")}</div><p class="note">Los cambios se guardan al salir del campo y aparecen al instante en los celulares de todos.</p>`
    : `<div class="card empty">Sin productos todavía.</div>`}`;
  $("#prodForm").onsubmit = async e => {
    e.preventDefault();
    const n = $("#pNombre").value.trim(), p = num($("#pPrecio").value);
    if (!n || p <= 0) { toast("Escribe nombre y precio mayor a 0"); return; }
    try { await setDoc(doc(collection(db, "productos")), { nombre: n, precio: r2(p) }); toast("Producto agregado"); } catch (err) { toast(ERR(err)); }
  };
  $$(".p", v).forEach(row => {
    const id = row.dataset.pid;
    const save = async () => {
      const n = $("[data-pn]", row).value.trim(), p = num($("[data-pp]", row).value);
      const old = S.productos.find(x => x.id === id); if (!old || !n || p <= 0) return;
      if (old.nombre === n && old.precio === r2(p)) return;
      try { await setDoc(doc(db, "productos", id), { nombre: n, precio: r2(p) }); toast("Guardado"); } catch (err) { toast(ERR(err)); }
    };
    $("[data-pn]", row).onchange = save; $("[data-pp]", row).onchange = save;
  });
  $$("[data-pdel]", v).forEach(b => b.onclick = async () => {
    if (b.dataset.armed) { try { await deleteDoc(doc(db, "productos", b.dataset.pdel)); toast("Producto eliminado"); } catch (err) { toast(ERR(err)); } }
    else { b.dataset.armed = "1"; b.textContent = "¿Borrar?"; b.style.fontSize = "13px"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "✕"; b.style.fontSize = ""; } }, 3000); }
  });
}

/* ---------- Equipo (admin) ---------- */
function viewEquipo(v) {
  const us = S.usuarios.slice().sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, "es"));
  v.innerHTML = `
  <form class="card stack" id="empForm" autocomplete="off">
    <strong>Dar de alta a un empleado</strong>
    <label class="f">Nombre<input id="eNom" required></label>
    <label class="f">Correo<input id="eMail" type="email" required autocomplete="off"></label>
    <div class="grid2">
      <label class="f">Contraseña inicial<input id="ePass" required minlength="6" autocomplete="new-password"></label>
      <label class="f">Rol<select id="eRol"><option value="cajero">Cajero</option><option value="admin">Administrador</option></select></label>
    </div>
    <div class="err" id="eErr"></div>
    <button class="btn-primary" type="submit">Crear acceso</button>
    <p class="note" style="margin:0">Pásale a tu empleado el enlace de la página, su correo y la contraseña. Cajero: vende y reimprime. Administrador: además productos, equipo, cancelaciones y cortes.</p>
  </form>
  <h2>${us.length} persona${us.length === 1 ? "" : "s"}</h2>
  <div class="card ulist">${us.map(u => `
    <div class="u" data-uid="${esc(u.id)}">
      <div><div style="font-weight:700">${esc(u.nombre)}${u.id === S.user.uid ? " (tú)" : ""}</div><div class="note">${esc(u.email || "")}</div></div>
      <span class="tag ${u.activo ? "" : "off"}">${u.activo ? (u.rol === "admin" ? "Admin" : "Cajero") : "Sin acceso"}</span>
      ${u.id === S.user.uid ? "" : `<div class="ctl">
        <select data-rol aria-label="Rol"><option value="cajero" ${u.rol === "cajero" ? "selected" : ""}>Cajero</option><option value="admin" ${u.rol === "admin" ? "selected" : ""}>Administrador</option></select>
        <button data-act>${u.activo ? "Quitar acceso" : "Dar acceso"}</button>
      </div>`}
    </div>`).join("")}</div>`;
  $("#empForm").onsubmit = async e => {
    e.preventDefault(); const btn = $("#empForm button"); btn.disabled = true; $("#eErr").textContent = "";
    // Se usa una segunda instancia de Firebase para crear la cuenta sin cerrar la sesión del administrador.
    const sec = initializeApp(firebaseConfig, "alta-" + Date.now());
    try {
      const sAuth = getAuth(sec);
      if (location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador")) connectAuthEmulator(sAuth, "http://localhost:9099", { disableWarnings: true });
      const cred = await createUserWithEmailAndPassword(sAuth, $("#eMail").value.trim(), $("#ePass").value);
      await setDoc(doc(db, "usuarios", cred.user.uid), { nombre: $("#eNom").value.trim(), email: cred.user.email, rol: $("#eRol").value, activo: true, creadoEn: serverTimestamp() });
      await signOut(sAuth);
      toast("Acceso creado para " + $("#eNom").value.trim());
      $("#empForm").reset();
    } catch (err) {
      $("#eErr").textContent = String(err.code).includes("email-already-in-use") ? "Ese correo ya tiene cuenta. Si es de alguien que dejaste sin acceso, dale acceso de nuevo desde la lista." : ERR(err);
    } finally { btn.disabled = false; deleteApp(sec).catch(() => {}); }
  };
  $$(".u", v).forEach(row => {
    const id = row.dataset.uid, u = S.usuarios.find(x => x.id === id);
    const rs = $("[data-rol]", row), ab = $("[data-act]", row);
    if (rs) rs.onchange = async () => { try { await updateDoc(doc(db, "usuarios", id), { rol: rs.value }); toast("Rol actualizado"); } catch (err) { toast(ERR(err)); } };
    if (ab) ab.onclick = async () => { try { await updateDoc(doc(db, "usuarios", id), { activo: !u.activo }); toast(u.activo ? "Acceso retirado" : "Acceso activado"); } catch (err) { toast(ERR(err)); } };
  });
}

/* ---------- Ajustes ---------- */
function viewAjustes(v) {
  const c = S.config, p = S.prn, bt = bluetoothSupport();
  v.innerHTML = `
  <h2 style="margin-top:0">Impresora de este celular</h2>
  <div class="card stack">
    ${bt.ok ? `<div class="row"><div class="grow"><b>${printer.device ? esc(printer.name) : "Ninguna conectada"}</b><div class="note">${printer.connected ? "Conectada" : printer.device ? "Desconectada; se reconecta al imprimir" : "Enciende la impresora y tócala en la lista"}</div></div>
      <button class="btn-primary" id="aConn">${printer.device ? "Cambiar" : "Conectar"}</button></div>`
      : `<div class="notice">${esc(bt.reason)}${isAndroid ? " También puedes usar la app RawBT." : ""}</div>`}
    <div class="grid2">
      <label class="f">Ancho del papel<select id="aAncho"><option value="32" ${p.ancho == 32 ? "selected" : ""}>58 mm (32 letras)</option><option value="48" ${p.ancho == 48 ? "selected" : ""}>80 mm (48 letras)</option></select></label>
      <label class="f">Copias<select id="aCop">${[1, 2, 3].map(n => `<option ${p.copias == n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    </div>
    <label class="chk"><input type="checkbox" id="aAuto" ${p.auto ? "checked" : ""}>Imprimir automáticamente al cobrar</label>
    <label class="chk"><input type="checkbox" id="aAcc" ${p.acentos ? "checked" : ""}>Imprimir acentos y ñ (desactívalo si salen símbolos raros)</label>
    <label class="chk"><input type="checkbox" id="aCut" ${p.corte ? "checked" : ""}>Cortar papel al final (solo impresoras con cortador)</label>
    <button id="aTest" ${bt.ok || isAndroid ? "" : "disabled"}>Imprimir prueba</button>
  </div>
  ${isAdmin() ? `
  <h2>Datos del negocio</h2>
  <form class="card stack" id="cfgForm" autocomplete="off">
    <label class="f">Nombre del negocio<input id="cNombre" value="${esc(c.nombre)}"></label>
    <label class="f">Dirección<input id="cDir" value="${esc(c.direccion)}" placeholder="Calle, número, colonia, ciudad"></label>
    <div class="grid2"><label class="f">Teléfono<input id="cTel" inputmode="tel" value="${esc(c.telefono)}"></label><label class="f">RFC<input id="cRfc" value="${esc(c.rfc)}" style="text-transform:uppercase"></label></div>
    <label class="f">Mensaje al pie del ticket<input id="cPie" value="${esc(c.pie)}"></label>
    <label class="f">Cupón de la tienda en línea (10% en la primera compra)<input id="cCupon" value="${esc(c.cupon)}" placeholder="Déjalo vacío para no imprimir cupón" style="text-transform:uppercase" autocomplete="off"></label>
    <label class="f">IVA<select id="cIva">
      <option value="incluido" ${c.iva === "incluido" ? "selected" : ""}>Precios ya incluyen IVA (se desglosa)</option>
      <option value="agregar" ${c.iva === "agregar" ? "selected" : ""}>Sumar 16% de IVA al total</option>
      <option value="no" ${c.iva === "no" ? "selected" : ""}>No mostrar IVA</option></select></label>
    <button class="btn-primary" type="submit">Guardar datos</button>
  </form>` : ""}
  ${isAdmin() ? `
  <h2>Formato del contador</h2>
  <div class="card stack">
    <div class="notice ${contadorListo() ? "ok" : ""}">${contadorListo() ? "Conectado: las solicitudes de factura se mandan al formulario «Facturación Electrónica» de tus contadores." : "Sin conectar: las solicitudes se guardan en la caja, pero todavía no llegan al formulario de tus contadores."}</div>
    <label class="f">${contadorListo() ? "Cambiar la conexión" : "Conectar"} <span class="hint">(pega el link prellenado del formulario, o el código de tu script anterior)</span><textarea id="fcTxt" rows="3" spellcheck="false" autocomplete="off" placeholder="https://docs.google.com/forms/d/e/…/viewform?usp=pp_url&entry.123=…"></textarea></label>
    <div id="fcPrev"></div>
    <label class="chk"><input type="checkbox" id="fcAuto" ${!S.formato || S.formato.auto !== false ? "checked" : ""}>Enviar al contador en cuanto se pide la factura</label>
    <div class="row">
      <button class="btn-primary grow" id="fcSave" disabled>Guardar conexión</button>
      ${contadorListo() ? `<a class="btn grow" id="fcTest" target="_blank" rel="noopener" href="${esc(linkContador(S.formato, PRUEBA_CONTADOR()))}">Probar</a>` : ""}
    </div>
    ${contadorListo() ? `<p class="note" style="margin:0"><b>Probar</b> abre el formulario con datos de ejemplo: revisa que los 9 datos estén cada uno en su pregunta y ciérralo sin enviar.</p>` : ""}
  </div>` : ""}
  <h2>Cuenta</h2>
  <div class="card row"><div class="grow"><b>${esc(S.perfil.nombre)}</b><div class="note">${esc(S.user.email)} · ${isAdmin() ? "Administrador" : "Cajero"}</div></div><button id="aOut">Salir</button></div>`;
  const savePrn = () => LS.set("printer", S.prn);
  const cn = $("#aConn"); if (cn) cn.onclick = async () => { try { printer.disconnect(); await printer.connect(); toast("Conectada: " + printer.name); render(); } catch (e) { if (e.name !== "NotFoundError") toast(e.message); } };
  $("#aAncho").onchange = e => { S.prn.ancho = +e.target.value; savePrn(); document.documentElement.style.setProperty("--cols", S.prn.ancho); };
  $("#aCop").onchange = e => { S.prn.copias = +e.target.value; savePrn(); };
  $("#aAuto").onchange = e => { S.prn.auto = e.target.checked; savePrn(); };
  $("#aAcc").onchange = e => { S.prn.acentos = e.target.checked; savePrn(); };
  $("#aCut").onchange = e => { S.prn.corte = e.target.checked; savePrn(); };
  $("#aTest").onclick = () => {
    const W = S.prn.ancho;
    const L = [{ text: "PRUEBA", center: true, bold: true, big: true }, { text: S.config.nombre, center: true }, { text: "-".repeat(W) },
      { text: "Acentos: áéíóú ñ Ñ ¡Hola! ¿Qué tal?" }, { text: lr("Izquierda", "Derecha", W) }, { text: "1234567890".repeat(5).slice(0, W) }, { text: "-".repeat(W) }, { text: "Si ves esto, la impresora funciona.", center: true }];
    if (bt.ok) printLines(L); else rawbt(L);
  };
  const cf = $("#cfgForm");
  if (cf) cf.onsubmit = async e => {
    e.preventDefault();
    const cfg = { nombre: $("#cNombre").value.trim() || "Mi Negocio", direccion: $("#cDir").value.trim(), telefono: $("#cTel").value.trim(), rfc: $("#cRfc").value.trim().toUpperCase(), pie: $("#cPie").value.trim(), iva: $("#cIva").value, cupon: $("#cCupon").value.trim().toUpperCase().replace(/\s+/g, "") };
    try { await setDoc(doc(db, "config", "negocio"), cfg); toast("Datos guardados"); } catch (err) { toast(ERR(err)); }
  };
  const fcTxt = $("#fcTxt");
  if (fcTxt) {
    let leido = null;
    fcTxt.oninput = () => {
      const prev = $("#fcPrev"); leido = fcTxt.value.trim() ? leerFormato(fcTxt.value) : null; $("#fcSave").disabled = !(leido && leido.ok);
      prev.innerHTML = !leido ? "" : leido.ok
        ? `<div class="notice ok">Encontré las 9 preguntas (${esc(leido.origen)}).</div>${leido.avisos.length ? `<div class="notice" style="margin-top:8px">${esc(leido.avisos.join(" "))}</div>` : ""}
           <div class="fac"><div class="fac-grid">${CAMPOS_CONTADOR.map(([k, n]) => `<span class="k">${n}</span><span class="mono">entry.${esc(leido.ids[k])}</span>`).join("")}</div></div>`
        : `<div class="notice">${esc(leido.avisos.join(" "))}</div>`;
    };
    $("#fcSave").onclick = async () => {
      if (!leido || !leido.ok) return;
      const d = { formUrl: leido.formUrl, ids: leido.ids, auto: $("#fcAuto").checked, actualizado: new Date().toISOString() };
      if (leido.opciones) d.opciones = leido.opciones;
      try { await setDoc(doc(db, "publico", "formato"), d); S.formato = d; toast("Formato del contador conectado"); fcTxt.blur(); render(); }
      catch (e) { toast(String(e && e.code || "").includes("permission-denied") ? "Falta publicar las reglas nuevas en Firebase" : ERR(e)); }
    };
    $("#fcAuto").onchange = async e => {
      if (!contadorListo()) return;
      try { await updateDoc(doc(db, "publico", "formato"), { auto: e.target.checked }); toast(e.target.checked ? "Envío automático activado" : "Envío automático desactivado"); } catch (err) { toast(ERR(err)); }
    };
  }
  $("#aOut").onclick = () => signOut(auth);
}
const PRUEBA_CONTADOR = () => ({ rfc: "XAXX010101000", razonSocial: "PRUEBA NO FACTURAR", regimen: "626", cp: "64000", usoCfdi: "G03", formaPago: "Efectivo", total: 1, celular: "1111111111", email: (S.user && S.user.email) || "prueba@correo.com" });

function openPrinterSheet() {
  const bt = bluetoothSupport();
  if (bt.ok && !printer.connected) {
    (printer.device ? printer.ensure() : printer.connect())
      .then(() => toast("Impresora lista: " + printer.name))
      .catch(e => { if (e.name !== "NotFoundError") toast(e.message); })
      .finally(renderHeader);
    return;
  }
  S.tab = "ajustes"; render();
}

/* ================= sesión y datos en vivo ================= */
function stopListeners() { while (unsubs.length) try { unsubs.pop()(); } catch (e) {} }
let diaUnsub = null;
function listenDia() {
  if (diaUnsub) diaUnsub();
  diaUnsub = onSnapshot(query(collection(db, "tickets"), where("dia", "==", S.dia)),
    s => { S.ticketsDia = s.docs.map(d => ({ id: d.id, ...d.data() })); softRender(); },
    e => toast(ERR(e)));
}
let pending = false;
function softRender() {
  const a = document.activeElement;
  if (a && a.closest && a.closest("#view") && a.matches("input,select,textarea")) { pending = true; return; }
  render();
}
document.addEventListener("focusout", () => { if (!pending) return; setTimeout(() => { const a = document.activeElement; if (a && a.closest && a.closest("#view") && a.matches("input,select,textarea")) return; pending = false; render(); }, 300); });
addEventListener("online", () => { S.online = true; renderHeader(); });
addEventListener("offline", () => { S.online = false; renderHeader(); });

let settingUp = false;
async function startSession(user) {
  stopListeners();
  S.user = user;
  let snap;
  try { snap = await getDoc(doc(db, "usuarios", user.uid)); } catch (e) { snap = null; }
  if (!snap || !snap.exists() || !snap.data().activo) { S.screen = "noaccess"; render(); return; }
  S.perfil = snap.data();
  S.screen = "main"; S.tab = "vender"; S.dia = hoyStr();
  render();
  unsubs.push(onSnapshot(doc(db, "usuarios", user.uid), s => {
    const p = s.data();
    if (!p || !p.activo) { S.screen = "noaccess"; stopListeners(); render(); return; }
    const wasAdmin = isAdmin(); S.perfil = p;
    if (wasAdmin !== isAdmin()) { startSession(user); return; }
    softRender();
  }, () => { S.screen = "noaccess"; stopListeners(); render(); }));
  unsubs.push(onSnapshot(doc(db, "config", "negocio"), s => { S.config = { ...DEFAULT_CONFIG, ...(s.data() || {}) }; softRender(); }, () => {}));
  unsubs.push(onSnapshot(doc(db, "publico", "formato"), s => { S.formato = s.data() || null; softRender(); }, () => {}));
  unsubs.push(onSnapshot(collection(db, "productos"), s => { S.productos = s.docs.map(d => ({ id: d.id, ...d.data() })); softRender(); }, () => {}));
  if (isAdmin()) unsubs.push(onSnapshot(query(collection(db, "facturas"), orderBy("creadoEn", "desc"), limit(500)), s => { S.facturas = s.docs.map(d => ({ id: d.id, ...d.data() })); softRender(); }, () => {}));
  if (isAdmin()) unsubs.push(onSnapshot(collection(db, "usuarios"), s => { S.usuarios = s.docs.map(d => ({ id: d.id, ...d.data() })); softRender(); }, () => {}));
  listenDia();
  unsubs.push(() => { if (diaUnsub) { diaUnsub(); diaUnsub = null; } });
}

async function boot() {
  if (!configured) { S.screen = "noconfig"; render(); return; }
  onAuthStateChanged(auth, async user => {
    if (settingUp) return;
    if (user) { await startSession(user); return; }
    stopListeners(); S.user = null; S.perfil = null; S.cart = [];
    try { const s = await getDoc(doc(db, "sistema", "init")); S.screen = s.exists() ? "login" : "setup"; }
    catch (e) { S.screen = "login"; }
    render();
  });
}
boot();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
