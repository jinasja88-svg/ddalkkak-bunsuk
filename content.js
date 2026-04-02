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

    // 리뷰 페이지 감지 → background에 요청
    if (event.data.type === 'DDALKKAK_DETECT_REVIEW_PAGE') {
      chrome.runtime.sendMessage({ action: 'DETECT_REVIEW_PAGE' }, (response) => {
        if (response?.success) {
          window.__ddalkkak_product_info__ = response.data;
          iframe.contentWindow.postMessage({
            type: 'DDALKKAK_REVIEW_PAGE_INFO',
            data: {
              supported: true,
              platform: response.data.isBrand ? '네이버 브랜드스토어' : '네이버 스마트스토어',
              productName: response.data.productName
            }
          }, '*');
        } else {
          iframe.contentWindow.postMessage({
            type: 'DDALKKAK_REVIEW_PAGE_INFO',
            data: { supported: false }
          }, '*');
        }
      });
    }

    // 리뷰 수집 시작
    if (event.data.type === 'DDALKKAK_COLLECT_REVIEWS') {
      const info = window.__ddalkkak_product_info__;
      if (!info) {
        iframe.contentWindow.postMessage({
          type: 'DDALKKAK_REVIEW_RESULT', success: false,
          error: '상품 정보를 찾을 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요.'
        }, '*');
        return;
      }
      collectReviewsWithInfo(info, event.data.maxReviews || 50);
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
  // window.__PRELOADED_STATE__ 에서 상품 정보 추출 + POST API로 리뷰 수집

  function detectReviewPage() {
    const host = window.location.hostname;
    if (host.includes('smartstore.naver.com') || host.includes('brand.naver.com')) {
      const productMatch = window.location.href.match(/products\/(\d+)/);
      if (productMatch) {
        // __PRELOADED_STATE__에서 상품 정보 추출
        const ps = window.__PRELOADED_STATE__;
        let productName = document.title.replace(/ : .*$/, '').trim();
        let merchantNo = '';
        let productNo = '';

        if (ps) {
          const s = JSON.stringify(ps);
          const m1 = s.match(/"payReferenceKey"\s*:\s*"?(\d+)"?/);
          const m2 = s.match(/"productNo"\s*:\s*"?(\d+)"?/);
          if (m1) merchantNo = m1[1];
          if (m2) productNo = m2[1];

          // 상품명
          try {
            if (ps.product?.A?.name) productName = ps.product.A.name;
            else if (ps.productSimpleView?.A?.name) productName = ps.productSimpleView.A.name;
          } catch {}
        }

        return {
          supported: true,
          platform: host.includes('brand') ? '네이버 브랜드스토어' : '네이버 스마트스토어',
          productName,
          merchantNo,
          productNo,
          isBrand: host.includes('brand.naver.com')
        };
      }
    }
    return { supported: false };
  }

  // 리뷰 API 호출 (POST 방식)
  async function fetchReviewPage(isBrand, merchantNo, productNo, page, pageSize) {
    const prefix = isBrand ? 'https://brand.naver.com/n' : 'https://smartstore.naver.com/i';
    const apiUrl = `${prefix}/v1/contents/reviews/query-pages`;

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        checkoutMerchantNo: merchantNo,
        originProductNo: productNo,
        page,
        pageSize,
        reviewSearchSortType: 'REVIEW_RANKING'
      })
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  // 리뷰 수집 메인 (info는 __PRELOADED_STATE__에서 가져온 상품 정보)
  async function collectReviewsWithInfo(info, maxReviews) {
    const sendProgress = (text, pct) => {
      iframe.contentWindow.postMessage({ type: 'DDALKKAK_REVIEW_PROGRESS', percent: pct, text }, '*');
    };
    const sendError = (error) => {
      iframe.contentWindow.postMessage({ type: 'DDALKKAK_REVIEW_RESULT', success: false, error }, '*');
    };

    const pageSize = 30;
    let allReviews = [];

    sendProgress('리뷰 수집 중', 5);

    try {
      const first = await fetchReviewPage(info.isBrand, info.merchantNo, info.productNo, 1, pageSize);
      const totalPages = first.totalPages || 1;

      for (const r of first.contents || []) {
        allReviews.push({ score: r.reviewScore, text: (r.reviewContent || '').trim() });
      }

      const maxPages = Math.min(totalPages, Math.ceil((maxReviews * 2) / pageSize) + 2);

      for (let page = 2; page <= maxPages; page++) {
        await new Promise(r => setTimeout(r, 300));

        try {
          const data = await fetchReviewPage(info.isBrand, info.merchantNo, info.productNo, page, pageSize);
          if (!data.contents || data.contents.length === 0) break;

          for (const r of data.contents) {
            allReviews.push({ score: r.reviewScore, text: (r.reviewContent || '').trim() });
          }
        } catch { break; }

        sendProgress(`리뷰 수집 중 (${allReviews.length}개)`, 5 + (page / maxPages) * 60);
      }
    } catch (err) {
      sendError(`리뷰 수집 실패: ${err.message}`);
      return;
    }

    const positiveReviews = allReviews
      .filter(r => r.score === 5 && r.text.length > 5)
      .map(r => r.text)
      .slice(0, maxReviews);

    const negativeReviews = allReviews
      .filter(r => r.score <= 2 && r.text.length > 5)
      .map(r => r.text)
      .slice(0, maxReviews);

    sendProgress('AI 분석 요청 중', 70);

    iframe.contentWindow.postMessage({
      type: 'DDALKKAK_REVIEW_RESULT',
      success: true,
      positiveReviews,
      negativeReviews,
      productName: info.productName
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
