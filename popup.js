// 딸깍분석 - Popup Script

// ===== 설정 =====
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY'; // https://aistudio.google.com/apikey 에서 발급
const GEMINI_MODEL = 'gemini-2.5-flash';

// Gemini 2.5 Flash 가격 ($/1M tokens)
const PRICE = { input: 0.15, output: 0.60 };
const KRW_RATE = 1380;

// ===== 상태 =====
let currentMode = 'turbo'; // off = DOM만, turbo = 검색+
let analysisResult = '';

// ===== UI 요소 =====
const analyzeBtn = document.getElementById('analyzeBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const tokenInfoEl = document.getElementById('tokenInfo');
const resultEl = document.getElementById('result');
const promptEl = document.getElementById('userPrompt');

// ===== 모드 토글 =====
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});
// 기본값 터보로 설정
document.querySelector('[data-mode="turbo"]').classList.add('active');
document.querySelector('[data-mode="off"]').classList.remove('active');

// ===== 복사 버튼 =====
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(analysisResult).then(() => {
    copyBtn.textContent = '복사됨!';
    setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
  });
});

// ===== 상태 표시 =====
function addStep(id, text) {
  const step = document.createElement('div');
  step.className = 'step active';
  step.id = `step-${id}`;
  step.innerHTML = `⏳ ${text}<span class="loading-dots"></span>`;
  statusEl.appendChild(step);
}

function completeStep(id, text) {
  const step = document.getElementById(`step-${id}`);
  if (step) {
    step.className = 'step done';
    step.innerHTML = `✅ ${text}`;
  }
}

function errorStep(id, text) {
  const step = document.getElementById(`step-${id}`);
  if (step) {
    step.className = 'step error';
    step.innerHTML = `❌ ${text}`;
  }
}

function infoStep(id, text) {
  const step = document.getElementById(`step-${id}`);
  if (step) {
    step.className = 'step';
    step.style.color = '#8888aa';
    step.innerHTML = `ℹ️ ${text}`;
  }
}

// ===== 토큰 비용 계산 =====
function showTokenInfo(usage) {
  const inputCost = usage.inputTokens / 1e6 * PRICE.input;
  const outputCost = usage.outputTokens / 1e6 * PRICE.output;
  const totalCost = inputCost + outputCost;
  const krw = totalCost * KRW_RATE;

  tokenInfoEl.className = 'token-info show';
  tokenInfoEl.innerHTML = `
    <span>입력: ${usage.inputTokens.toLocaleString()}t</span>
    <span>출력: ${usage.outputTokens.toLocaleString()}t</span>
    <span>총: ${usage.totalTokens.toLocaleString()}t</span>
    <span class="cost">비용: $${totalCost.toFixed(6)} (약 ${krw.toFixed(1)}원)</span>
  `;
}

// ===== Content Script 삽입 및 DOM 추출 =====
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

async function extractDOM(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_DOM' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || 'DOM 추출 실패'));
    });
  });
}

// ===== AI 검색어 생성 =====
async function generateSearchQuery(pageTitle, userMessage) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'GENERATE_SEARCH_QUERY', apiKey: GEMINI_API_KEY, model: GEMINI_MODEL, pageTitle, userMessage },
      (response) => {
        resolve(response?.query || pageTitle.substring(0, 40));
      }
    );
  });
}

// ===== 네이버+구글 검색 (Background 경유) =====
async function doSearch(query, fetchPages) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'SEARCH_AND_FETCH', query, fetchPages },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ results: [], debug: chrome.runtime.lastError.message });
          return;
        }
        resolve({
          results: response?.results || [],
          debug: response?.debug || '응답 없음'
        });
      }
    );
  });
}

// ===== Gemini API 호출 (Background 경유) =====
async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'CALL_GEMINI', prompt, apiKey: GEMINI_API_KEY, model: GEMINI_MODEL },
      (response) => {
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || 'Gemini API 오류'));
      }
    );
  });
}

