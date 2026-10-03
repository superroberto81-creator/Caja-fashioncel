// Datos fiscales para solicitudes de factura (CFDI 4.0).
// Se usa en la caja (empleados) y en el ticket digital (clientes).

export const REGIMENES = [
  ["601", "General de Ley Personas Morales"],
  ["603", "Personas Morales con Fines no Lucrativos"],
  ["605", "Sueldos y Salarios e Ingresos Asimilados a Salarios"],
  ["606", "Arrendamiento"],
  ["607", "Régimen de Enajenación o Adquisición de Bienes"],
  ["608", "Demás ingresos"],
  ["610", "Residentes en el Extranjero sin Establecimiento Permanente en México"],
  ["611", "Ingresos por Dividendos (socios y accionistas)"],
  ["612", "Personas Físicas con Actividades Empresariales y Profesionales"],
  ["614", "Ingresos por intereses"],
  ["615", "Régimen de los ingresos por obtención de premios"],
  ["616", "Sin obligaciones fiscales"],
  ["620", "Sociedades Cooperativas de Producción que optan por diferir sus ingresos"],
  ["621", "Incorporación Fiscal"],
  ["622", "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras"],
  ["623", "Opcional para Grupos de Sociedades"],
  ["624", "Coordinados"],
  ["625", "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas"],
  ["626", "Régimen Simplificado de Confianza"],
];

export const USOS_CFDI = [
  ["G01", "Adquisición de mercancías"],
  ["G02", "Devoluciones, descuentos o bonificaciones"],
  ["G03", "Gastos en General"],
  ["I02", "Mobiliario y equipo de oficina por inversiones"],
  ["I04", "Equipo de computo y accesorios"],
  ["I08", "Otra maquinaria y equipo"],
  ["S01", "Sin efectos fiscales"],
];

// Forma de pago del SAT según cómo se cobró en la caja.
export const FORMA_PAGO = { Efectivo: "01 Efectivo", Transferencia: "03 Transferencia electrónica", Tarjeta: "04 Tarjeta de crédito / 28 débito" };

// Formas de pago tal como las escribe el formato del contador (columna FormaPago), con su clave del SAT.
export const FORMAS = [
  ["Efectivo", "01"],
  ["Tarjeta de Débito", "28"],
  ["Tarjeta de Crédito", "04"],
  ["Transferencia", "03"],
];
// Opciones válidas según cómo se cobró el ticket. Con tarjeta, hay que decir si fue débito o crédito.
export const formasPara = metodo =>
  metodo === "Efectivo" ? ["Efectivo"] :
  metodo === "Transferencia" ? ["Transferencia"] :
  metodo === "Tarjeta" ? ["Tarjeta de Débito", "Tarjeta de Crédito"] :
  FORMAS.map(f => f[0]);
export const claveForma = n => (FORMAS.find(f => f[0] === n) || ["", ""])[1];
// Texto de la forma de pago de una solicitud (las anteriores a este cambio solo tienen "metodo").
export const formaDe = f => f.formaPago || (f.metodo === "Tarjeta" ? "Tarjeta" : f.metodo || "");

/* ---------- Formato del contador (Google Forms "Facturación Electrónica") ----------
   Cada solicitud se manda a ese formulario con el texto exacto de sus opciones. */
