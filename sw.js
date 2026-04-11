/**
 * MoneyTracker Pro Service Worker
 * Version: 4.1.0 - Mode Hors Ligne Robuste
 * Stratégie : Cache First, Network Fallback, puis Offline Page pour navigation
 * Assure que l'application est fonctionnelle même sans connexion.
 */

const CACHE_VERSION = 'v4.1.0'; // Nouvelle version du cache
const CACHE_NAME = `moneytracker-${CACHE_VERSION}`;

// Liste de TOUS les assets nécessaires pour que l'application démarre et fonctionne hors ligne.
// Comme tout est dans index.html (y compris le CSS et JS), cette liste est simple.
// Les bibliothèques CDN (jsPDF, html2canvas) seront gérées dynamiquement.
const ASSETS_TO_CACHE = [
  './', // Ceci met en cache la page index.html si l'URL est la racine
  './index.html',
  './manifest.json'
];

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets:', ASSETS_TO_CACHE);
        // Important: cache.addAll échoue si une ressource n'est pas disponible.
        // Assure-toi que ces fichiers existent à la racine de ton serveur/GitHub Pages.
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] All core assets cached successfully!');
        return self.skipWaiting(); // Force le nouveau SW à prendre le contrôle
      })
      .catch((error) => {
        console.error('[SW] Failed to cache core assets:', error);
        // En cas d'échec, le SW ne s'activera pas, c'est mieux que de s'activer avec un cache partiel.
      })
  );
});

// ========== ACTIVATE ==========
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.filter((name) => {
            // Supprime tous les anciens caches de l'application
            return name.startsWith('moneytracker-') && name !== CACHE_NAME;
          }).map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
        );
      })
      .then(() => self.clients.claim()) // Permet au SW de contrôler les clients existants immédiatement
      .then(() => console.log('[SW] Activation complete. Old caches cleaned.'))
  );
});

// ========== FETCH ==========
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Exclure les requêtes "chrome-extension://" et autres protocoles non http(s)
  if (!url.protocol.startsWith('http') && !url.protocol.startsWith('https')) {
      return;
  }

  // Si c'est une requête de navigation (chargement de page HTML)
  if (request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(request) // Essayer d'obtenir la version la plus récente depuis le réseau
        .then(response => {
          // Si la requête réseau réussit, mettez-la en cache pour la prochaine fois
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, response.clone());
            });
          }
          return response;
        })
        .catch(() => {
          // Si le réseau échoue (hors ligne), servir index.html depuis le cache
          console.log('[SW] Network failed for navigation, serving cached index.html');
          return caches.match('./index.html');
        })
    );
    return; // On a géré la requête de navigation, on arrête ici
  }

  // Pour toutes les autres ressources (CSS, JS, images, etc.)
  // Stratégie : Cache First, Network Fallback
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Si la ressource est dans le cache, la retourner
        if (cachedResponse) {
          return cachedResponse;
        }

        // Sinon, tenter de la récupérer du réseau
        return fetch(request)
          .then((networkResponse) => {
            // Si la requête réseau réussit et que c'est une ressource valide à mettre en cache
            if (networkResponse.ok && networkResponse.type === 'basic') { // 'basic' pour les requêtes same-origin
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, networkResponse.clone());
              });
            } 
            // Gérer spécifiquement les bibliothèques CDN : jsPDF et html2canvas
            // Ces URLs contiennent typiquement "jsdelivr", "cdnjs" ou "html2canvas", "jspdf" dans leur chemin.
            else if (networkResponse.ok && (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('html2canvas.hertzen.com'))) {
                caches.open(CACHE_NAME).then(cache => {
                    console.log('[SW] Dynamically caching CDN resource:', request.url);
                    cache.put(request, networkResponse.clone());
                });
            }
            return networkResponse;
          })
          .catch(() => {
            // Si la ressource n'est pas dans le cache et le réseau échoue
            console.log('[SW] Fetch failed for:', request.url);
            // On peut retourner une ressource de secours spécifique si nécessaire
            if (request.destination === 'image') {
              // Retourne un SVG placeholder pour les images cassées
              return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#1a1a2e" width="100" height="100"/><text fill="white" x="50" y="55" text-anchor="middle" font-size="60">💰</text></svg>',
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            }
            // Pour les autres types de ressources, si ce n'est pas un fichier statique déjà mis en cache,
            // ou un CDN qui devrait être en cache dynamique, cela pourrait être une erreur.
            // Le comportement par défaut est de laisser l'erreur se propager, ce qui affiche la page d'erreur du navigateur.
            // Pour une PWA self-contained comme celle-ci, la plupart des assets critiques sont déjà dans index.html
            // ou mis en cache statiquement.
            throw new Error('Ressource non disponible hors ligne et réseau échoué.');
          });
      })
  );
});

// ========== MESSAGE (pour la mise à jour forcée si nécessaire) ==========
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => event.ports[0]?.postMessage({ success: true }));
  }
});

// ========== BACKGROUND SYNC (si tu as besoin de synchroniser des données plus tard) ==========
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions()); // Une fonction à implémenter si tu avais un backend
  }
});

async function syncTransactions() {
  console.log('[SW] Attempting to sync transactions to server...');
  // Cette fonction serait à implémenter si tu avais un backend.
  // Pour une app purement client-side (comme MoneyTracker Pro), cela n'est pas nécessaire.
}

console.log('[SW] Service Worker loaded - v' + CACHE_VERSION);
