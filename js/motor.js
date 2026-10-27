// GENERADO por simulacion/construir_app.js — no editar a mano desde Markdown/FinanzApp_AmbilorLab.gs
window.FA_crearMotor = function (G) {
  var SpreadsheetApp = G.SpreadsheetApp, LockService = G.LockService, Session = G.Session, Utilities = G.Utilities, PropertiesService = G.PropertiesService, CacheService = G.CacheService, ScriptApp = G.ScriptApp, MailApp = G.MailApp, GmailApp = G.GmailApp, Logger = G.Logger, HtmlService = G.HtmlService, ContentService = G.ContentService;
/* ═══════════════════════════════════════════════════════════════════════
   Mis Finanzas · Ambilor.Lab — finanzas personales en Google Sheets
   ───────────────────────────────────────────────────────────────────────
   Presupuesto por categoría, metas de ahorro, tarjetas de crédito y deudas,
   con registro rápido desde el celular (panel web).

   La planilla es la base de datos (hojas Movimientos, Categorías, Metas,
   Tarjetas, Deudas y Config). El panel web se publica como aplicación web
   "Ejecutar como: yo" y "Acceso: solo yo": solo la cuenta dueña lo abre.

   Reglas de cálculo (ver Markdown/PROYECTO_FinanzApp_AmbilorLab.md):
   - El mes parte el día de inicio configurado (por ejemplo, el día de sueldo).
   - Una compra con tarjeta en N cuotas imputa al presupuesto solo la cuota
     de cada período, durante N períodos.
   - El pago de la tarjeta NO es un gasto nuevo (la compra ya se contó).
   - El pago de una deuda sí es gasto, en la categoría "Deudas".
   - Un aporte a una meta es ahorro (no gasto); un retiro lo devuelve.
   ═══════════════════════════════════════════════════════════════════════ */

const VERSION = "3.1";   // ver CAMBIOS.md
const ESQUEMA = "1.3";

const HOJA = { MOV: "Movimientos", CAT: "Categorías", METAS: "Metas", TARJ: "Tarjetas", DEUDAS: "Deudas", FIJOS: "Fijos", CONFIG: "Config" };

const CABECERAS = {
  "Movimientos": ["ID", "Fecha", "Tipo", "Monto", "Categoría", "Medio", "Cuotas", "Meta", "Deuda", "Nota", "Registrado", "Fijo"],
  "Categorías":  ["Categoría", "Tipo", "Presupuesto", "Ícono", "Color", "Activa"],
  "Metas":       ["ID", "Meta", "Objetivo", "Fecha objetivo", "Ícono", "Activa"],
  "Tarjetas":    ["ID", "Tarjeta", "Cupo", "Día de cierre", "Día de pago", "Activa"],
  "Deudas":      ["ID", "Deuda", "Acreedor", "Cuota", "Cuotas", "Día de pago", "Inicio", "Activa", "Moneda"],
  "Fijos":       ["ID", "Fijo", "Tipo", "Monto", "Categoría", "Medio", "Día", "Activa"],
  "Config":      ["Clave", "Valor", "Descripción"],
};

// Tipos de movimiento
const TIPOS = ["Gasto", "Ingreso", "Ahorro", "Retiro de meta", "Pago tarjeta", "Pago deuda"];
const MEDIOS_BASE = ["Efectivo", "Débito", "Transferencia"];
const CAT_DEUDAS = "Deudas";

// Categorías de partida (el usuario las edita en el panel)
const CATEGORIAS_BASE = [
  ["Supermercado", "Gasto", 0, "ti-shopping-cart", "#2E9E5B"],
  ["Casa", "Gasto", 0, "ti-home", "#1F5C99"],
  ["Servicios", "Gasto", 0, "ti-bolt", "#C47A1C"],
  ["Transporte", "Gasto", 0, "ti-car", "#6A5BC7"],
  ["Comida fuera", "Gasto", 0, "ti-tools-kitchen-2", "#D0613A"],
  ["Salud", "Gasto", 0, "ti-heart", "#B5405F"],
  ["Educación", "Gasto", 0, "ti-school", "#4C8DDB"],
  ["Entretención", "Gasto", 0, "ti-device-tv", "#078C7E"],
  ["Ropa", "Gasto", 0, "ti-shirt", "#6A5BC7"],
  [CAT_DEUDAS, "Gasto", 0, "ti-building-bank", "#3E546D"],
  ["Otros", "Gasto", 0, "ti-dots", "#6B7A8F"],
  ["Sueldo", "Ingreso", 0, "ti-briefcase", "#2E9E5B"],
  ["Otros ingresos", "Ingreso", 0, "ti-plus", "#078C7E"],
];

// Paleta de categorías de la marca (1.5). Los colores de la paleta anterior se cambian
// solos al abrir la planilla; un color elegido fuera de esa paleta no se toca.
const COLOR_MARCA_ = { "#34A853": "#2E9E5B", "#4C8DDB": "#1F5C99", "#F0A63A": "#C47A1C", "#7C5CF0": "#6A5BC7", "#E8710A": "#D0613A",
  "#D93025": "#B5405F", "#1A73E8": "#4C8DDB", "#C2185B": "#078C7E", "#00897B": "#6A5BC7", "#5F6368": "#3E546D", "#80868B": "#6B7A8F",
  "#188038": "#2E9E5B", "#137333": "#078C7E" };

const CONFIG_CAMPOS = [
  ["nombre", "texto", "", "Tu nombre (para el saludo del panel)"],
  ["inicioMes", "numero", 1, "Día en que parte tu mes (1 a 28), por ejemplo el día de sueldo"],
  ["alertaPct", "numero", 80, "Avisar cuando una categoría llegue a este % de su presupuesto"],
  ["diasAviso", "numero", 7, "Mostrar pagos de tarjetas y deudas que vencen en estos días"],
  ["valorUF", "numero", 0, "Valor de la UF a mano (0 = se trae solo cada día desde mindicador.cl)"],
  ["correoResumen", "texto", "", "Correo donde llega el resumen de cada mes, con PDF (vacío = no se envía)"],
  ["recordatorioHora", "numero", 0, "Hora del recordatorio diario por correo, solo si ese día no registraste nada (0 = no se envía)"],
];

/* ── utilidades ─────────────────────────────────────────────────────── */
function texto_(v) { return v === null || v === undefined ? "" : String(v).trim(); }
function numero_(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  const s = texto_(v).replace(/\$/g, "").replace(/\s/g, "");
  if (!s) return NaN;
  // formato chileno: 1.234.567 o 1234,5
  const limpio = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\./g, "").replace(/,/g, "");
  const n = Number(limpio);
  return isFinite(n) ? n : NaN;
}
// Número con decimales (cuota en UF): "12,3456" · "12.35" · 12.35
function decimal_(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  let s = texto_(v).replace(/\s/g, "").replace(/^UF/i, ""); if (!s) return NaN;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (!/^\d+\.\d{1,4}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s); return isFinite(n) ? n : NaN;
}
function esSi_(v) { const s = texto_(v).toLowerCase(); return v === true || s === "si" || s === "sí" || s === "true" || s === "1"; }
function falla_(msg, campo) { return { ok: false, error: msg, campo: campo || "" }; }
function clp_(n) { const v = Math.round(Number(n) || 0); return (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("es-CL"); }
// reloj del sistema (las pruebas lo reemplazan para fijar "hoy")
function ahora_() { return new Date(); }
// Rendimiento (2026-10-18): la zona y las partes de cada fecha se calculan una vez por ejecución.
// Antes, cada período de cada movimiento llamaba a Session y a Utilities.formatDate (decenas de miles
// de veces con muchos datos: segundos en Apps Script).
var ZONA_ = null;
function zona_() { return ZONA_ || (ZONA_ = Session.getScriptTimeZone() || "America/Santiago"); }
// fecha "yyyy-MM-dd" en la zona del script
function iso_(d) { return Utilities.formatDate(d, zona_(), "yyyy-MM-dd"); }
// "yyyy-MM-dd" → Date a mediodía (evita saltos por zona horaria)
function deIso_(s) { const m = texto_(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null; }
function fechaDe_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const s = texto_(v); if (!s) return null;
  const iso = deIso_(s.slice(0, 10)); if (iso) return iso;
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  const d = new Date(s); return isNaN(d) ? null : d;
}
var PARTES_ = new Map();
function partes_(d) {
  const k = d.getTime(); let p = PARTES_.get(k);
  if (!p) { const s = iso_(d).split("-"); p = { a: Number(s[0]), m: Number(s[1]), d: Number(s[2]) }; if (PARTES_.size > 60000) PARTES_.clear(); PARTES_.set(k, p); }
  return { a: p.a, m: p.m, d: p.d };
}
function diasMes_(a, m) { return new Date(a, m, 0).getDate(); }   // m: 1-12
function idNuevo_(prefijo) { return prefijo + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }

/* ── hojas ──────────────────────────────────────────────────────────── */
function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function hoja_(nombre) { return libro_().getSheetByName(nombre); }
// Lecturas de hoja guardadas durante una misma ejecución: panelDatos usa
// Movimientos en cinco cálculos y así se lee una sola vez. Toda escritura la vacía.
var LECTURAS_ = {};
function olvidarLecturas_() { LECTURAS_ = {}; }
// Lee una hoja como objetos {Cabecera: valor, _fila}. Completa columnas faltantes.
function tabla_(nombre) {
  if (LECTURAS_[nombre]) return LECTURAS_[nombre];
  const t = leerTabla_(nombre); if (t) LECTURAS_[nombre] = t;
  return t;
}
function leerTabla_(nombre) {
  const h = hoja_(nombre); if (!h) return null;
  const valores = h.getDataRange().getValues();
  const cab = (valores[0] || []).map(texto_);
  const filas = [];
  for (let i = 1; i < valores.length; i++) {
    const f = valores[i]; if (!f.some(v => texto_(v) !== "")) continue;
    const o = { _fila: i + 1 }; cab.forEach((c, j) => { if (c) o[c] = f[j]; }); filas.push(o);
  }
  return { hoja: h, cab: cab, filas: filas };
}
// Un texto que empieza con = + - @ Sheets lo tomaría como fórmula: con ' delante queda como texto
// (el apóstrofo no se ve ni se lee de vuelta). Todo lo que se escribe pasa por aquí.
function celda_(v) { return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v; }
function agregarFilas_(t, objetos) {
  if (!objetos.length) return;
  olvidarLecturas_();
  const datos = objetos.map(o => t.cab.map(c => (o[c] === undefined ? "" : celda_(o[c]))));
  const desde = t.hoja.getLastRow() + 1;
  t.hoja.getRange(desde, 1, datos.length, t.cab.length).setValues(datos);
}
function escribirFila_(t, fila, o) {
  olvidarLecturas_();
  const actual = t.hoja.getRange(fila, 1, 1, t.cab.length).getValues()[0];
  const nueva = t.cab.map((c, j) => celda_(o[c] === undefined ? actual[j] : o[c]));
  t.hoja.getRange(fila, 1, 1, t.cab.length).setValues([nueva]);
}
function reemplazarDatos_(t, objetos) {
  olvidarLecturas_();
  const h = t.hoja, ultima = h.getLastRow();
  if (ultima > 1) h.getRange(2, 1, ultima - 1, t.cab.length).setValues(Array.from({ length: ultima - 1 }, () => t.cab.map(() => "")));
  agregarFilas_(Object.assign({}, t, { hoja: h }), objetos);
}
function crearHojaSiFalta_(nombre, cambios) {
  olvidarLecturas_();
  let h = hoja_(nombre);
  if (!h) {
    h = libro_().insertSheet(nombre);
    h.getRange(1, 1, 1, CABECERAS[nombre].length).setValues([CABECERAS[nombre]]).setFontWeight("bold");
    h.setFrozenRows(1);
    cambios.push("Hoja " + nombre + " creada");
    return true;
  }
  // columnas que falten se agregan al final
  const cab = h.getRange(1, 1, 1, Math.max(1, h.getLastColumn())).getValues()[0].map(texto_);
  CABECERAS[nombre].forEach(c => { if (cab.indexOf(c) < 0) { h.getRange(1, cab.length + 1).setValue(c).setFontWeight("bold"); cab.push(c); cambios.push("Columna " + c + " agregada a " + nombre); } });
  return false;
}
function asegurarEstructura_() {
  const props = PropertiesService.getScriptProperties();
  const previo = props.getProperty("FA_ESQUEMA");
  if (previo === ESQUEMA && hoja_(HOJA.MOV)) return [];
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cambios = [];
    Object.keys(CABECERAS).forEach(n => {
      const nueva = crearHojaSiFalta_(n, cambios);
      if (nueva && n === HOJA.CAT) agregarFilas_(tabla_(HOJA.CAT), CATEGORIAS_BASE.map(c => ({ "Categoría": c[0], "Tipo": c[1], "Presupuesto": c[2], "Ícono": c[3], "Color": c[4], "Activa": "Si" })));
      if (n === HOJA.CONFIG) { const t = tabla_(HOJA.CONFIG), hay = t.filas.map(f => texto_(f.Clave)); const faltan = CONFIG_CAMPOS.filter(c => hay.indexOf(c[0]) < 0); if (faltan.length) { agregarFilas_(t, faltan.map(c => ({ "Clave": c[0], "Valor": c[2], "Descripción": c[3] }))); if (!nueva) cambios.push("Ajustes nuevos: " + faltan.map(c => c[0]).join(", ")); } }
    });
    if (previo && Number(previo) < 1.2) {   // colores de categorías a la paleta de la marca
      const t = tabla_(HOJA.CAT); let n = 0;
      t.filas.forEach(f => { const nuevo = COLOR_MARCA_[texto_(f.Color).toUpperCase()]; if (nuevo) { escribirFila_(t, f._fila, { "Color": nuevo }); n++; } });
      if (n) cambios.push("Colores de " + n + " categorías a la paleta de la marca");
    }
    const mov = hoja_(HOJA.MOV); if (mov) { mov.getRange("B:B").setNumberFormat("dd-mm-yyyy"); mov.getRange("D:D").setNumberFormat("$#,##0"); }
    props.setProperty("FA_ESQUEMA", ESQUEMA);
    return cambios;
  } finally { lock.releaseLock(); }
}

/* ── lectura del modelo ─────────────────────────────────────────────── */
function config_() {
  const t = tabla_(HOJA.CONFIG), cfg = {};
  CONFIG_CAMPOS.forEach(c => { cfg[c[0]] = c[2]; });
  if (t) t.filas.forEach(f => { const k = texto_(f.Clave); if (!k) return; const def = CONFIG_CAMPOS.find(c => c[0] === k); cfg[k] = def && def[1] === "numero" ? (isNaN(numero_(f.Valor)) ? def[2] : numero_(f.Valor)) : texto_(f.Valor); });
  cfg.inicioMes = Math.min(28, Math.max(1, Math.round(cfg.inicioMes) || 1));
  cfg.alertaPct = Math.min(100, Math.max(1, Math.round(cfg.alertaPct) || 80));
  cfg.diasAviso = Math.min(31, Math.max(1, Math.round(cfg.diasAviso) || 7));
  cfg.valorUF = Math.max(0, Number(cfg.valorUF) || 0);
  cfg.recordatorioHora = Math.round(cfg.recordatorioHora) >= 1 && Math.round(cfg.recordatorioHora) <= 23 ? Math.round(cfg.recordatorioHora) : 0;
  return cfg;
}
function categorias_() {
  const t = tabla_(HOJA.CAT); if (!t) return [];
  return t.filas.map(f => ({ nombre: texto_(f["Categoría"]), tipo: texto_(f.Tipo) === "Ingreso" ? "Ingreso" : "Gasto", presupuesto: Math.max(0, numero_(f.Presupuesto) || 0), icono: texto_(f["Ícono"]) || "ti-tag", color: texto_(f.Color) || "#6B7A8F", activa: texto_(f.Activa) === "" ? true : esSi_(f.Activa), _fila: f._fila })).filter(c => c.nombre);
}
function metas_() {
  const t = tabla_(HOJA.METAS); if (!t) return [];
  return t.filas.map(f => ({ id: texto_(f.ID), nombre: texto_(f.Meta), objetivo: Math.max(0, numero_(f.Objetivo) || 0), fecha: fechaDe_(f["Fecha objetivo"]), icono: texto_(f["Ícono"]) || "ti-target", activa: texto_(f.Activa) === "" ? true : esSi_(f.Activa), _fila: f._fila })).filter(m => m.id && m.nombre);
}
function tarjetas_() {
  const t = tabla_(HOJA.TARJ); if (!t) return [];
  return t.filas.map(f => ({ id: texto_(f.ID), nombre: texto_(f.Tarjeta), cupo: Math.max(0, numero_(f.Cupo) || 0), cierre: Math.round(numero_(f["Día de cierre"]) || 0), pago: Math.round(numero_(f["Día de pago"]) || 0), activa: texto_(f.Activa) === "" ? true : esSi_(f.Activa), _fila: f._fila })).filter(x => x.id && x.nombre);
}
function deudas_() {
  const t = tabla_(HOJA.DEUDAS); if (!t) return [];
  return t.filas.map(f => ({ id: texto_(f.ID), nombre: texto_(f.Deuda), acreedor: texto_(f.Acreedor), cuota: Math.max(0, numero_(f.Cuota) || 0), cuotas: Math.max(0, Math.round(numero_(f.Cuotas) || 0)), pago: Math.round(numero_(f["Día de pago"]) || 0), inicio: fechaDe_(f.Inicio), moneda: texto_(f.Moneda).toUpperCase() === "UF" ? "UF" : "CLP", activa: texto_(f.Activa) === "" ? true : esSi_(f.Activa), _fila: f._fila })).filter(x => x.id && x.nombre);
}
function fijos_() {
  const t = tabla_(HOJA.FIJOS); if (!t) return [];
  return t.filas.map(f => ({ id: texto_(f.ID), nombre: texto_(f.Fijo), tipo: texto_(f.Tipo) === "Ingreso" ? "Ingreso" : "Gasto", monto: Math.max(0, Math.round(numero_(f.Monto) || 0)), categoria: texto_(f["Categoría"]), medio: texto_(f.Medio), dia: Math.min(31, Math.max(1, Math.round(numero_(f["Día"]) || 1))), activa: texto_(f.Activa) === "" ? true : esSi_(f.Activa), _fila: f._fila })).filter(x => x.id && x.nombre);
}
// Los movimientos se convierten una vez por lectura de la hoja (panelDatos los usa en ~12 cálculos)
function movimientos_() {
  const t = tabla_(HOJA.MOV); if (!t) return [];
  if (t._movs) return t._movs.slice();
  t._movs = t.filas.map(f => ({ id: texto_(f.ID), fecha: fechaDe_(f.Fecha), tipo: TIPOS.indexOf(texto_(f.Tipo)) >= 0 ? texto_(f.Tipo) : "Gasto", monto: Math.abs(numero_(f.Monto) || 0), categoria: texto_(f["Categoría"]), medio: texto_(f.Medio), cuotas: Math.max(1, Math.round(numero_(f.Cuotas) || 1)), meta: texto_(f.Meta), deuda: texto_(f.Deuda), nota: texto_(f.Nota), fijo: texto_(f.Fijo), _fila: f._fila })).filter(m => m.fecha && m.monto > 0);
  return t._movs.slice();
}

/* ── períodos (el mes parte el día de inicio) ───────────────────────── */
// Índice continuo del período que contiene la fecha: año*12 + mes(0-11) del mes en que PARTE
function indicePeriodo_(fecha, inicio) {
  const p = partes_(fecha); let a = p.a, m = p.m - 1;
  if (p.d < inicio) { m--; if (m < 0) { m = 11; a--; } }
  return a * 12 + m;
}
function rangoPeriodo_(indice, inicio) {
  const a = Math.floor(indice / 12), m = indice % 12;
  const desde = new Date(a, m, inicio, 0, 0, 0), hasta = new Date(a, m + 1, inicio, 0, 0, 0);
  hasta.setDate(hasta.getDate() - 1);
  return { indice: indice, desde: iso_(desde), hasta: iso_(hasta), nombre: nombrePeriodo_(indice, inicio) };
}
var MESES_ = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function nombrePeriodo_(indice, inicio) {
  const a = Math.floor(indice / 12), m = indice % 12;
  if (inicio === 1) return MESES_[m].charAt(0).toUpperCase() + MESES_[m].slice(1) + " " + a;
  const m2 = (m + 1) % 12;
  return inicio + " " + MESES_[m].slice(0, 3) + " – " + (inicio - 1) + " " + MESES_[m2].slice(0, 3);
}
// Monto que una compra imputa al período: al contado, todo en su período; en cuotas, monto/N en N períodos
function imputado_(mov, indice, inicio) {
  const i0 = indicePeriodo_(mov.fecha, inicio), n = mov.cuotas || 1;
  if (n <= 1) return i0 === indice ? mov.monto : 0;
  if (indice < i0 || indice >= i0 + n) return 0;
  const base = Math.floor(mov.monto / n), resto = mov.monto - base * n;
  return indice === i0 ? base + resto : base;   // el redondeo queda en la primera cuota
}

/* ── resumen del período ────────────────────────────────────────────── */
function resumen_(indice, ahora) {
  const cfg = config_(), cats = categorias_(), movs = movimientos_(), hoy = ahora || ahora_();
  if (indice === undefined || indice === null) indice = indicePeriodo_(hoy, cfg.inicioMes);
  const rango = rangoPeriodo_(indice, cfg.inicioMes);
  const porCat = {}; cats.forEach(c => { porCat[c.nombre] = 0; });
  let ingresos = 0, gastos = 0, ahorro = 0;
  movs.forEach(mv => {
    if (mv.tipo === "Gasto") { const v = imputado_(mv, indice, cfg.inicioMes); if (v) { gastos += v; porCat[mv.categoria] = (porCat[mv.categoria] || 0) + v; } return; }
    if (indicePeriodo_(mv.fecha, cfg.inicioMes) !== indice) return;
    if (mv.tipo === "Ingreso") ingresos += mv.monto;
    else if (mv.tipo === "Pago deuda") { gastos += mv.monto; porCat[CAT_DEUDAS] = (porCat[CAT_DEUDAS] || 0) + mv.monto; }
    else if (mv.tipo === "Ahorro") ahorro += mv.monto;
    else if (mv.tipo === "Retiro de meta") ahorro -= mv.monto;
    // "Pago tarjeta" no es gasto: la compra ya se contó
  });
  // lo gastado en cada categoría el período anterior (para comparar; mismas reglas: cuotas imputadas y pagos de deuda)
  const antes = {};
  movs.forEach(mv => {
    if (mv.tipo === "Gasto") { const v = imputado_(mv, indice - 1, cfg.inicioMes); if (v) antes[mv.categoria] = (antes[mv.categoria] || 0) + v; return; }
    if (mv.tipo === "Pago deuda" && indicePeriodo_(mv.fecha, cfg.inicioMes) === indice - 1) antes[CAT_DEUDAS] = (antes[CAT_DEUDAS] || 0) + mv.monto;
  });
  const presupuesto = cats.filter(c => c.tipo === "Gasto" && c.activa).map(c => {
    const g = porCat[c.nombre] || 0, pct = c.presupuesto > 0 ? Math.round(g * 100 / c.presupuesto) : null;
    return { nombre: c.nombre, icono: c.icono, color: c.color, presupuesto: c.presupuesto, gastado: g, anterior: antes[c.nombre] || 0, pct: pct, estado: pct === null ? "sin" : (g > c.presupuesto ? "excedido" : (pct >= cfg.alertaPct ? "alerta" : "ok")) };
  });
  // gastos en categorías que ya no existen o inactivas, para que el total cuadre
  Object.keys(porCat).forEach(n => { if (porCat[n] && !presupuesto.some(p => p.nombre === n)) presupuesto.push({ nombre: n || "Sin categoría", icono: "ti-tag", color: "#6B7A8F", presupuesto: 0, gastado: porCat[n], anterior: antes[n] || 0, pct: null, estado: "sin" }); });
  const totalPres = presupuesto.reduce((a, p) => a + p.presupuesto, 0);
  return {
    periodo: rango, ingresos: ingresos, gastos: gastos, ahorro: ahorro, disponible: ingresos - gastos - ahorro,
    presupuestoTotal: totalPres, presupuestoRestante: totalPres - presupuesto.filter(p => p.presupuesto > 0).reduce((a, p) => a + p.gastado, 0),
    presupuesto: presupuesto.sort((a, b) => (b.presupuesto > 0) - (a.presupuesto > 0) || b.gastado - a.gastado),
    alertas: presupuesto.filter(p => p.estado === "alerta" || p.estado === "excedido").map(p => ({ nombre: p.nombre, pct: p.pct, estado: p.estado, restante: p.presupuesto - p.gastado })),
  };
}

/* ── metas ──────────────────────────────────────────────────────────── */
function estadoMetas_(ahora) {
  const movs = movimientos_(), hoy = ahora || ahora_();
  return metas_().filter(m => m.activa).map(m => {
    const ahorrado = movs.filter(x => x.meta === m.id).reduce((a, x) => a + (x.tipo === "Retiro de meta" ? -x.monto : (x.tipo === "Ahorro" ? x.monto : 0)), 0);
    const falta = Math.max(0, m.objetivo - ahorrado), pct = m.objetivo > 0 ? Math.min(100, Math.round(ahorrado * 100 / m.objetivo)) : 0;
    let meses = null, porMes = null;
    if (m.fecha) { const a = partes_(hoy), b = partes_(m.fecha); meses = Math.max(1, (b.a - a.a) * 12 + (b.m - a.m) + (b.d >= a.d ? 1 : 0)); porMes = falta > 0 ? Math.ceil(falta / meses) : 0; }
    return { id: m.id, nombre: m.nombre, icono: m.icono, objetivo: m.objetivo, ahorrado: ahorrado, falta: falta, pct: pct, fecha: m.fecha ? iso_(m.fecha) : "", meses: meses, porMes: porMes, lista: falta === 0 && m.objetivo > 0 };
  });
}

