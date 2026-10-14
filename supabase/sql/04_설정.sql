-- ============================================================
-- 4단계 — Edge Function 이 쓰는 설정 저장소
-- SQL Editor 에 붙여넣고 RUN. (01~03 다음)
-- ------------------------------------------------------------
-- 토큰 서명키·비밀번호 해시키를 여기에 둡니다.
-- Edge Function 이 처음 실행될 때 "스스로 난수를 만들어" 넣으므로,
-- 그 값은 코드·채팅·깃허브 어디에도 남지 않습니다.
-- ============================================================

create table if not exists partner."설정" (
  "키"    text primary key,
  "값"    text not null,
  "생성일" timestamptz not null default now()
);

comment on table partner."설정" is
  '서버 전용 비밀값. Edge Function(service_role)만 접근한다. 절대 외부로 내보내지 말 것.';

alter table partner."설정" enable row level security;
