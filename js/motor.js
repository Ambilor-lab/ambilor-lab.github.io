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

const VERSION = "3.9";   // ver CAMBIOS.md
const ESQUEMA = "1.7";

const HOJA = { MOV: "Movimientos", CAT: "Categorías", METAS: "Metas", TARJ: "Tarjetas", DEUDAS: "Deudas", FIJOS: "Fijos", COMP: "Compartidas", ACT: "Activos", SALDOS: "Saldos", CONFIG: "Config" };

const CABECERAS = {
  "Movimientos": ["ID", "Fecha", "Tipo", "Monto", "Categoría", "Medio", "Cuotas", "Meta", "Deuda", "Nota", "Registrado", "Fijo", "Etiqueta", "Moneda", "Original"],
  "Categorías":  ["Categoría", "Tipo", "Presupuesto", "Ícono", "Color", "Activa"],
  "Metas":       ["ID", "Meta", "Objetivo", "Fecha objetivo", "Ícono", "Activa"],
  "Tarjetas":    ["ID", "Tarjeta", "Cupo", "Día de cierre", "Día de pago", "Activa"],
  "Deudas":      ["ID", "Deuda", "Acreedor", "Cuota", "Cuotas", "Día de pago", "Inicio", "Activa", "Moneda"],
  "Fijos":       ["ID", "Fijo", "Tipo", "Monto", "Categoría", "Medio", "Día", "Activa"],
  // cuentas compartidas (3.6): una fila por persona que me debe o a quien le debo; Grupo une las filas de una misma cuenta
  "Compartidas": ["ID", "Fecha", "Cuenta", "Persona", "Sentido", "Monto", "Pagado", "Grupo", "Movimiento", "Detalle"],
  // patrimonio (3.8): cuentas, ahorros e inversiones con su saldo; Saldos guarda cada actualización (historia mes a mes)
  "Activos":     ["ID", "Activo", "Tipo", "Moneda", "Saldo", "Actualizado", "Activa"],
  "Saldos":      ["Fecha", "Activo", "Saldo"],
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
  ["suscripcionesNo", "texto", "", "Cobros que se repiten y que dijiste que no son fijos (no se vuelven a sugerir)"],
  ["propinaPct", "numero", 10, "Propina sugerida al dividir una cuenta compartida (%; 0 = sin propina)"],
  ["valorDolar", "numero", 0, "Valor del dólar a mano (0 = se trae solo cada día desde mindicador.cl)"],
  ["reglasCat", "texto", "", "Clasificación automática: tus reglas palabra → categoría (se editan en Ajustes)"],
  ["fondoMeses", "numero", 3, "Meses de gastos que quieres cubrir con tu fondo de emergencia (1 a 12; 0 = no mostrar)"],
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
  cfg.propinaPct = Math.min(100, Math.max(0, Math.round(cfg.propinaPct) || 0));
  cfg.valorDolar = Math.max(0, Number(cfg.valorDolar) || 0);
  cfg.fondoMeses = Math.min(12, Math.max(0, Math.round(cfg.fondoMeses)));
  if (isNaN(cfg.fondoMeses)) cfg.fondoMeses = 3;
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
  t._movs = t.filas.map(f => ({ id: texto_(f.ID), fecha: fechaDe_(f.Fecha), tipo: TIPOS.indexOf(texto_(f.Tipo)) >= 0 ? texto_(f.Tipo) : "Gasto", monto: Math.abs(numero_(f.Monto) || 0), categoria: texto_(f["Categoría"]), medio: texto_(f.Medio), cuotas: Math.max(1, Math.round(numero_(f.Cuotas) || 1)), meta: texto_(f.Meta), deuda: texto_(f.Deuda), nota: texto_(f.Nota), fijo: texto_(f.Fijo), etiqueta: texto_(f.Etiqueta), moneda: texto_(f.Moneda).toUpperCase() === "USD" ? "USD" : "", original: texto_(f.Moneda).toUpperCase() === "USD" ? (decimal_(f.Original) || 0) : 0, _fila: f._fila })).filter(m => m.fecha && m.monto > 0);
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
// Valor de la UF (o del dólar) de hoy: el de Ajustes si se escribió a mano; si no, mindicador.cl
// (una consulta al día, guardada). Sin internet se usa el último valor conocido.
function indicador_(codigo, manual, prop) {
  if (manual > 0) return { valor: manual, fuente: "manual" };
  const props = PropertiesService.getScriptProperties(), hoy = iso_(ahora_());
  let g = null; try { g = JSON.parse(props.getProperty(prop) || "null"); } catch (e) { g = null; }
  if (g && g.fecha === hoy && g.valor > 0) return { valor: g.valor, fuente: "mindicador.cl", fecha: g.fecha };
  try {
    if (typeof UrlFetchApp !== "undefined") {
      const url = "https://mindicador.cl/api/" + codigo + (codigo === "uf" ? "/" + Utilities.formatDate(ahora_(), zona_(), "dd-MM-yyyy") : "");
      const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) {
        const j = JSON.parse(r.getContentText()), v = j && j.serie && j.serie[0] ? Number(j.serie[0].valor) : 0;
        if (v > 0) { props.setProperty(prop, JSON.stringify({ valor: v, fecha: hoy })); return { valor: v, fuente: "mindicador.cl", fecha: hoy }; }
      }
    }
  } catch (e) { /* sin conexión: se usa el último valor */ }
  if (g && g.valor > 0) return { valor: g.valor, fuente: "último conocido", fecha: g.fecha };
  return { valor: 0, fuente: "" };
}
function valorUF_() { return indicador_("uf", config_().valorUF, "FA_UF"); }
function valorDolar_() { return indicador_("dolar", config_().valorDolar, "FA_DOLAR"); }
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

/* ── lo que cambió, cobros que se repiten y racha (3.4) ─────────────── */
// Gasto por categoría de un período hasta su día "hastaDia" (0 = primer día). Lo comprado en el período cuenta
// según su fecha; las cuotas de compras de meses anteriores cuentan siempre (se cobran ese período).
function gastoHasta_(movs, indice, hastaDia, cfg) {
  const desde = deIso_(rangoPeriodo_(indice, cfg.inicioMes).desde), out = {};
  movs.forEach(m => {
    let v = 0, c = m.categoria;
    const enEste = indicePeriodo_(m.fecha, cfg.inicioMes) === indice;
    if (m.tipo === "Gasto") { v = imputado_(m, indice, cfg.inicioMes); if (!v || (enEste && diasEntre_(desde, m.fecha) > hastaDia)) return; }
    else if (m.tipo === "Pago deuda") { if (!enEste || diasEntre_(desde, m.fecha) > hastaDia) return; v = m.monto; c = CAT_DEUDAS; }
    else return;
    out[c] = (out[c] || 0) + v;
  });
  return out;
}
// Lo que más cambió frente al promedio de los 3 períodos anteriores (los que tienen movimientos), comparando
// a la misma altura del mes (un mes pasado se compara completo). Desde el día 7, para que el ritmo diga algo.
// Solo cambios que importan: ±20 % y al menos $5.000, en categorías con $10.000 o más. Hasta 2 alzas y 1 baja.
function explicaciones_(indice, hoy, cfg) {
  const movs = movimientos_(), actual = indicePeriodo_(hoy, cfg.inicioMes);
  const dia = indice === actual ? diasEntre_(deIso_(rangoPeriodo_(indice, cfg.inicioMes).desde), hoy) : 40;
  if (dia < 6) return [];
  const usados = {}; movs.forEach(m => { usados[indicePeriodo_(m.fecha, cfg.inicioMes)] = true; });
  const previos = [1, 2, 3].map(k => indice - k).filter(k => usados[k]);
  if (!previos.length) return [];
  const este = gastoHasta_(movs, indice, dia, cfg), suma = {};
  previos.forEach(k => { const g = gastoHasta_(movs, k, dia, cfg); Object.keys(g).forEach(c => { suma[c] = (suma[c] || 0) + g[c]; }); });
  const lista = [];
  Object.keys(Object.assign({}, suma, este)).forEach(c => {
    const a = Math.round(este[c] || 0), p = Math.round((suma[c] || 0) / previos.length), dif = a - p;
    if (Math.max(a, p) < 10000 || Math.abs(dif) < 5000) return;
    const pct = p > 0 ? Math.round(dif * 100 / p) : null;
    if (pct !== null && Math.abs(pct) < 20) return;
    lista.push({ categoria: c, actual: a, promedio: p, pct: pct, dif: dif, meses: previos.length, alDia: indice === actual });
  });
  return lista.filter(x => x.dif > 0).sort((x, y) => y.dif - x.dif).slice(0, 2)
    .concat(lista.filter(x => x.dif < 0).sort((x, y) => x.dif - y.dif).slice(0, 1));
}
// Cobros que parecen mensuales y no están en Fijos: mismo monto, categoría y nota, una sola vez por período,
// cerca del mismo día del mes (±5), en al menos 2 períodos seguidos, el último este período o el anterior.
// Se ofrecen para pasarlos a Fijos; los que la persona descarta quedan en el ajuste suscripcionesNo.
function claveSuscripcion_(m) { return [m.categoria, m.monto, texto_(m.nota).toLowerCase()].join("|").slice(0, 80); }
function suscripciones_(hoy, cfg) {
  const actual = indicePeriodo_(hoy, cfg.inicioMes), grupos = {};
  let no = []; try { no = JSON.parse(cfg.suscripcionesNo || "[]"); } catch (e) { no = []; }
  const fijos = fijos_().filter(f => f.activa && f.tipo === "Gasto");
  movimientos_().forEach(m => {
    if (m.tipo !== "Gasto" || m.fijo || m.cuotas > 1 || m.monto < 1000) return;
    const k = indicePeriodo_(m.fecha, cfg.inicioMes); if (k < actual - 3 || k > actual) return;
    const clave = claveSuscripcion_(m);
    const g = grupos[clave] || (grupos[clave] = { clave: clave, categoria: m.categoria, monto: m.monto, nota: m.nota, medio: m.medio, por: {}, dias: [], ultima: 0 });
    g.por[k] = (g.por[k] || 0) + 1; g.dias.push(partes_(m.fecha).d);
    if (m.fecha.getTime() > g.ultima) { g.ultima = m.fecha.getTime(); g.medio = m.medio; }
  });
  return Object.keys(grupos).map(c => grupos[c]).filter(g => {
    const ks = Object.keys(g.por).map(Number).sort((a, b) => a - b);
    if (ks.some(k => g.por[k] > 1) || ks[ks.length - 1] < actual - 1) return false;   // varias veces al mes: es frecuente, no mensual
    if (Math.max.apply(null, g.dias) - Math.min.apply(null, g.dias) > 5) return false;
    let seguidos = 1; for (let i = ks.length - 1; i > 0 && ks[i] - ks[i - 1] === 1; i--) seguidos++;
    g.veces = seguidos;
    return seguidos >= 2 && no.indexOf(g.clave) < 0 && !fijos.some(f => f.categoria === g.categoria && Math.abs(f.monto - g.monto) <= f.monto * 0.15);
  }).sort((a, b) => b.veces - a.veces || b.monto - a.monto).slice(0, 3)
    .map(g => ({ clave: g.clave, categoria: g.categoria, monto: g.monto, nota: g.nota, medio: g.medio, dia: g.dias[g.dias.length - 1], veces: g.veces }));
}
function descartarSuscripcion(clave) {
  olvidarLecturas_();
  asegurarEstructura_();
  const c = texto_(clave).slice(0, 80); if (!c) return falla_("No se encontró ese cobro.");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.CONFIG), f = t.filas.find(x => texto_(x.Clave) === "suscripcionesNo");
    let no = []; try { no = JSON.parse(f ? texto_(f.Valor) || "[]" : "[]"); } catch (e) { no = []; }
    if (no.indexOf(c) < 0) no.push(c);
    const v = JSON.stringify(no.slice(-30));
    if (f) escribirFila_(t, f._fila, { "Valor": v }); else agregarFilas_(t, [{ "Clave": "suscripcionesNo", "Valor": v, "Descripción": CONFIG_CAMPOS.find(x => x[0] === "suscripcionesNo")[3] }]);
  } finally { lock.releaseLock(); }
  return { ok: true, datos: panelDatos() };
}
// Días seguidos con algo anotado, hasta hoy (o hasta ayer, si hoy todavía no hay nada)
function racha_(hoy) {
  const dias = {}; movimientos_().forEach(m => { const p = partes_(m.fecha); dias[p.a * 10000 + p.m * 100 + p.d] = true; });
  const clave = d => { const p = partes_(d); return p.a * 10000 + p.m * 100 + p.d; };
  const p0 = partes_(hoy); let d = new Date(p0.a, p0.m - 1, p0.d, 12, 0, 0), n = 0;
  const hoyHay = !!dias[clave(d)];
  if (!hoyHay) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12, 0, 0);
  while (dias[clave(d)] && n < 3660) { n++; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12, 0, 0); }
  return { dias: n, hoy: hoyHay };
}

/* ── patrimonio (3.8) ───────────────────────────────────────────────── */
// Cuentas, ahorros e inversiones con su saldo (en pesos, dólares o UF). Cada vez que se actualiza un saldo
// queda una fila en Saldos: con eso se arma la historia mes a mes (el último saldo conocido al cierre de cada mes).
// Patrimonio = lo que tienes (+ lo que te deben) − lo que debes (saldo de deudas, uso de tarjetas y lo que debes a otros).
const TIPOS_ACTIVO_ = ["Cuenta", "Ahorro", "Inversión", "Largo plazo", "Efectivo", "Otro"];
function montoActivo_(v, moneda) { const n = moneda === "CLP" ? numero_(v) : decimal_(v); return isNaN(n) ? NaN : (moneda === "CLP" ? Math.round(n) : Math.round(n * 100) / 100); }
function activos_() {
  const t = tabla_(HOJA.ACT); if (!t) return [];
  return t.filas.map(f => {
    const moneda = ["USD", "UF"].indexOf(texto_(f.Moneda).toUpperCase()) >= 0 ? texto_(f.Moneda).toUpperCase() : "CLP", tipo = texto_(f.Tipo);
    return { id: texto_(f.ID), nombre: texto_(f.Activo), tipo: TIPOS_ACTIVO_.indexOf(tipo) >= 0 ? tipo : "Otro", moneda: moneda, saldo: montoActivo_(f.Saldo, moneda) || 0, actualizado: fechaDe_(f.Actualizado), activa: texto_(f.Activa) === "" ? true : esSi_(f.Activa), _fila: f._fila };
  }).filter(a => a.id && a.nombre);
}
function tasas_(lista) {
  return { USD: lista.some(a => a.moneda === "USD") ? valorDolar_().valor : 0, UF: lista.some(a => a.moneda === "UF") ? valorUF_().valor : 0, CLP: 1 };
}
function saldos_() {
  const t = tabla_(HOJA.SALDOS); if (!t) return [];
  return t.filas.map(f => ({ fecha: fechaDe_(f.Fecha), activo: texto_(f.Activo), saldo: f.Saldo })).filter(s => s.fecha && s.activo);
}
// d: { id, nombre, tipo, moneda, saldo }
function guardarActivo(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const nombre = texto_(d.nombre).slice(0, 40), tipo = TIPOS_ACTIVO_.indexOf(texto_(d.tipo)) >= 0 ? texto_(d.tipo) : "Cuenta";
  const moneda = ["USD", "UF"].indexOf(texto_(d.moneda).toUpperCase()) >= 0 ? texto_(d.moneda).toUpperCase() : "CLP";
  if (!nombre) return falla_("Ponle nombre (ej: Cuenta RUT, Depósito a plazo, APV).", "nombre");
  const saldo = montoActivo_(d.saldo, moneda);
  if (isNaN(saldo) || texto_(d.saldo) === "") return falla_("Escribe el saldo de hoy (puede ser 0).", "saldo");
  if (Math.abs(saldo) > 99999999999) return falla_("El saldo es demasiado grande.", "saldo");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.ACT), f = d.id ? t.filas.find(x => texto_(x.ID) === texto_(d.id)) : null, hoy = ahora_();
    const id = f ? texto_(f.ID) : idNuevo_("A"), antes = f ? montoActivo_(f.Saldo, moneda) : null;
    const fila = { "Activo": nombre, "Tipo": tipo, "Moneda": moneda, "Saldo": saldo, "Actualizado": hoy, "Activa": "Si" };
    if (f) escribirFila_(t, f._fila, fila); else agregarFilas_(t, [Object.assign({ "ID": id }, fila)]);
    if (antes !== saldo || !f) agregarFilas_(tabla_(HOJA.SALDOS), [{ "Fecha": hoy, "Activo": id, "Saldo": saldo }]);
    return { ok: true, id: id, datos: panelDatos() };
  } finally { lock.releaseLock(); }
}
function estadoPatrimonio_(hoy, cfg, tarj, deu) {
  const lista = activos_().filter(a => a.activa), tasas = tasas_(lista), comp = estadoCompartidas_();
  const items = lista.map(a => {
    const tasa = tasas[a.moneda];
    return { id: a.id, nombre: a.nombre, tipo: a.tipo, moneda: a.moneda, saldo: a.saldo, pesos: Math.round(a.saldo * (tasa || 0)), sinTasa: !(tasa > 0),
      actualizado: a.actualizado ? iso_(a.actualizado) : "", dias: a.actualizado ? diasEntre_(a.actualizado, hoy) : null };
  }).sort((a, b) => b.pesos - a.pesos);
  const tengo = items.reduce((s, a) => s + a.pesos, 0);
  const creditos = deu.filter(d => !d.terminada).reduce((s, d) => s + (d.saldo || 0), 0), tarjetas = tarj.reduce((s, t) => s + t.usado, 0);
  const activos = tengo + comp.meDeben, pasivos = creditos + tarjetas + comp.debo;
  // historia: lo que tenías al cierre de cada uno de los últimos 6 meses (último saldo conocido de cada cuenta)
  const sal = saldos_().sort((a, b) => a.fecha - b.fecha), actual = indicePeriodo_(hoy, cfg.inicioMes), historia = [];
  for (let k = actual - 5; k <= actual; k++) {
    const hasta = k === actual ? hoy : deIso_(rangoPeriodo_(k, cfg.inicioMes).hasta), ultimo = {};
    sal.forEach(s => { if (diasEntre_(s.fecha, hasta) >= 0) ultimo[s.activo] = s.saldo; });
    let suma = 0, hay = false;
    lista.forEach(a => { if (ultimo[a.id] !== undefined) { hay = true; suma += (montoActivo_(ultimo[a.id], a.moneda) || 0) * (tasas[a.moneda] || 0); } });
    historia.push({ indice: k, mes: MESES_[((k % 12) + 12) % 12].slice(0, 3), tengo: hay ? Math.round(suma) : null });
  }
  const previo = historia[historia.length - 2];
  return { hay: items.length > 0, items: items, tengo: tengo, meDeben: comp.meDeben, debo: comp.debo, creditos: creditos, tarjetas: tarjetas,
    activos: activos, pasivos: pasivos, neto: activos - pasivos, historia: historia, cambio: previo && previo.tengo !== null ? tengo - previo.tengo : null,
    dolar: tasas.USD || null, uf: tasas.UF || null };
}
// Gastos de un período con las mismas reglas del resumen (cuotas imputadas y pagos de deuda)
function gastosPeriodo_(movs, indice, cfg) {
  let g = 0;
  movs.forEach(mv => {
    if (mv.tipo === "Gasto") g += imputado_(mv, indice, cfg.inicioMes);
    else if (mv.tipo === "Pago deuda" && indicePeriodo_(mv.fecha, cfg.inicioMes) === indice) g += mv.monto;
  });
  return g;
}
// Fondo de emergencia: cuántos meses de gastos cubre lo que tienes a mano. Gasto de un mes = promedio de los
// 3 meses anteriores con gastos. Lo que tienes = tus cuentas sin las de largo plazo (APV…); sin cuentas, lo ahorrado en metas.
function fondoEmergencia_(hoy, cfg, pat, metas) {
  if (!cfg.fondoMeses) return null;
  const movs = movimientos_(), actual = indicePeriodo_(hoy, cfg.inicioMes);
  let suma = 0, n = 0;
  for (let k = 1; k <= 3; k++) { const g = gastosPeriodo_(movs, actual - k, cfg); if (g > 0) { suma += g; n++; } }
  if (!n) return null;
  const mensual = Math.round(suma / n);
  const colchon = pat.hay ? pat.items.filter(a => a.tipo !== "Largo plazo").reduce((s, a) => s + a.pesos, 0) : metas.reduce((s, m) => s + Math.max(0, m.ahorrado), 0);
  if (!pat.hay && !(colchon > 0)) return null;
  const objetivo = mensual * cfg.fondoMeses;
  return { mensual: mensual, colchon: colchon, meses: Math.max(0, Math.floor(colchon * 10 / mensual) / 10), objetivo: objetivo, falta: Math.max(0, objetivo - colchon), metaMeses: cfg.fondoMeses, fuente: pat.hay ? "cuentas" : "metas", meses_: n };
}

/* ── calendario de pagos del mes (3.8) ──────────────────────────────── */
// Lo que falta pagar o recibir en el mes en curso, día por día, con el saldo que te quedaría: parte de lo
// disponible hoy, resta el gasto del día a día (el ritmo de la proyección) y suma o resta cada fijo y cuota.
// El pago de una tarjeta se muestra, pero no resta: la compra ya se contó al hacerla.
function calendario_(indice, hoy, cfg, r, proy, fijos, tarj, deu) {
  if (indice !== indicePeriodo_(hoy, cfg.inicioMes)) return null;
  const hoyIso = iso_(hoy), hasta = r.periodo.hasta, movs = movimientos_(), ev = [];
  fijos.filter(x => !x.registrado).forEach(x => ev.push({ fecha: x.fecha < hoyIso ? hoyIso : x.fecha, vencido: x.fecha < hoyIso, clase: x.tipo === "Ingreso" ? "ingreso" : "fijo", id: x.id, nombre: x.nombre, monto: x.monto, resta: true }));
  deu.filter(d => !d.terminada && d.proximoPago && d.proximoPago <= hasta && !movs.some(m => m.tipo === "Pago deuda" && m.deuda === d.id && indicePeriodo_(m.fecha, cfg.inicioMes) === indice))
    .forEach(d => ev.push({ fecha: d.proximoPago, vencido: false, clase: "deuda", id: d.id, nombre: d.nombre, monto: d.cuota, resta: true }));
  tarj.filter(t => t.proximoPago && t.proximoPago <= hasta && t.usado > 0).forEach(t => ev.push({ fecha: t.proximoPago, vencido: false, clase: "tarjeta", id: t.id, nombre: t.nombre, monto: t.usado, resta: false }));
  ev.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.clase === "ingreso") - (b.clase === "ingreso")));
  const ritmo = proy ? proy.ritmo : 0;
  let saldo = r.disponible, corto = null, dia = hoyIso;
  const dias = [];
  ev.forEach(e => {
    saldo -= ritmo * Math.max(0, diasEntre_(deIso_(dia), deIso_(e.fecha))); dia = e.fecha;
    if (e.resta) saldo += e.clase === "ingreso" ? e.monto : -e.monto;
    e.saldo = Math.round(saldo);
    if (!corto && saldo < 0) corto = { fecha: e.fecha, saldo: Math.round(saldo), nombre: e.nombre };
    const ult = dias[dias.length - 1];
    if (ult && ult.fecha === e.fecha) ult.eventos.push(e); else dias.push({ fecha: e.fecha, eventos: [e] });
  });
  saldo -= ritmo * Math.max(0, diasEntre_(deIso_(dia), deIso_(hasta)));
  if (!corto && saldo < 0 && ritmo > 0) corto = { fecha: hasta, saldo: Math.round(saldo), nombre: "" };
  dias.forEach(d => { d.saldo = d.eventos[d.eventos.length - 1].saldo; });
  return { dias: dias, ritmo: ritmo, inicio: r.disponible, final: Math.round(saldo), hasta: hasta, corto: corto };
}

/* ── viajes y proyectos (3.8) ───────────────────────────────────────── */
// Gastos de distintas categorías agrupados con una etiqueta («Viaje a Puerto Varas»): cuánto costó en total
function etiquetas_() {
  const g = {};
  movimientos_().forEach(m => {
    if (!m.etiqueta || (m.tipo !== "Gasto" && m.tipo !== "Ingreso")) return;
    const k = m.etiqueta.toLowerCase(), x = g[k] || (g[k] = { etiqueta: m.etiqueta, gastos: 0, ingresos: 0, usd: 0, n: 0, desde: m.fecha, hasta: m.fecha, cats: {} });
    x.n++; if (m.fecha < x.desde) x.desde = m.fecha; if (m.fecha > x.hasta) { x.hasta = m.fecha; x.etiqueta = m.etiqueta; }
    if (m.tipo === "Ingreso") { x.ingresos += m.monto; return; }
    x.gastos += m.monto; x.usd += m.original || 0; x.cats[m.categoria] = (x.cats[m.categoria] || 0) + m.monto;
  });
  return Object.keys(g).map(k => g[k]).sort((a, b) => b.hasta - a.hasta).slice(0, 30).map(x => ({
    etiqueta: x.etiqueta, gastos: x.gastos, ingresos: x.ingresos, neto: x.gastos - x.ingresos, usd: Math.round(x.usd * 100) / 100, n: x.n,
    desde: iso_(x.desde), hasta: iso_(x.hasta), dias: diasEntre_(x.desde, x.hasta) + 1,
    categorias: Object.keys(x.cats).map(c => ({ nombre: c, monto: x.cats[c] })).sort((a, b) => b.monto - a.monto),
  }));
}
function movimientosEtiqueta(etiqueta) {
  const k = texto_(etiqueta).toLowerCase(); if (!k) return falla_("Elige un viaje o proyecto.");
  const lista = movimientos_().filter(m => m.etiqueta.toLowerCase() === k).sort((a, b) => b.fecha - a.fecha)
    .map(m => ({ id: m.id, fecha: iso_(m.fecha), tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, nota: m.nota, moneda: m.moneda, original: m.original }));
  return { ok: true, lista: lista };
}

/* ── cierre del mes (3.8) ───────────────────────────────────────────── */
// Cómo te fue en un mes ya cerrado: lo mismo del resumen por correo, en la app
function cierreMes_(indice, hoy, cfg) {
  const d = datosResumenMes_(indice, hoy), r = d.r, prev = resumen_(indice - 1, hoy);
  const conPres = r.presupuesto.filter(p => p.presupuesto > 0), usado = conPres.reduce((s, p) => s + p.gastado, 0);
  return {
    indice: indice, periodo: r.periodo, ingresos: r.ingresos, gastos: r.gastos, ahorro: r.ahorro, disponible: r.disponible,
    tasaAhorro: r.ingresos > 0 ? Math.round((r.ingresos - r.gastos) * 100 / r.ingresos) : null,
    presupuesto: r.presupuestoTotal > 0 ? { total: r.presupuestoTotal, usado: usado, cumplido: usado <= r.presupuestoTotal,
      excedidas: conPres.filter(p => p.gastado > p.presupuesto).map(p => ({ nombre: p.nombre, exceso: p.gastado - p.presupuesto })),
      enOrden: conPres.filter(p => p.gastado <= p.presupuesto).length, conPres: conPres.length } : null,
    top: d.categorias.slice(0, 3).map(p => ({ nombre: p.nombre, gastado: p.gastado, icono: p.icono, color: p.color, pct: r.gastos > 0 ? Math.round(p.gastado * 100 / r.gastos) : 0 })),
    anterior: { gastos: prev.gastos, ingresos: prev.ingresos, nombre: prev.periodo.nombre },
    explicaciones: explicaciones_(indice, hoy, cfg),
  };
}
function hayMovs_(indice, cfg) { return movimientos_().some(m => indicePeriodo_(m.fecha, cfg.inicioMes) === indice); }

/* ── gastos por rendir (3.8) ────────────────────────────────────────── */
// Un gasto del trabajo que te devuelven: no es gasto tuyo, queda como «te debe» a la empresa (o a quien
// se lo rindas) en Cuentas compartidas, y se salda igual que una cuenta cuando te lo devuelven.
const POR_RENDIR_ = "Por rendir";
function guardarRendicion(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const monto = Math.round(numero_(d.monto)), persona = texto_(d.persona).slice(0, 40), nota = texto_(d.nota).slice(0, 40);
  if (!(monto > 0)) return falla_("Escribe el monto.", "monto");
  if (monto > 999999999) return falla_("El monto es demasiado grande.", "monto");
  if (!persona) return falla_("¿A quién se lo rindes? (ej: tu empresa)", "persona");
  const fecha = d.fecha ? fechaDe_(d.fecha) : ahora_();
  if (!fecha) return falla_("Revisa la fecha.", "fecha");
  if (diasEntre_(ahora_(), fecha) > 1) return falla_("La fecha no puede ser futura.", "fecha");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    agregarFilas_(tabla_(HOJA.COMP), [{ "ID": idNuevo_("P"), "Fecha": fecha, "Cuenta": nota || "Gasto por rendir", "Persona": persona, "Sentido": SENTIDO_.DEBE, "Monto": monto, "Pagado": 0, "Grupo": idNuevo_("R"), "Movimiento": "", "Detalle": POR_RENDIR_ }]);
    return { ok: true, datos: panelDatos() };
  } finally { lock.releaseLock(); }
}

