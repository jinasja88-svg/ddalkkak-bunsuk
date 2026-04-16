// 딸깍분석 - Background Service Worker
// 아이콘 클릭 처리 + 검색어 AI 생성 + 네이버/구글 검색 + 페이지 fetch + Gemini API

// ===== 아이콘 클릭 → content script 주입 (사이드패널 열기) =====
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.url?.startsWith('chrome://')) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    console.error('Content script injection failed:', err);
  }
});

// ===== 리뷰 페이지 감지 (chrome.scripting으로 __PRELOADED_STATE__ 읽기) =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'DETECT_REVIEW_PAGE') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) { sendResponse({ success: false }); return; }

        const url = new URL(tab.url);
        const host = url.hostname;

        // ===== 네이버 스마트스토어/브랜드스토어 =====
        if (host.includes('smartstore.naver.com') || host.includes('brand.naver.com')) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
              try {
                const ps = window.__PRELOADED_STATE__;
                if (!ps) return null;
                const s = JSON.stringify(ps);
                const m1 = s.match(/"payReferenceKey"\s*:\s*"?(\d+)"?/);
                const m2 = s.match(/"productNo"\s*:\s*"?(\d+)"?/);
                let name = '';
                try { name = ps.product?.A?.name || ps.productSimpleView?.A?.name || ''; } catch{}
                return {
                  merchantNo: m1?.[1] || '',
                  productNo: m2?.[1] || '',
                  productName: name || document.title.replace(/ : .*$/, '').trim()
                };
              } catch { return null; }
            }
          });

          const data = results?.[0]?.result;
          if (data && data.merchantNo && data.productNo) {
            data.platform = 'naver';
            data.isBrand = host.includes('brand.naver.com');
            sendResponse({ success: true, data });
          } else {
            sendResponse({ success: false });
          }
          return;
        }

        // ===== 쿠팡 =====
        if (host.includes('coupang.com')) {
          const productMatch = url.pathname.match(/\/products\/(\d+)/);
          if (!productMatch) { sendResponse({ success: false }); return; }

          const productId = productMatch[1];
          const itemId = url.searchParams.get('itemId') || '';
          const vendorItemId = url.searchParams.get('vendorItemId') || '';

          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const og = document.querySelector('meta[property="og:title"]');
              return og?.content || document.title.replace(/\s*\|.*$/, '').trim();
            }
          });

          const productName = results?.[0]?.result || '';
          sendResponse({
            success: true,
            data: { platform: 'coupang', productName, productId, itemId, vendorItemId }
          });
          return;
        }

        sendResponse({ success: false });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// ===== 쿠팡윙 조회수 (28일) =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'WING_LOGIN') {
    const productId = request.productId;
    const originalTabId = sender.tab.id;

    chrome.tabs.create({ url: 'https://wing.coupang.com/', active: true }, (newTab) => {
      const wingTabId = newTab.id;
      const wingPattern = /^https:\/\/wing\.coupang\.com\/.*$/;

      const listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== wingTabId || changeInfo.status !== 'complete' || !wingPattern.test(tab.url)) return;

        chrome.tabs.sendMessage(wingTabId, { type: 'wingInfo', keyword: productId }, (response) => {
          if (chrome.runtime.lastError || !response) return;

          chrome.tabs.sendMessage(originalTabId, {
            type: 'DDALKKAK_WING_RESULT',
            success: response.success,
            data: response.data
          });

          chrome.tabs.remove(wingTabId, () => {
            chrome.tabs.update(originalTabId, { active: true });
          });
          chrome.tabs.onUpdated.removeListener(listener);
        });
      };

      chrome.tabs.onUpdated.addListener(listener);

      // 2분 타임아웃
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
      }, 120000);
    });

    sendResponse({ success: true });
    return true;
  }
});

