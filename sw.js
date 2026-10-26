
"use strict";

const CACHE_NAME = "wtmug-yoklama-v1";

const FILES = [
  "./",
  "./index.html",
  "./lecturer.html",
  "./student.html",
  "./report.html",
  "./style.css",
  "./app.js",
  "./students.json",
  "./courses.json",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Yalnızca bu GitHub Pages projesinin dosyalarını önbelleğe al.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached;

      const response = await fetch(request);

      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }

      return response;
    })
  );
});