export const CONTADOR = {
  regimen: {
    "626": "Régimen Simplificado de Confianza",
    "612": "Personas Físicas con Actividades Empresariales y Profesionales",
    "601": "General de Ley Personas Morales",
    "621": "Régimen de Incorporación Fiscal",
    "603": "Personas Morales sin Fines Lucrativos",
    "605": "Sueldos y Salarios",
    "606": "Régimen de Arrendamiento",
    "624": "Coordinados",
  },
  uso: { "G03": "Gastos en General", "G01": "Adquisición de Mercancias", "S01": "Por definir" },
  forma: { "Efectivo": "Efectivo", "Tarjeta de Débito": "Tarjeta de Débito", "Tarjeta de Crédito": "Tarjeta de Crédito", "Transferencia": "Transferencia Eléctronica" },
};
export const FORM_CONTADOR = "https://docs.google.com/forms/d/e/1FAIpQLSed7-S3SPx92uTFhZwSfkY8HeQ00baDoxrREZI2-Gc0vfA-Dg";
// Identificador de cada pregunta dentro de ese formulario (los mismos que usaba el script anterior de facturación).
export const FORMATO_DEFAULT = {
  formUrl: FORM_CONTADOR, auto: true,
  ids: { rfc: "443831071", nombre: "980432431", regimen: "2003251000", cp: "1511965354", uso: "1558851713",
         forma: "1169356144", monto: "1475725609", celular: "1615881201", correo: "1493451220" },
};
// Las 9 preguntas del formulario, en su orden.
export const CAMPOS_CONTADOR = [
  ["rfc", "RFC"], ["nombre", "Nombre o razón social"], ["regimen", "Régimen fiscal"], ["cp", "Código postal"], ["uso", "Uso de CFDI"],
  ["forma", "Forma de pago"], ["monto", "Monto de la compra"], ["celular", "Celular"], ["correo", "Correo"],
];

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z0-9]{3})$/;
export const limpiarRFC = s => String(s || "").toUpperCase().replace(/[\s-]/g, "");

// Dice qué le pasa a un RFC que no cumple el formato, para que quien lo escribe sepa qué corregir.
function mensajeRFC(r) {
  const n = (r || "").length;
  if (!n) return "Escribe el RFC.";
  if (n < 12) return `Al RFC le faltan caracteres: tiene ${n} y deben ser 12 (empresa) o 13 (persona).`;
  if (n > 13) return `Al RFC le sobran caracteres: tiene ${n} y deben ser 12 (empresa) o 13 (persona).`;
  if (n === 12 && /^[A-ZÑ&]{4}/.test(r)) return "Al RFC le falta un carácter: empieza con 4 letras, así que es de persona y debe tener 13. Este tiene 12.";
  return "Revisa el RFC: lleva 3 o 4 letras, 6 números de la fecha y 3 caracteres finales. Cuida no escribir la letra O en lugar del cero.";
}