// ===== 네이버 구매/재구매 수 조회 =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'NAVER_PURCHASE_INFO') {
    (async () => {
      try {
        const { productNo, isBrand, basisPurchased, basisRepurchased } = request;
        const prefix = isBrand ? 'https://brand.naver.com/n' : 'https://smartstore.naver.com/i';
        const baseUrl = `${prefix}/v1/marketing-message/${productNo}`;

        // 구매 수 조회
        const purchaseParams = new URLSearchParams({
          currentPurchaseType: 'Paid',
          usePurchased: 'true',
          basisPurchased: basisPurchased || 10,
          usePurchasedIn2Y: 'true',
          useRepurchased: 'true',
          basisRepurchased: basisRepurchased || 10
        });

        const resp = await fetch(`${baseUrl}?${purchaseParams}`, {
          headers: { 'accept': 'application/json, text/plain, */*' }
        });

        if (!resp.ok) { sendResponse({ success: false }); return; }
        const data = await resp.json();

        // 재구매 수 조회
        const repurchaseParams = new URLSearchParams({
          currentPurchaseType: 'Repaid',
          usePurchased: 'true',
          basisPurchased: basisPurchased || 10,
          usePurchasedIn2Y: 'true',
          useRepurchased: 'true',
          basisRepurchased: basisRepurchased || 10
        });

        const resp2 = await fetch(`${baseUrl}?${repurchaseParams}`, {
          headers: { 'accept': 'application/json, text/plain, */*' }
        });

        let repurchaseData = null;
        if (resp2.ok) repurchaseData = await resp2.json();

        sendResponse({ success: true, purchase: data, repurchase: repurchaseData });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// ===== Gemini API 호출 공통 =====
async function callGeminiRaw(apiKey, model, prompt, maxTokens = 256) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens }
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `API ${resp.status}`);
  let text = '';
  for (const c of data.candidates || []) {
    for (const p of c.content?.parts || []) text += p.text || '';
  }
  return { text, usage: data.usageMetadata || {} };
}

