// Impresión de tickets en impresoras térmicas (ESC/POS).
// - Bluetooth directo (Web Bluetooth / BLE): Chrome en Android, o la app Bluefy en iPhone.
// - RawBT: app de Android que imprime en impresoras Bluetooth "clásicas" que no son BLE.
// - Impresión del sistema: respaldo con el diálogo normal del navegador (AirPrint, PC, etc.).

// Servicios BLE que usan las impresoras térmicas portátiles más comunes.
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000ae00-0000-1000-8000-00805f9b34fb",
  "0000af30-0000-1000-8000-00805f9b34fb",
];

// Caracteres del español en la página de códigos PC850 (ESC t 2).
const CP850 = {
  "á":0xA0,"é":0x82,"í":0xA1,"ó":0xA2,"ú":0xA3,"ñ":0xA4,"Ñ":0xA5,"ü":0x81,"Ü":0x9A,
  "Á":0xB5,"É":0x90,"Í":0xD6,"Ó":0xE0,"Ú":0xE9,"¡":0xAD,"¿":0xA8,"°":0xF8,"·":0xFA,
};
const plain = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¡]/g, "!").replace(/[¿]/g, "?");

export function bluetoothSupport() {
  if (!("bluetooth" in navigator)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return { ok: false, reason: ios
      ? "En iPhone, Safari y Chrome no pueden conectarse a impresoras Bluetooth. Abre este sistema desde la app Bluefy."
      : "Este navegador no puede conectarse a impresoras Bluetooth. Usa Google Chrome." };
  }
  if (!window.isSecureContext) return { ok: false, reason: "La página debe abrirse con https:// para usar Bluetooth." };
  return { ok: true };
}

export class ThermalPrinter {
  constructor() {
    this.device = null;
    this.char = null;
    this.onchange = () => {};
  }
  get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected && this.char); }
  get name() { return this.device ? (this.device.name || "Impresora") : ""; }

  async connect() {
    const sup = bluetoothSupport();
    if (!sup.ok) throw new Error(sup.reason);
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    this.device.addEventListener("gattserverdisconnected", () => { this.char = null; this.onchange(); });
    await this._open();
    try { localStorage.setItem("caja:printerName", this.name); } catch (e) {}
    this.onchange();
    return this.name;
  }

  async _open() {
    const server = await this.device.gatt.connect();
    let services = [];
    try { services = await server.getPrimaryServices(); } catch (e) { services = []; }
    for (const svc of services) {
      let chars = [];
      try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
      const w = chars.find(c => c.properties.writeWithoutResponse) || chars.find(c => c.properties.write);
      if (w) { this.char = w; return; }
    }
    throw new Error("Esta impresora no mostró un canal de impresión compatible. Si es Bluetooth clásico (no BLE), usa la opción RawBT en Android.");
  }

  async ensure() {
    if (this.connected) return;
    if (!this.device) throw new Error("Primero conecta la impresora.");
    await this._open();   // reconexión silenciosa al mismo equipo
    this.onchange();
  }

  disconnect() {
    try { this.device && this.device.gatt.connected && this.device.gatt.disconnect(); } catch (e) {}
    this.char = null; this.onchange();
  }

  async write(bytes) {
    await this.ensure();
    const size = 100; // tamaño de bloque seguro para la mayoría de impresoras BLE
    const noResp = !!this.char.properties.writeWithoutResponse && this.char.writeValueWithoutResponse;
    for (let i = 0; i < bytes.length; i += size) {
      const chunk = bytes.slice(i, i + size);
      if (noResp) { await this.char.writeValueWithoutResponse(chunk); await sleep(18); }
      else if (this.char.writeValueWithResponse) await this.char.writeValueWithResponse(chunk);
      else await this.char.writeValue(chunk);
    }
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Convierte las líneas del ticket (mismo formato que se ve en pantalla) a bytes ESC/POS.
// lines: [{text, bold, big, center}], opts: {accents: true|false, cut: bool, feed: n}
export function escpos(lines, opts = {}) {
  const out = [];
  const push = (...b) => out.push(...b);
  const text = s => {
    for (const ch of (opts.accents ? s : plain(s))) {
      const code = ch.charCodeAt(0);
      if (code < 0x80) push(code);
      else if (opts.accents && CP850[ch] != null) push(CP850[ch]);
      else push(...[...plain(ch)].map(c => c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : 0x3F));
    }
  };
  push(0x1B, 0x40);                       // ESC @  reiniciar
  if (opts.accents) push(0x1B, 0x74, 0x02); // ESC t 2  página PC850
  for (let l of lines) {
    if (l.logo && opts.logo) {             // logo como imagen (GS v 0)
      const { bw, h, data } = opts.logo;
      push(0x1B, 0x61, 1);
      push(0x1D, 0x76, 0x30, 0x00, bw & 0xFF, bw >> 8, h & 0xFF, h >> 8);
      for (let i = 0; i < data.length; i++) out.push(data[i]);
      push(0x0A);
      continue;
    }
    if (l.logo) { l = { ...l, big: true }; } // sin imagen: nombre en letra grande
    push(0x1B, 0x61, l.center ? 1 : 0);    // alineación
    push(0x1B, 0x45, l.bold ? 1 : 0);      // negritas
    push(0x1D, 0x21, l.big ? 0x11 : 0x00); // doble alto y ancho
    text(l.center ? l.text.trim() : l.text);
    push(0x0A);
  }
  push(0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x1B, 0x61, 0);
  push(0x1B, 0x64, opts.feed ?? 4);      // avanzar papel
  if (opts.cut) push(0x1D, 0x56, 0x42, 0x00); // corte (impresoras de mostrador)
  return new Uint8Array(out);
}

// Enlace para la app RawBT (Android). Envía el texto ESC/POS en base64.
export function rawbtUrl(bytes) {
  let bin = "";
  bytes.forEach(b => bin += String.fromCharCode(b));
  return "intent:base64," + btoa(bin) + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
}
