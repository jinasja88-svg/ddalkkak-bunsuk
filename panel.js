// 딸깍분석 - Panel Script (iframe 내부에서 실행)

// ===== 설정 (API 키는 config.js에서 로드) =====
// GEMINI_API_KEY는 config.js에서 정의됨
const GEMINI_MODEL = 'gemini-2.5-flash';
const PRICE = { input: 0.15, output: 0.60 };
const KRW_RATE = 1380;

// ===== 상태 =====
let currentMode = 'turbo';
let analysisResult = '';

// ===== UI 요소 =====
const analyzeBtn = document.getElementById('analyzeBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const tokenInfoEl = document.getElementById('tokenInfo');
const resultEl = document.getElementById('result');
const promptEl = document.getElementById('userPrompt');
const closeBtn = document.getElementById('closeBtn');

// ===== 닫기 버튼 =====
closeBtn.addEventListener('click', () => {
  window.parent.postMessage({ type: 'DDALKKAK_CLOSE' }, '*');
});

// ===== 탭 전환 =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ===== 모드 토글 =====
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});

// ===== 복사 버튼 =====
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(analysisResult).then(() => {
    copyBtn.textContent = '복사됨!';
    setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
  });
});

// ===== 상태 표시 (단순 진행률) =====
let totalSteps = 4;
let currentStep = 0;

function updateStatus(step, total) {
  currentStep = step;
  totalSteps = total;
  statusEl.innerHTML = `<div class="step active">AI 분석 중 (${step}/${total})<span class="loading-dots"></span></div>`;
}
function showError(msg) {
  statusEl.innerHTML = `<div class="step error">분석 실패: ${msg}</div>`;
}
function clearStatus() {
  statusEl.innerHTML = '';
}

// ===== 토큰 비용 =====
function showTokenInfo(usage) {
  const inputCost = usage.inputTokens / 1e6 * PRICE.input;
  const outputCost = usage.outputTokens / 1e6 * PRICE.output;
  const totalCost = inputCost + outputCost;
  const krw = totalCost * KRW_RATE;
  tokenInfoEl.className = 'token-info show';
  tokenInfoEl.innerHTML = `
    <span>입력: ${usage.inputTokens.toLocaleString()}t</span>
    <span>출력: ${usage.outputTokens.toLocaleString()}t</span>
    <span class="cost">비용: $${totalCost.toFixed(6)} (약 ${krw.toFixed(1)}원)</span>
  `;
}

// ===== Background 통신 =====
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

// ===== 프롬프트 조합 =====
function buildPrompt(userPrompt, domData, searchResults) {
  let prompt = '';
  prompt += `## 역할\n당신은 제품/서비스 분석 전문가입니다. 제공된 데이터를 기반으로 한국어로 상세하게 분석해주세요.\n`;
  prompt += `실제 데이터에 없는 정보는 절대 지어내지 마세요. 정보가 부족하면 "페이지에서 확인 불가"라고 명시하세요.\n\n`;
  prompt += `## 사용자 요청\n${userPrompt}\n\n`;
  prompt += `## 현재 페이지 정보\n- URL: ${domData.url}\n- 제목: ${domData.meta.title}\n`;
  if (domData.meta.description) prompt += `- 설명: ${domData.meta.description}\n`;
  if (domData.meta.ogDescription) prompt += `- OG설명: ${domData.meta.ogDescription}\n`;
  prompt += `\n## 현재 페이지 본문 (DOM 추출 ${domData.charCount}자)\n\`\`\`\n${domData.text.substring(0, 10000)}\n\`\`\`\n`;

  if (searchResults && searchResults.length > 0) {
    prompt += `\n## 검색으로 수집한 추가 정보 (${searchResults.length}개 소스)\n`;
    for (const r of searchResults) {
      prompt += `\n### ${r.title}\nURL: ${r.url}\n`;
      if (r.snippet) prompt += `스니펫: ${r.snippet}\n`;
      if (r.body && r.body.length > 50) prompt += `페이지 내용:\n${r.body.substring(0, 2000)}\n`;
    }
  }

  prompt += `\n## 반드시 포함할 분석 항목\n`;
  prompt += `1. **제품 기본 정보** — 상품명, 브랜드, 가격, 모델명\n`;
  prompt += `2. **상세 스펙** — 크기, 무게, 소재, 성분, 기능 등\n`;
  prompt += `3. **구성품**\n4. **장점** (최소 5개)\n5. **단점** (최소 3개)\n`;
  prompt += `6. **경쟁 제품 대비 강점/약점**\n7. **추천/비추천 대상**\n8. **총평**\n`;
  return prompt;
}

// ===== Markdown → HTML =====
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

// ===== 메인 분석 =====
analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = '분석 중...';
  copyBtn.disabled = true;
  statusEl.innerHTML = '';
  tokenInfoEl.className = 'token-info';
  resultEl.innerHTML = '';
  analysisResult = '';

  const userPrompt = promptEl.value.trim() || '이 사이트의 제품을 아주 상세하게 강점, 단점, 스펙 등 분석해서 알려줘';

  try {
    const isTurbo = currentMode === 'turbo';
    const steps = isTurbo ? 4 : 2;

    // Step 1: DOM 추출
    updateStatus(1, steps);
    window.parent.postMessage({ type: 'DDALKKAK_EXTRACT_DOM' }, '*');

    const domData = await new Promise((resolve, reject) => {
      const handler = (event) => {
        if (event.data?.type === 'DDALKKAK_DOM_RESULT') {
          window.removeEventListener('message', handler);
          if (event.data.success) resolve(event.data.data);
          else reject(new Error(event.data.error || '페이지 정보를 읽을 수 없습니다'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('페이지 응답 시간 초과')); }, 10000);
    });

    // Step 2~3: 검색 (터보 모드)
    let searchResults = [];
    if (isTurbo) {
      updateStatus(2, steps);
      const pageTitle = domData.meta.ogTitle || domData.meta.title || '';
      const queryResp = await sendToBackground({
        action: 'GENERATE_SEARCH_QUERY', apiKey: GEMINI_API_KEY, model: GEMINI_MODEL,
        pageTitle, userMessage: userPrompt
      });
      const searchQuery = queryResp?.query || pageTitle.substring(0, 40);

      updateStatus(3, steps);
      const searchResp = await sendToBackground({ action: 'SEARCH_AND_FETCH', query: searchQuery, fetchPages: true });
      searchResults = searchResp?.results || [];
    }

    // Step 마지막: Gemini 분석
    updateStatus(isTurbo ? 4 : 2, steps);
    const prompt = buildPrompt(userPrompt, domData, searchResults);
    const resp = await sendToBackground({ action: 'CALL_GEMINI', prompt, apiKey: GEMINI_API_KEY, model: GEMINI_MODEL });
    if (!resp?.success) throw new Error(resp?.error || 'AI 분석에 실패했습니다');

    clearStatus();
    analysisResult = resp.text;
    resultEl.innerHTML = markdownToHtml(resp.text);
    showTokenInfo(resp.usage);
    copyBtn.disabled = false;

  } catch (err) {
    showError(err.message);
    resultEl.innerHTML = '';
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = '🖱️ 딸깍 분석하기';
  }
});