// ===== AI 검색어 생성 (Merlin의 SEARCH_DECISION과 동일) =====
async function generateSearchQuery(apiKey, model, pageTitle, userMessage) {
  const prompt = `당신은 검색어 최적화 전문가입니다.
사용자가 아래 제품 페이지를 보고 있습니다. 이 제품에 대한 리뷰, 장단점, 스펙 정보를 찾기 위한 최적의 검색어를 만들어주세요.

페이지 제목: ${pageTitle}
사용자 요청: ${userMessage}

규칙:
- 제품명/브랜드명 핵심 키워드만 추출 (최대 5단어)
- 쇼핑몰 이름, 부가 설명은 제거
- 리뷰/후기/장단점 같은 검색 보조어는 붙이지 마세요 (나중에 붙입니다)
- 검색어만 출력하세요. 다른 설명 없이.

예시:
- 입력: "[공식] 앙쥬나나 바이젤디 크림 문제성피부 고보습 얼굴 신생아 아기 유아 기저귀 : 닥터흄"
- 출력: 앙쥬나나 바이젤디 크림

- 입력: "인사이디 무선 전동 미니 마사지건 IMG-300 - 안마기 | 쿠팡"
- 출력: 인사이디 마사지건 IMG-300

검색어:`;

  try {
    // 빠른 모델로 검색어만 생성 (토큰 절약)
    const result = await callGeminiRaw(apiKey, 'gemini-2.0-flash-lite', prompt, 50);
    return result.text.trim().replace(/["""]/g, '').substring(0, 60);
  } catch {
    // 실패시 제목에서 간단히 추출
    return pageTitle.replace(/[-|:].*/g, '').trim().substring(0, 40);
  }
}

// ===== 네이버 검색 =====
function parseNaverResults(html) {
  const results = [];
  const seen = new Set();
  const hrefPattern = /href="(https?:\/\/[^"]+)"/g;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const url = match[1];
    if (url.includes('naver.com') || url.includes('naver.net') ||
        url.includes('pstatic.net') || url.includes('gmarket.co.kr/index') ||
        url.includes('banner.auction') || url.includes('ad.search') ||
        url.includes('adcr.naver')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ url, title: '', snippet: '', body: '' });
    if (results.length >= 5) break;
  }

  // 제목 매칭
  const titlePattern = /href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gs;
  while ((match = titlePattern.exec(html)) !== null) {
    const url = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    if (title.length > 5) {
      const found = results.find(r => r.url === url);
      if (found && !found.title) found.title = title.substring(0, 150);
    }
  }
  return results;
}

async function naverSearch(query) {
  try {
    const resp = await fetch(
      `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`,
      { headers: { 'Accept': 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9' } }
    );
    if (!resp.ok) return [];
    return parseNaverResults(await resp.text());
  } catch { return []; }
}

// ===== 구글 검색 (폴백: 구글이 JS렌더링 요구하면 빈 결과) =====
function parseGoogleResults(html) {
  const results = [];
  const seen = new Set();

  // 구글은 JS렌더링 없이도 /url?q= 패턴이 있을 수 있음
  const urlPattern = /\/url\?q=(https?[^&"]+)/g;
  let match;
  while ((match = urlPattern.exec(html)) !== null) {
    const url = decodeURIComponent(match[1]);
    if (!url.includes('google.com') && !url.includes('accounts.google') && !seen.has(url)) {
      seen.add(url);
      results.push({ url, title: '', snippet: '', body: '' });
    }
    if (results.length >= 5) break;
  }

  // 제목 매칭
  const h3Pattern = /<h3[^>]*>(.*?)<\/h3>/gs;
  const titles = [];
  while ((match = h3Pattern.exec(html)) !== null) {
    titles.push(match[1].replace(/<[^>]*>/g, '').trim());
  }
  for (let i = 0; i < Math.min(results.length, titles.length); i++) {
    results[i].title = titles[i];
  }

  return results;
}

async function googleSearch(query) {
  try {
    const resp = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ko&num=10&gl=kr`,
      { headers: { 'Accept': 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9' } }
    );
    if (!resp.ok) return [];
    return parseGoogleResults(await resp.text());
  } catch { return []; }
}

// ===== HTML → 텍스트 =====
function htmlToText(html) {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, ' [$1] ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ');
  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  return [...new Set(lines)].join('\n').substring(0, 3000);
}

// ===== 페이지 fetch =====
async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9' }
    });
    clearTimeout(timer);
    if (!resp.ok) return '';
    return htmlToText(await resp.text());
  } catch { return ''; }
}

// ===== 메시지 처리 =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // AI 검색어 생성
  if (request.action === 'GENERATE_SEARCH_QUERY') {
    generateSearchQuery(request.apiKey, request.model, request.pageTitle, request.userMessage)
      .then(query => sendResponse({ success: true, query }))
      .catch(err => sendResponse({ success: false, query: request.pageTitle.substring(0, 40), error: err.message }));
    return true;
  }

  // 검색 (네이버 + 구글 병렬)
  if (request.action === 'SEARCH_AND_FETCH') {
    (async () => {
      try {
        const query = request.query;
        const searchQuery = query + ' 리뷰 후기 장단점';

        // 네이버 + 구글 동시 검색
        const [naverResults, googleResults] = await Promise.all([
          naverSearch(searchQuery),
          googleSearch(searchQuery)
        ]);

        // 합치기 (네이버 우선, 중복 제거)
        const seen = new Set();
        const allResults = [];

        for (const r of [...naverResults, ...googleResults]) {
          if (!seen.has(r.url)) {
            seen.add(r.url);
            allResults.push(r);
          }
          if (allResults.length >= 7) break;
        }

        let debug = `네이버: ${naverResults.length}개 / 구글: ${googleResults.length}개 / 합계: ${allResults.length}개`;

        // 상위 5개 페이지 본문 수집
        if (request.fetchPages && allResults.length > 0) {
          const fetches = allResults.slice(0, 5).map(async (r) => {
            r.body = await fetchPage(r.url);
            return r;
          });
          await Promise.all(fetches);
          const fetched = allResults.filter(r => r.body && r.body.length > 50).length;
          debug += ` | 본문: ${fetched}개 수집`;
        }

        sendResponse({ success: true, results: allResults, debug });
      } catch (err) {
        sendResponse({ success: false, results: [], debug: `오류: ${err.message}` });
      }
    })();
    return true;
  }

  // Gemini API 호출 (분석용)
  if (request.action === 'CALL_GEMINI') {
    (async () => {
      try {
        const result = await callGeminiRaw(request.apiKey, request.model, request.prompt, 8192);
        const usage = result.usage;
        sendResponse({
          success: true,
          text: result.text,
          usage: {
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: usage.candidatesTokenCount || 0,
            totalTokens: usage.totalTokenCount || 0
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// ===== 프록시 설정 (Decodo/SmartProxy 한국 주거 IP) =====
const PROXY_CONFIG = {
  enabled: false,  // Decodo 프록시 쿠팡에 차단됨 → 비활성화 (유저 본인 IP 사용)
  host: 'gate.decodo.com',
  port: 10001,
  username: 'user-sp1tu2xjif-country-kr',
  password: '9uIl0crr7e~GXGao0a'
};

// 요청마다 다른 IP 받기 위한 랜덤 세션
function randSessionId(){
  return Math.random().toString(36).slice(2,12);
}

function setupProxyForCoupang() {
  if (!PROXY_CONFIG.enabled) return;
  // PAC 스크립트: 쿠팡 도메인만 프록시 경유
  const pacScript = `
    function FindProxyForURL(url, host) {
      if (host.indexOf('coupang.com') !== -1) {
        return 'PROXY ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}';
      }
      return 'DIRECT';
    }
  `;
  chrome.proxy.settings.set({
    value: {
      mode: 'pac_script',
      pacScript: { data: pacScript }
    },
    scope: 'regular'
  }, () => {
    console.log('[PROXY] 프록시 설정 완료 - 쿠팡 요청만 프록시 경유');
  });
}

// 프록시 인증 처리 (매 요청마다 새 session ID 사용 → 다른 IP)
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (details.isProxy) {
      const sessionId = randSessionId();
      return {
        authCredentials: {
          username: `${PROXY_CONFIG.username}-session-${sessionId}`,
          password: PROXY_CONFIG.password
        }
      };
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);

// 프록시 비활성화 시 기존 설정 제거
if (PROXY_CONFIG.enabled) {
  setupProxyForCoupang();
} else {
  try {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      console.log('[PROXY] 프록시 비활성화 - 직접 연결');
    });
  } catch {}
}

// ===== 딸깍쇼핑 honey-list 페이지용 크롤링 =====
// 외부 웹페이지에서 postMessage로 호출 → 쿠팡 상품 URL 크롤링 → 결과 반환

function parseCoupangPrice(html) {
  // 스크립트/스타일 제거
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // 1. 쿠폰 적용 후 최종 가격 (prod-coupon-download-price)
  let m = clean.match(/class="[^"]*prod-coupon-download-price[^"]*"[^>]*>[\s\S]*?([\d,]+)\s*원/);
  if (m) return parseInt(m[1].replace(/,/g, ''));

  // 2. 세일 가격 (sale-price 클래스)
  m = clean.match(/class="[^"]*sale-price[^"]*"[^>]*>[\s\S]*?<strong[^>]*>([\d,]+)<\/strong>/);
  if (m) return parseInt(m[1].replace(/,/g, ''));

  // 3. total-price (대부분의 경우 할인 후 가격)
  m = clean.match(/class="[^"]*total-price[^"]*"[^>]*>[\s\S]*?<strong[^>]*>([\d,]+)<\/strong>/);
  if (m) return parseInt(m[1].replace(/,/g, ''));

  // 4. price-value - 여러 개면 두번째가 할인가인 경우가 많음
  const allPrices = [...clean.matchAll(/class="[^"]*price-value[^"]*"[^>]*>\s*([\d,]+)\s*<\/span>/g)];
  if (allPrices.length >= 2) {
    // 두번째가 할인가 (첫번째는 원가)
    return parseInt(allPrices[1][1].replace(/,/g, ''));
  }
  if (allPrices.length === 1) return parseInt(allPrices[0][1].replace(/,/g, ''));

  // 5. JSON salesPrice
  m = clean.match(/"salesPrice"\s*:\s*\{?\s*"?amount"?\s*:?\s*"?([\d]+)"?/);
  if (m) return parseInt(m[1]);

  // 6. 마지막 수단: "X원" 중 제일 작은 숫자 (할인가 가능성)
  const anyPrices = [...clean.matchAll(/>([\d,]{3,})\s*원</g)].map(x => parseInt(x[1].replace(/,/g, ''))).filter(n => n > 100 && n < 100000000);
  if (anyPrices.length >= 2) return Math.min(...anyPrices);
  if (anyPrices.length === 1) return anyPrices[0];

  return 0;
}

function parseCoupangPurchase(html) {
  // 1. HTML 태그 사이 숫자 처리: <b>500</b>명 이상
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  // 태그 제거한 텍스트로 매칭
  const text = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/([\d,]+)\s*명\s*이상.{0,30}?구매했어요/);
  if (m) return parseInt(m[1].replace(/,/g, ''));
  return null; // 해당 정보 없음
}

// 탭에서 DOM 직접 파싱하는 함수 (문자열로 주입됨)
function extractCoupangData() {
  // 항상 기본값 설정 (에러 발생해도 필드 누락 방지)
  const result = {
    url: '',
    title: '',
    bodyLen: 0,
    price: 0,
    purchase: undefined,
    blocked: false,
    _timestamp: Date.now()
  };
  try {
    result.url = location.href || '';
    result.title = document.title || '';
    try { result.bodyLen = (document.body && document.body.innerText) ? document.body.innerText.length : 0; } catch { result.bodyLen = 0; }
    result.readyState = document.readyState;

    // 차단 체크
    if (document.title && document.title.includes('Access Denied')) {
      result.blocked = true;
      return result;
    }

    // 0. final-price-amount (데스크톱)
    let el = document.querySelector('[class*="final-price-amount"]');
    if (el) {
      const n = parseInt(el.textContent.replace(/[^\d]/g, ''));
      if (n > 0) result.price = n;
    }
    // 0-1. 모바일: prod-sale-price, price-amount
    if (!result.price) {
      el = document.querySelector('.prod-sale-price') ||
           document.querySelector('[class*="salePrice"]') ||
           document.querySelector('[class*="SalePrice"]');
      if (el) {
        const n = parseInt(el.textContent.replace(/[^\d]/g, ''));
        if (n > 0) result.price = n;
      }
    }
    // 1. total-price strong
    if (!result.price) {
      el = document.querySelector('.total-price strong') ||
           document.querySelector('[class*="sale-price"] strong');
      if (el) {
        const n = parseInt(el.textContent.replace(/[^\d]/g, ''));
        if (n > 0) result.price = n;
      }
    }
    // 2. price-amount (not original)
    if (!result.price) {
      const priceEls = document.querySelectorAll('.price-amount, [class*="price-amount"]');
      const prices = [];
      priceEls.forEach(e => {
        const cls = e.className || '';
        if (cls.includes('original-price')) return; // 원가 제외
        const n = parseInt(e.textContent.replace(/[^\d]/g, ''));
        if (n > 100) prices.push(n);
      });
      if (prices.length) result.price = Math.min(...prices);
    }
    // 3. 원가 (비교용)
    const orig = document.querySelector('.original-price-amount, [class*="original-price"]');
    if (orig) {
      const n = parseInt(orig.textContent.replace(/[^\d]/g, ''));
      if (n > 0) result.originalPrice = n;
    }
    // 4. price-value (여러개면 두번째가 할인가)
    if (!result.price) {
      const pvEls = [...document.querySelectorAll('[class*="price-value"]')]
        .filter(e => /\d{3,}/.test(e.textContent));
      if (pvEls.length >= 2) {
        const n = parseInt(pvEls[1].textContent.replace(/[^\d]/g, ''));
        if (n > 0) result.price = n;
      } else if (pvEls.length === 1) {
        const n = parseInt(pvEls[0].textContent.replace(/[^\d]/g, ''));
        if (n > 0) result.price = n;
      }
    }
    // 5. strong 태그 중 가격처럼 보이는 것
    if (!result.price) {
      const strongs = [...document.querySelectorAll('strong')]
        .filter(e => /^\s*[\d,]{3,}\s*$/.test(e.textContent));
      const prices = strongs.map(e => parseInt(e.textContent.replace(/[^\d]/g, ''))).filter(n => n > 100 && n < 100000000);
      if (prices.length) result.price = Math.min(...prices);
    }
    // 6. 마지막 수단: 페이지 텍스트에서 "XX,XXX원"
    if (!result.price) {
      const text = document.body?.innerText || '';
      const prices = [...text.matchAll(/([\d,]{3,})\s*원/g)]
        .map(m => parseInt(m[1].replace(/,/g, '')))
        .filter(n => n > 100 && n < 100000000);
      if (prices.length) result.price = Math.min(...prices);
    }
  } catch(e) { result.priceError = e.message; }

  // 구매수
  try {
    const text = document.body.innerText;
    const m = text.match(/([\d,]+)\s*명\s*이상.{0,30}?구매했어요/);
    if (m) result.purchase = parseInt(m[1].replace(/,/g, ''));
  } catch(e) { result.purchaseError = e.message; }

  // 차단 확인
  if (document.title && document.title.includes('Access Denied')) {
    result.blocked = true;
  }

  return result;
}

// 숨겨진 크롤링용 윈도우 (최소화 상태로 유지)
let crawlWindowId = null;

async function getCrawlWindow() {
  // 기존 창이 살아있는지 확인
  if (crawlWindowId !== null) {
    try {
      await chrome.windows.get(crawlWindowId);
      return crawlWindowId;
    } catch {
      crawlWindowId = null;
    }
  }
  // 새 창 생성 (작은 크기 + 화면 밖 위치 → 렌더링은 되지만 안 보임)
  const win = await chrome.windows.create({
    url: 'about:blank',
    type: 'popup',
    focused: false,
    width: 500,
    height: 400,
    top: 0,
    left: 0
  });
  crawlWindowId = win.id;
  return crawlWindowId;
}

function toMobileUrl(url) {
  // www.coupang.com/vp/products → m.coupang.com/vm/products
  return url
    .replace('://www.coupang.com/vp/', '://m.coupang.com/vm/')
    .replace('://coupang.com/vp/', '://m.coupang.com/vm/');
}

async function crawlSingleUrlInWindow(url, mode) {
  return new Promise(async (resolve) => {
    let tab = null;
    let settled = false;
    const targetUrl = toMobileUrl(url);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
      if (tab) { try { chrome.tabs.remove(tab.id); } catch {} }
      resolve(result);
    };

    // 40초 전체 타임아웃: 끝나기 직전에 lastData 있으면 그걸로 판정
    let lastData = null;
    const timeoutId = setTimeout(() => {
      if (lastData && lastData.bodyLen > 1000) {
        decideResult(lastData);
      } else {
        finish({ url, ok: false, error: 'timeout', debug: lastData });
      }
    }, 40000);

    const decideResult = (data) => {
      console.log('[CRAWL]', url, 'mode:', mode, 'data:', data);
      if (!data) { finish({ url, ok: false, error: 'no data' }); return; }
      if (data.blocked) { finish({ url, ok: false, error: 'blocked (Access Denied)' }); return; }
      if (mode === 'price') {
        if (data.price > 0) finish({ url, ok: true, p: data.price, originalPrice: data.originalPrice });
        else if ((data.bodyLen || 0) < 1000) finish({ url, ok: false, error: '페이지 로드 실패/차단 (bodyLen: ' + data.bodyLen + ')', debug: data });
        else finish({ url, ok: false, error: '가격 요소 못 찾음 (페이지는 로드됨)', debug: data });
      } else if (mode === 'purchase') {
        if ((data.bodyLen || 0) > 1000 && !data.blocked) {
          // 구매수 + 가격 둘 다 반환 (가격은 있으면 포함, 없어도 ok)
          const result = { url, ok: true, bc: data.purchase ?? 0 };
          if (data.price > 0) result.p = data.price;
          finish(result);
        }
        else finish({ url, ok: false, error: '페이지 로드 실패 (bodyLen: ' + data.bodyLen + ')', debug: data });
      } else {
        finish({ url, ok: false, error: 'unknown mode' });
      }
    };

    const runExtractLoop = async () => {
      for (let attempt = 0; attempt < 30 && !settled; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        if (settled) return;
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractCoupangData,
            world: 'MAIN'
          });
          const r = results?.[0];
          if (!r || !r.result) continue;
          const d = r.result;
          lastData = d;
          if (d.blocked) { decideResult(d); return; }
          if (d.bodyLen > 3000 && d.title && !d.title.includes('loading')) {
            if (mode === 'price' && d.price > 0) { decideResult(d); return; }
            if (mode === 'purchase' && d.purchase !== undefined) { decideResult(d); return; }
            if (attempt >= 14) { decideResult(d); return; }  // 7초 넘게 기다려도 못찾으면 포기
          }
        } catch (e) {
          if (e.message && e.message.includes('No tab')) { finish({ url, ok: false, error: 'tab closed' }); return; }
          // frame 아직 준비 안 됨 — 계속 재시도
        }
      }
      // loop 끝남
      if (!settled) decideResult(lastData);
    };

    let loopStarted = false;
    const startLoop = () => {
      if (loopStarted || settled) return;
      loopStarted = true;
      runExtractLoop();
    };

    const listener = (tabId, info) => {
      if (!tab || tabId !== tab.id) return;
      // complete 못 와도 loading 상태에서 이미 DOM 접근 가능한 경우 있음
      if (info.status === 'complete' || info.status === 'loading') {
        startLoop();
      }
    };

    try {
      const winId = await getCrawlWindow();
      chrome.tabs.onUpdated.addListener(listener);
      tab = await chrome.tabs.create({ windowId: winId, url: targetUrl, active: false });
      // 리스너 등록/탭 생성 타이밍 race 대비: 2.5초 후 상태 무관하게 강제 시작
      setTimeout(() => {
        if (!loopStarted && !settled && tab) startLoop();
      }, 2500);
    } catch (e) {
      finish({ url, ok: false, error: e.message });
    }
  });
}

// 큐 + 프록시 사용 시 동시성 3개 (각각 다른 IP 할당되므로 차단 안 됨)
let crawlQueue = Promise.resolve();
const CONCURRENCY = PROXY_CONFIG.enabled ? 3 : 1;

async function crawlCoupangItems(urls, mode) {
  const task = async () => {
    const results = new Array(urls.length);
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(u => crawlSingleUrlInWindow(u, mode))
      );
      batchResults.forEach((r, j) => { results[i + j] = r; });
      if (i + CONCURRENCY < urls.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return results;
  };
  const p = crawlQueue.then(task);
  crawlQueue = p.catch(() => {});
  return p;
}

// 내부 메시지 (content script bridge용)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'DDALKKAK_PING') {
    sendResponse({ success: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (request.action === 'DDALKKAK_CRAWL_ITEMS') {
    (async () => {
      try {
        const results = await crawlCoupangItems(request.urls || [], request.mode || 'price');
        sendResponse({ success: true, results });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// 외부 웹페이지에서 직접 메시지 (externally_connectable)
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    if (request.action === 'DDALKKAK_PING') {
      sendResponse({ success: true, version: chrome.runtime.getManifest().version });
      return false;
    }
    if (request.action === 'DDALKKAK_CRAWL_ITEMS') {
      (async () => {
        try {
          const results = await crawlCoupangItems(request.urls || [], request.mode || 'price');
          sendResponse({ success: true, results });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });
}
