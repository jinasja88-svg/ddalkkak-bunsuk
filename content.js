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
  // (기존 SMART DATA 확장프로그램 방식 그대로 적용)

  // 상품 정보 가져오기 (페이지 컨텍스트에서 API 호출)
  async function fetchPageInfo(url) {
    const host = window.location.hostname;
    const isBrand = host.includes('brand.naver.com');
    const storeName = url.split('.com/')[1]?.split('/')[0] || '';

    try {
      let merchantNo, channelUid, productNo;

      if (isBrand) {
        // brand.naver.com
        const resp = await fetch(`https://brand.naver.com/n/v1/channels?brandUrl=${storeName}`, {
          headers: { 'accept': 'application/json, text/plain, */*', 'x-client-version': '20250625150301' },
          credentials: 'include'
        });
        const data = await resp.json();
        merchantNo = data.payReferenceKey;
        channelUid = data.channelUid;
      } else {
        // smartstore.naver.com
        const resp = await fetch(`https://smartstore.naver.com/i/v1/smart-stores?url=${storeName}`, {
          headers: { 'accept': 'application/json, text/plain, */*', 'x-client-version': '20240729102925' },
          credentials: 'include'
        });
        const data = await resp.json();
        merchantNo = data.channel.payReferenceKey;
        channelUid = data.channel.channelUid;
      }

      // URL에서 productNo 추출
      const productMatch = url.match(/products\/(\d+)/);
      productNo = productMatch ? productMatch[1] : '';

      // 상품 상세 정보 (이름 등)
      const prefix = isBrand ? 'https://brand.naver.com/n' : 'https://smartstore.naver.com/i';
      const detailResp = await fetch(`${prefix}/v2/channels/${channelUid}/products/${productNo}?withWindow=false`, {
        headers: { 'accept': 'application/json, text/plain, */*', 'x-client-version': '20250625150301' },
        credentials: 'include'
      });
      const detail = await detailResp.json();

      return {
        supported: true,
        platform: isBrand ? '네이버 브랜드스토어' : '네이버 스마트스토어',
        merchantNo: String(merchantNo),
        productNo: String(detail.productNo || productNo),
        channelUid: String(channelUid),
        productName: detail.name || document.title.replace(/ : .*$/, '').trim(),
        isBrand
      };
    } catch (err) {
      return { supported: false, error: err.message };
    }
  }

  function detectReviewPage() {
    const host = window.location.hostname;
    if (host.includes('smartstore.naver.com') || host.includes('brand.naver.com')) {
      const productMatch = window.location.href.match(/products\/(\d+)/);
      if (productMatch) {
        return {
          supported: true,
          platform: host.includes('brand') ? '네이버 브랜드스토어' : '네이버 스마트스토어',
          productName: document.title.replace(/ : .*$/, '').trim(),
        };
      }
    }
    return { supported: false };
  }

  // 리뷰 API 호출 (기존 프로그램과 동일한 POST 방식)
  async function fetchReviewPage(apiBase, merchantNo, productNo, page, pageSize) {
    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-client-version': '20240729102925',
      },
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

  // 리뷰 수집 메인
  async function collectReviews(maxReviews) {
    const sendProgress = (text, pct) => {
      iframe.contentWindow.postMessage({ type: 'DDALKKAK_REVIEW_PROGRESS', percent: pct, text }, '*');
    };
    const sendError = (error) => {
      iframe.contentWindow.postMessage({ type: 'DDALKKAK_REVIEW_RESULT', success: false, error }, '*');
    };

    sendProgress('상품 정보 확인 중', 2);

    // 1단계: 상품 정보 가져오기
    const info = await fetchPageInfo(window.location.href);
    if (!info.supported) {
      sendError(info.error || '상품 정보를 찾을 수 없습니다.');
      return;
    }

    // API 베이스 URL
    const prefix = info.isBrand ? 'https://brand.naver.com/n' : 'https://smartstore.naver.com/i';
    const apiBase = `${prefix}/v1/contents/reviews/query-pages`;
    const pageSize = 30;

    sendProgress('리뷰 수집 중', 5);

    // 2단계: 전체 리뷰 수집 (별점 포함)
    let allReviews = [];
    let page = 1;
    let totalPages = 1;

    try {
      // 첫 페이지로 총 페이지 수 확인
      const first = await fetchReviewPage(apiBase, info.merchantNo, info.productNo, 1, pageSize);
      totalPages = first.totalPages || 1;

      for (const r of first.contents || []) {
        allReviews.push({ score: r.reviewScore, text: (r.reviewContent || '').trim() });
      }

      // 나머지 페이지 수집 (최대한 수집하되 50개씩이면 충분)
      const maxPages = Math.min(totalPages, Math.ceil((maxReviews * 2) / pageSize) + 2);

      for (page = 2; page <= maxPages; page++) {
        await new Promise(r => setTimeout(r, 300)); // 딜레이

        try {
          const data = await fetchReviewPage(apiBase, info.merchantNo, info.productNo, page, pageSize);
          if (!data.contents || data.contents.length === 0) break;

          for (const r of data.contents) {
            allReviews.push({ score: r.reviewScore, text: (r.reviewContent || '').trim() });
          }
        } catch { break; }

        const pct = 5 + (page / maxPages) * 60;
        sendProgress(`리뷰 수집 중 (${allReviews.length}개)`, pct);
      }
    } catch (err) {
      sendError(`리뷰 API 호출 실패: ${err.message}`);
      return;
    }

    // 3단계: 별점별 분류
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