// ===== 프롬프트 조합 =====
function buildPrompt(userPrompt, domData, searchResults) {
  let prompt = '';

  prompt += `## 역할\n`;
  prompt += `당신은 제품/서비스 분석 전문가입니다. 제공된 데이터를 기반으로 한국어로 상세하게 분석해주세요.\n`;
  prompt += `실제 데이터에 없는 정보는 절대 지어내지 마세요. 정보가 부족하면 "페이지에서 확인 불가"라고 명시하세요.\n\n`;

  prompt += `## 사용자 요청\n${userPrompt}\n\n`;

  prompt += `## 현재 페이지 정보\n`;
  prompt += `- URL: ${domData.url}\n`;
  prompt += `- 제목: ${domData.meta.title}\n`;
  if (domData.meta.description) prompt += `- 설명: ${domData.meta.description}\n`;
  if (domData.meta.ogDescription) prompt += `- OG설명: ${domData.meta.ogDescription}\n`;

  prompt += `\n## 현재 페이지 본문 (DOM 추출 ${domData.charCount}자)\n`;
  prompt += `\`\`\`\n${domData.text.substring(0, 10000)}\n\`\`\`\n`;

  if (searchResults && searchResults.length > 0) {
    const withBody = searchResults.filter(r => r.body && r.body.length > 50);
    const withSnippet = searchResults.filter(r => r.snippet && r.snippet.length > 10);

    prompt += `\n## 구글 검색으로 수집한 추가 정보 (${searchResults.length}개 소스)\n`;

    for (const r of searchResults) {
      prompt += `\n### ${r.title}\n`;
      prompt += `URL: ${r.url}\n`;
      if (r.snippet) prompt += `스니펫: ${r.snippet}\n`;
      if (r.body && r.body.length > 50) {
        prompt += `페이지 내용:\n${r.body.substring(0, 2000)}\n`;
      }
    }
  }

  prompt += `\n## 반드시 포함할 분석 항목\n`;
  prompt += `1. **제품 기본 정보** — 상품명, 브랜드, 가격, 모델명\n`;
  prompt += `2. **상세 스펙** — 크기, 무게, 소재, 성분, 기능 등\n`;
  prompt += `3. **구성품** — 포함된 것들\n`;
  prompt += `4. **장점** (최소 5개, 구체적으로)\n`;
  prompt += `5. **단점** (최소 3개, 솔직하게)\n`;
  prompt += `6. **경쟁 제품 대비 강점/약점**\n`;
  prompt += `7. **추천 대상 / 비추천 대상**\n`;
  prompt += `8. **총평** — 구매 가치 평가\n`;

  return prompt;
}

// ===== Markdown → HTML 간단 변환 =====
function markdownToHtml(md) {
  return md
    .replace(/### (.*)/g, '<h3>$1</h3>')
    .replace(/## (.*)/g, '<h2>$1</h2>')
    .replace(/# (.*)/g, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\- (.*)/gm, '• $1')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// ===== 메인 분석 실행 =====
analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = '분석 중...';
  copyBtn.disabled = true;
  statusEl.innerHTML = '';
  tokenInfoEl.className = 'token-info';
  resultEl.innerHTML = '';
  analysisResult = '';

  const userPrompt = promptEl.value.trim() ||
    '이 사이트의 제품을 아주 상세하게 강점, 단점, 스펙 등 분석해서 알려줘';

  try {
    // 현재 탭 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('활성 탭을 찾을 수 없습니다.');

    // Step 1: Content Script 주입
    addStep('inject', 'Content Script 주입 중');
    await injectContentScript(tab.id);
    completeStep('inject', 'Content Script 준비 완료');

    // Step 2: DOM 추출
    addStep('dom', '페이지 DOM 텍스트 추출 중');
    const domData = await extractDOM(tab.id);
    completeStep('dom', `DOM 추출 완료 (${domData.charCount.toLocaleString()}자)`);

    // Step 3: AI 검색어 생성 + 검색 (터보 모드)
    let searchResults = [];
    if (currentMode === 'turbo') {
      // 3-1: AI가 최적 검색어 생성 (Merlin의 SEARCH_DECISION과 동일)
      addStep('query', 'AI가 최적 검색어 생성 중');
      const pageTitle = domData.meta.ogTitle || domData.meta.title || '';
      const searchQuery = await generateSearchQuery(pageTitle, userPrompt);
      completeStep('query', `검색어: "${searchQuery}"`);

      // 3-2: 네이버 + 구글 동시 검색 + 페이지 본문 수집
      addStep('search', `네이버+구글 검색 + 페이지 수집 중`);
      const searchData = await doSearch(searchQuery, true);
      searchResults = searchData.results;

      if (searchResults.length > 0) {
        completeStep('search', `${searchData.debug}`);
      } else {
        errorStep('search', `검색 결과 없음 (${searchData.debug})`);
      }
    }

    // Step 4: 프롬프트 조합
    const prompt = buildPrompt(userPrompt, domData, searchResults);
    addStep('prompt', `프롬프트 조합 완료 (${prompt.length.toLocaleString()}자)`);
    completeStep('prompt', `프롬프트 조합 완료 (${prompt.length.toLocaleString()}자)`);

    // Step 5: Gemini API 호출
    addStep('gemini', `${GEMINI_MODEL}에 분석 요청 중`);
    const response = await callGemini(prompt);
    completeStep('gemini', `${GEMINI_MODEL} 분석 완료`);

    // 결과 표시
    analysisResult = response.text;
    resultEl.innerHTML = markdownToHtml(response.text);
    showTokenInfo(response.usage);
    copyBtn.disabled = false;

  } catch (err) {
    const lastStep = statusEl.lastElementChild?.id?.replace('step-', '') || 'gemini';
    errorStep(lastStep, `오류: ${err.message}`);
    resultEl.innerHTML = `<span style="color:#f87171;">오류 발생: ${err.message}</span>`;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = '🖱️ 딸깍 분석하기';
  }
});
