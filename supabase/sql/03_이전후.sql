-- ============================================================
-- 3단계 — CSV 임포트가 끝난 "직후" 한 번 실행
-- SQL Editor 에 붙여넣고 RUN.
-- ============================================================

-- ① id 시퀀스를 현재 최대값 뒤로 옮긴다.
--    CSV 로 id 를 직접 넣었기 때문에 이걸 안 하면
--    다음 신규 등록이 id=1 부터 시도해서 "중복 키" 오류가 난다.
select setval(
  pg_get_serial_sequence('partner."업체"', 'id'),
  coalesce((select max("id") from partner."업체"), 1)
);

-- ② 임포트 때문에 생긴 '신규등록' 로그를 지운다.
--    616건이 전부 이번 주 로그로 잡혀 변경로그 화면을 덮어버리기 때문.
--    작업자가 없는(아이디 NULL) 신규등록만 지우므로 사람이 남긴 기록은 안전하다.
delete from partner."변경로그"
where "작업" = '신규등록' and "아이디" is null and "이름" is null;

-- ③ 확인용 — 숫자를 눈으로 대조하세요
select '업체 전체'        as 항목, count(*)::text as 값 from partner."업체"
union all select '  자점(앱 미노출)', count(*)::text from partner."업체" where "업체구분" = '자점'
union all select '  판매점 거래중',   count(*)::text from partner."업체" where "업체구분" = '판매점' and "상태" = '활성'
union all select '  협력점 거래중',   count(*)::text from partner."업체" where "업체구분" = '협력점' and "상태" = '활성'
union all select '  휴면(미거래)',    count(*)::text from partner."업체" where "업체구분" <> '자점' and "상태" = '휴면'
union all select '사용자',            count(*)::text from partner."사용자"
union all select '변경로그(정리 후)', count(*)::text from partner."변경로그"
union all select '다음 신규 id',      (select last_value + 1 from partner."업체_id_seq")::text;
