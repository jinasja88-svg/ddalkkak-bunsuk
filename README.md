# 딸깍분석 (Ddalkkak Bunsuk)

AI 기반 상품 페이지 분석 크롬 익스텐션. 웹페이지의 DOM 텍스트를 추출하고, 네이버+구글 검색으로 추가 정보를 수집한 뒤, Gemini AI가 상세 분석 결과를 제공합니다.

## 작동 방식

Merlin AI 크롬 익스텐션과 동일한 구조로 작동합니다.

```
1. 사용자가 상품 페이지에서 "딸깍 분석하기" 클릭
2. Content Script가 현재 페이지 DOM 텍스트 추출
3. AI가 페이지 제목에서 최적 검색어 생성 (Gemini Flash-Lite)
   예) "[공식] 앙쥬나나 바이젤디 크림 문제성피부..." → "앙쥬나나 바이젤디 크림"
4. 네이버 + 구글 동시 검색 → 상위 5개 페이지 본문 수집
5. DOM 텍스트 + 검색 결과를 Gemini 2.5 Flash에 전송하여 분석
6. 결과 표시 + 토큰 비용 실시간 계산
```

## 분석 항목

- 제품 기본 정보 (상품명, 브랜드, 가격)
- 상세 스펙
- 장점 (최소 5개, 실제 리뷰 인용)
- 단점 (최소 3개, 솔직하게)
- 경쟁 제품 대비 강점/약점
- 추천 대상 / 비추천 대상
- 총평

## 모드

| 모드 | 설명 |
|---|---|
| **기본 (DOM만)** | 열린 페이지 텍스트만 AI에 전송 |
| **터보 (검색+)** | DOM + 네이버/구글 검색 + 검색 결과 페이지 본문까지 수집하여 전송 |

## 설치 방법

1. 이 레포를 클론합니다
   ```bash
   git clone https://github.com/jinasja88/ddalkkak-bunsuk.git
   ```
2. 크롬 주소창에 `chrome://extensions` 입력
3. 우측 상단 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드합니다** 클릭
5. 클론한 폴더 선택

## 사용 방법

1. 분석하고 싶은 상품 페이지 열기
2. 딸깍분석 아이콘 클릭
3. 모드 선택 (기본/터보)
4. 분석 요청 입력 (기본값 제공)
5. **"딸깍 분석하기"** 클릭
6. 결과 확인 + 토큰 비용 확인

## 기술 스택

- **Chrome Extension Manifest V3**
- **Gemini API** (2.5 Flash: 분석, 2.0 Flash-Lite: 검색어 생성)
- Content Script: DOM 추출
- Background Service Worker: 검색, 페이지 수집, API 호출

## 파일 구조

```
├── manifest.json      # 크롬 익스텐션 설정
├── popup.html         # 팝업 UI
├── popup.js           # 메인 로직 (오케스트레이션)
├── content.js         # DOM 텍스트 추출
├── background.js      # 검색 + API 호출
└── icons/             # 아이콘
```

## 비용

| 항목 | 비용 |
|---|---|
| 검색어 생성 (Flash-Lite) | ~0.1원 |
| 상품 분석 (2.5 Flash) | ~1~3원 |
| **1회 분석 총 비용** | **~2~4원** |

## API 키 설정

`popup.js` 상단의 `GEMINI_API_KEY`를 본인의 키로 교체하세요.

```js
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
```

Gemini API 키는 [Google AI Studio](https://aistudio.google.com/apikey)에서 무료로 발급 가능합니다.

## 라이선스

MIT
