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
  ["G03", "Gastos en general"],
  ["I02", "Mobiliario y equipo de oficina por inversiones"],
  ["I04", "Equipo de computo y accesorios"],
  ["I08", "Otra maquinaria y equipo"],
  ["S01", "Sin efectos fiscales"],
];

// Forma de pago del SAT según cómo se cobró en la caja.
export const FORMA_PAGO = { Efectivo: "01 Efectivo", Transferencia: "03 Transferencia electrónica", Tarjeta: "04 Tarjeta de crédito / 28 débito" };

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z0-9]{3})$/;
export const limpiarRFC = s => String(s || "").toUpperCase().replace(/[\s-]/g, "");

// Devuelve un mensaje de error o "" si todo está bien.
export function validar(d) {
  if (!RFC_RE.test(d.rfc)) return "El RFC no es válido: 12 caracteres para empresas, 13 para personas.";
  if (d.rfc === "XAXX010101000") return "Ese es el RFC genérico de público en general; escribe tu RFC.";
  if (!d.razonSocial || d.razonSocial.length < 3) return "Escribe tu nombre o razón social tal como aparece en tu constancia.";
  if (!/^\d{5}$/.test(d.cp)) return "El código postal fiscal debe tener 5 dígitos.";
  if (!REGIMENES.some(r => r[0] === d.regimen)) return "Elige tu régimen fiscal.";
  if (!USOS_CFDI.some(u => u[0] === d.usoCfdi)) return "Elige el uso del CFDI.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "Escribe un correo válido para recibir la factura.";
  if (d.rfc.length === 12 && ["605", "606", "607", "608", "611", "612", "614", "615", "621", "625"].includes(d.regimen))
    return "Ese régimen es de persona física, pero el RFC es de empresa (12 caracteres). Revisa ambos.";
  if (d.rfc.length === 13 && ["601", "603", "620", "623", "624"].includes(d.regimen))
    return "Ese régimen es de empresa, pero el RFC es de persona física (13 caracteres). Revisa ambos.";
  return "";
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const opts = (list, sel) => `<option value="">Elige una opción</option>` + list.map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${k} · ${esc(v)}</option>`).join("");

// Formulario (mismos ids en la caja y en el ticket digital).
export function formHTML(d = {}) {
  return `
    <label class="f">RFC<input id="fRfc" value="${esc(d.rfc || "")}" maxlength="13" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XAXX010101000" style="text-transform:uppercase"></label>
    <label class="f">Nombre o razón social <span class="hint">(como en tu constancia de situación fiscal, sin "S.A. de C.V.")</span><input id="fRazon" value="${esc(d.razonSocial || "")}" autocomplete="off"></label>
    <div class="grid2">
      <label class="f">Código postal fiscal<input id="fCp" value="${esc(d.cp || "")}" inputmode="numeric" maxlength="5" autocomplete="off"></label>
      <label class="f">Correo para recibir la factura<input id="fMail" type="email" value="${esc(d.email || "")}" autocomplete="off"></label>
    </div>
    <label class="f">Régimen fiscal<select id="fReg">${opts(REGIMENES, d.regimen)}</select></label>
    <label class="f">Uso del CFDI<select id="fUso">${opts(USOS_CFDI, d.usoCfdi || "G03")}</select></label>`;
}

export function leerForm(root = document) {
  const v = id => (root.querySelector("#" + id)?.value || "").trim();
  return { rfc: limpiarRFC(v("fRfc")), razonSocial: v("fRazon").toUpperCase(), cp: v("fCp"), email: v("fMail").toLowerCase(), regimen: v("fReg"), usoCfdi: v("fUso") };
}

export const nombreRegimen = k => (REGIMENES.find(r => r[0] === k) || [k, ""])[1];
export const nombreUso = k => (USOS_CFDI.find(u => u[0] === k) || [k, ""])[1];
