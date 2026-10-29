// Mis Finanzas · app del teléfono · guarda la app para abrirla sin internet.
// Cambiar VERSION en cada entrega: así el teléfono baja los archivos nuevos.
// Todo es de la misma app: no se carga nada de otros servidores.
const VERSION = "mf-telefono-3.8.0";
const APP = ["./", "./manifest.webmanifest", "./js/gas-local.js", "./js/motor.js", "./js/local.js",
  "./vendor/tabler/tabler-icons.min.css", "./vendor/tabler/fonts/tabler-icons.woff2",
  "./icons/icon.svg", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/atajo-gasto.png", "./icons/atajo-ingreso.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(claves => Promise.all(claves.filter(k => k.indexOf("mf-") === 0 && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // lo externo (UF, planilla opcional) va directo a la red
  // Abrir la app (también con ?a=registrar… o #pwa=…): siempre la copia guardada
  // (se guarda "./" y no "./index.html": algunos servidores redirigen index.html, y una página redirigida no sirve para abrir)
  if (req.mode === "navigate") { e.respondWith(caches.match("./").then(r => r || fetch(req))); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(g => g || fetch(req)));
});
