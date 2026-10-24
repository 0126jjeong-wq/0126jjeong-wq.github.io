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

저장소 루트의 `codemagic.yaml`에는 서명 없이 컴파일만 검사하는 `ios-compile-check`와 App Store Connect에 올리는 `ios-testflight`가 있다. 아이패드 Safari에서도 [Codemagic](https://codemagic.io/start/)과 [App Store Connect](https://appstoreconnect.apple.com/)를 설정할 수 있다.

1. Codemagic에서 GitHub 저장소 `0126jjeong-wq/0126jjeong-wq.github.io`를 추가한다. `Start new build`에서 `main` 브랜치와 `ios-compile-check`를 선택한다. 이 빌드는 Apple 서명 없이 컴파일만 검사하며 결과물은 아이폰에 설치할 수 없다.
2. 실제 아이폰 테스트를 진행할 때 Apple Developer Program에 등록하고 App Store Connect에 번들 ID `com.myreelsmap.app`의 앱 기록을 만든다. Apple Developer에서 이 ID의 App Store 배포용 서명을 준비한다.
3. Team integrations → Developer Portal에 App Store Connect API 키를 `reelsmap-apple` 이름으로 연결한다. 키와 비밀번호는 채팅이나 저장소에 올리지 않는다. 해당 ID의 App Store 배포 인증서와 프로비저닝 프로필을 Codemagic의 Code signing identities에 연결한다.
4. `main` 브랜치의 `ios-testflight` 워크플로를 실행한다. 성공하면 App Store Connect의 TestFlight에서 빌드를 확인해 내부 테스터에게 배포한다. 앱 심사용 정보와 개인정보 항목은 실제 기능에 맞게 입력한다.

Codemagic에서 macOS 빌드와 업로드를 대신하므로 사용자 소유 Mac은 필요하지 않다. `codemagic.yaml`은 아직 클라우드에서 실제 빌드를 실행하지 못했으므로 첫 빌드 로그를 확인해야 한다. 앱의 로그인 복귀 경로와 실제 iPhone 지도 동작은 TestFlight 배포 전 검증할 항목이다.

## 실제 기기 검증 전에

- 앱과 Safari 미리보기의 지도 바탕은 임시로 OpenStreetMap을 쓴다. 운영 홈페이지는 카카오맵 그대로다. 카카오 JavaScript SDK가 iOS 로컬 주소에서 작동하지 않아, 기기 테스트 전에 지도 기능을 볼 수 있게 한 조치다. 앱의 카카오맵 적용은 iOS SDK 연결 작업이 필요하다.
- App Store 식별자 `com.myreelsmap.app`은 개발용 초안이다. Apple Developer 계정의 사용 가능 여부 확인 후 확정한다.
- 저장은 회원가입·로그인 후에만 가능하다. 웹·앱의 맛집 저장은 `user_saved_restaurants`, 공유받은 릴스와 개인 가게 연결은 `user_reel_library`에 계정별로 보관한다. 같은 계정으로 다시 접속하면 서버에서 목록을 불러온다. 기존 비회원 기기 저장 목록은 소유 계정을 알 수 없어 자동으로 합치지 않는다.
- Google·카카오 웹 로그인은 운영 웹에 유지되어 있다. iOS 앱에는 Google 로그인 화면과 앱 복귀 코드가 들어 있다. 실제 로그인 전에 Supabase Authentication → URL Configuration의 Redirect URLs에 `com.myreelsmap.app://auth/callback`을 추가해야 한다. 카카오는 개발자 키와 Supabase Provider 설정 확인 전까지 앱에서 `준비 중`으로 비활성화했다.
- 관리자 도구는 앱에 넣지 않았다. 운영 관리자 페이지에서 데이터를 관리한다.
- iOS 빌드 및 TestFlight 배포는 Codemagic의 클라우드 Mac과 Apple 개발자 서명 계정이 준비된 뒤 수행한다. 사용자 소유 Mac이나 Xcode 설치는 필요하지 않다.

## Instagram에서 공유받기

- iOS 공유 시트에 `릴스맛집지도` Share Extension을 추가했다. Instagram에서 `공유 → 더 보기 → 릴스맛집지도 → 릴스 보관`을 선택한다.
- 링크는 App Group `group.com.myreelsmap.app`의 기기 보관함에 저장된다. 앱을 열거나 다시 활성화하면 등록·수정 탭의 `공유받은 릴스`에서 확인·삭제할 수 있다. 같은 링크의 추적 쿼리는 제거하고 중복을 막는다.
- 공유 확장은 본 앱을 강제로 여는 비공식 우회 API를 사용하지 않는다. 보관 후 사용자가 본 앱을 열어야 한다.
- 공유받은 릴스에서 기존 맛집을 검색해 연결하거나, 가게명·주소·카테고리를 입력하고 지도 지점을 눌러 개인 가게를 만들 수 있다. 결과는 저장 탭과 내 지도에 표시한다. 자동 매장 정보 추출이나 조회수 수집은 하지 않는다. 공개 지도 데이터는 수정하지 않는다.
- 등록·수정 화면에서 Instagram 링크를 직접 붙여넣어 같은 저장 흐름을 시험할 수 있다. 링크에 해당하는 릴스가 기존 맛집에 등록되어 있으면 연결할 가게를 바로 제안한다. 공유 문구와 추적 쿼리는 제거하고 한 번에 링크 한 개만 받는다.
- 개인 연결은 회원 전용 서버 보관함에 저장한다. 로그아웃·계정 변경 시 메모리의 목록을 즉시 비운다. RLS로 본인 데이터만 읽고 쓸 수 있으며 회원정보 입력을 완료해야 한다. 공유 확장은 앱에서 로그인·가입을 마친 계정과 세션 만료 시각을 확인하고 계정별 임시 큐에 보관한다. 앱이 서버 저장에 성공한 뒤 큐에서 제거하므로 네트워크 실패 시 다시 시도할 수 있다. 세션이 만료되면 앱을 열어 로그인 상태를 갱신한 뒤 공유한다.
- Apple Developer에서 본 앱 `com.myreelsmap.app`와 확장 `com.myreelsmap.app.ShareExtension` 양쪽에 동일한 App Group을 활성화하고 두 App ID용 프로필을 준비해야 실제 기기에서 공유 보관이 동작한다. Codemagic의 서명 설정도 두 프로필을 포함해야 한다. 공유 확장 변경은 새 네이티브 빌드를 설치해야 반영된다.
- 검증: JS 빌드와 Capacitor sync, Xcode 프로젝트 파싱, plist 검사를 로컬에서 수행했다. Xcode 컴파일 및 Instagram 실기기 공유 테스트는 아직 필요하다.
- 링크 정규화·위장 도메인 거부·기존 맛집 연결 검사는 `node --test tests/shared-reels.test.mjs`로 실행한다(`app` 폴더에서 실행).

## 웹과 앱의 개인 릴스 역할

- Instagram 공유 수신 및 새 개인 릴스 보관은 앱에서 수행한다. 웹에는 개인 릴스 URL 붙여넣기나 공유 수신 기능을 제공하지 않는다.
- 운영 웹의 저장 탭에서 앱으로 보관한 릴스를 확인하고, 가게명·카테고리·연결 가게를 수정하거나 보관함에서 삭제할 수 있다. 공유 링크와 공개 매장 정보는 이 관리 화면에서 변경하지 않는다.
- 웹 수정은 기존 보관 행에 대한 UPDATE만 사용하므로 이미 삭제한 릴스를 재생성하지 않는다. 앱은 다시 활성화될 때 서버 목록을 갱신하여 웹 변경을 반영한다.
