// 딸깍분석 - 쿠팡윙 조회수 API 호출
// wing.coupang.com에서 실행되는 콘텐츠 스크립트

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'wingInfo') {
    const keyword = request.keyword;
    fetch('https://wing.coupang.com/tenants/seller-web/post-matching/search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ keyword, excludedProductIds: [], searchPage: 0, searchOrder: 'DEFAULT' })
    })
      .then(r => { if (!r.ok) throw new Error('Network error'); return r.json(); })
      .then(data => {
        for (const item of data.result || []) {
          if (String(item.productId) === String(keyword)) {
            sendResponse({
              success: true,
              data: { viewCount: item.pvLast28Day, brandName: item.brandName, manufacture: item.manufacture }
            });
            return;
          }
        }
        sendResponse({ success: false, data: { viewCount: null } });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message, data: { viewCount: null } });
      });
    return true;
  }

  // ===== Wing 카테고리별 상품 크롤 (유저 세션 사용) =====
  if (request.type === 'wingCategoryCrawl') {
    (async () => {
      const { categoryCode, categoryPath } = request;
      console.log('[coupWing] wingCategoryCrawl 수신 — code:', categoryCode, 'path:', categoryPath);
      const items = [];
      let start = 0;
      try {
        const xm = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
        const headers = {
          'content-type': 'application/json',
          'accept': 'application/json',
          'x-cp-pt-locale': 'ko'
        };
        if (xm) headers['x-xsrf-token'] = decodeURIComponent(xm[1]);

        const buildBody = (s) => ({
          searchCondition: {
            start: s,
            limit: 100,
            query: '',
            sort: ['BEST_SELLING'],
            filter: {
              INTERNAL_CATEGORY: {
                generalFilterType: 'Filters',
                operator: 'AND',
                generalFilters: [{
                  generalFilterType: 'DefaultFilter',
                  field: 'INTERNAL_CATEGORY',
                  values: [String(categoryCode)],
                  operator: 'AND',
                  exclude: false
                }]
              }
            },
            context: {
              bundleId: 62, ip: '127.0.0.1', viewType: 'WEB',
              sourcePage: 'Srp', channel: 'unknown', userNo: 0,
              uuid: '', osType: 'PC', appVersion: '1.0.0'
            }
          }
        });

        while (true) {
          console.log('[coupWing] fetch start=', start);
          const r = await fetch('https://wing.coupang.com/tenants/rfm-ss/api/trends/search', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(buildBody(start))
          });
          console.log('[coupWing] response status:', r.status);

          if (r.status === 401 || r.status === 403) {
            sendResponse({ success: false, limitHit: false, authFail: true, status: r.status, items });
            return;
          }
          if (r.status === 429) {
            sendResponse({ success: false, limitHit: true, reason: 'rate_limit_429', status: r.status, items });
            return;
          }
          if (!r.ok) {
            sendResponse({ success: false, error: `HTTP ${r.status}`, status: r.status, items });
            return;
          }

          let data;
          try { data = await r.json(); }
          catch (e) {
            console.warn('[coupWing] invalid JSON:', e.message);
            sendResponse({ success: false, error: 'invalid JSON (Wing이 HTML 반환 — 로그인 끊김 가능성)', items });
            return;
          }

          const got = data.searchItems || [];
          const total = data.totalCount || 0;

          // 페이지네이션 끊김 = 일일 제한 (서버 wing_crawl_worker L442와 동일)
          if (got.length === 0 && start > 0 && start < total) {
            sendResponse({ success: false, limitHit: true, reason: 'pagination_cut', items, total });
            return;
          }

          for (const it of got) items.push(it);
          start += got.length;

          // progress 브로드캐스트 (background → honey_bridge → page)
          try {
            chrome.runtime.sendMessage({
              action: 'DDALKKAK_WING_CAT_PROGRESS',
              count: items.length,
              total: total,
              categoryPath: categoryPath
            });
          } catch {}

          if (got.length === 0 || start >= total) break;
          await new Promise(res => setTimeout(res, 300));
        }

        console.log('[coupWing] 완료 — 총 items:', items.length);
        sendResponse({ success: true, items, count: items.length });
      } catch (e) {
        console.error('[coupWing] 예외:', e);
        sendResponse({ success: false, error: e.message || String(e), items });
      }
    })();
    return true; // async response
  }
});
