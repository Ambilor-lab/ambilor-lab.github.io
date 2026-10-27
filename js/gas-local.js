// GENERADO por simulacion/construir_app.js — no editar a mano desde simulacion/gas-fakes.js (la planilla en memoria)
(function () {
  var module = { exports: {} };
// ═══════════════════════════════════════════════════════════════
//  gas-fakes.js — Fakes de Google Apps Script (heredados de Pedidos)
//  Sistema de Pedidos por WhatsApp · Ambilor.Lab
// ───────────────────────────────────────────────────────────────
//  QUÉ ES: un simulador en memoria de los servicios de Apps Script
//  que usa PedidoApp_WebApp_AmbilorLab.gs, para poder correr el
//  motor en Node sin tocar un Google Sheet real.
//
//  ALCANCE (verificado con grep sobre el .gs — no hay un solo
//  servicio inventado acá):
//    SpreadsheetApp.getActiveSpreadsheet() · .getUi() · .BorderStyle.SOLID
//    LockService.getScriptLock()  (waitLock / releaseLock)
//    Session.getScriptTimeZone()
//    Utilities.formatDate()
//    GmailApp.sendEmail() · Logger.log()
//    HtmlService.createHtmlOutput() / .setTitle / .setXFrameOptionsMode
//    ContentService.createTextOutput() / .setMimeType
//  v3 agrega: PropertiesService.getScriptProperties() · CacheService.getScriptCache()
//    ScriptApp.getService().getUrl() · Utilities.getUuid() · hoja.deleteRow()
//  Mis Finanzas 2.4 agrega: MailApp.sendEmail({...}) · Utilities.newBlob().getAs().setName()
//    ScriptApp.getProjectTriggers() / newTrigger().timeBased().everyDays().atHour().create() / deleteTrigger()
//  Y en hojas: getRange · getValues · getValue · setValue · setValues ·
//    setBackground · setFontColor · setFontWeight · setHorizontalAlignment ·
//    setNumberFormat · setBorder · getDataRange · getLastRow · appendRow ·
//    getSheetByName · insertSheet · getSheet · getSheets · setFrozenRows
//
//  LO QUE NO ESTÁ (y es intencional): cualquier otra cosa que existiría
//  en Apps Script. Un fake que implementa de más esconde bugs; uno que
//  implementa de menos falla ruidosamente al usarse.
// ═══════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────
//  MODELO DE HOJA EN MEMORIA
//  Matriz densa, índices 1-based como Sheets. Una celda vacía es "".
// ───────────────────────────────────────────────────────────────
function HojaFake(nombre, datos) {
  this.nombre  = nombre;
  this.datos   = (datos || []).map(f => f.slice());
  this.congelada = 0;
  this.ultimaFilaUsada = null;
}

HojaFake.prototype.getName = function () { return this.nombre; };
HojaFake.prototype.setName = function (n) { this.nombre = n; };
HojaFake.prototype.setFrozenRows = function () { return this; };

// Última fila con contenido (1-based). 0 si la hoja está vacía.
HojaFake.prototype.getLastRow = function () {
  let ultima = 0;
  for (let i = 0; i < this.datos.length; i++) {
    const fila = this.datos[i] || [];
    for (let j = 0; j < fila.length; j++) {
      const v = fila[j];
      if (v !== "" && v !== null && v !== undefined) { ultima = i + 1; break; }
    }
  }
  return ultima;
};

HojaFake.prototype.getLastColumn = function () {
  let max = 0;
  for (let i = 0; i < this.datos.length; i++) {
    const fila = this.datos[i] || [];
    for (let j = 0; j < fila.length; j++) {
      const v = fila[j];
      if (v !== "" && v !== null && v !== undefined) { if (j + 1 > max) max = j + 1; }
    }
  }
  return max;
};

// maxFilas simula el tamaño de la grilla (filas vacías incluidas); por defecto 1000 como una hoja nueva
HojaFake.prototype.getMaxRows = function () { return Math.max(this.maxFilas === undefined ? 1000 : this.maxFilas, this.datos.length); };
HojaFake.prototype.getMaxColumns = function () { return Math.max(26, this.getLastColumn()); };

// Agrega filas al final. Acepta un array de filas (fila) o un solo array (celda).
HojaFake.prototype.appendRow = function (arr) {
  if (!Array.isArray(arr)) arr = [arr];
  this.datos.push(arr.slice());
  return this;
};

HojaFake.prototype.setColumnWidth = function () { return this; };
HojaFake.prototype.autoResizeColumns = function () { return this; };
HojaFake.prototype.hideSheet = function () { this.oculta = true; return this; };
HojaFake.prototype.showSheet = function () { this.oculta = false; return this; };
HojaFake.prototype.isSheetHidden = function () { return !!this.oculta; };
// Como en Sheets: borra filas de la grilla (y su contenido); lo sobrante se considera vacío
HojaFake.prototype.deleteRows = function (desde, n) {
  if (!(desde >= 1) || !(n >= 1)) throw new Error("deleteRows: posición o cantidad inválida");
  if (this.maxFilas !== undefined) this.maxFilas = Math.max(1, this.maxFilas - n);
  if (desde <= this.datos.length) this.datos.splice(desde - 1, n);
  return this;
};
HojaFake.prototype.deleteRow = function (n) { if (n >= 1 && n <= this.datos.length) this.datos.splice(n - 1, 1); return this; };
HojaFake.prototype.clear = function () { this.datos = []; return this; };

// ───────────────────────────────────────────────────────────────
//  RANGO — chainable, igual que Sheets (setValue devuelve el rango)
// ───────────────────────────────────────────────────────────────
function _asegurar(hoja, f, c) {
  while (hoja.datos.length < f) hoja.datos.push([]);
  const fila = hoja.datos[f - 1];
  while (fila.length < c) fila.push("");
  return fila;
}

function _leer(hoja, f, c) {
  const fila = hoja.datos[f - 1];
  if (!fila) return "";
  const v = fila[c - 1];
  return (v === undefined || v === null) ? "" : v;
}

function RangoFake(hoja, fila, col, numFilas, numCols) {
  this._hoja = hoja; this._f = fila; this._c = col;
  this._nf = numFilas; this._nc = numCols;
}

RangoFake.prototype.getValues = function () {
  const out = [];
  for (let i = 0; i < this._nf; i++) {
    const fila = [];
    for (let j = 0; j < this._nc; j++) fila.push(_leer(this._hoja, this._f + i, this._c + j));
    out.push(fila);
  }
  return out;
};

RangoFake.prototype.getValue = function () { return _leer(this._hoja, this._f, this._c); };
RangoFake.prototype.getDisplayValue = function () { return String(this.getValue()); };
RangoFake.prototype.getText = function () { return String(this.getValue()); };
RangoFake.prototype.getNumberFormat = function () { return this._nfFMT || "General"; };
RangoFake.prototype.getFontWeight = function () { return this._fontWeight || "normal"; };

// Como Google Sheets: un texto que empieza con ' se guarda sin el apóstrofo; uno que empieza con
// = (o con + - @ y no es un número) se interpreta como fórmula: aquí queda "#ERROR!" para notarlo.
function _comoSheets(v) {
  if (typeof v !== "string") return v;
  if (v.charAt(0) === "'") return v.slice(1);
  if (/^=/.test(v) || (/^[+\-@]/.test(v) && isNaN(Number(v)))) return "#ERROR!";
  return v;
}
RangoFake.prototype.setValue = function (v) {
  _asegurar(this._hoja, this._f, this._c)[this._c - 1] = _comoSheets(v);
  return this;
};

RangoFake.prototype.setValues = function (matriz) {
  for (let i = 0; i < this._nf; i++) {
    const fila = matriz[i] || [];
    const destino = _asegurar(this._hoja, this._f + i, this._c + this._nc - 1);
    for (let j = 0; j < this._nc; j++) destino[this._c - 1 + j] = (fila[j] === undefined) ? "" : _comoSheets(fila[j]);
  }
  return this;
};

RangoFake.prototype.clearContent = function () {
  for (let i = 0; i < this._nf; i++) {
    const fila = _asegurar(this._hoja, this._f + i, this._c + this._nc - 1);
    for (let j = 0; j < this._nc; j++) fila[this._c - 1 + j] = "";
  }
  return this;
};
RangoFake.prototype.clearContents = function () { return this.clearContent(); };

// Formato: se guardan como metadato del rango, no afectan los valores.
RangoFake.prototype.setNumberFormat = function (f) { this._nfFMT = f; return this; };
RangoFake.prototype.setFontWeight     = function (f) { this._fontWeight = f; return this; };
RangoFake.prototype.setFontColor      = function () { return this; };
RangoFake.prototype.setFontFamily     = function () { return this; };
RangoFake.prototype.setFontSize       = function () { return this; };
RangoFake.prototype.setBackground     = function () { return this; };
RangoFake.prototype.setBorder         = function () { return this; };
RangoFake.prototype.setHorizontalAlignment = function () { return this; };
RangoFake.prototype.setVerticalAlignment   = function () { return this; };
RangoFake.prototype.setWrap          = function () { return this; };
RangoFake.prototype.setNote          = function () { return this; };
RangoFake.prototype.setDataValidation = function () { return this; };
RangoFake.prototype.insertCellsAbove = function (n) {
  for (let k = 0; k < n; k++) this._hoja.datos.splice(this._f - 1, 0, []);
  return this;
};

// getRange acepta (fila,col), (fila,col,numFilas,numCols) o "A1:C5"
HojaFake.prototype.getRange = function (a, b, c, d) {
  if (typeof a === "string") {
    const ref = rangoA1(a);
    return new RangoFake(this, ref.f, ref.c, ref.nf, ref.nc);
  }
  if (b === undefined) return new RangoFake(this, 1, 1, this.getLastRow() || 1, this.getLastColumn() || 1);
  if (c === undefined) return new RangoFake(this, a, b, 1, 1);
  return new RangoFake(this, a, b, c, d === undefined ? 1 : d);
};

HojaFake.prototype.getDataRange = function () {
  const nf = this.getLastRow();
  const nc = this.getLastColumn();
  if (!nf || !nc) return new RangoFake(this, 1, 1, 0, 0);
  return new RangoFake(this, 1, 1, nf, nc);
};

function colALetra(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function letraACol(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function rangoA1(ref) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(ref.trim());
  if (!m) return { f: 1, c: 1, nf: 1, nc: 1 };
  const f = parseInt(m[2], 10), c = letraACol(m[1]);
  if (!m[3]) return { f, c, nf: 1, nc: 1 };
  const f2 = parseInt(m[4], 10), c2 = letraACol(m[3]);
  return { f, c, nf: f2 - f + 1, nc: c2 - c + 1 };
}


// ───────────────────────────────────────────────────────────────
//  SPREADSHEET
// ───────────────────────────────────────────────────────────────
function SpreadsheetFake(nombre) {
  this.nombre = nombre || "SistemaPedidos";
  this.hojas  = [];
  this.id     = "FAKE_SS_1";
}
SpreadsheetFake.prototype.getName = function () { return this.nombre; };
SpreadsheetFake.prototype.getId   = function () { return this.id; };
SpreadsheetFake.prototype.getUrl  = function () { return "https://docs.google.com/spreadsheets/d/" + this.id + "/edit"; };
SpreadsheetFake.prototype.getSheets = function () { return this.hojas; };
SpreadsheetFake.prototype.getSheetByName = function (n) {
  return this.hojas.find(h => h.getName() === n) || null;
};
SpreadsheetFake.prototype.getSheet = function (n) {
  const h = this.getSheetByName(n);
  if (!h) throw new Error("Hoja no encontrada: " + n);
  return h;
};
SpreadsheetFake.prototype.insertSheet = function (n) {
  const h = new HojaFake(n, []);
  this.hojas.push(h);
  return h;
};
// Como en Apps Script: recibe la hoja (Sheet), no su nombre
SpreadsheetFake.prototype.deleteSheet = function (hoja) {
  if (!(hoja instanceof HojaFake)) throw new Error("deleteSheet espera una hoja (Sheet), no " + typeof hoja);
  const i = this.hojas.indexOf(hoja);
  if (i >= 0) this.hojas.splice(i, 1);
  return this;
};
SpreadsheetFake.prototype.getActiveSheet = function () { return this.hojas[0] || null; };


// ───────────────────────────────────────────────────────────────
//  SERVICIOS
// ───────────────────────────────────────────────────────────────
function crearLock(caja) {
  return {
    waitLock(ms)      { caja.waitLock++; caja.waitLockMs.push(ms); return true; },
    releaseLock()     { caja.releaseLock++; return true; },
    tryLock(ms)       { caja.tryLock++; return true; },
    getDocumentLock() { return this; },
    getScriptLock()   { return this; },
  };
}

function formatearFecha(fecha, tz, fmt) {
  const d = (fecha instanceof Date) ? fecha : new Date(fecha);
  const p = (n, w) => String(n).padStart(w || 2, "0");
  switch (fmt) {
    case "dd/MM/yyyy": return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
    case "yyyy-MM-dd": return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    case "HH:mm":      return p(d.getHours()) + ":" + p(d.getMinutes());
    default:           return d.toString();
  }
}

/**
 * crearEntorno() — construye un entorno de simulación nuevo y aislado.
 * Devuelve tanto los servicios (para inyectar en el contexto de vm)
 * como las cajas donde quedan registradas las escrituras laterales
 * (correos, logs, alertas, locks), para poder asertar sobre ellas.
 */
function crearEntorno(opciones) {
  const op = opciones || {};
  const ss = new SpreadsheetFake(op.nombre || "SistemaPedidos");

  // Hojas base con la estructura real de la plantilla
  (op.hojas || []).forEach(h => ss.hojas.push(new HojaFake(h.nombre, h.datos)));

  const caja = {
    ss: ss,
    correos: [],     // GmailApp.sendEmail y MailApp.sendEmail
    activadores: [], // ScriptApp.newTrigger
    logs: [],        // Logger.log
    alertas: [],     // ui.alert
    libros: [],      // SpreadsheetApp.create
    dialogos: [],    // ui.showModalDialog
    waitLock: 0, waitLockMs: [], releaseLock: 0, tryLock: 0,
    // la simulación no carga el catálogo de demostración salvo que se pida (op.demo)
    props: Object.assign(op.demo ? {} : { PA_DEMO_OFF: "1" }, op.props || {}), cache: {}, menus: [],
  };

  const servicios = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      // planillas nuevas (p. ej. el archivo de pedidos): quedan en caja.libros
      create: (nombre) => { const l = new SpreadsheetFake(nombre); l.id = "FAKE_SS_" + (caja.libros.length + 2); l.hojas.push(new HojaFake("Hoja 1", [])); caja.libros.push(l); return l; },
      openById: (id) => { const l = id === ss.id ? ss : caja.libros.find(x => x.id === id); if (!l) throw new Error("No se encontró la planilla " + id); return l; },
      getActive: () => ss,
      getUi: () => ({
        createMenu: (nombre) => {
          const m = { nombre: nombre, items: [] };
          const api = { addItem: (t, f) => { m.items.push([t, f]); return api; }, addSeparator: () => api, addToUi: () => { caja.menus.push(m); return api; } };
          return api;
        },
        alert: (msg) => { caja.alertas.push(String(msg)); return msg; },
        showModalDialog: (html, titulo) => { caja.dialogos.push({ html, titulo }); return titulo; },
        prompt: () => null,
        Button: { SET: "SET", CANCEL: "CANCEL", YES: "YES", NO: "NO", OK: "OK" },
      }),
      getActiveUser: () => ({ getEmail: () => "dueno@negocio.cl" }),
      BorderStyle: { SOLID: "SOLID", DOTTED: "DOTTED", DASHED: "DASHED", NONE: "NONE" },
      getActiveRange: () => null,
    },

    LockService: { getScriptLock: () => crearLock(caja), getDocumentLock: () => crearLock(caja) },

    Session: {
      getScriptTimeZone: () => "America/Santiago",
      getActiveUser: () => ({ getEmail: () => "dueno@negocio.cl" }),
    },

    Utilities: { formatDate: formatearFecha, sleep: () => {},
      // newBlob(html).getAs("application/pdf") devuelve un blob marcado como PDF que conserva el HTML de origen
      newBlob: (datos, tipo, nombre) => {
        const blob = (contenido, mime, n) => ({ contenido: contenido, mime: mime, nombre: n,
          getAs: (m) => { if (m !== "application/pdf") throw new Error("getAs: el fake solo convierte a PDF"); return blob(contenido, m, n); },
          setName: function (x) { this.nombre = x; return this; }, getName: function () { return this.nombre; }, getContentType: function () { return this.mime; } });
        return blob(String(datos), tipo, nombre);
      },
      getUuid: () => {
      caja.uuids = (caja.uuids || 0) + 1;
      const h = (n) => (n * 2654435761 >>> 0).toString(16).padStart(8, "0");
      return h(caja.uuids) + "-" + h(caja.uuids + 7).slice(0, 4) + "-4" + h(caja.uuids + 13).slice(0, 3) + "-a" + h(caja.uuids + 21).slice(0, 3) + "-" + h(caja.uuids + 33) + h(caja.uuids + 41).slice(0, 4);
    } },

    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(caja.props, k) ? caja.props[k] : null),
      setProperty: function (k, v) { caja.props[k] = String(v); return this; },
      deleteProperty: function (k) { delete caja.props[k]; return this; },
      getProperties: () => Object.assign({}, caja.props),
    }) },

    // Como en Apps Script: cada valor admite como máximo 100 KB
    CacheService: { getScriptCache: () => ({
      get: (k) => (Object.prototype.hasOwnProperty.call(caja.cache, k) ? caja.cache[k] : null),
      getAll: (ks) => { const o = {}; (ks || []).forEach(k => { if (Object.prototype.hasOwnProperty.call(caja.cache, k)) o[k] = caja.cache[k]; }); return o; },
      put: (k, v) => { if (Buffer.byteLength(String(v), "utf8") > 100 * 1024) throw new Error("Argument too large: value"); caja.cache[k] = String(v); },
      putAll: (o) => { Object.keys(o).forEach(k => { if (Buffer.byteLength(String(o[k]), "utf8") > 100 * 1024) throw new Error("Argument too large: value"); }); Object.keys(o).forEach(k => { caja.cache[k] = String(o[k]); }); },
      remove: (k) => { delete caja.cache[k]; },
      removeAll: (ks) => { (ks || []).forEach(k => delete caja.cache[k]); },
    }) },

    ScriptApp: {
      getService: () => ({ getUrl: () => op.url === undefined ? "https://script.google.com/macros/s/FAKE/exec" : op.url }),
      getProjectTriggers: () => caja.activadores.slice(),
      deleteTrigger: (t) => { caja.activadores = caja.activadores.filter(x => x !== t); },
      // solo el activador de tiempo diario que usa Mis Finanzas: si el .gs pide otra cosa, falla
      newTrigger: (fn) => {
        const def = { fn: fn };
        const constructor = {
          timeBased: () => constructor,
          everyDays: (n) => { def.cadaDias = n; return constructor; },
          atHour: (h) => { def.hora = h; return constructor; },
          create: () => { const t = { getHandlerFunction: () => def.fn, def: def }; caja.activadores.push(t); return t; },
        };
        return constructor;
      },
    },

    // Solo la firma de objeto ({to, subject, htmlBody, name, attachments}), que es la que usa Mis Finanzas
    MailApp: {
      sendEmail: function (o) {
        if (arguments.length !== 1 || typeof o !== "object" || !o) throw new Error("MailApp.sendEmail: el fake solo acepta un objeto");
        if (!o.to || !o.subject) throw new Error("MailApp.sendEmail: falta destinatario o asunto");
        caja.correos.push(Object.assign({ servicio: "MailApp" }, o));
      },
    },

    // Acepta las dos firmas que usa el .gs: posicional (destino, asunto, cuerpo)
    // y de objeto ({to, subject, body, htmlBody}).
    GmailApp: {
      sendEmail: function () {
        if (arguments.length === 1 && typeof arguments[0] === "object" && arguments[0] !== null) {
          caja.correos.push(Object.assign({}, arguments[0]));
        } else {
          caja.correos.push({ to: arguments[0], subject: arguments[1], body: arguments[2], options: arguments[3] });
        }
        return caja.correos[caja.correos.length - 1];
      },
    },

    Logger: { log: (msg) => { caja.logs.push(String(msg)); } },

    HtmlService: {
      XFrameOptionsMode: { DEFAULT: "DEFAULT", ALLOWALL: "ALLOWALL" },
      createHtmlOutput: (html) => ({
        _html: html, _titulo: "", _xframe: "DEFAULT",
        setTitle(t) { this._titulo = t; return this; },
        setXFrameOptionsMode(m) { this._xframe = m; return this; },
        getContent() { return this._html; },
        getTitle() { return this._titulo; },
        getXFrameOptionsMode() { return this._xframe; },
        addMetaTag() { return this; },
        setWidth() { return this; },
        setHeight() { return this; },
      }),
    },

    ContentService: {
      MimeType: { JSON: "application/json", TEXT: "text/plain", HTML: "text/html" },
      createTextOutput: (txt) => ({
        _txt: txt, _mime: "text/plain",
        setMimeType(m) { this._mime = m; return this; },
        getContent() { return this._txt; },
        getMimeType() { return this._mime; },
      }),
    },
  };

  return { ss: ss, caja: caja, servicios: servicios };
}

module.exports = {
  crearEntorno: crearEntorno,
  SpreadsheetFake: SpreadsheetFake,
  HojaFake: HojaFake,
  RangoFake: RangoFake,
  colALetra: colALetra,
  letraACol: letraACol,
};

  window.GasFakes = module.exports;
})();
