// 딸깍분석 - Content Script
// 현재 페이지의 DOM 텍스트 추출만 담당

(() => {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH',
    'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'IFRAME'
  ]);

  function extractText(node) {
    if (!node) return '';
    if (node.nodeType === Node.COMMENT_NODE) return '';
    if (SKIP_TAGS.has(node.tagName)) return '';

    if (node.nodeType === Node.ELEMENT_NODE) {
      try {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
      } catch {}
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.trim();
    }

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

  function extractMeta() {
    return {
      title: document.title || '',
      url: window.location.href,
      description: document.querySelector('meta[name="description"]')?.content || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
    };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_DOM') {
      try {
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
        const meta = extractMeta();

        sendResponse({
          success: true,
          data: { text: cleanText, meta, charCount: cleanText.length, url: window.location.href }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true;
  });
})();
