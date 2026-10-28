(() => {
  const BUTTON_ID = 'ytx-trim-handoff';
  let queued = false;
  function validWatchPage() {
    return location.hostname === 'youtu.be' || (location.hostname.endsWith('youtube.com') && location.pathname === '/watch' && !!new URLSearchParams(location.search).get('v'));
  }
  function installButton() {
    if (!validWatchPage()) { document.getElementById(BUTTON_ID)?.remove(); return; }
    if (!document.querySelector('video') || document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '✂ Open in YTX';
    button.title = 'Preview and trim this video in YTX Studio';
    Object.assign(button.style, { position: 'fixed', right: '24px', bottom: '24px', zIndex: '2147483647', border: '1px solid #d4ff46', borderRadius: '22px', padding: '11px 17px', background: '#17191c', color: '#eaff9b', font: '600 13px system-ui,sans-serif', boxShadow: '0 5px 24px #0009', cursor: 'pointer' });
    button.addEventListener('click', () => {
      if (!validWatchPage()) return;
      queued = true;
      button.textContent = 'Opening YTX Studio…';
      location.href = 'ytx://download?url=' + encodeURIComponent(location.href);
      setTimeout(() => { if (queued) button.textContent = 'Open YTX Studio to continue'; }, 700);
    });
    document.body.appendChild(button);
  }
  const observer = new MutationObserver(installButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', installButton);
  window.addEventListener('popstate', installButton);
  installButton();
})();

