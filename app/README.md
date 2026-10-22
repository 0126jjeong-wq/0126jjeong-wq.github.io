# 릴스맛집지도 iOS 첫 빌드

운영 웹과 같은 저장소와 Supabase `site-data`를 사용하는 iOS 프로젝트다. 웹 원본은 루트 `index.html`, 앱 원본은 `app/src`에 둔다. 앱은 웹의 색과 카테고리를 유지하고, 작은 화면에서는 소개·매장 카드를 압축한다. `릴스 조회수 100만+` 필터는 조회수가 확인된 등록 릴스가 100만 회 이상인 매장을 보여주며, 카드에서 여러 릴스를 하나씩 펼쳐 볼 수 있다. 앱은 지도·검색·저장·주변 맛집·릴스·길찾기와 등록·수정 화면을 포함한다. iOS에서 위치, 외부 링크, 공유는 Capacitor 플러그인으로 연결한다.

```sh
cd app
npm ci
npm run ios:sync
npm run ios:open
```

Xcode가 설치된 Mac에서 프로젝트를 열고 서명 팀을 선택한 뒤 아이폰 또는 시뮬레이터에서 실행한다. 이 Linux 작업 환경에서는 Xcode 실행 및 실제 iPhone 검증이 불가능하다.

## Mac 없이 iPhone에서 시험하기

저장소 루트의 `codemagic.yaml`은 Codemagic의 클라우드 Mac에서 iOS 앱을 빌드해 App Store Connect에 업로드하는 설정이다. 아이패드 Safari에서도 [Codemagic](https://codemagic.io/start/)과 [App Store Connect](https://appstoreconnect.apple.com/)를 설정할 수 있다.

1. Apple Developer Program에 등록하고 App Store Connect에 번들 ID `com.myreelsmap.app`의 앱 기록을 만든다. Apple Developer에서 이 ID의 App Store 배포용 서명을 준비한다.
2. Codemagic에서 GitHub 저장소 `0126jjeong-wq/0126jjeong-wq.github.io`를 추가한다. Team integrations → Developer Portal에 App Store Connect API 키를 `reelsmap-apple` 이름으로 연결한다. 키와 비밀번호는 채팅이나 저장소에 올리지 않는다.
3. 해당 ID의 App Store 배포 인증서와 프로비저닝 프로필을 Codemagic의 Code signing identities에 연결한다. `main` 브랜치의 `ios-testflight` 워크플로를 실행한다.
4. 성공하면 App Store Connect의 TestFlight에서 빌드를 확인해 내부 테스터에게 배포한다. 앱 심사용 정보와 개인정보 항목은 실제 기능에 맞게 입력한다.

Codemagic에서 macOS 빌드와 업로드를 대신하므로 사용자 소유 Mac은 필요하지 않다. `codemagic.yaml`은 아직 클라우드에서 실제 빌드를 실행하지 못했으므로 첫 빌드 로그를 확인해야 한다. 앱의 로그인 복귀 경로와 실제 iPhone 지도 동작은 TestFlight 배포 전 검증할 항목이다.

## 실제 기기 검증 전에

- 앱과 Safari 미리보기의 지도 바탕은 임시로 OpenStreetMap을 쓴다. 운영 홈페이지는 카카오맵 그대로다. 카카오 JavaScript SDK가 iOS 로컬 주소에서 작동하지 않아, 기기 테스트 전에 지도 기능을 볼 수 있게 한 조치다. 앱의 카카오맵 적용은 iOS SDK 연결 작업이 필요하다.
- App Store 식별자 `com.myreelsmap.app`은 개발용 초안이다. Apple Developer 계정의 사용 가능 여부 확인 후 확정한다.
- 저장 목록은 현재 기기 내부 저장소에 남는다. 기존 Safari 저장 목록이 앱에 자동 이전되거나 다른 기기와 동기화되지는 않는다.
- Google·카카오 웹 로그인은 운영 웹에 유지되어 있다. iOS 앱에는 Google 로그인 화면과 앱 복귀 코드가 들어 있다. 실제 로그인 전에 Supabase Authentication → URL Configuration의 Redirect URLs에 `com.myreelsmap.app://auth/callback`을 추가해야 한다. 카카오는 개발자 키와 Supabase Provider 설정 확인 전까지 앱에서 `준비 중`으로 비활성화했다.
- 관리자 도구는 앱에 넣지 않았다. 운영 관리자 페이지에서 데이터를 관리한다.
- iOS 빌드 및 TestFlight 배포는 Codemagic의 클라우드 Mac과 Apple 개발자 서명 계정이 준비된 뒤 수행한다. 사용자 소유 Mac이나 Xcode 설치는 필요하지 않다.