// Devuelve un mensaje de error o "" si todo está bien.
export function validar(d) {
  if (!RFC_RE.test(d.rfc)) return mensajeRFC(d.rfc);
  if (d.rfc === "XAXX010101000") return "Ese es el RFC genérico de público en general; escribe tu RFC.";
  if (!d.razonSocial || d.razonSocial.length < 3) return "Escribe tu nombre o razón social tal como aparece en tu constancia.";
  if (!/^\d{5}$/.test(d.cp)) return "El código postal fiscal debe tener 5 dígitos.";
  if (!REGIMENES.some(r => r[0] === d.regimen)) return "Elige tu régimen fiscal.";
  if (!USOS_CFDI.some(u => u[0] === d.usoCfdi)) return "Elige el uso del CFDI.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "Escribe un correo válido para recibir la factura.";
  if (!/^\d{10}$/.test(d.celular || "")) return "Escribe tu celular a 10 dígitos.";
  if (!FORMAS.some(f => f[0] === d.formaPago)) return "Elige la forma de pago: tarjeta de débito o de crédito.";
  if (d.rfc.length === 12 && ["605", "606", "607", "608", "611", "612", "614", "615", "621", "625"].includes(d.regimen))
    return "Ese régimen es de persona física, pero el RFC es de empresa (12 caracteres). Revisa ambos.";
  if (d.rfc.length === 13 && ["601", "603", "620", "623", "624"].includes(d.regimen))
    return "Ese régimen es de empresa, pero el RFC es de persona física (13 caracteres). Revisa ambos.";
  return "";
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const opts = (list, sel, solo) => `<option value="">Elige una opción</option>` + list.filter(([k]) => !solo || solo.includes(k) || k === sel)
  .sort((a, b) => solo ? ((solo.indexOf(a[0]) + 1) || 99) - ((solo.indexOf(b[0]) + 1) || 99) : 0)
  .map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${k} · ${esc(v)}</option>`).join("");

// Formulario (mismos ids en la caja y en el ticket digital).
// "metodo" es cómo se cobró el ticket (Efectivo, Tarjeta o Transferencia).
export function formHTML(d = {}, metodo = "") {
  const formas = formasPara(metodo);
  const forma = d.formaPago && formas.includes(d.formaPago) ? d.formaPago : (formas.length === 1 ? formas[0] : "");
  return `
    <label class="f">RFC<input id="fRfc" value="${esc(d.rfc || "")}" maxlength="20" oninput="var v=this.value.toUpperCase().replace(/[^A-Z0-9Ñ&]/g,'').slice(0,13);if(v!==this.value)this.value=v" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XAXX010101000" style="text-transform:uppercase"></label>
    <label class="f">Nombre o razón social <span class="hint">(como en tu constancia de situación fiscal, sin "S.A. de C.V.")</span><input id="fRazon" value="${esc(d.razonSocial || "")}" autocomplete="off"></label>
    <div class="grid2">
      <label class="f">Código postal fiscal<input id="fCp" value="${esc(d.cp || "")}" inputmode="numeric" maxlength="5" autocomplete="off"></label>
      <label class="f">Correo para recibir la factura<input id="fMail" type="email" value="${esc(d.email || "")}" autocomplete="off"></label>
    </div>
    <label class="f">Régimen fiscal<select id="fReg">${opts(REGIMENES, d.regimen, Object.keys(CONTADOR.regimen))}</select></label>
    <label class="f">Uso del CFDI<select id="fUso">${opts(USOS_CFDI, d.usoCfdi || "G03", Object.keys(CONTADOR.uso))}</select></label>
    <div class="grid2">
      <label class="f">Forma de pago<select id="fForma" ${formas.length === 1 ? "disabled" : ""}>${formas.length === 1 ? "" : `<option value="">Elige una opción</option>`}${formas.map(n => `<option value="${esc(n)}" ${n === forma ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      <label class="f">Celular<input id="fCel" type="tel" inputmode="numeric" maxlength="15" value="${esc(d.celular || "")}" placeholder="10 dígitos" autocomplete="off"></label>
    </div>`;
}

export function leerForm(root = document) {
  const v = id => (root.querySelector("#" + id)?.value || "").trim();
  return { rfc: limpiarRFC(v("fRfc")), razonSocial: v("fRazon").toUpperCase(), cp: v("fCp"), email: v("fMail").toLowerCase(), regimen: v("fReg"), usoCfdi: v("fUso"),
    formaPago: v("fForma"), celular: soloCel(v("fCel")) };
}

// Celular a 10 dígitos (quita espacios, guiones y el +52 si lo escriben).
export function soloCel(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d;
}

/* ---------- Importar la base de datos del Google Sheet ---------- */
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Convierte el texto del Sheet ("Régimen Simplificado de Confianza", "626", "626 - RESICO"…) a la clave del SAT.
function claveDe(lista, txt) {
  const t = String(txt ?? "").trim(); if (!t) return "";
  const cod = t.toUpperCase().match(/^[A-Z]?\d{2,3}\b/);
  if (cod && lista.some(x => x[0] === cod[0])) return cod[0];
  const n = norm(t);
  const hit = lista.find(x => norm(x[1]) === n) || lista.find(x => n.length > 5 && (norm(x[1]).startsWith(n) || n.startsWith(norm(x[1]))));
  return hit ? hit[0] : "";
}
export const claveRegimen = txt => claveDe(REGIMENES, txt);
export const claveUso = txt => claveDe(USOS_CFDI, txt);

function formaDelSheet(txt) {
  const n = norm(txt);
  if (!n) return "";
  if (n.includes("debito") || n === "28") return "Tarjeta de Débito";
  if (n.includes("credito") || n === "04" || n === "4") return "Tarjeta de Crédito";
  if (n.includes("efectivo") || n === "01" || n === "1") return "Efectivo";
  if (n.includes("transfer") || n === "03" || n === "3") return "Transferencia";
  return String(txt).trim();
}

// Lee texto separado por comas, tabuladores o punto y coma (CSV descargado o celdas copiadas del Sheet).
export function leerTabla(texto) {
  const t = String(texto || "").replace(/^\uFEFF/, "");
  const primera = t.split(/\r?\n/)[0] || "";
  const cuenta = c => primera.split(c).length - 1;
  const sep = cuenta("\t") ? "\t" : cuenta(";") > cuenta(",") ? ";" : ",";
  const filas = []; let fila = [], campo = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
    else if (c === '"' && campo === "") q = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; fila.push(campo); campo = ""; filas.push(fila); fila = []; }
    else campo += c;
  }
  fila.push(campo); filas.push(fila);
  return filas.map(f => f.map(x => x.trim())).filter(f => f.some(x => x));
}

