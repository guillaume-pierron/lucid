/**
 * pwa.js – Gestion PWA de Lucid
 * - Enregistrement du Service Worker
 * - Gestion du prompt d'installation natif (beforeinstallprompt)
 * - Détection du mode standalone (app déjà installée)
 */

(function () {
  'use strict';

  // ── 1. DÉTECTION MODE STANDALONE ──────────────────────────────────────────
  // Vérifie si l'app tourne déjà en mode installé (standalone/fullscreen)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true; // iOS Safari

  if (isStandalone) {
    // L'app est déjà installée → on peut masquer tout prompt d'installation
    console.log('[PWA] Mode standalone détecté – app installée');
    document.documentElement.classList.add('pwa-standalone');
  }

  // ── 2. ENREGISTREMENT DU SERVICE WORKER ───────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/lucid/sw.js', { scope: '/lucid/' })
        .then((registration) => {
          console.log('[SW] Enregistré avec succès, scope :', registration.scope);

          // Vérifie les mises à jour du SW en arrière-plan
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                // Nouvelle version disponible → optionnel : notifier l'utilisateur
                console.log('[SW] Mise à jour disponible');
              }
            });
          });
        })
        .catch((error) => {
          console.warn('[SW] Échec de l\'enregistrement :', error);
        });
    });
  }

  // ── 3. GESTION DU PROMPT D'INSTALLATION ───────────────────────────────────
  // L'événement beforeinstallprompt est déclenché par le navigateur quand
  // l'app est installable. On le capture pour l'utiliser plus tard.
  let deferredInstallPrompt = null;
  const installBanner = document.getElementById('pwa-install-banner');
  const installBtn = document.getElementById('pwa-install-btn');
  const installDismiss = document.getElementById('pwa-install-dismiss');

  window.addEventListener('beforeinstallprompt', (event) => {
    // Empêche le mini-infobar Chrome de s'afficher automatiquement
    event.preventDefault();
    deferredInstallPrompt = event;

    // Affiche notre bannière custom si pas déjà installé
    if (!isStandalone && installBanner) {
      // Petit délai pour ne pas bloquer le chargement initial
      setTimeout(() => {
        installBanner.classList.add('pwa-banner--visible');
      }, 3000);
    }
  });

  // Clic sur le bouton "Installer"
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;

      // Affiche le dialogue natif d'installation
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      console.log('[PWA] Réponse utilisateur :', outcome); // 'accepted' ou 'dismissed'

      // Réinitialise (le prompt ne peut être utilisé qu'une seule fois)
      deferredInstallPrompt = null;
      hideBanner();
    });
  }

  // Clic sur "Fermer" (dismiss)
  if (installDismiss) {
    installDismiss.addEventListener('click', hideBanner);
  }

  function hideBanner() {
    if (installBanner) {
      installBanner.classList.remove('pwa-banner--visible');
    }
  }

  // ── 4. ÉVÉNEMENT APRÈS INSTALLATION ───────────────────────────────────────
  // Déclenché quand l'utilisateur accepte l'installation
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installée avec succès !');
    deferredInstallPrompt = null;
    hideBanner();
  });

})();
