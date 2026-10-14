-- ============================================================
-- 2단계 보정 — 데이터 이전 전에 실행 (01_스키마.sql 다음)
-- SQL Editor 에 붙여넣고 RUN. 여러 번 실행해도 안전합니다.
-- ============================================================

-- ① 계산서형태에 '미발행' 추가
--    옆커폰_관리지점처럼 지점 정산서를 취합해 보내느라 자체 발행을 하지 않는 곳
alter table partner."업체" drop constraint if exists "업체_계산서형태_check";
alter table partner."업체" add  constraint "업체_계산서형태_check"
  check ("계산서형태" in ('정발행', '역발행', '원천세', '미발행', '기타'));

-- ② 수정일시 트리거를 "수정할 때만" 으로 바꾼다.
--    이전 작업에서 시트의 원래 수정일시를 그대로 살려 넣기 위함.
--    (새로 넣는 행은 컬럼 기본값 now() 가 알아서 채운다)
drop trigger if exists "업체_수정일시" on partner."업체";
create trigger "업체_수정일시"
  before update on partner."업체"
  for each row execute function partner."수정일시_갱신"();
