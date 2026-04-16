// honey_bridge.js - 딸깍쇼핑 honey-list 페이지와 익스텐션 브릿지
// 웹페이지에서 postMessage로 요청 → chrome.runtime으로 background에 전달 → 결과를 웹페이지에 반환

(function () {
  // 익스텐션 설치 표시 (웹페이지가 감지할 수 있게)
  const marker = document.createElement('div');
  marker.id = '__ddalkkak_extension_installed__';
  marker.style.display = 'none';
  marker.dataset.version = chrome.runtime.getManifest().version;
  (document.documentElement || document.body || document).appendChild(marker);

  // background → content script 브로드캐스트를 window.postMessage로 페이지에 전달
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type || !msg.type.startsWith('DDALKKAK_')) return;
    try { window.postMessage(msg, '*'); } catch {}
  });

  // 웹페이지 → content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (!msg.type || !msg.type.startsWith('DDALKKAK_')) return;

    const { type, payload, requestId } = msg;

    if (type === 'DDALKKAK_PING') {
      window.postMessage({
        type: 'DDALKKAK_PONG',
        requestId,
        success: true,
        version: chrome.runtime.getManifest().version
      }, '*');
      return;
    }

    if (type === 'DDALKKAK_CRAWL_REQUEST') {
      const { urls, mode } = payload || {};
      chrome.runtime.sendMessage(
        { action: 'DDALKKAK_CRAWL_ITEMS', urls, mode },
        (resp) => {
          window.postMessage({
            type: 'DDALKKAK_CRAWL_RESPONSE',
            requestId,
            ...(resp || { success: false, error: 'No response' })
          }, '*');
        }
      );
      return;
    }

    if (type === 'DDALKKAK_WING_CATEGORY_CRAWL_REQUEST') {
      const { categoryCode, categoryPath } = payload || {};
      chrome.runtime.sendMessage(
        { action: 'DDALKKAK_WING_CATEGORY_CRAWL', categoryCode, categoryPath },
        (resp) => {
          window.postMessage({
            type: 'DDALKKAK_WING_CATEGORY_CRAWL_RESPONSE',
            requestId,
            ...(resp || { success: false, error: 'No response' })
          }, '*');
        }
      );
      return;
    }
  });
})();
