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

    // 리뷰 페이지 감지
    if (event.data.type === 'DDALKKAK_DETECT_REVIEW_PAGE') {
      const info = detectReviewPage();
      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_REVIEW_PAGE_INFO',
        data: info
      }, '*');
    }

    // 리뷰 수집 시작
    if (event.data.type === 'DDALKKAK_COLLECT_REVIEWS') {
      collectReviews(event.data.maxReviews || 200);
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

  // ===== 리뷰 수집: 네이버 스마트스토어/브랜드스토어 =====

  function detectReviewPage() {
    const url = window.location.href;
    const host = window.location.hostname;

    // 네이버 스마트스토어 / 브랜드스토어
    if (host.includes('smartstore.naver.com') || host.includes('brand.naver.com')) {
      // __NEXT_DATA__에서 상품 정보 추출
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        try {
          const data = JSON.parse(nextData.textContent);
          const productInfo = findProductInfo(data);
          if (productInfo) {
            return {
              supported: true,
              platform: '네이버 스마트스토어',
              productName: productInfo.name || document.title,
              merchantNo: productInfo.merchantNo,
              originProductNo: productInfo.originProductNo,
              channelUid: productInfo.channelUid,
            };
          }
        } catch {}
      }

      // fallback: URL에서 추출 시도
      const productMatch = url.match(/products\/(\d+)/);
      if (productMatch) {
        // 페이지 소스에서 merchantNo 찾기
        const scripts = document.querySelectorAll('script');
        let merchantNo = '';
        for (const s of scripts) {
          const text = s.textContent;
          const mMatch = text.match(/"merchantNo"\s*:\s*"?(\d+)"?/);
          if (mMatch) { merchantNo = mMatch[1]; break; }
        }
        return {
          supported: true,
          platform: '네이버 스마트스토어',
          productName: document.title.replace(/ : .*$/, '').trim(),
          merchantNo,
          originProductNo: productMatch[1],
        };
      }
    }

    return { supported: false };
  }

  // __NEXT_DATA__ 재귀 탐색으로 상품 정보 찾기
  function findProductInfo(obj, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return null;

    if (obj.merchantNo && obj.originProductNo) {
      return {
        merchantNo: String(obj.merchantNo),
        originProductNo: String(obj.originProductNo),
        name: obj.name || obj.productName || '',
        channelUid: obj.channelUid || '',
      };
    }

    for (const key of Object.keys(obj)) {
      const found = findProductInfo(obj[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  // 네이버 리뷰 API 호출 (content script에서 — 같은 도메인이라 CORS 없음)
  async function fetchNaverReviews(merchantNo, originProductNo, starScore, maxReviews, progressCallback) {
    const reviews = [];
    let page = 1;
    const maxPages = Math.ceil(maxReviews / 20);

    while (page <= maxPages) {
      try {
        const apiUrl = `https://${window.location.hostname}/i/v1/reviews/paged-reviews` +
          `?page=${page}&pageSize=20&merchantNo=${merchantNo}` +
          `&originProductNo=${originProductNo}` +
          `&sortType=REVIEW_CREATE_DATE&starScore=${starScore}`;

        const resp = await fetch(apiUrl, {
          headers: { 'Accept': 'application/json' }
        });

        if (!resp.ok) break;
        const data = await resp.json();

        if (!data.contents || data.contents.length === 0) break;

        for (const r of data.contents) {
          const text = (r.reviewContent || '').trim();
          if (text.length > 5) {
            reviews.push(text);
          }
          if (reviews.length >= maxReviews) break;
        }

        if (progressCallback) {
          const total = Math.min(data.totalElements || maxReviews, maxReviews);
          progressCallback(reviews.length, total);
        }

        if (reviews.length >= maxReviews) break;
        if (page >= (data.totalPages || 1)) break;
        page++;
      } catch {
        break;
      }
    }

    return reviews;
  }

  // 리뷰 수집 메시지 처리
  async function collectReviews(maxReviews) {
    const pageInfo = detectReviewPage();
    if (!pageInfo.supported || !pageInfo.merchantNo || !pageInfo.originProductNo) {
      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_REVIEW_RESULT',
        success: false,
        error: '상품 정보를 찾을 수 없습니다. 네이버 스마트스토어 상품 페이지에서 사용해주세요.'
      }, '*');
      return;
    }

    const sendProgress = (text, pct) => {
      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_REVIEW_PROGRESS',
        percent: pct,
        text
      }, '*');
    };

    // 1~2점 리뷰 수집 (단점)
    sendProgress('1점 리뷰 수집 중', 5);
    const reviews1 = await fetchNaverReviews(
      pageInfo.merchantNo, pageInfo.originProductNo, 1, maxReviews,
      (got, total) => sendProgress(`1점 리뷰 수집 중 (${got}개)`, 5 + (got / maxReviews) * 15)
    );

    sendProgress('2점 리뷰 수집 중', 25);
    const reviews2 = await fetchNaverReviews(
      pageInfo.merchantNo, pageInfo.originProductNo, 2, maxReviews - reviews1.length,
      (got, total) => sendProgress(`2점 리뷰 수집 중 (${got}개)`, 25 + (got / maxReviews) * 15)
    );

    const negativeReviews = [...reviews1, ...reviews2].slice(0, maxReviews);

    // 5점 리뷰 수집 (장점)
    sendProgress('5점 리뷰 수집 중', 45);
    const reviews5 = await fetchNaverReviews(
      pageInfo.merchantNo, pageInfo.originProductNo, 5, maxReviews,
      (got, total) => sendProgress(`5점 리뷰 수집 중 (${got}개)`, 45 + (got / maxReviews) * 20)
    );

    const positiveReviews = reviews5.slice(0, maxReviews);

    sendProgress('AI 분석 요청 중', 70);

    iframe.contentWindow.postMessage({
      type: 'DDALKKAK_REVIEW_RESULT',
      success: true,
      positiveReviews,
      negativeReviews,
      productName: pageInfo.productName
    }, '*');
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
