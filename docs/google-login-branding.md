# Google 로그인 화면의 서비스 이름

Google 로그인은 Supabase Auth를 거쳐 정상 작동하지만, 브랜드 검증을 완료하지 않은 Google OAuth 앱은 이름 대신 인증 도메인이 표시될 수 있다. 웹페이지의 제목이나 Supabase 프로젝트 이름을 바꿔 해결할 수 없다.

## 운영용 브랜딩 값

- 앱 이름: 릴스맛집지도
- 홈페이지: https://myreelsmap.com/
- 개인정보처리방침: https://myreelsmap.com/policy.html#privacy
- 서비스 약관: https://myreelsmap.com/policy.html#terms
- 로고: assets/reelsmap-logo-120.png (120×120, 배경 포함)
- 내 소유 도메인: myreelsmap.com
- 담당 이메일: 실제 운영자가 확인하는 Google 계정 이메일을 사용한다.

## 확인 순서

1. Google Auth Platform의 Clients에서 현재 웹 로그인에 사용하는 클라이언트가 있는 프로젝트를 선택한다. 확인된 웹 클라이언트는 `233695481220-8s0cu33iaingl00nervlp3mp2nr67cts.apps.googleusercontent.com`이다.
2. Branding에서 위 앱 이름과 링크, 로고 및 연락처를 확인한다. 홈페이지 도메인 소유권은 같은 계정의 Search Console에서 확인한다.
3. 브랜드 검증 상태를 확인한다. 단순 저장은 게시가 아니다. 검증이 필요한 상태라면 Verify Branding(브랜드 검증)을 진행하고, 검증 완료 후 Publish branding(브랜딩 게시)을 확인한다.
4. 검증이 진행 중이면 임의로 취소하지 않는다. Google이 요구하는 수정 사항이나 알림을 먼저 확인한다. 검증을 통과한 설정과 현재 사용자에게 게시된 설정을 구분한다.
5. 새 브라우저 세션에서 운영 웹의 Google 로그인을 열어 이름과 로고 표시를 확인한다. Google 검증 결과가 확인되기 전에는 완료로 보고하지 않는다.

정상 동작 중인 Supabase OAuth 콜백 `https://tbyfoxsyadmpeeatyzvm.supabase.co/auth/v1/callback`을 홈페이지 주소로 교체하지 않는다. 콜백 주소를 잘못 바꾸면 로그인이 중단된다. 인증용 사용자 지정 도메인은 별도 설정이며 이번 이름 표시 문제 때문에 유료 서비스를 즉시 구매할 필요는 없다.

## 현재 확인의 한계 (2026-10-24)

작업 브라우저의 Google Cloud 콘솔에서 `Site Unavailable`이 표시되어, 프로젝트의 실제 브랜드 검증·게시 상태는 읽거나 수정하지 못했다. 계정 소유자가 Branding 화면의 현재 상태를 확인해야 한다.

공식 문서:

- https://developers.google.com/identity/verification/authentication-verification
- https://support.google.com/cloud/answer/15549049
- https://supabase.com/docs/guides/auth/social-login/auth-google
