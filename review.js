// 딸깍분석 - 리뷰 분석기
// 네이버 스마트스토어/브랜드스토어 리뷰 수집 + AI 분석

(() => {
  const MAX_REVIEWS = 200; // 장점/단점 각각 최대 200개
  const PAGE_SIZE = 20;

  // UI 요소
  const reviewBtn = document.getElementById('reviewBtn');
  const reviewCopyBtn = document.getElementById('reviewCopyBtn');
  const reviewStatus = document.getElementById('reviewStatus');
  const reviewTokenInfo = document.getElementById('reviewTokenInfo');
  const reviewResult = document.getElementById('reviewResult');
  const reviewInfo = document.getElementById('reviewInfo');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');

  let reviewAnalysisResult = '';

  // ===== 프로그레스 =====
  function showProgress(pct, text) {
    progressBar.className = 'progress-bar show';
    progressFill.style.width = `${Math.min(pct, 100)}%`;
    reviewStatus.innerHTML = `<div class="step active">${text} (${Math.round(pct)}%)<span class="loading-dots"></span></div>`;
  }
  function hideProgress() {
    progressBar.className = 'progress-bar';
    reviewStatus.innerHTML = '';
  }
  function showReviewError(msg) {
    progressBar.className = 'progress-bar';
    reviewStatus.innerHTML = `<div class="step error">실패: ${msg}</div>`;
  }

  // ===== 페이지 감지 =====
  function detectPage() {
    window.parent.postMessage({ type: 'DDALKKAK_DETECT_REVIEW_PAGE' }, '*');
  }

  // 탭 전환 시 감지
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'review') detectPage();
    });
  });

  // 페이지 감지 결과 수신
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'DDALKKAK_REVIEW_PAGE_INFO') {
      const info = event.data.data;
      if (info.supported) {
        reviewInfo.innerHTML = `<span class="supported">지원: ${info.platform}</span><br>상품: ${info.productName || '감지됨'}`;
        reviewBtn.disabled = false;
      } else {
        reviewInfo.innerHTML = `<span class="unsupported">이 페이지는 리뷰 수집을 지원하지 않습니다.</span><br>지원: 네이버 스마트스토어, 브랜드스토어, 쿠팡`;
        reviewBtn.disabled = true;
      }
    }

    // 리뷰 수집 결과 수신
    if (event.data?.type === 'DDALKKAK_REVIEW_RESULT') {
      handleReviewResult(event.data);
    }

    // 리뷰 수집 진행률
    if (event.data?.type === 'DDALKKAK_REVIEW_PROGRESS') {
      showProgress(event.data.percent, event.data.text);
    }
  });

  // 초기 감지
  setTimeout(detectPage, 500);

  // ===== 복사 버튼 =====
  reviewCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(reviewAnalysisResult).then(() => {
      reviewCopyBtn.textContent = '복사됨!';
      setTimeout(() => { reviewCopyBtn.textContent = '복사'; }, 1500);
    });
  });

  // ===== 리뷰 수집 시작 =====
  reviewBtn.addEventListener('click', () => {
    reviewBtn.disabled = true;
    reviewBtn.textContent = '수집 중...';
    reviewCopyBtn.disabled = true;
    reviewResult.innerHTML = '';
    reviewAnalysisResult = '';
    reviewTokenInfo.className = 'token-info';

    showProgress(0, '리뷰 수집 준비 중');

    // content script에 리뷰 수집 요청
    window.parent.postMessage({
      type: 'DDALKKAK_COLLECT_REVIEWS',
      maxReviews: MAX_REVIEWS,
      pageSize: PAGE_SIZE
    }, '*');
  });

  // ===== 리뷰 수집 완료 → AI 분석 =====
  async function handleReviewResult(data) {
    if (!data.success) {
      showReviewError(data.error || '리뷰 수집 실패');
      reviewBtn.disabled = false;
      reviewBtn.textContent = '리뷰 수집 & 분석';
      return;
    }

    const { positiveReviews, negativeReviews, productName } = data;

    showProgress(70, 'AI 분석 중');

    // 프롬프트 조합
    let prompt = `## 역할\n당신은 소비자 리뷰 분석 전문가입니다. 실제 구매자 리뷰를 기반으로 장점과 단점을 정리해주세요.\n\n`;
    prompt += `## 상품명\n${productName}\n\n`;

    prompt += `## 5점 리뷰 (장점, ${positiveReviews.length}개)\n`;
    for (const r of positiveReviews.slice(0, MAX_REVIEWS)) {
      prompt += `- ${r}\n`;
    }

    prompt += `\n## 1~2점 리뷰 (단점, ${negativeReviews.length}개)\n`;
    for (const r of negativeReviews.slice(0, MAX_REVIEWS)) {
      prompt += `- ${r}\n`;
    }

    prompt += `\n## 분석 요청\n`;
    prompt += `위 리뷰들을 분석해서 다음 형식으로 정리해주세요:\n\n`;
    prompt += `### 장점 요약 (5점 리뷰 기반)\n`;
    prompt += `- 가장 많이 언급된 장점들을 빈도순으로 정리\n`;
    prompt += `- 각 장점에 대표 리뷰 원문 1~2개 인용\n\n`;
    prompt += `### 단점 요약 (1~2점 리뷰 기반)\n`;
    prompt += `- 가장 많이 언급된 불만/단점을 빈도순으로 정리\n`;
    prompt += `- 각 단점에 대표 리뷰 원문 1~2개 인용\n`;
    prompt += `- 특히 심각한 문제(불량, 안전, 위생 등)는 별도 경고로 표시\n\n`;
    prompt += `### 구매 판단 요약\n`;
    prompt += `- 이 제품을 사야 하는 사람 / 사면 안 되는 사람\n`;
    prompt += `- 한줄 총평\n`;

    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'CALL_GEMINI', prompt, apiKey: GEMINI_API_KEY, model: GEMINI_MODEL },
          (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          }
        );
      });

      if (!resp?.success) throw new Error(resp?.error || 'AI 분석 실패');

      hideProgress();
      reviewAnalysisResult = resp.text;
      reviewResult.innerHTML = markdownToHtml(resp.text);
      reviewCopyBtn.disabled = false;

      // 토큰 정보
      const usage = resp.usage;
      const inputCost = usage.inputTokens / 1e6 * PRICE.input;
      const outputCost = usage.outputTokens / 1e6 * PRICE.output;
      const totalCost = inputCost + outputCost;
      reviewTokenInfo.className = 'token-info show';
      reviewTokenInfo.innerHTML = `
        <span>5점 리뷰: ${positiveReviews.length}개</span>
        <span>1~2점 리뷰: ${negativeReviews.length}개</span>
        <span class="cost">비용: $${totalCost.toFixed(6)} (약 ${(totalCost * KRW_RATE).toFixed(1)}원)</span>
      `;
    } catch (err) {
      showReviewError(err.message);
    } finally {
      reviewBtn.disabled = false;
      reviewBtn.textContent = '리뷰 수집 & 분석';
    }
  }
})();
