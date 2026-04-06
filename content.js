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

    // 페이지 정보 요청 (쿠팡/네이버 감지)
    if (event.data.type === 'DDALKKAK_GET_PAGE_INFO') {
      const url = window.location.href;
      const host = window.location.hostname;
      const isCoupang = url.includes('coupang.com/vp/products/');
      const isNaver = host.includes('smartstore.naver.com') || host.includes('brand.naver.com');
      let productId = null;
      if (isCoupang) {
        const match = url.match(/\/products\/(\d+)/);
        productId = match ? match[1] : null;
      }
      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_PAGE_INFO_RESULT',
        isCoupang,
        isNaver,
        isBrand: host.includes('brand.naver.com'),
        productId
      }, '*');
    }

    // 네이버 구매/재구매 조회 요청
    if (event.data.type === 'DDALKKAK_NAVER_PURCHASE') {
      chrome.runtime.sendMessage({
        action: 'NAVER_PURCHASE_INFO',
        productNo: event.data.productNo,
        isBrand: event.data.isBrand,
        basisPurchased: event.data.basisPurchased,
        basisRepurchased: event.data.basisRepurchased
      }, (response) => {
        iframe.contentWindow.postMessage({
          type: 'DDALKKAK_NAVER_PURCHASE_RESULT',
          success: response?.success,
          purchase: response?.purchase,
          repurchase: response?.repurchase
        }, '*');
      });
    }

    // 쿠팡윙 로그인 요청
    if (event.data.type === 'DDALKKAK_WING_LOGIN') {
      chrome.runtime.sendMessage({
        action: 'WING_LOGIN',
        productId: event.data.productId
      });
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
          let platformName = '쿠팡';
          if (response.data.platform === 'naver') {
            platformName = response.data.isBrand ? '네이버 브랜드스토어' : '네이버 스마트스토어';
          }
          iframe.contentWindow.postMessage({
            type: 'DDALKKAK_REVIEW_PAGE_INFO',
            data: {
              supported: true,
              platform: platformName,
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

  // ===== 쿠팡 리뷰 수집 =====

  async function fetchCoupangReviewPage(productId, itemId, vendorItemId, rating, page, pageSize) {
    const url = `https://www.coupang.com/vp/product/reviews?productId=${productId}&page=${page}&size=${pageSize}&sortBy=ORDER_SCORE_ASC&ratings=${rating}&itemId=${itemId}&vendorItemId=${vendorItemId}&q=&viRoleCode=3&ratingSummary=true`;

    const resp = await fetch(url, {
      headers: {
        'Accept': 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': window.location.href
      },
      credentials: 'include'
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  }

  function parseCoupangReviews(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const reviews = [];

    // 리뷰 본문 텍스트 추출
    const textEls = doc.querySelectorAll('.sdp-review__article__list__review__content .sdp-review__article__list__review__content__text');
    for (const el of textEls) {
      const text = el.textContent?.trim();
      if (text && text.length > 5) reviews.push(text);
    }

    // 폴백: 다른 셀렉터
    if (reviews.length === 0) {
      const articles = doc.querySelectorAll('.sdp-review__article__list__review');
      for (const el of articles) {
        const contentEl = el.querySelector('[class*="content__text"]') || el.querySelector('[class*="__content"]');
        const text = contentEl?.textContent?.trim();
        if (text && text.length > 5) reviews.push(text);
      }
    }

    return reviews;
  }

  async function collectCoupangByRating(info, rating, maxCount, onProgress) {
    const reviews = [];
    const pageSize = 20;

    for (let page = 1; reviews.length < maxCount; page++) {
      try {
        if (page > 1) await new Promise(r => setTimeout(r, 500));
        const html = await fetchCoupangReviewPage(info.productId, info.itemId, info.vendorItemId, rating, page, pageSize);
        const pageReviews = parseCoupangReviews(html);

        if (pageReviews.length === 0) break;

        for (const r of pageReviews) {
          reviews.push(r);
          if (reviews.length >= maxCount) break;
        }

        if (onProgress) onProgress(reviews.length, maxCount);
        if (pageReviews.length < pageSize) break;
      } catch { break; }
    }

    return reviews;
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

  // 리뷰 API 호출 (POST 방식, reviewScore로 별점 필터링)
  async function fetchReviewsByScore(isBrand, merchantNo, productNo, reviewScore, page, pageSize) {
    const prefix = isBrand ? 'https://brand.naver.com/n' : 'https://smartstore.naver.com/i';
    const apiUrl = `${prefix}/v1/contents/reviews/query-pages`;

    const body = {
      checkoutMerchantNo: merchantNo,
      originProductNo: productNo,
      page,
      pageSize,
      reviewSearchSortType: 'REVIEW_RANKING',
      reviewScore
    };

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  // 특정 별점의 리뷰를 maxCount개까지 수집
  async function collectByScore(info, score, maxCount, onProgress) {
    const reviews = [];
    const pageSize = 30;
    let page = 1;

    try {
      const first = await fetchReviewsByScore(info.isBrand, info.merchantNo, info.productNo, score, 1, pageSize);
      const totalPages = first.totalPages || 1;
      const totalElements = first.totalElements || 0;

      for (const r of first.contents || []) {
        if (r.reviewContent?.trim().length > 5) reviews.push(r.reviewContent.trim());
        if (reviews.length >= maxCount) break;
      }

      const maxPages = Math.min(totalPages, Math.ceil(maxCount / pageSize) + 1);

      for (page = 2; page <= maxPages && reviews.length < maxCount; page++) {
        await new Promise(r => setTimeout(r, 300));
        try {
          const data = await fetchReviewsByScore(info.isBrand, info.merchantNo, info.productNo, score, page, pageSize);
          if (!data.contents || data.contents.length === 0) break;
          for (const r of data.contents) {
            if (r.reviewContent?.trim().length > 5) reviews.push(r.reviewContent.trim());
            if (reviews.length >= maxCount) break;
          }
        } catch { break; }
        if (onProgress) onProgress(reviews.length, Math.min(totalElements, maxCount));
      }
    } catch (err) {
      // 해당 별점 리뷰가 없을 수 있음
    }

    return reviews;
  }

  // 리뷰 수집 메인
  async function collectReviewsWithInfo(info, maxReviews) {
    const sendProgress = (text, pct) => {
      iframe.contentWindow.postMessage({ type: 'DDALKKAK_REVIEW_PROGRESS', percent: pct, text }, '*');
    };
    const sendError = (error) => {
      iframe.contentWindow.postMessage({ type: 'DDALKKAK_REVIEW_RESULT', success: false, error }, '*');
    };

    try {
      const isCoupang = info.platform === 'coupang';
      const collectFn = isCoupang ? collectCoupangByRating : collectByScore;

      // 1점 리뷰 수집
      sendProgress('1점 리뷰 수집 중', 5);
      const reviews1 = await collectFn(info, 1, maxReviews,
        (got, total) => sendProgress(`1점 리뷰 수집 중 (${got}개)`, 5 + (got / maxReviews) * 10));

      // 2점 리뷰 수집
      sendProgress('2점 리뷰 수집 중', 20);
      const reviews2 = await collectFn(info, 2, maxReviews - reviews1.length,
        (got, total) => sendProgress(`2점 리뷰 수집 중 (${got}개)`, 20 + (got / maxReviews) * 10));

      // 5점 리뷰 수집
      sendProgress('5점 리뷰 수집 중', 40);
      const reviews5 = await collectFn(info, 5, maxReviews,
        (got, total) => sendProgress(`5점 리뷰 수집 중 (${got}개)`, 40 + (got / maxReviews) * 25));

      const negativeReviews = [...reviews1, ...reviews2].slice(0, maxReviews);
      const positiveReviews = reviews5.slice(0, maxReviews);

      sendProgress('AI 분석 요청 중', 70);

      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_REVIEW_RESULT',
        success: true,
        positiveReviews,
        negativeReviews,
        productName: info.productName
      }, '*');

    } catch (err) {
      sendError(`리뷰 수집 실패: ${err.message}`);
    }
  }

  // ===== 쿠팡윙 조회수 결과 수신 (background → content → panel) =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DDALKKAK_WING_RESULT') {
      iframe.contentWindow.postMessage({
        type: 'DDALKKAK_WING_RESULT',
        success: message.success,
        data: message.data
      }, '*');
    }
  });

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
