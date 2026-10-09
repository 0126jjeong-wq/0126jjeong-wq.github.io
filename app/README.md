# 릴스맛집지도 iOS 첫 빌드

운영 웹과 같은 저장소와 Supabase `site-data`를 사용하는 iOS 프로젝트다. 웹 원본은 루트 `index.html`, 앱 원본은 `app/src`에 둔다. 두 화면 모두 카테고리·정렬·릴스 필터를 같은 순서로 노출하며, 앱은 지도·검색·저장·주변 맛집·릴스·길찾기와 등록·수정 화면을 포함한다. iOS에서 위치, 외부 링크, 공유는 Capacitor 플러그인으로 연결한다.

```sh
cd app
npm ci
npm run ios:sync
npm run ios:open
```

Xcode가 설치된 Mac에서 프로젝트를 열고 서명 팀을 선택한 뒤 아이폰 또는 시뮬레이터에서 실행한다. 이 Linux 작업 환경에서는 Xcode 실행 및 실제 iPhone 검증이 불가능하다.

## 실제 기기 검증 전에

- 앱과 Safari 미리보기의 지도 바탕은 임시로 OpenStreetMap을 쓴다. 운영 홈페이지는 카카오맵 그대로다. 카카오 JavaScript SDK가 iOS 로컬 주소에서 작동하지 않아, 기기 테스트 전에 지도 기능을 볼 수 있게 한 조치다. 앱의 카카오맵 적용은 iOS SDK 연결 작업이 필요하다.
- App Store 식별자 `com.myreelsmap.app`은 개발용 초안이다. Apple Developer 계정의 사용 가능 여부 확인 후 확정한다.
- 저장 목록은 현재 기기 내부 저장소에 남는다. 기존 Safari 저장 목록이 앱에 자동 이전되거나 다른 기기와 동기화되지는 않는다.
- Google·카카오 웹 로그인은 운영 웹에 유지되어 있다. iOS 네이티브 로그인은 앱 복귀용 URL Scheme/Universal Link와 Supabase Redirect URL을 함께 설정한 뒤 추가한다.
- 관리자 도구는 앱에 넣지 않았다. 운영 관리자 페이지에서 데이터를 관리한다.
- iOS 빌드 및 TestFlight 배포는 Mac, Xcode, Apple 서명 계정이 준비된 뒤 수행한다.
