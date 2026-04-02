// 딸깍분석 - Background Service Worker
// 검색어 AI 생성 + 네이버/구글 검색 + 페이지 fetch + Gemini API

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
