// 1. ZACIĄGAMY WERSJĘ Z PLIKU KONFIGURACYJNEGO
importScripts('env.js');

// 2. DYNAMICZNA NAZWA CACHE
const CACHE_NAME = 'czuwak-build-' + self.APP_BUILD;

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/env.js',
    '/css/index.css',
    '/css/material-symbols.woff2',
    '/js/index.js',
    '/js/train.js',
    '/firebase-config.js',
    '/manifest.json',
    '/favicon.svg',
    '/favicon-ic.svg',
    '/apple-touch-icon.png',
    'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    if (event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('identitytoolkit.googleapis.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 &&
                   (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        const cleanUrl = event.request.url.split('?')[0];
                        cache.put(cleanUrl, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => null);

            if (cachedResponse) {
                event.waitUntil(fetchPromise);
                return cachedResponse;
            }

            return fetchPromise.then((netResp) => {
                if (netResp) return netResp;
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html', { ignoreSearch: true });
                }
                return new Response('Offline', { status: 503, statusText: 'Offline' });
            });
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