/* ── tarjetas y deudas ──────────────────────────────────────────────── */
// próxima fecha (>= hoy) con ese día del mes (días 29-31 se ajustan al último del mes)
function proximoDia_(dia, hoy) {
  const p = partes_(hoy); let a = p.a, m = p.m;
  let d = Math.min(dia, diasMes_(a, m));
  if (d < p.d) { m++; if (m > 12) { m = 1; a++; } d = Math.min(dia, diasMes_(a, m)); }
  return new Date(a, m - 1, d, 12, 0, 0);
}
function diasEntre_(a, b) { return Math.round((deIso_(iso_(b)) - deIso_(iso_(a))) / 86400000); }
function estadoTarjetas_(ahora) {
  const movs = movimientos_(), hoy = ahora || ahora_(), cfg = config_(), iHoy = indicePeriodo_(hoy, cfg.inicioMes);
  return tarjetas_().filter(t => t.activa).map(t => {
    const compras = movs.filter(m => m.tipo === "Gasto" && m.medio === t.nombre);
    const pagos = movs.filter(m => m.tipo === "Pago tarjeta" && m.medio === t.nombre).reduce((a, m) => a + m.monto, 0);
    const usado = Math.max(0, compras.reduce((a, m) => a + m.monto, 0) - pagos);
    // cuotas que quedan por facturar (compras en cuotas cuyo plazo sigue corriendo)
    const enCuotas = compras.filter(m => m.cuotas > 1).map(m => { const i0 = indicePeriodo_(m.fecha, cfg.inicioMes), hechas = Math.min(m.cuotas, Math.max(0, iHoy - i0 + 1)); return { nombre: m.nota || m.categoria, cuota: Math.round(m.monto / m.cuotas), quedan: m.cuotas - hechas, total: m.cuotas }; }).filter(c => c.quedan > 0);
    const prox = t.pago ? proximoDia_(t.pago, hoy) : null;
    return { id: t.id, nombre: t.nombre, cupo: t.cupo, cierre: t.cierre || 0, pago: t.pago || 0, usado: usado, disponible: Math.max(0, t.cupo - usado), pct: t.cupo > 0 ? Math.min(100, Math.round(usado * 100 / t.cupo)) : 0, cuotasPendientes: enCuotas, proximoPago: prox ? iso_(prox) : "", diasPago: prox ? diasEntre_(hoy, prox) : null };
  });
}
// Valor de la UF de hoy: el de Ajustes si se escribió a mano; si no, mindicador.cl
// (una consulta al día, guardada). Sin internet se usa el último valor conocido.
function valorUF_() {
  const cfg = config_(); if (cfg.valorUF > 0) return { valor: cfg.valorUF, fuente: "manual" };
  const props = PropertiesService.getScriptProperties(), hoy = iso_(ahora_());
  let g = null; try { g = JSON.parse(props.getProperty("FA_UF") || "null"); } catch (e) { g = null; }
  if (g && g.fecha === hoy && g.valor > 0) return { valor: g.valor, fuente: "mindicador.cl", fecha: g.fecha };
  try {
    if (typeof UrlFetchApp !== "undefined") {
      const r = UrlFetchApp.fetch("https://mindicador.cl/api/uf/" + Utilities.formatDate(ahora_(), zona_(), "dd-MM-yyyy"), { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) {
        const j = JSON.parse(r.getContentText()), v = j && j.serie && j.serie[0] ? Number(j.serie[0].valor) : 0;
        if (v > 0) { props.setProperty("FA_UF", JSON.stringify({ valor: v, fecha: hoy })); return { valor: v, fuente: "mindicador.cl", fecha: hoy }; }
      }
    }
  } catch (e) { /* sin conexión: se usa el último valor */ }
  if (g && g.valor > 0) return { valor: g.valor, fuente: "último conocido", fecha: g.fecha };
  return { valor: 0, fuente: "" };
}
function estadoDeudas_(ahora) {
  const movs = movimientos_(), hoy = ahora || ahora_(), lista = deudas_().filter(d => d.activa);
  const uf = lista.some(d => d.moneda === "UF") ? valorUF_() : null;
  return lista.map(d => {
    const enUF = d.moneda === "UF", cuotaUF = enUF ? d.cuota : null, cuota = enUF ? Math.round(d.cuota * (uf.valor || 0)) : d.cuota;
    const pagadas = movs.filter(m => m.tipo === "Pago deuda" && m.deuda === d.id).length;
    const quedan = Math.max(0, d.cuotas - pagadas), prox = d.pago && quedan > 0 ? proximoDia_(d.pago, hoy) : null;
    return { id: d.id, nombre: d.nombre, acreedor: d.acreedor, moneda: d.moneda, cuota: cuota, cuotaUF: cuotaUF, saldoUF: enUF ? Math.round(quedan * d.cuota * 100) / 100 : null, valorUF: enUF ? uf.valor : null, sinUF: enUF && !(uf.valor > 0), cuotas: d.cuotas, pago: d.pago || 0, pagadas: Math.min(pagadas, d.cuotas), quedan: quedan, saldo: quedan * cuota, pct: d.cuotas > 0 ? Math.min(100, Math.round(pagadas * 100 / d.cuotas)) : 0, proximoPago: prox ? iso_(prox) : "", diasPago: prox ? diasEntre_(hoy, prox) : null, terminada: quedan === 0 };
  });
}
// Gastos e ingresos fijos del período: cuál ya se registró y cuándo vence el resto
function estadoFijos_(indice, hoy, cfg) {
  const rango = rangoPeriodo_(indice, cfg.inicioMes), desde = deIso_(rango.desde), movs = movimientos_();
  return fijos_().filter(x => x.activa).map(x => {
    let a = desde.getFullYear(), m = desde.getMonth() + 1;
    if (x.dia < cfg.inicioMes) { m++; if (m > 12) { m = 1; a++; } }
    const fecha = new Date(a, m - 1, Math.min(x.dia, diasMes_(a, m)), 12, 0, 0);
    const mov = movs.find(mv => mv.fijo === x.id && indicePeriodo_(mv.fecha, cfg.inicioMes) === indice);
    return { id: x.id, nombre: x.nombre, tipo: x.tipo, monto: x.monto, categoria: x.categoria, medio: x.medio, dia: x.dia, fecha: iso_(fecha), dias: diasEntre_(hoy, fecha), registrado: !!mov, montoReal: mov ? mov.monto : null };
  }).sort((p, q) => (p.registrado - q.registrado) || (p.fecha < q.fecha ? -1 : p.fecha > q.fecha ? 1 : 0));
}
// Proyección del mes en curso: lo gastado + el ritmo diario de los gastos del día a día por los días que faltan
// + fijos y cuotas de deudas que faltan por pagar; los ingresos suman los fijos que faltan por llegar.
// Día a día = gastos con fecha en el período que no son fijos (de una compra en cuotas cuenta la cuota de este mes),
// sin las compras grandes: más de 3 veces el gasto típico (mediana) de los últimos 90 días, con un mínimo de $50.000.
// Esas ya están en lo gastado, pero no se repiten. Un fijo anotado como gasto normal (misma categoría, monto ±15 %)
// cuenta como pagado. El ritmo mezcla el del mes con el promedio diario de los 3 meses anteriores (si hay datos):
// al comienzo pesa más la historia y, a medida que avanza el mes, lo de este mes (peso = parte del mes transcurrida).
// Con menos de 3 días de datos no hay proyección (el ritmo todavía no dice nada).
function proyeccion_(indice, hoy, r, fijos, cfg) {
  if (indice !== indicePeriodo_(hoy, cfg.inicioMes)) return null;
  const desde = deIso_(r.periodo.desde), hasta = deIso_(r.periodo.hasta);
  const transcurridos = diasEntre_(desde, hoy) + 1, quedan = Math.max(0, diasEntre_(hoy, hasta));
  if (transcurridos < 3) return null;
  const conPres = {}; categorias_().forEach(c => { if (c.tipo === "Gasto" && c.activa && c.presupuesto > 0) conPres[c.nombre] = true; });
  const movs = movimientos_();
  let delMes = movs.filter(m => m.tipo === "Gasto" && !m.fijo && indicePeriodo_(m.fecha, cfg.inicioMes) === indice);
  // fijos anotados como gasto normal
  const pend = fijos.filter(x => !x.registrado).filter(x => {
    if (x.tipo !== "Gasto") return true;
    const m = delMes.find(g => g.categoria === x.categoria && Math.abs(g.monto - x.monto) <= x.monto * 0.15);
    if (!m) return true;
    delMes = delMes.filter(g => g !== m); return false;
  });
  // compras grandes: no se repiten
  const desde90 = new Date(hoy.getTime() - 90 * 86400000);
  const tipicos = movs.filter(m => m.tipo === "Gasto" && !m.fijo && m.fecha >= desde90 && m.fecha <= hoy).map(m => m.monto).sort((a, b) => a - b);
  const mediana = tipicos.length ? (tipicos.length % 2 ? tipicos[(tipicos.length - 1) / 2] : (tipicos[tipicos.length / 2 - 1] + tipicos[tipicos.length / 2]) / 2) : 0;
  const tope = Math.max(50000, mediana * 3);
  let variable = 0, variablePres = 0, grandes = 0;
  delMes.forEach(m => {
    if (m.monto > tope) { grandes++; return; }
    const v = imputado_(m, indice, cfg.inicioMes); variable += v; if (conPres[m.categoria]) variablePres += v;
  });
  // promedio diario de los 3 períodos anteriores, con las mismas reglas
  let hist = 0, histPres = 0, diasHist = 0;
  for (let k = 1; k <= 3; k++) {
    const ant = indice - k, ra = rangoPeriodo_(ant, cfg.inicioMes);
    let suma = 0, sumaPres = 0, hay = false;
    movs.forEach(m => {
      if (m.tipo !== "Gasto" || m.fijo || m.monto > tope || indicePeriodo_(m.fecha, cfg.inicioMes) !== ant) return;
      const v = imputado_(m, ant, cfg.inicioMes); suma += v; hay = true; if (conPres[m.categoria]) sumaPres += v;
    });
    if (!hay) continue;
    hist += suma; histPres += sumaPres; diasHist += diasEntre_(deIso_(ra.desde), deIso_(ra.hasta)) + 1;
  }
  const peso = transcurridos / (transcurridos + quedan);
  const mezcla = (actual, h) => diasHist ? peso * actual + (1 - peso) * (h / diasHist) : actual;
  const ritmo = mezcla(variable / transcurridos, hist), ritmoPres = mezcla(variablePres / transcurridos, histPres);
  const fijosGasto = pend.filter(x => x.tipo === "Gasto").reduce((a, x) => a + x.monto, 0);
  const fijosPres = pend.filter(x => x.tipo === "Gasto" && conPres[x.categoria]).reduce((a, x) => a + x.monto, 0);
  const fijosIngreso = pend.filter(x => x.tipo === "Ingreso").reduce((a, x) => a + x.monto, 0);
  const deudas = estadoDeudas_(hoy).filter(d => !d.terminada && d.proximoPago && d.proximoPago <= r.periodo.hasta &&
    !movs.some(m => m.tipo === "Pago deuda" && m.deuda === d.id && indicePeriodo_(m.fecha, cfg.inicioMes) === indice));
  const cuotasDeuda = deudas.reduce((a, d) => a + (d.cuota || 0), 0);
  const gastos = Math.round(r.gastos + ritmo * quedan + fijosGasto + cuotasDeuda), ingresos = r.ingresos + fijosIngreso;
  const out = {
    dias: quedan, ritmo: Math.round(ritmo), gastos: gastos, ingresos: ingresos, disponible: ingresos - gastos - r.ahorro,
    fijosPendientes: pend.filter(x => x.tipo === "Gasto").length, montoFijos: fijosGasto, ingresosPendientes: fijosIngreso,
    deudasPendientes: deudas.length, montoDeudas: cuotasDeuda, grandes: grandes, tope: Math.round(tope), conHistoria: diasHist > 0, presupuesto: null,
  };
  if (r.presupuestoTotal > 0) {
    const usado = r.presupuestoTotal - r.presupuestoRestante, proyectado = Math.round(usado + ritmoPres * quedan + fijosPres);
    out.presupuesto = { total: r.presupuestoTotal, proyectado: proyectado, diferencia: r.presupuestoTotal - proyectado };
  }
  return out;
}
function proximosPagos_(tarjetas, deudas, dias) {
  return tarjetas.filter(t => t.proximoPago && t.diasPago <= dias && t.usado > 0).map(t => ({ tipo: "tarjeta", id: t.id, nombre: t.nombre, fecha: t.proximoPago, dias: t.diasPago, monto: null }))
    .concat(deudas.filter(d => d.proximoPago && d.diasPago <= dias).map(d => ({ tipo: "deuda", id: d.id, nombre: d.nombre, fecha: d.proximoPago, dias: d.diasPago, monto: d.cuota })))
    .sort((a, b) => a.dias - b.dias);
}

/* ── API del panel (google.script.run) ──────────────────────────────── */
function medios_() { return MEDIOS_BASE.concat(tarjetas_().filter(t => t.activa).map(t => t.nombre)); }
// Todo lo que el panel necesita para pintarse
function panelDatos(indice) {
  olvidarLecturas_();
  asegurarEstructura_();
  const cfg = config_(), hoy = ahora_();
  const actual = indicePeriodo_(hoy, cfg.inicioMes), pedido = Number(indice);
  // un mes inválido o fuera de rango (texto, negativo, futuro lejano) muestra el mes en curso
  const i = indice === undefined || indice === null || indice === "" || !Number.isInteger(pedido) || pedido > actual + 1 || pedido < actual - 1200 ? actual : pedido;
  const tarj = estadoTarjetas_(hoy), deu = estadoDeudas_(hoy), res = resumen_(i, hoy), fijos = estadoFijos_(i, hoy, cfg);
  return {
    ok: true, version: VERSION, hoy: iso_(hoy), config: cfg, actual: indicePeriodo_(hoy, cfg.inicioMes),
    resumen: res, proyeccion: proyeccion_(i, hoy, res, fijos, cfg), metas: estadoMetas_(hoy), tarjetas: tarj, deudas: deu,
    proximos: proximosPagos_(tarj, deu, cfg.diasAviso),
    categorias: categorias_().filter(c => c.activa).map(c => ({ nombre: c.nombre, tipo: c.tipo, icono: c.icono, color: c.color, presupuesto: c.presupuesto })),
    medios: medios_(), movimientos: movimientosPeriodo_(i, cfg), cuotasPeriodo: cuotasPeriodo_(i, cfg), historial: historial_(i, cfg), ejemplo: hayEjemplo_(),
    recientes: recientes_(hoy), urlRegistrar: urlPanel_() ? urlPanel_() + "?a=registrar" : "", frecuentes: frecuentes_(hoy), fijos: fijos,
  };
}
// Categorías más usadas en los últimos 90 días, por tipo (el registro rápido las pone primero)
function frecuentes_(hoy) {
  const desde = new Date(hoy.getTime() - 90 * 86400000), cuenta = { Gasto: {}, Ingreso: {} };
  movimientos_().forEach(m => { if ((m.tipo === "Gasto" || m.tipo === "Ingreso") && m.categoria && m.fecha >= desde) cuenta[m.tipo][m.categoria] = (cuenta[m.tipo][m.categoria] || 0) + 1; });
  const orden = o => Object.keys(o).sort((a, b) => o[b] - o[a] || a.localeCompare(b)).slice(0, 4);
  return { Gasto: orden(cuenta.Gasto), Ingreso: orden(cuenta.Ingreso) };
}
// Lo que la persona registra seguido (mismo tipo, categoría, medio, monto y nota al menos 2 veces
// en 60 días, sin contar fijos): el registro lo ofrece para repetir con un toque
function recientes_(hoy) {
  const desde = new Date(hoy.getTime() - 60 * 86400000), grupos = {};
  movimientos_().forEach(m => {
    if ((m.tipo !== "Gasto" && m.tipo !== "Ingreso") || m.fijo || m.cuotas > 1 || m.fecha < desde) return;
    const k = [m.tipo, m.categoria, m.medio, m.monto, m.nota].join("|");
    const g = grupos[k] || (grupos[k] = { tipo: m.tipo, categoria: m.categoria, medio: m.medio, monto: m.monto, nota: m.nota, veces: 0, ultima: 0 });
    g.veces++; g.ultima = Math.max(g.ultima, m.fecha.getTime());
  });
  return Object.keys(grupos).map(k => grupos[k]).filter(g => g.veces >= 2).sort((a, b) => b.veces - a.veces || b.ultima - a.ultima).slice(0, 4)
    .map(g => ({ tipo: g.tipo, categoria: g.categoria, medio: g.medio, monto: g.monto, nota: g.nota, veces: g.veces }));
}
function urlPanel_() { try { const u = texto_(ScriptApp.getService().getUrl()); return /\/exec$/.test(u) ? u : ""; } catch (e) { return ""; } }
// Gastos e ingresos de los 6 períodos que terminan en "indice" (gráfico de Inicio). Mismas reglas que resumen_
function historial_(indice, cfg) {
  const movs = movimientos_(), out = [];
  for (let k = indice - 5; k <= indice; k++) {
    let g = 0, ing = 0;
    movs.forEach(mv => {
      if (mv.tipo === "Gasto") { g += imputado_(mv, k, cfg.inicioMes); return; }
      if (indicePeriodo_(mv.fecha, cfg.inicioMes) !== k) return;
      if (mv.tipo === "Pago deuda") g += mv.monto; else if (mv.tipo === "Ingreso") ing += mv.monto;
    });
    out.push({ indice: k, mes: MESES_[((k % 12) + 12) % 12].slice(0, 3), gastos: g, ingresos: ing });
  }
  return out;
}
// Cuotas que este período paga de compras hechas en meses anteriores (para ver el detalle de una categoría)
function cuotasPeriodo_(indice, cfg) {
  return movimientos_().filter(m => m.tipo === "Gasto" && m.cuotas > 1 && indicePeriodo_(m.fecha, cfg.inicioMes) < indice)
    .map(m => ({ m: m, v: imputado_(m, indice, cfg.inicioMes) })).filter(x => x.v > 0)
    .map(x => ({ id: x.m.id, fecha: iso_(x.m.fecha), categoria: x.m.categoria, medio: x.m.medio, nota: x.m.nota, monto: x.v, total: x.m.monto, cuota: indice - indicePeriodo_(x.m.fecha, cfg.inicioMes) + 1, cuotas: x.m.cuotas }));
}
function movimientosPeriodo_(indice, cfg) {
  return movimientos_().filter(m => indicePeriodo_(m.fecha, cfg.inicioMes) === indice)
    .sort((a, b) => b.fecha - a.fecha || b._fila - a._fila)
    .map(m => ({ id: m.id, fecha: iso_(m.fecha), tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, cuotas: m.cuotas, meta: m.meta, deuda: m.deuda, nota: m.nota, fijo: m.fijo }));
}
// Valida y arma la fila de un movimiento. d: {fecha, tipo, monto, categoria, medio, cuotas, meta, deuda, nota}
// medioAnterior: al editar, el medio que ya tenía sigue valiendo aunque esa tarjeta se haya quitado
function validarMovimiento_(d, medioAnterior) {
  const tipo = texto_(d.tipo) || "Gasto";
  if (TIPOS.indexOf(tipo) < 0) return falla_("Tipo de movimiento no válido.", "tipo");
  const monto = Math.round(numero_(d.monto));
  if (!(monto > 0)) return falla_("Escribe un monto mayor que cero.", "monto");
  if (monto > 999999999) return falla_("El monto es demasiado grande.", "monto");
  const fecha = d.fecha ? fechaDe_(d.fecha) : ahora_();
  if (!fecha) return falla_("Revisa la fecha.", "fecha");
  if (diasEntre_(ahora_(), fecha) > 1) return falla_("La fecha no puede ser futura.", "fecha");
  const fila = { "Fecha": fecha, "Tipo": tipo, "Monto": monto, "Categoría": "", "Medio": texto_(d.medio), "Cuotas": 1, "Meta": "", "Deuda": "", "Nota": texto_(d.nota).slice(0, 120) };
  const cats = categorias_(), medios = medios_();
  if (medioAnterior && medios.indexOf(medioAnterior) < 0) medios.push(medioAnterior);
  if (tipo === "Gasto" || tipo === "Ingreso") {
    const c = cats.find(x => x.nombre === texto_(d.categoria) && x.tipo === tipo);
    if (!c) return falla_("Elige una categoría.", "categoria");
    fila["Categoría"] = c.nombre;
  }
  if (tipo === "Gasto" || tipo === "Pago tarjeta") {
    if (medios.indexOf(fila.Medio) < 0) return falla_("Elige cómo pagaste.", "medio");
  } else if (fila.Medio && medios.indexOf(fila.Medio) < 0) fila.Medio = "";
  const esTarjeta = tarjetas_().some(t => t.nombre === fila.Medio);
  if (tipo === "Gasto" && esTarjeta) {
    const n = Math.round(numero_(d.cuotas) || 1);
    if (n < 1 || n > 48) return falla_("Las cuotas van de 1 a 48.", "cuotas");
    fila.Cuotas = n;
  }
  if (tipo === "Pago tarjeta" && !esTarjeta) return falla_("Elige la tarjeta que pagaste.", "medio");
  if (tipo === "Ahorro" || tipo === "Retiro de meta") {
    const m = metas_().find(x => x.id === texto_(d.meta) && x.activa);
    if (!m) return falla_("Elige la meta.", "meta");
    fila.Meta = m.id;
  }
  if (tipo === "Pago deuda") {
    const de = deudas_().find(x => x.id === texto_(d.deuda) && x.activa);
    if (!de) return falla_("Elige la deuda.", "deuda");
    fila.Deuda = de.id; fila["Categoría"] = CAT_DEUDAS;
  }
  fila.Fijo = "";
  if (texto_(d.fijo)) {
    const fx = fijos_().find(x => x.id === texto_(d.fijo));
    if (!fx || fx.tipo !== tipo) return falla_("Ese gasto fijo ya no existe.", "fijo");
    fila.Fijo = fx.id;
  }
  return { ok: true, fila: fila };
}
function registrar(d) {
  olvidarLecturas_();
  asegurarEstructura_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    // un registro hecho sin conexión trae su propio código (cid): si ya llegó antes, no se duplica
    const cid = texto_((d || {}).cid), id = /^[A-Za-z0-9]{8,32}$/.test(cid) ? "M" + cid : idNuevo_("M");
    if (cid && movimientos_().some(m => m.id === id)) return { ok: true, id: id, repetido: true, datos: panelDatos() };
    const v = validarMovimiento_(d || {}); if (!v.ok) return v;
    const t = tabla_(HOJA.MOV), fila = Object.assign({ "ID": id, "Registrado": ahora_() }, v.fila);
    agregarFilas_(t, [fila]);
    return { ok: true, id: fila.ID, datos: panelDatos() };
  } finally { lock.releaseLock(); }
}
/* ── app sin conexión (PWA) ─────────────────────────────────────────── */
// La app del teléfono anota sin internet y, al volver la señal, abre el panel con ?a=pwa y los
// registros pendientes en el enlace (después de #). El panel los guarda con tu sesión de Google
// (el acceso sigue siendo "solo yo") y devuelve a la app el resultado y tus categorías.
const PWA_MAX_ = 200;
// La respuesta lleva tus datos: solo vuelve a la dirección propia de la app (no compartida con otros sitios) o a este computador.
const PWA_RETORNO_ = /^(https:\/\/ambilor-lab\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)\/[^\s#"'<>]*$/;
function retornoPwa_(u) { const s = texto_(u).split("#")[0]; return s.length < 500 && PWA_RETORNO_.test(s) ? s : ""; }
// Valida cada registro y guarda los buenos de una vez. Un código (cid) que ya llegó no se duplica.
function registrarLote_(lista) {
  const ids = new Set(movimientos_().map(m => m.id)), filas = [], res = [];
  (Array.isArray(lista) ? lista : []).slice(0, PWA_MAX_).forEach(d => {
    d = d && typeof d === "object" ? d : {};
    const cid = texto_(d.cid);
    if (!/^[A-Za-z0-9]{8,32}$/.test(cid)) { res.push({ cid: cid.slice(0, 40), ok: false, error: "Registro sin código válido." }); return; }
    const id = "M" + cid;
    if (ids.has(id)) { res.push({ cid: cid, ok: true, repetido: true }); return; }
    const v = validarMovimiento_(Object.assign({}, d, { fijo: "" }));
    if (!v.ok) { res.push({ cid: cid, ok: false, error: v.error, campo: v.campo }); return; }
    ids.add(id); filas.push(Object.assign({ "ID": id, "Registrado": ahora_() }, v.fila)); res.push({ cid: cid, ok: true });
  });
  if (filas.length) agregarFilas_(tabla_(HOJA.MOV), filas);
  return res;
}
// Lo que la app necesita para registrar y mostrar el mes sin internet
function catalogoPwa_() {
  const cfg = config_(), hoy = ahora_(), r = resumen_(indicePeriodo_(hoy, cfg.inicioMes), hoy);
  return {
    version: VERSION, hoy: iso_(hoy), actualizado: hoy.toISOString(), nombre: cfg.nombre, periodo: r.periodo.nombre,
    ingresos: r.ingresos, gastos: r.gastos, ahorro: r.ahorro, disponible: r.disponible,
    presupuestoTotal: r.presupuestoTotal, presupuestoRestante: r.presupuestoRestante,
    presupuesto: r.presupuesto.filter(p => p.gastado > 0 || p.presupuesto > 0).slice(0, 12)
      .map(p => ({ nombre: p.nombre, color: p.color, presupuesto: p.presupuesto, gastado: p.gastado, estado: p.estado })),
    categorias: categorias_().filter(c => c.activa).map(c => ({ nombre: c.nombre, tipo: c.tipo, color: c.color })),
    medios: medios_(), tarjetas: tarjetas_().filter(t => t.activa).map(t => t.nombre),
    metas: metas_().filter(m => m.activa).map(m => ({ id: m.id, nombre: m.nombre })),
    deudas: deudas_().filter(d => d.activa).map(d => ({ id: d.id, nombre: d.nombre })),
    frecuentes: frecuentes_(hoy), recientes: recientes_(hoy), panel: urlPanel_(),
  };
}
// Llamada desde la página puente (?a=pwa). lista: registros pendientes; retorno: dirección de la app
function puentePwa(lista, retorno) {
  const r = retornoPwa_(retorno);
  if (!r) return falla_("Esta dirección de la app no está autorizada para recibir tus datos.");
  olvidarLecturas_();
  asegurarEstructura_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let resultados;
  try { resultados = registrarLote_(lista); } finally { lock.releaseLock(); }
  return { ok: true, retorno: r, resultados: resultados, catalogo: catalogoPwa_() };
}
function editarMovimiento(id, d) {
  olvidarLecturas_();
  asegurarEstructura_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.MOV), f = t.filas.find(x => texto_(x.ID) === texto_(id));
    if (!f) return falla_("Ese movimiento ya no existe.");
    const v = validarMovimiento_(d || {}, texto_(f.Medio)); if (!v.ok) return v;
    escribirFila_(t, f._fila, v.fila);
    return { ok: true, datos: panelDatos(d && d.periodo) };
  } finally { lock.releaseLock(); }
}
function borrarMovimiento(id, periodo) {
  olvidarLecturas_();
  asegurarEstructura_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.MOV), f = t.filas.find(x => texto_(x.ID) === texto_(id));
    if (!f) return falla_("Ese movimiento ya no existe.");
    t.hoja.deleteRow(f._fila); olvidarLecturas_();
    return { ok: true, datos: panelDatos(periodo) };
  } finally { lock.releaseLock(); }
}
// Presupuesto y categorías: lista [{nombre, tipo, presupuesto, icono, color, activa}]
function guardarCategorias(lista) {
  olvidarLecturas_();
  asegurarEstructura_();
  const vistos = {}, filas = [], renombres = [];
  for (const c of (lista || [])) {
    const nombre = texto_(c.nombre).slice(0, 40); if (!nombre) continue;
    if (texto_(c.antes) && texto_(c.antes) !== nombre) renombres.push([texto_(c.antes), nombre]);
    const clave = nombre.toLowerCase();
    if (vistos[clave]) return falla_("La categoría " + nombre + " está repetida.");
    vistos[clave] = true;
    const p = c.presupuesto === "" || c.presupuesto === null || c.presupuesto === undefined ? 0 : numero_(c.presupuesto);
    if (isNaN(p) || p < 0) return falla_("Revisa el presupuesto de " + nombre + ".");
    filas.push({ "Categoría": nombre, "Tipo": c.tipo === "Ingreso" ? "Ingreso" : "Gasto", "Presupuesto": Math.round(p), "Ícono": texto_(c.icono) || "ti-tag", "Color": /^#[0-9a-f]{6}$/i.test(texto_(c.color)) ? texto_(c.color) : "#6B7A8F", "Activa": c.activa === false ? "No" : "Si" });
  }
  if (!filas.some(f => f.Tipo === "Gasto")) return falla_("Deja al menos una categoría de gasto.");
  if (!filas.some(f => f["Categoría"] === CAT_DEUDAS)) filas.push({ "Categoría": CAT_DEUDAS, "Tipo": "Gasto", "Presupuesto": 0, "Ícono": "ti-building-bank", "Color": "#3E546D", "Activa": "Si" });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { reemplazarDatos_(tabla_(HOJA.CAT), filas); } finally { lock.releaseLock(); }
  renombres.forEach(x => renombrarEnMovimientos_("Categoría", x[0], x[1]));
  return { ok: true, datos: panelDatos() };
}
// Cambia un nombre en una columna de Movimientos y de Fijos (al renombrar una
// tarjeta o una categoría, sus movimientos y sus fijos la siguen)
function renombrarEnMovimientos_(columna, antes, despues) {
  return renombrarEnHoja_(HOJA.MOV, columna, antes, despues) + renombrarEnHoja_(HOJA.FIJOS, columna, antes, despues);
}
function renombrarEnHoja_(hojaNombre, columna, antes, despues) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(hojaNombre); if (!t || !t.filas.length) return 0;
    const j = t.cab.indexOf(columna); if (j < 0) return 0;
    const rango = t.hoja.getRange(2, j + 1, t.hoja.getLastRow() - 1, 1), v = rango.getValues();
    let n = 0; v.forEach(f => { if (texto_(f[0]) === antes) { f[0] = despues; n++; } f[0] = celda_(f[0]); });
    if (n) { rango.setValues(v); olvidarLecturas_(); }
    return n;
  } finally { lock.releaseLock(); }
}
// Guarda (crea o actualiza) un elemento de Metas, Tarjetas o Deudas
function guardarElemento_(hojaNombre, prefijo, id, fila) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(hojaNombre), f = id ? t.filas.find(x => texto_(x.ID) === texto_(id)) : null;
    if (f) escribirFila_(t, f._fila, fila); else agregarFilas_(t, [Object.assign({ "ID": idNuevo_(prefijo), "Activa": "Si" }, fila)]);
    return { ok: true, datos: panelDatos() };
  } finally { lock.releaseLock(); }
}
function guardarMeta(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const nombre = texto_(d.nombre).slice(0, 40), obj = Math.round(numero_(d.objetivo));
  if (!nombre) return falla_("Ponle nombre a la meta.", "nombre");
  if (!(obj > 0)) return falla_("Escribe cuánto quieres juntar.", "objetivo");
  const fecha = texto_(d.fecha) ? deIso_(d.fecha) : "";
  if (texto_(d.fecha) && !fecha) return falla_("Revisa la fecha.", "fecha");
  return guardarElemento_(HOJA.METAS, "G", d.id, { "Meta": nombre, "Objetivo": obj, "Fecha objetivo": fecha, "Ícono": texto_(d.icono) || "ti-target", "Activa": d.activa === false ? "No" : "Si" });
}
function guardarTarjeta(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const nombre = texto_(d.nombre).slice(0, 40), cupo = Math.round(numero_(d.cupo)), cierre = Math.round(numero_(d.cierre)), pago = Math.round(numero_(d.pago));
  if (!nombre) return falla_("Ponle nombre a la tarjeta.", "nombre");
  if (MEDIOS_BASE.indexOf(nombre) >= 0) return falla_("Usa otro nombre: " + nombre + " ya es un medio de pago.", "nombre");
  if (tarjetas_().some(t => t.nombre.toLowerCase() === nombre.toLowerCase() && t.id !== texto_(d.id))) return falla_("Ya tienes una tarjeta con ese nombre.", "nombre");
  if (!(cupo > 0)) return falla_("Escribe el cupo de la tarjeta.", "cupo");
  if (!(pago >= 1 && pago <= 31)) return falla_("El día de pago va de 1 a 31.", "pago");
  if (texto_(d.cierre) && !(cierre >= 1 && cierre <= 31)) return falla_("El día de cierre va de 1 a 31.", "cierre");
  const antes = texto_(d.id) ? tarjetas_().find(t => t.id === texto_(d.id)) : null;
  if (antes && antes.nombre !== nombre) renombrarEnMovimientos_("Medio", antes.nombre, nombre);
  return guardarElemento_(HOJA.TARJ, "T", d.id, { "Tarjeta": nombre, "Cupo": cupo, "Día de cierre": texto_(d.cierre) ? cierre : "", "Día de pago": pago, "Activa": d.activa === false ? "No" : "Si" });
}
function guardarDeuda(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const moneda = texto_(d.moneda).toUpperCase() === "UF" ? "UF" : "CLP";
  const nombre = texto_(d.nombre).slice(0, 40), cuota = moneda === "UF" ? Math.round(decimal_(d.cuota) * 10000) / 10000 : Math.round(numero_(d.cuota)), cuotas = Math.round(numero_(d.cuotas)), pago = Math.round(numero_(d.pago));
  if (!nombre) return falla_("Ponle nombre a la deuda.", "nombre");
  if (moneda === "UF" && cuota > 1000) return falla_("Revisa la cuota: en UF suele ser menor que 1.000 (ej: 12,35).", "cuota");
  if (!(cuota > 0)) return falla_("Escribe el valor de la cuota.", "cuota");
  if (!(cuotas >= 1 && cuotas <= 600)) return falla_("Las cuotas van de 1 a 600.", "cuotas");
  if (!(pago >= 1 && pago <= 31)) return falla_("El día de pago va de 1 a 31.", "pago");
  return guardarElemento_(HOJA.DEUDAS, "D", d.id, { "Deuda": nombre, "Acreedor": texto_(d.acreedor).slice(0, 40), "Cuota": cuota, "Cuotas": cuotas, "Día de pago": pago, "Inicio": texto_(d.inicio) ? deIso_(d.inicio) : "", "Moneda": moneda, "Activa": d.activa === false ? "No" : "Si" });
}
/* ── datos de ejemplo (para mostrar la app y para que quien compra la explore) ──
   Todo lo de ejemplo lleva ID "EJ-…" y se borra junto. Solo se cargan en una planilla sin
   movimientos propios; los presupuestos anteriores se guardan y vuelven al borrar. */
