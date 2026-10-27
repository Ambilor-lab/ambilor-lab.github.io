// Mis Finanzas · app del teléfono (sin Google)
// El panel (index.html) y las reglas (motor.js) son los mismos de la versión de Google; este archivo:
//   · reemplaza google.script.run: cada llamada corre en el motor local y la "planilla" se guarda en el teléfono (IndexedDB);
//   · atajos: ?a=registrar (abre el registro), con tipo/monto/categoria/medio/nota, y guardar=1 para anotar directo;
//   · respaldo en archivo (con aviso), bloqueo con PIN y envío opcional de movimientos a la planilla de Google.
(function () {
  "use strict";
  window.FA_LOCAL = true;
  // Si hay PIN, la pantalla parte tapada (sin dejar ver los datos ni un instante)
  let pinMarcado = false;
  try { pinMarcado = localStorage.getItem("fa_pin_on") === "1"; } catch (e) {}
  if (pinMarcado) document.documentElement.classList.add("fa-bloqueada");
  document.write("<style>.fa-bloqueada body>*:not(#fa-bloqueo){visibility:hidden}</style>");

  const BASE = "mis-finanzas-telefono", ALMACEN = "kv";
  const DIAS_AVISO_RESPALDO = 7;
  const RE_PANEL = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[^/?#]+)\/s\/[\w-]+\/exec$/;
  const SOLO_LECTURA = { panelDatos: true };

  const E = { motor: null, ss: null, props: null, pin: null, respaldo: "", planilla: "", enviados: {}, errores: [], avisoRetorno: "" };
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
    const copia = { hojas: aGuardar(E.ss), props: E.props.getProperties(), guardado: new Date().toISOString() };
    cadena = cadena.then(() => escribir("libro", copia)).catch(err => {
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
    let guardado = null;
    try {
      guardado = await leer("libro");
      const [pin, respaldo, planilla, enviados, errores] = await Promise.all(["pin", "respaldo", "planilla", "enviados", "envioErrores"].map(leer));
      Object.assign(E, { pin: pin || null, respaldo: respaldo || "", planilla: planilla || "", enviados: enviados || {}, errores: errores || [] });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (err) {
      console.error(err);
      setTimeout(() => avisar("Este navegador no deja guardar datos (¿modo incógnito?). Lo que anotes se perderá al cerrar."), 1500);
    }
    crearLibro(guardado);
    await traerUF();
    await procesarRetorno();
    await atajoDirecto();
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
  if (q.get("a") === "registrar") {
    if (!GUARDAR_DIRECTO) window.FA_ACCION = "registrar";
    ["tipo", "categoria", "medio", "nota"].forEach(k => { if (q.get(k)) PRE[k] = q.get(k).slice(0, 120); });
    const monto = String(q.get("monto") || "").replace(/\D/g, "").slice(0, 10);
    if (monto) PRE.monto = monto;
    window.FA_PRE = PRE;
  }
  if (location.search) history.replaceState(null, "", location.pathname + location.hash);

  // ?a=registrar&…&guardar=1: anota sin abrir el registro; si algo no calza, abre el registro relleno
  async function atajoDirecto() {
    if (!GUARDAR_DIRECTO) return;
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
  function codigo() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join(""); }

  /* ── respaldo en archivo ── */
  function contarMovs(propios) {
    const h = E.ss && E.ss.hojas.find(x => x.nombre === "Movimientos");
    if (!h) return 0;
    return h.datos.slice(1).filter(f => f && f[0] && (!propios || String(f[0]).indexOf(E.motor.EJ) !== 0)).length;
  }
  function nombreArchivo() { return "mis-finanzas-respaldo-" + hoyIso() + ".json"; }
  function datosRespaldo() {
    return JSON.stringify({ app: "Mis Finanzas", formato: 1, version: E.motor.VERSION, creado: new Date().toISOString(),
      movimientos: contarMovs(false), hojas: aGuardar(E.ss), props: E.props.getProperties() });
  }
  async function marcarRespaldo() {
    E.respaldo = new Date().toISOString(); await escribir("respaldo", E.respaldo);
    refrescarAjustes(); avisar("Respaldo listo. Guárdalo fuera del teléfono (Drive, correo, computador).");
  }

  /* ── PIN ── */
  async function hashPin(pin, sal) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sal + ":" + pin));
    return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
  }
  let fallos = 0, esperarHasta = 0, ocultoDesde = 0;
  function bloquear() {
    if (!E.pin) { document.documentElement.classList.remove("fa-bloqueada"); return; }
    if (document.getElementById("fa-bloqueo")) return;
    const v = document.createElement("div");
    v.id = "fa-bloqueo"; v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-label", "Mis Finanzas bloqueada");
    v.innerHTML = '<div class="fa-bl-caja"><span class="fa-bl-logo">F.</span><h1>Mis Finanzas</h1><p id="fa-bl-msg">Escribe tu PIN</p>' +
      '<form id="fa-bl-form" autocomplete="off"><input id="fa-bl-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" aria-label="PIN" autocomplete="off">' +
      '<button type="submit">Entrar</button></form><button type="button" id="fa-bl-olvide" class="fa-bl-link">Olvidé mi PIN</button></div>';
    document.body.appendChild(v);
    document.documentElement.classList.add("fa-bloqueada");
    const input = v.querySelector("#fa-bl-pin");
    setTimeout(() => input.focus(), 50);
    v.querySelector("#fa-bl-form").addEventListener("submit", async e => {
      e.preventDefault();
      const msg = v.querySelector("#fa-bl-msg");
      if (Date.now() < esperarHasta) { msg.textContent = "Espera " + Math.ceil((esperarHasta - Date.now()) / 1000) + " s para intentar de nuevo"; return; }
      if (await hashPin(input.value, E.pin.sal) === E.pin.hash) { fallos = 0; v.remove(); document.documentElement.classList.remove("fa-bloqueada"); return; }
      fallos++; input.value = "";
      if (fallos >= 5) { esperarHasta = Date.now() + 30000; fallos = 0; msg.textContent = "Demasiados intentos: espera 30 s"; }
      else msg.textContent = "PIN incorrecto";
    });
    v.querySelector("#fa-bl-olvide").addEventListener("click", async () => {
      if (!confirm("El PIN no se puede recuperar: protege tus datos en este teléfono.\n\nPuedes borrar todo y empezar de nuevo (o restaurar un respaldo después). ¿Borrar todos los datos de Mis Finanzas en este teléfono?")) return;
      if (!confirm("¿Seguro? Esto no se puede deshacer.")) return;
      await kv("readwrite", o => o.clear());
      try { Object.keys(localStorage).filter(k => k.indexOf("fa_") === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
      location.reload();
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") ocultoDesde = Date.now();
    else if (E.pin && ocultoDesde && Date.now() - ocultoDesde > 60000) bloquear();
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

  window.FALocal = {
    ajustes() {
      if (!E.motor) return "";
      const dias = diasDesde(E.respaldo), movs = contarMovs(true), pend = porEnviar().length;
      const estadoResp = E.respaldo ? "Último respaldo: hace " + (dias === 0 ? "menos de un día" : dias + (dias === 1 ? " día" : " días")) + "." : "Todavía no has hecho un respaldo.";
      const urgente = movs && (dias === null || dias >= DIAS_AVISO_RESPALDO);
      return '<h2>Respaldo</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">Tus datos viven solo en este teléfono. Si se borra el navegador o cambias de celular, sin respaldo se pierden. ' +
        '<b' + (urgente ? ' style="color:var(--warn)"' : "") + ">" + esc(estadoResp) + "</b></p>" +
        '<div class="acc" style="margin:0"><button class="btn btn-p btn-bloque" onclick="FALocal.respaldar(this)"><i class="ti ti-download"></i>Guardar respaldo</button>' +
        '<button class="btn btn-bloque" onclick="FALocal.restaurar(this)"><i class="ti ti-upload"></i>Restaurar un respaldo</button></div></div>' +

        '<h2>Bloqueo con PIN</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">' + (E.pin ? "Activo: la app pide tu PIN al abrirla y al volver después de un minuto." : "Pide un PIN al abrir la app, para que otra persona que tome tu celular no vea tus finanzas.") +
        " No cifra los datos guardados en el teléfono.</p>" +
        (E.pin ? '<div class="acc" style="margin:0"><button class="btn btn-bloque" onclick="FALocal.formPin()"><i class="ti ti-key"></i>Cambiar PIN</button><button class="btn btn-peligro btn-bloque" onclick="FALocal.quitarPin()"><i class="ti ti-lock-open"></i>Quitar PIN</button></div>'
          : '<button class="btn btn-bloque" onclick="FALocal.formPin()"><i class="ti ti-lock"></i>Activar PIN</button>') + "</div>" +

        '<h2>Atajos</h2><div class="card" style="padding:14px 16px"><p class="ayuda" style="margin:0 0 10px">' +
        "Android: mantén presionado el ícono de Mis Finanzas para <i>Anotar gasto</i> o <i>Anotar ingreso</i>. " +
        "Para la app Atajos del iPhone o un widget de Android («Abrir URL»), copia el enlace de lo que anotas seguido: anota con un toque.</p>" +
        ((window.D && window.D.recientes && window.D.recientes.length) ? '<div class="lista">' + window.D.recientes.map((x, i) =>
          '<button class="fila toca" onclick="FALocal.copiarAtajo(' + i + ')"><span style="flex:1;min-width:0"><b>' + esc(x.nota || x.categoria) + '</b><small style="display:block;color:var(--t3)">' +
          esc(x.tipo + " · $" + Number(x.monto).toLocaleString("es-CL") + (x.medio ? " · " + x.medio : "")) + '</small></span><i class="ti ti-copy"></i></button>').join("") + "</div>"
          : '<p class="ayuda" style="margin:0">Cuando anotes algo igual dos veces (por ejemplo, el café), aparecerá aquí para copiar su enlace.</p>') +
        '<button class="btn btn-bloque" style="margin-top:10px" onclick="FALocal.copiar(FALocal.enlace({}))"><i class="ti ti-link"></i>Copiar enlace «Anotar gasto»</button></div>' +

        '<h2>Copia en tu planilla de Google (opcional)</h2><div class="card" style="padding:14px 16px">' +
        '<p class="ayuda" style="margin:0 0 10px">No hace falta: la app funciona sola. Si además usas Mis Finanzas en Google Sheets, pega el enlace de tu panel (termina en /exec) y envía los movimientos nuevos. ' +
        "Se envían solo los movimientos (no metas, tarjetas ni cambios posteriores); las categorías, tarjetas, metas y deudas deben existir también en la planilla.</p>" +
        '<div class="campo"><label for="fa-planilla">Enlace de tu panel</label><input class="inp" id="fa-planilla" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(E.planilla) + '"></div>' +
        '<div class="error" id="fa-planilla-err"></div>' +
        (E.errores.length ? '<p class="ayuda" style="color:var(--bad);margin:6px 0">No se pudieron enviar: ' + E.errores.slice(0, 5).map(x => esc(x.error)).join(" · ") + (E.errores.length > 5 ? "…" : "") + "</p>" : "") +
        '<button class="btn btn-bloque" onclick="FALocal.enviar(this)"><i class="ti ti-cloud-upload"></i>' + (pend ? "Enviar " + pend + (pend === 1 ? " movimiento nuevo" : " movimientos nuevos") : "Enviar a la planilla") + "</button></div>";
    },

    async respaldar() {
      await listo;
      const texto = datosRespaldo(), nombre = nombreArchivo();
      const archivo = new File([texto], nombre, { type: "application/json" });
      const tactil = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      if (tactil && navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try { await navigator.share({ files: [archivo], title: "Respaldo de Mis Finanzas" }); await marcarRespaldo(); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(archivo); a.download = nombre; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      await marcarRespaldo();
    },

    restaurar() {
      const i = document.createElement("input");
      i.type = "file"; i.accept = "application/json,.json";
      i.onchange = async () => {
        const f = i.files && i.files[0]; if (!f) return;
        let r;
        try { r = JSON.parse(await f.text()); } catch (e) { avisar("Ese archivo no es un respaldo de Mis Finanzas."); return; }
        const valido = r && r.app === "Mis Finanzas" && Array.isArray(r.hojas) && r.hojas.some(h => h && h.nombre === "Movimientos") &&
          r.hojas.every(h => h && typeof h.nombre === "string" && Array.isArray(h.datos));
        if (!valido) { avisar("Ese archivo no es un respaldo de Mis Finanzas."); return; }
        const cuando = r.creado ? new Date(r.creado).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }) : "fecha desconocida";
        if (!confirm("Esto reemplaza todo lo que hay en este teléfono por el respaldo del " + cuando + " (" + (r.movimientos || 0) + " movimientos). ¿Seguir?")) return;
        await escribir("libro", { hojas: r.hojas, props: r.props && typeof r.props === "object" ? r.props : {}, guardado: new Date().toISOString() });
        await escribir("respaldo", r.creado || new Date().toISOString());
        try { localStorage.removeItem("fa_datos"); } catch (e) {}
        location.reload();
      };
      i.click();
    },

    formPin() {
      window.abrirHoja(E.pin ? "Cambiar PIN" : "Activar PIN",
        '<p class="ayuda" style="margin:0 0 12px">De 4 a 8 números. Si lo olvidas, la única salida es borrar los datos del teléfono y restaurar un respaldo.</p>' +
        '<div class="campo"><label for="fa-pin1">PIN nuevo</label><input class="inp num" id="fa-pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></div>' +
        '<div class="campo"><label for="fa-pin2">Repite el PIN</label><input class="inp num" id="fa-pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></div>' +
        '<div class="error" id="fa-pin-err"></div>',
        '<button class="btn btn-p btn-bloque" onclick="FALocal.guardarPin(this)"><i class="ti ti-lock"></i>Guardar PIN</button>');
      setTimeout(() => { const x = document.getElementById("fa-pin1"); if (x) x.focus(); }, 80);
    },
    async guardarPin() {
      const a = document.getElementById("fa-pin1").value, b = document.getElementById("fa-pin2").value, err = document.getElementById("fa-pin-err");
      if (!/^[0-9]{4,8}$/.test(a)) { err.textContent = "El PIN debe tener de 4 a 8 números."; return; }
      if (a !== b) { err.textContent = "Los dos PIN no coinciden."; return; }
      const sal = codigo();
      E.pin = { sal: sal, hash: await hashPin(a, sal) };
      await escribir("pin", E.pin);
      try { localStorage.setItem("fa_pin_on", "1"); } catch (e) {}
      window.cerrarHoja(); refrescarAjustes(); avisar("PIN activado.");
    },
    async quitarPin() {
      if (!confirm("¿Quitar el PIN? La app abrirá sin pedirlo.")) return;
      E.pin = null; await escribir("pin", null);
      try { localStorage.removeItem("fa_pin_on"); } catch (e) {} refrescarAjustes(); avisar("PIN quitado.");
    },

    enlace(x) {
      const p = new URLSearchParams({ a: "registrar", tipo: x.tipo || "Gasto" });
      if (x.monto) p.set("monto", x.monto);
      ["categoria", "medio", "nota"].forEach(k => { if (x[k]) p.set(k, x[k]); });
      if (x.monto && x.categoria) p.set("guardar", "1");
      return location.origin + location.pathname + "?" + p.toString();
    },
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
    ".fa-bl-caja h1{font-size:20px;margin:4px 0 0}.fa-bl-caja p{color:var(--t3,#566A80);margin:0 0 6px}" +
    "#fa-bl-form{display:flex;flex-direction:column;gap:10px;width:100%}" +
    "#fa-bl-pin{width:100%;min-height:56px;text-align:center;font-size:28px;letter-spacing:.4em;border:1px solid var(--b,#DCE4EE);border-radius:14px;background:var(--s,#fff);color:var(--t,#12304D)}" +
    "#fa-bl-form button{min-height:52px;border:0;border-radius:14px;background:var(--a,#1F5C99);color:var(--s,#fff);font-weight:700;font-size:16px}" +
    ".fa-bl-link{background:none;border:0;color:var(--a,#1F5C99);min-height:44px;font-weight:600}";
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style"); st.textContent = ESTILO; document.head.appendChild(st);
    listo.then(() => {
      bloquear();
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

  if ("serviceWorker" in navigator) {
    // Cuando llega una versión nueva de la app, se recarga sola una vez (sin esperar a la próxima apertura).
    // En la primera instalación no hay versión anterior, así que no recarga.
    if (navigator.serviceWorker.controller) {
      let recargada = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!recargada) { recargada = true; location.reload(); } });
    }
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").then(r => r.update()).catch(() => {}));
  }
})();
