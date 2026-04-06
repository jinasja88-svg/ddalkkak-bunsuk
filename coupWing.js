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
});