const EJ_ = "EJ-";
function hayEjemplo_() { return movimientos_().some(m => m.id.indexOf(EJ_) === 0) || tarjetas_().some(t => t.id.indexOf(EJ_) === 0); }
function cargarEjemplo() {
  olvidarLecturas_();
  asegurarEstructura_();
  if (hayEjemplo_()) return falla_("Los datos de ejemplo ya están cargados.");
  if (movimientos_().length) return falla_("Ya tienes movimientos propios: los datos de ejemplo solo se cargan en una planilla sin movimientos.");
  const cfg = config_(), hoy = ahora_(), iHoy = indicePeriodo_(hoy, cfg.inicioMes), props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const pres = {}; categorias_().forEach(c => { pres[c.nombre] = c.presupuesto; });
    props.setProperty("FA_EJ_PRES", JSON.stringify(pres));
    const nuevos = { "Supermercado": 280000, "Casa": 450000, "Comida fuera": 90000, "Transporte": 80000, "Entretención": 40000, "Servicios": 70000 };
    const tc = tabla_(HOJA.CAT); tc.filas.forEach(f => { const n = texto_(f["Categoría"]); if (nuevos[n] !== undefined) escribirFila_(tc, f._fila, { "Presupuesto": nuevos[n] }); });
    const inicio = rangoPeriodo_(iHoy - 5, cfg.inicioMes).desde;
    agregarFilas_(tabla_(HOJA.TARJ), [{ "ID": EJ_ + "T1", "Tarjeta": "Visa (ejemplo)", "Cupo": 800000, "Día de cierre": "", "Día de pago": 10, "Activa": "Si" }]);
    agregarFilas_(tabla_(HOJA.DEUDAS), [{ "ID": EJ_ + "D1", "Deuda": "Crédito de consumo (ejemplo)", "Acreedor": "Banco", "Cuota": 98000, "Cuotas": 24, "Día de pago": 15, "Inicio": deIso_(inicio), "Activa": "Si", "Moneda": "CLP" }]);
    const enCinco = new Date(hoy.getFullYear(), hoy.getMonth() + 5, 28, 12);
    agregarFilas_(tabla_(HOJA.METAS), [
      { "ID": EJ_ + "G1", "Meta": "Vacaciones (ejemplo)", "Objetivo": 900000, "Fecha objetivo": enCinco, "Ícono": "ti-beach", "Activa": "Si" },
      { "ID": EJ_ + "G2", "Meta": "Fondo de emergencia (ejemplo)", "Objetivo": 1500000, "Fecha objetivo": "", "Ícono": "ti-shield", "Activa": "Si" }]);
    agregarFilas_(tabla_(HOJA.FIJOS), [
      { "ID": EJ_ + "F1", "Fijo": "Arriendo", "Tipo": "Gasto", "Monto": 420000, "Categoría": "Casa", "Medio": "Transferencia", "Día": 5, "Activa": "Si" },
      { "ID": EJ_ + "F2", "Fijo": "Luz y agua", "Tipo": "Gasto", "Monto": 38000, "Categoría": "Servicios", "Medio": "Débito", "Día": 12, "Activa": "Si" },
      { "ID": EJ_ + "F3", "Fijo": "Plan celular", "Tipo": "Gasto", "Monto": 15990, "Categoría": "Servicios", "Medio": "Visa (ejemplo)", "Día": 8, "Activa": "Si" },
      { "ID": EJ_ + "F4", "Fijo": "Sueldo", "Tipo": "Ingreso", "Monto": 1350000, "Categoría": "Sueldo", "Medio": "", "Día": 1, "Activa": "Si" }]);
    // movimientos de los últimos 6 meses (siempre los mismos: azar con semilla)
    let semilla = 7; const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    const filas = []; let n = 0;
    const mov = (k, dia, tipo, monto, o) => {
      const d = deIso_(rangoPeriodo_(k, cfg.inicioMes).desde); d.setDate(d.getDate() + dia - 1);
      if (diasEntre_(hoy, d) > 0) return;
      filas.push(Object.assign({ "ID": EJ_ + "M" + (++n), "Fecha": d, "Tipo": tipo, "Monto": Math.round(monto), "Categoría": "", "Medio": "", "Cuotas": 1, "Meta": "", "Deuda": "", "Nota": "", "Registrado": d, "Fijo": "" }, o || {}));
    };
    const ent = (a, b) => a + azar() * (b - a);
    let visaMesAnterior = 0;
    for (let k = iHoy - 5; k <= iHoy; k++) {
      let visa = 0;
      mov(k, 1, "Ingreso", 1350000, { "Categoría": "Sueldo", "Medio": "Transferencia", "Fijo": EJ_ + "F4" });
      mov(k, 2, "Ahorro", [100000, 150000, 120000][k % 3], { "Meta": k % 2 ? EJ_ + "G1" : EJ_ + "G2" });
      mov(k, 5, "Gasto", 420000, { "Categoría": "Casa", "Medio": "Transferencia", "Fijo": EJ_ + "F1" });
      mov(k, 8, "Gasto", 15990, { "Categoría": "Servicios", "Medio": "Visa (ejemplo)", "Fijo": EJ_ + "F3" }); visa += 15990;
      mov(k, 12, "Gasto", ent(33000, 44000), { "Categoría": "Servicios", "Medio": "Débito", "Fijo": EJ_ + "F2" });
      mov(k, 15, "Pago deuda", 98000, { "Categoría": CAT_DEUDAS, "Deuda": EJ_ + "D1" });
      if (visaMesAnterior) mov(k, 10, "Pago tarjeta", visaMesAnterior, { "Medio": "Visa (ejemplo)" });
      [3, 9, 16, 23].forEach((dia, j) => { const v = ent(25000, 72000), tj = j % 2 === 1; mov(k, dia, "Gasto", v, { "Categoría": "Supermercado", "Medio": tj ? "Visa (ejemplo)" : "Débito" }); if (tj) visa += Math.round(v); });
      [6, 13, 20, 27].forEach(dia => { if (azar() < .8) mov(k, dia, "Gasto", ent(7000, 26000), { "Categoría": "Comida fuera", "Medio": "Débito" }); });
      [4, 11, 18, 25].forEach(dia => mov(k, dia, "Gasto", ent(5000, 21000), { "Categoría": "Transporte", "Medio": "Débito" }));
      mov(k, 14, "Gasto", 9990, { "Categoría": "Entretención", "Medio": "Visa (ejemplo)", "Nota": "Streaming" }); visa += 9990;
      if (azar() < .6) { const v = ent(12000, 35000); mov(k, 21, "Gasto", v, { "Categoría": "Entretención", "Medio": "Visa (ejemplo)", "Nota": "Cine y salida" }); visa += Math.round(v); }
      if (azar() < .5) mov(k, 19, "Gasto", ent(15000, 45000), { "Categoría": "Salud", "Medio": "Débito", "Nota": "Farmacia" });
      if (k === iHoy - 2) mov(k, 17, "Gasto", 540000, { "Categoría": "Educación", "Medio": "Visa (ejemplo)", "Cuotas": 6, "Nota": "Notebook" });
      visaMesAnterior = visa;
    }
    agregarFilas_(tabla_(HOJA.MOV), filas);
  } finally { lock.releaseLock(); }
  return { ok: true, datos: panelDatos() };
}
function borrarEjemplo() {
  olvidarLecturas_();
  asegurarEstructura_();
  if (!hayEjemplo_()) return falla_("No hay datos de ejemplo.");
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    [HOJA.MOV, HOJA.METAS, HOJA.TARJ, HOJA.DEUDAS, HOJA.FIJOS].forEach(n => {
      const t = tabla_(n); if (!t) return;
      const quedan = t.filas.filter(f => texto_(f.ID).indexOf(EJ_) !== 0);
      if (quedan.length !== t.filas.length) reemplazarDatos_(t, quedan);
    });
    let pres = null; try { pres = JSON.parse(props.getProperty("FA_EJ_PRES") || "null"); } catch (e) { pres = null; }
    if (pres) { const tc = tabla_(HOJA.CAT); tc.filas.forEach(f => { const n = texto_(f["Categoría"]); if (pres[n] !== undefined) escribirFila_(tc, f._fila, { "Presupuesto": pres[n] }); }); props.deleteProperty("FA_EJ_PRES"); }
  } finally { lock.releaseLock(); }
  return { ok: true, datos: panelDatos() };
}
function cargarEjemploMenu() { const r = cargarEjemplo(); SpreadsheetApp.getUi().alert(r.ok ? "Listo: se cargaron 6 meses de datos de ejemplo. Bórralos desde el mismo menú cuando quieras." : r.error); }
function borrarEjemploMenu() { const r = borrarEjemplo(); SpreadsheetApp.getUi().alert(r.ok ? "Listo: se borraron los datos de ejemplo." : r.error); }
// Una categoría: {antes, nombre, tipo, presupuesto, icono, color}. Sin "antes" se crea
// (o se reactiva si existía oculta). Al renombrar, movimientos y fijos la siguen.
function guardarCategoria(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const nombre = texto_(d.nombre).slice(0, 40), antes = texto_(d.antes), tipo = texto_(d.tipo) === "Ingreso" ? "Ingreso" : "Gasto";
  const p = texto_(d.presupuesto) === "" ? 0 : numero_(d.presupuesto);
  if (!nombre) return falla_("Ponle nombre a la categoría.", "nombre");
  if (isNaN(p) || p < 0) return falla_("Revisa el presupuesto.", "presupuesto");
  const icono = /^ti-[a-z0-9-]+$/.test(texto_(d.icono)) ? texto_(d.icono) : "ti-tag", color = /^#[0-9a-f]{6}$/i.test(texto_(d.color)) ? texto_(d.color) : "#6B7A8F";
  const cats = categorias_(), otra = cats.find(c => c.nombre.toLowerCase() === nombre.toLowerCase() && c.nombre !== antes);
  if (otra && otra.activa) return falla_("Ya tienes una categoría " + otra.nombre + ".", "nombre");
  const t = tabla_(HOJA.CAT);
  if (antes) {
    const c = cats.find(x => x.nombre === antes); if (!c) return falla_("Esa categoría ya no existe.");
    if (antes === CAT_DEUDAS && nombre !== CAT_DEUDAS) return falla_("La categoría Deudas no se puede renombrar: la usan los pagos de deudas.", "nombre");
    if (otra) return falla_("Ya existe una categoría oculta con ese nombre.", "nombre");
    escribirFila_(t, c._fila, { "Categoría": nombre, "Presupuesto": c.tipo === "Gasto" ? Math.round(p) : 0, "Ícono": icono, "Color": color });
    if (antes !== nombre) renombrarEnMovimientos_("Categoría", antes, nombre);
  } else if (otra) {
    escribirFila_(t, otra._fila, { "Tipo": tipo, "Presupuesto": tipo === "Gasto" ? Math.round(p) : 0, "Ícono": icono, "Color": color, "Activa": "Si" });
  } else {
    agregarFilas_(t, [{ "Categoría": nombre, "Tipo": tipo, "Presupuesto": tipo === "Gasto" ? Math.round(p) : 0, "Ícono": icono, "Color": color, "Activa": "Si" }]);
  }
  return { ok: true, datos: panelDatos() };
}
// Oculta una categoría: deja de aparecer al registrar, pero sus movimientos siguen contando
function quitarCategoria(nombre) {
  olvidarLecturas_();
  asegurarEstructura_();
  if (texto_(nombre) === CAT_DEUDAS) return falla_("La categoría Deudas no se puede quitar.");
  const cats = categorias_(), c = cats.find(x => x.nombre === texto_(nombre) && x.activa);
  if (!c) return falla_("Esa categoría ya no existe.");
  if (!cats.some(x => x.activa && x.tipo === c.tipo && x.nombre !== c.nombre && x.nombre !== CAT_DEUDAS)) return falla_("Deja al menos otra categoría de " + (c.tipo === "Gasto" ? "gasto" : "ingreso") + ".");
  escribirFila_(tabla_(HOJA.CAT), c._fila, { "Activa": "No" });
  return { ok: true, datos: panelDatos() };
}
// Presupuestos {nombre: monto} sin tocar el resto de las categorías (ni las ocultas)
function guardarPresupuestos(montos) {
  olvidarLecturas_();
  asegurarEstructura_(); montos = montos || {};
  const cats = categorias_(), cambios = [];
  for (const n of Object.keys(montos)) {
    const c = cats.find(x => x.nombre === n && x.tipo === "Gasto"); if (!c) continue;
    const p = texto_(montos[n]) === "" ? 0 : numero_(montos[n]);
    if (isNaN(p) || p < 0) return falla_("Revisa el presupuesto de " + n + ".");
    if (Math.round(p) !== c.presupuesto) cambios.push([c._fila, Math.round(p)]);
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { const t = tabla_(HOJA.CAT); cambios.forEach(x => escribirFila_(t, x[0], { "Presupuesto": x[1] })); } finally { lock.releaseLock(); }
  return { ok: true, datos: panelDatos() };
}
// Quita (deja inactiva) una meta, tarjeta, deuda o gasto fijo. Su historial se conserva.
function quitar(clase, id) {
  olvidarLecturas_();
  asegurarEstructura_();
  const hoja = { meta: HOJA.METAS, tarjeta: HOJA.TARJ, deuda: HOJA.DEUDAS, fijo: HOJA.FIJOS }[clase];
  if (!hoja) return falla_("No se puede quitar eso.");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(hoja), f = t.filas.find(x => texto_(x.ID) === texto_(id));
    if (!f) return falla_("Ya no existe.");
    escribirFila_(t, f._fila, { "Activa": "No" });
  } finally { lock.releaseLock(); }
  return { ok: true, datos: panelDatos() };
}
// Gasto o ingreso fijo: {id, nombre, tipo, monto, categoria, medio, dia}
function guardarFijo(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const tipo = texto_(d.tipo) === "Ingreso" ? "Ingreso" : "Gasto", nombre = texto_(d.nombre).slice(0, 40), monto = Math.round(numero_(d.monto)), dia = Math.round(numero_(d.dia));
  if (!nombre) return falla_("Ponle nombre (ej: Arriendo).", "nombre");
  if (!(monto > 0)) return falla_("Escribe el monto de un mes normal (si cambia, lo ajustas al registrarlo).", "monto");
  if (!(dia >= 1 && dia <= 31)) return falla_("El día va de 1 a 31.", "dia");
  if (!categorias_().some(c => c.nombre === texto_(d.categoria) && c.tipo === tipo)) return falla_("Elige una categoría.", "categoria");
  if (tipo === "Gasto" && medios_().indexOf(texto_(d.medio)) < 0) return falla_("Elige cómo lo pagas.", "medio");
  return guardarElemento_(HOJA.FIJOS, "F", d.id, { "Fijo": nombre, "Tipo": tipo, "Monto": monto, "Categoría": texto_(d.categoria), "Medio": tipo === "Gasto" ? texto_(d.medio) : "", "Día": dia, "Activa": "Si" });
}
function guardarConfig(cambios) {
  olvidarLecturas_();
  asegurarEstructura_();
  const t = tabla_(HOJA.CONFIG), c = cambios || {};
  for (const k of Object.keys(c)) {
    const def = CONFIG_CAMPOS.find(x => x[0] === k); if (!def) continue;
    let v = c[k];
    if (def[1] === "numero") {
      v = Math.round(numero_(v));
      if (k === "inicioMes" && !(v >= 1 && v <= 28)) return falla_("El día de inicio va de 1 a 28.", k);
      if (k === "alertaPct" && !(v >= 1 && v <= 100)) return falla_("El aviso va de 1 % a 100 %.", k);
      if (k === "diasAviso" && !(v >= 1 && v <= 31)) return falla_("Los días de aviso van de 1 a 31.", k);
      if (k === "valorUF" && (isNaN(v) || v < 0)) v = 0;
      if (k === "recordatorioHora") {
        if (isNaN(v) || v < 0 || v > 23) return falla_("Elige una hora de 1 a 23, o «No».", k);
        const correo = Object.prototype.hasOwnProperty.call(c, "correoResumen") ? texto_(c.correoResumen) : config_().correoResumen;
        if (v > 0 && !correo) return falla_("Para el recordatorio, escribe primero tu correo.", k);
      }
    } else if (k === "recordatorioHora") { /* número: se valida abajo */ } else if (k === "correoResumen") {
      v = texto_(v).toLowerCase().slice(0, 120);
      if (v && !correoValido_(v)) return falla_("Revisa el correo (por ejemplo, nombre@gmail.com).", k);
    } else v = texto_(v).slice(0, 40);
    const f = t.filas.find(x => texto_(x.Clave) === k);
    if (f) escribirFila_(t, f._fila, { "Valor": v }); else agregarFilas_(t, [{ "Clave": k, "Valor": v, "Descripción": def[3] }]);
  }
  let aviso = "";
  if (Object.prototype.hasOwnProperty.call(c, "correoResumen")) {
    olvidarLecturas_();
    try { programarResumen_(!!config_().correoResumen); }
    catch (e) { aviso = "Se guardó el correo, pero no pude programar el envío mensual: " + e.message; }
  }
  if (Object.prototype.hasOwnProperty.call(c, "correoResumen") || Object.prototype.hasOwnProperty.call(c, "recordatorioHora")) {
    olvidarLecturas_();
    try { programarRecordatorio_(); }
    catch (e) { aviso = (aviso ? aviso + " " : "") + "No pude programar el recordatorio diario: " + e.message; }
  }
  return { ok: true, datos: panelDatos(), aviso: aviso };
}

