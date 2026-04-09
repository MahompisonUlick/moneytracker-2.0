/**
 * MoneyTracker Pro Service Worker
 * Version: 4.0.0 - Mode Hors Ligne Robuste
 * Stratégie : Cache First, Network Fallback, puis Offline Page pour navigation
 * Assure que l'application est fonctionnelle même sans connexion.
 */

const CACHE_VERSION = 'v4.0.0';
const CACHE_NAME = `moneytracker-${CACHE_VERSION}`;

// Liste de TOUS les assets nécessaires pour que l'application démarre et fonctionne hors ligne.
// Comme tout est dans index.html, cette liste est simple.
const ASSETS_TO_CACHE = [
  './', // Ceci met en cache la page index.html si l'URL est la racine
  './index.html',
  './manifest.json'
  // Si tu avais des fichiers CSS ou JS externes, il faudrait les ajouter ici :
  // './styles.css',
  // './app.js',
  // './images/icon-192.png',
  // './images/icon-512.png',
  // Note: Les icônes sont maintenant des data-URL SVG intégrées dans manifest.json et index.html pour plus de robustesse.
  // Les bibliothèques jsPDF et html2canvas sont chargées via CDN, leur mise en cache est gérée dynamiquement.
];

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets:', ASSETS_TO_CACHE);
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] All core assets cached successfully!');
        return self.skipWaiting(); // Force le nouveau SW à prendre le contrôle
      })
      .catch((error) => {
        console.error('[SW] Failed to cache core assets:', error);
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

  // Si c'est une requête de navigation (chargement de page HTML)
  if (request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept').includes('text/html'))) {
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
            // Si la requête réseau réussit, mettez la ressource en cache
            if (networkResponse.ok && networkResponse.type === 'basic') { // 'basic' pour les requêtes same-origin
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, networkResponse.clone());
              });
            } else if (networkResponse.ok && (url.hostname.includes('jsdelivr') || url.hostname.includes('html2canvas') || url.hostname.includes('jspdf'))) {
              // Gérer spécifiquement les CDN comme jsPDF/html2canvas.
              // Ils doivent être mis en cache dynamiquement pour fonctionner hors ligne après le premier chargement.
              caches.open(CACHE_NAME).then(cache => {
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
            // Pour les autres types de ressources, on laisse potentiellement le navigateur afficher une erreur,
            // ou on peut ici renvoyer un fichier de fallback générique si on en a un.
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
});

// ========== BACKGROUND SYNC (si tu as besoin de synchroniser des données plus tard) ==========
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions()); // Une fonction à implémenter si tu avais un backend
  }
});

async function syncTransactions() {
  // Ici, tu mettrais la logique pour envoyer les transactions mises en file d'attente
  // lorsque l'application était hors ligne vers un serveur distant, si tu en avais un.
  console.log('[SW] Attempting to sync transactions to server...');
  // Exemple: Lire depuis IndexedDB, envoyer via fetch, puis supprimer de IndexedDB
}

console.log('[SW] Service Worker loaded - v' + CACHE_VERSION);
