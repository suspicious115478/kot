const CACHE_NAME = "menuadmin-v1";

const STATIC_ASSETS = [
  "./index.html",
  "./dashboard.html",
  "./categories.html",
  "./menu-items.html",
  "./edit-menu.html",
  "./edit-category.html",
  "./orders.html",
  "./discount-items.html",
  "./featured-items.html",
  "./ad-banner.html",
  "./brand-color.html",
  "./analysis.html",
  "./taxes.html",
  "./stock.html",
  "./stock-out.html",
  "./prepared-stocks.html",
  "./payment-settings.html",
  "./kiosk-layout.html",
  "./front-screen.html",
  "./web-order.html",
  "./recipes.html",
  "./inventory.html"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});