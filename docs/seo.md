# 릴스맛집지도 검색 노출

- 운영 도메인: `https://myreelsmap.com/`. 루트 `index.html`과 `policy.html`의 canonical URL은 이 도메인으로 고정한다.
- 공개 매장 데이터는 `site-data` Edge Function의 **published** 목록에서 가져온다. `node scripts/build-seo.mjs`가 `places/<매장 UUID>/index.html`, 지역별 `places/index.html`, `sitemap.xml`을 생성한다. 페이지에는 매장명·주소·카테고리·등록된 메뉴·원본 Instagram 링크만 표시한다. 만료되는 사진 서명 URL이나 회원 저장 데이터는 포함하지 않는다.
- 매일 11:20 KST에 GitHub Actions가 매장 페이지를 다시 생성한다. 실패하거나 API 목록이 비어 있거나 500건 제한에 도달하면 기존 페이지를 덮어쓰지 않는다. 공개에서 제외된 매장 페이지와 사이트맵 항목은 다음 정상 실행 때 제거한다. 필요하면 `Refresh public place pages` 작업을 수동 실행한다.
- `robots.txt`가 `sitemap.xml`을 알린다. 사이트맵은 홈, 지역별 목록, 서비스 안내, 매장 페이지의 정규 URL만 포함한다. 관리자 로그인은 `noindex,nofollow`다.
- 구글 소유 확인 태그는 홈에 이미 있다. 네이버 소유 확인 메타태그(`<meta name="naver-site-verification" content="e53e1bb59e34f72f786afb37efee864ee712747b" />`) 및 HTML 확인 파일(`naverb3a09c7382a9782f7e671570dedbefc9.html`)이 홈에 반영되어 있다. 네이버 서치어드바이저에서 소유 확인을 완료하고 사이트맵 주소 `https://myreelsmap.com/sitemap.xml`을 제출한다. 구글 Search Console에도 같은 사이트맵을 제출한다.
- 검색 결과 순위나 수집 시각은 보장되지 않는다. 매장 정보가 변경되거나 삭제되면 다음 검색엔진 재수집까지 기존 검색 결과가 남을 수 있다.
