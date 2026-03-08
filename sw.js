/**
 * Service Worker – Lucid PWA
 * Stratégie : Cache First pour les assets statiques
 * Mise à jour du cache à chaque nouvelle version via CACHE_NAME
 */

const CACHE_NAME = 'lucid-v1';

// Liste des fichiers à mettre en cache lors de l'installation
// (tout le nécessaire pour fonctionner offline)
const ASSETS_TO_CACHE = [
  '/lucid/',
  '/lucid/index.html',
  '/lucid/manifest.json',
  '/lucid/offline.html',
  '/lucid/pwa.js',
  '/lucid/icon-192.png',
  '/lucid/icon-512.png'
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
// Déclenché une fois lors du premier enregistrement (ou mise à jour du SW).
// On pré-cache tous les assets essentiels.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Mise en cache des assets essentiels');
      // addAll échoue si un seul fichier est manquant → les icônes sont optionnelles
      return cache.addAll(
        ASSETS_TO_CACHE.filter(url => !url.includes('icon-'))
      ).then(() => {
        // Tentative d'ajout des icônes (non bloquant si absentes)
        return Promise.allSettled([
          cache.add('/lucid/icon-192.png'),
          cache.add('/lucid/icon-512.png')
        ]);
      });
    }).then(() => {
      // Force l'activation immédiate sans attendre la fermeture des onglets
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
// Déclenché après install. On supprime les anciens caches (versions précédentes).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME) // tous sauf le cache actuel
          .map((name) => {
            console.log('[SW] Suppression ancien cache :', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Prend le contrôle immédiat de tous les onglets ouverts
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
// Intercepte toutes les requêtes réseau.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // On ne gère que les requêtes GET (pas les POST, etc.)
  if (request.method !== 'GET') return;

  // Stratégie : Cache First → réseau → fallback offline
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // ✅ Trouvé en cache → réponse immédiate
        return cachedResponse;
      }

      // ❌ Pas en cache → on essaie le réseau
      return fetch(request)
        .then((networkResponse) => {
          // On met en cache les nouvelles ressources du même domaine
          if (
            networkResponse.ok &&
            url.origin === self.location.origin
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // ⚠️ Hors ligne et pas en cache → page offline de fallback
          if (request.destination === 'document') {
            return caches.match('/lucid/offline.html');
          }
          // Pour les autres ressources (images, etc.), réponse vide
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
        });
    })
  );
});