/* ── resumen del mes por correo (con PDF) ──────────────────────────── */
// Al cerrar cada período, un activador diario (8:00) envía el resumen del período que terminó.
// Se envía con MailApp (solo enviar como tú; Mis Finanzas no lee tu correo) a la dirección de Ajustes.
const RESUMEN_FN_ = "enviarResumenAutomatico";
function correoValido_(s) { return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(texto_(s)); }
function escHtml_(s) { return texto_(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function programarResumen_(activo) {
  const actuales = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === RESUMEN_FN_);
  if (!activo) { actuales.forEach(t => ScriptApp.deleteTrigger(t)); return false; }
  if (!actuales.length) {
    ScriptApp.newTrigger(RESUMEN_FN_).timeBased().everyDays(1).atHour(8).create();
    // el primero automático llega al cerrar el período en curso (no se reenvía el que ya pasó)
    PropertiesService.getScriptProperties().setProperty("FA_RESUMEN_ENVIADO", String(indicePeriodo_(ahora_(), config_().inicioMes) - 1));
  }
  return true;
}
function datosResumenMes_(indice, hoy) {
  const r = resumen_(indice, hoy);
  return {
    r: r,
    categorias: r.presupuesto.filter(p => p.gastado > 0).sort((a, b) => b.gastado - a.gastado),
    metas: estadoMetas_(hoy),
    tarjetas: estadoTarjetas_(hoy).filter(t => t.usado > 0),
    deudas: estadoDeudas_(hoy).filter(d => !d.terminada),
  };
}
// HTML del resumen: tablas y estilos en línea (lo leen Gmail, Outlook y el convertidor a PDF)
function htmlResumen_(d) {
  const r = d.r, cfg = config_(), AZUL = "#1F5C99", TINTA = "#1B2430", SUAVE = "#5B6475", VERDE = "#1E7B4A", ROJO = "#B3261E", NARANJO = "#9A5B00";
  const fila = (izq, der, color, negrita) => '<tr><td style="padding:7px 0;border-bottom:1px solid #E6EAF0;color:' + TINTA + '">' + izq + '</td><td style="padding:7px 0;border-bottom:1px solid #E6EAF0;text-align:right;white-space:nowrap;color:' + (color || TINTA) + (negrita ? ';font-weight:700' : '') + '">' + der + '</td></tr>';
  const titulo = t => '<h2 style="font-size:15px;margin:22px 0 6px;color:' + AZUL + '">' + t + '</h2>';
  const tabla = filas => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">' + filas + '</table>';
  const cifra = (n, v, color) => '<td style="padding:10px 12px;background:#F3F6FA;border-radius:8px;width:50%"><div style="font-size:12px;color:' + SUAVE + '">' + n + '</div><div style="font-size:17px;font-weight:700;color:' + color + '">' + clp_(v) + '</div></td>';
  let h = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:' + TINTA + '">'
    + '<div style="font-size:12px;color:' + AZUL + ';letter-spacing:.04em">FINANZAPP · AMBILOR.LAB</div>'
    + '<h1 style="font-size:21px;margin:4px 0 2px">Resumen de ' + escHtml_(r.periodo.nombre) + '</h1>'
    + '<div style="color:' + SUAVE + ';font-size:13px">Del ' + r.periodo.desde.split("-").reverse().join("-") + ' al ' + r.periodo.hasta.split("-").reverse().join("-") + (cfg.nombre ? ' · ' + escHtml_(cfg.nombre) : '') + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-top:14px;border-collapse:separate;max-width:420px">'
    + '<tr>' + cifra("Ingresos", r.ingresos, VERDE) + cifra("Gastos", r.gastos, TINTA) + '</tr>'
    + '<tr>' + cifra("Ahorro", r.ahorro, AZUL) + cifra("Disponible", r.disponible, r.disponible < 0 ? ROJO : VERDE) + '</tr></table>';
  if (r.presupuestoTotal > 0) {
    const usado = r.presupuestoTotal - r.presupuestoRestante;
    h += '<p style="margin:12px 0 0;font-size:14px">Presupuesto: usaste <b>' + clp_(usado) + '</b> de ' + clp_(r.presupuestoTotal) + ' (' + Math.round(usado * 100 / r.presupuestoTotal) + ' %).'
      + (r.presupuestoRestante < 0 ? ' <span style="color:' + ROJO + '">Te pasaste en ' + clp_(-r.presupuestoRestante) + '.</span>' : '') + '</p>';
  }
  const excedidas = d.categorias.filter(p => p.estado === "excedido");
  if (excedidas.length) h += '<p style="margin:10px 0 0;padding:10px 12px;background:#FBEAE9;border-radius:8px;font-size:14px;color:' + ROJO + '">Categorías sobre su presupuesto: ' + excedidas.map(p => escHtml_(p.nombre) + ' (' + clp_(p.gastado - p.presupuesto) + ' de más)').join(', ') + '.</p>';
  if (d.categorias.length) {
    h += titulo("Gastos por categoría") + tabla(d.categorias.map(p => {
      let vs = "";
      if (p.anterior > 0) { const dif = Math.round((p.gastado - p.anterior) * 100 / p.anterior); if (dif) vs = ' <span style="font-size:12px;color:' + (dif > 0 ? NARANJO : VERDE) + '">' + (dif > 0 ? '+' : '−') + Math.abs(dif) + ' % vs mes anterior</span>'; }
      const pres = p.presupuesto > 0 ? ' <span style="font-size:12px;color:' + SUAVE + '">de ' + clp_(p.presupuesto) + '</span>' : '';
      return fila(escHtml_(p.nombre) + vs, clp_(p.gastado) + pres, p.estado === "excedido" ? ROJO : null);
    }).join("") + fila("<b>Total</b>", clp_(r.gastos), null, true));
  } else h += '<p style="color:' + SUAVE + '">No hubo gastos registrados en este período.</p>';
  if (d.metas.length) h += titulo("Metas de ahorro") + tabla(d.metas.map(m => fila(escHtml_(m.nombre) + (m.lista ? ' <span style="font-size:12px;color:' + VERDE + '">¡lista!</span>' : (m.porMes ? ' <span style="font-size:12px;color:' + SUAVE + '">' + clp_(m.porMes) + ' al mes para llegar</span>' : '')), clp_(m.ahorrado) + ' <span style="font-size:12px;color:' + SUAVE + '">de ' + clp_(m.objetivo) + ' · ' + m.pct + ' %</span>')).join(""));
  if (d.tarjetas.length) h += titulo("Tarjetas de crédito") + tabla(d.tarjetas.map(t => fila(escHtml_(t.nombre) + (t.proximoPago ? ' <span style="font-size:12px;color:' + SUAVE + '">paga el ' + t.proximoPago.split("-").reverse().slice(0, 2).join("/") + '</span>' : ''), clp_(t.usado) + (t.cupo ? ' <span style="font-size:12px;color:' + SUAVE + '">de ' + clp_(t.cupo) + '</span>' : ''))).join(""));
  if (d.deudas.length) h += titulo("Deudas") + tabla(d.deudas.map(x => fila(escHtml_(x.nombre) + ' <span style="font-size:12px;color:' + SUAVE + '">' + x.quedan + ' de ' + x.cuotas + ' cuotas por pagar</span>', clp_(x.saldo))).join(""));
  const url = urlPanel_();
  h += '<p style="margin:24px 0 0;font-size:13px;color:' + SUAVE + '">' + (url ? '<a href="' + escHtml_(url) + '" style="color:' + AZUL + '">Abrir Mis Finanzas</a> · ' : '') + 'Lo envía tu propia planilla de Mis Finanzas. Para dejar de recibirlo, borra el correo en Más → Ajustes.</p></div>';
  return h;
}
function enviarResumenDe_(indice, hoy) {
  const cfg = config_(), correo = cfg.correoResumen;
  if (!correo) return falla_("Primero escribe en Ajustes el correo donde quieres recibirlo.", "correoResumen");
  const d = datosResumenMes_(indice, hoy), nombre = "Mis Finanzas · " + d.r.periodo.nombre, html = htmlResumen_(d);
  const pdf = Utilities.newBlob('<html><head><meta charset="utf-8"></head><body style="margin:24px">' + html + '</body></html>', "text/html", nombre + ".html").getAs("application/pdf").setName(nombre + ".pdf");
  MailApp.sendEmail({ to: correo, subject: "Tu resumen de " + d.r.periodo.nombre + " · Mis Finanzas", htmlBody: html, name: "Mis Finanzas", attachments: [pdf] });
  return { ok: true, correo: correo, periodo: d.r.periodo.nombre };
}
// Para ejecutar en el editor después de publicar una versión con permisos nuevos: usa directamente
// el correo y los activadores, sin atrapar errores, para que Google pida el permiso o muestre el error exacto.
function autorizarPermisos() {
  const cupo = MailApp.getRemainingDailyQuota();
  const activadores = ScriptApp.getProjectTriggers().length;
  Logger.log("Permisos listos. Correos disponibles hoy: " + cupo + ". Activadores: " + activadores + ".");
  return { ok: true, cupo: cupo, activadores: activadores };
}
// Desde el panel: envía ahora el resumen del período que se está mirando
function enviarResumen(indice) {
  olvidarLecturas_();
  const hoy = ahora_(), cfg = config_(), actual = indicePeriodo_(hoy, cfg.inicioMes), pedido = Number(indice);
  const i = Number.isInteger(pedido) && pedido <= actual && pedido >= actual - 1200 ? pedido : actual;
  try { return enviarResumenDe_(i, hoy); } catch (e) { return falla_("No se pudo enviar: " + e.message); }
}
// Activador diario: si cerró un período que aún no se envió, lo envía (una sola vez)
function enviarResumenAutomatico() {
  olvidarLecturas_();
  const cfg = config_(); if (!cfg.correoResumen) return { ok: true, enviado: false };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const hoy = ahora_(), cerrado = indicePeriodo_(hoy, cfg.inicioMes) - 1, props = PropertiesService.getScriptProperties();
    const ultimo = Number(props.getProperty("FA_RESUMEN_ENVIADO"));
    if (Number.isInteger(ultimo) && ultimo >= cerrado) return { ok: true, enviado: false };
    const r = enviarResumenDe_(cerrado, hoy);
    if (r.ok) props.setProperty("FA_RESUMEN_ENVIADO", String(cerrado));
    return Object.assign({ enviado: r.ok }, r);
  } finally { lock.releaseLock(); }
}

/* ── recordatorio diario por correo ─────────────────────────────────── */
// A la hora elegida (Google lo corre dentro de esa hora), solo si ese día no se registró nada.
// Sale a la misma dirección del resumen del mes, con MailApp (solo enviar).
const RECORDATORIO_FN_ = "enviarRecordatorio";
function programarRecordatorio_() {
  const cfg = config_(), hora = cfg.correoResumen ? cfg.recordatorioHora : 0;
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === RECORDATORIO_FN_).forEach(t => ScriptApp.deleteTrigger(t));
  if (hora) ScriptApp.newTrigger(RECORDATORIO_FN_).timeBased().everyDays(1).atHour(hora).create();
  return hora;
}
// ¿Se registró algo hoy? (fecha de hoy, o anotado hoy aunque sea de otro día)
function registroHoy_(hoy) {
  const t = tabla_(HOJA.MOV), dia = iso_(hoy); if (!t) return false;
  return t.filas.some(f => { const a = fechaDe_(f.Fecha), b = fechaDe_(f.Registrado); return (a && iso_(a) === dia) || (b && iso_(b) === dia); });
}
function htmlRecordatorio_(hoy, cfg) {
  const AZUL = "#1F5C99", SUAVE = "#5B6B7F", TEXTO = "#1B2430";
  const i = indicePeriodo_(hoy, cfg.inicioMes), r = resumen_(i, hoy), p = proyeccion_(i, hoy, r, estadoFijos_(i, hoy, cfg), cfg), url = urlPanel_();
  let h = '<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;color:' + TEXTO + ';max-width:520px;margin:0 auto;padding:8px">';
  h += '<p style="font-size:17px;margin:0 0 6px"><b>' + (cfg.nombre ? escHtml_(cfg.nombre) + ', h' : 'H') + 'oy no anotaste nada en Mis Finanzas.</b></p>';
  h += '<p style="margin:0 0 16px;color:' + SUAVE + '">Si gastaste algo, regístralo ahora: son 10 segundos.</p>';
  if (url) h += '<p style="margin:0 0 20px"><a href="' + escHtml_(url + "?a=registrar") + '" style="display:inline-block;background:' + AZUL + ';color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Registrar un gasto</a></p>';
  h += '<p style="margin:0 0 4px">' + escHtml_(r.periodo.nombre) + ': llevas <b>' + clp_(r.gastos) + '</b> en gastos' + (r.presupuestoTotal > 0 ? ' y te quedan <b>' + clp_(r.presupuestoRestante) + '</b> del presupuesto' : '') + '.</p>';
  if (p) h += '<p style="margin:0 0 4px">A este ritmo terminas el mes con <b>' + clp_(Math.round(p.disponible / 1000) * 1000) + '</b> disponibles' + (p.presupuesto && p.presupuesto.diferencia < 0 ? ' y te pasarías del presupuesto en ' + clp_(Math.round(-p.presupuesto.diferencia / 1000) * 1000) : '') + '.</p>';
  h += '<p style="margin:20px 0 0;font-size:13px;color:' + SUAVE + '">Lo envía tu propia planilla de Mis Finanzas, solo los días sin registros. Para no recibirlo, en Más → Ajustes elige «No» en el recordatorio diario.</p></div>';
  return h;
}
function enviarRecordatorio() {
  olvidarLecturas_();
  const cfg = config_(); if (!cfg.correoResumen || !cfg.recordatorioHora) return { ok: true, enviado: false };
  const hoy = ahora_(), dia = iso_(hoy), props = PropertiesService.getScriptProperties();
  if (props.getProperty("FA_RECORDATORIO") === dia) return { ok: true, enviado: false };   // uno por día como máximo
  if (registroHoy_(hoy)) return { ok: true, enviado: false, motivo: "ya registró" };
  MailApp.sendEmail({ to: cfg.correoResumen, subject: "¿Gastaste algo hoy? Anótalo en Mis Finanzas", htmlBody: htmlRecordatorio_(hoy, cfg), name: "Mis Finanzas" });
  props.setProperty("FA_RECORDATORIO", dia);
  return { ok: true, enviado: true };
}

