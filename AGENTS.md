# 릴스맛집지도 작업 기준

- 이 저장소의 `main` 브랜치가 웹, iOS 앱, 백엔드 작업의 단일 기준이다.
- 운영 웹 원본은 루트 `index.html`이다.
- iOS 앱 원본은 `app/src`이고 `app/dist`와 `app/ios/App/App/public`은 빌드 산출물이다. 산출물을 직접 편집하지 않는다.
- 백엔드 Edge Function과 SQL은 `backend`에 둔다.
- 웹의 Google·카카오 Supabase 로그인을 제거하거나 공급자를 바꾸지 않는다.
- 웹과 앱 모두 카테고리, 정렬, 릴스 필터를 화면에서 바로 찾을 수 있어야 한다. 지도 화면에도 카테고리 필터를 유지한다.
- 앱 변경 후 `cd app && npm run build && npm run ios:sync`를 실행한다.