// "14/09/2026 12:49:56" (día/mes/año, como lo guarda el Sheet) → fecha. Devuelve null si no se entiende.
export function fechaDelSheet(s) {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const d = new Date(y, +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0)); return isNaN(d) || d.getMonth() !== +m[2] - 1 ? null : d; }
  m = t.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) { const d = new Date(t.length <= 10 ? t + "T12:00:00" : t.replace(" ", "T")); return isNaN(d) ? null : d; }
  return null;
}

const COLS = [
  ["fecha", /^(fecha|marcatemporal|marcadetiempo|timestamp|hora|fechayhora)/],
  ["rfc", /^rfc/],
  ["razonSocial", /^(nombre|razonsocial|razon|cliente)/],
  ["regimen", /^regimen/],
  ["cp", /^(cp|codigopostal|domiciliofiscal)/],
  ["usoCfdi", /^uso/],
  ["formaPago", /^(formapago|formadepago|metodopago|metododepago|pago)/],
  ["total", /^(monto|total|importe|cantidad)/],
  ["celular", /^(celular|telefono|whatsapp|movil|tel)/],
  ["email", /^(correo|email|mail)/],
];
// Orden de la pestaña "Respuestas" cuando no vienen encabezados: A fecha, B RFC, C Nombre, D Régimen, E CP, F Uso, G FormaPago, H Monto, I Celular, J Correo.
const ORDEN = ["fecha", "rfc", "razonSocial", "regimen", "cp", "usoCfdi", "formaPago", "total", "celular", "email"];

// Devuelve { filas: [{…datos, n, avisos:[]}], sinEncabezado }. No escribe nada: solo interpreta.
export function interpretarSheet(texto) {
  const tabla = leerTabla(texto);
  if (!tabla.length) return { filas: [], sinEncabezado: false };
  const cab = tabla[0].map(norm);
  const mapa = {};
  cab.forEach((h, i) => { const c = COLS.find(([k, re]) => !(k in mapa) && re.test(h)); if (c) mapa[c[0]] = i; });
  const conEncabezado = "rfc" in mapa;
  if (!conEncabezado) {
    // Sin encabezados: se busca la columna que parece RFC y se toma el orden del Sheet a partir de ahí.
    const iRfc = tabla[0].findIndex(x => RFC_RE.test(limpiarRFC(x)));
    if (iRfc < 0) return { filas: [], sinEncabezado: true, error: "No encontré la columna RFC. Copia también la fila de encabezados." };
    ORDEN.forEach((k, i) => { mapa[k] = iRfc - 1 + i; });
  } else {
    // Encabezados que no se reconocieron (en la hoja, la fecha va justo antes del RFC y el monto entre FormaPago y Celular).
    const usados = Object.values(mapa);
    if (!("fecha" in mapa) && mapa.rfc > 0 && !usados.includes(mapa.rfc - 1)) mapa.fecha = mapa.rfc - 1;
    if (!("total" in mapa) && "formaPago" in mapa && !usados.includes(mapa.formaPago + 1)) mapa.total = mapa.formaPago + 1;
  }
  const filas = [];
  tabla.slice(conEncabezado ? 1 : 0).forEach((f, i) => {
    const v = k => (k in mapa && mapa[k] >= 0 ? f[mapa[k]] || "" : "").trim();
    const rfc = limpiarRFC(v("rfc"));
    if (!rfc && !v("razonSocial")) return;
    const fecha = fechaDelSheet(v("fecha"));
    const monto = parseFloat(v("total").replace(/[^0-9.\-]/g, ""));
    const cpNum = v("cp").replace(/\D/g, "");
    const d = {
      n: i + (conEncabezado ? 2 : 1), fecha, fechaTxt: v("fecha"), rfc,
      razonSocial: v("razonSocial").toUpperCase(),
      regimen: claveRegimen(v("regimen")), regimenTxt: v("regimen"),
      cp: cpNum ? cpNum.padStart(5, "0").slice(-5) : "",
      usoCfdi: claveUso(v("usoCfdi")), usoTxt: v("usoCfdi"),
      formaPago: formaDelSheet(v("formaPago")),
      total: isFinite(monto) ? Math.round(monto * 100) / 100 : 0,
      celular: soloCel(v("celular")), email: v("email").toLowerCase(), avisos: [],
    };
    if (!RFC_RE.test(rfc)) d.avisos.push("RFC no válido");
    if (!d.regimen && d.regimenTxt) d.avisos.push("régimen no reconocido");
    if (!d.usoCfdi && d.usoTxt) d.avisos.push("uso de CFDI no reconocido");
    if (!fecha && d.fechaTxt) d.avisos.push("fecha no reconocida");
    d.rfcOk = RFC_RE.test(rfc);
    filas.push(d);
  });
  return { filas, sinEncabezado: !conEncabezado };
}

