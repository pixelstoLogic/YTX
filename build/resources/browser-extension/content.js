(() => {
  if (window.__ytxHandoffInstalled) return;
  window.__ytxHandoffInstalled = true;

  const BUTTON_ID = 'ytx-trim-handoff';
  let lastHref = '';
  let installTimer = null;
  let feedbackTimer = null;

  function videoId() {
    const url = new URL(location.href);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (!host.endsWith('youtube.com')) return '';
    if (url.pathname === '/watch') return url.searchParams.get('v') || '';
    const match = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/.exec(url.pathname);
    return match ? match[1] : '';
  }

  function handoffUrl() {
    const id = videoId();
    return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
  }

  function isShorts() {
    return /^\/shorts\//.test(location.pathname);
  }

  function resetButton(button) {
    if (!button || !button.isConnected) return;
    button.textContent = '✂ Open in YTX';
    button.removeAttribute('aria-busy');
  }

  function installButton() {
    const existing = document.getElementById(BUTTON_ID);
    const target = handoffUrl();
    if (!target) {
      if (existing) existing.remove();
      return;
    }
    if (document.hidden) return;
    if (!document.querySelector('video')) return;
    if (existing) {
      existing.style.bottom = isShorts() ? '86px' : '24px';
      return;
    }
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '✂ Open in YTX';
    button.title = 'Preview and trim this video in YTX Studio';
    button.setAttribute('aria-label', 'Open this YouTube video in YTX Studio');
    Object.assign(button.style, {
      position: 'fixed',
      right: isShorts() ? '74px' : '24px',
      bottom: isShorts() ? '86px' : '24px',
      zIndex: '2147483647',
      border: '1px solid #d4ff46',
      borderRadius: '22px',
      padding: '11px 17px',
      background: 'linear-gradient(180deg,#20241b,#15171a)',
      color: '#eaff9b',
      font: '600 13px system-ui,sans-serif',
      boxShadow: '0 5px 24px #0009, inset 0 1px 0 #ffffff12',
      cursor: 'pointer',
      transition: 'transform .15s ease, box-shadow .15s ease'
    });
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 8px 26px #000a, 0 0 0 3px #d4ff4617';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = '';
      button.style.boxShadow = '0 5px 24px #0009, inset 0 1px 0 #ffffff12';
    });
    button.addEventListener('click', () => {
      const url = handoffUrl();
      if (!url) return;
      clearTimeout(feedbackTimer);
      button.textContent = 'Opening YTX Studio…';
      button.setAttribute('aria-busy', 'true');
      location.href = 'ytx://download?url=' + encodeURIComponent(url);
      feedbackTimer = setTimeout(() => {
        if (!button.isConnected) return;
        button.textContent = 'Open YTX Studio to continue';
        button.removeAttribute('aria-busy');
        feedbackTimer = setTimeout(() => resetButton(button), 5000);
      }, 900);
    });
    document.body.appendChild(button);
  }

  function scheduleInstall() {
    if (installTimer) return;
    installTimer = setTimeout(() => {
      installTimer = null;
      installButton();
    }, 120);
  }

  const observer = new MutationObserver(scheduleInstall);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleInstall();
  }, { once: true });

  for (const eventName of ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated', 'popstate']) {
    window.addEventListener(eventName, scheduleInstall, true);
  }
  window.addEventListener('pageshow', scheduleInstall);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleInstall(); });

  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const existing = document.getElementById(BUTTON_ID);
    if (existing) existing.remove();
    scheduleInstall();
  }, 700);

  lastHref = location.href;
  scheduleInstall();
})();
