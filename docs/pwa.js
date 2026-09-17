if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

// Install button — shared across all dashboard pages via this one script so
// each page doesn't need its own copy. Reads --accent from the page's own
// <style> so the button matches whichever dashboard it's on, rather than
// hardcoding one color here.
(function setupInstallButton() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return; // already installed/running as an app — nothing to offer

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function accentColor() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return value || '#5865f2';
  }

  function makeButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '1000',
      padding: '10px 16px',
      borderRadius: '999px',
      border: 'none',
      background: accentColor(),
      color: '#fff',
      fontSize: '13px',
      fontFamily: 'inherit',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
      cursor: 'pointer',
    });
    document.body.appendChild(button);
    return button;
  }

  if (isIos) {
    // beforeinstallprompt doesn't exist on iOS Safari — installation can only
    // be triggered by the user via the native Share sheet, so this button
    // just surfaces that instruction instead of an unavailable native prompt.
    const button = makeButton('📲 ホーム画面に追加');
    button.addEventListener('click', () => {
      alert('共有ボタン（□に↑）をタップ →「ホーム画面に追加」を選んでください');
    });
    return;
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    const button = makeButton('📲 ホーム画面に追加');
    button.addEventListener(
      'click',
      async () => {
        button.remove();
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      },
      { once: true },
    );
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
})();