export const nombreRegimen = k => (REGIMENES.find(r => r[0] === k) || [k, ""])[1];
export const nombreUso = k => (USOS_CFDI.find(u => u[0] === k) || [k, ""])[1];


/* ---------- Envío al formulario del contador ---------- */
const normTxt = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Si se conoce la lista real de opciones del formulario, se usa su texto tal cual (acentos y mayúsculas incluidos).
const opcionReal = (lista, txt) => (lista || []).find(o => normTxt(o) === normTxt(txt)) || txt;

export const formatoListo = c => !!(c && c.ids && CAMPOS_CONTADOR.every(([k]) => /^\d+$/.test(String(c.ids[k] || ""))));

// Respuestas de una solicitud tal como las espera el formulario. "faltan" lista lo que no tiene equivalente.
export function respuestasContador(c, f) {
  const o = (c && c.opciones) || {};
  const forma = f.formaPago || (f.metodo === "Tarjeta" ? "" : f.metodo || "");
  const v = {
    rfc: f.rfc || "", nombre: f.razonSocial || "",
    regimen: CONTADOR.regimen[f.regimen] ? opcionReal(o.regimen, CONTADOR.regimen[f.regimen]) : "",
    cp: f.cp || "",
    uso: CONTADOR.uso[f.usoCfdi] ? opcionReal(o.uso, CONTADOR.uso[f.usoCfdi]) : "",
    forma: CONTADOR.forma[forma] ? opcionReal(o.forma, CONTADOR.forma[forma]) : "",
    monto: (Math.round((+f.total || 0) * 100) / 100).toFixed(2),
    celular: f.celular || "", correo: f.email || "",
  };
  const faltan = CAMPOS_CONTADOR.filter(([k]) => !v[k]).map(([, n]) => n);
  return { v, faltan };
}
function parametros(c, v) {
  const p = new URLSearchParams();
  CAMPOS_CONTADOR.forEach(([k]) => { if (v[k]) p.set("entry." + c.ids[k], v[k]); });
  return p;
}
const baseForm = c => String((c && c.formUrl) || FORM_CONTADOR).replace(/\/(viewform|formResponse).*$/, "").replace(/\/$/, "");
// Link al formulario con todo ya escrito, para revisarlo y enviarlo a mano.
export function linkContador(c, f) {
  const p = parametros(c, respuestasContador(c, f).v); p.set("usp", "pp_url");
  return baseForm(c) + "/viewform?" + p.toString();
}
// Envía la solicitud al formulario. Devuelve "" si salió, o el motivo por el que no se envió.
// Google no deja leer su respuesta desde otra página: "salió" significa que el envío se hizo sin error de conexión.
export async function enviarContador(c, f) {
  if (!formatoListo(c)) return "Falta configurar el formato del contador.";
  const { v, faltan } = respuestasContador(c, f);
  if (faltan.length) return "Falta: " + faltan.join(", ") + ".";
  const p = parametros(c, v); p.set("fvv", "1"); p.set("pageHistory", "0");
  try { await fetch(baseForm(c) + "/formResponse", { method: "POST", mode: "no-cors", body: p }); return ""; }
  catch (e) { return "Sin conexión: no se pudo enviar al contador."; }
}