/* ── aplicación web y menú ──────────────────────────────────────────── */
// ?a=registrar abre el panel directo en el registro (atajo en la pantalla de inicio del celular)
function doGet(e) {
  asegurarEstructura_();
  if (e && e.parameter && e.parameter.a === "pwa") return HtmlService.createHtmlOutput(htmlPuente_()).setTitle("Mis Finanzas · subir").addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
  const accion = e && e.parameter && e.parameter.a === "registrar" ? "registrar" : "";
  return HtmlService.createHtmlOutput(htmlPanel_().replace("__ACCION__", accion)).setTitle("Mis Finanzas").addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Mis Finanzas").addItem("Instalar o abrir el panel", "abrirInstalacion").addItem("Preparar la planilla", "prepararPlanilla").addSeparator().addItem("Cargar datos de ejemplo", "cargarEjemploMenu").addItem("Borrar datos de ejemplo", "borrarEjemploMenu").addToUi();
  try { asegurarEstructura_(); } catch (e) { /* sin permisos todavía: se hace al instalar */ }
}
function prepararPlanilla() { const c = asegurarEstructura_(); SpreadsheetApp.getUi().alert(c.length ? "Listo: " + c.join(", ") + "." : "La planilla ya está preparada."); }
// Instalador paso a paso (menú Mis Finanzas): prepara las hojas, guía la publicación y entrega el QR del panel
function abrirInstalacion() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(htmlInstalar_()).setWidth(460).setHeight(640), "Mis Finanzas");
}
function mostrarEnlace() { abrirInstalacion(); }   // nombre anterior del menú
function estadoInstalacion() {
  olvidarLecturas_();
  const cambios = asegurarEstructura_(), url = texto_(ScriptApp.getService().getUrl());
  return { ok: true, url: /\/exec$/.test(url) ? url : "", hojas: Object.keys(CABECERAS).every(n => !!hoja_(n)), cambios: cambios };
}
function htmlInstalar_() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
@font-face{font-family:Inter;font-weight:400;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-400.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:500;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-500.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:600;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-600.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:700 800;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-700.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:500;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/jetbrains-mono-500.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:400;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-400.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:700;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-700.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:500;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/jetbrains-mono-500.woff2) format("woff2")}
*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#12304D;font-size:14.5px;line-height:1.45}
h1{font-size:19px;margin:2px 0 4px}.firma{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:12px;color:#1F5C99;margin-bottom:6px}.firma span{color:#4C8DDB}p.sub{margin:0 0 14px;color:#4A5468}
.paso{display:flex;gap:12px;padding:12px 0;border-top:1px solid #E3E8F0}
.n{flex:0 0 30px;height:30px;border-radius:50%;background:#E8EEF8;color:#1F5C99;font-weight:700;display:flex;align-items:center;justify-content:center}
.paso.ok .n{background:#1E8E4E;color:#fff}.paso.off{opacity:.55}
.paso .tt{display:block;margin-bottom:4px}.paso.ok .guia{display:none}ol{margin:6px 0 8px;padding-left:20px}li{margin:3px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:0 16px;border-radius:12px;border:1px solid #1F5C99;background:#1F5C99;color:#fff;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none}
.btn.sec{background:#fff;color:#1F5C99}
.qr{display:flex;gap:14px;align-items:center;margin:8px 0}.qr #qr{flex:0 0 auto;padding:8px;background:#fff;border:1px solid #E3E8F0;border-radius:12px}
.nota{font-size:13px;color:#4A5468}.err{color:#B3261E;font-size:13px;min-height:18px}
code{background:#F1F4F9;padding:1px 5px;border-radius:5px}
</style></head><body>
<div class="firma">Mis Finanzas<span>.</span> · Ambilor.Lab</div><h1>Instala tu panel</h1><p class="sub">Tres pasos, una sola vez. Después lo abres desde el celular como una app.</p>
<div class="paso" id="p1"><span class="n">1</span><div><b class="tt">Preparar la planilla</b><span id="t1">Revisando…</span></div></div>
<div class="paso off" id="p2"><span class="n">2</span><div><b class="tt">Publicar tu panel (privado, solo tú lo abres)</b><span id="t2"></span>
<div class="guia"><ol><li>Menú <b>Extensiones → Apps Script</b>.</li><li>Arriba a la derecha: <b>Implementar → Nueva implementación</b>.</li><li>En el engranaje ⚙ elige <b>Aplicación web</b>.</li><li><b>Ejecutar como:</b> Yo · <b>Quién tiene acceso:</b> Solo yo → <b>Implementar</b>.</li><li>Si Google pide permisos: <b>Configuración avanzada → Ir a Mis Finanzas → Permitir</b>. Es tu propio script.</li></ol>
<button class="btn sec" id="revisar" onclick="revisar()">Ya lo publiqué, revisar</button><div class="err" id="err"></div></div></div></div>
<div class="paso off" id="p3"><span class="n">3</span><div><b class="tt">Llévalo a tu celular</b>
<div class="qr"><div id="qr"></div><div class="nota">Escanéalo con la cámara del celular y entra con tu cuenta de Google.<br>Después: iPhone, <b>Compartir → Agregar a inicio</b>. Android, <b>⋮ → Agregar a la pantalla principal</b>.</div></div>
<a class="btn" id="abrir" target="_blank" rel="noopener">Abrir el panel</a></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
function el(i){ return document.getElementById(i); }
function pintar(r){
  el('revisar').disabled = false;
  if (!r || !r.ok) { el('err').textContent = 'No pude revisar. Intenta de nuevo.'; return; }
  el('p1').className = 'paso ok'; el('t1').textContent = r.hojas ? 'Listo: las hojas de Mis Finanzas están creadas.' : 'Faltan hojas: usa Mis Finanzas → Preparar la planilla.';
  if (!r.url) { el('p2').className = 'paso'; el('p3').className = 'paso off'; return; }
  el('p2').className = 'paso ok'; el('t2').textContent = 'Listo: tu panel está publicado.'; el('p3').className = 'paso'; el('err').textContent = '';
  el('abrir').href = r.url;
  el('qr').innerHTML = '';
  try { new QRCode(el('qr'), { text: r.url, width: 150, height: 150 }); } catch (e) { el('qr').style.display = 'none'; }
}
function revisar(){
  el('revisar').disabled = true; el('err').textContent = '';
  google.script.run.withSuccessHandler(function(r){ pintar(r); if (r && r.ok && !r.url) el('err').textContent = 'Aún no veo el panel publicado. Revisa el paso 4 (Aplicación web).'; }).withFailureHandler(function(){ el('revisar').disabled = false; el('err').textContent = 'No pude revisar. Intenta de nuevo.'; }).estadoInstalacion();
}
google.script.run.withSuccessHandler(pintar).withFailureHandler(function(){ el('t1').textContent = 'No pude revisar la planilla.'; }).estadoInstalacion();
</script></body></html>`;
}

function htmlPanel_() {
  return (`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B1220">
<title>Mis Finanzas</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">
<style>
:root{--graf-o:#C9D5E3;--bg:#EEF2F7;--s:#FFFFFF;--s2:#F5F8FB;--b:#DCE4EE;--t:#12304D;--t2:#3E546D;--t3:#566A80;--a:#1F5C99;--a2:#4C8DDB;--a-suave:#EBF2FA;--glow:#4C8DDB;--glow-2:#8FC1FF;--marca-1:#163F6B;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;--ok:#137333;--ok-s:#E6F4EA;--warn:#8F5507;--warn-s:#FEF3E0;--bad:#B3261E;--bad-s:#FCE8E6;--sh:0 1px 2px rgba(16,24,40,.05),0 6px 20px -8px rgba(16,24,40,.12);--r:18px;--ease:cubic-bezier(.2,.8,.2,1);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--graf-o:#2C3B52;--bg:#06080C;--s:#0E131B;--s2:#131A25;--b:#1B2330;--t:#E8EDF5;--t2:#B4BFD2;--t3:#98A2B3;--a:#8FC1FF;--a2:#8FC1FF;--a-suave:#0B1624;--ok:#4CC387;--ok-s:#123224;--warn:#F2B04E;--warn-s:#33270F;--bad:#F2786F;--bad-s:#3A1A1A;--sh:0 1px 2px rgba(0,0,0,.3),0 8px 24px -10px rgba(0,0,0,.6);color-scheme:dark}}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{font-family:var(--sans);background:var(--bg);color:var(--t);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;padding-bottom:calc(96px + env(safe-area-inset-bottom,0px));overflow-x:clip}
button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
input,select{font:inherit;color:var(--t)}
.num{font-variant-numeric:tabular-nums}
.ti{line-height:1}
/* cabecera */
.cab{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);padding:calc(12px + env(safe-area-inset-top,0px)) 16px 10px}
.cab-in{max-width:1080px;margin:0 auto;display:flex;align-items:center;gap:10px}
.logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,var(--marca-1),var(--a) 60%,var(--glow));color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-weight:500;font-size:16px;letter-spacing:-.04em;box-shadow:0 6px 16px -8px rgba(31,92,153,.8);flex-shrink:0}
.hola{flex:1;min-width:0}
.hola small{display:block;font-size:12px;color:var(--t3)}
.hola b{font-size:17px;letter-spacing:-.01em}
.per{display:flex;align-items:center;gap:2px;background:var(--s);border:1px solid var(--b);border-radius:999px;padding:2px}
.per button{width:40px;height:40px;border:0;background:none;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--t2)}
.per button:disabled{opacity:.35;cursor:default}
.per span{font-size:13px;font-weight:600;padding:0 4px;white-space:nowrap}
main{max-width:1112px;margin:0 auto;padding:4px 16px 16px}
.vista{display:none;animation:entra .3s var(--ease)}
.vista.on{display:block}
@keyframes entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vista,.hoja{animation:none!important}}
h2{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:18px 2px 8px;display:flex;align-items:center;justify-content:space-between;gap:8px}
h2 button{font-size:13px;font-weight:600;color:var(--a);background:none;border:0;padding:0 6px;min-height:44px;display:inline-flex;align-items:center;gap:4px}
.card{background:var(--s);border:1px solid var(--b);border-radius:var(--r);box-shadow:var(--sh)}
.rejilla{display:grid;grid-template-columns:minmax(0,1fr);gap:0 18px}
@media (min-width:860px){.rejilla{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}}
/* resumen */
.hero{padding:18px;background:linear-gradient(135deg,#12304D,#1F5C99 60%,#2F6FB3);color:#fff;border:0;position:relative;overflow:hidden}
.hero::after{content:'';position:absolute;right:-80px;top:-90px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(143,193,255,.38),rgba(143,193,255,0) 68%);pointer-events:none}
.hero::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(143,193,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(143,193,255,.07) 1px,transparent 1px);background-size:22px 22px;pointer-events:none}
.hero>*{position:relative;z-index:1}
.hero small{font-size:12px;opacity:.92;font-family:var(--mono);letter-spacing:.02em}
.hero .total{font-size:36px;font-weight:750;letter-spacing:-.03em;margin:2px 0 14px}
.hero .tres{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.hero .tres div{background:rgba(255,255,255,.14);border-radius:12px;padding:8px 10px;min-width:0}
.hero .tres span{display:block;font-size:12px;opacity:.92}
.hero .tres b{font-size:15px;white-space:nowrap}
.pres{padding:14px 16px;margin-top:12px}
.pres-t{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;color:var(--t2);margin-bottom:8px}
.pres-t b{color:var(--t)}
.pres-t>span:first-child{white-space:nowrap}.pres-t>span:last-child{text-align:right}
.por-dia{margin:10px 0 0;font-size:13.5px;color:var(--t2)}.por-dia b{color:var(--t)}
.proy{padding:14px 16px;margin-top:12px}
.proy-t{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--t2);margin-bottom:6px}.proy-t i{font-size:18px;color:var(--a)}
.proy-p{margin:0;font-size:15px;color:var(--t);line-height:1.45}.proy-p b{font-weight:700}
.proy-p b.rojo{color:var(--bad)}
.proy-pres{margin:8px 0 0;padding:8px 12px;border-radius:12px;font-size:13.5px}
.proy-pres.ok{background:var(--ok-s);color:var(--ok)}.proy-pres.mal{background:var(--warn-s);color:var(--warn)}
.proy-d{margin:8px 0 0;font-size:12.5px;color:var(--t3);line-height:1.45}
.cola{margin-top:12px;overflow:hidden;border:1px solid var(--warn-s)}
.cola-t{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--warn-s);color:var(--warn)}
.cola-t>i{font-size:22px;flex-shrink:0}.cola-t span{flex:1;min-width:0;font-size:13.5px}.cola-t b{display:block}.cola-t small{display:block;font-size:12.5px;line-height:1.35;color:var(--t2)}
.cola-t button{flex-shrink:0;min-height:40px;border:1px solid var(--warn);background:var(--s);color:var(--warn);border-radius:10px;font-weight:650;font-size:13px;padding:0 12px}
.cola-f.mal .tx small{color:var(--bad);white-space:normal}
.cola-x{flex-shrink:0;width:44px;height:44px;border:0;background:none;color:var(--t3);border-radius:10px;font-size:18px}
.barra{height:8px;border-radius:999px;background:var(--s2);overflow:hidden}
.barra i{display:block;height:100%;border-radius:999px;background:var(--a2);transition:width .5s var(--ease)}
.barra i.alerta{background:#E8A33C}.barra i.excedido{background:#E5534B}.barra i.okv{background:#2EAA67}
.alertas{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.alerta-f{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;font-size:13.5px}
.alerta-f i{font-size:20px}
.alerta-f.alerta{background:var(--warn-s);color:var(--warn)}
.alerta-f.excedido{background:var(--bad-s);color:var(--bad)}
.lista{padding:4px 0}
.fila{display:flex;align-items:center;gap:12px;padding:11px 16px;min-height:56px}
.fila+.fila{border-top:1px solid var(--b)}
.ico{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;color:#fff}
@media (prefers-color-scheme:dark){.ico{box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}}
.fila .tx{flex:1;min-width:0}
.fila .tx b{display:block;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fila .tx small{display:block;font-size:12.5px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fila .v{font-size:14.5px;font-weight:650;white-space:nowrap;text-align:right}
.fila .v small{display:block;font-size:12px;font-weight:500;color:var(--t3)}
.fila .barra{margin-top:6px;height:6px}
.fila.toca{width:100%;border:0;background:none;text-align:left}
.fila.toca:active{background:var(--s2)}
.pos{color:var(--ok)}.neg{color:var(--t)}.rojo{color:var(--bad)}
.vacio{padding:22px 18px;text-align:center;color:var(--t3);font-size:14px}
.vacio .ti{font-size:30px;display:block;margin-bottom:6px;color:var(--a)}
.inicio-pasos{padding:16px}
.inicio-pasos h3{font-size:16px;margin-bottom:4px}
.inicio-pasos p{font-size:13.5px;color:var(--t2);margin-bottom:10px}
.paso{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border-radius:14px;border:1px solid var(--b);background:var(--s2);margin-top:8px;text-align:left;min-height:52px}
.paso i{font-size:22px;color:var(--a)}
.paso b{font-size:14px}
.dia{font-size:12.5px;font-weight:600;color:var(--t3);margin:14px 4px 6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.dia span:first-child::first-letter{text-transform:uppercase}
/* metas y tarjetas */
.meta{padding:16px;margin-bottom:12px}
.meta-c{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.meta-c .tx{flex:1;min-width:0}
.meta-c b{font-size:16px}
.meta-c small{display:block;font-size:13px;color:var(--t3)}
.meta .barra{height:10px}
.meta-p{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--t2);margin-top:8px;flex-wrap:wrap}
.acc{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--b);background:var(--s);font-size:14px;font-weight:600}
.btn i{font-size:18px}
.btn-p{background:var(--a);border-color:var(--a);color:#fff}
@media (prefers-color-scheme:dark){.btn-p{background:#2F74BF;border-color:#2F74BF}}
.btn-peligro{color:var(--bad)}
.btn-bloque{width:100%}
.cuotas-l{margin-top:10px;font-size:13px;color:var(--t2)}
.cuotas-l div{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px dashed var(--b)}
/* segmento estilo iOS */
.seg{position:relative;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));padding:3px;border-radius:999px;background:color-mix(in srgb,var(--t) 8%,transparent);margin:12px 0}
.seg .pastilla{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px) / var(--n));border-radius:999px;background:var(--s);box-shadow:0 2px 8px rgba(0,0,0,.14);transform:translateX(calc(100% * var(--i)));transition:transform .45s cubic-bezier(.32,1.4,.48,1)}
.seg button{position:relative;z-index:1;border:0;background:none;min-height:40px;font-size:13.5px;font-weight:600;color:var(--t2);border-radius:999px;white-space:nowrap}
.seg button.on{color:var(--t)}
.seg .sc{display:none}
@media (max-width:400px){.seg .sl{display:none}.seg .sc{display:inline}}
@media (prefers-reduced-motion:reduce){.seg .pastilla{transition:none}}
/* barra inferior flotante */
.nav{position:fixed;left:50%;bottom:calc(10px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:2px;padding:6px;border-radius:999px;background:color-mix(in srgb,var(--s) 82%,transparent);-webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);border:1px solid var(--b);box-shadow:0 10px 30px -8px rgba(0,0,0,.35);width:min(420px,calc(100% - 24px))}
.nav button{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:52px;border:0;background:none;border-radius:999px;color:var(--t3);font-size:11px;font-weight:600}
.nav button i{font-size:22px}
.nav button.on{color:var(--a)}
.nav .mas{flex:0 0 56px;height:56px;min-height:56px;border-radius:50%;background:linear-gradient(135deg,var(--marca-1),#1F5C99 55%,var(--glow));color:#fff;box-shadow:0 8px 22px -6px rgba(76,141,219,.75)}
.nav .mas i{font-size:28px}
/* hoja inferior (registro y formularios) */
.velo{position:fixed;inset:0;z-index:40;background:rgba(5,10,20,.5);opacity:0;pointer-events:none;transition:opacity .25s}
.velo.on{opacity:1;pointer-events:auto}
.hoja{position:fixed;left:50%;bottom:0;z-index:41;width:min(560px,100%);max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);transform:translate(-50%,105%);transition:transform .35s var(--ease);background:var(--s);border-radius:24px 24px 0 0;display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.25)}
.hoja.on{transform:translate(-50%,0)}
.hoja-c{display:flex;align-items:center;gap:10px;padding:14px 16px 8px}
.hoja-c b{flex:1;font-size:17px}
.hoja-c button{width:44px;height:44px;border-radius:50%;border:0;background:var(--s2);font-size:20px;display:flex;align-items:center;justify-content:center}
.hoja-cuerpo{overflow-y:auto;padding:0 16px 12px;flex:1;-webkit-overflow-scrolling:touch}
.hoja-pie{padding:10px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--b);display:flex;gap:8px}
.hoja-pie .btn{flex:1;min-height:50px;font-size:15px}
.monto{font-size:44px;font-weight:750;letter-spacing:-.03em;text-align:center;padding:6px 0 2px}
.monto.vacio-m{color:var(--t3)}.monto.pide{color:var(--bad);animation:pide .35s}
@keyframes pide{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.rep{display:flex;align-items:center;gap:8px;overflow-x:auto;margin:4px -16px 2px;padding:4px 16px;scrollbar-width:none}.rep::-webkit-scrollbar{display:none}
.rep-t{font-size:12.5px;font-weight:700;color:var(--t3);flex-shrink:0}
.rep-b{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px 0 6px;border-radius:999px;border:1px solid var(--b);background:var(--s);font-size:13.5px;color:var(--t);white-space:nowrap;flex-shrink:0}
.rep-b b{font-weight:700}.rep-i{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px}
.det-res{width:100%;display:flex;align-items:center;gap:10px;min-height:44px;margin:8px 0 2px;padding:0 12px;border:1px solid var(--b);border-radius:12px;background:var(--s);color:var(--t2);font-size:13.5px;font-weight:600;text-align:left}
.det-res span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.det-res .ti{font-size:18px;color:var(--t3)}
.det{padding:2px 0 4px}
a.btn{text-decoration:none;color:var(--t)}
.teclado{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0 4px}
.teclado button{min-height:48px;border:0;border-radius:14px;background:var(--s2);font-size:21px;font-weight:600}
.teclado button:active{background:var(--b)}
.fijo-et{display:inline-flex;align-items:center;gap:6px;margin:4px auto 0;padding:6px 12px;border-radius:999px;background:var(--a-suave);color:var(--t);font-size:13px;font-weight:600}
.fijo-et i{color:var(--a);font-size:16px}
.nota-uf{font-size:12.5px;color:var(--t3);margin-top:6px}
.version{text-align:center;font-size:12px;color:var(--t3);margin:14px 0 4px;font-family:var(--mono)}
.etq{font-size:12.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin:14px 2px 8px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--b);background:var(--s);font-size:14px;font-weight:600;color:var(--t2)}
.chip i{font-size:18px}
.chip.on{background:var(--a);border-color:var(--a);color:#fff}
@media (prefers-color-scheme:dark){.chip.on{background:#2F74BF;border-color:#2F74BF}}
.cats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.cat{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:14px;border:1.5px solid transparent;background:var(--s2);font-size:12px;font-weight:600;color:var(--t2);min-height:76px;text-align:center;line-height:1.2}
.cat .ico{width:36px;height:36px;font-size:19px}
.cat.on{border-color:var(--a);background:var(--a-suave);color:var(--t)}
.paso-n{display:inline-flex;align-items:center;border:1px solid var(--b);border-radius:999px;overflow:hidden}
.paso-n button{width:44px;height:44px;border:0;background:var(--s2);font-size:20px}
.paso-n span{min-width:84px;text-align:center;font-weight:700}
.campo{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.campo label{font-size:13px;font-weight:600;color:var(--t2)}
.inp{width:100%;min-height:46px;padding:10px 14px;border-radius:12px;border:1px solid var(--b);background:var(--s2);font-size:16px;outline:none}
.inp:focus{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 25%,transparent)}
/* Campos y botones, criterio shadcn/ui (button, input, native-select, tabs) y TailGrids (button, input), 2026-10-08:
   flecha propia en las listas (antes salía la del sistema), error y deshabilitado visibles, foco con teclado y
   respuesta al tocar en botones, chips, el selector y la barra de abajo */
select.inp{-webkit-appearance:none;appearance:none;padding-right:40px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%23808A9C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
.inp::placeholder{color:var(--t3);opacity:1}
.inp:disabled{opacity:.5;cursor:not-allowed}
.inp[aria-invalid=true]{border-color:var(--bad)}
.inp[aria-invalid=true]:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 22%,transparent)}
.inp{transition:border-color .15s var(--ease),box-shadow .15s var(--ease)}
.btn,.chip,.seg button,.nav button{transition:background-color .15s var(--ease),border-color .15s var(--ease),color .15s var(--ease),scale .15s var(--ease)}
.btn:focus-visible,.chip:focus-visible,.seg button:focus-visible,.nav button:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.btn:active,.chip:active,.nav button:active{scale:.97}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn:disabled:active{scale:1}
@media (prefers-reduced-motion:reduce){.inp,.btn,.chip,.seg button,.nav button{transition:none}.btn:active,.chip:active,.nav button:active{scale:1}}
.error{color:var(--bad);font-size:13.5px;margin-top:10px;min-height:1px}
.toast{position:fixed;left:50%;bottom:calc(92px + env(safe-area-inset-bottom,0px));transform:translate(-50%,20px);z-index:60;background:#121826;color:#fff;padding:12px 18px;border-radius:14px;font-size:14px;font-weight:600;opacity:0;transition:.25s;pointer-events:none;max-width:calc(100% - 32px)}
.toast.on{opacity:1;transform:translate(-50%,0)}
.toast{display:flex;align-items:center;gap:12px;width:max-content}.toast span{min-width:0;overflow-wrap:anywhere}.toast.accion{pointer-events:auto;padding:4px 6px 4px 18px}
.toast button{min-height:44px;padding:0 14px;border:0;border-radius:10px;background:rgba(143,193,255,.18);color:#8FC1FF;font-weight:700;font-size:14px;white-space:nowrap}
.cargando{padding:60px 0;text-align:center;color:var(--t3)}
.girar{display:inline-block;width:26px;height:26px;border-radius:50%;border:3px solid var(--b);border-top-color:var(--a);animation:gira .8s linear infinite}
@keyframes gira{to{transform:rotate(360deg)}}
.fila-ed{display:grid;grid-template-columns:38px minmax(0,1fr) 130px;gap:10px;align-items:center;padding:8px 14px}
.fila-ed+.fila-ed{border-top:1px solid var(--b)}
/* 2.3: en el presupuesto, cuánto llevas y la comparación con el mes anterior bajo el nombre; el monto con punto de miles */
.ed-tx{display:flex;flex-direction:column;min-width:0}.ed-tx .barra{margin:0 0 4px}
.ed-tx small,.fila .tx small.cmp{display:block;font-size:12.5px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
small.cmp.sube{color:var(--warn)}small.cmp.baja{color:var(--ok)}
.pr-m{position:relative;display:block}.pr-m>span{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:15px;pointer-events:none}.fila-ed .pr-m .inp{padding-left:24px}.fila-ed .pr-m .inp:placeholder-shown{padding-left:10px}.pr-m .inp:placeholder-shown+span{display:none}
/* 2.3: buscador de movimientos del mes */
.buscar-m{position:relative;display:block;margin:12px 0 4px}.buscar-m i{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--t3);font-size:18px;pointer-events:none}.buscar-m .inp{padding-left:42px}
.nom-b{display:flex;align-items:center;gap:6px;min-width:0;min-height:44px;border:0;background:none;padding:0;font-weight:600;font-size:14.5px;color:var(--t);text-align:left}
.nom-b span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nom-b i,.fila .ti-pencil{color:var(--t3);font-size:16px;flex-shrink:0}
#hojaT:focus{outline:none}
.ayuda{margin:-2px 2px 10px;font-size:13px;color:var(--t2)}
.graf{padding:12px 14px 10px}.graf-t{margin:0 0 6px;font-size:12.5px;color:var(--t3)}
.graf-a{position:relative;display:flex;gap:4px;height:170px}
.graf-c{flex:1;min-width:0;display:grid;grid-template-rows:22px 1fr 22px;border:0;background:none;padding:0;border-radius:10px;color:var(--t3)}
.graf-c:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.graf-v{font-size:12px;font-weight:700;color:var(--t);white-space:nowrap;align-self:end;padding-bottom:3px}
.graf-z{position:relative;display:flex;justify-content:center;align-items:flex-end}
.graf-b{display:block;width:min(24px,62%);border-radius:4px 4px 0 0;background:var(--graf-o);transition:height .35s var(--ease)}
.graf-c.on .graf-b{background:var(--a)}
.graf-m{font-size:12px;align-self:center;text-transform:capitalize}.graf-c.on .graf-m{color:var(--t);font-weight:700}
.graf-p{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--t3);z-index:0;pointer-events:none}
.graf-l{display:inline-block;width:14px;height:0;border-top:1px solid var(--t3);vertical-align:middle;margin-right:5px}
.graf-c{position:relative;z-index:1}
.ejemplo{display:flex;align-items:center;gap:10px;margin:12px 0 0;padding:10px 12px 10px 14px;border-radius:14px;background:var(--a-suave);font-size:13.5px;color:var(--t)}.ejemplo span{flex:1}
.ejemplo button{min-height:40px;border:0;background:none;color:var(--a);font-weight:700;font-size:13.5px;padding:0 8px}
.filtro{display:flex;align-items:center;gap:12px;padding:10px 10px 10px 16px;margin:12px 0 4px}.filtro .tx{flex:1;min-width:0}.filtro .tx b{display:block}.filtro .tx small{display:block;font-size:12.5px;color:var(--t3)}
.filtro-x{width:44px;height:44px;border:0;border-radius:12px;background:var(--s2);color:var(--t2);font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.iconos{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:6px}
.ic-b{min-height:44px;border-radius:12px;border:1px solid var(--b);background:var(--s2);color:var(--t2);font-size:20px;display:flex;align-items:center;justify-content:center}
.ic-b.on{border-color:var(--a);background:var(--a-suave);color:var(--a)}
.colores{display:flex;flex-wrap:wrap;gap:8px}
.col-b{width:44px;height:44px;border-radius:50%;border:3px solid var(--s);box-shadow:0 0 0 1px var(--b)}
.col-b.on{box-shadow:0 0 0 3px var(--a)}
.fila-ed .inp{min-height:42px;padding:8px 10px}
/* celular horizontal y ventanas bajas: cabecera y barra más delgadas */
@media (orientation:landscape) and (max-height:560px){
  .cab{position:relative;padding-top:calc(6px + env(safe-area-inset-top,0px));padding-bottom:6px}
  .nav button{min-height:44px}.nav .mas{flex-basis:48px;height:48px;min-height:48px}
  body{padding-bottom:calc(78px + env(safe-area-inset-bottom,0px))}
  .hero .total{font-size:30px;margin-bottom:10px}
  .monto{font-size:34px}.teclado button{min-height:44px}
}
/* registro en celulares bajos (iPhone SE, mini): todo más compacto para ver la primera fila de categorías sin desplazar */
@media (max-height:740px) and (orientation:portrait){
  .hoja .seg{margin:6px 0}
  .monto{font-size:34px;padding:0}
  .teclado{gap:5px;margin:6px 0 2px}.teclado button{min-height:42px;font-size:19px}
  .rep{margin:2px -16px 0;padding:2px 16px}.rep-b{min-height:40px}
  .det-res{margin:6px 0 0;min-height:42px}
  .hoja .etq{margin:10px 2px 6px}
  .cat{padding:8px 4px;gap:4px}
}
/* letra muy agrandada (zoom 175–200 % en el celular): el mes baja a su propia línea y nada se sale */
@media (max-width:300px){
  .cab-in{flex-wrap:wrap}.per{width:100%;justify-content:space-between}
  .pres-t>span:first-child{white-space:normal}
  .hero .total{font-size:28px}
  .nav .et{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .cab{position:relative}
}
@media (max-width:360px){
  .hola small{display:none}.per span{font-size:12px}
  .hero .tres{grid-template-columns:1fr}
  .pres-t{flex-direction:column;gap:2px}.pres-t>span:last-child{text-align:left}
  .cats{grid-template-columns:repeat(3,minmax(0,1fr))}
  .fila-ed{grid-template-columns:32px minmax(0,1fr) 104px}
}
</style>
</head>
<body>
<header class="cab"><div class="cab-in">
  <div class="logo" aria-hidden="true">F<span style="color:var(--glow-2)">.</span></div>
  <div class="hola"><small id="saludo">Mis Finanzas</small><b id="titulo">Inicio</b></div>
  <div class="per"><button id="perAnt" aria-label="Mes anterior" onclick="irPeriodo(-1)"><i class="ti ti-chevron-left"></i></button><span id="perNom" class="num">…</span><button id="perSig" aria-label="Mes siguiente" onclick="irPeriodo(1)"><i class="ti ti-chevron-right"></i></button></div>
</div></header>
<main>
  <section class="vista on" id="v-inicio"><div class="cargando"><span class="girar"></span></div></section>
  <section class="vista" id="v-movs"></section>
  <section class="vista" id="v-metas"></section>
  <section class="vista" id="v-mas"></section>
</main>
<nav class="nav" aria-label="Secciones">
  <button class="on" data-v="inicio" onclick="verVista('inicio')"><i class="ti ti-home"></i><span class="et">Inicio</span></button>
  <button data-v="movs" onclick="verVista('movs')"><i class="ti ti-list-details"></i><span class="et">Movimientos</span></button>
  <button class="mas" aria-label="Registrar" onclick="abrirRegistro()"><i class="ti ti-plus"></i></button>
  <button data-v="metas" onclick="verVista('metas')"><i class="ti ti-target-arrow"></i><span class="et">Metas</span></button>
  <button data-v="mas" onclick="verVista('mas')"><i class="ti ti-credit-card"></i><span class="et">Más</span></button>
</nav>
<div class="velo" id="velo" onclick="cerrarHoja()"></div>
<div class="hoja" id="hoja" role="dialog" aria-modal="true" aria-labelledby="hojaT">
  <div class="hoja-c"><b id="hojaT" tabindex="-1">Registrar</b><button aria-label="Cerrar" onclick="cerrarHoja()"><i class="ti ti-x"></i></button></div>
  <div class="hoja-cuerpo" id="hojaC"></div>
  <div class="hoja-pie" id="hojaP"></div>
</div>
<div class="toast" id="toast"></div>
<script>
var D = null, S = { vista: 'inicio', periodo: null, masTab: 0, reg: null, ocupado: false, filtro: '', q: '' }, VERSION_PANEL = '__VERSION__', ACCION_PANEL = window.FA_ACCION || '__ACCION__', LOCAL = !!window.FA_LOCAL;
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function clp(n){ var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
// accion (opcional): función del botón Deshacer; el aviso dura más y se puede tocar
function toast(t, accion, texto){
  var e = el('toast'); toast.fn = accion || null;
  e.innerHTML = '<span>' + esc(t) + '</span>' + (accion ? '<button type="button" onclick="toastAccion()">' + esc(texto || 'Deshacer') + '</button>' : '');
  e.classList.toggle('accion', !!accion); e.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(function(){ e.classList.remove('on'); e.classList.remove('accion'); toast.fn = null; }, accion ? 5500 : 2400);
}
function toastAccion(){ var fn = toast.fn; toast.fn = null; el('toast').classList.remove('on'); el('toast').classList.remove('accion'); if (fn) fn(); }
function guardarLocal(k, v){ try { localStorage.setItem('fa_' + k, v); } catch (e) {} }
function leerLocal(k){ try { return localStorage.getItem('fa_' + k); } catch (e) { return null; } }
function fechaTexto(iso){ var p = iso.split('-'); var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }); }
function fechaCorta(iso){ if (!iso) return ''; var p = iso.split('-'); return Number(p[2]) + '/' + Number(p[1]) + (p[0] !== D.hoy.slice(0,4) ? '/' + p[0] : ''); }
function cat(nombre){ var c = null; D.categorias.forEach(function(x){ if (x.nombre === nombre) c = x; }); return c || { nombre: nombre || 'Sin categoría', icono: 'ti-tag', color: '#6B7A8F' }; }
function ico(icono, color){ return '<span class="ico" style="background:' + esc(color) + '"><i class="ti ' + esc(icono) + '"></i></span>'; }
// boton (opcional): queda desactivado mientras espera y vuelve a activarse siempre, también si falla la conexión
// falla (opcional): qué hacer si no hay conexión (por defecto, un aviso)
function api(fn, args, ok, boton, falla){
  S.ocupado = true; if (boton) boton.disabled = true;
  var listo = function(){ S.ocupado = false; if (boton) boton.disabled = false; };
  var r = google.script.run.withSuccessHandler(function(res){ listo(); ok(res); }).withFailureHandler(function(e){ listo(); if (falla) falla(); else toast('Sin conexión. Intenta de nuevo.'); });
  r[fn].apply(r, args || []);
}
function cargar(p){ api('panelDatos', [p === undefined ? null : p], pintar); }
function pintar(d, guardada){
  if (!d || !d.ok) { toast((d && d.error) || 'No se pudo cargar'); return; }
  if (!guardada && !LOCAL && d.resumen.periodo.indice === d.actual) guardarLocal('datos', JSON.stringify(d));
  D = d; S.periodo = d.resumen.periodo.indice;
  el('saludo').textContent = d.config.nombre ? 'Hola, ' + d.config.nombre : 'Mis Finanzas';
  el('perNom').textContent = d.resumen.periodo.nombre;
  el('perSig').disabled = S.periodo >= d.actual;
  if (guardada) el('saludo').textContent = 'Actualizando…';
  pintarVista();
  if (ACCION_PANEL === 'registrar' && !S.atajo) { S.atajo = true; abrirRegistro(window.FA_PRE); }
  if (!guardada) setTimeout(function(){ subirCola(); }, 300);
}
function irPeriodo(n){ if (S.ocupado || !D) return; cargar(S.periodo + n); }
var TITULOS = { inicio: 'Inicio', movs: 'Movimientos', metas: 'Metas', mas: 'Más' };
function verVista(v){
  S.vista = v; S.filtro = '';
  ['inicio','movs','metas','mas'].forEach(function(x){ el('v-' + x).classList.toggle('on', x === v); });
  [].forEach.call(document.querySelectorAll('.nav button[data-v]'), function(b){ b.classList.toggle('on', b.getAttribute('data-v') === v); });
  el('titulo').textContent = TITULOS[v];
  if (D) pintarVista();
  window.scrollTo(0, 0);
}
function pintarVista(){ ({ inicio: pintarInicio, movs: pintarMovs, metas: pintarMetas, mas: pintarMas })[S.vista](); }

/* ── inicio ── */
function pintarInicio(){
  var r = D.resumen, h = '';
  if (S.periodo === D.actual) h += htmlCola();
  h += '<div class="rejilla"><div>';
  h += '<div class="card hero"><small>Disponible · ' + esc(r.periodo.nombre) + '</small><div class="total num">' + clp(r.disponible) + '</div>'
    + '<div class="tres"><div><span>Ingresos</span><b class="num">' + clp(r.ingresos) + '</b></div><div><span>Gastos</span><b class="num">' + clp(r.gastos) + '</b></div><div><span>Ahorro</span><b class="num">' + clp(r.ahorro) + '</b></div></div></div>';
  if (r.presupuestoTotal > 0) {
    var usado = r.presupuestoTotal - r.presupuestoRestante, pct = Math.min(100, Math.round(usado * 100 / r.presupuestoTotal));
    h += '<div class="card pres"><div class="pres-t"><span>Presupuesto del mes</span><span>Te quedan <b class="num">' + clp(r.presupuestoRestante) + '</b> de <span class="num">' + clp(r.presupuestoTotal) + '</span></span></div><div class="barra"><i class="' + (pct >= 100 ? 'excedido' : (pct >= D.config.alertaPct ? 'alerta' : 'okv')) + '" style="width:' + pct + '%"></i></div>' + porDia(r) + '</div>';
  }
  if (D.proyeccion && S.periodo === D.actual && D.proyeccion.dias > 0) h += htmlProyeccion(D.proyeccion);
  if (r.alertas.length) h += '<div class="alertas">' + r.alertas.map(function(a){ return '<div class="alerta-f ' + a.estado + '"><i class="ti ' + (a.estado === 'excedido' ? 'ti-alert-octagon' : 'ti-alert-triangle') + '"></i><span><b>' + esc(a.nombre) + '</b> · ' + (a.estado === 'excedido' ? 'te pasaste por ' + clp(-a.restante) : (a.restante <= 0 ? 'usaste todo el presupuesto' : 'vas en el ' + a.pct + ' %, te quedan ' + clp(a.restante))) + '</span></div>'; }).join('') + '</div>';
  if (D.ejemplo) h += '<div class="ejemplo"><i class="ti ti-flask" aria-hidden="true"></i><span>Estás viendo <b>datos de ejemplo</b>.</span><button onclick="verMas(3)">Borrar</button></div>';
  if (!D.movimientos.length && S.periodo === D.actual && !D.ejemplo) h += pasosInicio();
  if (D.proximos.length) {
    h += '<h2>Próximos pagos</h2><div class="card lista">' + D.proximos.map(function(p){ return '<button class="fila toca" onclick="' + (p.tipo === 'deuda' ? 'pagarDeuda(&#39;' + p.id + '&#39;)' : 'pagarTarjeta(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(p.nombre)) + '">' + ico(p.tipo === 'deuda' ? 'ti-building-bank' : 'ti-credit-card', p.dias <= 2 ? '#D93025' : '#E8710A') + '<span class="tx"><b>' + esc(p.nombre) + '</b><small>' + (p.dias === 0 ? 'Hoy' : (p.dias === 1 ? 'Mañana' : 'En ' + p.dias + ' días')) + ' · ' + fechaCorta(p.fecha) + '</small></span><span class="v num">' + (p.monto ? clp(p.monto) : 'Pagar') + '</span></button>'; }).join('') + '</div>';
  }
  var fx = D.fijos || [], pend = fx.filter(function(x){ return !x.registrado; });
  if (fx.length && S.periodo === D.actual) {
    h += '<h2>Fijos del mes<button onclick="verMas(1)">' + (fx.length - pend.length) + ' de ' + fx.length + ' listos</button></h2>';
    h += pend.length ? '<div class="card lista">' + pend.map(function(x){ var c = cat(x.categoria), cuando = x.dias < 0 ? 'Venció el ' + fechaCorta(x.fecha) : (x.dias === 0 ? 'Vence hoy' : (x.dias === 1 ? 'Mañana' : 'El ' + fechaCorta(x.fecha))); return '<button class="fila toca" onclick="registrarFijo(&#39;' + x.id + '&#39;)">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(x.nombre) + '</b><small>' + cuando + ' · toca para registrar</small></span><span class="v num">' + clp(x.monto) + '</span></button>'; }).join('') + '</div>' : '<div class="card vacio"><i class="ti ti-circle-check"></i>Todos los fijos del mes están registrados.</div>';
  }
  h += '</div><div>' + grafico();
  var cats = r.presupuesto.filter(function(p){ return p.gastado > 0; });
  var ceros = r.presupuesto.filter(function(p){ return p.presupuesto > 0 && !(p.gastado > 0); });   // con presupuesto y sin gasto: una sola línea
  h += '<h2>Gastos por categoría<button onclick="verMas(2)">Presupuesto</button></h2>';
  h += cats.length ? '<div class="card lista">' + cats.map(function(p){
      var pct = p.presupuesto > 0 ? Math.min(100, p.pct) : 0;
      return '<button class="fila toca" onclick="verCategoria(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(p.nombre) + '">' + ico(p.icono, p.color) + '<span class="tx"><b>' + esc(p.nombre) + '</b>' + (p.presupuesto > 0 ? '<div class="barra"><i class="' + (p.estado === 'ok' ? '' : p.estado) + '" style="width:' + pct + '%"></i></div>' : '<small>Sin presupuesto</small>') + vsAnterior(p) + '</span><span class="v num">' + clp(p.gastado) + (p.presupuesto > 0 ? '<small>de ' + clp(p.presupuesto) + '</small>' : '') + '</span></button>';
    }).join('') + (ceros.length ? '<button class="fila toca" onclick="verMas(2)">' + ico('ti-circle-dashed', '#6B7A8F') + '<span class="tx"><b>' + (ceros.length === 1 ? '1 categoría' : ceros.length + ' categorías') + ' sin gastos</b><small>' + esc(ceros.map(function(p){ return p.nombre; }).join(', ')) + '</small></span><span class="v num">' + clp(ceros.reduce(function(a, p){ return a + p.presupuesto; }, 0)) + '<small>disponible</small></span></button>' : '') + '</div>' : '<div class="card vacio"><i class="ti ti-chart-pie"></i>Aún no hay gastos este mes.</div>';
  if (D.metas.length) h += '<h2>Metas<button onclick="verVista(&#39;metas&#39;)">Ver todas</button></h2><div class="card lista">' + D.metas.slice(0, 3).map(function(m){ return '<div class="fila">' + ico(m.icono, '#6A5BC7') + '<span class="tx"><b>' + esc(m.nombre) + '</b><div class="barra"><i class="okv" style="width:' + m.pct + '%"></i></div></span><span class="v num">' + m.pct + ' %<small>' + clp(m.ahorrado) + '</small></span></div>'; }).join('') + '</div>';
  h += '</div></div>';
  el('v-inicio').innerHTML = h;
}
// Cuánto se puede gastar por día con lo que queda del presupuesto (solo el mes en curso)
// "Si sigues a este ritmo": montos redondeados a mil, porque es una estimación
function mil(n){ return Math.round(n / 1000) * 1000; }
function htmlProyeccion(p){
  var disp = mil(p.disponible), h = '<div class="card proy"><div class="proy-t"><i class="ti ti-chart-line" aria-hidden="true"></i><span>Si sigues a este ritmo</span></div>';
  h += '<p class="proy-p">' + (disp < 0 ? 'Terminarías el mes en <b class="num rojo">≈ ' + clp(disp) + '</b>' : 'Terminas el mes con <b class="num">≈ ' + clp(disp) + '</b> disponibles') + '</p>';
  if (p.presupuesto) {
    var dif = mil(p.presupuesto.diferencia);
    h += dif < 0 ? '<p class="proy-pres mal">Te pasarías del presupuesto en ≈ ' + clp(-dif) + '</p>' : '<p class="proy-pres ok">Quedarías ≈ ' + clp(dif) + ' bajo el presupuesto</p>';
  }
  var det = ['Gastos del mes ≈ ' + clp(mil(p.gastos)), 'día a día: ' + clp(p.ritmo) + ' por día' + (p.conHistoria ? ' (este mes y los 3 anteriores)' : '')];
  if (p.fijosPendientes) det.push('incluye ' + p.fijosPendientes + (p.fijosPendientes === 1 ? ' fijo por pagar' : ' fijos por pagar'));
  if (p.deudasPendientes) det.push(p.deudasPendientes + (p.deudasPendientes === 1 ? ' cuota de deuda' : ' cuotas de deudas'));
  if (p.ingresosPendientes) det.push('cuenta ' + clp(p.ingresosPendientes) + ' de ingresos fijos por llegar');
  if (p.grandes) det.push((p.grandes === 1 ? 'una compra grande no se repite' : p.grandes + ' compras grandes no se repiten') + ' (más de ' + clp(p.tope) + ')');
  return h + '<p class="proy-d">' + esc(det.join(' · ')) + '</p></div>';
}
function porDia(r){
  if (S.periodo !== D.actual) return '';
  var dias = Math.round((new Date(r.periodo.hasta + 'T12:00:00') - new Date(D.hoy + 'T12:00:00')) / 86400000) + 1;
  if (dias < 1) return '';
  if (r.presupuestoRestante <= 0) return '<p class="por-dia">Ya usaste todo el presupuesto del mes.</p>';
  return '<p class="por-dia">Puedes gastar <b class="num">' + clp(Math.floor(r.presupuestoRestante / dias)) + '</b> por día · ' + (dias === 1 ? 'último día' : 'quedan ' + dias + ' días') + '</p>';
}
// Gastos de los últimos 6 meses: una sola serie; el mes que se ve en azul y el resto en gris
// (énfasis), la línea del presupuesto y el monto solo sobre el mes que se ve. Tocar = ir a ese mes.
function grafico(){
  var hs = D.historial || [];
  if (!hs.some(function(x){ return x.gastos > 0; })) return '';
  var pres = D.resumen.presupuestoTotal || 0, max = pres;
  hs.forEach(function(x){ if (x.gastos > max) max = x.gastos; });
  var h = '<h2>Últimos 6 meses</h2><div class="card graf"><p class="graf-t">Gastos de cada mes' + (pres > 0 ? ' · <span class="graf-l"></span>presupuesto ' + clpCorto(pres) : '') + ' · toca uno para verlo</p><div class="graf-a">';
  if (pres > 0) h += '<span class="graf-p" style="bottom:calc(22px + (100% - 44px) * ' + (pres / max).toFixed(4) + ')"></span>';
  h += hs.map(function(x){
    var on = x.indice === S.periodo, alto = Math.max(x.gastos > 0 ? 2 : 0, Math.round(x.gastos * 100 / max));
    return '<button type="button" class="graf-c' + (on ? ' on' : '') + '" onclick="irAPeriodo(' + x.indice + ')" aria-label="' + esc(x.mes) + ': ' + clp(x.gastos) + ' en gastos"' + (on ? ' aria-current="true"' : '') + '><span class="graf-v num">' + (on ? clpCorto(x.gastos) : '') + '</span><span class="graf-z"><span class="graf-b" style="height:' + alto + '%"></span></span><span class="graf-m">' + esc(x.mes) + '</span></button>';
  }).join('');
  return h + '</div></div>';
}
function clpCorto(n){ n = Math.round(n || 0); if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M'; if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000).toLocaleString('es-CL') + ' mil'; return clp(n); }
function irAPeriodo(k){ if (S.ocupado || !D || k === S.periodo || k > D.actual) return; cargar(k); }
function pasosInicio(){
  return '<div class="card inicio-pasos" style="margin-top:12px"><h3>Empecemos</h3><p>Cuatro pasos y tu mes queda bajo control.</p>'
    + '<button class="paso" onclick="abrirRegistro({tipo:&#39;Ingreso&#39;})"><i class="ti ti-briefcase"></i><b>Registra tu sueldo</b></button>'
    + '<button class="paso" onclick="verMas(2)"><i class="ti ti-chart-pie"></i><b>Pon tu presupuesto por categoría</b></button>'
    + '<button class="paso" onclick="formFijo()"><i class="ti ti-repeat"></i><b>Agrega tus gastos fijos (arriendo, cuentas)</b></button>'
    + '<button class="paso" onclick="formMeta()"><i class="ti ti-target-arrow"></i><b>Crea una meta de ahorro</b></button>'
    + '<button class="paso" onclick="cargarEjemplo(this)"><i class="ti ti-flask"></i><b>O explórala primero con datos de ejemplo</b></button></div>';
}

/* ── movimientos ── */
function nombreMov(m){
  if (m.tipo === 'Ahorro' || m.tipo === 'Retiro de meta') { var me = null; D.metas.forEach(function(x){ if (x.id === m.meta) me = x; }); return (m.tipo === 'Ahorro' ? 'Ahorro · ' : 'Retiro · ') + (me ? me.nombre : 'Meta'); }
  if (m.tipo === 'Pago tarjeta') return 'Pago ' + m.medio;
  if (m.tipo === 'Pago deuda') { var de = null; D.deudas.forEach(function(x){ if (x.id === m.deuda) de = x; }); return 'Cuota · ' + (de ? de.nombre : 'Deuda'); }
  return m.categoria;
}
// Comparación con el mes anterior: «+18 % vs sep» (más gasto) o «−12 % vs sep» (menos); nada si el mes anterior no hubo gasto
function vsAnterior(p){
  var h = D.historial || [], mes = h.length > 1 ? h[h.length - 2].mes.toLowerCase() : 'el mes anterior';
  if (!(p.anterior > 0) || !(p.gastado > 0)) return '';
  var pct = Math.round((p.gastado - p.anterior) * 100 / p.anterior);
  if (pct === 0) return '<small class="cmp">igual que ' + esc(mes) + '</small>';
  return '<small class="cmp ' + (pct > 0 ? 'sube' : 'baja') + '">' + (pct > 0 ? '+' : '−') + Math.abs(pct) + ' % vs ' + esc(mes) + '</small>';
}
function miles(v){ v = String(v || '').replace(/[^0-9]/g, ''); return v ? Number(v).toLocaleString('es-CL') : ''; }
function sinTildes(t){ return String(t || '').toLowerCase().replace(/[áà]/g, 'a').replace(/[éè]/g, 'e').replace(/[íì]/g, 'i').replace(/[óò]/g, 'o').replace(/[úùü]/g, 'u'); }
function verCategoria(nombre){ verVista('movs'); S.filtro = nombre; pintarMovs(); }
function quitarFiltro(){ S.filtro = ''; pintarMovs(); }
function buscarMovs(v){ S.q = v; pintarMovs(); }
function pintarMovs(){
  // el buscador se arma una vez y no se reemplaza al escribir (así no pierde el foco)
  if (!el('qMov')) el('v-movs').innerHTML = '<label class="buscar-m"><i class="ti ti-search" aria-hidden="true"></i><input id="qMov" type="search" class="inp" placeholder="Buscar en el mes: nota, categoría, monto" aria-label="Buscar movimientos del mes" oninput="buscarMovs(this.value)" autocomplete="off"></label><div id="movCola"></div><div id="movL"></div>';
  el('movCola').innerHTML = S.periodo === D.actual ? htmlCola() : '';
  var q = sinTildes(S.q).trim(), h = '', dia = '', lista = D.movimientos;
  if (q) {
    var qn = q.replace(/[^0-9]/g, '');
    lista = lista.filter(function(m){ return sinTildes([nombreMov(m), m.categoria, m.medio, m.nota, m.tipo].join(' ')).indexOf(q) >= 0 || (qn.length >= 3 && String(m.monto).indexOf(qn) >= 0); });
  }
  if (S.filtro) {
    var c = cat(S.filtro), p = null; D.resumen.presupuesto.forEach(function(x){ if (x.nombre === S.filtro) p = x; });
    lista = D.movimientos.filter(function(m){ return m.categoria === S.filtro; });
    var cuotas = (D.cuotasPeriodo || []).filter(function(m){ return m.categoria === S.filtro; });
    h += '<div class="card filtro">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(S.filtro) + '</b><small>' + esc(D.resumen.periodo.nombre) + ' · ' + clp(p ? p.gastado : 0) + (p && p.presupuesto > 0 ? ' de ' + clp(p.presupuesto) : '') + '</small></span><button type="button" class="filtro-x" onclick="quitarFiltro()" aria-label="Ver todos los movimientos"><i class="ti ti-x"></i></button></div>';
    if (cuotas.length) h += '<div class="dia">Cuotas de compras anteriores</div><div class="card lista">' + cuotas.map(function(m){ return '<button class="fila toca" onclick="toast(&#39;Esta compra es de un mes anterior: edítala desde ese mes.&#39;)">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(m.nota || m.categoria) + '</b><small>' + esc(m.medio) + ' · cuota ' + m.cuota + ' de ' + m.cuotas + ' · ' + fechaCorta(m.fecha) + '</small></span><span class="v num neg">−' + clp(m.monto) + '</span></button>'; }).join('') + '</div>';
    if (!lista.length) { el('movL').innerHTML = h + (cuotas.length ? '' : '<div class="card vacio" style="margin-top:12px"><i class="ti ti-receipt"></i>' + (q ? 'Nada coincide con «' + esc(S.q.trim()) + '» en ' + esc(S.filtro) + '.' : 'No hay movimientos de ' + esc(S.filtro) + ' este mes.') + '</div>'); return; }
  }
  if (!lista.length && q) { el('movL').innerHTML = '<div class="card vacio" style="margin-top:12px"><i class="ti ti-search"></i>Nada coincide con «' + esc(S.q.trim()) + '» en ' + esc(D.resumen.periodo.nombre) + '.</div>'; return; }
  if (!lista.length) { el('movL').innerHTML = '<div class="card vacio" style="margin-top:12px"><i class="ti ti-receipt"></i>No hay movimientos en ' + esc(D.resumen.periodo.nombre) + '.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="abrirRegistro()"><i class="ti ti-plus"></i>Registrar</button></div></div>'; return; }
  var grupos = [];
  lista.forEach(function(m){ if (m.fecha !== dia) { dia = m.fecha; grupos.push({ dia: dia, items: [] }); } grupos[grupos.length - 1].items.push(m); });
  grupos.forEach(function(g){
    var gd = g.items.reduce(function(a, m){ return a + (m.tipo === 'Gasto' || m.tipo === 'Pago deuda' ? Number(m.monto) || 0 : 0); }, 0);
    h += '<div class="dia"><span>' + esc(fechaTexto(g.dia)) + '</span>' + (gd > 0 ? '<span class="num">Gastaste ' + clp(gd) + '</span>' : '') + '</div><div class="card lista">' + g.items.map(function(m){
      var c = cat(m.categoria), ic = m.tipo === 'Ahorro' || m.tipo === 'Retiro de meta' ? ['ti-pig-money', '#6A5BC7'] : (m.tipo === 'Pago tarjeta' ? ['ti-credit-card', '#3E546D'] : [c.icono, c.color]);
      var signo = m.tipo === 'Ingreso' || m.tipo === 'Retiro de meta' ? '+' : '−', clase = m.tipo === 'Ingreso' ? 'pos' : 'neg';
      var sub = [m.medio, m.cuotas > 1 ? m.cuotas + ' cuotas' : '', m.nota].filter(Boolean).join(' · ');
      return '<button class="fila toca" onclick="editarMov(&#39;' + m.id + '&#39;)">' + ico(ic[0], ic[1]) + '<span class="tx"><b>' + esc(nombreMov(m)) + '</b><small>' + esc(sub || m.tipo) + '</small></span><span class="v num ' + clase + '">' + signo + clp(m.monto) + '</span></button>';
    }).join('') + '</div>';
  });
  el('movL').innerHTML = h;
}

/* ── metas ── */
function pintarMetas(){
  var h = '<h2>Tus metas<button onclick="formMeta()"><i class="ti ti-plus"></i> Nueva</button></h2>';
  if (!D.metas.length) h += '<div class="card vacio"><i class="ti ti-target-arrow"></i>Crea una meta: unas vacaciones, un fondo de emergencia, un computador nuevo.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="formMeta()"><i class="ti ti-plus"></i>Crear meta</button></div></div>';
  h += '<div class="rejilla">' + D.metas.map(function(m){
    var detalle = m.lista ? '¡Meta cumplida!' : (m.porMes !== null ? 'Ahorra ' + clp(m.porMes) + ' al mes hasta ' + fechaCorta(m.fecha) : 'Sin fecha objetivo');   // lo que falta ya va a la derecha
    return '<div class="card meta"><div class="meta-c">' + ico(m.icono, '#6A5BC7') + '<span class="tx"><b>' + esc(m.nombre) + '</b><small class="num">' + clp(m.ahorrado) + ' de ' + clp(m.objetivo) + '</small></span><b class="num">' + m.pct + ' %</b></div>'
      + '<div class="barra"><i class="okv" style="width:' + m.pct + '%"></i></div><div class="meta-p"><span>' + esc(detalle) + '</span>' + (m.lista ? '' : '<span class="num">Faltan ' + clp(m.falta) + '</span>') + '</div>'
      + '<div class="acc"><button class="btn btn-p" onclick="abrirRegistro({tipo:&#39;Ahorro&#39;,meta:&#39;' + m.id + '&#39;})"><i class="ti ti-pig-money"></i>Aportar</button><button class="btn" onclick="formMeta(&#39;' + m.id + '&#39;)"><i class="ti ti-pencil"></i>Editar</button></div></div>';
  }).join('') + '</div>';
  el('v-metas').innerHTML = h;
}

/* ── más: tarjetas y deudas, presupuesto, ajustes ── */
function verMas(i){ S.masTab = i; verVista('mas'); }
function seg(opciones, i, fn){ return '<div class="seg" role="tablist" style="--n:' + opciones.length + ';--i:' + i + '"><span class="pastilla"></span>' + opciones.map(function(o, k){ return '<button role="tab" aria-selected="' + (k === i) + '" class="' + (k === i ? 'on' : '') + '" onclick="' + fn + '(' + k + ')">' + (typeof o === 'string' ? o : '<span class="sl">' + o[0] + '</span><span class="sc">' + o[1] + '</span>') + '</button>'; }).join('') + '</div>'; }
function cambiarMas(i){ S.masTab = i; pintarMas(); }
function pintarMas(){
  var h = seg(['Tarjetas','Fijos',['Presupuesto','Presup.'],'Ajustes'], S.masTab, 'cambiarMas');
  if (S.masTab === 0) h += vistaTarjetas();
  if (S.masTab === 1) h += vistaFijos();
  if (S.masTab === 2) h += vistaPresupuesto();
  if (S.masTab === 3) h += vistaAjustes();
  el('v-mas').innerHTML = h;
}
function vistaTarjetas(){
  var h = '<h2>Tarjetas de crédito<button onclick="formTarjeta()"><i class="ti ti-plus"></i> Nueva</button></h2>';
  h += D.tarjetas.length ? '<div class="rejilla">' + D.tarjetas.map(function(t){
    return '<div class="card meta"><div class="meta-c">' + ico('ti-credit-card', '#1F5C99') + '<span class="tx"><b>' + esc(t.nombre) + '</b><small>Pago el día ' + (t.proximoPago ? fechaCorta(t.proximoPago) : '—') + (t.diasPago !== null ? ' · en ' + t.diasPago + ' días' : '') + '</small></span></div>'
      + '<div class="barra"><i class="' + (t.pct >= 90 ? 'excedido' : (t.pct >= 70 ? 'alerta' : '')) + '" style="width:' + t.pct + '%"></i></div><div class="meta-p"><span>Usado <b class="num">' + clp(t.usado) + '</b></span><span>Disponible <b class="num">' + clp(t.disponible) + '</b></span></div>'
      + (t.cuotasPendientes.length ? '<div class="cuotas-l">' + t.cuotasPendientes.map(function(c){ return '<div><span>' + esc(c.nombre) + '</span><span class="num">' + clp(c.cuota) + ' × ' + c.quedan + ' de ' + c.total + '</span></div>'; }).join('') + '</div>' : '')
      + '<div class="acc"><button class="btn btn-p" onclick="pagarTarjeta(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(t.nombre) + '"><i class="ti ti-cash"></i>Pagar</button><button class="btn" onclick="formTarjeta(&#39;' + t.id + '&#39;)"><i class="ti ti-pencil"></i>Editar</button></div></div>';
  }).join('') + '</div>' : '<div class="card vacio"><i class="ti ti-credit-card"></i>Agrega tus tarjetas para ver el cupo usado y las cuotas que vienen.</div>';
  h += '<h2>Deudas y créditos<button onclick="formDeuda()"><i class="ti ti-plus"></i> Nueva</button></h2>';
  h += D.deudas.length ? '<div class="rejilla">' + D.deudas.map(function(d){
    return '<div class="card meta"><div class="meta-c">' + ico('ti-building-bank', '#3E546D') + '<span class="tx"><b>' + esc(d.nombre) + '</b><small>' + esc(d.acreedor || '') + (d.acreedor ? ' · ' : '') + (d.moneda === 'UF' ? ufTxt(d.cuotaUF) + ' UF ≈ ' + clp(d.cuota) : clp(d.cuota)) + ' al mes</small></span><b class="num">' + d.pagadas + '/' + d.cuotas + '</b></div>'
      + '<div class="barra"><i class="okv" style="width:' + d.pct + '%"></i></div><div class="meta-p"><span>' + (d.terminada ? '¡Pagada!' : 'Te quedan ' + d.quedan + ' cuotas') + '</span><span>Saldo <b class="num">' + (d.moneda === 'UF' ? ufTxt(d.saldoUF) + ' UF' : clp(d.saldo)) + '</b></span></div>'
      + (d.sinUF ? '<div class="error" style="margin-top:8px">No pude traer el valor de la UF. Escríbelo en Más → Ajustes.</div>' : (d.moneda === 'UF' ? '<div class="nota-uf">UF de hoy: ' + clp(d.valorUF) + '</div>' : ''))
      + '<div class="acc">' + (d.terminada ? '' : '<button class="btn btn-p" onclick="pagarDeuda(&#39;' + d.id + '&#39;)"><i class="ti ti-cash"></i>Pagar cuota</button>') + '<button class="btn" onclick="formDeuda(&#39;' + d.id + '&#39;)"><i class="ti ti-pencil"></i>Editar</button></div></div>';
  }).join('') + '</div>' : '<div class="card vacio"><i class="ti ti-building-bank"></i>Agrega créditos o préstamos para seguir las cuotas que te quedan.</div>';
  return h;
}
function vistaPresupuesto(){
  var gastos = D.categorias.filter(function(c){ return c.tipo === 'Gasto'; }), ingresos = D.categorias.filter(function(c){ return c.tipo === 'Ingreso'; });
  var nom = function(c){ return '<button class="nom-b" onclick="formCategoria(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(c.nombre) + '"><span>' + esc(c.nombre) + '</span><i class="ti ti-pencil" aria-hidden="true"></i></button>'; };
  var h = '<h2>Categorías de gasto<button onclick="formCategoria()"><i class="ti ti-plus"></i> Nueva</button></h2><p class="ayuda">Toca el nombre para cambiarlo, elegir otro ícono o quitarla. Monto vacío: sin límite.</p>';
  var res = {}; D.resumen.presupuesto.forEach(function(p){ res[p.nombre] = p; });
  h += '<div class="card lista" id="presL">' + gastos.map(function(c, i){
    var p = res[c.nombre] || { gastado: 0, anterior: 0, presupuesto: c.presupuesto, pct: null, estado: 'sin' };
    var lleva = '<small class="lleva">' + (p.gastado > 0 ? 'Llevas ' + clp(p.gastado) : 'Sin gastos este mes') + '</small>' + vsAnterior(p);
    var barra = c.presupuesto > 0 ? '<div class="barra"><i class="' + (p.estado === 'ok' ? '' : p.estado) + '" style="width:' + Math.min(100, p.pct || 0) + '%"></i></div>' : '';
    return '<div class="fila-ed">' + ico(c.icono, c.color) + '<span class="ed-tx">' + nom(c) + barra + lleva + '</span><span class="pr-m"><input class="inp num" id="pr' + i + '" inputmode="numeric" placeholder="Sin límite" aria-label="Presupuesto de ' + esc(c.nombre) + '" value="' + miles(c.presupuesto) + '" data-c="' + esc(c.nombre) + '" oninput="this.value = miles(this.value)"><span aria-hidden="true">$</span></span></div>';
  }).join('') + '</div><div class="acc"><button class="btn btn-p btn-bloque" onclick="guardarPresupuesto(this)"><i class="ti ti-device-floppy"></i>Guardar presupuesto</button></div>';
  h += '<h2>Categorías de ingreso<button onclick="formCategoria(null, &#39;Ingreso&#39;)"><i class="ti ti-plus"></i> Nueva</button></h2><div class="card lista">' + ingresos.map(function(c){
    return '<button class="fila toca" onclick="formCategoria(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(c.nombre) + '">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(c.nombre) + '</b></span><i class="ti ti-pencil" aria-hidden="true"></i></button>';
  }).join('') + '</div>';
  return h;
}
function guardarPresupuesto(b){
  var montos = {}; [].forEach.call(document.querySelectorAll('#presL input'), function(i){ montos[i.getAttribute('data-c')] = i.value.replace(/[^0-9]/g, ''); });
  api('guardarPresupuestos', [montos], function(r){ if (!r.ok) { toast(r.error); return; } toast('Presupuesto guardado'); pintar(r.datos); }, b);
}
var ICONOS = ['ti-shopping-cart','ti-home','ti-bolt','ti-car','ti-bus','ti-tools-kitchen-2','ti-coffee','ti-heart','ti-pill','ti-school','ti-device-tv','ti-device-mobile','ti-wifi','ti-shirt','ti-paw','ti-baby-carriage','ti-gift','ti-plane','ti-barbell','ti-beer','ti-building-bank','ti-briefcase','ti-cash','ti-tag'];
// paleta de la marca (validada para daltonismo: 8 tonos + 2 neutros)
var COLORES = ['#1F5C99','#C47A1C','#6A5BC7','#2E9E5B','#B5405F','#4C8DDB','#D0613A','#078C7E','#3E546D','#6B7A8F'];
function formCategoria(nombre, tipoNuevo){
  var c = nombre ? cat(nombre) : { nombre: '', tipo: tipoNuevo || 'Gasto', icono: 'ti-tag', color: COLORES[0], presupuesto: 0 };
  var deudas = nombre === 'Deudas';
  S.cat = { antes: nombre || '', tipo: c.tipo, icono: c.icono, color: c.color };
  var h = '<div class="campo"><label for="c-nombre">Nombre</label><input class="inp" id="c-nombre" maxlength="40" value="' + esc(c.nombre) + '"' + (deudas ? ' readonly' : '') + '></div>';
  if (c.tipo === 'Gasto') h += campoTexto('c-pres', 'Presupuesto mensual (vacío = sin límite)', c.presupuesto || '', 'numero');
  h += '<div class="etq">Ícono</div><div class="iconos">' + ICONOS.map(function(x){ return '<button type="button" class="ic-b' + (x === S.cat.icono ? ' on' : '') + '" data-v="' + x + '" aria-label="Ícono ' + x.slice(3) + '" onclick="elegirCat(&#39;icono&#39;, this)"><i class="ti ' + x + '"></i></button>'; }).join('') + '</div>';
  h += '<div class="etq">Color</div><div class="colores">' + COLORES.map(function(x){ return '<button type="button" class="col-b' + (x === S.cat.color ? ' on' : '') + '" data-v="' + x + '" style="background:' + x + '" aria-label="Color ' + x + '" onclick="elegirCat(&#39;color&#39;, this)"></button>'; }).join('') + '</div><div class="error" id="c-err"></div>';
  var quita = nombre && !deudas;
  abrirHoja(nombre ? 'Editar categoría' : (c.tipo === 'Gasto' ? 'Nueva categoría de gasto' : 'Nueva categoría de ingreso'), h, (quita ? '<button class="btn btn-peligro" style="flex:0 0 auto" id="c-quitar" aria-label="Quitar categoría"><i class="ti ti-trash"></i></button>' : '') + '<button class="btn btn-p" id="c-ok"><i class="ti ti-check"></i>Guardar</button>');
  el('c-ok').onclick = function(){
    var d = { antes: S.cat.antes, nombre: el('c-nombre').value, tipo: S.cat.tipo, icono: S.cat.icono, color: S.cat.color, presupuesto: el('c-pres') ? el('c-pres').value.replace(/[^0-9]/g, '') : 0 };
    api('guardarCategoria', [d], function(r){ if (!r.ok) { el('c-err').textContent = r.error; return; } cerrarHoja(); toast('Categoría guardada'); pintar(r.datos); }, this);
  };
  if (quita) el('c-quitar').onclick = function(){
    if (!this.getAttribute('data-ok')) { this.setAttribute('data-ok', '1'); this.innerHTML = '<i class="ti ti-trash"></i>¿Quitar?'; return; }
    api('quitarCategoria', [nombre], function(r){ if (!r.ok) { el('c-err').textContent = r.error; return; } cerrarHoja(); toast('Categoría quitada. Sus movimientos se conservan.'); pintar(r.datos); }, this);
  };
}
function cargarEjemplo(b){ api('cargarEjemplo', [], function(r){ if (!r.ok) { toast(r.error); return; } pintar(r.datos); verVista('inicio'); toast('Listo: 6 meses de datos de ejemplo'); }, b); }
function borrarEjemplo(b){
  if (!b.getAttribute('data-ok')) { b.setAttribute('data-ok', '1'); b.innerHTML = '<i class="ti ti-trash"></i>¿Borrar todo lo de ejemplo?'; return; }
  api('borrarEjemplo', [], function(r){ if (!r.ok) { toast(r.error); return; } pintar(r.datos); toast('Listo: se borraron los datos de ejemplo'); }, b);
}
function elegirCat(k, b){ S.cat[k] = b.getAttribute('data-v'); [].forEach.call(b.parentNode.children, function(x){ x.classList.toggle('on', x === b); }); }
function vistaAjustes(){
  var c = D.config;
  return '<div class="card" style="padding:4px 16px 16px;margin-top:4px">'
    + campoTexto('aj-nombre', 'Tu nombre', c.nombre, 'text')
    + campoTexto('aj-inicio', 'Día en que parte tu mes (por ejemplo, el día de sueldo)', c.inicioMes, 'numero')
    + campoTexto('aj-alerta', 'Avisarme cuando una categoría llegue al (%)', c.alertaPct, 'numero')
    + campoTexto('aj-dias', 'Mostrar pagos que vencen en los próximos (días)', c.diasAviso, 'numero')
    + campoTexto('aj-uf', 'Valor de la UF (déjalo en 0 y se actualiza solo cada día)', c.valorUF || 0, 'numero')
    + '<div class="error" id="aj-err"></div><div class="acc"><button class="btn btn-p btn-bloque" onclick="guardarAjustes(this)"><i class="ti ti-device-floppy"></i>Guardar ajustes</button></div></div>'
    + (LOCAL ? FALocal.ajustes() : '<h2>Correos de Mis Finanzas</h2><div class="card" style="padding:4px 16px 16px">'
    + campoTexto('aj-correo', 'Tu correo', c.correoResumen, 'email')
    + '<p class="ayuda" style="margin:6px 0 10px">' + (c.correoResumen ? 'Resumen del mes: al cerrar cada mes (el día ' + c.inicioMes + ', a las 8:00) te llega con un PDF adjunto. Para dejar de recibir correos, borra el correo y guarda.' : 'Escribe tu correo y guarda: al cerrar cada mes te llegará el resumen (ingresos, gastos por categoría, metas, tarjetas y deudas) con un PDF adjunto.') + '</p>'
    + campoTexto('aj-rec', 'Recordarme registrar si un día no anoté nada', String(c.recordatorioHora || 0), 'select', [{ v: '0', t: 'No' }].concat([9, 13, 18, 20, 21, 22].concat(c.recordatorioHora && [9, 13, 18, 20, 21, 22].indexOf(c.recordatorioHora) < 0 ? [c.recordatorioHora] : []).map(function(n){ return { v: String(n), t: 'Sí, entre las ' + n + ':00 y las ' + (n + 1) + ':00' }; })))
    + '<p class="ayuda" style="margin:6px 0 10px">Un correo corto, solo los días en que no registraste nada, con un botón para anotar. Si activas las notificaciones de Gmail en el celular, te llega como aviso.</p>'
    + '<div class="error" id="aj-correo-err"></div><div class="acc"><button class="btn btn-p btn-bloque" onclick="guardarCorreo(this)"><i class="ti ti-mail"></i>Guardar correos</button>'
    + (c.correoResumen ? '<button class="btn btn-bloque" onclick="enviarResumenAhora(this)"><i class="ti ti-send"></i>Enviarme ahora el de ' + esc(D.resumen.periodo.nombre) + '</button>' : '') + '</div></div>')
    + (D.urlRegistrar ? '<h2>Atajo para registrar</h2><div class="card" style="padding:14px 16px"><p class="ayuda" style="margin:0 0 10px">Un segundo ícono en tu celular que abre Mis Finanzas directo en el registro. Ábrelo y agrégalo a la pantalla de inicio (iPhone: Compartir → Agregar a inicio · Android: ⋮ → Agregar a la pantalla principal).</p><a class="btn btn-bloque" href="' + esc(D.urlRegistrar) + '" target="_top"><i class="ti ti-bolt"></i>Abrir el atajo</a></div>' : '')
    + (D.ejemplo ? '<h2>Datos de ejemplo</h2><div class="card" style="padding:14px 16px"><p class="ayuda" style="margin:0 0 10px">Estás viendo 6 meses de datos de ejemplo. Al borrarlos quedan solo los tuyos y los presupuestos vuelven a como estaban.</p><button class="btn btn-peligro btn-bloque" onclick="borrarEjemplo(this)"><i class="ti ti-trash"></i>Borrar datos de ejemplo</button></div>'
      : (D.movimientos.length || (D.historial || []).some(function(x){ return x.gastos > 0; }) ? '' : '<h2>Datos de ejemplo</h2><div class="card" style="padding:14px 16px"><p class="ayuda" style="margin:0 0 10px">Carga 6 meses de datos de ejemplo para explorar la app. Se borran con un toque.</p><button class="btn btn-bloque" onclick="cargarEjemplo(this)"><i class="ti ti-flask"></i>Probar con datos de ejemplo</button></div>'))
    + '<p class="version">Mis Finanzas ' + esc(D.version) + (LOCAL ? ' · datos en este teléfono' : '') + ' · Ambilor.Lab</p>';
}
function opcion(o, valor){ return '<option value="' + esc(o.v) + '"' + (o.v === valor ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }
function campoTexto(id, etiqueta, valor, tipo, opciones){
  if (tipo === 'select') return '<div class="campo"><label for="' + id + '">' + esc(etiqueta) + '</label><select class="inp" id="' + id + '">' + opciones.map(function(o){ return o.grupo ? '<optgroup label="' + esc(o.grupo) + '">' + o.items.map(function(x){ return opcion(x, valor); }).join('') + '</optgroup>' : opcion(o, valor); }).join('') + '</select></div>';
  return '<div class="campo"><label for="' + id + '">' + esc(etiqueta) + '</label><input class="inp' + (tipo === 'numero' || tipo === 'decimal' ? ' num' : '') + '" id="' + id + '" ' + (tipo === 'numero' ? 'inputmode="numeric" ' : '') + (tipo === 'decimal' ? 'inputmode="decimal" ' : '') + (tipo === 'date' ? 'type="date" ' : '') + (tipo === 'text' ? 'maxlength="40" ' : '') + (tipo === 'email' ? 'type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="nombre@gmail.com" ' : '') + 'value="' + esc(valor == null ? '' : valor) + '"></div>'; }
function guardarCorreo(b){
  el('aj-correo-err').textContent = '';
  var rec = el('aj-rec').value;
  if (!el('aj-correo').value.trim()) rec = '0';
  api('guardarConfig', [{ correoResumen: el('aj-correo').value, recordatorioHora: rec }], function(r){
    if (!r.ok) { el('aj-correo-err').textContent = r.error; return; }
    pintar(r.datos);
    var c = r.datos.config;
    toast(r.aviso ? r.aviso : (c.correoResumen ? 'Listo: el resumen llegará a ' + c.correoResumen + (c.recordatorioHora ? ' y el recordatorio, entre las ' + c.recordatorioHora + ':00 y las ' + (c.recordatorioHora + 1) + ':00' : '') : 'Listo: ya no se enviarán correos'));
  }, b);
}
function enviarResumenAhora(b){
  api('enviarResumen', [S.periodo], function(r){ if (!r.ok) { el('aj-correo-err').textContent = r.error; return; } toast('Enviado a ' + r.correo + ': resumen de ' + r.periodo); }, b);
}
function guardarAjustes(b){
  api('guardarConfig', [{ nombre: el('aj-nombre').value, inicioMes: el('aj-inicio').value, alertaPct: el('aj-alerta').value, diasAviso: el('aj-dias').value, valorUF: el('aj-uf').value }], function(r){ if (!r.ok) { el('aj-err').textContent = r.error; return; } toast('Ajustes guardados'); pintar(r.datos); }, b);
}

/* ── hoja inferior ── */
function abrirHoja(titulo, cuerpo, pie){ el('hojaT').textContent = titulo; el('hojaC').innerHTML = cuerpo; el('hojaP').innerHTML = pie; mostrarHoja(); el('hojaC').scrollTop = 0; }
// al abrir, el foco del teclado (y del lector de pantalla) entra a la hoja; al cerrar, vuelve a donde estaba
function mostrarHoja(){ if (!el('hoja').classList.contains('on')) S.foco = document.activeElement; el('velo').classList.add('on'); el('hoja').classList.add('on'); try { el('hojaT').focus({ preventScroll: true }); } catch (e) {} }
function cerrarHoja(){ var abierta = el('hoja').classList.contains('on'); el('velo').classList.remove('on'); el('hoja').classList.remove('on'); S.reg = null; if (abierta && S.foco && S.foco.focus && document.body.contains(S.foco)) { try { S.foco.focus({ preventScroll: true }); } catch (e) {} } S.foco = null; }
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { cerrarHoja(); return; }
  // registro abierto: números, borrar y Enter desde el teclado del computador
  if (!S.reg || !el('hojaC').querySelector('#montoV') || e.metaKey || e.ctrlKey || e.altKey) return;
  var t = e.target && e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (/^[0-9]$/.test(e.key)) { tecla(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { tecla('borrar'); e.preventDefault(); }
  else if (e.key === 'Enter') { if ((S.reg.tipo === 'Gasto' || S.reg.tipo === 'Ingreso') && !S.reg.categoria) el('regErr').textContent = 'Toca una categoría para guardar.'; else guardarRegistro(); e.preventDefault(); }
});

/* ── registro rápido: monto, categoría y guardar ── */
var TIPOS_REG = ['Gasto','Ingreso','Ahorro','Pago'];
function abrirRegistro(pre){
  pre = pre || {};
  var tipo = pre.tipo || 'Gasto', retiro = false;
  if (tipo === 'Retiro de meta') { tipo = 'Ahorro'; retiro = true; }
  if (tipo === 'Pago tarjeta' || tipo === 'Pago deuda') tipo = 'Pago';
  S.reg = { montoAuto: !!pre.monto && !pre.id && !pre.fijo, id: pre.id || '', tipo: tipo, retiro: retiro, monto: pre.monto ? String(pre.monto) : '', fijo: pre.fijo || '', categoria: pre.categoria || (pre.id ? '' : leerLocal('cat_' + tipo) || ''), medio: pre.medio || leerLocal('medio') || 'Débito', cuotas: pre.cuotas || 1, meta: pre.meta || '', pago: pre.pago || null, fecha: pre.fecha || D.hoy, nota: pre.nota || '' };
  if (D.medios.indexOf(S.reg.medio) < 0) S.reg.medio = 'Débito';
  if (!S.reg.meta && D.metas.length) S.reg.meta = D.metas[0].id;
  pintarRegistro();
  mostrarHoja();
}
// Registro rápido: gasto o ingreso nuevo = monto + tocar la categoría (eso guarda). Los detalles
// (medio, cuotas, fecha, nota) van plegados en una línea; lo habitual se repite con un toque.
function pintarRegistro(){
  var r = S.reg, h = '', rapido = !r.id && (r.tipo === 'Gasto' || r.tipo === 'Ingreso');
  h += seg(TIPOS_REG, TIPOS_REG.indexOf(r.tipo), 'cambiarTipo');
  var fj = r.fijo ? buscar(D.fijos, r.fijo) : null;
  if (fj && fj.id) h += '<div style="text-align:center"><span class="fijo-et"><i class="ti ti-repeat"></i>Fijo: ' + esc(fj.nombre) + '</span></div>';
  h += '<div class="monto num' + (r.monto ? '' : ' vacio-m') + '" id="montoV" aria-live="polite">' + clp(r.monto || 0) + '</div>';
  var rep = rapido && !r.monto && !r.fijo ? (D.recientes || []).filter(function(x){ return x.tipo === r.tipo; }) : [];
  if (rep.length) h += '<div class="rep" aria-label="Repetir lo habitual"><span class="rep-t">Repetir</span>' + rep.map(function(x, k){ var c = cat(x.categoria); return '<button type="button" class="rep-b" onclick="repetir(' + (D.recientes.indexOf(x)) + ')"><span class="rep-i" style="background:' + esc(c.color) + '"><i class="ti ' + esc(c.icono) + '"></i></span>' + esc(x.nota || x.categoria) + ' <b class="num">' + clp(x.monto) + '</b></button>'; }).join('') + '</div>';
  h += '<div class="teclado">' + ['1','2','3','4','5','6','7','8','9','000','0','borrar'].map(function(k){ return '<button type="button" onclick="tecla(&#39;' + k + '&#39;)" aria-label="' + (k === 'borrar' ? 'Borrar' : k) + '">' + (k === 'borrar' ? '<i class="ti ti-backspace"></i>' : k) + '</button>'; }).join('') + '</div>';
  if (r.tipo === 'Gasto' || r.tipo === 'Ingreso') {
    var abierto = r.det || !!r.id, hd = '';
    hd += '<button type="button" class="det-res" onclick="verDetalles()" aria-expanded="' + abierto + '"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i><span>' + esc(resumenDetalles(r)) + '</span><i class="ti ti-chevron-' + (abierto ? 'up' : 'down') + '" aria-hidden="true"></i></button>';
    if (abierto) {
      hd += '<div class="det">';
    if (r.tipo === 'Gasto') {
      hd += '<div class="etq">Cómo pagaste</div><div class="chips">' + D.medios.map(function(m){ return '<button type="button" class="chip' + (m === r.medio ? ' on' : '') + '" data-v="' + esc(m) + '" onclick="elegir(&#39;medio&#39;,this.getAttribute(&#39;data-v&#39;))">' + esc(m) + '</button>'; }).join('') + '</div>';
      if (esTarjeta(r.medio)) hd += '<div class="etq">Cuotas</div><div class="paso-n"><button type="button" aria-label="Menos cuotas" onclick="cuotas(-1)">−</button><span class="num">' + r.cuotas + (r.cuotas === 1 ? ' cuota' : ' cuotas') + '</span><button type="button" aria-label="Más cuotas" onclick="cuotas(1)">+</button></div>';
    }
    var ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    var isoAyer = ayer.getFullYear() + '-' + ('0' + (ayer.getMonth() + 1)).slice(-2) + '-' + ('0' + ayer.getDate()).slice(-2);
    hd += '<div class="etq">Fecha</div><div class="chips"><button type="button" class="chip' + (r.fecha === D.hoy ? ' on' : '') + '" onclick="elegir(&#39;fecha&#39;,&#39;' + D.hoy + '&#39;)">Hoy</button><button type="button" class="chip' + (r.fecha === isoAyer ? ' on' : '') + '" onclick="elegir(&#39;fecha&#39;,&#39;' + isoAyer + '&#39;)">Ayer</button><input class="inp" type="date" aria-label="Otra fecha" style="width:auto;flex:1;min-width:150px" max="' + D.hoy + '" value="' + r.fecha + '" onchange="elegir(&#39;fecha&#39;,this.value)"></div>';
    hd += '<div class="campo"><label for="regNota">Nota (opcional)</label><input class="inp" id="regNota" maxlength="120" placeholder="Ej: almuerzo con el equipo" value="' + esc(r.nota) + '" oninput="S.reg.nota=this.value;var x=document.querySelector(&#39;.det-res span&#39;);if(x)x.textContent=resumenDetalles(S.reg)"></div>';
      hd += '</div>';
    }
    // primero la última usada y luego las 4 más usadas en los últimos 90 días
    var fr = (D.frecuentes && D.frecuentes[r.tipo]) || [], ult = leerLocal('cat_' + r.tipo);
    var cs = D.categorias.filter(function(c){ return c.tipo === r.tipo && c.nombre !== 'Deudas'; }).map(function(c, i){ return { c: c, k: c.nombre === ult ? -1 : (fr.indexOf(c.nombre) < 0 ? 100 + i : fr.indexOf(c.nombre)) }; }).sort(function(a, b){ return a.k - b.k; }).map(function(x){ return x.c; });
    if (rapido || !r.categoria || !cs.some(function(c){ return c.nombre === r.categoria; })) r.categoria = '';   // en el rápido, tocar = guardar: nada marcado de antes
    h += '<div class="etq">' + (rapido ? 'Toca la categoría para guardar' : 'Categoría') + '</div><div class="cats">' + cs.map(function(c){ return '<button type="button" class="cat' + (c.nombre === r.categoria ? ' on' : '') + '" onclick="tocarCategoria(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(c.nombre) + '">' + ico(c.icono, c.color) + esc(c.nombre) + '</button>'; }).join('') + '</div>';
    h += hd;   // detalles después de las categorías: así se ven sin bajar en celulares chicos
  }
  if (r.tipo === 'Ahorro') {
    if (!D.metas.length) h += '<div class="card vacio" style="margin-top:12px">Primero crea una meta de ahorro.<div class="acc" style="justify-content:center"><button class="btn" onclick="formMeta()">Crear meta</button></div></div>';
    else {
      h += '<div class="etq">Meta</div><div class="chips">' + D.metas.map(function(m){ return '<button type="button" class="chip' + (m.id === r.meta ? ' on' : '') + '" onclick="elegir(&#39;meta&#39;,&#39;' + m.id + '&#39;)"><i class="ti ' + esc(m.icono) + '"></i>' + esc(m.nombre) + '</button>'; }).join('') + '</div>';
      h += '<div class="etq">Movimiento</div><div class="chips"><button type="button" class="chip' + (r.retiro ? '' : ' on') + '" onclick="elegir(&#39;retiro&#39;,false)"><i class="ti ti-arrow-down"></i>Aportar</button><button type="button" class="chip' + (r.retiro ? ' on' : '') + '" onclick="elegir(&#39;retiro&#39;,true)"><i class="ti ti-arrow-up"></i>Retirar</button></div>';
    }
  }
  if (r.tipo === 'Pago') {
    var ops = D.tarjetas.map(function(t){ return { tipo: 'tarjeta', id: t.nombre, nombre: t.nombre, icono: 'ti-credit-card', cuota: t.usado }; }).concat(D.deudas.filter(function(d){ return !d.terminada; }).map(function(d){ return { tipo: 'deuda', id: d.id, nombre: d.nombre, icono: 'ti-building-bank', cuota: d.cuota }; }));
    if (!ops.length) h += '<div class="card vacio" style="margin-top:12px">Agrega una tarjeta o una deuda en Más.</div>';
    else {
      if (!r.pago) r.pago = { tipo: ops[0].tipo, id: ops[0].id };
      h += '<div class="etq">Qué pagas</div><div class="chips">' + ops.map(function(o){ var on = r.pago && r.pago.tipo === o.tipo && r.pago.id === o.id; return '<button type="button" class="chip' + (on ? ' on' : '') + '" onclick="elegirPago(&#39;' + o.tipo + '&#39;,this.getAttribute(&#39;data-v&#39;),' + (o.cuota || 0) + ')" data-v="' + esc(o.id) + '"><i class="ti ' + o.icono + '"></i>' + esc(o.nombre) + '</button>'; }).join('') + '</div>';
    }
  }
  if (r.tipo === 'Ahorro' || r.tipo === 'Pago') {
    var ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    var isoAyer = ayer.getFullYear() + '-' + ('0' + (ayer.getMonth() + 1)).slice(-2) + '-' + ('0' + ayer.getDate()).slice(-2);
    h += '<div class="etq">Fecha</div><div class="chips"><button type="button" class="chip' + (r.fecha === D.hoy ? ' on' : '') + '" onclick="elegir(&#39;fecha&#39;,&#39;' + D.hoy + '&#39;)">Hoy</button><button type="button" class="chip' + (r.fecha === isoAyer ? ' on' : '') + '" onclick="elegir(&#39;fecha&#39;,&#39;' + isoAyer + '&#39;)">Ayer</button><input class="inp" type="date" aria-label="Otra fecha" style="width:auto;flex:1;min-width:150px" max="' + D.hoy + '" value="' + r.fecha + '" onchange="elegir(&#39;fecha&#39;,this.value)"></div>';
    h += '<div class="campo"><label for="regNota">Nota (opcional)</label><input class="inp" id="regNota" maxlength="120" placeholder="Ej: almuerzo con el equipo" value="' + esc(r.nota) + '" oninput="S.reg.nota=this.value;var x=document.querySelector(&#39;.det-res span&#39;);if(x)x.textContent=resumenDetalles(S.reg)"></div>';
  }
  h += '<div class="error" id="regErr" role="alert"></div>';
  el('hojaT').textContent = r.id ? 'Editar movimiento' : 'Registrar';
  el('hojaC').innerHTML = h;
  el('hojaP').style.display = rapido ? 'none' : '';
  el('hojaP').innerHTML = rapido ? '' : (r.id ? '<button class="btn btn-peligro" style="flex:0 0 auto" onclick="borrarMov()" aria-label="Borrar movimiento"><i class="ti ti-trash"></i></button>' : '') + '<button class="btn btn-p" id="regGuardar" onclick="guardarRegistro()"><i class="ti ti-check"></i>Guardar</button>';
}
function resumenDetalles(r){
  var ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  var isoAyer = ayer.getFullYear() + '-' + ('0' + (ayer.getMonth() + 1)).slice(-2) + '-' + ('0' + ayer.getDate()).slice(-2);
  var p = [];
  if (r.tipo === 'Gasto') p.push(r.medio + (esTarjeta(r.medio) && r.cuotas > 1 ? ' en ' + r.cuotas + ' cuotas' : ''));
  p.push(r.fecha === D.hoy ? 'Hoy' : (r.fecha === isoAyer ? 'Ayer' : fechaCorta(r.fecha)));
  if (r.nota) p.push('“' + r.nota + '”');
  return p.join(' · ');
}
function verDetalles(){ S.reg.det = !(S.reg.det || !!S.reg.id); if (S.reg.id) S.reg.det = true; var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; var d = el('hojaC').querySelector('.det'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest' }); }
// gasto o ingreso nuevo: tocar la categoría guarda (si falta el monto, lo pide)
function tocarCategoria(n){
  var r = S.reg;
  if (r.id || (r.tipo !== 'Gasto' && r.tipo !== 'Ingreso')) { elegir('categoria', n); return; }
  r.categoria = n;
  if (!(Number(r.monto) > 0)) { var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; el('regErr').textContent = 'Primero escribe el monto.'; el('montoV').classList.add('pide'); return; }
  guardarRegistro();
}
// repetir algo habitual: un toque y queda registrado hoy (con Deshacer)
function repetir(k){
  var x = (D.recientes || [])[k]; if (!x || !S.reg) return;
  var r = S.reg; r.tipo = x.tipo; r.monto = String(x.monto); r.categoria = x.categoria; r.nota = x.nota || ''; r.cuotas = 1; r.fecha = D.hoy; r.fijo = '';
  if (x.tipo === 'Gasto' && D.medios.indexOf(x.medio) >= 0) r.medio = x.medio;
  guardarRegistro();
}
function esTarjeta(m){ return D.tarjetas.some(function(t){ return t.nombre === m; }); }
function cambiarTipo(i){ S.reg.tipo = TIPOS_REG[i]; S.reg.fijo = ''; S.reg.categoria = leerLocal('cat_' + S.reg.tipo) || ''; pintarRegistro(); }
function tecla(k){
  var r = S.reg; r.montoAuto = false;
  if (k === 'borrar') r.monto = r.monto.slice(0, -1);
  else if ((r.monto + k).length <= 10) r.monto = (r.monto + k).replace(/^0+/, '');
  var v = el('montoV'); v.textContent = clp(r.monto || 0); v.classList.toggle('vacio-m', !r.monto); v.classList.remove('pide'); if (el('regErr')) el('regErr').textContent = '';
}
function elegir(k, v){ S.reg[k] = v; if (k === 'medio') { guardarLocal('medio', v); if (!esTarjeta(v)) S.reg.cuotas = 1; } var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function elegirPago(tipo, id, cuota){ S.reg.pago = { tipo: tipo, id: id }; if (!S.reg.monto || S.reg.montoAuto) { S.reg.monto = cuota ? String(cuota) : ''; S.reg.montoAuto = true; } var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function cuotas(n){ S.reg.cuotas = Math.max(1, Math.min(48, S.reg.cuotas + n)); var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function guardarRegistro(){
  var r = S.reg, d = { monto: r.monto, fecha: r.fecha, nota: r.nota, periodo: S.periodo };
  if (r.tipo === 'Gasto') { d.tipo = 'Gasto'; d.categoria = r.categoria; d.medio = r.medio; d.cuotas = esTarjeta(r.medio) ? r.cuotas : 1; d.fijo = r.fijo; }
  else if (r.tipo === 'Ingreso') { d.tipo = 'Ingreso'; d.categoria = r.categoria; d.fijo = r.fijo; }
  else if (r.tipo === 'Ahorro') { d.tipo = r.retiro ? 'Retiro de meta' : 'Ahorro'; d.meta = r.meta; }
  else { if (!r.pago) { el('regErr').textContent = 'Elige qué pagas.'; return; } if (r.pago.tipo === 'tarjeta') { d.tipo = 'Pago tarjeta'; d.medio = r.pago.id; } else { d.tipo = 'Pago deuda'; d.deuda = r.pago.id; } }
  if (!(Number(r.monto) > 0)) { el('regErr').textContent = 'Escribe el monto.'; return; }
  if ((d.tipo === 'Gasto' || d.tipo === 'Ingreso') && !d.categoria) { el('regErr').textContent = 'Elige una categoría.'; return; }
  // la hoja se cierra al tiro; un registro nuevo sin conexión queda en el teléfono y se sube solo
  var copia = JSON.parse(JSON.stringify(r)), antes = r.id ? movComoDatos(r.id) : null, nuevo = !r.id;
  if (nuevo) { d.cid = codigo(); if (!d.fecha) d.fecha = hoyLocal(); }
  cerrarHoja();
  if (nuevo && !LOCAL && navigator.onLine === false) { encolarSinConexion(d); return; }
  toast(r.id ? 'Guardando cambios…' : 'Guardando…');
  var fin = function(res){
    if (!res.ok) { reabrirRegistro(copia, res.error); return; }
    if (d.categoria) guardarLocal('cat_' + d.tipo, d.categoria);
    pintar(res.datos);
    if (copia.id) toast('Movimiento actualizado', function(){ api('editarMovimiento', [copia.id, antes], deshecho, null, sinDeshacer); });
    else toast(copia.tipo === 'Pago' ? 'Pago registrado' : 'Listo, registrado', function(){ api('borrarMovimiento', [res.id, S.periodo], deshecho, null, sinDeshacer); });
  };
  var falla = function(){ if (nuevo) encolarSinConexion(d); else reabrirRegistro(copia, 'Sin conexión: no se guardó. Revisa y vuelve a intentar.'); };
  if (copia.id) api('editarMovimiento', [copia.id, d], fin, null, falla); else api('registrar', [d], fin, null, falla);
}
// datos de un movimiento del mes, en el formato de registrar (para deshacer)
function movComoDatos(id){
  var m = null; D.movimientos.forEach(function(x){ if (x.id === id) m = x; }); if (!m) return null;
  return { tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, cuotas: m.cuotas, meta: m.meta, deuda: m.deuda, nota: m.nota, fecha: m.fecha, fijo: m.fijo, periodo: S.periodo };
}
function reabrirRegistro(copia, error){
  if (S.reg) { toast('No se guardó: ' + error, function(){ reabrirRegistro(copia, error); }, 'Ver'); return; }
  S.reg = copia; pintarRegistro(); mostrarHoja();
  el('regErr').textContent = error;
}
/* ── sin conexión: los registros nuevos esperan en este teléfono y se suben solos ── */
// Cada uno lleva su código (cid): si la respuesta se perdió pero el registro llegó, el servidor no lo duplica.
function cola(){ try { var c = JSON.parse(leerLocal('cola') || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; } }
function guardarCola(c){ guardarLocal('cola', JSON.stringify(c)); }
function codigo(){ var a = 'abcdefghijkmnpqrstuvwxyz23456789', t = ''; for (var i = 0; i < 16; i++) t += a.charAt(Math.floor(Math.random() * a.length)); return t; }
function hoyLocal(){ var h = new Date(); return h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2) + '-' + ('0' + h.getDate()).slice(-2); }
function pintarCola(){ if (D) pintarVista(); }
function encolarSinConexion(d){
  var c = cola(); c.push({ cid: d.cid, d: d, error: '' }); guardarCola(c);
  if (d.categoria) guardarLocal('cat_' + d.tipo, d.categoria);
  pintarCola();
  toast('Sin conexión: quedó guardado en el teléfono y se sube solo', function(){ guardarCola(cola().filter(function(x){ return x.cid !== d.cid; })); pintarCola(); toast('Listo, se deshizo'); });
}
function descartarCola(cid){ guardarCola(cola().filter(function(x){ return x.cid !== cid; })); pintarCola(); toast('Movimiento descartado'); }
var SUBIENDO = false;
function subirCola(manual){
  var c = cola().filter(function(x){ return manual || !x.error; });
  if (SUBIENDO || !c.length) return;
  if (navigator.onLine === false) { if (manual) toast('Todavía no hay conexión'); return; }
  SUBIENDO = true;
  var x = c[0];
  google.script.run.withSuccessHandler(function(res){
    SUBIENDO = false;
    var todo = cola();
    if (res && res.ok) {
      todo = todo.filter(function(y){ return y.cid !== x.cid; }); guardarCola(todo);
      if (res.datos) pintar(res.datos); else pintarCola();
      if (todo.some(function(y){ return !y.error; })) subirCola(manual); else toast(todo.length ? 'Se subió lo demás; revisa lo que no se pudo guardar' : 'Listo: se subió lo que anotaste sin conexión');
    } else {
      todo.forEach(function(y){ if (y.cid === x.cid) y.error = (res && res.error) || 'No se pudo guardar'; }); guardarCola(todo); pintarCola();
      subirCola(false);
    }
  }).withFailureHandler(function(){ SUBIENDO = false; if (manual) toast('Sin conexión: se subirá solo cuando vuelva'); }).registrar(x.d);
}
function htmlCola(){
  var c = cola(); if (!c.length) return '';
  var n = c.filter(function(x){ return !x.error; }).length, h = '<div class="card cola">';
  if (n) h += '<div class="cola-t" role="status"><i class="ti ti-cloud-off" aria-hidden="true"></i><span><b>' + n + (n === 1 ? ' movimiento sin subir' : ' movimientos sin subir') + '</b><small>Está guardado en este teléfono y se sube solo al volver la conexión. Se suma al resumen cuando llega.</small></span><button type="button" onclick="subirCola(true)">Subir ahora</button></div>';
  h += c.map(function(x){
    var d = x.d, cc = cat(d.categoria || (d.tipo === 'Pago deuda' ? 'Deudas' : ''));
    return '<div class="fila cola-f' + (x.error ? ' mal' : '') + '">' + ico(cc.icono, cc.color) + '<span class="tx"><b>' + esc(d.categoria || d.tipo) + (d.nota ? ' · ' + esc(d.nota) : '') + '</b><small>' + (x.error ? 'No se pudo guardar: ' + esc(x.error) : fechaCorta(d.fecha) + ' · esperando conexión') + '</small></span><span class="v num">' + clp(d.monto) + '</span>'
      + (x.error ? '<button type="button" class="cola-x" onclick="descartarCola(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(x.cid) + '" aria-label="Descartar este movimiento"><i class="ti ti-trash"></i></button>' : '') + '</div>';
  }).join('');
  return h + '</div>';
}
window.addEventListener('online', function(){ subirCola(); });
window.addEventListener('offline', function(){ toast('Sin conexión: lo que registres queda guardado en el teléfono'); });
document.addEventListener('visibilitychange', function(){ if (!document.hidden) subirCola(); });
setInterval(function(){ subirCola(); }, 30000);
function deshecho(res){ if (!res.ok) { toast(res.error); return; } pintar(res.datos); toast('Listo, se deshizo'); }
function sinDeshacer(){ toast('Sin conexión: no se pudo deshacer.'); }
function editarMov(id){
  var m = null; D.movimientos.forEach(function(x){ if (x.id === id) m = x; }); if (!m) return;
  var pre = { id: m.id, tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, cuotas: m.cuotas, meta: m.meta, fecha: m.fecha, nota: m.nota, fijo: m.fijo };
  if (m.tipo === 'Pago tarjeta') pre.pago = { tipo: 'tarjeta', id: m.medio };
  if (m.tipo === 'Pago deuda') pre.pago = { tipo: 'deuda', id: m.deuda };
  abrirRegistro(pre);
}
function borrarMov(){
  var b = event.currentTarget;
  if (!b.getAttribute('data-ok')) { b.setAttribute('data-ok', '1'); b.innerHTML = '<i class="ti ti-trash"></i>¿Borrar?'; return; }
  var id = S.reg.id, antes = movComoDatos(id);
  cerrarHoja(); toast('Borrando…');
  api('borrarMovimiento', [id, S.periodo], function(res){
    if (!res.ok) { toast(res.error); return; }
    pintar(res.datos);
    toast('Movimiento borrado', antes ? function(){ api('registrar', [antes], deshecho, null, sinDeshacer); } : null);
  }, null, function(){ toast('Sin conexión: no se borró. Intenta de nuevo.'); });
}
function pagarTarjeta(nombre){ var t = null; D.tarjetas.forEach(function(x){ if (x.nombre === nombre) t = x; }); abrirRegistro({ tipo: 'Pago tarjeta', pago: { tipo: 'tarjeta', id: nombre }, monto: t && t.usado > 0 ? t.usado : '' }); }
function pagarDeuda(id){ var d = null; D.deudas.forEach(function(x){ if (x.id === id) d = x; }); abrirRegistro({ tipo: 'Pago deuda', pago: { tipo: 'deuda', id: id }, monto: d ? d.cuota : '' }); }

/* ── formularios: meta, tarjeta y deuda ── */
// extra: datos fijos que viajan (id…); clase: meta, tarjeta, deuda o fijo (con id, muestra Quitar); preparar(d): ajusta antes de enviar
function formulario(titulo, campos, fn, extra, clase, preparar){
  var h = campos.map(function(c){ return campoTexto('f-' + c[0], c[1], c[2], c[3], c[4]); }).join('') + '<div class="error" id="f-err"></div>';
  var quita = extra && extra.id && clase;
  abrirHoja(titulo, h, (quita ? '<button class="btn btn-peligro" style="flex:0 0 auto" id="f-quitar" aria-label="Quitar"><i class="ti ti-trash"></i></button>' : '') + '<button class="btn btn-p" id="f-ok"><i class="ti ti-check"></i>Guardar</button>');
  if (quita) el('f-quitar').onclick = function(){
    if (!this.getAttribute('data-ok')) { this.setAttribute('data-ok', '1'); this.innerHTML = '<i class="ti ti-trash"></i>¿Quitar?'; return; }
    api('quitar', [clase, extra.id], function(r){ if (!r.ok) { el('f-err').textContent = r.error; return; } cerrarHoja(); toast('Listo, quitado. Su historial se conserva.'); pintar(r.datos); }, this);
  };
  el('f-ok').onclick = function(){
    var d = {}; campos.forEach(function(c){ d[c[0]] = el('f-' + c[0]).value; });
    if (preparar) preparar(d);
    var borrar = extra;
    api(fn, [Object.assign(d, borrar || {})], function(r){ if (!r.ok) { el('f-err').textContent = r.error; var f = el('f-' + r.campo); if (f) f.focus(); return; } cerrarHoja(); toast('Guardado'); pintar(r.datos); }, this);
  };
}
function buscar(lista, id){ var x = null; lista.forEach(function(e){ if (e.id === id) x = e; }); return x || {}; }
function formMeta(id){ var m = buscar(D.metas, id); formulario(id ? 'Editar meta' : 'Nueva meta', [['nombre','¿Para qué ahorras?',m.nombre || '','text'],['objetivo','¿Cuánto quieres juntar?',m.objetivo || '','numero'],['fecha','¿Para cuándo? (opcional)',m.fecha || '','date']], 'guardarMeta', { id: id || '', icono: m.icono || 'ti-target-arrow' }, 'meta'); }
function formTarjeta(id){ var t = buscar(D.tarjetas, id); formulario(id ? 'Editar tarjeta' : 'Nueva tarjeta', [['nombre','Nombre (ej: Visa Banco)',t.nombre || '','text'],['cupo','Cupo total',t.cupo || '','numero'],['pago','Día de pago (1 a 31)',t.pago || '','numero']], 'guardarTarjeta', { id: id || '', cierre: t.cierre || '' }, 'tarjeta'); }
function formDeuda(id){
  var d = buscar(D.deudas, id), uf = d.moneda === 'UF';
  formulario(id ? 'Editar deuda' : 'Nueva deuda', [['nombre','Nombre (ej: Crédito hipotecario)',d.nombre || '','text'],['acreedor','Banco o acreedor (opcional)',d.acreedor || '','text'],['moneda','La cuota está en',uf ? 'UF' : 'CLP','select',[{ v: 'CLP', t: 'Pesos' }, { v: 'UF', t: 'UF (se actualiza sola cada día)' }]],['cuota','Valor de la cuota (en UF, por ejemplo 12,35)',uf ? ufTxt(d.cuotaUF) : (d.cuota || ''),'decimal'],['cuotas','Total de cuotas',d.cuotas || '','numero'],['pago','Día de pago (1 a 31)',d.pago || '','numero']], 'guardarDeuda', { id: id || '' }, 'deuda');
  var etq = function(){ var l = document.querySelector('label[for="f-cuota"]'); if (l) l.textContent = el('f-moneda').value === 'UF' ? 'Valor de la cuota (en UF, por ejemplo 12,35)' : 'Valor de la cuota (en pesos)'; };
  el('f-moneda').onchange = etq; etq();
}
function ufTxt(n){ return n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 4 }); }
function esIngreso(nombre){ return D.categorias.some(function(c){ return c.nombre === nombre && c.tipo === 'Ingreso'; }); }
function formFijo(id){
  var x = buscar(D.fijos, id);
  var grupos = [['Gasto','Gastos'],['Ingreso','Ingresos']].map(function(g){ return { grupo: g[1], items: D.categorias.filter(function(c){ return c.tipo === g[0] && c.nombre !== 'Deudas'; }).map(function(c){ return { v: c.nombre, t: c.nombre }; }) }; });
  formulario(id ? 'Editar fijo' : 'Nuevo gasto o ingreso fijo', [['nombre','Nombre (ej: Arriendo, Luz, Netflix, Sueldo)',x.nombre || '','text'],['monto','Monto de un mes normal',x.monto || '','numero'],['dia','Día del mes en que se paga o llega (1 a 31)',x.dia || '','numero'],['categoria','Categoría',x.categoria || 'Casa','select',grupos],['medio','Cómo lo pagas (solo para gastos)',x.medio || leerLocal('medio') || 'Débito','select',D.medios.map(function(m){ return { v: m, t: m }; })]], 'guardarFijo', { id: id || '' }, 'fijo', function(d){ d.tipo = esIngreso(d.categoria) ? 'Ingreso' : 'Gasto'; });
}
function registrarFijo(id){ var x = buscar(D.fijos, id); if (!x.id) return; abrirRegistro({ tipo: x.tipo, monto: x.monto, categoria: x.categoria, medio: x.medio || '', fijo: x.id, fecha: D.hoy }); }
function vistaFijos(){
  var h = '<h2>Gastos e ingresos fijos<button onclick="formFijo()"><i class="ti ti-plus"></i> Nuevo</button></h2>';
  if (!D.fijos.length) return h + '<div class="card vacio"><i class="ti ti-repeat"></i>Agrega lo que pagas o recibes todos los meses (arriendo, cuentas, suscripciones, sueldo). Cada mes te aviso cuándo toca y lo registras con un toque.</div>';
  return h + '<div class="card lista">' + D.fijos.map(function(x){ var c = cat(x.categoria); return '<button class="fila toca" onclick="formFijo(&#39;' + x.id + '&#39;)">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(x.nombre) + '</b><small>Día ' + x.dia + ' · ' + esc(x.tipo === 'Ingreso' ? 'Ingreso' : x.medio) + (x.registrado ? ' · listo este mes' : '') + '</small></span><span class="v num">' + clp(x.monto) + '</span></button>'; }).join('') + '</div>';
}

// Abre al instante con lo último que se vio en este teléfono y lo actualiza al llegar la respuesta
(function(){
  var h = new Date(), hoy = h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2) + '-' + ('0' + h.getDate()).slice(-2);
  if (!LOCAL) try { var g = JSON.parse(leerLocal('datos') || 'null'); if (g && g.ok && g.version === VERSION_PANEL && g.hoy === hoy) pintar(g, true); } catch (e) {}
  cargar();
})();
</script>
</body></html>
`).replace("__VERSION__", VERSION);
}
// Página puente de la app sin conexión (?a=pwa). Mismas reglas que htmlPanel_: sin comillas invertidas, ${ ni barras invertidas.
function htmlPuente_() {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mis Finanzas · subir</title>
<style>
@font-face{font-family:Inter;font-weight:400;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-400.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:600;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-600.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:700 800;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/inter-700.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:500;font-display:swap;src:url(https://ambilor.github.io/ambilorlab/fuentes/jetbrains-mono-500.woff2) format("woff2")}
:root{--bg:#EEF2F7;--s:#FFFFFF;--b:#DCE4EE;--t:#12304D;--t2:#3E546D;--t3:#566A80;--a:#1F5C99;--glow:#4C8DDB;--marca-1:#163F6B;--ok:#137333;--ok-s:#E6F4EA;--warn:#8F5507;--warn-s:#FEF3E0;--bad:#B3261E;--bad-s:#FCE8E6;--sh:0 1px 2px rgba(16,24,40,.05),0 6px 20px -8px rgba(16,24,40,.12);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#06080C;--s:#0E131B;--b:#1B2330;--t:#E8EDF5;--t2:#B4BFD2;--t3:#98A2B3;--a:#8FC1FF;--ok:#4CC387;--ok-s:#123224;--warn:#F2B04E;--warn-s:#33270F;--bad:#F2786F;--bad-s:#3A1A1A;--sh:0 1px 2px rgba(0,0,0,.3),0 8px 24px -10px rgba(0,0,0,.6);color-scheme:dark}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--t);font-size:15px;line-height:1.45;padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(24px + env(safe-area-inset-bottom,0px))}
.caja{max-width:520px;margin:0 auto}
.cab{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,var(--marca-1),var(--a) 60%,var(--glow));color:#fff;display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-weight:500;font-size:16px;flex-shrink:0}
h1{font-size:18px;letter-spacing:-.01em}
.sub{color:var(--t3);font-size:13px}
.card{background:var(--s);border:1px solid var(--b);border-radius:18px;box-shadow:var(--sh);overflow:hidden;margin-bottom:14px}
.fila{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid var(--b)}
.fila:first-child{border-top:0}
.fila div{min-width:0}
.fila b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fila small{color:var(--t3);font-size:12.5px}
.monto{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.msg{padding:14px 16px;font-size:14px}
.msg.ok{background:var(--ok-s);color:var(--ok)}
.msg.warn{background:var(--warn-s);color:var(--warn)}
.msg.bad{background:var(--bad-s);color:var(--bad)}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border:0;border-radius:14px;background:var(--a);color:#fff;font:inherit;font-weight:700;font-size:16px;text-decoration:none;cursor:pointer}
@media (prefers-color-scheme:dark){.btn{color:#06080C}}
.btn:disabled{opacity:.55;cursor:default}
.btn:focus-visible{outline:3px solid var(--glow);outline-offset:2px}
.oculto{display:none}
</style>
</head><body>
<div class="caja">
  <div class="cab"><span class="logo">F.</span><div><h1>Mis Finanzas</h1><div class="sub" id="sub">Revisando lo que trae la app…</div></div></div>
  <div class="card" id="lista"></div>
  <button class="btn" id="subir" disabled>Un momento…</button>
  <a class="btn oculto" id="volver" target="_top" rel="noopener">Volver a la app</a>
</div>
<script>
var P = { lista: [], retorno: '' };
function el(i){ return document.getElementById(i); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function clp(n){ var v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('es-CL'); }
function leerHash(h){
  var o = {};
  String(h || '').replace(/^#/, '').split('&').forEach(function(p){
    var i = p.indexOf('=');
    if (i > 0) { try { o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); } catch (e) {} }
  });
  return o;
}
function aviso(clase, texto){ el('lista').innerHTML = '<div class="msg ' + clase + '">' + texto + '</div>'; }
function pintar(){
  if (!P.retorno) { el('sub').textContent = 'Esta página se abre desde la app.'; aviso('warn', 'Abre la app Mis Finanzas en tu teléfono y toca <b>Sincronizar</b>.'); el('subir').classList.add('oculto'); return; }
  if (P.lista === null) { el('sub').textContent = 'El enlace llegó incompleto.'; aviso('bad', 'No se pudieron leer los registros. Vuelve a la app y toca <b>Sincronizar</b> otra vez.'); el('subir').classList.add('oculto'); return; }
  var n = P.lista.length;
  el('sub').textContent = n ? (n === 1 ? '1 registro por subir' : n + ' registros por subir') : 'Nada por subir';
  if (!n) aviso('ok', 'No hay registros pendientes. Se traerán tus categorías y el resumen del mes a la app.');
  else el('lista').innerHTML = P.lista.map(function(d){
    var titulo = d.nota || d.categoria || d.tipo;
    return '<div class="fila"><div><b>' + esc(titulo) + '</b><small>' + esc(d.fecha) + ' · ' + esc(d.tipo) + (d.categoria && d.nota ? ' · ' + esc(d.categoria) : '') + (d.medio ? ' · ' + esc(d.medio) : '') + '</small></div><span class="monto">' + clp(d.monto) + '</span></div>';
  }).join('');
  el('subir').textContent = n ? 'Subir y volver a la app' : 'Actualizar y volver a la app';
  el('subir').disabled = false;
}
function fin(r){
  if (!r || !r.ok) { el('subir').disabled = false; el('subir').textContent = 'Reintentar'; aviso('bad', esc(r && r.error ? r.error : 'No se pudo guardar.')); return; }
  var nuevos = 0, repetidos = 0, malos = 0;
  r.resultados.forEach(function(x){ if (!x.ok) malos++; else if (x.repetido) repetidos++; else nuevos++; });
  var partes = [];
  if (nuevos) partes.push(nuevos === 1 ? '1 guardado' : nuevos + ' guardados');
  if (repetidos) partes.push(repetidos === 1 ? '1 ya estaba' : repetidos + ' ya estaban');
  if (malos) partes.push(malos === 1 ? '1 con problema (lo verás en la app)' : malos + ' con problema (los verás en la app)');
  aviso(malos ? 'warn' : 'ok', partes.length ? esc(partes.join(' · ')) + '.' : 'Tus datos están al día.');
  el('sub').textContent = 'Listo';
  var url = r.retorno + '#pwa=' + encodeURIComponent(JSON.stringify({ resultados: r.resultados, catalogo: r.catalogo }));
  el('volver').href = url;
  el('subir').classList.add('oculto');
  el('volver').classList.remove('oculto');
  try { window.top.location.href = url; } catch (e) {}
}
el('subir').addEventListener('click', function(){
  el('subir').disabled = true; el('subir').textContent = 'Guardando…';
  google.script.run.withSuccessHandler(fin).withFailureHandler(function(e){ fin({ ok: false, error: 'No se pudo conectar con tu planilla. Revisa tu conexión y reintenta.' }); }).puentePwa(P.lista || [], P.retorno);
});
google.script.url.getLocation(function(loc){
  var h = leerHash(loc && loc.hash);
  P.retorno = h.r || '';
  try { var l = JSON.parse(h.d || '[]'); P.lista = Array.isArray(l) ? l : null; } catch (e) { P.lista = null; }
  pintar();
});
</script>
</body></html>
`;
}

  var PERMITIDAS_APP_ = { panelDatos: panelDatos, registrar: registrar, editarMovimiento: editarMovimiento, borrarMovimiento: borrarMovimiento, guardarCategorias: guardarCategorias, guardarCategoria: guardarCategoria, quitarCategoria: quitarCategoria, guardarPresupuestos: guardarPresupuestos, guardarConfig: guardarConfig, quitar: quitar, cargarEjemplo: cargarEjemplo, borrarEjemplo: borrarEjemplo, guardarMeta: guardarMeta, guardarTarjeta: guardarTarjeta, guardarDeuda: guardarDeuda, guardarFijo: guardarFijo };
  return {
    VERSION: VERSION, HOJA: HOJA, CABECERAS: CABECERAS, EJ: EJ_,
    llamar: function (nombre, args) {
      if (!Object.prototype.hasOwnProperty.call(PERMITIDAS_APP_, nombre)) throw new Error("Función no disponible en la app: " + nombre);
      return PERMITIDAS_APP_[nombre].apply(null, args || []);
    },
  };
};