/* ── preguntas a tus números (3.8) ──────────────────────────────────── */
// «¿Cuánto gasté en Uber este año?»: se entiende en el teléfono (sin internet ni servicios externos) con reglas
// simples: qué (gasto, ingreso o ahorro), cuándo (este mes, el mes pasado, este año, en octubre, los últimos N días…)
// y en qué (una categoría, un viaje o proyecto, o palabras de la nota o del medio de pago).
function normal_(s) { return texto_(s).toLowerCase().replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u"); }
const PALABRAS_VACIAS_ = ("cuanto cuanta cuantos cuantas que cual cuales donde como cuando he hemos gaste gasto gastos gastado gastamos gastar gastaste llevo llevamos " +
  "ingrese ingreso ingresos recibi gane ganado ahorre ahorro ahorrado pague pagado pagos pago en el la los las de del al a un una unos unas mi mis me por para con y o " +
  "este esta estos estas ese esa mes meses ano anos año años semana dia dias hoy ayer pasado pasada anterior actual ultimo ultimos ultima ultimas total totales todo todos " +
  "plata dinero lata lucas pesos va van vez veces es fue son mas menos dime sabes quiero saber").split(" ");
function nombrePer_(n) { return /^[A-Z]/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n; }
function periodoPregunta_(q, hoy, cfg) {
  const p = partes_(hoy), dia = (a, m, d) => new Date(a, m - 1, d, 12, 0, 0), hoyD = dia(p.a, p.m, p.d);
  let m;
  if (/\bhoy\b/.test(q)) return { desde: hoyD, hasta: hoyD, nombre: "hoy" };
  if (/\bayer\b/.test(q)) { const a = new Date(hoyD.getTime() - 86400000); return { desde: a, hasta: a, nombre: "ayer" }; }
  if ((m = q.match(/ultim[oa]s?\s+(\d{1,3})\s+dias?/))) { const n = Math.min(400, Number(m[1])); return { desde: new Date(hoyD.getTime() - (n - 1) * 86400000), hasta: hoyD, nombre: "los últimos " + n + " días" }; }
  if ((m = q.match(/ultim[oa]s?\s+(\d{1,2})\s+mes(es)?/))) { const n = Math.min(36, Number(m[1])), act = indicePeriodo_(hoy, cfg.inicioMes); return { desde: deIso_(rangoPeriodo_(act - n + 1, cfg.inicioMes).desde), hasta: hoyD, nombre: "los últimos " + n + " meses" }; }
  if (/esta semana/.test(q)) { const lunes = new Date(hoyD.getTime() - ((hoyD.getDay() + 6) % 7) * 86400000); return { desde: lunes, hasta: hoyD, nombre: "esta semana" }; }
  if (/(ano|año) pasado|(ano|año) anterior/.test(q)) return { desde: dia(p.a - 1, 1, 1), hasta: dia(p.a - 1, 12, 31), nombre: "el año " + (p.a - 1) };
  if (/este (ano|año)|en el (ano|año)|del (ano|año)|(ano|año) actual/.test(q)) return { desde: dia(p.a, 1, 1), hasta: hoyD, nombre: "este año" };
  if ((m = q.match(/\b(20\d\d)\b/)) && !MESES_.some(x => q.indexOf(normal_(x)) >= 0)) { const a = Number(m[1]); return { desde: dia(a, 1, 1), hasta: a === p.a ? hoyD : dia(a, 12, 31), nombre: "el año " + a }; }
  const act = indicePeriodo_(hoy, cfg.inicioMes);
  if (/mes pasado|mes anterior/.test(q)) { const r = rangoPeriodo_(act - 1, cfg.inicioMes); return { desde: deIso_(r.desde), hasta: deIso_(r.hasta), nombre: nombrePer_(r.nombre) }; }
  for (let i = 0; i < 12; i++) {
    if (!new RegExp("\\b" + normal_(MESES_[i]) + "\\b").test(q)) continue;
    const ya = q.match(/\b(20\d\d)\b/); let a = ya ? Number(ya[1]) : p.a; if (!ya && i + 1 > p.m) a--;
    const ini = cfg.inicioMes, r = rangoPeriodo_(a * 12 + i, ini);
    return { desde: deIso_(r.desde), hasta: deIso_(r.hasta), nombre: nombrePer_(r.nombre) };
  }
  const r = rangoPeriodo_(act, cfg.inicioMes);
  return { desde: deIso_(r.desde), hasta: hoyD, nombre: "este mes", defecto: !/este mes|mes actual/.test(q) };
}
function preguntar(texto) {
  olvidarLecturas_();
  asegurarEstructura_();
  const q = normal_(texto).replace(/[¿?¡!.,;:«»"“”]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 3) return falla_("Escribe una pregunta, por ejemplo: ¿cuánto gasté en Uber este año?");
  const cfg = config_(), hoy = ahora_(), per = periodoPregunta_(q, hoy, cfg);
  // respuestas directas: lo que queda, lo que debes y lo que te deben
  if (/me queda|queda disponible|tengo disponible|puedo gastar/.test(q)) {
    const i = indicePeriodo_(hoy, cfg.inicioMes), r = resumen_(i, hoy);
    let t = "Este mes te quedan " + clp_(r.disponible) + " (ingresos menos gastos y ahorro)";
    if (r.presupuestoTotal > 0) t += "; del presupuesto te quedan " + clp_(r.presupuestoRestante) + " de " + clp_(r.presupuestoTotal);
    return { ok: true, texto: t + ".", total: r.disponible, n: 0 };
  }
  if (/me deben|me debe/.test(q)) { const c = estadoCompartidas_(); return { ok: true, texto: c.meDeben ? "Te deben " + clp_(c.meDeben) + (c.personas.filter(p => p.neto > 0).length ? ": " + c.personas.filter(p => p.neto > 0).slice(0, 4).map(p => p.persona + " " + clp_(p.neto)).join(", ") : "") + "." : "Nadie te debe.", total: c.meDeben, n: 0 }; }
  if (/cuanto debo|que debo|mis deudas|le debo/.test(q)) {
    const d = estadoDeudas_(hoy).filter(x => !x.terminada), tj = estadoTarjetas_(hoy), c = estadoCompartidas_();
    const cr = d.reduce((s, x) => s + x.saldo, 0), tu = tj.reduce((s, x) => s + x.usado, 0), total = cr + tu + c.debo;
    const partes = [cr ? "créditos " + clp_(cr) : "", tu ? "tarjetas " + clp_(tu) : "", c.debo ? "a otras personas " + clp_(c.debo) : ""].filter(x => x);
    return { ok: true, texto: total ? "Debes " + clp_(total) + ": " + partes.join(", ") + "." : "No tienes deudas anotadas.", total: total, n: 0 };
  }
  const tipo = /\b(ingres|recib|gane|ganado|ganamos|sueldo)/.test(q) ? "Ingreso" : (/\bahorr/.test(q) ? "Ahorro" : "Gasto");
  const enQue = /en que|donde|cual(es)? (categoria|es lo)|que categoria/.test(q) && /\bmas\b/.test(q);
  // en qué: lo que queda al quitar palabras vacías, meses y números
  const meses = MESES_.map(normal_);
  const palabras = q.split(" ").filter(w => w && PALABRAS_VACIAS_.indexOf(w) < 0 && meses.indexOf(w) < 0 && !/^\d+$/.test(w));
  const termino = palabras.join(" ").trim();
  const cats = categorias_(), movs = movimientos_().filter(m => m.fecha >= per.desde && diasEntre_(m.fecha, per.hasta) >= 0);
  const deTipo = m => tipo === "Gasto" ? (m.tipo === "Gasto" || m.tipo === "Pago deuda") : (tipo === "Ahorro" ? (m.tipo === "Ahorro" || m.tipo === "Retiro de meta") : m.tipo === "Ingreso");
  const signo = m => m.tipo === "Retiro de meta" ? -1 : 1;
  const verbo = { Gasto: "gastaste", Ingreso: "recibiste", Ahorro: "ahorraste" }[tipo];
  if (enQue) {
    const por = {}; movs.filter(m => m.tipo === "Gasto" || m.tipo === "Pago deuda").forEach(m => { const c = m.tipo === "Pago deuda" ? CAT_DEUDAS : m.categoria; por[c] = (por[c] || 0) + m.monto; });
    const top = Object.keys(por).sort((a, b) => por[b] - por[a]).slice(0, 3);
    if (!top.length) return { ok: true, texto: "No hay gastos en " + per.nombre + ".", total: 0, n: 0, desde: iso_(per.desde), hasta: iso_(per.hasta) };
    return { ok: true, texto: "En " + per.nombre + " donde más gastaste fue " + top.map((c, i) => (i ? (i === top.length - 1 ? " y " : ", ") : "") + c + " (" + clp_(por[c]) + ")").join("") + ".", total: por[top[0]], n: top.length, categoria: top[0], desde: iso_(per.desde), hasta: iso_(per.hasta) };
  }
  let filtro = null, cat = null, et = null;
  if (termino) {
    cat = cats.find(c => normal_(c.nombre) === termino) || cats.find(c => normal_(c.nombre).indexOf(termino) >= 0 || termino.indexOf(normal_(c.nombre)) >= 0);
    if (!cat) et = movimientos_().map(m => m.etiqueta).find(e => e && (normal_(e) === termino || normal_(e).indexOf(termino) >= 0));
    filtro = cat ? (m => (m.tipo === "Pago deuda" ? CAT_DEUDAS : m.categoria) === cat.nombre)
      : et ? (m => normal_(m.etiqueta) === normal_(et))
      : (m => palabras.every(w => normal_([m.nota, m.medio, m.categoria, m.etiqueta].join(" ")).indexOf(w) >= 0));
  }
  const lista = movs.filter(m => deTipo(m) && (!filtro || filtro(m)));
  const total = lista.reduce((s, m) => s + signo(m) * m.monto, 0);
  const sobre = cat ? " en " + cat.nombre : (et ? " en «" + et + "»" : (termino ? " en «" + palabras.join(" ") + "»" : ""));
  if (!lista.length) return { ok: true, texto: "En " + per.nombre + " no encontré " + (tipo === "Gasto" ? "gastos" : (tipo === "Ingreso" ? "ingresos" : "ahorros")) + sobre + ".", total: 0, n: 0, desde: iso_(per.desde), hasta: iso_(per.hasta), filtro: termino };
  const mayor = lista.reduce((a, m) => (m.monto > a.monto ? m : a), lista[0]);
  let t = "En " + per.nombre + " " + verbo + " " + clp_(total) + sobre + " (" + lista.length + (lista.length === 1 ? " movimiento" : " movimientos") + ")";
  if (lista.length > 1) t += ". Promedio " + clp_(total / lista.length) + "; el más alto, " + clp_(mayor.monto) + " el " + partes_(mayor.fecha).d + "/" + partes_(mayor.fecha).m;
  return { ok: true, texto: t + ".", total: total, n: lista.length, desde: iso_(per.desde), hasta: iso_(per.hasta), filtro: cat ? cat.nombre : (et || termino), categoria: cat ? cat.nombre : "", etiqueta: et || "" };
}

/* ── comparar meses y análisis a la fecha (3.9) ─────────────────────── */
// Compara un mes (a) con otro (b; por omisión, el anterior). Si «a» es el mes en curso, la comparación es
// A LA FECHA: los dos meses hasta el mismo día del período (por ejemplo, del 1 al 28). Las conclusiones son
// reglas simples sobre tus propios datos (no consejos financieros): qué subió, qué bajó, ingresos, cuánto te
// sobra, cómo vas con el presupuesto y la proyección del mes.
function totalesHasta_(movs, k, dia, cfg) {
  const desde = deIso_(rangoPeriodo_(k, cfg.inicioMes).desde), cats = gastoHasta_(movs, k, dia, cfg), veces = {};
  let ingresos = 0, ahorro = 0;
  movs.forEach(m => {
    if (indicePeriodo_(m.fecha, cfg.inicioMes) !== k || diasEntre_(desde, m.fecha) > dia) return;
    if (m.tipo === "Ingreso") ingresos += m.monto;
    else if (m.tipo === "Ahorro") ahorro += m.monto;
    else if (m.tipo === "Retiro de meta") ahorro -= m.monto;
    else if (m.tipo === "Gasto") veces[m.categoria] = (veces[m.categoria] || 0) + 1;
  });
  return { cats: cats, veces: veces, gastos: Object.keys(cats).reduce((s, c) => s + cats[c], 0), ingresos: ingresos, ahorro: ahorro };
}
function analizarMeses(a, b) {
  olvidarLecturas_();
  asegurarEstructura_();
  const cfg = config_(), hoy = ahora_(), actual = indicePeriodo_(hoy, cfg.inicioMes), movs = movimientos_();
  const ia = Number.isInteger(Number(a)) && a !== null && a !== "" && Number(a) <= actual && Number(a) > actual - 1200 ? Number(a) : actual;
  const ib = Number.isInteger(Number(b)) && b !== null && b !== "" && Number(b) < ia + 1200 && Number(b) <= actual && Number(b) !== ia ? Number(b) : ia - 1;
  const alDia = ia === actual, dia = alDia ? diasEntre_(deIso_(rangoPeriodo_(ia, cfg.inicioMes).desde), hoy) : 40;
  const A = totalesHasta_(movs, ia, dia, cfg), B = totalesHasta_(movs, ib, dia, cfg);
  const nA = rangoPeriodo_(ia, cfg.inicioMes).nombre, nB = rangoPeriodo_(ib, cfg.inicioMes).nombre, anio = (nA.match(/ (\d{4})$/) || [])[1];
  const mb = nombrePer_(anio && nB.slice(-5) === " " + anio ? nB.slice(0, -5) : nB);   // «septiembre» (sin el año si es el mismo)
  const info = {}; categorias_().forEach(c => { info[c.nombre] = c; });
  const categorias = Object.keys(Object.assign({}, A.cats, B.cats)).map(c => {
    const x = Math.round(A.cats[c] || 0), y = Math.round(B.cats[c] || 0), k = info[c] || {};
    return { nombre: c, icono: k.icono || "ti-tag", color: k.color || "#6B7A8F", a: x, b: y, dif: x - y, pct: y > 0 ? Math.round((x - y) * 100 / y) : null, veces: [A.veces[c] || 0, B.veces[c] || 0] };
  }).filter(c => c.a > 0 || c.b > 0).sort((p, q) => Math.abs(q.dif) - Math.abs(p.dif) || q.a - p.a);
  const pct = (x, y) => (y > 0 ? Math.round((x - y) * 100 / y) : null), signo = n => (n > 0 ? "+" : "−") + clp_(Math.abs(n)).replace("−", "");
  const altura = alDia ? "a esta altura de " + mb : "en " + mb, C = [];
  const hay = movs.some(m => indicePeriodo_(m.fecha, cfg.inicioMes) === ib);
  if (!hay) C.push({ tipo: "info", texto: "En " + mb + " no hay movimientos para comparar." });
  // 1. gasto total
  const dg = A.gastos - B.gastos, pg = pct(A.gastos, B.gastos);
  if (hay && B.gastos > 0) {
    if (pg !== null && Math.abs(pg) < 5) C.push({ tipo: "ok", texto: (alDia ? "Llevas gastado " : "Gastaste ") + clp_(A.gastos) + ": parecido a " + altura + " (" + signo(dg) + ")." });
    else C.push({ tipo: dg > 0 ? "sube" : "baja", texto: (alDia ? "Llevas gastado " : "Gastaste ") + clp_(A.gastos) + ", " + clp_(Math.abs(dg)) + (dg > 0 ? " más" : " menos") + " que " + altura + (pg !== null ? " (" + (pg > 0 ? "+" : "") + pg + " %)" : "") + "." });
  }
  // 2. categorías que más subieron y la que más bajó (solo cambios que importan: $5.000 y 20 %, o nuevas desde $10.000)
  const importa = c => Math.abs(c.dif) >= 5000 && (c.pct === null ? c.a >= 10000 : Math.abs(c.pct) >= 20);
  const suben = categorias.filter(c => c.dif > 0 && importa(c)).slice(0, 2), bajan = categorias.filter(c => c.dif < 0 && importa(c)).slice(0, 1);
  if (hay) suben.forEach((c, i) => C.push({ tipo: "sube", categoria: c.nombre, texto: c.nombre + ": " + clp_(c.a) + (c.b > 0 ? ", " + signo(c.dif) + " (" + (c.pct > 0 ? "+" : "") + c.pct + " %) que " + altura : ", y " + altura + " no gastaste aquí") + "." + (i === 0 ? " Es lo que más subió." : "") }));
  if (hay) bajan.forEach(c => C.push({ tipo: "baja", categoria: c.nombre, texto: "Bajaste en " + c.nombre + ": " + clp_(c.a) + ", " + clp_(Math.abs(c.dif)) + " menos (" + c.pct + " %)." }));
  // compras más seguidas
  const seguido = categorias.filter(c => c.veces[0] >= 5 && c.veces[0] >= c.veces[1] * 1.5 && c.veces[1] > 0).sort((p, q) => q.veces[0] - p.veces[0])[0];
  if (hay && seguido) C.push({ tipo: "info", categoria: seguido.nombre, texto: "Compraste más seguido en " + seguido.nombre + ": " + seguido.veces[0] + " veces (" + seguido.veces[1] + " " + altura + "), " + clp_(seguido.a / seguido.veces[0]) + " promedio." });
  // 3. ingresos
  if (hay && (A.ingresos > 0 || B.ingresos > 0)) {
    const di = A.ingresos - B.ingresos;
    if (B.ingresos > 0 && Math.abs(di) >= Math.max(10000, B.ingresos * 0.1)) C.push({ tipo: di > 0 ? "ok" : "alerta", texto: "Te " + (alDia ? "han entrado " : "entraron ") + clp_(A.ingresos) + ", " + clp_(Math.abs(di)) + (di > 0 ? " más" : " menos") + " que " + altura + "." + (di < 0 && alDia ? " Puede que falte algún ingreso por llegar." : "") });
  }
  // 4. cuánto te sobra de lo que entra
  if (A.ingresos > 0) {
    const t = Math.round((A.ingresos - A.gastos) * 100 / A.ingresos);
    C.push({ tipo: t >= 0 ? "ok" : "alerta", texto: t >= 0 ? "De lo que " + (alDia ? "ha entrado" : "entró") + ", te sobra el " + t + " %." : "Gastas " + clp_(A.gastos - A.ingresos) + " más de lo que " + (alDia ? "ha entrado" : "entró") + "." });
  }
  // 5. presupuesto: categorías que ya van al límite
  if (ia === actual) {
    const r = resumen_(ia, hoy);
    r.presupuesto.filter(p => p.presupuesto > 0 && p.pct >= cfg.alertaPct).sort((p, q) => q.pct - p.pct).slice(0, 2)
      .forEach(p => C.push({ tipo: "alerta", categoria: p.nombre, texto: p.nombre + (p.gastado > p.presupuesto ? " ya pasó su presupuesto por " + clp_(p.gastado - p.presupuesto) + "." : " va en el " + p.pct + " % de su presupuesto (quedan " + clp_(p.presupuesto - p.gastado) + ").") }));
    // 6. proyección del mes
    const proy = proyeccion_(ia, hoy, r, estadoFijos_(ia, hoy, cfg), cfg);
    if (proy && proy.dias > 0) {
      const cierreB = totalesHasta_(movs, ib, 40, cfg).gastos;
      C.push({ tipo: "info", texto: "Si sigues así, terminarías el mes con unos " + clp_(Math.round(proy.gastos / 1000) * 1000) + " en gastos" + (cierreB > 0 ? " (" + mb + " cerró con " + clp_(Math.round(cierreB / 1000) * 1000) + ")" : "") + "." });
    }
  }
  // 7. una idea concreta: volver al nivel del otro mes en lo que más subió
  if (hay && suben[0] && suben[0].b > 0) C.push({ tipo: "idea", categoria: suben[0].nombre, texto: "Si en " + suben[0].nombre + " vuelves al nivel de " + mb + ", " + (alDia ? "este mes ahorrarías" : "habrías ahorrado") + " unos " + clp_(Math.round(suben[0].dif / 1000) * 1000) + "." });
  if (hay && C.length === 1 && !suben.length && !bajan.length && B.gastos > 0 && Math.abs(pg || 0) < 5) C.push({ tipo: "ok", texto: "Ninguna categoría cambió mucho." });
  const meses = [];
  const usados = {}; movs.forEach(m => { usados[indicePeriodo_(m.fecha, cfg.inicioMes)] = true; });
  for (let k = actual; k > actual - 24 && meses.length < 13; k--) if (usados[k] || k === actual) meses.push({ indice: k, nombre: rangoPeriodo_(k, cfg.inicioMes).nombre });
  return {
    ok: true, a: { indice: ia, nombre: nA }, b: { indice: ib, nombre: nB }, alDia: alDia, dia: dia + 1,
    totales: { gastos: [A.gastos, B.gastos], ingresos: [A.ingresos, B.ingresos], ahorro: [A.ahorro, B.ahorro] },
    categorias: categorias.slice(0, 12), conclusiones: C, meses: meses,
  };
}

/* ── importar la cartola del banco (3.8) ────────────────────────────── */
// El panel lee el archivo (CSV o Excel) y manda las filas con las columnas ya elegidas. Aquí se interpreta
// cada fila (fecha, monto con signo o cargo/abono), se sugiere la categoría y se marca lo que ya está anotado.
// Cada fila importada lleva un código propio (su fecha, monto, descripción y orden): importar el mismo archivo
// dos veces no duplica nada.
// Movimientos entre tus propias cuentas o pagos de tarjeta: se ofrecen sin marcar (no son gasto nuevo)
const PARECE_TRASPASO_ = /pago (de )?(tarjeta|tc|t\. ?credito)|pago tarjeta|traspaso|transferencia (a|entre) (cuenta )?propia|abono tarjeta|pago linea|cargo linea|giro cajero|\bgiro\b|rescate|inversion/;
// Clasificador por descripción (3.9). La misma función corre en el servidor (cartola, Apple Pay, avisos del banco)
// y en el panel, al escribir «¿En qué?» en el registro (se inserta tal cual, como dividirCuenta_). Orden:
// 1) tus reglas (Ajustes → Clasificación automática), 2) lo que ya anotaste con la misma descripción,
// 3) el diccionario de comercios y palabras. Cada grupo del diccionario apunta a nombres de categoría posibles;
// se usa la primera que exista entre las tuyas (por nombre igual o parecido). Sin coincidencia: "" (eliges tú).
function clasificador_() {
  const norm = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`´]/g, "").replace(/&/g, " y ").replace(/[^a-z0-9ñ]+/g, " ").trim();
  // clave de lo aprendido: las 2 primeras palabras de más de 2 letras, sin números
  const clave = s => norm(s).replace(/\b\d+\b/g, " ").split(" ").filter(w => w.length > 2).slice(0, 2).join(" ");
  const G = (cats, pal) => ({ cats: cats, pal: pal.split("|") });
  const GASTO = [
    G(["Comida fuera", "Comida", "Restaurantes", "Restaurant", "Delivery", "Alimentación"],
      "mcdonald|mc donald|burger king|kfc|wendys|subway|starbucks|juan valdez|dunkin|doggis|juan maestro|telepizza|papa john|pizza hut|domino|little caesars|tarragona|fuente alemana|fuente mardoqueo|tip y tap|sushi|ramen|wok|empanada|completo|churrasco|hamburgues|pizza|restaurant|restoran|resto bar|cafeteria|cafe|coffee|almuerzo|desayuno|cena|once |colacion|picada|fonda|sangucheria|shawarma|kebab|taco|uber eats|rappi|pedidos ya|pedidosya|justo|didi food|helado|heladeria|savory|emporio la rosa|pasteleria|dulceria|kiosko|kiosco|snack|botilleria|botiller|cerveza|chela|schop|vino|pisco|bar |pub|discoteca|carrete|copete"),
    G(["Supermercado", "Supermercados", "Mercado", "Almacén", "Comida", "Alimentación"],
      "lider|jumbo|unimarc|tottus|santa isabel|acuenta|ekono|alvi|mayorista 10|super 10|oxxo|ok market|spid|cornershop|almacen|minimarket|feria|verduleria|carniceria|panaderia|supermercado|super |mercado|abarrotes|frutas|verduras"),
    G(["Transporte", "Auto", "Movilización", "Locomoción", "Bencina"],
      "uber|cabify|didi|indriver|beat |taxi|colectivo|metro|bip|micro|red movilidad|transantiago|bus |buses|turbus|tur bus|pullman|copec|shell|petrobras|aramco|enex|terpel|bencina|combustible|gasolina|diesel|estacionamiento|parking|parquimetro|tag |autopista|peaje|costanera norte|vespucio|mecanico|taller|revision tecnica|permiso de circulacion|seguro auto|lavado auto|neumatico|scooter|lime |bicicleta"),
    G(["Salud", "Farmacia", "Médico"],
      "farmacia|cruz verde|salcobrand|ahumada|dr simi|doctor simi|knop|medico|doctor|clinica|consulta|dentista|dental|odontolog|examen|laboratorio|isapre|fonasa|optica|lentes|remedio|medicamento|psicolog|kinesiolog|vacuna|urgencia|hospital|bupa|redsalud|integramedica|megasalud"),
    G(["Servicios", "Cuentas", "Cuentas básicas", "Hogar"],
      "luz|electricidad|enel|cge|chilquinta|agua|aguas andinas|esval|essbio|nuevo sur|gas |metrogas|abastible|lipigas|gasco|balon de gas|internet|wifi|fibra|entel|movistar|claro |wom|vtr|mundo pacifico|gtd|celular|plan movil|telefono|cable|tv cable|directv"),
    G(["Entretención", "Entretenimiento", "Suscripciones", "Ocio"],
      "netflix|spotify|disney|hbo|max |prime video|amazon prime|youtube premium|apple music|deezer|paramount|star plus|crunchyroll|cine|cinemark|cineplanet|hoyts|muvix|teatro|concierto|ticket|puntoticket|passline|entrada|steam|playstation|psn|xbox|nintendo|videojuego|juego|bowling|parque|museo|fantasilandia|zoologico|casino|apuesta"),
    G(["Ropa", "Vestuario", "Ropa y calzado"],
      "ropa|zapatilla|zapato|polera|pantalon|chaqueta|vestido|calcetin|h y m|hym|zara|nike|adidas|puma|hites|la polar|corona|tricot|bata|skechers|falabella|paris|ripley|mango|forever 21|ostu|family shop|gap"),
    G(["Casa", "Hogar", "Arriendo", "Vivienda"],
      "arriendo|dividendo|gastos comunes|gasto comun|condominio|sodimac|easy|homecenter|construmart|ferreteria|imperial|ikea|mueble|decoracion|aseo|limpieza|detergente|lavanderia|nana|jardin|plomero|gasfiter|electricista|cerrajero|colchon|electrodomestico"),
    G(["Educación", "Estudios", "Colegio"],
      "colegio|universidad|instituto|matricula|mensualidad|arancel|curso|udemy|coursera|platzi|domestika|libro|libreria|antartica|utiles|cuaderno|preu|clases|profesor|jardin infantil|sala cuna"),
    G(["Mascotas", "Mascota"], "veterinari|vet |mascota|perro|gato|alimento perro|alimento gato|pet |superzoo|club de perros|peluqueria canina"),
    G(["Regalos", "Regalo"], "regalo|cumpleanos|navidad|aniversario|flores|floreria"),
    G(["Viajes", "Vacaciones", "Transporte"], "hotel|hostal|airbnb|booking|pasaje|vuelo|latam|sky airline|jetsmart|aeropuerto|despegar|viaje|cabana|camping"),
    G(["Deporte", "Gimnasio", "Salud"], "gimnasio|gym|smartfit|smart fit|sportlife|energy|pacific|pilates|yoga|crossfit|futbol|padel|tenis|decathlon"),
    G(["Belleza", "Cuidado personal", "Salud"], "peluqueria|barberia|corte de pelo|manicure|spa |cosmetic|maquillaje|perfume|preunic|db |maicao"),
    G(["Tecnología", "Tecnologia", "Electrónica"], "pc factory|pcfactory|apple |samsung|xiaomi|computador|notebook|audifonos|cargador|celular nuevo|mercado libre|aliexpress|amazon|temu|shein"),
  ];
  const INGRESO = [
    G(["Sueldo", "Salario", "Remuneración"], "sueldo|remuneracion|liquidacion|salario|pago empresa|honorario|boleta honorario|bono|aguinaldo|gratificacion"),
    G(["Otros ingresos", "Ventas", "Otros"], "venta|vendi|reembolso|devolucion|transferencia recibida|me pagaron|me devolvieron|regalo|premio|arriendo recibido|intereses"),
  ];
  // la palabra aparece al comienzo de una palabra del texto; si termina en espacio, completa («bar », no «barrio»)
  const tiene = (n, p) => !!p.trim() && (" " + n + " ").indexOf(" " + p) >= 0;
  function categoria(nombres, cats) {
    for (const x of nombres) { const k = norm(x), c = cats.find(c => norm(c.nombre) === k); if (c) return c.nombre; }
    for (const x of nombres) { const k = norm(x), c = cats.find(c => { const m = norm(c.nombre); return m.indexOf(k) >= 0 || k.indexOf(m) >= 0; }); if (c) return c.nombre; }
    return "";
  }
  // cats: [{ nombre, tipo }]; reglas: [[palabra, categoría]]; aprendido: { clave: categoría } del mismo tipo
  function clasificar(texto, tipo, cats, reglas, aprendido) {
    const n = norm(texto); if (!n) return "";
    const propias = (cats || []).filter(c => c && c.tipo === tipo && c.nombre !== "Deudas" && c.activa !== false);
    const existe = nombre => propias.some(c => c.nombre === nombre);
    for (const r of reglas || []) if (r && r[0] && existe(r[1]) && tiene(n, norm(r[0]))) return r[1];
    const k = clave(texto);
    if (k && aprendido && aprendido[k] && existe(aprendido[k])) return aprendido[k];
    for (const g of tipo === "Ingreso" ? INGRESO : GASTO) {
      if (!g.pal.some(p => tiene(n, norm(p) + (/ $/.test(p) ? " " : "")))) continue;
      const c = categoria(g.cats, propias); if (c) return c;
    }
    return "";
  }
  return { norm: norm, clave: clave, clasificar: clasificar };
}
const CLASIF_ = clasificador_();
function claveTexto_(s) { return CLASIF_.clave(s); }
// Reglas propias de clasificación (Ajustes → Clasificación automática): [[palabra, categoría]] en Config «reglasCat»
function reglasCat_(cfg) {
  try { const r = JSON.parse(texto_((cfg || config_()).reglasCat) || "[]"); return Array.isArray(r) ? r.filter(x => Array.isArray(x) && texto_(x[0]) && texto_(x[1])).slice(0, 200) : []; } catch (e) { return []; }
}
// Lo aprendido de tus movimientos: por cada descripción (2 primeras palabras), la categoría que más usaste
function aprendido_(historia, tipo, max) {
  const h = historia[tipo] || {}, out = {};
  Object.keys(h).map(k => ({ k: k, n: Object.keys(h[k]).reduce((s, c) => s + h[k][c], 0) })).sort((a, b) => b.n - a.n).slice(0, max || 100000)
    .forEach(x => { out[x.k] = Object.keys(h[x.k]).sort((a, b) => h[x.k][b] - h[x.k][a])[0]; });
  return out;
}
function sugerirCategoria_(texto, tipo, historia, cats, sinOtros) {
  const c = CLASIF_.clasificar(texto, tipo, cats, reglasCat_(), aprendido_(historia, tipo));
  if (c || sinOtros) return c;
  const activas = cats.filter(x => x.activa && x.tipo === tipo && x.nombre !== CAT_DEUDAS), otros = tipo === "Ingreso" ? "Otros ingresos" : "Otros";
  return activas.some(x => x.nombre === otros) ? otros : (activas[0] ? activas[0].nombre : "");
}
// d: { palabra, categoria } · quitar: { palabra, quitar: true }
function guardarReglaCat(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const palabra = texto_(d.palabra).replace(/\s+/g, " ").slice(0, 40);
  if (!palabra) return falla_("Escribe la palabra (ej: botillería).", "palabra");
  let reglas = reglasCat_().filter(r => CLASIF_.norm(r[0]) !== CLASIF_.norm(palabra));
  if (!d.quitar) {
    const c = categorias_().find(x => x.activa && x.nombre === texto_(d.categoria) && x.nombre !== CAT_DEUDAS);
    if (!c) return falla_("Elige la categoría.", "categoria");
    if (CLASIF_.norm(palabra).length < 2) return falla_("La palabra es muy corta.", "palabra");
    reglas = [[palabra, c.nombre]].concat(reglas).slice(0, 200);
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.CONFIG), f = t.filas.find(x => texto_(x.Clave) === "reglasCat"), v = JSON.stringify(reglas);
    if (f) escribirFila_(t, f._fila, { "Valor": v }); else agregarFilas_(t, [{ "Clave": "reglasCat", "Valor": v, "Descripción": CONFIG_CAMPOS.find(x => x[0] === "reglasCat")[3] }]);
  } finally { lock.releaseLock(); }
  return { ok: true, datos: panelDatos() };
}
function historiaCategorias_(movs) {
  const h = { Gasto: {}, Ingreso: {} };
  movs.forEach(m => { if ((m.tipo !== "Gasto" && m.tipo !== "Ingreso") || !m.nota || !m.categoria) return; const k = claveTexto_(m.nota); if (!k) return; const x = h[m.tipo][k] || (h[m.tipo][k] = {}); x[m.categoria] = (x[m.categoria] || 0) + 1; });
  return h;
}
function montoCartola_(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  let s = texto_(v).replace(/clp|\$|\s/gi, ""); if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { neg = true; s = s.slice(1); } else if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  const n = numero_(s); return isNaN(n) ? NaN : (neg ? -n : n);
}
function fechaCartola_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0); }   // número de serie de Excel
  const s = texto_(v), m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/);
  if (m) return new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  const m2 = s.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})/); if (m2) return new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]), 12, 0, 0);
  return fechaDe_(s.replace(/\s.*$/, ""));
}
function hash_(s) { let a = 0x811c9dc5, b = 0x12345678; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; } return (a.toString(36) + b.toString(36)).slice(0, 14); }
const IMPORTAR_MAX_ = 1500;
// filas: [{ fecha, descripcion, monto } o { fecha, descripcion, cargo, abono }] tal como vienen en el archivo
function prepararImportacion(filas) {
  olvidarLecturas_();
  asegurarEstructura_();
  if (!Array.isArray(filas) || !filas.length) return falla_("El archivo no trae movimientos.");
  if (filas.length > IMPORTAR_MAX_) return falla_("Son demasiadas filas (más de " + IMPORTAR_MAX_ + "): divide el archivo por mes.");
  const movs = movimientos_(), ids = new Set(movs.map(m => m.id)), hist = historiaCategorias_(movs), cats = categorias_(), hoy = ahora_(), vistos = {};
  const lista = [];
  let malas = 0;
  filas.forEach(f => {
    f = f && typeof f === "object" ? f : {};
    const fecha = fechaCartola_(f.fecha), desc = texto_(f.descripcion).replace(/\s+/g, " ").slice(0, 120);
    let monto = NaN;
    if (f.monto !== undefined && texto_(f.monto) !== "") monto = montoCartola_(f.monto);
    else { const c = montoCartola_(f.cargo), a = montoCartola_(f.abono); if (!isNaN(c) && c !== 0) monto = -Math.abs(c); else if (!isNaN(a) && a !== 0) monto = Math.abs(a); }
    if (!fecha || isNaN(monto) || !Math.round(monto) || diasEntre_(hoy, fecha) > 1) { malas++; return; }
    const tipo = monto < 0 ? "Gasto" : "Ingreso", abs = Math.round(Math.abs(monto)), fi = iso_(fecha);
    const base = fi + "|" + abs + "|" + tipo + "|" + normal_(desc);
    vistos[base] = (vistos[base] || 0) + 1;
    const clave = hash_(base + "|" + vistos[base]);
    const parecido = movs.some(m => m.tipo === tipo && m.monto === abs && Math.abs(diasEntre_(m.fecha, fecha)) <= 2);
    lista.push({ clave: clave, fecha: fi, descripcion: desc, monto: abs, tipo: tipo, categoria: sugerirCategoria_(desc, tipo, hist, cats),
      repetido: ids.has("I" + clave), parecido: parecido, traspaso: PARECE_TRASPASO_.test(normal_(desc)) });
  });
  if (!lista.length) return falla_("No encontré movimientos con fecha y monto. Revisa qué columna es cada cosa.");
  lista.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  return { ok: true, lista: lista, malas: malas };
}
// lista: [{ clave, fecha, descripcion, monto, tipo, categoria }] (las filas marcadas); medio: cómo se pagaron los gastos
function importarMovimientos(lista, medio) {
  olvidarLecturas_();
  asegurarEstructura_();
  if (!Array.isArray(lista) || !lista.length) return falla_("Marca al menos un movimiento.");
  if (lista.length > IMPORTAR_MAX_) return falla_("Son demasiados movimientos de una vez.");
  if (medios_().indexOf(texto_(medio)) < 0) return falla_("Elige de qué cuenta o tarjeta es la cartola.", "medio");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ids = new Set(movimientos_().map(m => m.id)), filas = [], errores = [];
    let repetidos = 0;
    lista.forEach(x => {
      x = x && typeof x === "object" ? x : {};
      const clave = texto_(x.clave);
      if (!/^[a-z0-9]{6,20}$/.test(clave)) { errores.push("Fila sin código"); return; }
      const id = "I" + clave;
      if (ids.has(id)) { repetidos++; return; }
      const v = validarMovimiento_({ fecha: x.fecha, tipo: x.tipo === "Ingreso" ? "Ingreso" : "Gasto", monto: x.monto, categoria: x.categoria, medio: x.tipo === "Ingreso" ? "" : medio, nota: texto_(x.descripcion).slice(0, 120) });
      if (!v.ok) { errores.push((x.descripcion || x.fecha) + ": " + v.error); return; }
      ids.add(id); filas.push(Object.assign({ "ID": id, "Registrado": ahora_() }, v.fila));
    });
    if (filas.length) agregarFilas_(tabla_(HOJA.MOV), filas);
    return { ok: true, guardados: filas.length, repetidos: repetidos, errores: errores.slice(0, 10), datos: panelDatos() };
  } finally { lock.releaseLock(); }
}
// Lo que llega anotado sin categoría (pago con Apple Pay, aviso del banco): la categoría más probable
function sugerirCategoria(texto, tipo) {
  const t = tipo === "Ingreso" ? "Ingreso" : "Gasto";
  return { ok: true, categoria: sugerirCategoria_(texto, t, historiaCategorias_(movimientos_()), categorias_(), true) };
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
  const proy = proyeccion_(i, hoy, res, fijos, cfg), metas = estadoMetas_(hoy), pat = estadoPatrimonio_(hoy, cfg, tarj, deu);
  // cierre del mes (3.8): en la primera semana del mes en curso, el del mes anterior; mirando un mes pasado, ese mes
  const diaMes = diasEntre_(deIso_(res.periodo.desde), hoy) + 1, iCierre = i < actual ? i : (diaMes <= 7 ? i - 1 : null);
  const dolar = valorDolar_();
  return {
    ok: true, version: VERSION, hoy: iso_(hoy), config: cfg, actual: indicePeriodo_(hoy, cfg.inicioMes),
    resumen: res, proyeccion: proy, metas: metas, tarjetas: tarj, deudas: deu,
    patrimonio: pat, fondo: fondoEmergencia_(hoy, cfg, pat, metas), calendario: calendario_(i, hoy, cfg, res, proy, fijos, tarj, deu),
    etiquetas: etiquetas_(), cierre: iCierre !== null && hayMovs_(iCierre, cfg) ? cierreMes_(iCierre, hoy, cfg) : null,
    dolar: { valor: dolar.valor, fuente: dolar.fuente }, tiposActivo: TIPOS_ACTIVO_,
    reglasCat: reglasCat_(cfg), aprendido: (h => ({ Gasto: aprendido_(h, "Gasto", 600), Ingreso: aprendido_(h, "Ingreso", 200) }))(historiaCategorias_(movimientos_())),
    proximos: proximosPagos_(tarj, deu, cfg.diasAviso),
    categorias: categorias_().filter(c => c.activa).map(c => ({ nombre: c.nombre, tipo: c.tipo, icono: c.icono, color: c.color, presupuesto: c.presupuesto })),
    medios: medios_(), movimientos: movimientosPeriodo_(i, cfg), cuotasPeriodo: cuotasPeriodo_(i, cfg), historial: historial_(i, cfg), ejemplo: hayEjemplo_(),
    recientes: recientes_(hoy), urlRegistrar: urlPanel_() ? urlPanel_() + "?a=registrar" : "", frecuentes: frecuentes_(hoy), fijos: fijos,
    explicaciones: explicaciones_(i, hoy, cfg), suscripciones: i === actual ? suscripciones_(hoy, cfg) : [], racha: racha_(hoy),
    compartidas: estadoCompartidas_(),
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
  return Object.keys(grupos).map(k => grupos[k]).filter(g => g.veces >= 2).sort((a, b) => b.veces - a.veces || b.ultima - a.ultima).slice(0, 8)
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
    .map(m => ({ id: m.id, fecha: iso_(m.fecha), tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, cuotas: m.cuotas, meta: m.meta, deuda: m.deuda, nota: m.nota, fijo: m.fijo, etiqueta: m.etiqueta, moneda: m.moneda, original: m.original }));
}
// Valida y arma la fila de un movimiento. d: {fecha, tipo, monto, categoria, medio, cuotas, meta, deuda, nota}
// medioAnterior: al editar, el medio que ya tenía sigue valiendo aunque esa tarjeta se haya quitado
function validarMovimiento_(d, medioAnterior) {
  const tipo = texto_(d.tipo) || "Gasto";
  if (TIPOS.indexOf(tipo) < 0) return falla_("Tipo de movimiento no válido.", "tipo");
  // en dólares (3.8): se guarda en pesos con el dólar del día y queda el monto original
  let usd = 0;
  if (texto_(d.moneda).toUpperCase() === "USD" && (tipo === "Gasto" || tipo === "Ingreso")) {
    usd = Math.round(decimal_(d.original) * 100) / 100;
    if (!(usd > 0)) return falla_("Escribe el monto en dólares.", "original");
    if (usd > 9999999) return falla_("El monto es demasiado grande.", "original");
    const dolar = valorDolar_().valor;
    if (!(dolar > 0)) return falla_("No tengo el valor del dólar: escríbelo en Más → Ajustes.", "original");
    d = Object.assign({}, d, { monto: Math.round(usd * dolar) });
  }
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
  fila.Etiqueta = texto_(d.etiqueta).replace(/\s+/g, " ").slice(0, 30);
  fila.Moneda = usd ? "USD" : ""; fila.Original = usd || "";
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
// Borrar varios movimientos de una vez (3.9). Devuelve una copia de lo borrado para «Deshacer»
// (las fechas como texto: google.script.run no transporta fechas).
const BORRAR_MAX_ = 3000;
function copiaFila_(f, cab) {
  const o = {}; cab.forEach(c => { if (!c) return; const v = f[c]; o[c] = v instanceof Date ? (c === "Fecha" ? iso_(v) : v.toISOString()) : v; }); return o;
}
function borrarMovimientos(ids, periodo) {
  olvidarLecturas_();
  asegurarEstructura_();
  const lista = Array.isArray(ids) ? ids.map(texto_).filter(x => x) : [];
  if (!lista.length) return falla_("Elige al menos un movimiento.");
  if (lista.length > BORRAR_MAX_) return falla_("Son demasiados de una vez.");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.MOV), set = new Set(lista), quedan = [], copia = [];
    t.filas.forEach(f => { if (set.has(texto_(f.ID))) copia.push(copiaFila_(f, t.cab)); else quedan.push(f); });
    if (!copia.length) return falla_("Esos movimientos ya no existen.");
    reemplazarDatos_(t, quedan);
    olvidarLecturas_();
    return { ok: true, borrados: copia.length, copia: copia, datos: panelDatos(periodo) };
  } finally { lock.releaseLock(); }
}
// Deshacer: vuelve a poner lo borrado (con sus mismos códigos; lo que ya volvió no se duplica)
function restaurarMovimientos(copia, periodo) {
  olvidarLecturas_();
  asegurarEstructura_();
  if (!Array.isArray(copia) || !copia.length || copia.length > BORRAR_MAX_) return falla_("No hay nada que deshacer.");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.MOV), ids = new Set(movimientos_().map(m => m.id)), filas = [];
    copia.forEach(o => {
      if (!o || typeof o !== "object" || !/^[A-Za-z0-9-]{2,40}$/.test(texto_(o.ID)) || ids.has(texto_(o.ID))) return;
      const f = {}; t.cab.forEach(c => { if (c && o[c] !== undefined) f[c] = o[c]; });
      f.Fecha = fechaDe_(o.Fecha); if (!f.Fecha) return;
      if (o.Registrado) f.Registrado = fechaDe_(o.Registrado) || ahora_();
      ids.add(texto_(o.ID)); filas.push(f);
    });
    agregarFilas_(t, filas);
    return { ok: true, restaurados: filas.length, datos: panelDatos(periodo) };
  } finally { lock.releaseLock(); }
}
// Borrar en bloque (3.9), con la palabra BORRAR como confirmación:
// «movimientos» = todos los movimientos y las cuentas compartidas; «todo» = además metas, tarjetas, deudas,
// fijos y patrimonio. Las categorías (con sus presupuestos) y los ajustes se conservan.
function borrarTodo(que, confirmacion) {
  olvidarLecturas_();
  asegurarEstructura_();
  if (texto_(confirmacion).toUpperCase() !== "BORRAR") return falla_("Escribe BORRAR para confirmar.", "confirmacion");
  const hojas = que === "todo" ? [HOJA.MOV, HOJA.COMP, HOJA.METAS, HOJA.TARJ, HOJA.DEUDAS, HOJA.FIJOS, HOJA.ACT, HOJA.SALDOS]
    : que === "movimientos" ? [HOJA.MOV, HOJA.COMP] : null;
  if (!hojas) return falla_("Elige qué borrar.");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let n = 0;
  try {
    hojas.forEach(h => { const t = tabla_(h); if (t && t.filas.length) { if (h === HOJA.MOV) n = t.filas.length; reemplazarDatos_(t, []); olvidarLecturas_(); } });
    return { ok: true, movimientos: n, datos: panelDatos() };
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
/* ── cuentas compartidas (3.6) ──────────────────────────────────────────
   «Generar cuenta» divide una compra entre varias personas (partes iguales, por consumo o montos a
   mano) con propina. Como gasto propio cuenta SOLO MI PARTE; lo que otros me deben (si pagué yo) o lo
   que le debo a quien pagó queda en la hoja Compartidas hasta que se paga. Ese pago devuelve plata que
   el presupuesto nunca contó como mía: no es ingreso ni gasto nuevo, solo salda la fila. */
const SENTIDO_ = { DEBE: "Me debe", DEBO: "Le debo" };
// El cálculo. Lo usa el servidor y, tal cual (toString), el panel para la vista previa: por eso no llama
// a otras funciones. d = { personas: [nombres; la 0 soy yo], modo: "iguales" | "items" | "manual", subtotal,
// items: [{ nombre, precio, cantidad, de: [índices de quienes lo consumieron] }], montos: [uno por persona],
// propinaPct, propinaMonto (si viene, manda sobre el %) }. Todo en pesos enteros y sumando exacto.
function dividirCuenta_(d) {
  d = d || {};
  var mal = function (error, campo) { return { ok: false, error: error, campo: campo }; };
  var pesos = function (v) { if (typeof v === "number") return isFinite(v) && v > 0 ? Math.round(v) : 0; var s = String(v == null ? "" : v).replace(/[^0-9]/g, ""); return s ? Number(s) : 0; };
  var personas = (Array.isArray(d.personas) ? d.personas : []).map(function (p) { return String(p == null ? "" : p).trim().slice(0, 30); });
  var n = personas.length, i, j;
  if (n < 2) return mal("Agrega al menos a otra persona.", "personas");
  if (n > 30) return mal("Hasta 30 personas por cuenta.", "personas");
  personas[0] = personas[0] || "Yo";
  var vistos = {};
  for (i = 0; i < n; i++) {
    if (!personas[i]) return mal("Ponle nombre a cada persona.", "personas");
    if (vistos[personas[i].toLowerCase()]) return mal("Hay dos personas llamadas «" + personas[i] + "».", "personas");
    vistos[personas[i].toLowerCase()] = true;
  }
  var modo = d.modo === "items" || d.modo === "manual" ? d.modo : "iguales";
  var base = personas.map(function () { return 0; }), items = [];
  if (modo === "items") {
    var lista = (Array.isArray(d.items) ? d.items : []).filter(function (x) { return x && (String(x.nombre || "").trim() || pesos(x.precio)); });
    if (!lista.length) return mal("Agrega al menos un ítem con su precio.", "items");
    if (lista.length > 100) return mal("Hasta 100 ítems por cuenta.", "items");
    for (i = 0; i < lista.length; i++) {
      var x = lista[i], nombre = String(x.nombre || "").trim().slice(0, 40) || "Ítem " + (i + 1);
      var precio = pesos(x.precio), cant = Math.min(99, Math.max(1, pesos(x.cantidad) || 1)), de = [];
      if (!(precio > 0)) return mal("Falta el precio de «" + nombre + "».", "items");
      (Array.isArray(x.de) ? x.de : []).forEach(function (k) { k = Number(k); if (k >= 0 && k < n && Math.floor(k) === k && de.indexOf(k) < 0) de.push(k); });
      if (!de.length) return mal("Elige quién consumió «" + nombre + "».", "items");
      for (j = 0; j < de.length; j++) base[de[j]] += precio * cant / de.length;
      items.push({ nombre: nombre, precio: precio, cantidad: cant, total: precio * cant, de: de });
    }
  } else if (modo === "manual") {
    var montos = Array.isArray(d.montos) ? d.montos : [];
    base = personas.map(function (p, k) { return pesos(montos[k]); });
  } else {
    var s = pesos(d.subtotal);
    base = personas.map(function () { return s / n; });
  }
  var subtotal = Math.round(base.reduce(function (a, b) { return a + b; }, 0));
  if (!(subtotal > 0)) return modo === "manual" ? mal("Escribe cuánto pone cada persona.", "montos") : mal("Escribe el monto de la cuenta.", "subtotal");
  if (subtotal > 999999999) return mal("El monto es demasiado grande.", "subtotal");
  var aMano = d.propinaMonto !== undefined && d.propinaMonto !== null && String(d.propinaMonto) !== "";
  var pct = aMano ? null : Math.min(100, Math.max(0, Number(String(d.propinaPct == null ? 0 : d.propinaPct).replace(",", ".")) || 0));
  var propina = aMano ? pesos(d.propinaMonto) : Math.round(subtotal * pct / 100);
  if (propina > subtotal) return mal("La propina no puede ser mayor que la cuenta.", "propina");
  // reparte un monto en pesos enteros, en proporción a lo que consumió cada uno, sumando exacto (mayor resto)
  var repartir = function (monto) {
    var exactos = base.map(function (b) { return b * monto / subtotal; }), enteros = exactos.map(function (e) { return Math.floor(e); });
    var falta = monto - enteros.reduce(function (a, b) { return a + b; }, 0);
    var orden = exactos.map(function (e, k) { return { k: k, r: e - Math.floor(e) }; }).sort(function (a, b) { return b.r - a.r || a.k - b.k; });
    for (var q = 0; q < falta; q++) enteros[orden[q % n].k]++;
    return enteros;
  };
  var consumo = repartir(subtotal), propinas = repartir(propina);
  return {
    ok: true, modo: modo, subtotal: subtotal, propina: propina, pct: pct, total: subtotal + propina, items: items,
    personas: personas.map(function (p, k) { return { nombre: p, consumo: consumo[k], propina: propinas[k], total: consumo[k] + propinas[k] }; })
  };
}
function detalleCuenta_(r) {
  return [clp_(r.total), r.personas.length + " personas", r.modo === "items" ? "por consumo" : (r.modo === "manual" ? "montos a mano" : "partes iguales"),
    r.propina ? "propina " + (r.pct !== null ? r.pct + " % " : "") + clp_(r.propina) : "sin propina"].join(" · ");
}
// Guarda la cuenta: d = lo de dividirCuenta_ + { nombre, fecha, pagador (índice), categoria, medio, cuotas }
function guardarCuenta(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const nombre = texto_(d.nombre).slice(0, 40);
  if (!nombre) return falla_("Ponle nombre a la cuenta (ej: Asado del sábado).", "nombre");
  const r = dividirCuenta_(d); if (!r.ok) return falla_(r.error, r.campo);
  const pagador = Number(d.pagador);
  if (!(Number.isInteger(pagador) && pagador >= 0 && pagador < r.personas.length)) return falla_("Elige quién pagó la cuenta.", "pagador");
  const fecha = d.fecha ? fechaDe_(d.fecha) : ahora_();
  if (!fecha) return falla_("Revisa la fecha.", "fecha");
  if (diasEntre_(ahora_(), fecha) > 1) return falla_("La fecha no puede ser futura.", "fecha");
  const mia = r.personas[0].total;
  let mov = null;
  if (mia > 0) {
    const v = validarMovimiento_({ fecha: d.fecha, tipo: "Gasto", monto: mia, categoria: d.categoria, medio: d.medio, cuotas: d.cuotas, nota: nombre + " · cuenta compartida" });
    if (!v.ok) return v;
    mov = v.fila;
  }
  const filas = pagador === 0
    ? r.personas.slice(1).filter(p => p.total > 0).map(p => ({ persona: p.nombre, sentido: SENTIDO_.DEBE, monto: p.total }))
    : (mia > 0 ? [{ persona: r.personas[pagador].nombre, sentido: SENTIDO_.DEBO, monto: mia }] : []);
  if (!filas.length && !mov) return falla_("No hay nada que anotar: tu parte es $0 y nadie te debe.", "personas");
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const grupo = idNuevo_("C"), movId = mov ? idNuevo_("M") : "", detalle = detalleCuenta_(r);
    if (mov) agregarFilas_(tabla_(HOJA.MOV), [Object.assign({ "ID": movId, "Registrado": ahora_() }, mov)]);
    if (filas.length) agregarFilas_(tabla_(HOJA.COMP), filas.map(f => ({ "ID": idNuevo_("P"), "Fecha": fecha, "Cuenta": nombre, "Persona": f.persona, "Sentido": f.sentido, "Monto": f.monto, "Pagado": 0, "Grupo": grupo, "Movimiento": movId, "Detalle": detalle })));
    return { ok: true, grupo: grupo, datos: panelDatos() };
  } finally { lock.releaseLock(); }
}
function compartidas_() {
  const t = tabla_(HOJA.COMP); if (!t) return [];
  return t.filas.map(f => {
    const monto = Math.max(0, Math.round(numero_(f.Monto) || 0)), pagado = Math.min(monto, Math.max(0, Math.round(numero_(f.Pagado) || 0)));
    return { id: texto_(f.ID), fecha: fechaDe_(f.Fecha), cuenta: texto_(f.Cuenta), persona: texto_(f.Persona), sentido: texto_(f.Sentido) === SENTIDO_.DEBO ? SENTIDO_.DEBO : SENTIDO_.DEBE, monto: monto, pagado: pagado, pendiente: monto - pagado, grupo: texto_(f.Grupo), movimiento: texto_(f.Movimiento), detalle: texto_(f.Detalle), _fila: f._fila };
  }).filter(x => x.id && x.persona && x.monto > 0);
}
// Saldos por persona (lo que me debe menos lo que le debo), las últimas cuentas y los nombres usados
function estadoCompartidas_() {
  const lista = compartidas_(), por = {}, grupos = {}, recientes = [];
  lista.forEach(x => {
    const g = grupos[x.grupo] || (grupos[x.grupo] = { grupo: x.grupo, cuenta: x.cuenta, fecha: x.fecha ? iso_(x.fecha) : "", detalle: x.detalle, pendiente: 0, personas: [] });
    g.pendiente += x.pendiente; g.personas.push({ persona: x.persona, sentido: x.sentido, monto: x.monto, pendiente: x.pendiente });
    if (!(x.pendiente > 0)) return;
    const k = x.persona.toLowerCase(), p = por[k] || (por[k] = { persona: x.persona, meDebe: 0, leDebo: 0, cuentas: [] });
    if (x.sentido === SENTIDO_.DEBE) p.meDebe += x.pendiente; else p.leDebo += x.pendiente;
    p.cuentas.push({ cuenta: x.cuenta, fecha: x.fecha ? iso_(x.fecha) : "", sentido: x.sentido, pendiente: x.pendiente });
  });
  const personas = Object.keys(por).map(k => Object.assign(por[k], { neto: por[k].meDebe - por[k].leDebo })).filter(p => p.neto !== 0 || p.cuentas.length)
    .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto) || a.persona.localeCompare(b.persona));
  lista.slice().sort((a, b) => (b.fecha || 0) - (a.fecha || 0)).forEach(x => { if (recientes.length < 12 && !recientes.some(n => n.toLowerCase() === x.persona.toLowerCase())) recientes.push(x.persona); });
  return {
    meDeben: personas.reduce((a, p) => a + Math.max(0, p.neto), 0), debo: personas.reduce((a, p) => a + Math.max(0, -p.neto), 0),
    personas: personas, recientes: recientes,
    cuentas: Object.keys(grupos).map(k => grupos[k]).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.grupo.localeCompare(a.grupo)).slice(0, 20),
  };
}
// Pago entre personas: d = { persona, monto } (sin monto = queda todo saldado). Lo cruzado (me debe y le debo)
// se compensa; el abono paga primero lo más antiguo.
function saldarCompartida(d) {
  olvidarLecturas_();
  asegurarEstructura_(); d = d || {};
  const persona = texto_(d.persona).toLowerCase();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = tabla_(HOJA.COMP), filas = compartidas_().filter(x => x.persona.toLowerCase() === persona && x.pendiente > 0);
    if (!persona || !filas.length) return falla_("No hay nada pendiente con esa persona.");
    const suma = s => filas.filter(x => x.sentido === s).reduce((a, x) => a + x.pendiente, 0);
    const neto = suma(SENTIDO_.DEBE) - suma(SENTIDO_.DEBO), todo = !texto_(d.monto);
    if (todo) filas.forEach(x => escribirFila_(t, x._fila, { "Pagado": x.monto }));
    else {
      const abono = Math.round(numero_(d.monto));
      if (!(abono > 0)) return falla_("Escribe cuánto se pagó.", "monto");
      if (abono > Math.abs(neto)) return falla_("Es más de lo pendiente (" + clp_(Math.abs(neto)) + ").", "monto");
      const lado = neto >= 0 ? SENTIDO_.DEBE : SENTIDO_.DEBO, otro = filas.filter(x => x.sentido !== lado);
      let cubrir = otro.reduce((a, x) => a + x.pendiente, 0) + abono;
      otro.forEach(x => escribirFila_(t, x._fila, { "Pagado": x.monto }));
      filas.filter(x => x.sentido === lado).sort((a, b) => (a.fecha || 0) - (b.fecha || 0) || a._fila - b._fila).forEach(x => {
        const usa = Math.min(x.pendiente, cubrir);
        if (usa > 0) { escribirFila_(t, x._fila, { "Pagado": x.pagado + usa }); cubrir -= usa; }
      });
    }
    olvidarLecturas_();
    return { ok: true, datos: panelDatos() };
  } finally { lock.releaseLock(); }
}
// Borra una cuenta completa: sus filas en Compartidas y el gasto de mi parte
function quitarCuenta(grupo) {
  olvidarLecturas_();
  asegurarEstructura_();
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const g = texto_(grupo), t = tabla_(HOJA.COMP), filas = g ? t.filas.filter(x => texto_(x.Grupo) === g) : [];
    if (!filas.length) return falla_("Esa cuenta ya no existe.");
    const movId = texto_(filas[0].Movimiento);
    filas.map(x => x._fila).sort((a, b) => b - a).forEach(f => t.hoja.deleteRow(f));
    olvidarLecturas_();
    if (movId) { const tm = tabla_(HOJA.MOV), fm = tm.filas.find(x => texto_(x.ID) === movId); if (fm) tm.hoja.deleteRow(fm._fila); }
    olvidarLecturas_();
    return { ok: true, datos: panelDatos() };
  } finally { lock.releaseLock(); }
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
  const hoja = { meta: HOJA.METAS, tarjeta: HOJA.TARJ, deuda: HOJA.DEUDAS, fijo: HOJA.FIJOS, activo: HOJA.ACT }[clase];
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
      if (k === "valorDolar" && (isNaN(v) || v < 0)) v = 0;
      if (k === "fondoMeses" && !(v >= 0 && v <= 12)) return falla_("El fondo de emergencia va de 0 a 12 meses.", k);
      if (k === "propinaPct" && !(v >= 0 && v <= 100)) return falla_("La propina va de 0 % a 100 %.", k);
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

// Lector de la cartola (3.8). Corre en el panel, no en el servidor: se inserta tal cual en la página
// (igual que dividirCuenta_), así puede usar expresiones regulares completas. Lee CSV (con ; , o tabulador,
// en UTF-8 o Latin-1), Excel .xlsx (descomprime el archivo con el navegador) y las «.xls» que en realidad
// son una tabla HTML (así las exportan varios bancos). Todo pasa en el equipo: el archivo no se sube.
function herramientasCartola_() {
  function decodificar(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("windows-1252").decode(buf); }
  }
  function csv(texto) {
    texto = texto.replace(/^﻿/, "");
    const muestra = texto.split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 25).join("\n");
    const sep = [";", "\t", ",", "|"].map(s => ({ s: s, n: muestra.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
    const filas = []; let fila = [], campo = "", comillas = false;
    const cerrar = () => { fila.push(campo); campo = ""; if (fila.some(x => x.trim())) filas.push(fila.map(x => x.trim())); fila = []; };
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (comillas) { if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c; }
      else if (c === '"') comillas = true;
      else if (c === sep) { fila.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; cerrar(); }
      else campo += c;
    }
    cerrar();
    return filas;
  }
  async function zip(buf) {
    const v = new DataView(buf), u = new Uint8Array(buf), out = {};
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 70000); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("No es un archivo Excel (.xlsx) válido.");
    let p = v.getUint32(e + 16, true);
    const n = v.getUint16(e + 10, true);
    for (let k = 0; k < n; k++) {
      const ln = v.getUint16(p + 28, true), lx = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true);
      out[new TextDecoder().decode(u.subarray(p + 46, p + 46 + ln))] = { metodo: v.getUint16(p + 10, true), tam: v.getUint32(p + 20, true), loc: v.getUint32(p + 42, true) };
      p += 46 + ln + lx + lc;
    }
    return {
      nombres: Object.keys(out),
      leer: async nombre => {
        const x = out[nombre]; if (!x) return null;
        const ini = x.loc + 30 + v.getUint16(x.loc + 26, true) + v.getUint16(x.loc + 28, true), datos = u.subarray(ini, ini + x.tam);
        if (x.metodo === 0) return new TextDecoder().decode(datos);
        if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no abre archivos Excel: guárdalo como CSV.");
        return await new Response(new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
      },
    };
  }
  async function xlsx(buf) {
    const z = await zip(buf), dp = new DOMParser(), comunes = [];
    const sst = await z.leer("xl/sharedStrings.xml");
    if (sst) Array.prototype.forEach.call(dp.parseFromString(sst, "application/xml").getElementsByTagName("si"), si => {
      comunes.push(Array.prototype.map.call(si.getElementsByTagName("t"), t => t.textContent).join(""));
    });
    const hojas = z.nombres.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (!hojas.length) throw new Error("El Excel no trae hojas.");
    const doc = dp.parseFromString(await z.leer(hojas[0]), "application/xml"), filas = [];
    Array.prototype.forEach.call(doc.getElementsByTagName("row"), row => {
      const fila = [];
      Array.prototype.forEach.call(row.getElementsByTagName("c"), c => {
        const ref = c.getAttribute("r") || "", letras = (ref.match(/^[A-Z]+/) || [""])[0];
        let col = 0; for (let i = 0; i < letras.length; i++) col = col * 26 + letras.charCodeAt(i) - 64;
        col = col ? col - 1 : fila.length;
        const t = c.getAttribute("t"), vv = c.getElementsByTagName("v")[0], val = vv ? vv.textContent : "";
        let x;
        if (t === "s") x = comunes[Number(val)] || "";
        else if (t === "inlineStr") x = Array.prototype.map.call(c.getElementsByTagName("t"), n => n.textContent).join("");
        else if (t === "str" || t === "b" || t === "e") x = val;
        else x = val === "" ? "" : Number(val);
        while (fila.length < col) fila.push("");
        fila[col] = typeof x === "string" ? x.trim() : x;
      });
      if (fila.some(x => String(x).trim() !== "")) filas.push(fila);
    });
    return filas;
  }
  function html(texto) {
    const doc = new DOMParser().parseFromString(texto, "text/html");
    let mejor = null;
    Array.prototype.forEach.call(doc.querySelectorAll("table"), t => { if (!mejor || t.rows.length > mejor.rows.length) mejor = t; });
    if (!mejor) return [];
    return Array.prototype.map.call(mejor.rows, r => Array.prototype.map.call(r.cells, c => c.textContent.replace(/\s+/g, " ").trim())).filter(f => f.some(x => x));
  }
  async function leer(archivo) {
    const buf = await archivo.arrayBuffer(), u = new Uint8Array(buf.slice(0, 8));
    if (u[0] === 0x50 && u[1] === 0x4b) return xlsx(buf);
    if (u[0] === 0xd0 && u[1] === 0xcf) throw new Error("Es un Excel antiguo (.xls): ábrelo y guárdalo como .xlsx o CSV.");
    const texto = decodificar(buf);
    if (/<table/i.test(texto.slice(0, 20000))) return html(texto);
    return csv(texto);
  }
  const norm = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Qué columna es cada cosa: busca la fila de encabezados (la que dice «fecha» y algo de montos) entre las primeras 25
  function detectar(filas) {
    let enc = -1;
    for (let i = 0; i < Math.min(25, filas.length); i++) {
      const c = filas[i].map(norm);
      if (c.some(x => /fecha/.test(x)) && c.some(x => /monto|cargo|abono|importe|debito|credito|valor|giro|deposito/.test(x))) { enc = i; break; }
    }
    const cab = enc >= 0 ? filas[enc].map(norm) : [];
    const col = re => cab.findIndex(x => re.test(x));
    const r = { encabezado: enc, fecha: col(/fecha/), descripcion: col(/descrip|detalle|glosa|concepto|movimiento|comercio|transac|nombre/),
      cargo: col(/cargo|debito|giro|egreso|retiro/), abono: col(/abono|credito|deposito|ingreso/), monto: col(/monto|importe|valor/) };
    if (r.cargo >= 0 && r.abono >= 0) r.monto = -1; else { if (r.monto < 0 && r.cargo >= 0) r.monto = r.cargo; r.cargo = -1; r.abono = -1; }
    if (enc < 0) {   // sin encabezados: la primera columna con fechas, la con más texto y la última con números
      const muestra = filas.slice(0, 10), ancho = Math.max.apply(null, filas.map(f => f.length));
      const es = (j, re) => muestra.filter(f => re.test(String(f[j] == null ? "" : f[j]))).length >= Math.min(3, muestra.length);
      for (let j = 0; j < ancho; j++) { if (r.fecha < 0 && es(j, /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/)) r.fecha = j; }
      for (let j = ancho - 1; j >= 0; j--) { if (r.monto < 0 && j !== r.fecha && es(j, /^[\s$(-]*[\d.,]+[)-]?$/)) r.monto = j; }
      let largo = -1, desc = -1;
      for (let j = 0; j < ancho; j++) { if (j === r.fecha || j === r.monto) continue; const l = muestra.reduce((s, f) => s + String(f[j] == null ? "" : f[j]).length, 0); if (l > largo) { largo = l; desc = j; } }
      r.descripcion = desc;
    }
    return r;
  }
  return { leer: leer, detectar: detectar, csv: csv };
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
@media (prefers-color-scheme:dark){:root:not([data-tema="claro"]){--graf-o:#2C3B52;--bg:#06080C;--s:#0E131B;--s2:#131A25;--b:#1B2330;--t:#E8EDF5;--t2:#B4BFD2;--t3:#98A2B3;--a:#8FC1FF;--a2:#8FC1FF;--a-suave:#0B1624;--ok:#4CC387;--ok-s:#123224;--warn:#F2B04E;--warn-s:#33270F;--bad:#F2786F;--bad-s:#3A1A1A;--sh:0 1px 2px rgba(0,0,0,.3),0 8px 24px -10px rgba(0,0,0,.6);color-scheme:dark}}
:root[data-tema="oscuro"]{--graf-o:#2C3B52;--bg:#06080C;--s:#0E131B;--s2:#131A25;--b:#1B2330;--t:#E8EDF5;--t2:#B4BFD2;--t3:#98A2B3;--a:#8FC1FF;--a2:#8FC1FF;--a-suave:#0B1624;--ok:#4CC387;--ok-s:#123224;--warn:#F2B04E;--warn-s:#33270F;--bad:#F2786F;--bad-s:#3A1A1A;--sh:0 1px 2px rgba(0,0,0,.3),0 8px 24px -10px rgba(0,0,0,.6);color-scheme:dark}
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
.hero .racha{display:flex;align-items:center;gap:6px;margin:12px 0 0;font-size:13px;opacity:.95}.hero .racha i{font-size:17px;color:#FFD08A}
.explica .fila .tx small.cmp{white-space:normal}
.sus .fila{align-items:flex-start}.sus .fila .tx small{white-space:normal}
.sus-b{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.sus-b button{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--b);background:var(--s);color:var(--a);font-weight:650;font-size:13.5px}
.sus-b button:first-child{background:var(--a);border-color:var(--a);color:var(--s)}
.scan-b{display:inline-flex;align-items:center;gap:8px;min-height:44px;margin:0 0 6px;padding:0 16px;border-radius:999px;border:1px solid var(--b);background:var(--s2);color:var(--a);font-weight:650;font-size:14px}.scan-b i{font-size:19px}
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
@media (prefers-color-scheme:dark){:root:not([data-tema="claro"]) .ico{box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}}
:root[data-tema="oscuro"] .ico{box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
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
@media (prefers-color-scheme:dark){:root:not([data-tema="claro"]) .btn-p{background:#2F74BF;border-color:#2F74BF}}
:root[data-tema="oscuro"] .btn-p{background:#2F74BF;border-color:#2F74BF}
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
/* barra estilo iOS (3.5): la pastilla de vidrio marca la sección, se desliza al cambiar y sigue al dedo al arrastrar */
.nav{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.nav button{position:relative;z-index:1}
.nav-p{position:absolute;left:0;top:0;width:var(--w,0);height:var(--h,0);transform:translate(var(--x,0),var(--y,0));border-radius:999px;background:color-mix(in srgb,var(--a) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--a) 22%,transparent);opacity:0;pointer-events:none}
.nav.lista .nav-p{opacity:1;transition:transform .45s cubic-bezier(.32,1.4,.48,1),width .35s var(--ease),scale .2s var(--ease),background-color .2s,opacity .2s}
.nav.arrastra .nav-p{transition:width .2s var(--ease),scale .2s var(--ease),background-color .2s;scale:1.12;background:color-mix(in srgb,var(--a) 22%,transparent);box-shadow:0 8px 20px -8px rgba(0,0,0,.4),inset 0 0 0 1px color-mix(in srgb,var(--a) 32%,transparent)}
.nav.arrastra button[data-v]{color:var(--t3)}.nav.arrastra button.sobre{color:var(--a)}
@media (prefers-reduced-motion:reduce){.nav.lista .nav-p{transition:opacity .2s}.nav.arrastra .nav-p{scale:1}}
/* Más como menú, botones y espacios (3.7) */
.menu-cta{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:16px;margin:12px 0;font:inherit;color:inherit;cursor:pointer;border-color:color-mix(in srgb,var(--a) 30%,var(--b))}
.menu-cta .tx,.menu-f .tx{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.menu-cta b,.menu-f b{font-size:16px;font-weight:650}
.menu-cta small,.menu-f small{font-size:13px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-cta>.ti{font-size:22px;color:var(--a)}
.menu{margin:0 0 14px;padding:2px 0}.menu-1{margin-top:12px}
.menu-f{width:100%;min-height:68px;gap:14px;text-align:left;font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.menu-f+.menu-f{border-top:1px solid var(--b)}
.menu-f>.ti{color:var(--t3);font-size:20px}
.volver{display:inline-flex;align-items:center;gap:2px;min-height:44px;margin:4px 0 0 -8px;padding:0 10px 0 4px;border:0;background:none;color:var(--a);font:inherit;font-size:16px;font-weight:600;cursor:pointer}
.volver .ti{font-size:24px}
h2 button{background:var(--a-suave,#EBF2FA);border-radius:999px;padding:0 14px;min-height:40px}
.acc .btn{flex:1 1 0;min-height:46px}
.cc-ayuda{margin:6px 2px 4px}
@media (max-width:390px){.nav button{font-size:10.5px;letter-spacing:-.01em}.nav .mas{flex-basis:52px;height:52px;min-height:52px}}
/* burbujas del + (3.7) */
.burb{position:fixed;inset:0;z-index:29;pointer-events:none}
.burb-velo{position:absolute;inset:0;background:color-mix(in srgb,var(--bg) 55%,transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .25s var(--ease)}
.burb.on{pointer-events:auto}.burb.on .burb-velo{opacity:1}
.burb-l{position:absolute;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));width:min(380px,calc(100% - 24px));transform:translateX(-50%);display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;padding:14px;border-radius:24px;background:var(--s);border:1px solid var(--b);box-shadow:0 18px 50px -12px rgba(16,24,40,.45);z-index:31;transform-origin:50% 100%;opacity:0;translate:0 16px;scale:.96;pointer-events:none;transition:opacity .2s ease,translate .3s var(--ease),scale .3s var(--ease)}
.burb.on .burb-l{opacity:1;translate:0 0;scale:1;pointer-events:auto}
.burb-l button{grid-column:span 2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:92px;padding:10px 4px;border:0;border-radius:16px;background:var(--s2);font:inherit;color:var(--t);cursor:pointer;opacity:0;translate:0 8px;transition:opacity .2s ease calc(var(--i) * 30ms),translate .3s var(--ease) calc(var(--i) * 30ms),background .15s}
.burb.on .burb-l button{opacity:1;translate:0 0}
.burb-l .burb-g{grid-column:span 3;flex-direction:row;justify-content:flex-start;min-height:72px;gap:12px;padding:12px 14px}
.burb-i{width:46px;height:46px;border-radius:14px;background:var(--c);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
.burb-t{font-size:14px;font-weight:650;line-height:1.2;text-align:center}.burb-g .burb-t{font-size:16px;text-align:left}
.burb-l button:active{background:var(--a-suave)}.burb-l button:focus-visible{outline:2px solid var(--a);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.burb-l,.burb-l button{transition:opacity .15s;translate:none;scale:none}.nav .mas i{transition:none}}
@media (max-width:300px){.burb-l .burb-g{flex-direction:column;justify-content:center;gap:8px;min-height:84px;padding:10px 4px}.burb-g .burb-t{text-align:center;font-size:13px}}
@media (max-width:340px){.burb-l{gap:8px;padding:10px}.burb-l button{min-height:84px}.burb-l .burb-g{min-height:64px;gap:8px;padding:10px}.burb-i{width:40px;height:40px;font-size:21px}.burb-t{font-size:12.5px}.burb-g .burb-t{font-size:15px}}
.nav .mas i{transition:transform .3s cubic-bezier(.32,1.4,.48,1)}.nav .mas.abierto i{transform:rotate(135deg)}
.cc-pag i{font-size:16px}.cc-nota{margin:2px 2px 0}
/* Generar cuenta en pasos (3.7) */
.cc-pasos{display:flex;gap:6px;margin:0 0 4px;position:sticky;top:0;z-index:2;background:var(--s);padding:4px 0 8px}
.cc-paso{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 6px;border:0;border-radius:999px;background:var(--s2);color:var(--t3);font:inherit;font-size:13px;font-weight:650;cursor:default}
.cc-paso em{font-style:normal}
.cc-paso span{width:22px;height:22px;flex-shrink:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--b);color:var(--t2);font-size:12px;font-weight:700}
.cc-paso.on{background:var(--a-suave);color:var(--a)}.cc-paso.on span{background:var(--a);color:#fff}
.cc-paso.hecho{color:var(--t2);cursor:pointer}.cc-paso.hecho span{background:var(--ok);color:#fff}.cc-paso.hecho span .ti{font-size:14px}
.cc-preg{font-size:17px;font-weight:700;color:var(--t);margin:10px 2px 4px;letter-spacing:-.01em}
.cc-mini{display:flex;gap:10px;margin:16px 0 2px}
.cc-mini span{flex:1;display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:14px;background:var(--a-suave);font-size:12.5px;font-weight:600;color:var(--t3)}
.cc-mini b{font-size:20px;color:var(--t)}
.cc-mini .cc-mini-m{font-size:14px;font-weight:500;color:var(--t3);background:var(--s2)}
.cc-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 10px}
@media (max-width:360px){.cc-2{grid-template-columns:minmax(0,1fr)}.cc-paso:not(.on) em{display:none}}
/* cuentas compartidas (3.6) */
.cc-gen{margin:12px 0 4px}
.cc-sal{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 4px}.cc-sal .card{padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.cc-sal small{color:var(--t3);font-size:12.5px;font-weight:600}.cc-sal b{font-size:21px}
.cc-pos{color:var(--ok)}.cc-neg{color:var(--bad)}
.cc-av{font-weight:700;font-size:16px}
.cc-pers,.cc-sug,.cc-de{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.cc .chip{min-height:38px;padding:0 12px;font-size:13.5px}
.cc .chip.on,.cc .chip[aria-pressed=true]{background:var(--a);border-color:var(--a);color:#fff}
.cc-p button{border:0;background:none;color:inherit;min-width:28px;min-height:28px;margin-right:-6px;display:inline-flex;align-items:center;justify-content:center}
.cc-add{display:flex;gap:8px;margin:8px 0 4px}.cc-add .inp{flex:1;min-width:0}.cc-add .btn{flex:0 0 52px;padding:0}
.cc-item{padding:10px;margin:8px 0}
.cc-item-f{display:grid;grid-template-columns:minmax(0,1fr) 96px 54px 40px;gap:6px;align-items:center}
.cc-item-f .inp{min-height:44px;padding:0 10px}
.cc-x{border:0;background:none;color:var(--t3);min-height:44px;font-size:18px}
.cc-tabla{padding:4px 12px;margin:14px 0 10px}
.cc-fila{display:grid;grid-template-columns:minmax(0,1.25fr) repeat(3,minmax(0,1fr));gap:6px;padding:9px 0;border-bottom:1px solid var(--b);font-size:14px;align-items:baseline}
.cc-fila>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-fila>:not(:first-child){text-align:right}
.cc-cab{font-size:11.5px;color:var(--t3);font-weight:700}
.cc-tot{border-bottom:0;font-weight:700}
.cc-fila small{color:var(--a);font-size:11px;font-weight:700}
.cc-queda{display:flex;flex-direction:column;gap:8px;font-size:14.5px;color:var(--t2);margin-bottom:6px}
.cc-queda i{color:var(--a);margin-right:4px}
.cc-aviso{padding:14px;text-align:center;color:var(--t3);font-size:14px}
.cc-ini{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 16px;margin-top:12px;font:inherit;color:inherit;cursor:pointer}
.cc-ini .tx{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}.cc-ini small{color:var(--t3);font-size:12.5px}
@media (max-width:360px){.cc-item-f{grid-template-columns:minmax(0,1fr) 84px 46px 34px}.cc-fila{font-size:13px}}
/* hoja inferior (registro y formularios) */
.velo{position:fixed;inset:0;z-index:40;background:rgba(5,10,20,.5);opacity:0;pointer-events:none;transition:opacity .25s}
.velo.on{opacity:1;pointer-events:auto}
html.fondo-fijo body{position:fixed;left:0;right:0;overflow:hidden}
.hoja-cuerpo{overscroll-behavior:contain}
.nav button[inert]{opacity:.35;transition:opacity .2s}
.hoja{position:fixed;left:50%;bottom:0;z-index:41;width:min(560px,100%);max-height:calc(100vh - 16px - env(safe-area-inset-top,0px));max-height:calc(100dvh - 16px - env(safe-area-inset-top,0px));transform:translate(-50%,105%);transition:transform .35s var(--ease);background:var(--s);border-radius:24px 24px 0 0;display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.25)}
.hoja.on{transform:translate(-50%,0)}
.hoja-c{display:flex;align-items:center;gap:10px;padding:14px 16px 8px}
.hoja-c b{flex:1;font-size:17px}
.hoja-c button{width:44px;height:44px;border-radius:50%;border:0;background:var(--s2);font-size:20px;display:flex;align-items:center;justify-content:center}
.hoja-cuerpo{overflow-y:auto;padding:0 16px 12px;flex:1;-webkit-overflow-scrolling:touch}
.hoja-pie{padding:10px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--b);display:flex;gap:8px}
.hoja-pie .btn{flex:1;min-height:50px;font-size:15px}
.monto{font-size:44px;font-weight:750;letter-spacing:-.03em;text-align:center;padding:6px 0 2px}
.monto.vacio-m{color:var(--t3)}
input.monto{display:block;width:100%;border:0;border-radius:16px;background:none;color:var(--t);font-family:inherit;font-size:44px;font-weight:750;letter-spacing:-.03em;text-align:center;padding:8px 0 6px;margin:2px 0 4px;outline:none;caret-color:var(--a);-webkit-appearance:none;appearance:none}
input.monto::placeholder{color:var(--t3);opacity:1}
input.monto:focus{background:var(--s2)}.monto.pide{color:var(--bad);animation:pide .35s}
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
@media (prefers-color-scheme:dark){:root:not([data-tema="claro"]) .chip.on{background:#2F74BF;border-color:#2F74BF}}
:root[data-tema="oscuro"] .chip.on{background:#2F74BF;border-color:#2F74BF}
.cats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.cat{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:14px;border:1.5px solid transparent;background:var(--s2);font-size:12px;font-weight:600;color:var(--t2);min-height:76px;text-align:center;line-height:1.2}
.cat .ico{width:36px;height:36px;font-size:19px}
.cat.on{border-color:var(--a);background:var(--a-suave);color:var(--t)}
.cats.anchas{grid-template-columns:repeat(2,minmax(0,1fr))}
.cats.anchas .cat{flex-direction:row;align-items:center;text-align:left;gap:10px;padding:10px 12px;min-height:66px}
.cat-tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.cat-tx b{font-size:13.5px;font-weight:650;color:var(--t);line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.cat-tx small{font-size:12px;font-weight:500;color:var(--t3)}
.reg-sub .seg{margin:12px 0 2px}
.reg-pista{font-size:13.5px;font-weight:600;color:var(--a);text-align:center;margin:10px 4px 0}.reg-pista:empty{display:none}
.reg-vacio{margin-top:14px}
@media (max-width:340px){.cats.anchas{grid-template-columns:minmax(0,1fr)}}
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
.alerta-b{width:100%;border:0;text-align:left;font:inherit;cursor:pointer;margin-top:12px}
.cifras{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:4px 0 10px}
.cifras div{background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:10px 12px;min-width:0}
.cifras small{display:block;font-size:12px;color:var(--t3)}.cifras b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cierre-f p{margin:6px 2px;font-size:14.5px;line-height:1.5;color:var(--t)}
.pat-graf{display:flex;gap:6px;align-items:flex-end;padding:14px 12px 10px;height:170px}
.pg-c{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;min-width:0}
.pg-v{font-size:11px;color:var(--t3);white-space:nowrap}
.pg-b{flex:1;width:100%;max-width:34px;display:flex;align-items:flex-end}
.pg-b i{display:block;width:100%;border-radius:8px 8px 3px 3px;background:var(--a2)}
.pg-c:last-child .pg-b i{background:var(--a)}
.pg-m{font-size:12px;color:var(--t3)}
.imp-prev{overflow-x:auto;padding:6px 8px}
.imp-prev table{border-collapse:collapse;font-size:12.5px}
.imp-prev td{padding:6px 8px;border-bottom:1px solid var(--b);white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.imp-f{align-items:flex-start}
.imp-f input[type=checkbox]{width:22px;height:22px;margin-top:4px;flex-shrink:0;accent-color:var(--a)}
.imp-f label{display:block;cursor:pointer}
.imp-f .tx b,.imp-f .tx small{white-space:normal}
.imp-f.off .tx,.imp-f.off .v{opacity:.55}
.imp-cat{min-height:40px;padding:4px 36px 4px 10px;font-size:16px;margin-top:6px}
@media (max-width:260px){.hoja-pie{flex-wrap:wrap}.hoja-pie .btn{flex-basis:100%}}
.imp-a{color:var(--warn)}
.preg{display:flex;align-items:center;gap:10px;padding:12px 14px;margin-top:10px;font-size:14px;line-height:1.45}
.preg>i{font-size:22px;color:var(--a);flex-shrink:0}.preg span{flex:1;min-width:0}
.preg .btn{flex:0 0 auto;min-height:40px;padding:0 14px}
html.letra-1 main,html.letra-1 #hojaC,html.letra-1 #hojaT{zoom:1.12}
html.letra-2 main,html.letra-2 #hojaC,html.letra-2 #hojaT{zoom:1.25}
.cat.sug{box-shadow:0 0 0 2px var(--a2)}
.aj-t{font-size:12.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin:18px 6px 6px}
.sw{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;cursor:pointer}
.sw+.sw{border-top:1px solid var(--b)}
.sw>span{flex:1;min-width:0}.sw b{display:block;font-size:15px;font-weight:600}.sw small{display:block;font-size:12.5px;color:var(--t3);line-height:1.35;margin-top:2px}
.sw input{-webkit-appearance:none;appearance:none;flex:none;width:52px;height:32px;margin:0;border-radius:999px;background:var(--b);box-shadow:inset 0 0 0 1px rgba(86,106,128,.35);position:relative;cursor:pointer;transition:background .2s}
.sw input::after{content:'';position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s var(--ease)}
.sw input:checked{background:#2EAA67;box-shadow:none}.sw input:checked::after{transform:translateX(20px)}
.sw input:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.pasos{margin:2px 0 12px;padding-left:22px;font-size:14.5px;line-height:1.5}.pasos li{margin:5px 0}
.frases{margin:0 0 4px;padding-left:20px;font-size:14.5px;line-height:1.5}.frases li{margin:4px 0}
.consejo{padding:14px 14px 12px;margin-top:12px}
.consejo-c{display:flex;align-items:flex-start;gap:12px}.consejo-c .tx{flex:1;min-width:0}
.consejo-c b{display:block;font-size:15px}.consejo-c small{display:block;font-size:13px;color:var(--t2);line-height:1.4}
.consejo-k{display:flex!important;align-items:center;gap:4px;font-size:11.5px!important;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--a)!important;margin-bottom:2px}
.consejo-x{flex:none;width:40px;height:40px;margin:-6px -6px 0 0;border:0;background:none;color:var(--t3);border-radius:10px;font-size:18px}
.consejo-b{width:100%;margin-top:10px;min-height:44px}
.cmp-sel{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.cmp-sel .campo{margin-top:0}
.cmp-c .fila{align-items:flex-start;gap:10px}.cmp-c .tx{white-space:normal;font-size:14.5px;line-height:1.45}
.cmp-i{font-size:20px;flex-shrink:0;margin-top:1px;color:var(--t3)}
.cmp-mal{color:var(--bad)!important}.cmp-bien{color:var(--ok)!important}.cmp-alerta{color:var(--warn)!important}.cmp-idea{color:var(--a)!important}
.cifras small.cmp-mal,.cifras small.cmp-bien{font-weight:600}
.cmp-bs{display:flex;flex-direction:column;gap:3px;margin-top:6px}.cmp-bs i{display:block;height:6px;border-radius:999px}
.cmp-ba{background:var(--a)}.cmp-bb{background:var(--graf-o)}
.cmp-ley{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--t3);margin:0 4px 6px}.cmp-ley i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
@media (max-width:360px){.cmp-sel{grid-template-columns:1fr}}
.sel-ini{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 2px 0}
.sel-h{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--t3);min-width:0}
.sel-b{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--b);background:var(--s);color:var(--a);font-weight:650;font-size:14px}
.sel-b:disabled{opacity:.45}
.sel-bar{position:sticky;top:calc(64px + env(safe-area-inset-top,0px));z-index:5;display:flex;align-items:center;gap:8px;padding:8px 10px;margin-top:10px}
.sel-n{flex:1;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sel-borrar{color:var(--bad);border-color:var(--bad)}
.sel-c{flex:none;width:24px;height:24px;border-radius:50%;border:2px solid var(--t3);display:flex;align-items:center;justify-content:center;font-size:14px;color:transparent}
.sel-f.on .sel-c{background:var(--a);border-color:var(--a);color:#fff}.sel-f.on{background:var(--a-suave)}
.radio-f{display:flex;gap:12px;align-items:flex-start;padding:10px 0;cursor:pointer}.radio-f+.radio-f{border-top:1px solid var(--b)}
.radio-f input{width:22px;height:22px;margin-top:2px;flex:none;accent-color:var(--a)}
.radio-f b{display:block;font-size:15px}.radio-f small{display:block;font-size:12.5px;color:var(--t3);line-height:1.35}
.enl{border:0;background:none;padding:0;color:var(--a);font:inherit;font-weight:650;text-decoration:underline;cursor:pointer}
.reg-desc{margin:4px 0 8px;text-align:center;font-size:16px}
.reg-sug{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 6px;min-height:50px}.reg-sug .ico{width:30px;height:30px;font-size:17px;border-radius:9px}
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
  <span class="nav-p" aria-hidden="true"></span>
  <button class="on" data-v="inicio" onclick="verVista('inicio')"><i class="ti ti-home"></i><span class="et">Inicio</span></button>
  <button data-v="movs" onclick="verVista('movs')"><i class="ti ti-list-details"></i><span class="et">Movimientos</span></button>
  <button class="mas" aria-label="Registrar" aria-haspopup="menu" aria-expanded="false" onclick="abrirBurbujas()"><i class="ti ti-plus"></i></button>
  <button data-v="metas" onclick="verVista('metas')"><i class="ti ti-target-arrow"></i><span class="et">Metas</span></button>
  <button data-v="mas" onclick="tocarMas()"><i class="ti ti-credit-card"></i><span class="et">Más</span></button>
</nav>
<div class="burb" id="burb" aria-hidden="true">
  <div class="burb-velo" onclick="cerrarBurbujas()"></div>
  <div class="burb-l" role="menu" aria-label="Qué quieres registrar">
    <button type="button" role="menuitem" class="burb-g" style="--i:0;--c:#D0613A" onclick="elegirBurbuja('Gasto')"><span class="burb-i"><i class="ti ti-minus"></i></span><span class="burb-t">Gasto</span></button>
    <button type="button" role="menuitem" class="burb-g" style="--i:1;--c:#2E9E5B" onclick="elegirBurbuja('Ingreso')"><span class="burb-i"><i class="ti ti-plus"></i></span><span class="burb-t">Ingreso</span></button>
    <button type="button" role="menuitem" style="--i:2;--c:#6A5BC7" onclick="elegirBurbuja('Ahorro')"><span class="burb-i"><i class="ti ti-pig-money"></i></span><span class="burb-t">Ahorro</span></button>
    <button type="button" role="menuitem" style="--i:3;--c:#1F5C99" onclick="elegirBurbuja('Pago')"><span class="burb-i"><i class="ti ti-credit-card"></i></span><span class="burb-t">Pago</span></button>
    <button type="button" role="menuitem" style="--i:4;--c:#078C7E" onclick="elegirBurbuja('Cuenta')"><span class="burb-i"><i class="ti ti-users"></i></span><span class="burb-t">Dividir cuenta</span></button>
  </div>
</div>
<div class="velo" id="velo" onclick="cerrarHoja()"></div>
<div class="hoja" id="hoja" role="dialog" aria-modal="true" aria-labelledby="hojaT">
  <div class="hoja-c"><b id="hojaT" tabindex="-1">Registrar</b><button aria-label="Cerrar" onclick="cerrarHoja()"><i class="ti ti-x"></i></button></div>
  <div class="hoja-cuerpo" id="hojaC"></div>
  <div class="hoja-pie" id="hojaP"></div>
</div>
<div class="toast" id="toast"></div>
<script>
var D = null, S = { vista: 'inicio', periodo: null, masTab: null, reg: null, ocupado: false, filtro: '', q: '' }, VERSION_PANEL = '__VERSION__', ACCION_PANEL = window.FA_ACCION || '__ACCION__', LOCAL = !!window.FA_LOCAL;
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
  navPastilla();
  if (D) pintarVista();
  window.scrollTo(0, 0);
}
// Barra estilo iOS (3.5): la pastilla se pone bajo el botón b (o el activo); con x, centrada en el dedo
function navPastilla(b, x){
  var nav = document.querySelector('.nav'), p = nav && nav.querySelector('.nav-p');
  if (!p) return;
  b = b || nav.querySelector('button.on[data-v]');
  if (!b || !b.offsetWidth) return;
  var w = b.offsetWidth, l = x == null ? b.offsetLeft : Math.max(0, Math.min(x - w / 2, nav.clientWidth - w));
  p.style.setProperty('--x', l + 'px'); p.style.setProperty('--y', b.offsetTop + 'px');
  p.style.setProperty('--w', w + 'px'); p.style.setProperty('--h', b.offsetHeight + 'px');
  if (!nav.classList.contains('lista')) requestAnimationFrame(function(){ nav.classList.add('lista'); });
}
// Arrastrar el dedo por la barra: la pastilla lo sigue, vibra al pasar por cada sección y al soltar abre esa
(function(){
  var nav = document.querySelector('.nav');
  if (!nav || !window.PointerEvent) return;
  var ini = null, arr = false, sobre = null, sinClic = false;
  function seccionEn(x){
    var mejor = null, d = 1e9;
    [].forEach.call(nav.querySelectorAll('button[data-v]'), function(b){ var r = b.getBoundingClientRect(), c = Math.abs(x - (r.left + r.width / 2)); if (c < d) { d = c; mejor = b; } });
    return mejor;
  }
  nav.addEventListener('pointerdown', function(e){
    if (e.button > 0 || e.target.closest('.mas') || document.documentElement.classList.contains('fondo-fijo')) return;   // con una ventana abierta, la barra no se arrastra
    ini = { x: e.clientX, id: e.pointerId }; arr = false;
  });
  nav.addEventListener('pointermove', function(e){
    if (!ini || e.pointerId !== ini.id) return;
    if (!arr) {
      if (Math.abs(e.clientX - ini.x) < 8) return;
      arr = true; sobre = seccionEn(ini.x); if (sobre) sobre.classList.add('sobre');
      try { nav.setPointerCapture(e.pointerId); } catch (er) {}
      nav.classList.add('arrastra');
    }
    var b = seccionEn(e.clientX), r = nav.getBoundingClientRect();
    if (b && b !== sobre) { if (sobre) sobre.classList.remove('sobre'); sobre = b; b.classList.add('sobre'); vibrar(); }
    navPastilla(b, e.clientX - r.left - nav.clientLeft);
  });
  function fin(e){
    if (!ini) return;
    var era = arr, v = sobre && sobre.getAttribute('data-v');
    ini = null; arr = false;
    if (!era) return;
    nav.classList.remove('arrastra'); if (sobre) sobre.classList.remove('sobre'); sobre = null;
    sinClic = true; setTimeout(function(){ sinClic = false; }, 400);   // el toque que termina el arrastre no es un clic
    if (e.type !== 'pointercancel' && v && v !== S.vista) verVista(v); else navPastilla();
  }
  nav.addEventListener('pointerup', fin); nav.addEventListener('pointercancel', fin);
  nav.addEventListener('click', function(e){ if (sinClic) { sinClic = false; e.stopPropagation(); e.preventDefault(); } }, true);
  if (window.ResizeObserver) new ResizeObserver(function(){ navPastilla(); }).observe(nav); else window.addEventListener('resize', function(){ navPastilla(); });
  requestAnimationFrame(function(){ navPastilla(); });
})();
function pintarVista(){ ({ inicio: pintarInicio, movs: pintarMovs, metas: pintarMetas, mas: pintarMas })[S.vista](); }

/* ── inicio ── */
function pintarInicio(){
  var r = D.resumen, h = '';
  if (S.periodo === D.actual) h += htmlCola();
  h += '<div class="rejilla"><div>';
  h += '<div class="card hero"><small>Disponible · ' + esc(r.periodo.nombre) + '</small><div class="total num">' + clp(r.disponible) + '</div>'
    + '<div class="tres"><div><span>Ingresos</span><b class="num">' + clp(r.ingresos) + '</b></div><div><span>Gastos</span><b class="num">' + clp(r.gastos) + '</b></div><div><span>Ahorro</span><b class="num">' + clp(r.ahorro) + '</b></div></div>' + htmlRacha() + '</div>';
  h += htmlCierreIni() + htmlConsejo();
  if (r.presupuestoTotal > 0) {
    var usado = r.presupuestoTotal - r.presupuestoRestante, pct = Math.min(100, Math.round(usado * 100 / r.presupuestoTotal));
    h += '<div class="card pres"><div class="pres-t"><span>Presupuesto del mes</span><span>Te quedan <b class="num">' + clp(r.presupuestoRestante) + '</b> de <span class="num">' + clp(r.presupuestoTotal) + '</span></span></div><div class="barra"><i class="' + (pct >= 100 ? 'excedido' : (pct >= D.config.alertaPct ? 'alerta' : 'okv')) + '" style="width:' + pct + '%"></i></div>' + porDia(r) + '</div>';
  }
  if (D.proyeccion && S.periodo === D.actual && D.proyeccion.dias > 0) h += htmlProyeccion(D.proyeccion);
  h += htmlCalIni();
  if (r.alertas.length) h += '<div class="alertas">' + r.alertas.map(function(a){ return '<div class="alerta-f ' + a.estado + '"><i class="ti ' + (a.estado === 'excedido' ? 'ti-alert-octagon' : 'ti-alert-triangle') + '"></i><span><b>' + esc(a.nombre) + '</b> · ' + (a.estado === 'excedido' ? 'te pasaste por ' + clp(-a.restante) : (a.restante <= 0 ? 'usaste todo el presupuesto' : 'vas en el ' + a.pct + ' %, te quedan ' + clp(a.restante))) + '</span></div>'; }).join('') + '</div>';
  h += htmlExplica() + htmlSuscripciones() + htmlCompartidas() + htmlPatIni();
  if (D.ejemplo) h += '<div class="ejemplo"><i class="ti ti-flask" aria-hidden="true"></i><span>Estás viendo <b>datos de ejemplo</b>.</span><button onclick="verMas(4); ajEjemplo()">Borrar</button></div>';
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
// Días seguidos anotando (3.4): solo en el mes en curso y desde 3 días, sin presionar
function htmlRacha(){
  var r = D.racha; if (!r || r.dias < 3 || S.periodo !== D.actual) return '';
  return '<p class="racha"><i class="ti ti-flame" aria-hidden="true"></i><span>' + r.dias + ' días seguidos anotando' + (r.hoy ? '' : ' · anota algo hoy para seguir') + '</span></p>';
}
// Lo que cambió frente a los meses anteriores, en palabras (3.4). Tocar = ver esa categoría
function htmlExplica(){
  var xs = D.explicaciones || []; if (!xs.length) return '';
  return '<h2>Lo que cambió<button onclick="verComparar()"><i class="ti ti-report-analytics"></i> Analizar</button></h2><div class="card lista explica">' + xs.map(function(x){
    var c = cat(x.categoria), t;
    if (x.promedio > 0) t = Math.abs(x.pct) + ' % ' + (x.dif > 0 ? 'más' : 'menos') + ' que tu promedio' + (x.alDia ? ' a esta altura del mes' : '') + ' (' + clp(x.promedio) + ')';
    else t = (x.meses === 1 ? 'El mes anterior' : 'Los ' + x.meses + ' meses anteriores') + ' no gastaste aquí';
    if (x.meses === 1 && x.promedio > 0) t = t.replace('tu promedio', 'el mes anterior');
    return '<button class="fila toca" onclick="verCategoria(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(x.categoria) + '">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(x.categoria) + '</b><small class="cmp ' + (x.dif > 0 ? 'sube' : 'baja') + '">' + esc(t) + '</small></span><span class="v num">' + clp(x.actual) + '</span></button>';
  }).join('') + '</div>';
}
// Cobros que se repiten cada mes y no están en Fijos (3.4): pasarlos a Fijos o descartarlos
function htmlSuscripciones(){
  var xs = D.suscripciones || []; if (!xs.length || S.periodo !== D.actual) return '';
  return '<h2>¿Son gastos fijos?</h2><div class="card lista sus">' + xs.map(function(x, k){
    var c = cat(x.categoria);
    return '<div class="fila">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(x.nota || x.categoria) + '</b><small>' + clp(x.monto) + ' · se repite hace ' + x.veces + ' meses, cerca del día ' + x.dia + '</small><span class="sus-b"><button onclick="suscripcionAFijo(' + k + ')">Pasar a fijos</button><button onclick="noEsFijo(' + k + ', this)">No es fijo</button></span></span></div>';
  }).join('') + '</div>';
}
function suscripcionAFijo(k){ var x = (D.suscripciones || [])[k]; if (x) formFijo('', { nombre: x.nota || x.categoria, monto: x.monto, dia: x.dia, categoria: x.categoria, medio: x.medio }); }
function noEsFijo(k, b){ var x = (D.suscripciones || [])[k]; if (!x) return; api('descartarSuscripcion', [x.clave], function(r){ if (!r.ok) { toast(r.error); return; } pintar(r.datos); toast('Listo, no lo vuelvo a sugerir'); }, b); }
// Boleta o factura electrónica (3.4, solo en la app del teléfono): el lector (FA_escanear) devuelve monto, fecha y comercio
function escanearBoleta(){
  if (!window.FA_escanear) return;
  window.FA_escanear(function(b){
    if (!S.reg) return;
    if (!b || !b.ok) { toast((b && b.error) || 'No pude leer la boleta.'); return; }
    S.reg.monto = String(b.monto); S.reg.montoAuto = false;
    if (b.fecha && b.fecha <= D.hoy) S.reg.fecha = b.fecha;
    if (b.nota && !S.reg.nota) S.reg.nota = b.nota;
    S.reg.det = true; pintarRegistro();
    toast('Boleta leída: ' + clp(b.monto) + '. Elige la categoría.');
  });
}
// Vibración corta al guardar (3.4): la app nativa usa el motor del teléfono (FA_vibrar); el navegador, si puede
function vibrar(){ try { if (window.FA_vibrar) window.FA_vibrar(); else if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} }
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
  var h = '<h2>Últimos 6 meses<button onclick="verComparar()"><i class="ti ti-arrows-diff"></i> Comparar</button></h2><div class="card graf"><p class="graf-t">Gastos de cada mes' + (pres > 0 ? ' · <span class="graf-l"></span>presupuesto ' + clpCorto(pres) : '') + ' · toca uno para verlo</p><div class="graf-a">';
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
  if (!el('qMov')) el('v-movs').innerHTML = '<label class="buscar-m"><i class="ti ti-search" aria-hidden="true"></i><input id="qMov" type="search" class="inp" placeholder="Buscar, o pregunta: ¿cuánto gasté en Uber?" aria-label="Buscar en el mes, o hacer una pregunta" oninput="buscarMovs(this.value)" onkeydown="if (event.key === &#39;Enter&#39;) { event.preventDefault(); preguntarUI(); }" enterkeyhint="search" autocomplete="off"></label><div id="movCola"></div><div id="movL"></div>';
  el('movCola').innerHTML = S.periodo === D.actual ? htmlCola() : '';
  S.selVisibles = [];
  var q = sinTildes(S.q).trim(), h = htmlPregunta(), dia = '', lista = D.movimientos;
  if (esPregunta(S.q || '')) q = '';
  if (q) {
    var qn = q.replace(/[^0-9]/g, '');
    lista = lista.filter(function(m){ return sinTildes([nombreMov(m), m.categoria, m.medio, m.nota, m.tipo, m.etiqueta].join(' ')).indexOf(q) >= 0 || (qn.length >= 3 && String(m.monto).indexOf(qn) >= 0); });
  }
  if (S.filtro) {
    var c = cat(S.filtro), p = null; D.resumen.presupuesto.forEach(function(x){ if (x.nombre === S.filtro) p = x; });
    lista = D.movimientos.filter(function(m){ return m.categoria === S.filtro; });
    var cuotas = (D.cuotasPeriodo || []).filter(function(m){ return m.categoria === S.filtro; });
    h += '<div class="card filtro">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(S.filtro) + '</b><small>' + esc(D.resumen.periodo.nombre) + ' · ' + clp(p ? p.gastado : 0) + (p && p.presupuesto > 0 ? ' de ' + clp(p.presupuesto) : '') + '</small></span><button type="button" class="filtro-x" onclick="quitarFiltro()" aria-label="Ver todos los movimientos"><i class="ti ti-x"></i></button></div>';
    if (cuotas.length) h += '<div class="dia">Cuotas de compras anteriores</div><div class="card lista">' + cuotas.map(function(m){ return '<button class="fila toca" onclick="toast(&#39;Esta compra es de un mes anterior: edítala desde ese mes.&#39;)">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(m.nota || m.categoria) + '</b><small>' + esc(m.medio) + ' · cuota ' + m.cuota + ' de ' + m.cuotas + ' · ' + fechaCorta(m.fecha) + '</small></span><span class="v num neg">−' + clp(m.monto) + '</span></button>'; }).join('') + '</div>';
    if (!lista.length) { el('movL').innerHTML = h + (cuotas.length ? '' : '<div class="card vacio" style="margin-top:12px"><i class="ti ti-receipt"></i>' + (q ? 'Nada coincide con «' + esc(S.q.trim()) + '» en ' + esc(S.filtro) + '.' : 'No hay movimientos de ' + esc(S.filtro) + ' este mes.') + '</div>'); return; }
  }
  if (!lista.length && q) { el('movL').innerHTML = h + '<div class="card vacio" style="margin-top:12px"><i class="ti ti-search"></i>Nada coincide con «' + esc(S.q.trim()) + '» en ' + esc(D.resumen.periodo.nombre) + '.</div>'; return; }
  if (!lista.length) { el('movL').innerHTML = h + '<div class="card vacio" style="margin-top:12px"><i class="ti ti-receipt"></i>No hay movimientos en ' + esc(D.resumen.periodo.nombre) + '.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="abrirRegistro()"><i class="ti ti-plus"></i>Registrar</button></div></div>'; return; }
  var grupos = [];
  S.selVisibles = lista.map(function(m){ return m.id; });
  h = htmlSel(lista.length) + h;
  lista.forEach(function(m){ if (m.fecha !== dia) { dia = m.fecha; grupos.push({ dia: dia, items: [] }); } grupos[grupos.length - 1].items.push(m); });
  grupos.forEach(function(g){
    var gd = g.items.reduce(function(a, m){ return a + (m.tipo === 'Gasto' || m.tipo === 'Pago deuda' ? Number(m.monto) || 0 : 0); }, 0);
    h += '<div class="dia"><span>' + esc(fechaTexto(g.dia)) + '</span>' + (gd > 0 ? '<span class="num">Gastaste ' + clp(gd) + '</span>' : '') + '</div><div class="card lista">' + g.items.map(function(m){
      var c = cat(m.categoria), ic = m.tipo === 'Ahorro' || m.tipo === 'Retiro de meta' ? ['ti-pig-money', '#6A5BC7'] : (m.tipo === 'Pago tarjeta' ? ['ti-credit-card', '#3E546D'] : [c.icono, c.color]);
      var signo = m.tipo === 'Ingreso' || m.tipo === 'Retiro de meta' ? '+' : '−', clase = m.tipo === 'Ingreso' ? 'pos' : 'neg';
      var sub = [m.medio, m.cuotas > 1 ? m.cuotas + ' cuotas' : '', m.moneda === 'USD' ? usdTxt(m.original) : '', m.etiqueta, m.nota].filter(Boolean).join(' · ');
      var marcado = S.sel && S.sel[m.id];
      return '<button class="fila toca' + (S.sel ? ' sel-f' + (marcado ? ' on' : '') : '') + '" onclick="' + (S.sel ? 'selMov' : 'editarMov') + '(&#39;' + m.id + '&#39;)"' + (S.sel ? ' aria-pressed="' + !!marcado + '"' : '') + '>' + (S.sel ? '<span class="sel-c" aria-hidden="true"><i class="ti ti-check"></i></span>' : '') + ico(ic[0], ic[1]) + '<span class="tx"><b>' + esc(nombreMov(m)) + '</b><small>' + esc(sub || m.tipo) + '</small></span><span class="v num ' + clase + '">' + signo + clp(m.monto) + '</span></button>';
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
function cambiarMas(i){ S.masTab = i; pintarMas(); window.scrollTo(0, 0); }
function tocarMas(){ if (S.vista === 'mas') { S.masTab = null; pintarMas(); window.scrollTo(0, 0); return; } verVista('mas'); }
function pintarMas(){
  // Más es un menú (3.7): cada sección se abre con «‹ Más» para volver
  if (S.masTab === null || S.masTab === undefined || !TITULOS_MAS[S.masTab]) { S.masTab = null; el('titulo').textContent = 'Más'; el('v-mas').innerHTML = menuMas(); return; }
  el('titulo').textContent = TITULOS_MAS[S.masTab];
  el('v-mas').innerHTML = '<button class="volver" onclick="cambiarMas(null)"><i class="ti ti-chevron-left" aria-hidden="true"></i>Más</button>'
    + [vistaTarjetas, vistaFijos, vistaPresupuesto, vistaCuentas, vistaAjustes, vistaPatrimonio, vistaCalendario, vistaViajes, vistaImportar][S.masTab]();
}
var TITULOS_MAS = ['Tarjetas', 'Fijos', 'Presupuesto', 'Cuentas', 'Ajustes', 'Patrimonio', 'Calendario', 'Viajes', 'Importar'];   // cortos: caben junto al selector del mes
function menuMas(){
  var C = D.compartidas || {}, r = D.resumen, fx = D.fijos || [], nt = D.tarjetas.length, nd = D.deudas.length;
  var fila = function(i, icono, color, titulo, sub){ return '<button class="fila toca menu-f" onclick="cambiarMas(' + i + ')">' + ico(icono, color) + '<span class="tx"><b>' + titulo + '</b><small>' + sub + '</small></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>'; };
  var junto = function(l){ return l.filter(function(x){ return x; }).join(' · '); };
  return '<div class="card lista menu menu-1">'
    + fila(0, 'ti-credit-card', '#1F5C99', 'Tarjetas y deudas', nt || nd ? junto([nt ? nt + (nt === 1 ? ' tarjeta' : ' tarjetas') : '', nd ? nd + (nd === 1 ? ' deuda' : ' deudas') : '']) : 'Cupo usado, cuotas y créditos')
    + fila(1, 'ti-repeat', '#C47A1C', 'Gastos e ingresos fijos', fx.length ? fx.filter(function(x){ return x.registrado; }).length + ' de ' + fx.length + ' listos este mes' : 'Arriendo, cuentas, sueldo')
    + fila(2, 'ti-chart-pie', '#2E9E5B', 'Presupuesto y categorías', r.presupuestoTotal > 0 ? 'Te quedan ' + clp(r.presupuestoRestante) + ' de ' + clp(r.presupuestoTotal) : 'Cuánto gastar en cada categoría')
    + fila(3, 'ti-users', '#078C7E', 'Cuentas compartidas', C.meDeben || C.debo ? junto([C.meDeben ? 'Te deben ' + clp(C.meDeben) : '', C.debo ? 'Debes ' + clp(C.debo) : '']) : 'Lo que te deben, lo que debes y gastos por rendir')
    + '</div><div class="card lista menu">'
    + fila(5, 'ti-wallet', '#2E9E5B', 'Patrimonio', D.patrimonio && D.patrimonio.hay ? 'Patrimonio neto ' + clp(D.patrimonio.neto) + (D.fondo ? ' · fondo ' + mesesTxt(D.fondo.meses) : '') : 'Cuentas, inversiones y fondo de emergencia')
    + fila(6, 'ti-calendar-dollar', '#C47A1C', 'Calendario de pagos', D.calendario && D.calendario.corto ? 'Ojo: el ' + fechaCorta(D.calendario.corto.fecha) + ' te quedarías corto' : 'Qué pagas y recibes cada día del mes')
    + fila(7, 'ti-luggage', '#078C7E', 'Viajes y proyectos', (D.etiquetas || []).length ? D.etiquetas.length + ((D.etiquetas || []).length === 1 ? ' viaje o proyecto' : ' viajes o proyectos') : 'Cuánto costó un viaje o una remodelación')
    + fila(8, 'ti-file-import', '#6A5BC7', 'Importar cartola', 'Trae los movimientos del banco (Excel o CSV)')
    + '</div><div class="card lista menu">'
    + fila(4, 'ti-settings', '#3E546D', 'Ajustes', LOCAL ? 'Tu mes, avisos, clave y respaldos' : 'Tu mes, correos y atajo')
    + '</div><p class="version">Mis Finanzas ' + esc(D.version) + ' · Ambilor.Lab</p>';
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
function cargarEjemplo(b){ api('cargarEjemplo', [], function(r){ if (!r.ok) { toast(r.error); return; } cerrarHoja(); pintar(r.datos); verVista('inicio'); toast('Listo: 6 meses de datos de ejemplo'); }, b); }
function borrarEjemplo(b){
  if (!b.getAttribute('data-ok')) { b.setAttribute('data-ok', '1'); b.innerHTML = '<i class="ti ti-trash"></i>¿Borrar todo lo de ejemplo?'; return; }
  api('borrarEjemplo', [], function(r){ if (!r.ok) { toast(r.error); return; } cerrarHoja(); pintar(r.datos); toast('Listo: se borraron los datos de ejemplo'); }, b);
}
function elegirCat(k, b){ S.cat[k] = b.getAttribute('data-v'); [].forEach.call(b.parentNode.children, function(x){ x.classList.toggle('on', x === b); }); }
// Ajustes (3.9): filas cortas con su estado, al estilo de los ajustes del teléfono; cada una abre una ventana breve
function filaAj(icono, color, titulo, sub, accion, aviso){ return '<button class="fila toca menu-f" onclick="' + accion + '">' + ico(icono, color) + '<span class="tx"><b>' + titulo + '</b><small' + (aviso ? ' class="rojo"' : '') + '>' + esc(sub) + '</small></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>'; }
var LETRAS = ['Normal', 'Grande', 'Muy grande'];
function vistaAjustes(){
  var c = D.config, h = '<p class="aj-t">General</p><div class="card lista menu">'
    + filaAj('ti-calendar-month', '#1F5C99', 'Tu mes', 'Parte el día ' + c.inicioMes + ' · aviso al ' + c.alertaPct + ' %', 'ajTuMes()')
    + filaAj('ti-coin', '#C47A1C', 'UF y dólar', c.valorUF || c.valorDolar ? 'Escritos a mano' : 'Se actualizan solos', 'ajValores()')
    + filaAj('ti-lifebuoy', '#2E9E5B', 'Fondo de emergencia', c.fondoMeses ? 'Meta: ' + mesesTxt(c.fondoMeses) + ' de gastos' : 'No se muestra', 'ajFondo()')
    + filaAj('ti-wand', '#D0613A', 'Clasificación automática', (D.reglasCat || []).length ? (D.reglasCat.length === 1 ? '1 regla tuya' : D.reglasCat.length + ' reglas tuyas') + ' y diccionario' : 'Por descripción: McDonald' + "'" + 's → Comida fuera', 'ajClasif()')
    + filaAj('ti-users', '#078C7E', 'Propina sugerida', c.propinaPct + ' %', 'ajPropina()')
    + filaAj('ti-palette', '#6A5BC7', 'Apariencia', TEMAS[temaIdx()] + ' · letra ' + LETRAS[Number(leerLocal('letra')) || 0].toLowerCase(), 'ajLetra()')
    + '</div>';
  if (LOCAL) h += FALocal.ajustes();
  else h += '<p class="aj-t">Correos y atajo</p><div class="card lista menu">'
    + filaAj('ti-mail', '#B5405F', 'Correos', c.correoResumen ? 'Resumen del mes' + (c.recordatorioHora ? ' y recordatorio' : '') : 'Apagados', 'ajCorreos()')
    + (D.urlRegistrar ? filaAj('ti-bolt', '#C47A1C', 'Atajo para registrar', 'Un ícono que abre el registro', 'ajAtajo()') : '') + '</div>';
  var sinDatos = !D.movimientos.length && !(D.historial || []).some(function(x){ return x.gastos > 0; });
  h += '<p class="aj-t">Datos</p><div class="card lista menu">'
    + (D.ejemplo || sinDatos ? filaAj('ti-flask', '#6B7A8F', 'Datos de ejemplo', D.ejemplo ? 'Estás viéndolos · toca para borrarlos' : 'Explora la app con 6 meses de ejemplo', 'ajEjemplo()') : '')
    + filaAj('ti-trash', '#B5405F', 'Borrar datos', 'Todos los movimientos o empezar de cero', 'ajBorrar()') + '</div>';
  return h + '<p class="version">Mis Finanzas ' + esc(D.version) + (LOCAL ? ' · datos en este teléfono' : '') + ' · Ambilor.Lab</p>';
}
function ajTuMes(){ var c = D.config; formulario('Tu mes', [['nombre', 'Tu nombre', c.nombre, 'text'], ['inicioMes', 'Día en que parte tu mes (ej: el de sueldo)', c.inicioMes, 'numero'], ['alertaPct', 'Avisarme al llegar al (% del presupuesto)', c.alertaPct, 'numero'], ['diasAviso', 'Mostrar pagos de los próximos (días)', c.diasAviso, 'numero']], 'guardarConfig', {}, ''); }
function ajValores(){ var c = D.config; formulario('UF y dólar', [['valorUF', 'UF (0 = se trae sola cada día)', c.valorUF || 0, 'numero'], ['valorDolar', 'Dólar (0 = se trae solo cada día)', c.valorDolar || 0, 'numero']], 'guardarConfig', {}, ''); }
function ajFondo(){ formulario('Fondo de emergencia', [['fondoMeses', 'Meses de gastos que quieres cubrir (0 = no mostrar)', D.config.fondoMeses, 'numero']], 'guardarConfig', {}, ''); }
function ajPropina(){ formulario('Propina sugerida', [['propinaPct', 'Al dividir una cuenta (%)', D.config.propinaPct, 'numero']], 'guardarConfig', {}, ''); }
function ajLetra(){ abrirHoja('Apariencia', '<div class="etq" style="margin-top:0">Tema</div>' + seg(TEMAS, temaIdx(), 'elegirTema') + '<p class="ayuda" style="margin-top:8px">Automático sigue el modo claro u oscuro del teléfono.</p><div class="etq">Tamaño de la letra</div>' + seg(LETRAS, Number(leerLocal('letra')) || 0, 'elegirLetra'), '<button class="btn btn-p" onclick="cerrarHoja()"><i class="ti ti-check"></i>Listo</button>'); }
function ajCorreos(){
  var c = D.config;
  abrirHoja('Correos', campoTexto('aj-correo', 'Tu correo', c.correoResumen, 'email')
    + campoTexto('aj-rec', 'Recordarme anotar (solo los días sin registros)', String(c.recordatorioHora || 0), 'select', [{ v: '0', t: 'No' }].concat([9, 13, 18, 20, 21, 22].concat(c.recordatorioHora && [9, 13, 18, 20, 21, 22].indexOf(c.recordatorioHora) < 0 ? [c.recordatorioHora] : []).map(function(n){ return { v: String(n), t: 'Entre las ' + n + ':00 y las ' + (n + 1) + ':00' }; })))
    + '<p class="ayuda">Al cerrar cada mes te llega el resumen con PDF. Sin correo, no se envía nada.</p><div class="error" id="aj-correo-err"></div>'
    + (c.correoResumen ? '<button class="btn btn-bloque" onclick="enviarResumenAhora(this)"><i class="ti ti-send"></i>Enviarme ahora el de ' + esc(D.resumen.periodo.nombre) + '</button>' : ''),
    '<button class="btn btn-p" onclick="guardarCorreo(this)"><i class="ti ti-device-floppy"></i>Guardar</button>');
}
function ajAtajo(){ abrirHoja('Atajo para registrar', '<ol class="pasos"><li>Abre el atajo con el botón de abajo.</li><li>Agrégalo a tu pantalla de inicio (iPhone: Compartir → Agregar a inicio · Android: ⋮ → Agregar a la pantalla principal).</li></ol>', '<a class="btn btn-p" href="' + esc(D.urlRegistrar) + '" target="_top"><i class="ti ti-bolt"></i>Abrir el atajo</a>'); }
function ajEjemplo(){
  if (D.ejemplo) abrirHoja('Datos de ejemplo', '<p class="ayuda">Al borrarlos quedan solo tus datos y los presupuestos vuelven a como estaban.</p>', '<button class="btn btn-peligro" onclick="borrarEjemplo(this)"><i class="ti ti-trash"></i>Borrar datos de ejemplo</button>');
  else abrirHoja('Datos de ejemplo', '<p class="ayuda">Carga 6 meses de ejemplo para explorar la app. Se borran con un toque.</p>', '<button class="btn btn-p" onclick="cargarEjemplo(this)"><i class="ti ti-flask"></i>Probar con datos de ejemplo</button>');
}

/* consejos en Inicio (3.9): de a uno, lo que aún no está configurado; «Configurar» lleva directo y × lo descarta */
function consejos(){
  var l = [];
  if (!(D.resumen.presupuestoTotal > 0)) l.push({ id: 'presupuesto', icono: 'ti-chart-pie', color: '#2E9E5B', t: 'Define cuánto gastar al mes', s: 'Te aviso antes de pasarte y te digo cuánto puedes gastar por día.', fn: function(){ verMas(2); } });
  if (LOCAL && window.FALocal && FALocal.consejos) l = l.concat(FALocal.consejos());
  if (!(D.fijos || []).length) l.push({ id: 'fijos', icono: 'ti-repeat', color: '#C47A1C', t: 'Agrega tus gastos fijos', s: 'Arriendo, cuentas, sueldo: te aviso cuándo toca.', fn: function(){ verMas(1); } });
  if (D.patrimonio && !D.patrimonio.hay) l.push({ id: 'patrimonio', icono: 'ti-wallet', color: '#2E9E5B', t: 'Suma tus cuentas y ahorros', s: 'Ve tu patrimonio y tu fondo de emergencia.', fn: function(){ verMas(5); } });
  l.push({ id: 'cartola', icono: 'ti-file-import', color: '#6A5BC7', t: 'Trae tus movimientos del banco', s: 'Importa la cartola en Excel o CSV.', fn: function(){ verMas(8); }, fin: true });
  return l.filter(function(x){ return leerLocal('consejoNo_' + x.id) !== '1'; });
}
function htmlConsejo(){
  if (S.periodo !== D.actual || D.ejemplo || !D.movimientos.length) return '';
  var x = consejos()[0]; if (!x) return '';
  return '<div class="card consejo"><div class="consejo-c">' + ico(x.icono, x.color) + '<span class="tx"><small class="consejo-k"><i class="ti ti-bulb" aria-hidden="true"></i>Consejo</small><b>' + esc(x.t) + '</b><small>' + esc(x.s) + '</small></span>'
    + '<button class="consejo-x" onclick="consejoNo(&#39;' + x.id + '&#39;)" aria-label="No me interesa"><i class="ti ti-x"></i></button></div>'
    + '<button class="btn btn-p consejo-b" onclick="consejoIr(&#39;' + x.id + '&#39;)">Configurar</button></div>';
}
function consejoNo(id){ guardarLocal('consejoNo_' + id, '1'); pintarInicio(); }
function consejoIr(id){ var x = null; consejos().forEach(function(c){ if (c.id === id) x = c; }); if (!x) return; if (x.fin) guardarLocal('consejoNo_' + id, '1'); x.fn(); if (x.fin && S.vista === 'inicio') pintarInicio(); }

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
    cerrarHoja(); pintar(r.datos);
    var c = r.datos.config;
    toast(r.aviso ? r.aviso : (c.correoResumen ? 'Listo: el resumen llegará a ' + c.correoResumen + (c.recordatorioHora ? ' y el recordatorio, entre las ' + c.recordatorioHora + ':00 y las ' + (c.recordatorioHora + 1) + ':00' : '') : 'Listo: ya no se enviarán correos'));
  }, b);
}
function enviarResumenAhora(b){
  api('enviarResumen', [S.periodo], function(r){ if (!r.ok) { el('aj-correo-err').textContent = r.error; return; } toast('Enviado a ' + r.correo + ': resumen de ' + r.periodo); }, b);
}

/* ── hoja inferior ── */
// el pie se vuelve a mostrar: el registro rápido lo oculta (3.8: antes, tras anotar, «Nueva meta» quedaba sin Guardar)
function abrirHoja(titulo, cuerpo, pie){ el('hojaT').textContent = titulo; el('hojaC').innerHTML = cuerpo; el('hojaP').innerHTML = pie; el('hojaP').style.display = ''; mostrarHoja(); el('hojaC').scrollTop = 0; }
// al abrir, el foco del teclado (y del lector de pantalla) entra a la hoja; al cerrar, vuelve a donde estaba
// Con una ventana o las burbujas abiertas, lo de atrás queda inactivo (3.7): no se toca, no se enfoca con el
// teclado ni lo lee el lector de pantalla, y la página no se desplaza. Con las burbujas, solo queda el × del +.
function bloquearFondo(si, dejarMas){
  var h = document.documentElement;
  [].forEach.call(document.querySelectorAll('main, .cab, .nav button'), function(x){ if (si && !(dejarMas && x.classList.contains('mas'))) x.setAttribute('inert', ''); else x.removeAttribute('inert'); });
  if (si === h.classList.contains('fondo-fijo')) return;
  if (si) { S.scrollY = window.scrollY || 0; document.body.style.top = -S.scrollY + 'px'; h.classList.add('fondo-fijo'); }
  else { h.classList.remove('fondo-fijo'); document.body.style.top = ''; window.scrollTo(0, S.scrollY || 0); }
}
function mostrarHoja(){ if (!el('hoja').classList.contains('on')) S.foco = document.activeElement; bloquearFondo(true); el('velo').classList.add('on'); el('hoja').classList.add('on'); try { el('hojaT').focus({ preventScroll: true }); } catch (e) {} }
function cerrarHoja(){ var abierta = el('hoja').classList.contains('on'); el('velo').classList.remove('on'); el('hoja').classList.remove('on'); S.reg = null; if (abierta) bloquearFondo(false); if (abierta && S.foco && S.foco.focus && document.body.contains(S.foco)) { try { S.foco.focus({ preventScroll: true }); } catch (e) {} } S.foco = null; }
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { if (!cerrarBurbujas()) cerrarHoja(); return; }
  // registro abierto: números, borrar y Enter desde el teclado del computador
  if (!S.reg || !el('hojaC').querySelector('#montoV') || e.metaKey || e.ctrlKey || e.altKey) return;
  var t = e.target && e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (/^[0-9]$/.test(e.key)) { tecla(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { tecla('borrar'); e.preventDefault(); }
  else if (e.key === 'Enter') { var tr = S.reg.tipo; if ((tr === 'Gasto' || tr === 'Ingreso') && !S.reg.categoria) el('regErr').textContent = 'Toca una categoría para guardar.'; else if (tr === 'Ahorro' && !S.reg.meta) el('regErr').textContent = 'Toca una meta para guardar.'; else if (tr === 'Pago' && !S.reg.pago) el('regErr').textContent = 'Toca qué pagas para guardar.'; else guardarRegistro(); e.preventDefault(); }
});

/* ── registro rápido: monto, categoría y guardar ── */
var TIPOS_REG = ['Gasto','Ingreso','Ahorro','Pago'];
function abrirRegistro(pre){
  pre = pre || {};
  var tipo = pre.tipo || 'Gasto', retiro = false;
  if (tipo === 'Retiro de meta') { tipo = 'Ahorro'; retiro = true; }
  if (tipo === 'Pago tarjeta' || tipo === 'Pago deuda') tipo = 'Pago';
  S.reg = { montoAuto: !!pre.monto && !pre.id && !pre.fijo, id: pre.id || '', tipo: tipo, retiro: retiro, monto: pre.monto ? String(pre.monto) : '', fijo: pre.fijo || '', categoria: pre.categoria || (pre.id ? '' : leerLocal('cat_' + tipo) || ''), medio: pre.medio || leerLocal('medio') || 'Débito', cuotas: pre.cuotas || 1, meta: pre.meta || '', pago: pre.pago || null, fecha: pre.fecha || D.hoy, nota: pre.nota || '', etiqueta: pre.etiqueta || '', moneda: pre.moneda === 'USD' ? 'USD' : '', original: pre.original ? String(pre.original).replace('.', ',') : '', det: !!pre.det, revision: !!pre.revision, sugerida: pre.sugerida || '', pista: pre.sugerida ? 'Sugerida: ' + pre.sugerida + '. Toca una categoría para guardar.' : '' };
  if (D.medios.indexOf(S.reg.medio) < 0) S.reg.medio = 'Débito';
  pintarRegistro();
  mostrarHoja();
  // registro nuevo sin monto: el teclado numérico del teléfono se abre al tiro
  if (!S.reg.id && !S.reg.monto) { var m = el('montoV'); if (m) try { m.focus({ preventScroll: true }); } catch (e) {} }
}
// Registro (3.7): los 4 tipos se ven y se usan igual. Uno nuevo = monto + tocar la opción (categoría,
// meta o lo que pagas): eso guarda. Fecha, nota y medio van plegados en una línea. Editar muestra «Guardar».
function pintarRegistro(){
  var r = S.reg, h = '', rapido = !r.id, titulo = '', cuerpo = '', hay = true;
  if (r.id) h += seg(TIPOS_REG, TIPOS_REG.indexOf(r.tipo), 'cambiarTipo');
  var fj = r.fijo ? buscar(D.fijos, r.fijo) : null;
  if (fj && fj.id) h += '<div style="text-align:center"><span class="fijo-et"><i class="ti ti-repeat"></i>Fijo: ' + esc(fj.nombre) + '</span></div>';
  // monto con el teclado numérico del teléfono (3.7): solo números, se muestra con $ y puntos de miles
  h += '<input class="monto num' + (r.monto ? '' : ' vacio-m') + '" id="montoV" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done" aria-label="Monto" placeholder="$0" value="' + (r.monto ? clp(r.monto) : '') + '" oninput="montoEscrito(this)" onkeydown="if (event.key === &#39;Enter&#39;) { event.preventDefault(); var d = el(&#39;regDesc&#39;); if (d) d.focus(); else this.blur(); }">';
  if (window.FA_escanear && !r.id && r.tipo === 'Gasto' && !r.fijo) h += '<div style="text-align:center"><button type="button" class="scan-b" onclick="escanearBoleta()"><i class="ti ti-scan" aria-hidden="true"></i>Escanear boleta</button></div>';
  var rep = rapido && (r.tipo === 'Gasto' || r.tipo === 'Ingreso') && !r.monto && !r.fijo ? (D.recientes || []).filter(function(x){ return x.tipo === r.tipo; }) : [];
  if (rep.length) h += '<div class="rep" aria-label="Repetir lo habitual"><span class="rep-t">Repetir</span>' + rep.map(function(x){ var c = cat(x.categoria); return '<button type="button" class="rep-b" onclick="repetir(' + (D.recientes.indexOf(x)) + ')"><span class="rep-i" style="background:' + esc(c.color) + '"><i class="ti ' + esc(c.icono) + '"></i></span>' + esc(x.nota || x.categoria) + ' <b class="num">' + clp(x.monto) + '</b></button>'; }).join('') + '</div>';
  if (rapido && !r.fijo && (r.tipo === 'Gasto' || r.tipo === 'Ingreso')) {
    if (r.nota && !r.sugerida && !r.revision) r.sugerida = sugerirDesc(r.nota, r.tipo);
    h += '<input class="inp reg-desc" id="regDesc" maxlength="120" autocomplete="off" enterkeyhint="done" aria-label="En qué (descripción)" placeholder="¿En qué? Ej: McDonald' + "'" + 's, Uber, Lider" value="' + esc(r.nota) + '" oninput="descEscrita(this)" onkeydown="if (event.key === &#39;Enter&#39;) { event.preventDefault(); guardarSugerida(); }">';
    h += '<div id="regSugB">' + htmlSugerida(r) + '</div>';
  }
  if (r.tipo === 'Gasto' || r.tipo === 'Ingreso') {
    // primero la última usada y luego las más usadas en los últimos 90 días
    var fr = (D.frecuentes && D.frecuentes[r.tipo]) || [], ult = leerLocal('cat_' + r.tipo);
    var cs = D.categorias.filter(function(c){ return c.tipo === r.tipo && c.nombre !== 'Deudas'; }).map(function(c, i){ return { c: c, k: c.nombre === r.sugerida ? -2 : (c.nombre === ult ? -1 : (fr.indexOf(c.nombre) < 0 ? 100 + i : fr.indexOf(c.nombre))) }; }).sort(function(x, y){ return x.k - y.k; }).map(function(x){ return x.c; });
    if (rapido || !r.categoria || !cs.some(function(c){ return c.nombre === r.categoria; })) r.categoria = '';
    titulo = rapido ? 'Toca la categoría para guardar' : 'Categoría';
    cuerpo = '<div class="cats" id="regCats">' + cs.map(function(c){ return '<button type="button" class="cat' + (c.nombre === r.categoria ? ' on' : '') + (c.nombre === r.sugerida ? ' sug' : '') + '" onclick="tocarCategoria(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(c.nombre) + '">' + ico(c.icono, c.color) + esc(c.nombre) + '</button>'; }).join('') + '</div>';
  }
  if (r.tipo === 'Ahorro') {
    if (!D.metas.length) { hay = false; cuerpo = '<div class="card vacio reg-vacio"><i class="ti ti-target-arrow"></i>Primero crea una meta de ahorro.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="cerrarHoja(); formMeta()"><i class="ti ti-plus"></i>Crear meta</button></div></div>'; }
    else {
      h += '<div class="reg-sub">' + seg([['Aportar a la meta', 'Aportar'], ['Retirar de la meta', 'Retirar']], r.retiro ? 1 : 0, 'elegirRetiro') + '</div>';
      titulo = rapido ? 'Toca la meta para guardar' : 'Meta';
      cuerpo = '<div class="cats anchas">' + D.metas.map(function(m){ return '<button type="button" class="cat' + (m.id === r.meta ? ' on' : '') + '" onclick="tocarMeta(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(m.id) + '">' + ico(m.icono, '#6A5BC7') + '<span class="cat-tx"><b>' + esc(m.nombre) + '</b><small>' + m.pct + ' % · ' + clp(m.ahorrado) + '</small></span></button>'; }).join('') + '</div>';
    }
  }
  if (r.tipo === 'Pago') {
    var ops = D.tarjetas.map(function(t){ return { tipo: 'tarjeta', id: t.nombre, nombre: t.nombre, icono: 'ti-credit-card', color: '#1F5C99', monto: t.usado, et: 'Usado ' }; })
      .concat(D.deudas.filter(function(d){ return !d.terminada; }).map(function(d){ return { tipo: 'deuda', id: d.id, nombre: d.nombre, icono: 'ti-building-bank', color: '#3E546D', monto: d.cuota, et: 'Cuota ' }; }));
    if (!ops.length) { hay = false; cuerpo = '<div class="card vacio reg-vacio"><i class="ti ti-credit-card"></i>Agrega una tarjeta o una deuda para registrar sus pagos.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="cerrarHoja(); verMas(0)"><i class="ti ti-plus"></i>Agregar</button></div></div>'; }
    else {
      titulo = rapido ? 'Toca qué pagas para guardar' : 'Qué pagas';
      cuerpo = '<div class="cats anchas">' + ops.map(function(o){ var on = r.pago && r.pago.tipo === o.tipo && r.pago.id === o.id; return '<button type="button" class="cat' + (on ? ' on' : '') + '" onclick="tocarPago(this.getAttribute(&#39;data-t&#39;), this.getAttribute(&#39;data-v&#39;), ' + (Math.round(o.monto) || 0) + ')" data-t="' + o.tipo + '" data-v="' + esc(o.id) + '">' + ico(o.icono, o.color) + '<span class="cat-tx"><b>' + esc(o.nombre) + '</b><small>' + o.et + clp(o.monto || 0) + '</small></span></button>'; }).join('') + '</div>';
    }
  }
  if (titulo) h += '<div class="etq">' + titulo + '</div>';
  h += cuerpo + '<div class="reg-pista" id="regPista" aria-live="polite">' + esc(r.pista || '') + '</div>';
  if (hay) {
    // detalles plegados en una línea, iguales para los 4 tipos (medio y cuotas solo en gastos)
    var abierto = r.det || !!r.id;
    h += '<button type="button" class="det-res" onclick="verDetalles()" aria-expanded="' + abierto + '"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i><span>' + esc(resumenDetalles(r)) + '</span><i class="ti ti-chevron-' + (abierto ? 'up' : 'down') + '" aria-hidden="true"></i></button>';
    if (abierto) {
      h += '<div class="det">';
      if (r.tipo === 'Gasto') {
        h += '<div class="etq">Cómo pagaste</div><div class="chips">' + D.medios.map(function(m){ return '<button type="button" class="chip' + (m === r.medio ? ' on' : '') + '" data-v="' + esc(m) + '" onclick="elegir(&#39;medio&#39;,this.getAttribute(&#39;data-v&#39;))">' + esc(m) + '</button>'; }).join('') + '</div>';
        if (esTarjeta(r.medio)) h += '<div class="etq">Cuotas</div><div class="paso-n"><button type="button" aria-label="Menos cuotas" onclick="cuotas(-1)">−</button><span class="num">' + r.cuotas + (r.cuotas === 1 ? ' cuota' : ' cuotas') + '</span><button type="button" aria-label="Más cuotas" onclick="cuotas(1)">+</button></div>';
      }
      if (r.tipo === 'Gasto' || r.tipo === 'Ingreso') {
        // en dólares (3.8): se escribe en US$ y se guarda en pesos con el dólar del día
        var dol = D.dolar && D.dolar.valor > 0 ? D.dolar.valor : 0;
        h += '<div class="etq">Moneda</div><div class="chips"><button type="button" class="chip' + (r.moneda ? '' : ' on') + '" onclick="elegirMoneda(&#39;&#39;)">Pesos</button><button type="button" class="chip' + (r.moneda ? ' on' : '') + '" onclick="elegirMoneda(&#39;USD&#39;)">Dólares</button></div>';
        if (r.moneda) h += '<div class="campo"><label for="regUsd">Monto en dólares (US$)</label><input class="inp num" id="regUsd" inputmode="decimal" autocomplete="off" placeholder="Ej: 12,50" value="' + esc(r.original) + '" oninput="usdEscrito(this)"></div><p class="ayuda">' + (dol ? 'Dólar de hoy: ' + clp(dol) + '. Se guarda en pesos y queda anotado el monto en dólares.' : 'No tengo el valor del dólar: escríbelo en Más → Ajustes.') + '</p>';
        var ets = (D.etiquetas || []).slice(0, 12);
        h += '<div class="campo"><label for="regEt">Viaje o proyecto (opcional)</label><input class="inp" id="regEt" maxlength="30" list="regEtL" autocomplete="off" placeholder="Ej: Viaje a Puerto Varas" value="' + esc(r.etiqueta) + '" oninput="S.reg.etiqueta=this.value;var x=document.querySelector(&#39;.det-res span&#39;);if(x)x.textContent=resumenDetalles(S.reg)"><datalist id="regEtL">' + ets.map(function(e){ return '<option value="' + esc(e.etiqueta) + '"></option>'; }).join('') + '</datalist></div>';
      }
      var ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
      var isoAyer = ayer.getFullYear() + '-' + ('0' + (ayer.getMonth() + 1)).slice(-2) + '-' + ('0' + ayer.getDate()).slice(-2);
      h += '<div class="etq">Fecha</div><div class="chips"><button type="button" class="chip' + (r.fecha === D.hoy ? ' on' : '') + '" onclick="elegir(&#39;fecha&#39;,&#39;' + D.hoy + '&#39;)">Hoy</button><button type="button" class="chip' + (r.fecha === isoAyer ? ' on' : '') + '" onclick="elegir(&#39;fecha&#39;,&#39;' + isoAyer + '&#39;)">Ayer</button><input class="inp" type="date" aria-label="Otra fecha" style="width:auto;flex:1;min-width:150px" max="' + D.hoy + '" value="' + esc(r.fecha) + '" onchange="if(this.value)elegir(&#39;fecha&#39;,this.value)"></div>';
      if (r.id || r.fijo || (r.tipo !== 'Gasto' && r.tipo !== 'Ingreso')) h += '<div class="campo"><label for="regNota">Nota (opcional)</label><input class="inp" id="regNota" maxlength="120" placeholder="' + (r.tipo === 'Pago' ? 'Ej: pago total del mes' : (r.tipo === 'Ahorro' ? 'Ej: lo que sobró del sueldo' : 'Ej: almuerzo con el equipo')) + '" value="' + esc(r.nota) + '" oninput="S.reg.nota=this.value;var x=document.querySelector(&#39;.det-res span&#39;);if(x)x.textContent=resumenDetalles(S.reg)"></div>';
      h += '</div>';
    }
  }
  h += '<div class="error" id="regErr" role="alert"></div>';
  el('hojaT').textContent = r.id ? 'Editar movimiento' : (TITULO_REG[r.tipo] || 'Registrar');
  el('hojaC').innerHTML = h;
  var rev = rapido && r.revision && typeof window.FA_descartarRevision === 'function';
  el('hojaP').style.display = rapido && !rev ? 'none' : '';
  el('hojaP').innerHTML = rev ? '<button class="btn" onclick="FA_descartarRevision()"><i class="ti ti-x"></i>No anotar</button>' : rapido ? '' : '<button class="btn btn-peligro" style="flex:0 0 auto" onclick="borrarMov()" aria-label="Borrar movimiento"><i class="ti ti-trash"></i></button><button class="btn btn-p" id="regGuardar" onclick="guardarRegistro()"><i class="ti ti-check"></i>Guardar</button>';
}
// Botón + (3.7): burbujas en arco para elegir qué registrar; luego se abre ese registro directo
function abrirBurbujas(){
  var b = el('burb'); if (!b) { abrirRegistro(); return; }
  if (b.classList.contains('on')) { cerrarBurbujas(); return; }
  if (!D) return;
  b.classList.add('on'); b.setAttribute('aria-hidden', 'false'); bloquearFondo(true, true);
  var tt = document.querySelector('.toast'); if (tt) tt.classList.remove('on');   // que el aviso no tape las burbujas
  var m = document.querySelector('.nav .mas'); m.classList.add('abierto'); m.setAttribute('aria-expanded', 'true'); m.setAttribute('aria-label', 'Cerrar');
  vibrar();
  setTimeout(function(){ var x = b.querySelector('.burb-l button'); if (x) try { x.focus({ preventScroll: true }); } catch (e) {} }, 60);
}
function cerrarBurbujas(){
  var b = el('burb'); if (!b || !b.classList.contains('on')) return false;
  b.classList.remove('on'); b.setAttribute('aria-hidden', 'true'); if (!el('hoja').classList.contains('on')) bloquearFondo(false);
  var m = document.querySelector('.nav .mas'); m.classList.remove('abierto'); m.setAttribute('aria-expanded', 'false'); m.setAttribute('aria-label', 'Registrar');
  return true;
}
function elegirBurbuja(t){ cerrarBurbujas(); if (t === 'Cuenta') nuevaCuenta(); else abrirRegistro({ tipo: t }); }
var TITULO_REG = { Gasto: 'Nuevo gasto', Ingreso: 'Nuevo ingreso', Ahorro: 'Ahorro en una meta', Pago: 'Pago de tarjeta o deuda' };
function repintarReg(){ var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function pedirMonto(){ el('regErr').textContent = 'Primero escribe el monto.'; el('montoV').classList.add('pide'); }
function elegirRetiro(k){ S.reg.retiro = k === 1; repintarReg(); }
// ahorro nuevo: tocar la meta guarda (si falta el monto, lo pide)
function tocarMeta(id){
  var r = S.reg; r.meta = id; r.pista = '';
  if (r.id) { repintarReg(); return; }
  if (!(Number(r.monto) > 0)) { repintarReg(); pedirMonto(); return; }
  guardarRegistro();
}
// pago nuevo: tocar lo que pagas guarda. Sin monto escrito, el primer toque pone el sugerido
// (lo usado de la tarjeta o la cuota) y el segundo guarda; cambiar de opción cambia el sugerido.
function tocarPago(tipo, id, sugerido){
  var r = S.reg, mismo = !!(r.pago && r.pago.tipo === tipo && r.pago.id === id);
  r.pago = { tipo: tipo, id: id };
  if (r.id) { r.pista = ''; repintarReg(); return; }
  if (Number(r.monto) > 0 && (!r.montoAuto || mismo)) { r.pista = ''; guardarRegistro(); return; }
  if (sugerido > 0) { r.monto = String(sugerido); r.montoAuto = true; r.pista = 'Monto sugerido: ' + clp(sugerido) + '. Cámbialo con el teclado o toca otra vez para guardar.'; repintarReg(); return; }
  r.pista = ''; repintarReg(); pedirMonto();
}
function resumenDetalles(r){
  var ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  var isoAyer = ayer.getFullYear() + '-' + ('0' + (ayer.getMonth() + 1)).slice(-2) + '-' + ('0' + ayer.getDate()).slice(-2);
  var p = [];
  if (r.tipo === 'Gasto') p.push(r.medio + (esTarjeta(r.medio) && r.cuotas > 1 ? ' en ' + r.cuotas + ' cuotas' : ''));
  p.push(r.fecha === D.hoy ? 'Hoy' : (r.fecha === isoAyer ? 'Ayer' : fechaCorta(r.fecha)));
  if (r.moneda && r.original) p.push('US$ ' + r.original);
  if (r.etiqueta) p.push(r.etiqueta);
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
function cambiarTipo(i){ S.reg.tipo = TIPOS_REG[i]; S.reg.fijo = ''; S.reg.pista = ''; S.reg.sugerida = ''; S.reg.categoria = leerLocal('cat_' + S.reg.tipo) || ''; if (S.reg.montoAuto) { S.reg.monto = ''; S.reg.montoAuto = false; } pintarRegistro(); }
function montoEscrito(x){
  var r = S.reg; if (!r) return;
  r.monto = x.value.replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, 10); r.montoAuto = false;
  if (r.moneda) { r.moneda = ''; r.original = ''; }
  x.value = r.monto ? clp(r.monto) : '';
  try { x.setSelectionRange(x.value.length, x.value.length); } catch (e) {}
  x.classList.toggle('vacio-m', !r.monto); x.classList.remove('pide'); if (el('regErr')) el('regErr').textContent = '';
  if (r.pista) { r.pista = ''; if (el('regPista')) el('regPista').textContent = ''; }
}
function tecla(k){
  var r = S.reg; r.montoAuto = false;
  if (k === 'borrar') r.monto = r.monto.slice(0, -1);
  else if ((r.monto + k).length <= 10) r.monto = (r.monto + k).replace(/^0+/, '');
  var v = el('montoV'); v.value = r.monto ? clp(r.monto) : ''; v.classList.toggle('vacio-m', !r.monto); v.classList.remove('pide'); if (el('regErr')) el('regErr').textContent = '';
  if (r.pista) { r.pista = ''; if (el('regPista')) el('regPista').textContent = ''; }
}
function elegirMoneda(m){ var r = S.reg; r.moneda = m; if (!m) r.original = ''; else if (r.original) usdCalcular(); var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; var u = el('regUsd'); if (u && m) try { u.focus({ preventScroll: true }); } catch (e) {} }
function usdValor(t){ t = String(t || '').replace(/[^0-9,.]/g, ''); if (t.indexOf(',') >= 0) t = t.replace(/[.]/g, '').replace(',', '.'); return Number(t) || 0; }
function usdCalcular(){ var r = S.reg, v = usdValor(r.original), d = D.dolar && D.dolar.valor > 0 ? D.dolar.valor : 0; r.monto = v > 0 && d > 0 ? String(Math.round(v * d)) : ''; var m = el('montoV'); if (m) { m.value = r.monto ? clp(r.monto) : ''; m.classList.toggle('vacio-m', !r.monto); } }
function usdEscrito(x){ var r = S.reg; r.original = x.value.replace(/[^0-9,.]/g, '').slice(0, 12); if (x.value !== r.original) x.value = r.original; usdCalcular(); var s = document.querySelector('.det-res span'); if (s) s.textContent = resumenDetalles(r); if (el('regErr')) el('regErr').textContent = ''; }
function elegir(k, v){ S.reg[k] = v; if (k === 'medio') { guardarLocal('medio', v); if (!esTarjeta(v)) S.reg.cuotas = 1; } var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function elegirPago(tipo, id, cuota){ S.reg.pago = { tipo: tipo, id: id }; if (!S.reg.monto || S.reg.montoAuto) { S.reg.monto = cuota ? String(cuota) : ''; S.reg.montoAuto = true; } var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function cuotas(n){ S.reg.cuotas = Math.max(1, Math.min(48, S.reg.cuotas + n)); var y = el('hojaC').scrollTop; pintarRegistro(); el('hojaC').scrollTop = y; }
function guardarRegistro(){
  var r = S.reg, d = { monto: r.monto, fecha: r.fecha, nota: r.nota, periodo: S.periodo };
  if (r.tipo === 'Gasto') { d.tipo = 'Gasto'; d.categoria = r.categoria; d.medio = r.medio; d.cuotas = esTarjeta(r.medio) ? r.cuotas : 1; d.fijo = r.fijo; }
  else if (r.tipo === 'Ingreso') { d.tipo = 'Ingreso'; d.categoria = r.categoria; d.fijo = r.fijo; }
  if (r.tipo === 'Gasto' || r.tipo === 'Ingreso') { d.etiqueta = r.etiqueta || ''; if (r.moneda && r.original) { d.moneda = 'USD'; d.original = r.original; } }
  else if (r.tipo === 'Ahorro') { d.tipo = r.retiro ? 'Retiro de meta' : 'Ahorro'; d.meta = r.meta; }
  else { if (!r.pago) { el('regErr').textContent = 'Elige qué pagas.'; return; } if (r.pago.tipo === 'tarjeta') { d.tipo = 'Pago tarjeta'; d.medio = r.pago.id; } else { d.tipo = 'Pago deuda'; d.deuda = r.pago.id; } }
  if (!(Number(r.monto) > 0)) { el('regErr').textContent = 'Escribe el monto.'; return; }
  if ((d.tipo === 'Gasto' || d.tipo === 'Ingreso') && !d.categoria) { el('regErr').textContent = 'Elige una categoría.'; return; }
  if ((d.tipo === 'Ahorro' || d.tipo === 'Retiro de meta') && !d.meta) { el('regErr').textContent = 'Elige la meta.'; return; }
  // la hoja se cierra al tiro; un registro nuevo sin conexión queda en el teléfono y se sube solo
  var copia = JSON.parse(JSON.stringify(r)), antes = r.id ? movComoDatos(r.id) : null, nuevo = !r.id;
  if (nuevo) { d.cid = codigo(); if (!d.fecha) d.fecha = hoyLocal(); }
  cerrarHoja();
  if (nuevo && !LOCAL && navigator.onLine === false) { encolarSinConexion(d); return; }
  toast(r.id ? 'Guardando cambios…' : 'Guardando…');
  var fin = function(res){
    if (!res.ok) { reabrirRegistro(copia, res.error); return; }
    if (d.categoria) guardarLocal('cat_' + d.tipo, d.categoria);
    vibrar();
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
  return { tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, cuotas: m.cuotas, meta: m.meta, deuda: m.deuda, nota: m.nota, fecha: m.fecha, fijo: m.fijo, etiqueta: m.etiqueta || '', moneda: m.moneda || '', original: m.original || '', periodo: S.periodo };
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
  var pre = { id: m.id, tipo: m.tipo, monto: m.monto, categoria: m.categoria, medio: m.medio, cuotas: m.cuotas, meta: m.meta, fecha: m.fecha, nota: m.nota, fijo: m.fijo, etiqueta: m.etiqueta, moneda: m.moneda, original: m.original };
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
function formFijo(id, pre){
  var x = buscar(D.fijos, id); if (!id && pre) x = pre;
  var grupos = [['Gasto','Gastos'],['Ingreso','Ingresos']].map(function(g){ return { grupo: g[1], items: D.categorias.filter(function(c){ return c.tipo === g[0] && c.nombre !== 'Deudas'; }).map(function(c){ return { v: c.nombre, t: c.nombre }; }) }; });
  formulario(id ? 'Editar fijo' : 'Nuevo gasto o ingreso fijo', [['nombre','Nombre (ej: Arriendo, Luz, Netflix, Sueldo)',x.nombre || '','text'],['monto','Monto de un mes normal',x.monto || '','numero'],['dia','Día del mes en que se paga o llega (1 a 31)',x.dia || '','numero'],['categoria','Categoría',x.categoria || 'Casa','select',grupos],['medio','Cómo lo pagas (solo para gastos)',x.medio || leerLocal('medio') || 'Débito','select',D.medios.map(function(m){ return { v: m, t: m }; })]], 'guardarFijo', { id: id || '' }, 'fijo', function(d){ d.tipo = esIngreso(d.categoria) ? 'Ingreso' : 'Gasto'; });
}
function registrarFijo(id){ var x = buscar(D.fijos, id); if (!x.id) return; abrirRegistro({ tipo: x.tipo, monto: x.monto, categoria: x.categoria, medio: x.medio || '', fijo: x.id, fecha: D.hoy }); }
function vistaFijos(){
  var h = '<h2>Gastos e ingresos fijos<button onclick="formFijo()"><i class="ti ti-plus"></i> Nuevo</button></h2>';
  if (!D.fijos.length) return h + '<div class="card vacio"><i class="ti ti-repeat"></i>Agrega lo que pagas o recibes todos los meses (arriendo, cuentas, suscripciones, sueldo). Cada mes te aviso cuándo toca y lo registras con un toque.</div>';
  return h + '<div class="card lista">' + D.fijos.map(function(x){ var c = cat(x.categoria); return '<button class="fila toca" onclick="formFijo(&#39;' + x.id + '&#39;)">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(x.nombre) + '</b><small>Día ' + x.dia + ' · ' + esc(x.tipo === 'Ingreso' ? 'Ingreso' : x.medio) + (x.registrado ? ' · listo este mes' : '') + '</small></span><span class="v num">' + clp(x.monto) + '</span></button>'; }).join('') + '</div>';
}

/* ── 3.8: cierre del mes, patrimonio, calendario, viajes, cartola, preguntas y gastos por rendir ── */
var CARTOLA = (__CARTOLA__)();
var CLASIF = (__CLASIF__)();
function minus(t){ t = String(t || ''); return /^[A-ZÁÉÍÓÚ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
function mesesTxt(n){ return String(n).replace('.', ',') + (n === 1 ? ' mes' : ' meses'); }
function usdTxt(n){ return 'US$ ' + Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
// Inicio: tarjeta del cierre del mes (en la primera semana del mes, el anterior; o el mes pasado que estás mirando)
function htmlCierreIni(){
  var c = D.cierre; if (!c) return '';
  if (S.periodo === D.actual && leerLocal('cierreVisto') === String(c.indice)) return '';
  var sub = c.tasaAhorro !== null ? (c.tasaAhorro >= 0 ? 'Te sobró el ' + c.tasaAhorro + ' % de lo que entró' : 'Gastaste más de lo que entró') : 'Gastaste ' + clp(c.gastos);
  if (c.presupuesto) sub += ' · ' + (c.presupuesto.cumplido ? 'cumpliste el presupuesto' : 'te pasaste del presupuesto');
  return '<button class="card cc-ini" onclick="verCierre()">' + ico('ti-calendar-check', '#1F5C99') + '<span class="tx"><b>' + (S.periodo === D.actual ? 'Tu cierre de ' : 'Cierre de ') + esc(minus(c.periodo.nombre)) + '</b><small>' + esc(sub) + '</small></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>';
}
function verCierre(){
  var c = D.cierre; if (!c) return;
  var enCurso = S.periodo === D.actual;
  if (enCurso) guardarLocal('cierreVisto', String(c.indice));
  var dif = c.gastos - c.anterior.gastos, frases = [], h = '';
  h += '<div class="cifras"><div><small>Ingresos</small><b class="num">' + clp(c.ingresos) + '</b></div><div><small>Gastos</small><b class="num">' + clp(c.gastos) + '</b></div><div><small>Ahorro</small><b class="num">' + clp(c.ahorro) + '</b></div><div><small>Te quedó</small><b class="num' + (c.disponible < 0 ? ' rojo' : '') + '">' + clp(c.disponible) + '</b></div></div>';
  if (c.tasaAhorro !== null) frases.push(c.tasaAhorro >= 0 ? 'De lo que entró, te sobró el <b>' + c.tasaAhorro + ' %</b>.' : 'Gastaste <b class="num">' + clp(c.gastos - c.ingresos) + '</b> más de lo que entró.');
  if (c.anterior.gastos > 0 && dif !== 0) frases.push('Gastaste <b class="num">' + clp(Math.abs(dif)) + (dif > 0 ? ' más' : ' menos') + '</b> que en ' + esc(minus(c.anterior.nombre)) + '.');
  if (c.presupuesto) frases.push(c.presupuesto.cumplido ? 'Cumpliste el presupuesto: usaste <b class="num">' + clp(c.presupuesto.usado) + '</b> de ' + clp(c.presupuesto.total) + '.' : 'Te pasaste del presupuesto por <b class="num">' + clp(c.presupuesto.usado - c.presupuesto.total) + '</b>.');
  if (c.presupuesto && c.presupuesto.excedidas.length) frases.push('Sobre su límite: ' + c.presupuesto.excedidas.map(function(x){ return esc(x.nombre) + ' (' + clp(x.exceso) + ' de más)'; }).join(', ') + '.');
  if (frases.length) h += '<div class="cierre-f">' + frases.map(function(f){ return '<p>' + f + '</p>'; }).join('') + '</div>';
  if (c.top.length) h += '<div class="etq">Donde más gastaste</div><div class="card lista">' + c.top.map(function(p){ return '<div class="fila">' + ico(p.icono, p.color) + '<span class="tx"><b>' + esc(p.nombre) + '</b><small>' + p.pct + ' % de tus gastos</small></span><span class="v num">' + clp(p.gastado) + '</span></div>'; }).join('') + '</div>';
  if (c.explicaciones.length) h += '<div class="etq">Lo que cambió</div><div class="card lista">' + c.explicaciones.map(function(x){ var k = cat(x.categoria); return '<div class="fila">' + ico(k.icono, k.color) + '<span class="tx"><b>' + esc(x.categoria) + '</b><small>' + (x.promedio > 0 ? Math.abs(x.pct) + ' % ' + (x.dif > 0 ? 'más' : 'menos') + ' que tu promedio' : 'Antes no gastabas aquí') + '</small></span><span class="v num">' + clp(x.actual) + '</span></div>'; }).join('') + '</div>';
  abrirHoja('Cierre de ' + minus(c.periodo.nombre), h, (enCurso ? '<button class="btn" onclick="cerrarHoja(); irAPeriodo(' + c.indice + ')"><i class="ti ti-calendar"></i>Ver ese mes</button>' : '') + '<button class="btn btn-p" onclick="cerrarHoja()"><i class="ti ti-check"></i>Listo</button>');
  if (enCurso) pintarInicio();
}
// Inicio: aviso del calendario si algún día te quedarías corto
function htmlCalIni(){
  var C = D.calendario; if (!C || !C.corto || S.periodo !== D.actual) return '';
  return '<button class="alerta-f excedido alerta-b" onclick="verMas(6)"><i class="ti ti-calendar-exclamation" aria-hidden="true"></i><span>' + (C.corto.nombre ? 'El ' + fechaCorta(C.corto.fecha) + ', con ' + esc(C.corto.nombre) + ', te quedarías en ' : 'A fin de mes te quedarías en ') + '<b class="num">' + clp(C.corto.saldo) + '</b> · Ver calendario</span></button>';
}
// Inicio: patrimonio y fondo de emergencia en una línea
function htmlPatIni(){
  var P = D.patrimonio || {}, F = D.fondo; if (S.periodo !== D.actual || (!P.hay && !F)) return '';
  var sub = F ? 'Tu fondo de emergencia cubre ' + mesesTxt(F.meses) + ' de gastos' + (F.falta > 0 ? ' (meta: ' + mesesTxt(F.metaMeses) + ')' : ': ¡meta cumplida!')
    : (P.cambio !== null ? (P.cambio >= 0 ? 'Subió ' : 'Bajó ') + clp(Math.abs(P.cambio)) + ' desde el mes pasado' : 'Lo que tienes menos lo que debes');
  return '<button class="card cc-ini" onclick="verMas(5)">' + ico('ti-wallet', '#2E9E5B') + '<span class="tx"><b>' + (P.hay ? 'Patrimonio <span class="num">' + clp(P.neto) + '</span>' : 'Fondo de emergencia') + '</b><small>' + esc(sub) + '</small></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>';
}

/* patrimonio */
var TIPOS_ACT = [['Cuenta', 'Cuenta corriente o vista', 'ti-building-bank', '#1F5C99'], ['Ahorro', 'Cuenta de ahorro', 'ti-pig-money', '#2E9E5B'], ['Inversión', 'Inversión (fondos, depósitos, acciones)', 'ti-chart-line', '#6A5BC7'], ['Largo plazo', 'Largo plazo (APV, AFP voluntaria)', 'ti-hourglass', '#C47A1C'], ['Efectivo', 'Efectivo', 'ti-cash', '#078C7E'], ['Otro', 'Otro', 'ti-wallet', '#6B7A8F']];
function tipoAct(t){ var x = TIPOS_ACT[5]; TIPOS_ACT.forEach(function(a){ if (a[0] === t) x = a; }); return x; }
function saldoTxt(a){ return a.moneda === 'USD' ? usdTxt(a.saldo) : (a.moneda === 'UF' ? ufTxt(a.saldo) + ' UF' : clp(a.saldo)); }
function vistaPatrimonio(){
  var P = D.patrimonio, F = D.fondo, h = '';
  h += '<div class="card hero"><small>Patrimonio neto · lo que tienes menos lo que debes</small><div class="total num">' + clp(P.neto) + '</div><div class="tres"><div><span>Tienes</span><b class="num">' + clp(P.activos) + '</b></div><div><span>Debes</span><b class="num">' + clp(P.pasivos) + '</b></div><div><span>Vs mes pasado</span><b class="num">' + (P.cambio === null ? '—' : (P.cambio >= 0 ? '+' : '') + clp(P.cambio)) + '</b></div></div></div>';
  var hist = (P.historia || []).filter(function(x){ return x.tengo !== null; });
  if (hist.length >= 2) {
    var max = Math.max.apply(null, P.historia.map(function(x){ return Math.max(0, x.tengo || 0); })) || 1;
    h += '<h2>Lo que tienes, mes a mes</h2><div class="card pat-graf" role="img" aria-label="Lo que tienes en los últimos 6 meses">' + P.historia.map(function(x){ var v = Math.max(0, x.tengo || 0); return '<div class="pg-c"><span class="pg-v num">' + (x.tengo === null ? '' : clpCorto(x.tengo)) + '</span><span class="pg-b"><i style="height:' + (x.tengo === null ? 0 : Math.max(3, Math.round(v * 100 / max))) + '%"></i></span><span class="pg-m">' + esc(x.mes) + '</span></div>'; }).join('') + '</div>';
  }
  if (F) {
    var pct = F.objetivo > 0 ? Math.min(100, Math.round(F.colchon * 100 / F.objetivo)) : 100;
    h += '<h2>Fondo de emergencia</h2><div class="card pres"><div class="pres-t"><span>Cubres <b>' + mesesTxt(F.meses) + '</b> de gastos</span><span>Meta: ' + mesesTxt(F.metaMeses) + '</span></div><div class="barra"><i class="' + (pct >= 100 ? 'okv' : (pct >= 50 ? '' : 'alerta')) + '" style="width:' + pct + '%"></i></div>'
      + '<p class="por-dia">' + (F.falta > 0 ? 'Te faltan <b class="num">' + clp(F.falta) + '</b> para cubrir ' + mesesTxt(F.metaMeses) + '. ' : '¡Meta cumplida! ') + 'Tu gasto de un mes es de unos ' + clp(F.mensual) + ' (promedio de ' + (F.meses_ === 1 ? 'el mes anterior' : 'los ' + F.meses_ + ' meses anteriores') + ').</p>'
      + '<p class="proy-d">' + (F.fuente === 'cuentas' ? 'Cuenta lo que tienes a mano en tus cuentas (sin lo de largo plazo).' : 'Cuenta lo ahorrado en tus metas. Si agregas tus cuentas abajo, usa sus saldos.') + ' La meta se cambia en Ajustes.</p></div>';
  }
  h += '<h2>Cuentas e inversiones<button onclick="formActivo()"><i class="ti ti-plus"></i> Nueva</button></h2>';
  if (!P.items.length) h += '<div class="card vacio"><i class="ti ti-wallet"></i>Agrega tus cuentas, ahorros e inversiones con su saldo de hoy. Actualízalos cuando quieras (por ejemplo, a fin de mes) y verás cómo crece lo que tienes.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="formActivo()"><i class="ti ti-plus"></i>Agregar cuenta</button></div></div>';
  else h += '<div class="card lista">' + P.items.map(function(a){
    var t = tipoAct(a.tipo), viejo = a.dias !== null && a.dias > 31;
    var sub = [t[1].split(' (')[0], a.moneda !== 'CLP' ? saldoTxt(a) : '', a.dias === null ? '' : (a.dias === 0 ? 'al día de hoy' : (viejo ? 'actualízalo (hace ' + a.dias + ' días)' : 'hace ' + a.dias + (a.dias === 1 ? ' día' : ' días')))].filter(function(x){ return x; }).join(' · ');
    return '<button class="fila toca" onclick="formActivo(&#39;' + a.id + '&#39;)">' + ico(t[2], t[3]) + '<span class="tx"><b>' + esc(a.nombre) + '</b><small' + (viejo ? ' class="rojo"' : '') + '>' + esc(sub) + '</small></span><span class="v num">' + (a.sinTasa ? '<small>sin ' + (a.moneda === 'USD' ? 'dólar' : 'UF') + '</small>' : clp(a.pesos)) + '</span></button>';
  }).join('') + '</div>';
  var deb = [['Créditos y préstamos', P.creditos, 'ti-building-bank', 0], ['Tarjetas (lo usado)', P.tarjetas, 'ti-credit-card', 0], ['Le debes a otras personas', P.debo, 'ti-users', 3]].filter(function(x){ return x[1] > 0; });
  if (deb.length || P.meDeben) {
    h += '<h2>Lo que debes</h2><div class="card lista">' + deb.map(function(x){ return '<button class="fila toca" onclick="cambiarMas(' + x[3] + ')">' + ico(x[2], '#3E546D') + '<span class="tx"><b>' + x[0] + '</b></span><span class="v num">' + clp(x[1]) + '</span></button>'; }).join('')
      + (P.meDeben ? '<button class="fila toca" onclick="cambiarMas(3)">' + ico('ti-users', '#2E9E5B') + '<span class="tx"><b>Te deben</b><small>Suma a lo que tienes</small></span><span class="v num pos">+' + clp(P.meDeben) + '</span></button>' : '') + '</div>';
  }
  if (P.dolar) h += '<p class="ayuda" style="margin-top:12px">Dólar de hoy: ' + clp(P.dolar) + (P.uf ? ' · UF: ' + clp(P.uf) : '') + '.</p>';
  return h;
}
function formActivo(id){
  var a = id ? buscar(D.patrimonio.items, id) : {};
  var saldo = a.id ? (a.moneda === 'CLP' ? Number(a.saldo).toLocaleString('es-CL') : ufTxt(a.saldo)) : '';
  formulario(id ? 'Editar cuenta' : 'Nueva cuenta o inversión', [['nombre', 'Nombre (ej: Cuenta RUT, Depósito a plazo, APV)', a.nombre || '', 'text'], ['tipo', 'Tipo', a.tipo || 'Cuenta', 'select', TIPOS_ACT.map(function(t){ return { v: t[0], t: t[1] }; })], ['moneda', 'Moneda', a.moneda || 'CLP', 'select', [{ v: 'CLP', t: 'Pesos' }, { v: 'USD', t: 'Dólares' }, { v: 'UF', t: 'UF' }]], ['saldo', 'Saldo de hoy', saldo, 'decimal']], 'guardarActivo', { id: id || '' }, 'activo');
}

/* calendario de pagos */
function vistaCalendario(){
  var C = D.calendario, h = '';
  if (!C) return '<div class="card vacio"><i class="ti ti-calendar"></i>El calendario muestra lo que falta pagar o recibir en el mes en curso.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="irAPeriodo(D.actual)"><i class="ti ti-calendar"></i>Ir al mes en curso</button></div></div>';
  h += '<p class="ayuda">Lo que falta pagar o recibir este mes y con cuánto te quedarías cada día. Parte de lo disponible hoy (<span class="num">' + clp(C.inicio) + '</span>)' + (C.ritmo > 0 ? ' y descuenta tu gasto del día a día (unos <span class="num">' + clp(C.ritmo) + '</span> diarios)' : '') + '.</p>';
  if (C.corto) h += '<div class="alerta-f excedido"><i class="ti ti-alert-octagon" aria-hidden="true"></i><span>' + (C.corto.nombre ? 'El ' + fechaCorta(C.corto.fecha) + ', con ' + esc(C.corto.nombre) + ', te quedarías en ' : 'A fin de mes te quedarías en ') + '<b class="num">' + clp(C.corto.saldo) + '</b>.</span></div>';
  if (!C.dias.length) h += '<div class="card vacio" style="margin-top:12px"><i class="ti ti-circle-check"></i>No quedan pagos ni ingresos fijos este mes. Agrégalos en <b>Gastos e ingresos fijos</b> o en <b>Tarjetas y deudas</b>.</div>';
  var ICN = { ingreso: ['ti-arrow-down-left', '#2E9E5B'], fijo: ['ti-repeat', '#C47A1C'], deuda: ['ti-building-bank', '#3E546D'], tarjeta: ['ti-credit-card', '#1F5C99'] };
  var QUE = { ingreso: 'Ingreso fijo', fijo: 'Gasto fijo', deuda: 'Cuota' };
  C.dias.forEach(function(d){
    h += '<div class="dia"><span>' + esc(fechaTexto(d.fecha)) + '</span><span class="num' + (d.saldo < 0 ? ' rojo' : '') + '">Te quedarían ' + clp(d.saldo) + '</span></div><div class="card lista">' + d.eventos.map(function(e){
      var accion = e.clase === 'tarjeta' ? 'pagarTarjeta(this.getAttribute(&#39;data-v&#39;))' : (e.clase === 'deuda' ? 'pagarDeuda(&#39;' + e.id + '&#39;)' : 'registrarFijo(&#39;' + e.id + '&#39;)');
      var sub = e.clase === 'tarjeta' ? 'Pago de tarjeta · no resta: la compra ya se contó' : (e.vencido ? 'Venció · toca para registrar' : QUE[e.clase] + ' · toca para registrar');
      return '<button class="fila toca" onclick="' + accion + '" data-v="' + esc(e.nombre) + '">' + ico(ICN[e.clase][0], ICN[e.clase][1]) + '<span class="tx"><b>' + esc(e.nombre) + '</b><small>' + sub + '</small></span><span class="v num ' + (e.clase === 'ingreso' ? 'pos' : 'neg') + '">' + (e.clase === 'ingreso' ? '+' : '−') + clp(e.monto) + '</span></button>';
    }).join('') + '</div>';
  });
  h += '<p class="ayuda" style="margin-top:12px">Al cerrar el mes (' + fechaCorta(C.hasta) + ') te quedarían <b class="num' + (C.final < 0 ? ' rojo' : '') + '">' + clp(C.final) + '</b>. Es una estimación: cambia con lo que anotes.</p>';
  return h;
}

/* viajes y proyectos */
function vistaViajes(){
  var E = D.etiquetas || [], h = '<p class="ayuda">Junta gastos de distintas categorías bajo un nombre (un viaje, una remodelación, un matrimonio) y ve cuánto costó en total. Al registrar, abre los detalles y escribe el nombre en <b>Viaje o proyecto</b>.</p>';
  if (!E.length) return h + '<div class="card vacio"><i class="ti ti-luggage"></i>Todavía no tienes viajes ni proyectos.<div class="acc" style="justify-content:center"><button class="btn btn-p" onclick="abrirRegistro({ tipo: &#39;Gasto&#39;, det: true })"><i class="ti ti-plus"></i>Registrar un gasto</button></div></div>';
  return h + '<div class="card lista">' + E.map(function(x){ return '<button class="fila toca" onclick="verEtiqueta(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(x.etiqueta) + '">' + ico('ti-luggage', '#078C7E') + '<span class="tx"><b>' + esc(x.etiqueta) + '</b><small>' + fechaCorta(x.desde) + (x.desde !== x.hasta ? ' al ' + fechaCorta(x.hasta) : '') + ' · ' + x.n + (x.n === 1 ? ' movimiento' : ' movimientos') + '</small></span><span class="v num">' + clp(x.gastos) + (x.usd ? '<small>' + usdTxt(x.usd) + '</small>' : '') + '</span></button>'; }).join('') + '</div>';
}
function verEtiqueta(nombre){
  var x = null; (D.etiquetas || []).forEach(function(e){ if (e.etiqueta === nombre) x = e; }); if (!x) return;
  var h = '<div class="cifras"><div><small>Gastaste</small><b class="num">' + clp(x.gastos) + '</b></div><div><small>Días</small><b class="num">' + x.dias + '</b></div>' + (x.ingresos ? '<div><small>Ingresos</small><b class="num">' + clp(x.ingresos) + '</b></div>' : '') + (x.usd ? '<div><small>En dólares</small><b class="num">' + usdTxt(x.usd) + '</b></div>' : '') + '</div>';
  if (x.categorias.length) h += '<div class="etq">Por categoría</div><div class="card lista">' + x.categorias.map(function(c){ var k = cat(c.nombre); return '<div class="fila">' + ico(k.icono, k.color) + '<span class="tx"><b>' + esc(c.nombre) + '</b><small>' + (x.gastos > 0 ? Math.round(c.monto * 100 / x.gastos) : 0) + ' % del total</small></span><span class="v num">' + clp(c.monto) + '</span></div>'; }).join('') + '</div>';
  h += '<div class="etq">Movimientos</div><div id="et-movs" class="card lista"><div class="fila"><span class="tx"><small>Cargando…</small></span></div></div>';
  abrirHoja(x.etiqueta, h, '<button class="btn btn-p" onclick="cerrarHoja()"><i class="ti ti-check"></i>Listo</button>');
  api('movimientosEtiqueta', [x.etiqueta], function(r){
    var c = el('et-movs'); if (!c || !r.ok) return;
    c.innerHTML = r.lista.map(function(m){ var k = cat(m.categoria); return '<div class="fila">' + ico(k.icono, k.color) + '<span class="tx"><b>' + esc(m.nota || m.categoria) + '</b><small>' + fechaCorta(m.fecha) + ' · ' + esc(m.categoria) + (m.moneda === 'USD' ? ' · ' + usdTxt(m.original) : '') + '</small></span><span class="v num ' + (m.tipo === 'Ingreso' ? 'pos' : 'neg') + '">' + (m.tipo === 'Ingreso' ? '+' : '−') + clp(m.monto) + '</span></div>'; }).join('');
  });
}

/* importar la cartola del banco */
function vistaImportar(){
  var I = S.imp || (S.imp = { paso: 1, medio: leerLocal('impMedio') || 'Débito' }), h = '';
  if (D.medios.indexOf(I.medio) < 0) I.medio = D.medios.indexOf('Débito') >= 0 ? 'Débito' : D.medios[0];
  if (I.paso === 1) {
    h += '<p class="ayuda">Descarga la cartola o el estado de cuenta desde la página de tu banco (Excel o CSV) y elígela aquí. Se lee en este equipo: el archivo no se sube a ninguna parte. Antes de guardar ves cada movimiento y eliges cuáles entran.</p>';
    h += '<div class="card" style="padding:4px 16px 16px">' + campoTexto('imp-medio', '¿De qué cuenta o tarjeta es?', I.medio, 'select', D.medios.map(function(m){ return { v: m, t: m }; }))
      + '<div class="campo"><label for="imp-arch">Archivo de la cartola (.xlsx, .csv)</label><input class="inp" id="imp-arch" type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onchange="impArchivo(this)"></div>'
      + '<div class="error" id="imp-err" role="alert">' + esc(I.error || '') + '</div></div>';
    return h;
  }
  if (I.paso === 2) {
    var cab = I.encabezado >= 0 ? I.filas[I.encabezado] : [], ancho = Math.max.apply(null, I.filas.map(function(f){ return f.length; }));
    var ops = [{ v: '-1', t: '(ninguna)' }]; for (var j = 0; j < ancho; j++) ops.push({ v: String(j), t: (cab[j] ? String(cab[j]) : 'Columna ' + String.fromCharCode(65 + (j % 26))) });
    var datos = I.filas.slice(I.encabezado + 1, I.encabezado + 4);
    h += '<p class="ayuda">Revisa qué columna es cada cosa. Si tu banco separa <b>cargos</b> y <b>abonos</b>, elige las dos; si trae un solo <b>monto</b> (negativo = cargo), elige solo esa.</p>';
    h += '<div class="card imp-prev"><table><tbody>' + datos.map(function(f){ return '<tr>' + f.slice(0, 8).map(function(x){ return '<td>' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    h += '<div class="card" style="padding:4px 16px 16px;margin-top:12px">' + campoTexto('imp-c-fecha', 'Fecha', String(I.map.fecha), 'select', ops) + campoTexto('imp-c-desc', 'Descripción', String(I.map.descripcion), 'select', ops)
      + campoTexto('imp-c-monto', 'Monto (con signo)', String(I.map.monto), 'select', ops) + campoTexto('imp-c-cargo', 'Cargos (lo que sale)', String(I.map.cargo), 'select', ops) + campoTexto('imp-c-abono', 'Abonos (lo que entra)', String(I.map.abono), 'select', ops)
      + '<div class="error" id="imp-err" role="alert"></div><div class="acc"><button class="btn" onclick="impReiniciar()"><i class="ti ti-arrow-left"></i>Otro archivo</button><button class="btn btn-p" onclick="impRevisar(this)"><i class="ti ti-list-check"></i>Revisar movimientos</button></div></div>';
    return h;
  }
  var marcados = I.lista.filter(function(x){ return x.marcado; }).length;
  var cats = function(tipo){ return D.categorias.filter(function(c){ return c.tipo === tipo && c.nombre !== 'Deudas'; }); };
  h += '<p class="ayuda">' + I.lista.length + ' movimientos de <b>' + esc(I.medio) + '</b>' + (I.malas ? ' (' + I.malas + ' filas sin fecha o monto se saltaron)' : '') + '. Desmarca lo que no quieras y cambia la categoría si hace falta. Lo que ya importaste antes viene desmarcado.</p>';
  h += '<div class="card lista imp-l">' + I.lista.map(function(x, k){
    var avisos = [x.repetido ? 'Ya importado' : '', !x.repetido && x.parecido ? 'Parece ya anotado' : '', x.traspaso ? '¿Pago de tarjeta o traspaso?' : ''].filter(function(a){ return a; });
    return '<div class="fila imp-f' + (x.marcado ? '' : ' off') + '"><input type="checkbox" id="imp-k' + k + '"' + (x.marcado ? ' checked' : '') + ' onchange="impMarca(' + k + ', this.checked)" aria-label="Importar ' + esc(x.descripcion || 'movimiento') + '"><span class="tx"><label for="imp-k' + k + '"><b>' + esc(x.descripcion || '(sin descripción)') + '</b><small>' + fechaCorta(x.fecha) + (avisos.length ? ' · <span class="imp-a">' + esc(avisos.join(' · ')) + '</span>' : '') + '</small></label>'
      + '<select class="inp imp-cat" aria-label="Categoría" onchange="impCat(' + k + ', this.value)">' + cats(x.tipo).map(function(c){ return '<option' + (c.nombre === x.categoria ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('') + '</select></span><span class="v num ' + (x.tipo === 'Ingreso' ? 'pos' : 'neg') + '">' + (x.tipo === 'Ingreso' ? '+' : '−') + clp(x.monto) + '</span></div>';
  }).join('') + '</div>';
  h += '<div class="error" id="imp-err" role="alert"></div><div class="acc"><button class="btn" onclick="impReiniciar()"><i class="ti ti-x"></i>Cancelar</button><button class="btn btn-p" id="imp-ok" onclick="impGuardar(this)"' + (marcados ? '' : ' disabled') + '><i class="ti ti-file-import"></i>Importar ' + marcados + '</button></div>';
  return h;
}
function impReiniciar(){ S.imp = null; pintarMas(); window.scrollTo(0, 0); }
function impArchivo(inp){
  var f = inp.files && inp.files[0], I = S.imp; if (!f) return;
  I.medio = el('imp-medio').value; guardarLocal('impMedio', I.medio); I.error = '';
  if (f.size > 8 * 1024 * 1024) { el('imp-err').textContent = 'El archivo es muy grande (más de 8 MB).'; return; }
  el('imp-err').textContent = 'Leyendo…';
  CARTOLA.leer(f).then(function(filas){
    if (!filas.length) { el('imp-err').textContent = 'No encontré filas en el archivo.'; return; }
    var m = CARTOLA.detectar(filas);
    S.imp = { paso: 2, medio: I.medio, filas: filas, encabezado: m.encabezado, map: m };
    pintarMas(); window.scrollTo(0, 0);
  }).catch(function(e){ var x = el('imp-err'); if (x) x.textContent = (e && e.message) || 'No pude leer el archivo. Prueba guardarlo como CSV.'; });
}
function impRevisar(b){
  var I = S.imp, n = function(id){ return Number(el(id).value); };
  var m = { fecha: n('imp-c-fecha'), descripcion: n('imp-c-desc'), monto: n('imp-c-monto'), cargo: n('imp-c-cargo'), abono: n('imp-c-abono') };
  if (m.fecha < 0) { el('imp-err').textContent = 'Elige la columna de la fecha.'; return; }
  if (m.monto < 0 && m.cargo < 0 && m.abono < 0) { el('imp-err').textContent = 'Elige la columna del monto, o las de cargos y abonos.'; return; }
  I.map = m;
  var filas = I.filas.slice(I.encabezado + 1).map(function(f){
    var x = { fecha: f[m.fecha], descripcion: m.descripcion >= 0 ? f[m.descripcion] : '' };
    if (m.monto >= 0) x.monto = f[m.monto]; else { x.cargo = m.cargo >= 0 ? f[m.cargo] : ''; x.abono = m.abono >= 0 ? f[m.abono] : ''; }
    return x;
  });
  api('prepararImportacion', [filas], function(r){
    if (!r.ok) { el('imp-err').textContent = r.error; return; }
    r.lista.forEach(function(x){ x.marcado = !x.repetido && !x.parecido && !x.traspaso; });
    S.imp = { paso: 3, medio: I.medio, lista: r.lista, malas: r.malas, filas: I.filas, encabezado: I.encabezado, map: I.map };
    pintarMas(); window.scrollTo(0, 0);
  }, b);
}
function impMarca(k, si){
  var x = S.imp.lista[k]; x.marcado = si;
  var f = el('imp-k' + k); if (f) f.closest('.imp-f').classList.toggle('off', !si);
  var n = S.imp.lista.filter(function(y){ return y.marcado; }).length, b = el('imp-ok');
  if (b) { b.disabled = !n; b.innerHTML = '<i class="ti ti-file-import"></i>Importar ' + n; }
}
function impCat(k, v){ S.imp.lista[k].categoria = v; }
function impGuardar(b){
  var I = S.imp, lista = I.lista.filter(function(x){ return x.marcado; }).map(function(x){ return { clave: x.clave, fecha: x.fecha, descripcion: x.descripcion, monto: x.monto, tipo: x.tipo, categoria: x.categoria }; });
  api('importarMovimientos', [lista, I.medio], function(r){
    if (!r.ok) { el('imp-err').textContent = r.error; return; }
    S.imp = null; vibrar(); pintar(r.datos);
    toast('Listo: ' + r.guardados + (r.guardados === 1 ? ' movimiento importado' : ' movimientos importados') + (r.repetidos ? ' (' + r.repetidos + ' ya estaban)' : '') + (r.errores.length ? '. Con problemas: ' + r.errores.length : ''));
  }, b);
}

/* preguntas a tus números (en el buscador de Movimientos) */
function esPregunta(t){ t = sinTildes(t).trim(); return t.length >= 6 && (/^[¿]/.test(t) || /[?]$/.test(t) || /^(cuanto|cuanta|cuantos|cuantas|en que|cual|donde|que tanto) /.test(t)); }
function preguntarUI(){
  var q = (el('qMov') || {}).value || ''; if (!esPregunta(q)) return;
  S.resp = { q: q, texto: 'Pensando…' }; pintarMovs();
  api('preguntar', [q], function(r){ S.resp = { q: q, texto: r.ok ? r.texto : r.error }; pintarMovs(); }, null, function(){ S.resp = { q: q, texto: 'No pude responder sin conexión.' }; pintarMovs(); });
}
function htmlPregunta(){
  if (!esPregunta(S.q || '')) return '';
  var r = S.resp && S.resp.q === S.q ? S.resp.texto : '';
  return '<div class="card preg" aria-live="polite"><i class="ti ti-message-question" aria-hidden="true"></i><span>' + (r ? esc(r) : 'Pregúntale a tus números: toca <b>Preguntar</b> o Enter.') + '</span>' + (r ? '' : '<button class="btn btn-p" onclick="preguntarUI()">Preguntar</button>') + '</div>';
}

/* gastos por rendir */
function formRendir(){
  formulario('Gasto por rendir', [['monto', 'Monto', '', 'numero'], ['persona', '¿A quién se lo rindes? (ej: tu empresa)', leerLocal('rendir') || '', 'text'], ['nota', 'Qué fue (opcional, ej: taxi a reunión)', '', 'text'], ['fecha', 'Fecha', D.hoy, 'date']], 'guardarRendicion', {}, '', function(d){ guardarLocal('rendir', d.persona); });
}

/* accesibilidad: tamaño de la letra (solo en este equipo) */
function aplicarLetra(i){ var h = document.documentElement; h.classList.remove('letra-1', 'letra-2'); if (i) h.classList.add('letra-' + i); }
function elegirLetra(i){ guardarLocal('letra', String(i)); aplicarLetra(i); pintarMas(); if (el('hoja').classList.contains('on') && el('hojaT').textContent === 'Apariencia') ajLetra(); }
// tema (3.9): automático (el del teléfono), claro u oscuro; solo en este equipo
var TEMAS = ['Automático', 'Claro', 'Oscuro'], TEMA_V = ['', 'claro', 'oscuro'];
function temaIdx(){ return Math.max(0, TEMA_V.indexOf(leerLocal('tema') || '')); }
function aplicarTema(i){ var h = document.documentElement; if (TEMA_V[i]) h.setAttribute('data-tema', TEMA_V[i]); else h.removeAttribute('data-tema'); }
function elegirTema(i){ guardarLocal('tema', TEMA_V[i] || ''); aplicarTema(i); pintarMas(); if (el('hoja').classList.contains('on') && el('hojaT').textContent === 'Apariencia') ajLetra(); }
try { aplicarLetra(Number(leerLocal('letra')) || 0); aplicarTema(temaIdx()); } catch (e) {}

/* ── comparar meses y análisis a la fecha (3.9) ── */
// El mes que miras contra otro (por omisión, el anterior). En el mes en curso, a la fecha: los dos hasta el mismo día.
var CMP_ICO = { sube: ['ti-trending-up', 'cmp-mal'], baja: ['ti-trending-down', 'cmp-bien'], ok: ['ti-circle-check', 'cmp-bien'], alerta: ['ti-alert-triangle', 'cmp-alerta'], info: ['ti-info-circle', ''], idea: ['ti-bulb', 'cmp-idea'] };
function verComparar(a, b){
  if (!el('hoja').classList.contains('on') || el('hojaT').textContent !== 'Comparar meses') abrirHoja('Comparar meses', '<div class="card vacio"><i class="ti ti-report-analytics"></i>Analizando…</div>', '<button class="btn btn-p" onclick="cerrarHoja()"><i class="ti ti-check"></i>Listo</button>');
  api('analizarMeses', [a === undefined ? S.periodo : a, b === undefined ? null : b], pintarComparar, null, function(){ var c = el('hojaC'); if (c) c.innerHTML = '<div class="error">Sin conexión: no pude analizar.</div>'; });
}
function cmpDif(d, buenoSube){ if (!d) return '<small>igual</small>'; return '<small class="' + ((d > 0) === buenoSube ? 'cmp-bien' : 'cmp-mal') + '">' + (d > 0 ? '+' : '−') + clp(Math.abs(d)) + '</small>'; }
function pintarComparar(r){
  if (!el('hoja').classList.contains('on') || el('hojaT').textContent !== 'Comparar meses') return;
  if (!r.ok) { el('hojaC').innerHTML = '<div class="error">' + esc(r.error) + '</div>'; return; }
  var ma = r.meses.map(function(m){ return { v: String(m.indice), t: m.nombre }; }), mb = ma.slice();
  if (!mb.some(function(o){ return o.v === String(r.b.indice); })) mb.push({ v: String(r.b.indice), t: r.b.nombre });
  var h = '<div class="cmp-sel">' + campoTexto('cmp-a', 'Mes', String(r.a.indice), 'select', ma) + campoTexto('cmp-b', 'Comparar con', String(r.b.indice), 'select', mb) + '</div>';
  h += '<p class="ayuda">' + (r.alDia ? 'A la fecha: los dos meses hasta el día ' + r.dia + ' de cada uno.' : 'Meses completos.') + '</p>';
  h += '<div class="cifras"><div><small>Gastos</small><b class="num">' + clp(r.totales.gastos[0]) + '</b>' + cmpDif(r.totales.gastos[0] - r.totales.gastos[1], false) + '</div>'
    + '<div><small>Ingresos</small><b class="num">' + clp(r.totales.ingresos[0]) + '</b>' + cmpDif(r.totales.ingresos[0] - r.totales.ingresos[1], true) + '</div></div>';
  if (r.conclusiones.length) h += '<div class="etq">Conclusiones</div><div class="card lista cmp-c">' + r.conclusiones.map(function(c){ var x = CMP_ICO[c.tipo] || CMP_ICO.info; return '<div class="fila"><i class="ti ' + x[0] + ' cmp-i ' + x[1] + '" aria-hidden="true"></i><span class="tx">' + esc(c.texto) + '</span></div>'; }).join('') + '</div>';
  if (r.categorias.length) {
    var max = Math.max.apply(null, r.categorias.map(function(c){ return Math.max(c.a, c.b); })) || 1, w = function(v){ return v > 0 ? Math.max(2, Math.round(v * 100 / max)) : 0; };
    h += '<div class="etq">Por categoría</div><div class="cmp-ley"><span><i class="cmp-ba"></i>' + esc(r.a.nombre) + '</span><span><i class="cmp-bb"></i>' + esc(r.b.nombre) + '</span></div>';
    h += '<div class="card lista">' + r.categorias.map(function(c){
      return '<div class="fila">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(c.nombre) + '</b><span class="cmp-bs" aria-hidden="true"><i class="cmp-ba" style="width:' + w(c.a) + '%"></i><i class="cmp-bb" style="width:' + w(c.b) + '%"></i></span></span><span class="v num">' + clp(c.a) + cmpDif(c.dif, false) + '</span></div>';
    }).join('') + '</div>';
  }
  el('hojaC').innerHTML = h;
  el('cmp-a').onchange = function(){ verComparar(Number(this.value), Number(this.value) === Number(el('cmp-b').value) ? undefined : Number(el('cmp-b').value)); };
  el('cmp-b').onchange = function(){ verComparar(Number(el('cmp-a').value), Number(this.value)); };
}

/* ── borrar varios movimientos (3.9): «Seleccionar» en Movimientos, con confirmación y Deshacer ── */
function htmlSel(n){
  if (!n) return '';
  if (!S.sel) return '<div class="sel-ini"><span class="sel-h"><i class="ti ti-pencil" aria-hidden="true"></i>Toca un movimiento para corregirlo</span><button type="button" class="sel-b" onclick="selIniciar()"><i class="ti ti-checkbox" aria-hidden="true"></i>Seleccionar</button></div>';
  var k = Object.keys(S.sel).length, todos = k === S.selVisibles.length;
  return '<div class="card sel-bar" role="toolbar" aria-label="Movimientos seleccionados"><span class="sel-n">' + (k ? k + (k === 1 ? ' seleccionado' : ' seleccionados') : 'Toca para elegir') + '</span>'
    + '<button type="button" class="sel-b" onclick="selTodos()">' + (todos ? 'Ninguno' : 'Todos') + '</button>'
    + (k === 1 ? '<button type="button" class="sel-b" onclick="selEditar()"><i class="ti ti-pencil" aria-hidden="true"></i>Editar</button>' : '')
    + '<button type="button" class="sel-b sel-borrar" onclick="selBorrar()"' + (k ? '' : ' disabled') + '><i class="ti ti-trash" aria-hidden="true"></i>Borrar</button>'
    + '<button type="button" class="sel-b" onclick="selCancelar()" aria-label="Terminar la selección"><i class="ti ti-x"></i></button></div>';
}
function selIniciar(){ S.sel = {}; pintarMovs(); }
function selEditar(){ var id = Object.keys(S.sel || {})[0]; if (!id) return; S.sel = null; pintarMovs(); editarMov(id); }
function selCancelar(){ S.sel = null; pintarMovs(); }
function selMov(id){ if (S.sel[id]) delete S.sel[id]; else S.sel[id] = true; pintarMovs(); }
function selTodos(){ var todos = Object.keys(S.sel).length === S.selVisibles.length; S.sel = {}; if (!todos) S.selVisibles.forEach(function(id){ S.sel[id] = true; }); pintarMovs(); }
function selBorrar(){
  var ids = Object.keys(S.sel || {}); if (!ids.length) return;
  var suma = 0; D.movimientos.forEach(function(m){ if (S.sel[m.id]) suma += Number(m.monto) || 0; });
  abrirHoja(ids.length === 1 ? 'Borrar 1 movimiento' : 'Borrar ' + ids.length + ' movimientos',
    '<p class="ayuda">Se borran ' + (ids.length === 1 ? 'el movimiento elegido' : 'los ' + ids.length + ' movimientos elegidos') + ' de ' + esc(minus(D.resumen.periodo.nombre)) + ' (en total <b class="num">' + clp(suma) + '</b>). Justo después puedes tocar <b>Deshacer</b>.</p>',
    '<button class="btn" onclick="cerrarHoja()">Cancelar</button><button class="btn btn-peligro" id="sel-ok" onclick="selConfirmar(this)"><i class="ti ti-trash"></i>Borrar ' + ids.length + '</button>');
}
function selConfirmar(b){
  var ids = Object.keys(S.sel || {});
  api('borrarMovimientos', [ids, S.periodo], function(r){
    if (!r.ok) { toast(r.error); return; }
    cerrarHoja(); S.sel = null; pintar(r.datos);
    var copia = r.copia;
    toast(r.borrados === 1 ? '1 movimiento borrado' : r.borrados + ' movimientos borrados', function(){ api('restaurarMovimientos', [copia, S.periodo], function(x){ if (!x.ok) { toast(x.error); return; } pintar(x.datos); toast('Listo, se recuperaron'); }, null, sinDeshacer); });
  }, b, function(){ toast('Sin conexión: no se borró. Intenta de nuevo.'); });
}
// Ajustes → Borrar datos: todos los movimientos, o todo para empezar de cero (escribiendo BORRAR)
function ajBorrar(){
  S.borrarQue = S.borrarQue || 'movimientos';
  var op = function(v, t, sub){ return '<label class="radio-f"><input type="radio" name="borrar-que" value="' + v + '"' + (S.borrarQue === v ? ' checked' : '') + ' onchange="S.borrarQue=this.value"><span><b>' + t + '</b><small>' + sub + '</small></span></label>'; };
  abrirHoja('Borrar datos',
    (LOCAL ? '<p class="ayuda">Antes, si quieres, <button type="button" class="enl" onclick="FALocal.hoja(&#39;respaldo&#39;)">haz un respaldo</button>. Esto no se puede deshacer.</p>' : '<p class="ayuda">Esto no se puede deshacer.</p>')
    + op('movimientos', 'Todos los movimientos', 'También las cuentas compartidas. Quedan metas, tarjetas, deudas y fijos.')
    + op('todo', 'Todo, para empezar de cero', 'Movimientos, metas, tarjetas, deudas, fijos y patrimonio.')
    + '<p class="ayuda" style="margin-top:10px">Tus categorías, presupuestos y ajustes se conservan.</p>'
    + '<div class="campo"><label for="borrar-conf">Escribe BORRAR para confirmar</label><input class="inp" id="borrar-conf" autocomplete="off" autocapitalize="characters" spellcheck="false"></div><div class="error" id="borrar-err" role="alert"></div>',
    '<button class="btn" onclick="cerrarHoja()">Cancelar</button><button class="btn btn-peligro" onclick="ajBorrarOk(this)"><i class="ti ti-trash"></i>Borrar</button>');
}
function ajBorrarOk(b){
  var c = el('borrar-conf').value;
  if (c.trim().toUpperCase() !== 'BORRAR') { el('borrar-err').textContent = 'Escribe BORRAR para confirmar.'; el('borrar-conf').focus(); return; }
  api('borrarTodo', [S.borrarQue, c], function(r){
    if (!r.ok) { el('borrar-err').textContent = r.error; return; }
    cerrarHoja(); S.sel = null; pintar(r.datos); toast(S.borrarQue === 'todo' ? 'Listo: se borró todo' : 'Listo: se borraron ' + r.movimientos + ' movimientos');
  }, b);
}

/* ── clasificación automática por descripción (3.9) ── */
// Al escribir «¿En qué?», la categoría se sugiere sola (tus reglas, lo que ya anotaste y el diccionario);
// Enter o «Guardar en …» guarda con ella. Tocar otra categoría la cambia (y la próxima vez se aprende).
function sugerirDesc(texto, tipo){ try { return CLASIF.clasificar(texto, tipo, D.categorias, D.reglasCat || [], (D.aprendido || {})[tipo] || {}); } catch (e) { return ''; } }
function htmlSugerida(r){
  if (!r.sugerida) return '';
  var c = cat(r.sugerida);
  return '<button type="button" class="btn btn-p btn-bloque reg-sug" onclick="guardarSugerida()">' + ico(c.icono, c.color) + '<span>Guardar en <b>' + esc(r.sugerida) + '</b></span></button>';
}
function descEscrita(x){
  var r = S.reg; if (!r) return;
  r.nota = x.value; var antes = r.sugerida;
  r.sugerida = sugerirDesc(x.value, r.tipo);
  if (el('regErr')) el('regErr').textContent = '';
  if (antes === r.sugerida) return;
  el('regSugB').innerHTML = htmlSugerida(r);
  // la sugerida pasa primero y queda marcada en la lista de categorías
  var cs = el('regCats'); if (!cs) return;
  [].forEach.call(cs.children, function(b){ b.classList.toggle('sug', b.getAttribute('data-v') === r.sugerida); });
  var s = cs.querySelector('.sug'); if (s) cs.insertBefore(s, cs.firstChild);
}
function guardarSugerida(){
  var r = S.reg; if (!r) return;
  if (!(Number(r.monto) > 0)) { pedirMonto(); return; }
  if (!r.sugerida) { el('regErr').textContent = 'Toca una categoría para guardar.'; return; }
  r.categoria = r.sugerida; guardarRegistro();
}
// Ajustes → Clasificación automática: tus reglas palabra → categoría
function ajClasif(){
  var R = D.reglasCat || [], cs = D.categorias.filter(function(c){ return c.nombre !== 'Deudas'; });
  var grupos = [['Gasto', 'Gastos'], ['Ingreso', 'Ingresos']].map(function(g){ return { grupo: g[1], items: cs.filter(function(c){ return c.tipo === g[0]; }).map(function(c){ return { v: c.nombre, t: c.nombre }; }) }; });
  abrirHoja('Clasificación automática',
    '<p class="ayuda">Al escribir en qué gastaste («McDonald' + "'" + 's», «botillería»), la categoría se elige sola. Lo que no reconozca, enséñaselo aquí. También aprende de lo que corriges.</p>'
    + (R.length ? '<div class="card lista">' + R.map(function(x){ var c = cat(x[1]); return '<div class="fila">' + ico(c.icono, c.color) + '<span class="tx"><b>' + esc(x[0]) + '</b><small>→ ' + esc(x[1]) + '</small></span><button type="button" class="consejo-x" aria-label="Quitar la regla ' + esc(x[0]) + '" onclick="quitarReglaCat(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(x[0]) + '"><i class="ti ti-x"></i></button></div>'; }).join('') + '</div>' : '')
    + '<div class="etq">Nueva regla</div>' + campoTexto('rc-palabra', 'Si la descripción dice…', '', 'text') + campoTexto('rc-cat', '…va en la categoría', 'Comida fuera', 'select', grupos) + '<div class="error" id="rc-err" role="alert"></div>',
    '<button class="btn" onclick="cerrarHoja()">Listo</button><button class="btn btn-p" onclick="guardarReglaUI(this)"><i class="ti ti-plus"></i>Agregar regla</button>');
}
function guardarReglaUI(b){
  api('guardarReglaCat', [{ palabra: el('rc-palabra').value, categoria: el('rc-cat').value }], function(r){ if (!r.ok) { el('rc-err').textContent = r.error; return; } pintar(r.datos); ajClasif(); toast('Regla guardada'); }, b);
}
function quitarReglaCat(p){ api('guardarReglaCat', [{ palabra: p, quitar: true }], function(r){ if (!r.ok) { toast(r.error); return; } pintar(r.datos); ajClasif(); }); }

/* ── cuentas compartidas (3.6): generar cuenta ──
   El cálculo es el mismo del servidor (dividirCuenta_, insertado tal cual): lo que se ve es lo que se guarda. */
var dividirCuenta = __DIVIDIR__;
var PROPINAS = [0, 10, 15];
function nombreYo(){ return (D.config && D.config.nombre) || 'Yo'; }
function htmlCompartidas(){
  var C = D.compartidas;
  if (!C || !(C.meDeben || C.debo)) return '';
  return '<button class="card cc-ini" onclick="verMas(3)">' + ico('ti-users', '#078C7E') + '<span class="tx"><b>Cuentas compartidas</b><small>'
    + (C.meDeben ? 'Te deben <b class="num cc-pos">' + clp(C.meDeben) + '</b>' : '') + (C.meDeben && C.debo ? ' · ' : '') + (C.debo ? 'Debes <b class="num cc-neg">' + clp(C.debo) + '</b>' : '')
    + '</small></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>';
}
function vistaCuentas(){
  var C = D.compartidas || { meDeben: 0, debo: 0, personas: [], cuentas: [] }, h = '';
  h += '<p class="ayuda cc-ayuda"><i class="ti ti-info-circle" aria-hidden="true"></i> Para dividir una cuenta nueva, toca <b>+</b> y elige <b>Generar cuenta</b>. Aquí ves lo que te deben y lo que debes, y anotas los pagos.</p>';
  h += '<div class="acc" style="margin:0 0 4px"><button class="btn btn-bloque" onclick="formRendir()"><i class="ti ti-receipt-2"></i>Anotar gasto por rendir</button></div><p class="ayuda">Un gasto del trabajo que te devuelven no cuenta como gasto tuyo: queda aquí como lo que te deben hasta que te lo paguen.</p>';
  if (C.meDeben || C.debo) h += '<div class="cc-sal"><div class="card"><small>Te deben</small><b class="num' + (C.meDeben ? ' cc-pos' : '') + '">' + clp(C.meDeben) + '</b></div><div class="card"><small>Debes</small><b class="num' + (C.debo ? ' cc-neg' : '') + '">' + clp(C.debo) + '</b></div></div>';
  h += '<h2>Saldos por persona</h2>';
  h += C.personas.length ? '<div class="card lista">' + C.personas.map(function(p){
    var debe = p.neto >= 0, cuentas = [];
    p.cuentas.forEach(function(x){ if (cuentas.indexOf(x.cuenta) < 0) cuentas.push(x.cuenta); });
    return '<button class="fila toca" onclick="formSaldar(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(p.persona) + '"><span class="ico cc-av" style="background:' + (debe ? '#2E9E5B' : '#D0613A') + '" aria-hidden="true">' + esc(p.persona.charAt(0).toUpperCase()) + '</span><span class="tx"><b>' + esc(p.persona) + '</b><small>' + esc(cuentas.slice(0, 3).join(', ')) + '</small></span><span class="v num ' + (debe ? 'cc-pos' : 'cc-neg') + '">' + clp(Math.abs(p.neto)) + '<small>' + (p.neto === 0 ? 'se compensa' : (debe ? 'te debe' : 'le debes')) + '</small></span></button>';
  }).join('') + '</div>' : '<div class="card vacio"><i class="ti ti-users"></i>Nadie te debe y no le debes a nadie. Cuando generes una cuenta con el botón +, aquí verás quién te debe y cuánto.</div>';
  if (C.cuentas.length) h += '<h2>Últimas cuentas</h2><div class="card lista">' + C.cuentas.map(function(g){
    return '<button class="fila toca" onclick="verCuentaG(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(g.grupo) + '"><span class="tx"><b>' + esc(g.cuenta) + '</b><small>' + fechaCorta(g.fecha) + ' · ' + esc(g.detalle) + '</small></span><span class="v num">' + (g.pendiente > 0 ? clp(g.pendiente) + '<small>pendiente</small>' : '<small>Saldada</small>') + '</span></button>';
  }).join('') + '</div>';
  return h;
}
function nuevaCuenta(){
  var p = Number((D.config || {}).propinaPct); if (isNaN(p)) p = 10;
  var cats = D.categorias.filter(function(c){ return c.tipo === 'Gasto' && c.nombre !== 'Deudas'; });
  var cf = cats.filter(function(c){ return c.nombre === 'Comida fuera'; })[0] || cats[0] || {};
  var medio = leerLocal('medio'); if (D.medios.indexOf(medio) < 0) medio = D.medios.indexOf('Débito') >= 0 ? 'Débito' : D.medios[0];
  S.cc = { paso: 1, nombre: '', fecha: D.hoy, personas: ['Yo'], modo: 0, subtotal: '', items: [{ nombre: '', precio: '', cantidad: 1, de: [0] }], montos: [],
    prop: PROPINAS.indexOf(p) >= 0 ? PROPINAS.indexOf(p) : 3, propOtro: PROPINAS.indexOf(p) >= 0 ? '' : String(p), pagador: 0, categoria: cf.nombre || '', medio: medio || '' };
  abrirHoja('Generar cuenta', '<div class="cc" id="cc-f"></div>', '');
  pintarCuenta();
  setTimeout(function(){ var x = el('cc-nueva'); if (x) x.focus(); }, 80);
}
function pintarCuenta(){
  // 3 pasos (3.7): 1 personas y quién pagó · 2 monto, forma de dividir y propina · 3 resumen y detalles
  var c = S.cc, h = '', ent = function(v){ return String(v == null ? '' : v); }, paso = c.paso || 1;
  h += '<div class="cc-pasos">' + ['Personas', 'Monto', 'Resumen'].map(function(t, i){ var n = i + 1; return '<button type="button" class="cc-paso' + (n === paso ? ' on' : '') + (n < paso ? ' hecho' : '') + '"' + (n < paso ? ' onclick="ccIr(' + n + ')" aria-label="Volver a ' + t + '"' : ' tabindex="-1"') + (n === paso ? ' aria-current="step"' : '') + '><span>' + (n < paso ? '<i class="ti ti-check"></i>' : n) + '</span><em>' + t + '</em></button>'; }).join('') + '</div>';
  if (paso === 1) {
    h += '<p class="cc-preg">¿Quiénes participan y quién pagó?</p>';
    h += '<div class="etq">Personas (' + c.personas.length + ')</div><div class="cc-pers">' + c.personas.map(function(p, i){
      return '<span class="chip on cc-p">' + (i ? esc(p) : 'Yo') + (i ? '<button type="button" aria-label="Quitar a ' + esc(p) + '" onclick="ccQuitarPersona(' + i + ')"><i class="ti ti-x"></i></button>' : '') + '</span>';
    }).join('') + '</div>';
    h += '<div class="cc-add"><input class="inp" id="cc-nueva" maxlength="30" aria-label="Nombre de la persona" placeholder="Nombre (vacío: Persona ' + (c.personas.length + 1) + ')" onkeydown="if (event.key === &#39;Enter&#39;) { event.preventDefault(); ccAgregarPersona(); }"><button type="button" class="btn" onclick="ccAgregarPersona()" aria-label="Agregar persona"><i class="ti ti-user-plus"></i></button></div>';
    var sug = ((D.compartidas || {}).recientes || []).filter(function(n){ return !ccTiene(n); }).slice(0, 8);
    if (sug.length) h += '<div class="cc-sug">' + sug.map(function(n){ return '<button type="button" class="chip" onclick="ccAgregarPersona(this.getAttribute(&#39;data-v&#39;))" data-v="' + esc(n) + '"><i class="ti ti-plus"></i>' + esc(n) + '</button>'; }).join('') + '</div>';
    h += '<div class="etq">¿Quién pagó la cuenta?</div><div class="cc-pers" role="radiogroup" aria-label="Quién pagó">' + c.personas.map(function(p, i){ var on = i === c.pagador; return '<button type="button" class="chip cc-pag" role="radio" aria-checked="' + on + '" aria-pressed="' + on + '" onclick="ccPagador(' + i + ')">' + (on ? '<i class="ti ti-check" aria-hidden="true"></i>' : '') + (i ? esc(p) : 'Yo') + '</button>'; }).join('') + '</div>'
      + (c.personas.length < 2 ? '<p class="ayuda cc-nota">Agrega a las demás personas para elegir quién pagó.</p>' : '');
  }
  if (paso === 2) {
    h += '<p class="cc-preg">¿Cuánto fue y cómo se divide?</p>';
    h += '<div class="etq">Cómo se divide</div>' + seg([['Partes iguales','Iguales'], ['Por consumo','Consumo'], ['Montos a mano','A mano']], c.modo, 'ccModo');
    if (c.modo === 0) h += '<div class="campo"><label for="cc-subtotal">Total de la cuenta, sin propina</label><input class="inp num" id="cc-subtotal" inputmode="numeric" placeholder="$0" value="' + miles(c.subtotal) + '" oninput="this.value = miles(this.value); S.cc.subtotal = this.value; ccCalc()"></div>';
    if (c.modo === 1) h += '<div id="cc-items">' + c.items.map(function(it, k){
      return '<div class="card cc-item"><div class="cc-item-f"><input class="inp" id="cc-it' + k + '" placeholder="Ítem (ej: Pizza)" maxlength="40" aria-label="Ítem" value="' + esc(it.nombre) + '" oninput="S.cc.items[' + k + '].nombre = this.value; ccCalc()">'
        + '<input class="inp num" inputmode="numeric" placeholder="Precio" aria-label="Precio" value="' + miles(it.precio) + '" oninput="this.value = miles(this.value); S.cc.items[' + k + '].precio = this.value; ccCalc()">'
        + '<input class="inp num" inputmode="numeric" aria-label="Cantidad" title="Cantidad" value="' + esc(ent(it.cantidad || 1)) + '" oninput="this.value = this.value.replace(/[^0-9]/g, &#39;&#39;).slice(0, 2); S.cc.items[' + k + '].cantidad = this.value; ccCalc()">'
        + '<button type="button" class="cc-x" aria-label="Quitar ítem" onclick="ccQuitarItem(' + k + ')"><i class="ti ti-trash"></i></button></div>'
        + '<div class="cc-de" role="group" aria-label="Quién lo consumió">' + c.personas.map(function(p, i){ var on = it.de.indexOf(i) >= 0; return '<button type="button" class="chip" aria-pressed="' + on + '" onclick="ccDe(' + k + ', ' + i + ', this)">' + (i ? esc(p) : 'Yo') + '</button>'; }).join('') + '</div></div>';
    }).join('') + '</div><button type="button" class="btn btn-bloque" onclick="ccAgregarItem()"><i class="ti ti-plus"></i>Agregar ítem</button>';
    if (c.modo === 2) h += '<div class="card lista">' + c.personas.map(function(p, i){
      return '<div class="fila-ed"><span class="ed-tx"><b>' + (i ? esc(p) : 'Yo') + '</b></span><span class="pr-m"><input class="inp num" inputmode="numeric" placeholder="$0" aria-label="Cuánto pone ' + esc(i ? p : 'yo') + '" value="' + miles(c.montos[i]) + '" oninput="this.value = miles(this.value); S.cc.montos[' + i + '] = this.value; ccCalc()"><span aria-hidden="true">$</span></span></div>';
    }).join('') + '</div>';
    h += '<div class="etq">Propina</div>' + seg(['Sin', '10 %', '15 %', 'Otra'], c.prop, 'ccProp');
    if (c.prop === 3) h += '<div class="campo"><label for="cc-propina">Propina (%)</label><input class="inp num" id="cc-propina" inputmode="decimal" maxlength="5" value="' + esc(c.propOtro) + '" oninput="S.cc.propOtro = this.value; ccCalc()"></div>';
    h += '<div class="cc-mini" id="cc-mini" aria-live="polite"></div>';
  }
  if (paso === 3) {
    h += '<div id="cc-res" aria-live="polite"></div>';
    h += '<div class="etq">Detalles</div><div class="campo"><label for="cc-nombre">Nombre (opcional)</label><input class="inp" id="cc-nombre" maxlength="40" placeholder="' + esc('Cuenta del ' + fechaCorta(c.fecha)) + '" value="' + esc(c.nombre) + '" oninput="S.cc.nombre = this.value"></div>';
    var ay = new Date(); ay.setDate(ay.getDate() - 1); var isoAy = ay.getFullYear() + '-' + ('0' + (ay.getMonth() + 1)).slice(-2) + '-' + ('0' + ay.getDate()).slice(-2);
    h += '<div class="etq">Fecha</div><div class="chips"><button type="button" class="chip' + (c.fecha === D.hoy ? ' on' : '') + '" onclick="ccFecha(&#39;' + D.hoy + '&#39;)">Hoy</button><button type="button" class="chip' + (c.fecha === isoAy ? ' on' : '') + '" onclick="ccFecha(&#39;' + isoAy + '&#39;)">Ayer</button><input class="inp" type="date" aria-label="Otra fecha" style="width:auto;flex:1;min-width:150px" max="' + D.hoy + '" value="' + esc(c.fecha) + '" onchange="if(this.value)ccFecha(this.value)"></div>';
    h += '<div class="cc-2">';
    h += '<div class="campo"><label for="cc-categoria">Tu parte se anota como gasto en</label><select class="inp" id="cc-categoria" onchange="S.cc.categoria = this.value">' + D.categorias.filter(function(x){ return x.tipo === 'Gasto' && x.nombre !== 'Deudas'; }).map(function(x){ return '<option' + (x.nombre === c.categoria ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('') + '</select></div>';
    h += '<div class="campo"><label for="cc-medio" id="cc-medio-l"></label><select class="inp" id="cc-medio" onchange="S.cc.medio = this.value">' + D.medios.map(function(m){ return '<option' + (m === c.medio ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></div>';
    h += '</div>';
  }
  h += '<div class="error" id="cc-err" role="alert"></div>';
  el('cc-f').innerHTML = h;
  el('hojaP').style.display = '';
  el('hojaP').innerHTML = (paso > 1 ? '<button class="btn" style="flex:0 0 auto" aria-label="Atrás" onclick="ccIr(' + (paso - 1) + ')"><i class="ti ti-chevron-left"></i></button>' : '')
    + (paso === 3 ? '<button class="btn" style="flex:0 0 auto" aria-label="Compartir el detalle" onclick="compartirCuenta()"><i class="ti ti-share"></i></button><button class="btn btn-p" onclick="guardarCuentaUI(this)"><i class="ti ti-check"></i>Guardar</button>'
                   : '<button class="btn btn-p" onclick="ccSiguiente()">Siguiente<i class="ti ti-chevron-right"></i></button>');
  ccMedio(); ccCalc();
}
function ccIr(n){ S.cc.paso = n; pintarCuenta(); el('hojaC').scrollTop = 0; }
function ccSiguiente(){
  var c = S.cc;
  if (c.paso === 1 && c.personas.length < 2) { el('cc-err').textContent = 'Agrega al menos a otra persona.'; var x = el('cc-nueva'); if (x) x.focus(); return; }
  if (c.paso === 2) { var r = dividirCuenta(ccDatos()); if (!r.ok) { el('cc-err').textContent = r.error; return; } }
  ccIr((c.paso || 1) + 1);
}
function ccFecha(v){ S.cc.fecha = v; var y = el('hojaC').scrollTop; pintarCuenta(); el('hojaC').scrollTop = y; }
function ccPagador(i){ S.cc.pagador = i; var y = el('hojaC').scrollTop; pintarCuenta(); el('hojaC').scrollTop = y; }
function ccMedio(){ var c = S.cc, l = el('cc-medio-l'); if (l) l.textContent = c.pagador === 0 ? 'Cómo pagaste' : 'Cómo le pagarás a ' + c.personas[c.pagador]; }
function ccTiene(n){ n = String(n).toLowerCase(); return S.cc.personas.some(function(p){ return p.toLowerCase() === n; }) || (n === 'yo'); }
function ccAgregarPersona(nombre){
  var c = S.cc, x = el('cc-nueva'), n = String(nombre != null ? nombre : (x ? x.value : '')).trim().slice(0, 30);
  if (!n) { var k = c.personas.length + 1; while (ccTiene('Persona ' + k)) k++; n = 'Persona ' + k; }
  if (ccTiene(n)) { el('cc-err').textContent = n + ' ya está en la cuenta.'; return; }
  if (c.personas.length >= 30) { el('cc-err').textContent = 'Hasta 30 personas por cuenta.'; return; }
  var antes = c.personas.length; c.personas.push(n);
  c.items.forEach(function(it){ if (it.de.length === antes) it.de.push(antes); });   // si lo compartían todos, también lo comparte quien llega
  pintarCuenta();
  if (nombre == null) { var y = el('cc-nueva'); if (y) y.focus(); }
}
function ccQuitarPersona(i){
  var c = S.cc; c.personas.splice(i, 1); c.montos.splice(i, 1);
  c.items.forEach(function(it){ it.de = it.de.filter(function(k){ return k !== i; }).map(function(k){ return k > i ? k - 1 : k; }); });
  if (c.pagador === i) c.pagador = 0; else if (c.pagador > i) c.pagador--;
  pintarCuenta();
}
function ccModo(k){ S.cc.modo = k; pintarCuenta(); }
function ccProp(k){ S.cc.prop = k; pintarCuenta(); if (k === 3) { var x = el('cc-propina'); if (x) x.focus(); } }
function ccAgregarItem(){ S.cc.items.push({ nombre: '', precio: '', cantidad: 1, de: S.cc.personas.map(function(p, i){ return i; }) }); pintarCuenta(); var x = el('cc-it' + (S.cc.items.length - 1)); if (x) x.focus(); }
function ccQuitarItem(k){ S.cc.items.splice(k, 1); if (!S.cc.items.length) ccAgregarItem(); else pintarCuenta(); }
function ccDe(k, i, b){ var de = S.cc.items[k].de, p = de.indexOf(i); if (p >= 0) de.splice(p, 1); else de.push(i); b.setAttribute('aria-pressed', String(p < 0)); ccCalc(); }
function ccDatos(){ var c = S.cc; return { personas: c.personas, modo: ['iguales', 'items', 'manual'][c.modo], subtotal: c.subtotal, items: c.items, montos: c.montos, propinaPct: c.prop === 3 ? c.propOtro : PROPINAS[c.prop] }; }
function ccCalc(){
  var c = S.cc, r = dividirCuenta(ccDatos()), box = el('cc-res'), mini = el('cc-mini');
  if (el('cc-err')) el('cc-err').textContent = '';
  if (mini) mini.innerHTML = r.ok ? '<span>Total<b class="num">' + clp(r.total) + '</b></span><span>Tu parte<b class="num">' + clp(r.personas[0].total) + '</b></span>' : '<span class="cc-mini-m">' + esc(r.error) + '</span>';
  if (!box) return r;
  if (!r.ok) { box.innerHTML = '<div class="card cc-aviso">' + esc(r.error) + '</div>'; return r; }
  var h = '<div class="card cc-tabla"><div class="cc-fila cc-cab"><span>Persona</span><span>Consumo</span><span>Propina</span><span>Total</span></div>' + r.personas.map(function(p, i){
    return '<div class="cc-fila"><span>' + (i ? esc(p.nombre) : 'Yo') + (i === c.pagador ? ' <small>pagó</small>' : '') + '</span><span class="num">' + clp(p.consumo) + '</span><span class="num">' + clp(p.propina) + '</span><b class="num">' + clp(p.total) + '</b></div>';
  }).join('') + '<div class="cc-fila cc-tot"><span>Total</span><span class="num">' + clp(r.subtotal) + '</span><span class="num">' + clp(r.propina) + '</span><b class="num">' + clp(r.total) + '</b></div></div>';
  var q = [], mia = r.personas[0].total;
  if (mia > 0) q.push('<i class="ti ti-receipt"></i>Tu parte, <b class="num">' + clp(mia) + '</b>, se anota como gasto');
  if (c.pagador === 0) r.personas.forEach(function(p, i){ if (i && p.total > 0) q.push('<i class="ti ti-arrow-down-left"></i><b>' + esc(p.nombre) + '</b> te debe <b class="num cc-pos">' + clp(p.total) + '</b>'); });
  else if (mia > 0) q.push('<i class="ti ti-arrow-up-right"></i>Le debes a <b>' + esc(c.personas[c.pagador]) + '</b> <b class="num cc-neg">' + clp(mia) + '</b>');
  box.innerHTML = h + '<div class="cc-queda">' + q.map(function(x){ return '<div>' + x + '</div>'; }).join('') + '</div>';
  return r;
}
function guardarCuentaUI(b){
  var r = ccCalc(), c = S.cc;
  if (!r.ok) { el('cc-err').textContent = r.error; return; }
  if (!c.nombre.trim()) c.nombre = 'Cuenta del ' + fechaCorta(c.fecha);
  var copia = JSON.parse(JSON.stringify(c)), d = ccDatos();
  d.nombre = c.nombre; d.fecha = c.fecha; d.pagador = c.pagador; d.categoria = c.categoria; d.medio = c.medio;
  api('guardarCuenta', [d], function(res){
    if (!res.ok) { el('cc-err').textContent = res.error; var f = el('cc-' + res.campo); if (f) f.focus(); return; }
    cerrarHoja(); vibrar(); pintar(res.datos);
    toast('Cuenta guardada', function(){ compartirTexto(textoCuenta(r, copia)); }, 'Compartir');
  }, b);
}
function textoCuenta(r, c){
  var NLc = String.fromCharCode(10), L = [], nom = function(i){ return i ? r.personas[i].nombre : nombreYo(); };
  L.push((c.nombre.trim() || 'Cuenta compartida') + ' · ' + fechaTexto(c.fecha || D.hoy));
  if (r.items.length) { L.push(''); r.items.forEach(function(it){ L.push('• ' + it.nombre + (it.cantidad > 1 ? ' x' + it.cantidad : '') + ': ' + clp(it.total) + ' (' + it.de.map(nom).join(', ') + ')'); }); }
  L.push(''); L.push('Subtotal ' + clp(r.subtotal) + (r.propina ? ' · Propina ' + (r.pct !== null ? r.pct + ' % ' : '') + clp(r.propina) : ' · Sin propina') + ' · Total ' + clp(r.total));
  L.push(''); r.personas.forEach(function(p, i){ L.push(nom(i) + ': ' + clp(p.total)); });
  L.push(''); L.push('Pagó ' + nom(c.pagador) + '.');
  L.push('Hecho con Mis Finanzas · Ambilor.Lab');
  return L.join(NLc);
}
function copiarTexto(t){
  try { navigator.clipboard.writeText(t).then(function(){ toast('Detalle copiado: pégalo en WhatsApp'); }, function(){ window.prompt('Copia el detalle:', t); }); }
  catch (e) { window.prompt('Copia el detalle:', t); }
}
function compartirTexto(t){
  if (window.FA_compartirTexto) { window.FA_compartirTexto(t); return; }
  if (navigator.share) { navigator.share({ text: t }).catch(function(e){ if (!e || e.name !== 'AbortError') copiarTexto(t); }); return; }
  copiarTexto(t);
}
function compartirCuenta(){ var r = ccCalc(); if (!r.ok) { el('cc-err').textContent = r.error; return; } compartirTexto(textoCuenta(r, S.cc)); }
function formSaldar(persona){
  var p = ((D.compartidas || {}).personas || []).filter(function(x){ return x.persona === persona; })[0]; if (!p) return;
  var debe = p.neto >= 0, m = Math.abs(p.neto);
  var h = '<p class="ayuda" style="margin:0 0 10px">' + (m === 0 ? 'Lo que te debe y lo que le debes se compensan.' : (debe ? esc(persona) + ' te debe <b class="num">' + clp(m) + '</b>.' : 'Le debes a ' + esc(persona) + ' <b class="num">' + clp(m) + '</b>.'))
    + ' Este pago no es ingreso ni gasto: tu parte ya se anotó como gasto y esto solo salda la cuenta.</p>';
  h += '<div class="card lista">' + p.cuentas.map(function(x){ return '<div class="fila"><span class="tx"><b>' + esc(x.cuenta) + '</b><small>' + fechaCorta(x.fecha) + ' · ' + (x.sentido === 'Me debe' ? 'te debe' : 'le debes') + '</small></span><span class="v num">' + clp(x.pendiente) + '</span></div>'; }).join('') + '</div>';
  if (m > 0) h += campoTexto('sd-monto', debe ? 'Si te pagó solo una parte, ¿cuánto?' : 'Si le pagaste solo una parte, ¿cuánto?', '', 'numero');
  h += '<div class="error" id="sd-err"></div>';
  abrirHoja(persona, h, (m > 0 ? '<button class="btn" id="sd-abono"><i class="ti ti-coin"></i>Anotar abono</button>' : '') + '<button class="btn btn-p" id="sd-todo"><i class="ti ti-check"></i>' + (m === 0 ? 'Dejar saldado' : (debe ? 'Me pagó todo' : 'Le pagué todo')) + '</button>');
  var listo = function(texto){ return function(r){ if (!r.ok) { el('sd-err').textContent = r.error; return; } cerrarHoja(); vibrar(); toast(texto); pintar(r.datos); }; };
  el('sd-todo').onclick = function(){ api('saldarCompartida', [{ persona: persona }], listo('Listo: saldado con ' + persona), this); };
  if (m > 0) {
    el('sd-monto').oninput = function(){ this.value = miles(this.value); };
    el('sd-abono').onclick = function(){
      var v = el('sd-monto').value.replace(/[^0-9]/g, '');
      if (!v) { el('sd-err').textContent = 'Escribe cuánto se pagó.'; el('sd-monto').focus(); return; }
      api('saldarCompartida', [{ persona: persona, monto: v }], listo('Abono anotado'), this);
    };
  }
}
function verCuentaG(g){
  var x = ((D.compartidas || {}).cuentas || []).filter(function(c){ return c.grupo === g; })[0]; if (!x) return;
  var h = '<p class="ayuda" style="margin:0 0 10px">' + fechaTexto(x.fecha) + ' · ' + esc(x.detalle) + '</p><div class="card lista">' + x.personas.map(function(p){
    return '<div class="fila"><span class="tx"><b>' + esc(p.persona) + '</b><small>' + (p.sentido === 'Me debe' ? 'te debía ' : 'le debías ') + clp(p.monto) + '</small></span><span class="v num">' + (p.pendiente > 0 ? clp(p.pendiente) + '<small>pendiente</small>' : '<small>Pagado</small>') + '</span></div>';
  }).join('') + '</div><p class="ayuda">Borrar la cuenta quita también el gasto de tu parte.</p><div class="error" id="cg-err"></div>';
  abrirHoja(x.cuenta, h, '<button class="btn btn-peligro" id="cg-borrar"><i class="ti ti-trash"></i>Borrar cuenta</button>');
  el('cg-borrar').onclick = function(){
    if (!this.getAttribute('data-ok')) { this.setAttribute('data-ok', '1'); this.innerHTML = '<i class="ti ti-trash"></i>¿Borrar la cuenta y su gasto?'; return; }
    api('quitarCuenta', [g], function(r){ if (!r.ok) { el('cg-err').textContent = r.error; return; } cerrarHoja(); toast('Cuenta borrada'); pintar(r.datos); }, this);
  };
}

// Abre al instante con lo último que se vio en este teléfono y lo actualiza al llegar la respuesta
(function(){
  var h = new Date(), hoy = h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2) + '-' + ('0' + h.getDate()).slice(-2);
  if (!LOCAL) try { var g = JSON.parse(leerLocal('datos') || 'null'); if (g && g.ok && g.version === VERSION_PANEL && g.hoy === hoy) pintar(g, true); } catch (e) {}
  cargar();
})();
</script>
</body></html>
`).replace("__VERSION__", VERSION).replace("__DIVIDIR__", () => dividirCuenta_.toString()).replace("__CARTOLA__", () => herramientasCartola_.toString()).replace("__CLASIF__", () => clasificador_.toString());
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

  var PERMITIDAS_APP_ = { panelDatos: panelDatos, registrar: registrar, editarMovimiento: editarMovimiento, borrarMovimiento: borrarMovimiento, guardarCategorias: guardarCategorias, guardarCategoria: guardarCategoria, quitarCategoria: quitarCategoria, guardarPresupuestos: guardarPresupuestos, guardarConfig: guardarConfig, quitar: quitar, cargarEjemplo: cargarEjemplo, borrarEjemplo: borrarEjemplo, guardarMeta: guardarMeta, guardarTarjeta: guardarTarjeta, guardarDeuda: guardarDeuda, guardarFijo: guardarFijo, descartarSuscripcion: descartarSuscripcion, guardarCuenta: guardarCuenta, saldarCompartida: saldarCompartida, quitarCuenta: quitarCuenta, guardarActivo: guardarActivo, movimientosEtiqueta: movimientosEtiqueta, guardarRendicion: guardarRendicion, preguntar: preguntar, prepararImportacion: prepararImportacion, importarMovimientos: importarMovimientos, sugerirCategoria: sugerirCategoria, analizarMeses: analizarMeses, borrarMovimientos: borrarMovimientos, restaurarMovimientos: restaurarMovimientos, borrarTodo: borrarTodo, guardarReglaCat: guardarReglaCat };
  return {
    VERSION: VERSION, HOJA: HOJA, CABECERAS: CABECERAS, EJ: EJ_,
    llamar: function (nombre, args) {
      if (!Object.prototype.hasOwnProperty.call(PERMITIDAS_APP_, nombre)) throw new Error("Función no disponible en la app: " + nombre);
      return PERMITIDAS_APP_[nombre].apply(null, args || []);
    },
  };
};
