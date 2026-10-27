// Mis Finanzas · app del teléfono (sin Google)
// El panel (index.html) y las reglas (motor.js) son los mismos de la versión de Google; este archivo:
//   · reemplaza google.script.run: cada llamada corre en el motor local y la "planilla" se guarda en el teléfono (IndexedDB);
//   · atajos: ?a=registrar (abre el registro), con tipo/monto/categoria/medio/nota, y guardar=1 para anotar directo;
//   · clave obligatoria: los datos se guardan CIFRADOS (AES-256-GCM); la llave de datos va cifrada con la clave (PBKDF2);
//   · respaldo en archivo cifrado con contraseña (con aviso) y envío opcional de movimientos a la planilla de Google.
(function () {
  "use strict";
  window.FA_LOCAL = true;
  // App nativa (Capacitor, Android/iOS) o web. En la nativa los plugins se piden por nombre a capacitor.js.
  const NATIVO = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  const PLATAFORMA = NATIVO ? window.Capacitor.getPlatform() : "web";
  const plugin = n => (NATIVO && window.capacitorExports ? window.capacitorExports.registerPlugin(n) : null);
  // Registro de fallas para la marcha blanca: solo el mensaje técnico (nunca datos ni montos), las últimas 20
  const FALLAS = [];
  try { JSON.parse(localStorage.getItem("fa_fallas") || "[]").slice(-20).forEach(x => FALLAS.push(x)); } catch (e) {}
  function anotarFalla(msg) {
    FALLAS.push({ t: new Date().toISOString(), m: String(msg || "error").slice(0, 300) });
    while (FALLAS.length > 20) FALLAS.shift();
    try { localStorage.setItem("fa_fallas", JSON.stringify(FALLAS)); } catch (e) {}
  }
  window.addEventListener("error", e => anotarFalla((e.message || "error") + (e.filename ? " @ " + String(e.filename).split("/").pop() + ":" + e.lineno : "")));
  window.addEventListener("unhandledrejection", e => anotarFalla("promesa: " + ((e.reason && e.reason.message) || e.reason)));
  // La pantalla parte tapada hasta poner la clave (sin dejar ver nada ni un instante)
  document.documentElement.classList.add("fa-bloqueada");
  document.write("<style>.fa-bloqueada body>*:not(#fa-bloqueo){visibility:hidden}</style>");

  const BASE = "mis-finanzas-telefono", ALMACEN = "kv";
  const DIAS_AVISO_RESPALDO = 7;
  const RE_PANEL = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[^/?#]+)\/s\/[\w-]+\/exec$/;
  const SOLO_LECTURA = { panelDatos: true };

  const E = { motor: null, ss: null, props: null, dek: null, llave: null, respaldo: "", planilla: "", enviados: {}, errores: [], avisoRetorno: "" };
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const hoyIso = () => { const h = new Date(); return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0") + "-" + String(h.getDate()).padStart(2, "0"); };
  const avisar = (t, fn, txt) => { if (typeof window.toast === "function") window.toast(t, fn, txt); };

  /* ── guardar en el teléfono (IndexedDB, clave → valor) ── */
  let conexion = null;
  function db() {
    if (conexion) return conexion;
    conexion = new Promise((ok, mal) => {
      const r = indexedDB.open(BASE, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(ALMACEN)) r.result.createObjectStore(ALMACEN); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { conexion = null; mal(r.error); };
    });
    return conexion;
  }
  function kv(modo, fn) {
    return db().then(d => new Promise((ok, mal) => {
      const tx = d.transaction(ALMACEN, modo), req = fn(tx.objectStore(ALMACEN));
      tx.oncomplete = () => ok(req.result); tx.onerror = () => mal(tx.error); tx.onabort = () => mal(tx.error);
    }));
  }
  const leer = k => kv("readonly", o => o.get(k));
  const escribir = (k, v) => kv("readwrite", o => o.put(v, k));

  /* ── cifrado (Web Crypto) ── */
  // Una llave de datos al azar (AES-256-GCM) cifra lo guardado; esa llave se guarda envuelta con una llave que sale
  // de la clave (PBKDF2-SHA256). Cambiar la clave solo vuelve a envolver la llave de datos.
  const ITER = 600000, MIN_CLAVE = 6, MIN_RESPALDO = 8;
  const enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf) { const u = new Uint8Array(buf); let t = ""; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(t); }
  function deB64(t) { const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  const azar = n => crypto.getRandomValues(new Uint8Array(n));
  async function derivar(clave, sal, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(String(clave).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
  }
  async function cifrar(llave, texto) {
    const iv = azar(12), ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, llave, enc.encode(texto));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function descifrar(llave, o) { return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(o.iv) }, llave, deB64(o.ct))); }
  async function envolver(dek, clave) {
    const sal = azar(16), iv = azar(12), kek = await derivar(clave, sal, ITER);
    return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, sal: b64(sal), iv: b64(iv), envuelta: b64(await crypto.subtle.wrapKey("raw", dek, kek, { name: "AES-GCM", iv: iv })) };
  }
  // Falla (clave equivocada) si la llave envuelta no se puede abrir: AES-GCM verifica la integridad
  async function desenvolver(llave, clave, exportable) {
    const kek = await derivar(clave, deB64(llave.sal), llave.iter);
    return crypto.subtle.unwrapKey("raw", deB64(llave.envuelta), kek, { name: "AES-GCM", iv: deB64(llave.iv) }, { name: "AES-GCM" }, !!exportable, ["encrypt", "decrypt"]);
  }
  async function crearLlave(clave) {
    const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const llave = await envolver(dek, clave);
    await escribir("llave", llave);
    return { llave: llave, dek: await desenvolver(llave, clave, false) };   // en memoria queda una copia no exportable
  }

  /* ── anotar sin clave: la bandeja ── */
  // Lo que se anota desde un atajo con la app bloqueada se cifra con una llave PÚBLICA (ECDH P-256 + AES-GCM): el
  // teléfono puede guardar el gasto sin la clave, pero solo se lee con la llave privada, que va cifrada con la llave
  // de datos. Al entrar con la clave, lo de la bandeja se suma a los movimientos (el cid evita duplicados).
  // Sin clave quedan legibles solo los nombres de categorías y medios de pago (para elegir), nunca montos ni movimientos.
  const ECDH = { name: "ECDH", namedCurve: "P-256" }, MAX_BANDEJA = 300;
  async function prepararBandeja() {
    if ((await leer("bandejaPub")) && (await leer("bandejaPriv"))) return;
    const par = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
    await escribir("bandejaPriv", await cifrar(E.dek, b64(await crypto.subtle.exportKey("pkcs8", par.privateKey))));
    await escribir("bandejaPub", await crypto.subtle.exportKey("jwk", par.publicKey));
  }
  const llaveComun = (priv, pub, uso) => crypto.subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, [uso]);
  // agrega al final de la bandeja (leer y escribir en la misma transacción)
  const sumarABandeja = o => kv("readwrite", s => { const r = s.get("bandeja"); r.onsuccess = () => s.put((r.result || []).concat([o]), "bandeja"); return r; });
  async function aBandeja(d) {
    const pubJwk = await leer("bandejaPub"); if (!pubJwk) throw new Error("sin llave de bandeja");
    if (((await leer("bandeja")) || []).length >= MAX_BANDEJA) throw new Error("bandeja llena");
    const pub = await crypto.subtle.importKey("jwk", pubJwk, ECDH, false, []);
    const efimera = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
    const o = await cifrar(await llaveComun(efimera.privateKey, pub, "encrypt"), JSON.stringify(d));
    o.epk = await crypto.subtle.exportKey("jwk", efimera.publicKey);
    await sumarABandeja(o);
  }
  // Con la app abierta: suma la bandeja. Lo que no calza (una categoría que ya no existe) se abre en el registro, de a uno.
  async function vaciarBandeja() {
    const lista = (await leer("bandeja")) || [], privC = await leer("bandejaPriv");
    if (!lista.length || !privC) return;
    const priv = await crypto.subtle.importKey("pkcs8", deB64(await descifrar(E.dek, privC)), ECDH, false, ["deriveKey"]);
    let ok = 0; const quedan = [], revisar = [];
    for (const o of lista) {
      let d;
      try { d = JSON.parse(await descifrar(await llaveComun(priv, await crypto.subtle.importKey("jwk", o.epk, ECDH, false, []), "decrypt"), o)); }
      catch (e) { anotarFalla("bandeja: " + e.message); continue; }   // dañado: no se podrá leer nunca
      let r; try { r = E.motor.llamar("registrar", [d]); } catch (e) { r = null; }
      if (r && r.ok) ok++;
      else { quedan.push(o); revisar.push({ d: d, iv: o.iv }); }   // sin categoría (o una que ya no existe): se completa en el registro
    }
    if (ok) await guardarLibro();
    // se quitan los procesados; lo que llegó mientras tanto se conserva
    await kv("readwrite", s => { const r = s.get("bandeja"); r.onsuccess = () => s.put(quedan.concat((r.result || []).slice(lista.length)), "bandeja"); return r; });
    if (ok) setTimeout(() => avisar(ok === 1 ? "Se sumó 1 movimiento anotado con el atajo" : "Se sumaron " + ok + " movimientos anotados con el atajo"), 1200);
    if (revisar.length) { E.revision = revisar; setTimeout(siguienteRevision, ok ? 3500 : 600); }
  }
  // Lo anotado sin categoría se abre en el registro, de a uno: al guardarlo sale de la bandeja y se abre el siguiente.
  // Si la persona cierra el registro sin guardar, queda en la bandeja para la próxima vez.
  function siguienteRevision() {
    const x = E.revision && E.revision[0]; if (!x) { E.revision = null; return; }
    const pre = { fecha: x.d.fecha }; ["tipo", "monto", "categoria", "medio", "nota"].forEach(k => { if (x.d[k]) pre[k] = String(x.d[k]); });
    const t = setInterval(() => {
      if (!window.D || typeof window.abrirRegistro !== "function") return;
      clearInterval(t); window.abrirRegistro(pre);
      const n = E.revision.length;
      avisar("Elige la categoría de lo que anotaste con el atajo" + (n > 1 ? " (quedan " + n + ")" : ""));
    }, 200);
    setTimeout(() => clearInterval(t), 8000);
  }
  async function revisionHecha(d) {
    const x = E.revision && E.revision[0];
    if (!x || !d || String(d.tipo || "Gasto") !== String(x.d.tipo || "Gasto") || Number(d.monto) !== Number(x.d.monto)) return;
    E.revision.shift();
    await kv("readwrite", s => { const r = s.get("bandeja"); r.onsuccess = () => s.put((r.result || []).filter(o => o.iv !== x.iv), "bandeja"); return r; });
    setTimeout(siguienteRevision, 900);
  }
  // Nombres de categorías y medios, legibles sin clave, para la ventanita del atajo (si la persona lo permite en Ajustes)
  let catalogoVisto = "";
  function guardarCatalogo(D) {
    if (E.nombresAtajo === false || !D || !Array.isArray(D.categorias) || !Array.isArray(D.medios)) return;
    const n = t => D.categorias.filter(c => c && c.tipo === t).map(c => String(c.nombre));
    const c = { Gasto: n("Gasto"), Ingreso: n("Ingreso"), medios: D.medios.map(String) }, t = JSON.stringify(c);
    if (t === catalogoVisto) return;
    catalogoVisto = t; escribir("catalogo", c).catch(() => {});
  }

  /* ── la planilla en memoria ⇄ el teléfono ── */
  function aGuardar(ss) {
    return ss.hojas.map(h => ({ nombre: h.nombre, oculta: !!h.oculta,
      datos: h.datos.map(f => (f || []).map(v => (v instanceof Date ? { $d: v.getTime() } : v))) }));
  }
  function revivir(hojas) {
    return (hojas || []).map(h => ({ nombre: String(h.nombre), oculta: !!h.oculta,
      datos: (h.datos || []).map(f => (f || []).map(v => (v && typeof v === "object" && typeof v.$d === "number" ? new Date(v.$d) : v))) }));
  }
  let cadena = Promise.resolve();
  function guardarLibro() {
    const texto = JSON.stringify({ hojas: aGuardar(E.ss), props: E.props.getProperties(), guardado: new Date().toISOString() });
    cadena = cadena.then(() => cifrar(E.dek, texto)).then(o => escribir("libroCifrado", o)).catch(err => {
      console.error(err);
      avisar("No se pudo guardar en el teléfono. Haz un respaldo ahora.", () => FALocal.respaldar(), "Respaldar");
    });
    return cadena;
  }

  function fechaGs(fecha, tz, fmt) {
    const d = fecha instanceof Date ? fecha : new Date(fecha), p = n => String(n).padStart(2, "0");
    const m = { yyyy: d.getFullYear(), MM: p(d.getMonth() + 1), dd: p(d.getDate()), HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()) };
    return String(fmt).replace(/yyyy|MM|dd|HH|mm|ss/g, k => m[k]);
  }

  function crearLibro(guardado) {
    const env = window.GasFakes.crearEntorno({ nombre: "Mis Finanzas", url: "", props: guardado ? guardado.props : {} });
    revivir(guardado && guardado.hojas).forEach(h => {
      const hoja = new window.GasFakes.HojaFake(h.nombre, h.datos); hoja.oculta = h.oculta; env.ss.hojas.push(hoja);
    });
    const s = env.servicios || env;
    // lo propio del teléfono: zona horaria, códigos únicos de verdad (el simulador repite los suyos) y fechas
    s.Session.getScriptTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Santiago";
    s.Utilities.getUuid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""));
    s.Utilities.formatDate = fechaGs;
    E.ss = env.ss;
    E.props = s.PropertiesService.getScriptProperties();
    E.motor = window.FA_crearMotor(s);
  }

  // Valor de la UF del día (mindicador.cl). Sin internet, el motor usa el último conocido o el de Ajustes.
  async function traerUF() {
    try {
      const hoy = hoyIso(), g = JSON.parse(E.props.getProperty("FA_UF") || "null");
      if ((g && g.fecha === hoy) || !navigator.onLine) return;
      const p = hoy.split("-"), ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("https://mindicador.cl/api/uf/" + p[2] + "-" + p[1] + "-" + p[0], { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json(), v = j && j.serie && j.serie[0] ? Number(j.serie[0].valor) : 0;
      if (v > 0) { E.props.setProperty("FA_UF", JSON.stringify({ valor: v, fecha: hoy })); guardarLibro(); }
    } catch (e) { /* sin conexión o sin permiso: se usa el último valor */ }
  }

  const listo = (async () => {
    let viejo = null, cifrado = null;
    try { localStorage.removeItem("fa_datos"); localStorage.removeItem("fa_pin_on"); } catch (e) {}   // copias sin cifrar de versiones anteriores
    try {
      const [llave, libroViejo, libroCifrado, respaldo, planilla, enviados, errores] =
        await Promise.all(["llave", "libro", "libroCifrado", "respaldo", "planilla", "enviados", "envioErrores"].map(leer));
      Object.assign(E, { llave: llave || null, respaldo: respaldo || "", planilla: planilla || "", enviados: enviados || {}, errores: errores || [] });
      viejo = libroViejo || null; cifrado = libroCifrado || null;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (err) {
      console.error(err);
      setTimeout(() => avisar("Este navegador no deja guardar datos (¿modo incógnito?). Lo que anotes se perderá al cerrar."), 1500);
    }
    await new Promise(r => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r) : r()));
    if (NATIVO) { escucharEnlaces(); escucharAvisos(); }
    try { E.nombresAtajo = (await leer("atajoNombres")) !== false; } catch (e) {}
    try { E.avisos = Object.assign({}, AVISOS_BASE, (await leer("avisos")) || {}); } catch (e) {}
    try { E.widgetSaldo = (await leer("widgetSaldo")) === true; } catch (e) {}
    if (E.llave && !viejo) await capturaAlAbrir();   // abierta desde un atajo: anota sin pedir la clave
    E.dek = await pedirClave(E.llave ? "abrir" : "crear", !!viejo);
    let guardado = viejo;
    if (cifrado) guardado = JSON.parse(await descifrar(E.dek, cifrado));
    crearLibro(guardado);
    if (viejo) {   // los datos de antes de 3.1 (sin cifrar) se cifran y se borra la copia legible
      await guardarLibro(); await kv("readwrite", o => o.delete("libro")); await kv("readwrite", o => o.delete("pin"));
    }
    desbloquearPantalla();
    try { await prepararBandeja(); await vaciarBandeja(); } catch (e) { anotarFalla("bandeja: " + e.message); }
    await revisarHuella();
    await traerUF();
    await procesarRetorno();
    await atajoDirecto();
    if (NATIVO) atajosNativos();
  })();

  /* ── google.script.run local ── */
  const clonar = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  function crearRun(ok, mal) {
    return new Proxy({}, {
      get(_, nombre) {
        if (nombre === "withSuccessHandler") return f => crearRun(f, mal);
        if (nombre === "withFailureHandler") return f => crearRun(ok, f);
        if (nombre === "withUserObject") return () => crearRun(ok, mal);
        return function () {
          const args = clonar(Array.prototype.slice.call(arguments));
          listo.then(() => {
            let res;
            try { res = clonar(E.motor.llamar(String(nombre), args)); }
            catch (err) { console.error(err); if (mal) setTimeout(() => mal(err)); return; }
            if (res && typeof res === "object") { const D = res.categorias ? res : res.datos; guardarCatalogo(D); programarAvisos(D); actualizarWidget(D); }
            if (nombre === "registrar" && res && res.ok && E.revision) revisionHecha(args[0]).catch(e => anotarFalla("bandeja: " + e.message));
            const fin = () => { if (ok) ok(res); };
            if (SOLO_LECTURA[nombre]) setTimeout(fin); else guardarLibro().then(fin);
          }, err => { if (mal) mal(err); });
        };
      },
    });
  }
  window.google = { script: {
    run: crearRun(null, null),
    url: { getLocation: cb => setTimeout(() => cb({ hash: location.hash.replace(/^#/, ""), parameter: {}, parameters: {} })) },
  } };

  /* ── atajos por enlace ── */
  const q = new URLSearchParams(location.search);
  const PRE = {};
  const GUARDAR_DIRECTO = q.get("a") === "registrar" && q.get("guardar") === "1" && !!q.get("monto");
  if (q.get("a") === "registrar" || q.get("a") === "anotar") {
    if (!GUARDAR_DIRECTO) window.FA_ACCION = "registrar";
    ["tipo", "categoria", "medio", "nota"].forEach(k => { if (q.get(k)) PRE[k] = q.get(k).slice(0, 120); });
    const monto = String(q.get("monto") || "").replace(/\D/g, "").slice(0, 10);
    if (monto) PRE.monto = monto;
    window.FA_PRE = PRE;
  }
  if (location.search) history.replaceState(null, "", location.pathname + location.hash);

  // ?a=registrar&…&guardar=1: anota sin abrir el registro; si algo no calza, abre el registro relleno
  async function atajoDirecto() {
    if (!GUARDAR_DIRECTO || E.capturado) return;
    const d = Object.assign({ tipo: "Gasto", fecha: hoyIso(), cid: codigo() }, PRE);
    let r;
    try { r = E.motor.llamar("registrar", [d]); } catch (e) { r = { ok: false }; }
    if (!r || !r.ok) {
      // algo no calza (categoría, medio…): se abre el registro relleno para completarlo
      const t = setInterval(() => { if (window.D && typeof window.abrirRegistro === "function") { clearInterval(t); window.abrirRegistro(PRE); } }, 200);
      setTimeout(() => clearInterval(t), 8000);
      return;
    }
    await guardarLibro();
    setTimeout(() => avisar("Anotado: " + (d.nota || d.categoria || d.tipo) + " $" + Number(d.monto).toLocaleString("es-CL"), () => {
      window.google.script.run.withSuccessHandler(res => { if (res && res.ok && typeof window.pintar === "function") window.pintar(res.datos); avisar("Listo, se deshizo"); }).borrarMovimiento(r.id, null);
    }, "Deshacer"), 900);
  }
  // App nativa: atajos del ícono (Android) y enlaces misfinanzas://registrar?tipo=…&monto=…&categoria=…&guardar=1
  // (los mismos parámetros que ?a=registrar en la web). El enlace con que se abrió la app se procesa una sola vez
  // por sesión: si la app se recarga (por ejemplo, al pedir la clave de nuevo) no se vuelve a anotar.
  function preDe(params) {
    const pre = {};
    ["tipo", "categoria", "medio", "nota"].forEach(k => { if (params.get(k)) pre[k] = params.get(k).slice(0, 120); });
    const monto = String(params.get("monto") || "").replace(/\D/g, "").slice(0, 10);
    if (monto) pre.monto = monto;
    return pre;
  }
  async function abrirEnlace(url) {
    let u; try { u = new URL(url); } catch (e) { return; }
    if (u.protocol !== "misfinanzas:" || ["registrar", "anotar"].indexOf(rutaDe(u)) < 0) return;
    const pre = preDe(u.searchParams);
    if (u.searchParams.get("guardar") === "1" && pre.monto) {
      const d = Object.assign({ tipo: "Gasto", fecha: hoyIso(), cid: codigo() }, pre);
      let r; try { r = E.motor.llamar("registrar", [d]); } catch (e) { r = null; }
      if (r && r.ok) {
        await guardarLibro();
        if (typeof window.cargar === "function") window.cargar();
        setTimeout(() => avisar("Anotado: " + (d.nota || d.categoria || d.tipo) + " $" + Number(d.monto).toLocaleString("es-CL")), 600);
        return;
      }
    }
    const t = setInterval(() => { if (window.D && typeof window.abrirRegistro === "function") { clearInterval(t); window.abrirRegistro(pre); } }, 200);
    setTimeout(() => clearInterval(t), 8000);
  }
  const rutaDe = u => (u.hostname || u.pathname.replace(/^\/+/, "")).split(/[/?#]/)[0];
  // Con la app ya abierta: el enlace con que se abrió (si no lo tomó la ventanita del atajo)
  async function atajosNativos() {
    const url = E.enlacePendiente || E.enlaceAviso; E.enlacePendiente = ""; E.enlaceAviso = "";
    if (url) { try { await abrirEnlace(url); } catch (e) { anotarFalla("atajo: " + e.message); } }
  }
  // Un enlace que llega con la app en segundo plano se anota primero en la sesión: si la app se vuelve a bloquear
  // (y se recarga) justo en ese momento, se retoma al abrir.
  function escucharEnlaces() {
    const App = plugin("App"); if (!App) return;
    App.addListener("appUrlOpen", ev => {
      if (!ev || !ev.url) return;
      try { sessionStorage.setItem("fa_enlace_nuevo", ev.url); } catch (e) {}
      if (E.dek && !E.recargando) { try { sessionStorage.removeItem("fa_enlace_nuevo"); } catch (e) {} abrirEnlace(ev.url); }
    });
  }
  // Tocar un aviso (3.4): con la app abierta, va directo; si estaba bloqueada, al entrar con la clave
  function escucharAvisos() {
    const LN = plugin("LocalNotifications"); if (!LN) return;
    LN.addListener("localNotificationActionPerformed", ev => {
      const url = ev && ev.notification && ev.notification.extra && ev.notification.extra.url;
      if (!url) return;
      if (E.dek && !E.recargando) abrirEnlace(url); else E.enlaceAviso = url;
    });
  }

  /* ── avisos en el teléfono (3.4, app nativa) ── */
  // Se calculan en el teléfono con lo que el panel ya armó (pagos que vencen, fijos, racha) y se programan al entrar
  // y después de cada cambio. Sin «detalle», el texto no nombra tarjetas ni montos: lo que queda programado en el
  // sistema (y lo que se ve con la pantalla bloqueada) no dice nada privado.
  const AVISOS_BASE = { on: false, hora: 21, pagos: true, respaldo: true, detalle: false };
  E.avisos = Object.assign({}, AVISOS_BASE);
  function avisosDe(D, o, ahora, respaldo) {
    const out = [], dos = n => String(n).padStart(2, "0");
    const iso = d => d.getFullYear() + "-" + dos(d.getMonth() + 1) + "-" + dos(d.getDate());
    const a = (t, h) => { const p = t.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2], h, 0, 0); };
    const dia = n => iso(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + n, 12));
    const abrir = { url: "misfinanzas://anotar?tipo=Gasto" };
    // 1. recordatorio: los próximos 7 días a la hora elegida (hoy no, si ya anotaste algo)
    if (o.hora >= 1 && o.hora <= 23) {
      for (let i = D.racha && D.racha.hoy ? 1 : 0; i < 7; i++) {
        const at = a(dia(i), o.hora);
        if (at > ahora) out.push({ id: 1000 + i, title: "¿Anotaste tus gastos de hoy?", body: "Toca para anotar. Toma un segundo.", schedule: { at: at, allowWhileIdle: true }, extra: abrir });
      }
    }
    // 2. pagos de tarjetas y deudas que vencen pronto, y fijos del mes sin registrar: el día antes a las 9:00
    if (o.pagos) {
      const hoy = dia(0);
      const pagos = (D.proximos || []).map(p => ({ nombre: p.nombre, fecha: p.fecha, monto: p.monto }))
        .concat((D.fijos || []).filter(x => !x.registrado && x.tipo === "Gasto" && x.fecha >= hoy).map(x => ({ nombre: x.nombre, fecha: x.fecha, monto: x.monto })));
      pagos.slice(0, 40).forEach((p, k) => {
        let at = a(p.fecha, 9), cuando = "Hoy vence";
        const antes = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1, 9);
        if (antes > ahora) { at = antes; cuando = "Mañana vence"; } else if (at <= ahora) return;
        out.push({ id: 1100 + k, title: o.detalle ? cuando + ": " + p.nombre : cuando + " un pago",
          body: o.detalle && p.monto ? pesos(p.monto) + " · toca para revisarlo" : "Toca para revisarlo en Mis Finanzas.",
          schedule: { at: at, allowWhileIdle: true }, extra: { url: "" } });
      });
    }
    // 3. respaldo: a los 7 días del último (si nunca se hizo, mañana), a las 20:00
    if (o.respaldo) {
      let at = respaldo ? new Date(new Date(respaldo).getTime() + DIAS_AVISO_RESPALDO * 86400000) : a(dia(1), 20);
      at = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 20);
      if (at <= ahora) at = a(dia(ahora.getHours() < 20 ? 0 : 1), 20);
      out.push({ id: 1200, title: "Haz un respaldo de Mis Finanzas", body: respaldo ? "Pasó una semana desde el último. Tus datos viven solo en este teléfono." : "Todavía no tienes respaldo. Tus datos viven solo en este teléfono.", schedule: { at: at, allowWhileIdle: true }, extra: { url: "" } });
    }
    return out;
  }
  let avisosTimer = 0;
  function programarAvisos(D) {
    if (!NATIVO) return;
    if (E.avisos.on && (!D || !D.resumen || D.actual !== D.resumen.periodo.indice)) return;   // apagados: igual se borran
    clearTimeout(avisosTimer);
    avisosTimer = setTimeout(() => aplicarAvisos(D).catch(e => anotarFalla("avisos: " + (e && e.message))), 1200);
  }
  async function aplicarAvisos(D) {
    const LN = plugin("LocalNotifications"); if (!LN) return;
    const p = await LN.getPending();
    const nuestros = ((p && p.notifications) || []).filter(n => n.id >= 1000 && n.id < 1300).map(n => ({ id: n.id }));
    if (nuestros.length) await LN.cancel({ notifications: nuestros });
    if (!E.avisos.on) return;
    if (PLATAFORMA === "android") await LN.createChannel({ id: "avisos", name: "Avisos de Mis Finanzas", description: "Recordatorio diario, pagos que vencen y respaldo", importance: 3 });
    const lista = avisosDe(D, E.avisos, new Date(), E.respaldo);
    if (lista.length) await LN.schedule({ notifications: lista.map(n => Object.assign({ channelId: "avisos" }, n)) });
  }

  /* ── widget de la pantalla de inicio (3.4, Android) ── */
  // El botón «Anotar gasto» funciona siempre. El monto solo se le pasa si la persona lo activa (Ajustes → Widget):
  // con presupuesto, lo que queda y el último día del mes (el widget divide por los días que faltan, cada día);
  // sin presupuesto, lo disponible del mes. Apagado, el teléfono no guarda ningún monto legible.
  function widgetDe(D, mostrar) {
    if (!mostrar || !D || !D.resumen || D.actual !== D.resumen.periodo.indice) return { mostrar: false };
    const r = D.resumen;
    return r.presupuestoTotal > 0 ? { mostrar: true, modo: "dia", monto: Math.max(0, r.presupuestoRestante), hasta: r.periodo.hasta }
      : { mostrar: true, modo: "mes", monto: r.disponible, hasta: r.periodo.hasta };
  }
  let widgetVisto = "";
  function actualizarWidget(D) {
    if (PLATAFORMA !== "android") return;
    if (E.widgetSaldo && (!D || !D.resumen || D.actual !== D.resumen.periodo.indice)) return;   // mirando otro mes: no se toca
    const w = widgetDe(D, E.widgetSaldo), t = JSON.stringify(w);
    if (t === widgetVisto) return;
    widgetVisto = t;
    const P = plugin("Widget"); if (P) P.actualizar(w).catch(e => anotarFalla("widget: " + (e && e.message)));
  }

  /* ── vibración al guardar y lector de boletas (3.4) ── */
  if (NATIVO) window.FA_vibrar = () => { const H = plugin("Haptics"); if (H) H.impact({ style: "LIGHT" }).catch(() => {}); };
  // Boleta o factura electrónica: el código PDF417 del timbre del SII (Instructivo Emisión DTE, anexo 2) trae
  // <DD> con RUT del emisor (RE), tipo (TD), folio (F), fecha de emisión (FE, AAAA-MM-DD), monto total (MNT,
  // pesos enteros) y el primer ítem (IT1); el CAF de adentro trae la razón social del emisor (RS). Todo en el teléfono.
  function leerTimbre(texto) {
    const t = String(texto || ""), dd = (t.match(/<DD>([\s\S]*?)<CAF/) || [])[1] || t;
    const tag = (s, n) => { const m = s.match(new RegExp("<" + n + ">([^<]*)</" + n + ">")); return m ? m[1].replace(/\s+/g, " ").trim() : ""; };
    const monto = Number(tag(dd, "MNT")), fecha = tag(dd, "FE");
    if (!(monto > 0) || monto > 999999999 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
    return { monto: Math.round(monto), fecha: fecha, tipo: tag(dd, "TD"), rut: tag(dd, "RE"), item: tag(dd, "IT1"), comercio: tag(t, "RS") };
  }
  function fotoDeBoleta() {
    return new Promise(res => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = "image/*"; i.setAttribute("capture", "environment");
      i.onchange = async () => {
        const f = i.files && i.files[0]; if (!f) { res(null); return; }
        try { const c = await new window.BarcodeDetector({ formats: ["pdf417"] }).detect(await createImageBitmap(f)); res(c[0] ? c[0].rawValue : ""); }
        catch (e) { res(""); }
      };
      i.click();
    });
  }
  async function escanearBoleta(fin) {
    let crudo = null;
    try {
      if (NATIVO) {
        const B = plugin("BarcodeScanner");
        if (PLATAFORMA === "android") {
          const m = await B.isGoogleBarcodeScannerModuleAvailable();
          if (!m.available) { await B.installGoogleBarcodeScannerModule(); avisar("Preparando el lector de boletas (solo la primera vez). Inténtalo de nuevo en unos segundos."); return; }
        }
        const r = await B.scan({ formats: ["PDF_417"] });
        crudo = r && r.barcodes && r.barcodes[0] ? (r.barcodes[0].rawValue || r.barcodes[0].displayValue || "") : null;
      } else crudo = await fotoDeBoleta();
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) { anotarFalla("boleta: " + (e && e.message)); fin({ ok: false, error: "No se pudo abrir la cámara." }); }
      return;
    }
    if (crudo === null) return;
    const b = crudo && leerTimbre(crudo);
    if (!b) { fin({ ok: false, error: "No pude leer el código de la boleta. Prueba con más luz o anota el monto a mano." }); return; }
    if (b.tipo === "61") { fin({ ok: false, error: "Es una nota de crédito (una devolución): anótala como ingreso." }); return; }
    fin({ ok: true, monto: b.monto, fecha: b.fecha, nota: (b.comercio || b.item).slice(0, 60) });
  }
  // iPhone nativo: el plugin del lector aún no se empaqueta (no trae Swift Package); ahí el botón no aparece
  if (NATIVO) { if (PLATAFORMA === "android") window.FA_escanear = escanearBoleta; }
  else if (window.BarcodeDetector && window.BarcodeDetector.getSupportedFormats) {
    window.BarcodeDetector.getSupportedFormats().then(f => { if (f.indexOf("pdf417") >= 0) window.FA_escanear = escanearBoleta; }).catch(() => {});
  }

  // El enlace con que se abrió la app, una sola vez por sesión ("web": ?a=anotar o ?a=registrar en la dirección)
  async function enlaceDeInicio() {
    if (!NATIVO) return q.get("a") === "anotar" || q.get("a") === "registrar" ? "web" : "";
    let url = "", vistos = [];
    try { vistos = JSON.parse(sessionStorage.getItem("fa_enlaces_vistos") || "[]"); } catch (e) {}
    try { url = sessionStorage.getItem("fa_enlace_nuevo") || ""; sessionStorage.removeItem("fa_enlace_nuevo"); } catch (e) {}
    if (!url) {
      try { const l = await plugin("App").getLaunchUrl(); url = (l && l.url) || ""; } catch (e) {}
      if (vistos.indexOf(url) >= 0) url = "";
    }
    if (url) { try { sessionStorage.setItem("fa_enlaces_vistos", JSON.stringify(vistos.concat([url]).slice(-20))); } catch (e) {} }
    return url;
  }
  // Qué anotar según el enlace (solo gasto o ingreso; lo demás abre la app como siempre)
  function capturaDe(url) {
    let params, ruta;
    if (url === "web") { params = q; ruta = q.get("a"); }
    else { let u; try { u = new URL(url); } catch (e) { return null; } if (u.protocol !== "misfinanzas:") return null; params = u.searchParams; ruta = rutaDe(u); }
    if (ruta !== "anotar" && ruta !== "registrar") return null;
    const pre = preDe(params); pre.tipo = pre.tipo || "Gasto";
    if (pre.tipo !== "Gasto" && pre.tipo !== "Ingreso") return null;
    pre.directo = params.get("guardar") === "1";
    return pre;
  }
  async function capturaAlAbrir() {
    const url = await enlaceDeInicio();
    if (NATIVO) E.enlacePendiente = url;
    const pre = url && capturaDe(url);
    if (!pre) return;
    const [cat, pub] = await Promise.all([leer("catalogo"), leer("bandejaPub")]);
    if (!pub) return;   // aún no se entra con la clave en esta versión: se abre como siempre
    // sin nombres (Ajustes → Atajos): se anota monto y nota, y la categoría se elige al entrar
    await ventanaCaptura(pre, E.nombresAtajo === false ? null : cat || null);   // termina cuando la persona elige abrir la app
    // ya se atendió el atajo: al entrar no se abre el registro (el panel copió FA_ACCION al cargar)
    E.enlacePendiente = ""; E.capturado = true; window.FA_ACCION = null; window.FA_PRE = null; window.ACCION_PANEL = "";
  }
  function cerrarApp() { const App = plugin("App"); if (App) App.exitApp().catch(() => App.minimizeApp()); }
  const pesos = n => "$" + Number(n).toLocaleString("es-CL");
  function ultimoMedio() { try { return localStorage.getItem("fa_ultimo_medio") || ""; } catch (e) { return ""; } }

  // La ventanita del atajo: monto, categoría, medio y nota, sin clave. Resuelve cuando la persona elige abrir la app.
  function ventanaCaptura(pre, cat) {
    return new Promise(seguir => {
      const v = document.createElement("div");
      v.id = "fa-bloqueo"; v.className = "fa-cap"; v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-labelledby", "fa-cap-t");
      document.body.appendChild(v);
      document.documentElement.classList.add("fa-bloqueada");
      // cat = null: sin nombres legibles (Ajustes → Atajos); solo monto y nota, la categoría se elige al entrar
      const s = { tipo: pre.tipo, monto: pre.monto || "", categoria: pre.categoria || "", medio: pre.medio || (cat ? ultimoMedio() : ""), nota: pre.nota || "" };
      const lista = t => (cat && cat[t] || []).slice();
      const abrir = () => { v.remove(); seguir(); };
      const chips = (vals, actual, campo) => vals.map(x => '<button type="button" data-c="' + campo + '" data-v="' + esc(x) + '" aria-pressed="' + (x === actual) + '">' + esc(x) + "</button>").join("");

      async function guardar(boton) {
        const d = { tipo: s.tipo, monto: s.monto, categoria: s.categoria, nota: s.nota.slice(0, 120), fecha: hoyIso(), cid: codigo() };
        if (s.tipo === "Gasto" && s.medio) d.medio = s.medio;
        if (boton) { boton.disabled = true; boton.textContent = "Anotando…"; }
        try { await aBandeja(d); }
        catch (e) {
          anotarFalla("captura: " + e.message);
          formulario(/llena/.test(e.message) ? "Tienes muchas anotaciones pendientes: abre la app para sumarlas." : "No se pudo anotar. Inténtalo de nuevo.");
          return false;
        }
        if (s.tipo === "Gasto") { try { localStorage.setItem("fa_ultimo_medio", s.medio); } catch (e) {} }
        hecho(d);
        return true;
      }
      function valido() {
        if (!(Number(s.monto) > 0)) return "Escribe el monto.";
        if (!cat) return "";   // lo demás se revisa al entrar con la clave
        if (lista(s.tipo).indexOf(s.categoria) < 0) return "Elige una categoría.";
        if (s.tipo === "Gasto" && cat.medios.indexOf(s.medio) < 0) return "Elige cómo pagaste.";
        return "";
      }
      function formulario(error) {
        if (cat && s.tipo === "Gasto" && cat.medios.indexOf(s.medio) < 0) s.medio = cat.medios[0] || "";
        const cats = lista(s.tipo);
        v.innerHTML = '<div class="fa-bl-caja"><h1 id="fa-cap-t">Anotar ' + (s.tipo === "Gasto" ? "gasto" : "ingreso") + "</h1>" +
          '<div class="fa-cap-tipos" role="group" aria-label="Tipo">' + ["Gasto", "Ingreso"].map(t => '<button type="button" data-t="' + t + '" aria-pressed="' + (t === s.tipo) + '">' + t + "</button>").join("") + "</div>" +
          '<form id="fa-cap-form" autocomplete="off" novalidate>' +
          '<label class="fa-cap-l" for="fa-cap-monto">Monto</label>' +
          '<input id="fa-cap-monto" inputmode="numeric" enterkeyhint="done" placeholder="$0" value="' + (s.monto ? pesos(s.monto) : "") + '">' +
          (!cat ? "" : '<div class="fa-cap-l" id="fa-cap-lc">Categoría</div>' +
            (cats.length ? '<div class="fa-cap-chips" role="group" aria-labelledby="fa-cap-lc">' + chips(cats, s.categoria, "categoria") + "</div>"
                         : '<p class="fa-cap-ayuda">No tienes categorías de ' + s.tipo.toLowerCase() + ". Créalas en la app.</p>") +
            (s.tipo === "Gasto" ? '<div class="fa-cap-l" id="fa-cap-lm">¿Cómo pagaste?</div><div class="fa-cap-chips" role="group" aria-labelledby="fa-cap-lm">' + chips(cat.medios, s.medio, "medio") + "</div>" : "")) +
          '<label class="fa-cap-l" for="fa-cap-nota">Nota (opcional)</label><input id="fa-cap-nota" maxlength="120" value="' + esc(s.nota) + '">' +
          '<p id="fa-cap-msg" class="fa-cap-err" role="alert">' + esc(error || "") + "</p>" +
          '<button type="submit" class="fa-cap-p" id="fa-cap-ok">Anotar</button></form>' +
          '<p class="fa-bl-nota">Queda guardado cifrado y se suma a tus cuentas cuando entres con tu clave' + (cat ? "" : " (ahí eliges la categoría)") + ".</p>" +
          '<button type="button" class="fa-bl-link" id="fa-cap-abrir">Abrir Mis Finanzas</button></div>';
        const $ = id => v.querySelector("#" + id), monto = $("fa-cap-monto");
        monto.addEventListener("input", () => {
          s.monto = monto.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 10);
          monto.value = s.monto ? pesos(s.monto) : "";
        });
        $("fa-cap-nota").addEventListener("input", e => { s.nota = e.target.value; });
        v.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => {
          if (s.tipo === b.getAttribute("data-t")) return;
          s.tipo = b.getAttribute("data-t"); s.categoria = ""; formulario();
        }));
        v.querySelectorAll("[data-c]").forEach(b => b.addEventListener("click", () => {
          s[b.getAttribute("data-c")] = b.getAttribute("data-v");
          b.parentNode.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
          $("fa-cap-msg").textContent = "";
        }));
        $("fa-cap-form").addEventListener("submit", e => {
          e.preventDefault();
          const falta = valido();
          if (falta) { $("fa-cap-msg").textContent = falta; if (!s.monto) monto.focus(); return; }
          guardar($("fa-cap-ok"));
        });
        $("fa-cap-abrir").addEventListener("click", abrir);
        if (!s.monto) setTimeout(() => monto.focus(), 50);
      }
      function hecho(d, auto) {
        v.innerHTML = '<div class="fa-bl-caja"><span class="fa-cap-listo" aria-hidden="true"><i class="ti ti-check"></i></span>' +
          '<h1 id="fa-cap-t">Anotado</h1><p>' + esc((d.nota || d.categoria || d.tipo) + " · " + pesos(d.monto)) + "</p>" +
          '<p class="fa-bl-nota">Se sumará a tus cuentas cuando entres con tu clave.</p>' +
          (NATIVO ? '<button type="button" class="fa-cap-p" id="fa-cap-cerrar">Listo</button>' : "") +
          '<button type="button" class="fa-bl-link" id="fa-cap-otro">Anotar otro</button>' +
          '<button type="button" class="fa-bl-link" id="fa-cap-abrir">Abrir Mis Finanzas</button></div>';
        const $ = id => v.querySelector("#" + id);
        let t = auto && NATIVO ? setTimeout(cerrarApp, 1800) : 0;
        const sin = fn => () => { clearTimeout(t); fn(); };
        if (NATIVO) $("fa-cap-cerrar").addEventListener("click", sin(cerrarApp));
        $("fa-cap-otro").addEventListener("click", sin(() => { s.monto = ""; s.nota = ""; formulario(); }));
        $("fa-cap-abrir").addEventListener("click", sin(abrir));
        (NATIVO ? $("fa-cap-cerrar") : $("fa-cap-otro")).focus();
      }

      // enlace de un toque (guardar=1) completo y válido: se anota sin preguntar y la app se cierra sola
      if (pre.directo && !valido()) {
        const d = { tipo: s.tipo, monto: s.monto, categoria: s.categoria, nota: s.nota.slice(0, 120), fecha: hoyIso(), cid: codigo() };
        if (s.tipo === "Gasto" && s.medio) d.medio = s.medio;
        aBandeja(d).then(() => hecho(d, true), e => { anotarFalla("captura: " + e.message); formulario("No se pudo anotar. Inténtalo de nuevo."); });
        return;
      }
      formulario();
    });
  }
  function codigo() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join(""); }

  /* ── respaldo en archivo ── */
  function contarMovs(propios) {
    const h = E.ss && E.ss.hojas.find(x => x.nombre === "Movimientos");
    if (!h) return 0;
    return h.datos.slice(1).filter(f => f && f[0] && (!propios || String(f[0]).indexOf(E.motor.EJ) !== 0)).length;
  }
  function nombreArchivo() { return "mis-finanzas-respaldo-" + hoyIso() + ".json"; }
  // formato 2: todo el contenido cifrado con la contraseña del respaldo (afuera solo va la fecha)
  async function datosRespaldo(contrasena) {
    const sal = azar(16), llave = await derivar(contrasena, sal, ITER);
    const interior = JSON.stringify({ version: E.motor.VERSION, movimientos: contarMovs(false), hojas: aGuardar(E.ss), props: E.props.getProperties() });
    const o = await cifrar(llave, interior);
    return JSON.stringify({ app: "Mis Finanzas", formato: 2, creado: new Date().toISOString(),
      cifrado: { alg: "AES-256-GCM", kdf: "PBKDF2-SHA256", iter: ITER, sal: b64(sal), iv: o.iv }, datos: o.ct });
  }
  function respaldoValido(r) {
    return r && Array.isArray(r.hojas) && r.hojas.some(h => h && h.nombre === "Movimientos") && r.hojas.every(h => h && typeof h.nombre === "string" && Array.isArray(h.datos));
  }
  async function aplicarRespaldo(r, creado) {
    const cuando = creado ? new Date(creado).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) : "fecha desconocida";
    if (!confirm("Esto reemplaza todo lo que hay en este teléfono por el respaldo del " + cuando + " (" + (r.movimientos || 0) + " movimientos). ¿Seguir?")) return;
    const texto = JSON.stringify({ hojas: r.hojas, props: r.props && typeof r.props === "object" ? r.props : {}, guardado: new Date().toISOString() });
    await escribir("libroCifrado", await cifrar(E.dek, texto));
    await escribir("respaldo", creado || new Date().toISOString());
    location.reload();
  }
  async function marcarRespaldo() {
    E.respaldo = new Date().toISOString(); await escribir("respaldo", E.respaldo);
    programarAvisos(window.D);
    refrescarAjustes(); avisar("Respaldo listo. Guárdalo fuera del teléfono (Drive, correo, computador).");
  }

  /* ── clave (obligatoria) ── */
  let fallos = 0, esperarHasta = 0, ocultoDesde = 0;
  function desbloquearPantalla() {
    const v = document.getElementById("fa-bloqueo"); if (v) v.remove();
    document.documentElement.classList.remove("fa-bloqueada");
  }
  function debil(c) { return /^[0-9]+$/.test(c) && c.length < 10; }
  // Huella (solo app nativa con lector): estado para Ajustes
  async function revisarHuella() {
    if (!NATIVO) return;
    try { E.huellaDisp = await plugin("Huella").disponible(); } catch (e) { E.huellaDisp = null; }   // iPhone: aún no
    try { E.huellaActiva = !!(await leer("huella")); } catch (e) { E.huellaActiva = false; }
  }
  function bloqueHuella() {
    const d = E.huellaDisp;
    if (!d || d.motivo === "sin-lector" || d.motivo === "otro") return "";
    if (!d.disponible) return '<p class="ayuda" style="margin:12px 0 0">Para entrar con huella, primero registra una huella en los ajustes del teléfono.</p>';
    return '<p class="ayuda" style="margin:12px 0 10px">' + (E.huellaActiva
      ? "Entras con tu huella. Tu clave sigue sirviendo, y se pide si la huella falla."
      : "Entra con tu huella en vez de escribir la clave. La llave queda en el chip de seguridad del teléfono y solo se abre con tu huella.") + "</p>" +
      (E.huellaActiva ? '<button class="btn btn-bloque" onclick="FALocal.desactivarHuella(this)"><i class="ti ti-fingerprint-off"></i>Dejar de usar la huella</button>'
                      : '<button class="btn btn-bloque" onclick="FALocal.formHuella()"><i class="ti ti-fingerprint"></i>Entrar con huella</button>');
  }
  // modo "crear" (primera vez o datos sin cifrar de antes) o "abrir"; resuelve con la llave de datos
  function pedirClave(modo, hayDatos) {
    return new Promise(resolver => {
      const v = document.createElement("div");
      v.id = "fa-bloqueo"; v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-labelledby", "fa-bl-t");
      const crear = modo === "crear";
      v.innerHTML = '<div class="fa-bl-caja"><span class="fa-bl-logo">F.</span><h1 id="fa-bl-t">' + (crear ? "Crea tu clave" : "Mis Finanzas") + "</h1>" +
        '<p id="fa-bl-msg" aria-live="polite">' + (crear ? (hayDatos ? "Tus datos se cifrarán con esta clave." : "Cifra tus datos en este teléfono.") + " Mínimo " + MIN_CLAVE + " caracteres." : "Escribe tu clave") + "</p>" +
        '<form id="fa-bl-form" autocomplete="off">' +
        '<input id="fa-bl-pin" type="password" inputmode="numeric" autocomplete="' + (crear ? "new-password" : "current-password") + '" aria-label="Clave">' +
        (crear ? '<input id="fa-bl-pin2" type="password" inputmode="numeric" autocomplete="new-password" aria-label="Repite la clave" placeholder="Repite la clave">' : "") +
        '<button type="submit" id="fa-bl-ok">' + (crear ? "Crear clave" : "Entrar") + "</button></form>" +
        '<button type="button" id="fa-bl-letras" class="fa-bl-link">Usar letras y números</button>' +
        (crear ? '<p class="fa-bl-nota">Si olvidas la clave, tus datos no se pueden recuperar: solo restaurando un respaldo. Con letras y números es mucho más segura.</p>'
               : '<button type="button" id="fa-bl-huella" class="fa-bl-link" hidden><i class="ti ti-fingerprint" aria-hidden="true"></i> Usar huella</button>' +
                 '<button type="button" id="fa-bl-olvide" class="fa-bl-link">Olvidé mi clave</button>') + "</div>";
      document.body.appendChild(v);
      document.documentElement.classList.add("fa-bloqueada");
      const $ = id => v.querySelector("#" + id), msg = $("fa-bl-msg"), boton = $("fa-bl-ok");
      // Huella (app nativa, si se activó en Ajustes): se pide sola al abrir; «Usar mi clave» vuelve a la clave
      const Huella = NATIVO && !crear ? plugin("Huella") : null;
      let conHuella = null;
      async function probarHuella() {
        if (!conHuella) return;
        try {
          const r = await Huella.abrir({ datos: conHuella.datos, iv: conHuella.iv, titulo: "Mis Finanzas", subtitulo: "Pon tu huella para entrar" });
          const dek = await crypto.subtle.importKey("raw", deB64(r.secreto), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
          fallos = 0; resolver(dek);
        } catch (e) {
          const c = e && e.code;
          if (c === "invalidada") {
            conHuella = null; $("fa-bl-huella").hidden = true; await kv("readwrite", o => o.delete("huella")).catch(() => {});
            msg.textContent = "Las huellas del teléfono cambiaron. Entra con tu clave y vuelve a activar la huella en Ajustes.";
          } else if (c === "bloqueado") msg.textContent = "Demasiados intentos con la huella. Usa tu clave.";
          else if (c !== "cancelado") anotarFalla("huella: " + (e && e.message));
          $("fa-bl-pin").focus();
        }
      }
      if (Huella) leer("huella").then(h => {
        if (!h || !h.datos) { $("fa-bl-pin").focus(); return; }
        conHuella = h; $("fa-bl-huella").hidden = false; probarHuella();
      }, () => $("fa-bl-pin").focus());
      else setTimeout(() => $("fa-bl-pin").focus(), 50);
      if (!crear) $("fa-bl-huella").addEventListener("click", probarHuella);
      $("fa-bl-letras").addEventListener("click", () => {
        const letras = $("fa-bl-pin").getAttribute("inputmode") === "numeric";
        v.querySelectorAll("input").forEach(x => x.setAttribute("inputmode", letras ? "text" : "numeric"));
        $("fa-bl-letras").textContent = letras ? "Usar solo números" : "Usar letras y números";
        $("fa-bl-pin").focus();
      });
      if (!crear) $("fa-bl-olvide").addEventListener("click", async () => {
        if (!confirm("La clave no se puede recuperar: sin ella, los datos cifrados de este teléfono no se pueden leer.\n\nPuedes borrar todo y empezar de nuevo (y después restaurar un respaldo). ¿Borrar todos los datos de Mis Finanzas en este teléfono?")) return;
        if (!confirm("¿Seguro? Esto no se puede deshacer.")) return;
        if (NATIVO) { try { await plugin("Huella").borrar(); } catch (e) {} }
        await kv("readwrite", o => o.clear());
        try { Object.keys(localStorage).filter(k => k.indexOf("fa_") === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
        location.reload();
      });
      $("fa-bl-form").addEventListener("submit", async e => {
        e.preventDefault();
        const clave = $("fa-bl-pin").value;
        if (crear) {
          if (clave.length < MIN_CLAVE) { msg.textContent = "La clave debe tener al menos " + MIN_CLAVE + " caracteres."; return; }
          if (clave !== $("fa-bl-pin2").value) { msg.textContent = "Las dos claves no coinciden."; return; }
          boton.disabled = true; boton.textContent = "Cifrando…";
          const r = await crearLlave(clave); E.llave = r.llave;
          if (debil(clave)) setTimeout(() => avisar("Clave creada. Para más seguridad, cámbiala por una con letras y números (Más → Ajustes)."), 2500);
          resolver(r.dek); return;
        }
        if (Date.now() < esperarHasta) { msg.textContent = "Espera " + Math.ceil((esperarHasta - Date.now()) / 1000) + " s para intentar de nuevo"; return; }
        boton.disabled = true; boton.textContent = "Abriendo…";
        try { const dek = await desenvolver(E.llave, clave, false); fallos = 0; resolver(dek); }
        catch (err) {
          boton.disabled = false; boton.textContent = "Entrar"; $("fa-bl-pin").value = ""; fallos++;
          if (fallos >= 5) { esperarHasta = Date.now() + 30000; fallos = 0; msg.textContent = "Demasiados intentos: espera 30 s"; }
          else msg.textContent = "Clave incorrecta";
          $("fa-bl-pin").focus();
        }
      });
    });
  }
  // Al volver a la app después de 1 minuto: se recarga y pide la clave (la llave sale de la memoria)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") ocultoDesde = Date.now();
    // (un momento antes de recargar, para que un atajo que llega justo ahora quede anotado en la sesión)
    else if (E.dek && ocultoDesde && Date.now() - ocultoDesde > 60000) { E.dek = null; E.recargando = true; document.documentElement.classList.add("fa-bloqueada"); setTimeout(() => location.reload(), 300); }
  });

  /* ── envío opcional a la planilla de Google (página puente ?a=pwa del panel 2.9+) ── */
  function porEnviar() {
    const h = E.ss.hojas.find(x => x.nombre === "Movimientos");
    if (!h || !h.datos.length) return [];
    const cab = h.datos[0].map(String), col = n => cab.indexOf(n);
    const iso = v => (v instanceof Date ? v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0") + "-" + String(v.getDate()).padStart(2, "0") : String(v || "").slice(0, 10));
    return h.datos.slice(1).filter(f => f && /^M[A-Za-z0-9]{8,32}$/.test(String(f[col("ID")] || "")) && !E.enviados[f[col("ID")]])
      .map(f => ({ cid: String(f[col("ID")]).slice(1), fecha: iso(f[col("Fecha")]), tipo: f[col("Tipo")], monto: Number(f[col("Monto")]) || 0,
        categoria: f[col("Categoría")] || "", medio: f[col("Medio")] || "", cuotas: Number(f[col("Cuotas")]) || 1,
        meta: f[col("Meta")] || "", deuda: f[col("Deuda")] || "", nota: f[col("Nota")] || "" }));
  }
  async function procesarRetorno() {
    const m = location.hash.match(/^#pwa=(.+)$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname);
    let r = null;
    try { r = JSON.parse(decodeURIComponent(m[1])); } catch (e) { E.avisoRetorno = "No se pudo leer la respuesta de la planilla."; return; }
    let ok = 0; const malos = [];
    (Array.isArray(r && r.resultados) ? r.resultados : []).forEach(x => {
      const id = "M" + String(x.cid || "");
      if (x.ok) { E.enviados[id] = 1; ok++; } else malos.push({ id: id, error: String(x.error || "No se pudo guardar") });
    });
    E.errores = malos;
    await escribir("enviados", E.enviados); await escribir("envioErrores", malos);
    E.avisoRetorno = (ok ? ok + (ok === 1 ? " movimiento enviado" : " movimientos enviados") + " a tu planilla" : "Nada nuevo para enviar") +
      (malos.length ? " · " + malos.length + " no se pudieron (revisa Más → Ajustes)" : "");
  }

  /* ── lo que el panel muestra en Más → Ajustes ── */
  function refrescarAjustes() {
    if (window.S && window.S.vista === "mas" && typeof window.pintarVista === "function") window.pintarVista();
  }
  function diasDesde(isoTxt) { return isoTxt ? Math.floor((Date.now() - new Date(isoTxt).getTime()) / 86400000) : null; }
  // Ajustes → Avisos (solo en la app nativa: la web no puede avisar con la app cerrada sin un servidor)
  function bloqueAvisos() {
    if (!NATIVO) return "";
    const o = E.avisos;
    const chk = (k, t) => '<label style="display:flex;gap:12px;align-items:center;min-height:44px;cursor:pointer;font-weight:600">' +
      '<input type="checkbox" style="width:22px;height:22px;flex:none;accent-color:var(--a)" onchange="FALocal.avisos(\'' + k + '\', this.checked)"' + (o[k] ? " checked" : "") + "><span>" + t + "</span></label>";
    const horas = [0].concat(Array.from({ length: 16 }, (_, i) => i + 8)).map(h => '<option value="' + h + '"' + (h === o.hora ? " selected" : "") + ">" + (h ? h + ":00" : "No") + "</option>").join("");
    return '<h2>Avisos en este teléfono</h2><div class="card" style="padding:14px 16px">' +
      '<p class="ayuda" style="margin:0 0 6px">Funcionan sin internet: se calculan en el teléfono y no se envía nada.</p>' + chk("on", "Activar avisos") +
      (o.on ? '<div class="campo" style="margin-top:6px"><label for="fa-av-h">Recordatorio diario (no llega si ese día ya anotaste)</label><select class="inp" id="fa-av-h" onchange="FALocal.avisos(\'hora\', Number(this.value))">' + horas + "</select></div>" +
        chk("pagos", "Pagos que vencen (tarjetas, deudas y fijos), el día antes") + chk("respaldo", "Recordarme el respaldo cada 7 días") + chk("detalle", "Mostrar nombres y montos en el aviso") +
        '<p class="ayuda" style="margin:4px 0 0">Si no muestras nombres ni montos, el aviso solo dice «Mañana vence un pago»: quien vea tu pantalla bloqueada no sabe qué ni cuánto.</p>' : "") + "</div>" +
      (PLATAFORMA !== "android" ? "" : '<h2>Widget</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 6px">Mantén presionada la pantalla de inicio → <i>Widgets</i> → <i>Mis Finanzas</i>. Su botón <b>Anotar gasto</b> anota sin escribir tu clave.</p>' +
        '<label style="display:flex;gap:12px;align-items:center;min-height:44px;cursor:pointer;font-weight:600"><input type="checkbox" style="width:22px;height:22px;flex:none;accent-color:var(--a)" onchange="FALocal.widgetSaldo(this.checked)"' + (E.widgetSaldo ? " checked" : "") + "><span>Mostrar cuánto puedes gastar hoy</span></label>" +
        '<p class="ayuda" style="margin:4px 0 0">Con presupuesto, el widget muestra lo que puedes gastar por día; sin presupuesto, lo disponible del mes. Ese monto se ve en tu pantalla de inicio y queda legible en el teléfono. Apagado, el widget muestra solo el botón.</p></div>');
  }

  window.FALocal = {
    ajustes() {
      if (!E.motor) return "";
      const dias = diasDesde(E.respaldo), movs = contarMovs(true), pend = porEnviar().length;
      const estadoResp = E.respaldo ? "Último respaldo: hace " + (dias === 0 ? "menos de un día" : dias + (dias === 1 ? " día" : " días")) + "." : "Todavía no has hecho un respaldo.";
      const urgente = movs && (dias === null || dias >= DIAS_AVISO_RESPALDO);
      return '<h2>Respaldo</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">Tus datos viven solo en este teléfono. Si se borra el navegador o cambias de celular, sin respaldo se pierden. El archivo de respaldo va cifrado con una contraseña que eliges. ' +
        '<b' + (urgente ? ' style="color:var(--warn)"' : "") + ">" + esc(estadoResp) + "</b></p>" +
        '<div class="acc" style="margin:0"><button class="btn btn-p btn-bloque" onclick="FALocal.respaldar(this)"><i class="ti ti-download"></i>Guardar respaldo</button>' +
        '<button class="btn btn-bloque" onclick="FALocal.restaurar(this)"><i class="ti ti-upload"></i>Restaurar un respaldo</button></div></div>' +

        '<h2>Clave y cifrado</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">Tus datos se guardan cifrados (AES-256) en este teléfono: sin tu clave no se pueden leer, aunque alguien copie el almacenamiento. ' +
        "La app la pide al abrirla y al volver después de un minuto. Una clave con letras y números es mucho más difícil de adivinar que solo números.</p>" +
        '<button class="btn btn-bloque" onclick="FALocal.formClave()"><i class="ti ti-key"></i>Cambiar clave</button>' + bloqueHuella() + "</div>" +

        bloqueAvisos() +

        '<h2>Atajos</h2><div class="card" style="padding:14px 16px"><p class="ayuda" style="margin:0 0 10px">' +
        (PLATAFORMA === "ios" ? "" : "Android: mantén presionado el ícono de Mis Finanzas y elige <i>Anotar gasto</i> o <i>Anotar ingreso</i> (arrástralo a la pantalla de inicio para tenerlo a mano). ") +
        "Desde un atajo anotas <b>sin escribir tu clave</b>: lo anotado queda cifrado y se suma a tus cuentas la próxima vez que entres. " +
        "Para la app Atajos del iPhone o un widget de Android («Abrir URL»), copia el enlace de lo que anotas seguido: anota con un toque.</p>" +
        ((window.D && window.D.recientes && window.D.recientes.length) ? '<div class="lista">' + window.D.recientes.map((x, i) =>
          '<button class="fila toca" onclick="FALocal.copiarAtajo(' + i + ')"><span style="flex:1;min-width:0"><b>' + esc(x.nota || x.categoria) + '</b><small style="display:block;color:var(--t3)">' +
          esc(x.tipo + " · $" + Number(x.monto).toLocaleString("es-CL") + (x.medio ? " · " + x.medio : "")) + '</small></span><i class="ti ti-copy"></i></button>').join("") + "</div>"
          : '<p class="ayuda" style="margin:0">Cuando anotes algo igual dos veces (por ejemplo, el café), aparecerá aquí para copiar su enlace.</p>') +
        '<button class="btn btn-bloque" style="margin-top:10px" onclick="FALocal.copiar(FALocal.enlace({}))"><i class="ti ti-link"></i>Copiar enlace «Anotar gasto»</button>' +
        '<label style="display:flex;gap:12px;align-items:center;min-height:44px;margin-top:12px;cursor:pointer;font-weight:600">' +
        '<input type="checkbox" id="fa-nombres" style="width:22px;height:22px;flex:none;accent-color:var(--a)" onchange="FALocal.nombresAtajo(this.checked)"' + (E.nombresAtajo === false ? "" : " checked") + ">" +
        "<span>Mostrar mis categorías en el atajo</span></label>" +
        '<p class="ayuda" style="margin:4px 0 0">Para elegirlas sin clave, los nombres de tus categorías y medios de pago quedan legibles en este teléfono (nunca montos ni movimientos). ' +
        "Si lo apagas, el atajo pide solo monto y nota, y eliges la categoría al entrar.</p></div>" +

        (NATIVO ? "" : '<h2>Copia en tu planilla de Google (opcional)</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">No hace falta: la app funciona sola. Si además usas Mis Finanzas en Google Sheets, pega el enlace de tu panel (termina en /exec) y envía los movimientos nuevos. ' +
        "Se envían solo los movimientos (no metas, tarjetas ni cambios posteriores); las categorías, tarjetas, metas y deudas deben existir también en la planilla.</p>" +
        '<div class="campo"><label for="fa-planilla">Enlace de tu panel</label><input class="inp" id="fa-planilla" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(E.planilla) + '"></div>' +
        '<div class="error" id="fa-planilla-err"></div>' +
        (E.errores.length ? '<p class="ayuda" style="color:var(--bad);margin:6px 0">No se pudieron enviar: ' + E.errores.slice(0, 5).map(x => esc(x.error)).join(" · ") + (E.errores.length > 5 ? "…" : "") + "</p>" : "") +
        '<button class="btn btn-bloque" onclick="FALocal.enviar(this)"><i class="ti ti-cloud-upload"></i>' + (pend ? "Enviar " + pend + (pend === 1 ? " movimiento nuevo" : " movimientos nuevos") : "Enviar a la planilla") + "</button></div>") +

        '<h2>¿Algo no funcionó?</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">Cuéntanos qué pasó y envíalo por WhatsApp o correo. El reporte lleva la versión, el tipo de teléfono y los errores técnicos recientes (' + FALLAS.length + "); nunca tus datos ni montos.</p>" +
        '<div class="campo"><label for="fa-rep">Qué hacías y qué pasó</label><textarea class="inp" id="fa-rep" rows="3" maxlength="1000" style="min-height:88px;resize:vertical"></textarea></div>' +
        '<button class="btn btn-bloque" onclick="FALocal.reportar(this)"><i class="ti ti-message-report"></i>Enviar reporte</button></div>';
    },

    respaldar() {
      window.abrirHoja("Guardar respaldo",
        '<p class="ayuda" style="margin:0 0 12px">El archivo va cifrado con esta contraseña: la necesitarás para restaurarlo (puede ser la misma clave de la app). Mínimo ' + MIN_RESPALDO + " caracteres. Sin ella, el respaldo no se puede abrir.</p>" +
        '<div class="campo"><label for="fa-r1">Contraseña del respaldo</label><input class="inp" id="fa-r1" type="password" autocomplete="new-password"></div>' +
        '<div class="campo"><label for="fa-r2">Repite la contraseña</label><input class="inp" id="fa-r2" type="password" autocomplete="new-password"></div>' +
        '<div class="error" id="fa-r-err"></div>',
        '<button class="btn btn-p btn-bloque" id="fa-r-ok" onclick="FALocal.generarRespaldo(this)"><i class="ti ti-download"></i>Cifrar y guardar</button>');
      setTimeout(() => { const x = document.getElementById("fa-r1"); if (x) x.focus(); }, 80);
    },
    async generarRespaldo(b) {
      const a = document.getElementById("fa-r1").value, a2 = document.getElementById("fa-r2").value, err = document.getElementById("fa-r-err");
      if (a.length < MIN_RESPALDO) { err.textContent = "La contraseña debe tener al menos " + MIN_RESPALDO + " caracteres."; return; }
      if (a !== a2) { err.textContent = "Las dos contraseñas no coinciden."; return; }
      if (b) { b.disabled = true; b.textContent = "Cifrando…"; }
      await listo;
      const contenido = await datosRespaldo(a);
      window.cerrarHoja();
      if (NATIVO) {
        try {
          const f = await plugin("Filesystem").writeFile({ path: nombreArchivo(), data: contenido, directory: "CACHE", encoding: "utf8" });
          await plugin("Share").share({ title: "Respaldo de Mis Finanzas", files: [f.uri], dialogTitle: "Guardar respaldo" });
          await marcarRespaldo();
        } catch (e) {
          if (!/cancel/i.test(String(e && e.message))) { anotarFalla("respaldo: " + (e && e.message)); avisar("No se pudo guardar el respaldo. Inténtalo de nuevo."); }
        }
        return;
      }
      const archivo = new File([contenido], nombreArchivo(), { type: "application/json" });
      const tactil = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      if (tactil && navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try { await navigator.share({ files: [archivo], title: "Respaldo de Mis Finanzas" }); await marcarRespaldo(); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(archivo); enlace.download = archivo.name; document.body.appendChild(enlace); enlace.click();
      setTimeout(() => { URL.revokeObjectURL(enlace.href); enlace.remove(); }, 1000);
      await marcarRespaldo();
    },

    restaurar() {
      const i = document.createElement("input");
      i.type = "file"; i.accept = "application/json,.json";
      i.onchange = async () => {
        const f = i.files && i.files[0]; if (!f) return;
        let r;
        try { r = JSON.parse(await f.text()); } catch (e) { avisar("Ese archivo no es un respaldo de Mis Finanzas."); return; }
        if (!r || r.app !== "Mis Finanzas") { avisar("Ese archivo no es un respaldo de Mis Finanzas."); return; }
        if (r.formato === 2 && r.cifrado && r.datos) { FALocal._pendiente = r; FALocal.pedirContrasena(); return; }
        if (!respaldoValido(r)) { avisar("Ese archivo no es un respaldo de Mis Finanzas."); return; }
        if (!confirm("Este respaldo NO está cifrado (es de una versión anterior). Al restaurarlo, sus datos quedan cifrados en el teléfono; borra después el archivo. ¿Seguir?")) return;
        await aplicarRespaldo(r, r.creado);
      };
      i.click();
    },
    pedirContrasena() {
      window.abrirHoja("Restaurar respaldo",
        '<p class="ayuda" style="margin:0 0 12px">Escribe la contraseña con que se guardó este respaldo.</p>' +
        '<div class="campo"><label for="fa-rr">Contraseña del respaldo</label><input class="inp" id="fa-rr" type="password" autocomplete="current-password"></div>' +
        '<div class="error" id="fa-rr-err"></div>',
        '<button class="btn btn-p btn-bloque" onclick="FALocal.abrirRespaldo(this)"><i class="ti ti-lock-open"></i>Abrir respaldo</button>');
      setTimeout(() => { const x = document.getElementById("fa-rr"); if (x) x.focus(); }, 80);
    },
    async abrirRespaldo(b) {
      const r = FALocal._pendiente, err = document.getElementById("fa-rr-err"); if (!r) return;
      if (b) b.disabled = true;
      let interior = null;
      try {
        const llave = await derivar(document.getElementById("fa-rr").value, deB64(r.cifrado.sal), Number(r.cifrado.iter) || ITER);
        interior = JSON.parse(await descifrar(llave, { iv: r.cifrado.iv, ct: r.datos }));
      } catch (e) { err.textContent = "Contraseña incorrecta (o el archivo está dañado)."; if (b) b.disabled = false; return; }
      if (!respaldoValido(interior)) { err.textContent = "El respaldo no tiene el formato esperado."; if (b) b.disabled = false; return; }
      FALocal._pendiente = null; window.cerrarHoja();
      await aplicarRespaldo(interior, r.creado);
    },

    formClave() {
      window.abrirHoja("Cambiar clave",
        '<p class="ayuda" style="margin:0 0 12px">Mínimo ' + MIN_CLAVE + " caracteres. Con letras y números es mucho más segura. Si la olvidas, solo se recuperan los datos restaurando un respaldo.</p>" +
        '<div class="campo"><label for="fa-c0">Clave actual</label><input class="inp" id="fa-c0" type="password" autocomplete="current-password"></div>' +
        '<div class="campo"><label for="fa-c1">Clave nueva</label><input class="inp" id="fa-c1" type="password" autocomplete="new-password"></div>' +
        '<div class="campo"><label for="fa-c2">Repite la clave nueva</label><input class="inp" id="fa-c2" type="password" autocomplete="new-password"></div>' +
        '<div class="error" id="fa-c-err"></div>',
        '<button class="btn btn-p btn-bloque" onclick="FALocal.cambiarClave(this)"><i class="ti ti-key"></i>Cambiar clave</button>');
      setTimeout(() => { const x = document.getElementById("fa-c0"); if (x) x.focus(); }, 80);
    },
    async cambiarClave(b) {
      const v = id => document.getElementById(id).value, err = document.getElementById("fa-c-err");
      if (v("fa-c1").length < MIN_CLAVE) { err.textContent = "La clave nueva debe tener al menos " + MIN_CLAVE + " caracteres."; return; }
      if (v("fa-c1") !== v("fa-c2")) { err.textContent = "Las dos claves nuevas no coinciden."; return; }
      if (b) b.disabled = true;
      let dek;
      try { dek = await desenvolver(E.llave, v("fa-c0"), true); }
      catch (e) { err.textContent = "La clave actual no es correcta."; if (b) b.disabled = false; return; }
      E.llave = await envolver(dek, v("fa-c1"));
      await escribir("llave", E.llave);
      window.cerrarHoja(); avisar("Clave cambiada.");
    },

    enlace(x) {
      const p = new URLSearchParams(NATIVO ? { tipo: x.tipo || "Gasto" } : { a: "registrar", tipo: x.tipo || "Gasto" });
      if (x.monto) p.set("monto", x.monto);
      ["categoria", "medio", "nota"].forEach(k => { if (x[k]) p.set(k, x[k]); });
      if (x.monto && x.categoria) p.set("guardar", "1");
      return (NATIVO ? "misfinanzas://registrar" : location.origin + location.pathname) + "?" + p.toString();
    },
    // Marcha blanca: arma un reporte sin datos personales y lo comparte (WhatsApp, correo…)
    async reportar() {
      const desc = String((document.getElementById("fa-rep") || {}).value || "").trim();
      const texto = ["Mis Finanzas · reporte de marcha blanca",
        "Versión: " + (E.motor ? E.motor.VERSION : "?") + " (" + PLATAFORMA + ")",
        "Equipo: " + navigator.userAgent,
        "Pantalla: " + window.innerWidth + "×" + window.innerHeight,
        "Fecha: " + new Date().toLocaleString("es-CL"), "",
        "Qué pasó:", desc || "(sin descripción)", "",
        "Errores técnicos recientes (" + FALLAS.length + "):"].concat(FALLAS.slice(-10).map(f => f.t + " · " + f.m)).join("\n");
      try {
        if (NATIVO) { await plugin("Share").share({ title: "Reporte de Mis Finanzas", text: texto, dialogTitle: "Enviar reporte" }); return; }
        if (navigator.share) { await navigator.share({ title: "Reporte de Mis Finanzas", text: texto }); return; }
      } catch (e) { if (e && (e.name === "AbortError" || /cancel/i.test(String(e.message)))) return; }
      try { await navigator.clipboard.writeText(texto); avisar("Reporte copiado: pégalo en WhatsApp o en un correo."); }
      catch (e) { window.prompt("Copia este reporte:", texto); }
    },
    formHuella() {
      window.abrirHoja("Entrar con huella",
        '<p class="ayuda" style="margin:0 0 12px">Escribe tu clave una vez para activar la huella. Si cambian las huellas del teléfono, la app te pedirá la clave y la vuelves a activar.</p>' +
        '<div class="campo"><label for="fa-h0">Tu clave</label><input class="inp" id="fa-h0" type="password" autocomplete="current-password"></div>' +
        '<div class="error" id="fa-h-err"></div>',
        '<button class="btn btn-p btn-bloque" onclick="FALocal.activarHuella(this)"><i class="ti ti-fingerprint"></i>Activar huella</button>');
      setTimeout(() => { const x = document.getElementById("fa-h0"); if (x) x.focus(); }, 80);
    },
    async activarHuella(b) {
      const err = document.getElementById("fa-h-err");
      if (b) b.disabled = true;
      let crudo;
      try { crudo = await crypto.subtle.exportKey("raw", await desenvolver(E.llave, document.getElementById("fa-h0").value, true)); }
      catch (e) { err.textContent = "La clave no es correcta."; if (b) b.disabled = false; return; }
      try {
        const r = await plugin("Huella").guardar({ secreto: b64(crudo), titulo: "Activar huella", subtitulo: "Pon tu huella para confirmar" });
        await escribir("huella", { v: 1, datos: r.datos, iv: r.iv });
      } catch (e) {
        if (!(e && e.code === "cancelado")) { anotarFalla("huella: " + (e && e.message)); err.textContent = "No se pudo activar la huella. Inténtalo de nuevo."; }
        if (b) b.disabled = false; return;
      } finally { new Uint8Array(crudo).fill(0); }
      E.huellaActiva = true; window.cerrarHoja(); refrescarAjustes();
      avisar("Listo: la próxima vez entras con tu huella");
    },
    async desactivarHuella(b) {
      if (b) b.disabled = true;
      try { await plugin("Huella").borrar(); } catch (e) {}
      await kv("readwrite", o => o.delete("huella"));
      E.huellaActiva = false; refrescarAjustes(); avisar("Ya no se usa la huella: entras con tu clave");
    },
    async nombresAtajo(si) {
      E.nombresAtajo = !!si; catalogoVisto = "";
      await escribir("atajoNombres", !!si);
      if (si) guardarCatalogo(window.D);
      else await kv("readwrite", o => o.delete("catalogo"));
      avisar(si ? "El atajo mostrará tus categorías" : "El atajo pedirá solo monto y nota");
    },
    async avisos(k, v) {
      if (k === "on" && v) {
        try {
          const p = await plugin("LocalNotifications").requestPermissions();
          if (p.display !== "granted") { avisar("Sin permiso para avisar: actívalo en los ajustes del teléfono (Notificaciones)."); refrescarAjustes(); return; }
        } catch (e) { anotarFalla("avisos: " + (e && e.message)); refrescarAjustes(); return; }
      }
      E.avisos = Object.assign({}, E.avisos, { [k]: v });
      await escribir("avisos", E.avisos);
      programarAvisos(window.D); refrescarAjustes();
      if (k === "on") avisar(v ? "Listo: te avisaré en este teléfono" : "Avisos apagados");
    },
    async widgetSaldo(si) {
      E.widgetSaldo = !!si; await escribir("widgetSaldo", !!si);
      actualizarWidget(window.D); refrescarAjustes();
      avisar(si ? "El widget mostrará cuánto puedes gastar hoy" : "El widget muestra solo el botón");
    },
    avisosDe: avisosDe, leerTimbre: leerTimbre, widgetDe: widgetDe,   // para las pruebas
    copiarAtajo(i) { const x = window.D && window.D.recientes && window.D.recientes[i]; if (x) FALocal.copiar(FALocal.enlace(x)); },
    async copiar(texto) {
      try { await navigator.clipboard.writeText(texto); avisar("Enlace copiado. Pégalo en «Abrir URL» de tu app de atajos."); }
      catch (e) { window.prompt("Copia este enlace:", texto); }
    },

    async enviar() {
      const err = document.getElementById("fa-planilla-err"), u = String(document.getElementById("fa-planilla").value || "").trim().split(/[?#]/)[0];
      if (!RE_PANEL.test(u)) { err.textContent = "Ese enlace no parece el de tu panel: empieza con https://script.google.com/ y termina en /exec."; return; }
      if (!navigator.onLine) { err.textContent = "Necesitas internet para enviar."; return; }
      E.planilla = u; await escribir("planilla", u);
      const lista = porEnviar().slice(0, 200);
      location.href = u + "?a=pwa#d=" + encodeURIComponent(JSON.stringify(lista)) + "&r=" + encodeURIComponent(location.origin + location.pathname);
    },
  };

  /* ── al abrir: bloqueo, avisos y estilos propios ── */
  const ESTILO = "#fa-bloqueo{position:fixed;inset:0;z-index:9999;background:var(--bg,#EEF2F7);display:flex;align-items:center;justify-content:center;padding:24px}" +
    ".fa-bl-caja{width:100%;max-width:320px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}" +
    ".fa-bl-logo{width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#163F6B,#1F5C99 60%,#4C8DDB);color:#fff;display:flex;align-items:center;justify-content:center;font:500 24px 'JetBrains Mono',ui-monospace,monospace}" +
    ".fa-bl-caja h1{font-size:20px;margin:4px 0 0}.fa-bl-caja p{color:var(--t3,#566A80);margin:0 0 6px}.fa-bl-caja .fa-bl-nota{font-size:13px;margin-top:6px}" +
    "#fa-bl-form{display:flex;flex-direction:column;gap:10px;width:100%}" +
    "#fa-bl-form input{width:100%;min-height:56px;text-align:center;font-size:24px;letter-spacing:.25em;border:1px solid var(--b,#DCE4EE);border-radius:14px;background:var(--s,#fff);color:var(--t,#12304D)}" +
    "#fa-bl-form input::placeholder{font-size:15px;letter-spacing:normal}#fa-bl-form button:disabled{opacity:.6}" +
    "#fa-bl-form button{min-height:52px;border:0;border-radius:14px;background:var(--a,#1F5C99);color:var(--s,#fff);font-weight:700;font-size:16px}" +
    ".fa-bl-link{background:none;border:0;color:var(--a,#1F5C99);min-height:44px;font-weight:600}" +
    // la ventanita del atajo (anotar sin clave): se desplaza si no cabe (celular horizontal, poca altura)
    "#fa-bloqueo.fa-cap{align-items:flex-start;overflow-y:auto;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}" +
    ".fa-cap .fa-bl-caja{max-width:440px;margin:auto;gap:8px}" +
    ".fa-cap-tipos{display:flex;gap:4px;width:100%;padding:4px;border-radius:14px;background:var(--s2,#F5F8FB);border:1px solid var(--b,#DCE4EE)}" +
    ".fa-cap-tipos button{flex:1;min-height:44px;border:0;border-radius:10px;background:none;color:var(--t2,#3E546D);font-weight:600;font-size:15px}" +
    ".fa-cap-tipos button[aria-pressed=true]{background:var(--s,#fff);color:var(--a,#1F5C99);box-shadow:var(--sh)}" +
    "#fa-cap-form{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left}" +
    ".fa-cap-l{font-size:13px;font-weight:600;color:var(--t3,#566A80);margin-top:8px}" +
    "#fa-cap-form input{width:100%;min-height:48px;padding:0 14px;font-size:16px;border:1px solid var(--b,#DCE4EE);border-radius:12px;background:var(--s,#fff);color:var(--t,#12304D)}" +
    "#fa-cap-form #fa-cap-monto{min-height:60px;font-size:28px;font-weight:700;text-align:center}" +
    ".fa-cap-chips{display:flex;flex-wrap:wrap;gap:6px}" +
    ".fa-cap-chips button{min-height:44px;padding:0 14px;border:1px solid var(--b,#DCE4EE);border-radius:999px;background:var(--s,#fff);color:var(--t,#12304D);font-size:14px}" +
    ".fa-cap-chips button[aria-pressed=true]{background:var(--a,#1F5C99);border-color:var(--a,#1F5C99);color:var(--s,#fff);font-weight:600}" +
    ".fa-cap-err{color:var(--bad,#B3261E);min-height:20px;margin:2px 0 0;font-size:14px}.fa-cap-ayuda{margin:0;font-size:14px;color:var(--t3,#566A80)}" +
    ".fa-cap-p{width:100%;min-height:52px;border:0;border-radius:14px;background:var(--a,#1F5C99);color:var(--s,#fff);font-weight:700;font-size:16px}.fa-cap-p:disabled{opacity:.6}" +
    ".fa-cap-listo{width:64px;height:64px;border-radius:50%;background:var(--ok-s,#E6F4EA);color:var(--ok,#137333);display:flex;align-items:center;justify-content:center;font-size:34px}";
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style"); st.textContent = ESTILO; document.head.appendChild(st);
    listo.then(() => {
      setTimeout(() => {
        if (E.avisoRetorno) { avisar(E.avisoRetorno); return; }
        if (GUARDAR_DIRECTO) return;
        const dias = diasDesde(E.respaldo), movs = contarMovs(true);
        let ultimo = ""; try { ultimo = localStorage.getItem("fa_aviso_respaldo") || ""; } catch (e) {}
        if (movs && (dias === null || dias >= DIAS_AVISO_RESPALDO) && ultimo !== hoyIso()) {
          try { localStorage.setItem("fa_aviso_respaldo", hoyIso()); } catch (e) {}
          avisar(dias === null ? "Aún no respaldas tus datos" : "Llevas " + dias + " días sin respaldo", () => FALocal.respaldar(), "Respaldar");
        }
      }, 1500);
    });
  });

  if (!NATIVO && "serviceWorker" in navigator) {
    // Cuando llega una versión nueva de la app, se recarga sola una vez (sin esperar a la próxima apertura).
    // En la primera instalación no hay versión anterior, así que no recarga.
    if (navigator.serviceWorker.controller) {
      let recargada = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!recargada) { recargada = true; location.reload(); } });
    }
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").then(r => r.update()).catch(() => {}));
  }
})();