// Interpreta lo que pegue el administrador para sacar los identificadores de cada pregunta:
//  a) un link prellenado del formulario,  b) el código fuente de la página del formulario,
//  c) cualquier texto (p. ej. el script anterior) donde aparezcan los nueve "entry.123…" en el orden del formulario.
export function leerFormato(texto) {
  const t = String(texto || "");
  const out = { formUrl: FORM_CONTADOR, ids: {}, origen: "", avisos: [] };
  const mUrl = t.match(/https:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/e\/([\w-]+)/);
  if (mUrl) out.formUrl = "https://docs.google.com/forms/d/e/" + mUrl[1];
  const claves = [["rfc", /rfc|contribuyente/], ["nombre", /nombre|razon/], ["regimen", /regimen/], ["cp", /postal|^cp/], ["uso", /uso/],
    ["forma", /formadepago|formapago|metodo/], ["monto", /monto|importe|total/], ["celular", /celular|telefono|whatsapp/], ["correo", /correo|email|mail/]];

  // b) Código fuente: trae el título y las opciones exactas de cada pregunta.
  const iData = t.indexOf("FB_PUBLIC_LOAD_DATA_");
  if (iData >= 0) {
    try {
      const ini = t.indexOf("[", iData); let n = 0, fin = -1, q = false;
      for (let i = ini; i < t.length; i++) {
        const ch = t[i];
        if (q) { if (ch === "\\") i++; else if (ch === '"') q = false; }
        else if (ch === '"') q = true; else if (ch === "[") n++; else if (ch === "]" && --n === 0) { fin = i; break; }
      }
      const data = JSON.parse(t.slice(ini, fin + 1));
      out.opciones = {};
      (data[1][1] || []).forEach(it => {
        const tit = normTxt(it[1]), campo = it[4] && it[4][0]; if (!campo) return;
        const c = claves.find(([k, re]) => !(k in out.ids) && re.test(tit)); if (!c) return;
        out.ids[c[0]] = String(campo[0]);
        if (["regimen", "uso", "forma"].includes(c[0]) && Array.isArray(campo[1])) out.opciones[c[0]] = campo[1].map(o => o[0]).filter(Boolean);
      });
      out.origen = "código de la página";
    } catch (e) { out.avisos.push("No pude leer el código de la página."); }
  }
  // a) Link prellenado: cada valor dice a qué pregunta pertenece.
  if (!formatoListo(out) && /[?&]entry\.\d+=/.test(t)) {
    out.ids = {};
    const pares = [...t.matchAll(/[?&]entry\.(\d+)=([^&\s#]*)/g)].map(m => { let v = m[2]; try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) {} return [m[1], v]; });
    const es = (mapa, v) => Object.values(mapa).some(o => normTxt(o) === normTxt(v));
    const libres = [];
    pares.forEach(([id, v]) => {
      const x = v.trim();
      const k = es(CONTADOR.regimen, x) ? "regimen" : es(CONTADOR.uso, x) ? "uso" : es(CONTADOR.forma, x) || /^cheque$/i.test(x) ? "forma"
        : /@/.test(x) ? "correo" : /^\d{10}$/.test(x) ? "celular" : /^\d{5}$/.test(x) ? "cp" : RFC_RE.test(limpiarRFC(x)) ? "rfc" : /^\$?\d+[.,]\d{1,2}$/.test(x) ? "monto" : "";
      if (k && !(k in out.ids)) out.ids[k] = id; else libres.push(id);
    });
    // Lo que no se reconoció por su valor se acomoda en el orden del formulario.
    CAMPOS_CONTADOR.forEach(([k]) => { if (!(k in out.ids) && libres.length) out.ids[k] = libres.shift(); });
    out.origen = "link prellenado";
  }
  // c) Solo los identificadores, en orden.
  if (!formatoListo(out)) {
    const ids = [...new Set([...t.matchAll(/entry\.(\d{4,})/g)].map(m => m[1]))];
    if (ids.length >= CAMPOS_CONTADOR.length) {
      out.ids = {}; CAMPOS_CONTADOR.forEach(([k], i) => { out.ids[k] = ids[i]; });
      out.origen = "orden en que aparecen"; out.avisos.push("Tomé los identificadores en el orden en que aparecen. Usa la prueba para confirmar que cada dato cae en su pregunta.");
    }
  }
  out.ok = formatoListo(out);
  if (!out.ok) { const f = CAMPOS_CONTADOR.filter(([k]) => !out.ids[k]).map(([, n]) => n); out.avisos.push(f.length < CAMPOS_CONTADOR.length ? "No encontré: " + f.join(", ") + "." : "No encontré identificadores (entry.123…) en lo que pegaste."); }
  return out;
}
