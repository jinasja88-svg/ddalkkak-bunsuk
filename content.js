// 딸깍분석 - Content Script
// 페이지에 사이드패널(iframe) 삽입 + DOM 추출

(() => {
  // 중복 삽입 방지
  if (document.getElementById('ddalkkak-panel-wrapper')) {
    const existing = document.getElementById('ddalkkak-panel-wrapper');
    existing.style.display = existing.style.display === 'none' ? 'block' : 'none';
    return;
  }

  // ===== 사이드패널 컨테이너 =====
  const wrapper = document.createElement('div');
  wrapper.id = 'ddalkkak-panel-wrapper';
  wrapper.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 420px;
    height: 85vh;
    max-height: 900px;
    z-index: 2147483647;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(102,126,234,0.3);
    resize: both;
    min-width: 320px;
    min-height: 300px;
  `;

  // ===== iframe 삽입 =====
  const iframe = document.createElement('iframe');
  iframe.id = 'ddalkkak-panel-iframe';
  iframe.src = chrome.runtime.getURL('panel.html');
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 12px;
  `;
  iframe.allow = 'clipboard-write';

  wrapper.appendChild(iframe);
  document.body.appendChild(wrapper);

  // ===== 드래그 기능 =====
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // iframe 위에서 드래그 이벤트를 받기 위한 오버레이
  const dragOverlay = document.createElement('div');
  dragOverlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2147483648; display: none; cursor: move;
  `;
  wrapper.appendChild(dragOverlay);

  window.addEventListener('message', (event) => {
    if (!event.data) return;

    // 드래그 시작 (헤더 mousedown)
    if (event.data.type === 'DDALKKAK_DRAG_START') {
      isDragging = true;
      dragOverlay.style.display = 'block';
      const rect = wrapper.getBoundingClientRect();
      dragOffsetX = event.data.x;
      dragOffsetY = event.data.y;
    }

    // 닫기
    if (event.data.type === 'DDALKKAK_CLOSE') {
      wrapper.style.display = 'none';
    }

    // DOM 추출 요청
    if (event.data.type === 'DDALKKAK_EXTRACT_DOM') {
      const data = extractPageDOM();
      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_DOM_RESULT',
        success: true,
        data
      }, '*');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    wrapper.style.right = 'auto';
    wrapper.style.left = (e.clientX - dragOffsetX) + 'px';
    wrapper.style.top = (e.clientY - dragOffsetY) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    dragOverlay.style.display = 'none';
  });

  // ===== DOM 텍스트 추출 =====
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH',
    'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'IFRAME'
  ]);

  function extractText(node) {
    if (!node) return '';
    if (node.nodeType === Node.COMMENT_NODE) return '';
    if (node.id === 'ddalkkak-panel-wrapper') return '';
    if (SKIP_TAGS.has(node.tagName)) return '';

    if (node.nodeType === Node.ELEMENT_NODE) {
      try {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
      } catch {}
    }

    if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();

    if (node.tagName === 'IMG') {
      const alt = node.getAttribute('alt');
      if (alt && alt.trim()) return `[이미지: ${alt.trim()}]`;
      return '';
    }

    let text = '';
    for (const child of node.childNodes) {
      const childText = extractText(child);
      if (childText) text += childText + '\n';
    }
    return text;
  }

  function extractPageDOM() {
    const rawText = extractText(document.body);
    const lines = [];
    const seen = new Set();
    for (const line of rawText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && trimmed.length > 1 && !seen.has(trimmed)) {
        seen.add(trimmed);
        lines.push(trimmed);
      }
    }
    const cleanText = lines.join('\n');
    return {
      text: cleanText,
      meta: {
        title: document.title || '',
        url: window.location.href,
        description: document.querySelector('meta[name="description"]')?.content || '',
        ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
        ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
      },
      charCount: cleanText.length,
      url: window.location.href
    };
  }

  // ===== 헤더 드래그 이벤트 연결 (iframe 내부 → 외부) =====
  iframe.addEventListener('load', () => {
    // panel.html 내부에서 드래그 시작 메시지를 보내도록 설정
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      const dragHandle = iframeDoc.getElementById('dragHandle');
      if (dragHandle) {
        dragHandle.addEventListener('mousedown', (e) => {
          const rect = wrapper.getBoundingClientRect();
          isDragging = true;
          dragOverlay.style.display = 'block';
          dragOffsetX = e.clientX - rect.left;
          dragOffsetY = e.clientY - rect.top;
        });
      }
    } catch {}
  });
})();
