-- 132. 노회 주소록 (presbytery_directory)
--  회의자료 책자 끝의 주소록(원로목사·각 시찰 교회·각 연합회 임원)을 표로 두고,
--  새 책자가 올라오면 directory.html 의 「책자와 대조」로 달라진 것만 고친다.
--  열람: 정회원 이상 (is_member)  /  고치기: 관리자 (can_manage)
--  실행: Supabase SQL Editor 에 붙여 넣고 실행. (여러 번 실행해도 안전)

create table if not exists public.presbytery_directory (
  id          bigserial primary key,
  section     text not null,              -- 원로목사 / 북부시찰 / 상록시찰 / 남부시찰 / 장로회 연합회 / 남전도회 연합회 / 여전도회 연합회 / 주일학교 연합회 …
  kind        text not null default 'church' check (kind in ('church', 'person')),
  no          int,                        -- 책자의 NO
  name        text not null,              -- 교회명(church) / 성명(person)
  role        text,                       -- 직책 (person)
  church      text,                       -- 교회명 (person)
  postcode    text,
  address     text,
  address2    text,                       -- 지번·건물 (괄호 안)
  website     text,
  email       text,
  pastor      text,                       -- 교역자 ("⊙임동준 / (부) 김하진")
  elders      text,                       -- 시무장로 ("류춘수·김성훈")
  phone       text,                       -- "(교) 417-0264 / (휴) 010-3872-9919"
  sort        int not null default 0,
  source_report_id bigint references public.presbytery_reports(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists presbytery_directory_sec_idx on public.presbytery_directory (section, sort, no, id);

alter table public.presbytery_directory enable row level security;
drop policy if exists presbytery_directory_read  on public.presbytery_directory;
drop policy if exists presbytery_directory_write on public.presbytery_directory;
create policy presbytery_directory_read  on public.presbytery_directory for select using (public.is_member());
create policy presbytery_directory_write on public.presbytery_directory for all
  using (public.can_manage()) with check (public.can_manage());

-- 처음 한 번: 제20회 정기노회 회의자료(2026 가을) 주소록 102~112쪽
-- (이미 항목이 있으면 넣지 않는다)
insert into public.presbytery_directory (section, kind, no, name, role, church, postcode, address, address2, website, email, pastor, elders, phone, sort)
select * from (values
  ('원로목사', 'church', 1, '반월', null, null, '24766', '강원도 고성군 토성면 풍곡1길 136-31', null, null, null, '이세용', null, '(휴) 010-3703-5082', 1),
  ('원로목사', 'church', 2, '노진', null, null, '18283', '경기도 화성특례시 비봉면 새비봉서로 1길 14 비봉 펜테리움 301동 304호', null, null, null, '신동열', null, '(휴) 010-8915-1788', 2),
  ('원로목사', 'church', 3, '운평장로', null, null, '31724', '충남 당진시 송악읍 신복운로3길 28, 신복미소지움 105동 1201호', null, null, 'kch5276@hanmail.net', '김충현', null, '(휴) 010-3374-0835', 3),
  ('원로목사', 'church', 4, '새솔제일', null, null, '18244', '경기도 화성특례시 수노을2로 36. 202호', null, null, '4176250@hanmail.net', '김삼성', null, '(휴) 010-9907-6250', 4),
  ('북부시찰', 'church', 1, '목자', null, null, '15517', '안산시 상록구 석호로 223', '감골빌딩 4층', null, 'Khs3580@hanmail.net', '(임) 임동준', '류춘수·김성훈', '(교) 417-0264 / (휴) 010-3872-9919', 5),
  ('북부시찰', 'church', 2, '새날선교', null, null, '08333', '서울시 구로구 개봉로 48', '개봉동 403-68', null, 'tyro21@hanmail.net', '⊙송기태', '장경환', '(교) 070-8682-2690 / (휴) 010-2690-1702', 6),
  ('북부시찰', 'church', 3, '새누리', null, null, '15222', '안산시 단원구 북촌3길 9-1', '선부2동 1031-5', null, null, '⊙문광선', null, '(휴) 010-9946-5969', 7),
  ('북부시찰', 'church', 4, '새생명', null, null, '15208', '안산시 상록구 장하동 142-14', null, null, 'leesung8875@naver.com', '⊙이성대', null, '(휴) 010-3475-8875', 8),
  ('북부시찰', 'church', 5, '새힘', null, null, '14996', '시흥시 장현장곡로 30', '장현동 586-1', null, null, '⊙임동준', '김성조', '(휴) 010-3872-9919', 9),
  ('북부시찰', 'church', 6, '섬기는', null, null, '18244', '화성특례시 수노을2로 15', null, 'www.iserve.kr', 'kjsspc@hanmail.net', '⊙김종수 / (부) 김하진 / (부) 조남현', '윤성복·박홍규·황은수·윤여걸·고동욱·김동수·국중석', '(교) 356-6726 / (Fax) 356-6724 / (사) / (휴) 010-5201-0364', 10),
  ('북부시찰', 'church', 7, '섬김의', null, null, '15440', '안산시 단원구 광덕3로 29', '3층', null, 'ere1382b@hanmail.net', '⊙권병렬', '김영천·김완수', '(휴) 010-7763-0691', 11),
  ('북부시찰', 'church', 8, '수암새권능', null, null, '15202', '안산시 상록구 수암1길 44', '수암동 488-1', null, 'chr487@hanmail.net', '⊙박재완', '박아론', '(교) 487-5855 / (휴) 010-5751-5855', 12),
  ('북부시찰', 'church', 9, '시흥생수', null, null, '15071', '시흥시 군자로 492번길 7 아주@ 3차상가 202호', '거모동 1734-2', null, 'sasw60@hanmail.net', '⊙박흥열 / (부) 박상우', '유승렬', '(교) / (사) 494-4423 / (휴) 010-7238-8844', 13),
  ('북부시찰', 'church', 10, '시흥은혜', null, null, '14976', '시흥시 하중로 193 조은프라자 303호', null, null, null, '⊙김운갑', null, '(휴) 010-3217-7236', 14),
  ('북부시찰', 'church', 11, '안산샬롬', null, null, '15270', '안산시 단원구 와동로12, 3층', '와동 682-12', null, 'syhkhs@naver.com', '⊙송요한', null, '(휴) 010-9213-1517', 15),
  ('북부시찰', 'church', 12, '안산상록', null, null, '15441', '안산시 단원구 신촌5길 40', null, null, 'ljy9054@naver.com', '⊙이재용 / (부) 오윤석', '이재복', '(교) 480-5964 / (사) 439-4323 / (휴) 010-7331-5964', 16),
  ('북부시찰', 'church', 13, '안산원곡동', null, null, '15374', '안산시 단원구 화랑로 27', null, null, 'sinbora777@hanmail.net', '⊙김영돈', '장명국', '(휴) 010-8527-6174', 17),
  ('북부시찰', 'church', 14, '참된빛', null, null, '15582', '안산시 상록구 당골1길 5, 1층', null, null, 'ascer@daum.net', '⊙안상천', null, '(휴) 010-9294-0420', 18),
  ('북부시찰', 'church', 15, '예전', null, null, '16313', '수원시 장안구 정자동 79-18', '2층', null, null, '⊙제갈광철', null, '(교) 421-1925 / (휴) 010-2476-1925', 19),
  ('상록시찰', 'church', 1, '반월', null, null, '15252', '안산시 단원구 와동공원로3길 15', '와동 815-1', 'www.banwol.org', 'jisookim31@gmail.com', '⊙김지수 / (부) 박규태 / (부) 조능 / (부) 박희원', '김상진·권용문·김재호·김창룡·임병문·정재영·김해철·김상조·노종한·이영기·정응식·황순필', '(교) 486-6077~8,9 / 487-2827 / (Fax) 483-7127 / (사) 405-5082 / (휴) 010-8794-4163', 20),
  ('상록시찰', 'church', 2, '새솔제일', null, null, '18244', '화성특례시 수노을2로 36', '202호', null, '4176250@hanmail.net', '⊙손영득', '김영우', '(교) 501-1987 / (사) 417-6250 / (휴) 010-9104-6311', 21),
  ('상록시찰', 'church', 3, '서신영광', null, null, '18555', '화성특례시 서신면 효자각로 65-8', '매화리 93', null, 'gkdud1032@naver.com', '⊙주강완', null, '(교) 355-8253 / (사) 355-2421 / (휴) 010-6809-1032', 22),
  ('상록시찰', 'church', 4, '수암제일', null, null, '15202', '안산시 상록구 원당골5길 16-2', '수암동 484-1', null, 'tockdwh@naver.com', '⊙서용호', '이신영', '(교) 487-0365 / (휴) 010-3320-0363', 23),
  ('상록시찰', 'church', 5, '은광', null, null, '16377', '수원시 권선구 수인로621번길 40-19', '당수동 144-8', 'www.eklove.or.kr', 'ddong3477@naver.com', '⊙한동준', '김종선·윤위석·김득철', '(교) 419-4284 / (휴) 010-9760-9694', 24),
  ('상록시찰', 'church', 6, '힘찬', null, null, '15518', '안산시 상록구 매화로 28', '이동 569-1', null, 'qpsoo@hanmail.net', '⊙박양수', '최영석·김종서', '(사) 501-4591 / (휴) 010-6335-4591', 25),
  ('상록시찰', 'church', 7, '서안문호', null, null, '18251', '경기도 화성특례시 남양서 465번길 10', '문호리 682-3', null, null, '(임) 김종수', '송언빈', '(교) 356-5078 / (사) 402-5854', 26),
  ('상록시찰', 'church', 8, '주말씀', null, null, '15002', '경기도 시흥시 인선길 46 연성쉐르빌아파트 3층', null, null, 'biblcism.preacher@gmail.com', '⊙정주원', null, '(교) 435-8586 / 010-9944-7129', 27),
  ('남부시찰', 'church', 1, '나눔의', null, null, '18421', '화성특례시 효행로 1156번길 21 신미주아파트상가동 301호', '병점동 201-1', null, 'davidsmk@hanmail.net', '⊙김선민', null, '(교) 070-4240-9324 / (휴) 010-9039-5291', 28),
  ('남부시찰', 'church', 2, '노진', null, null, '18585', '화성특례시 장안면 화곡로 159-8', '노진2리 506-5', null, 'dynojin@hanmail.net', '(임) 김동석', '문명수', '(교) 351-1789 / (사) 351-3799 / (휴) 010-4032-2903', 29),
  ('남부시찰', 'church', 3, '동탄영광', null, null, '18392', '화성특례시 여울로120 3층', null, null, 'rafa0191@hanmail.net', '⊙이동진', null, '(휴) 010-2540-0533', 30),
  ('남부시찰', 'church', 4, '동탄인랜드', null, null, '18423', '화성특례시 동탄하나3길 5', null, null, 'paulchun60@gmail.com', '⊙전종호', null, '070-7797-0191 / (휴) 010-3451-0192', 31),
  ('남부시찰', 'church', 5, '반석', null, null, '18434', '화성특례시 동탄지성로 84 파크프라자 6층(전층)', null, null, 'mission-jp@hanmail.net', '⊙강명우', '안태성·김명관', '(교) 234-2731 / (Fax겸용) 613-9106 / (휴) 010-5773-0884', 32),
  ('남부시찰', 'church', 7, '성산', null, null, '15567', '안산시 상록구 샘골로 46', null, null, null, '⊙문태환', '김종군·백윤복', '(휴) 010-3704-0947', 33),
  ('남부시찰', 'church', 8, '아름다운숲', null, null, '18505', '화성특례시 동탄순환대로 127-9 우성애비뉴타워 1001호', null, null, 'paulj@daum.net', '⊙장정훈', null, '(휴) 010-7363-5935', 34),
  ('남부시찰', 'church', 9, '연수', null, null, '21926', '인천광역시 연수구 청능대로 75', null, null, null, '⊙김성신', '김종관', '(휴) 010-4549-0550', 35),
  ('남부시찰', 'church', 10, '운평장로', null, null, '18562', '화성특례시 우정읍 운평길 47', '운평리 411', null, 'kds08200820@naver.com', '⊙김동석', '신용화', '(사) 358-0835 / (당) 358-2903 / (Fax) 351-8012 / (휴) 010-4032-2903', 36),
  ('남부시찰', 'church', 11, '율리', null, null, '18569', '화성특례시 우정읍 배미길 87', '화산리 산112-6', null, 'gracepp@hanmail.net', '⊙박현정', null, '(교) 358-0224 / (Fax) 358-0248 / (휴) 010-2360-0077', 37),
  ('남부시찰', 'church', 12, '주품에', null, null, '18380', '화성특례시 영통로 26번길 24 반달마을푸르지오 305동 206호', null, null, null, '⊙유성준', null, '(휴) 010-2550-8399', 38),
  ('남부시찰', 'church', 13, '한숲우리', null, null, '17117', '용인시 처인구 남사읍 한숲로 45 한숲스퀘어 엘로우상가 B동 515호', '아곡리 694', null, '1026sjkim@hanmail.net', '⊙김성중', '허경하', '(교) 332-5004 / (휴) 010-2170-4070', 39),
  ('남부시찰', 'church', 14, '행복한', null, null, '18376', '화성특례시 영통로 27번길 53 210동 1701호', '신영동 현대타운', null, null, '⊙명영석', null, '(휴) 010-8008-7636', 40),
  ('남부시찰', 'church', 15, '경기은목', null, null, '15496', '경기도 안산시 상록구 삼태기1길 37, 301호', null, null, null, '(임) 강명우', null, '(휴) 010-5773-0884', 41),
  ('남부시찰', 'church', 16, '꿈꾸는작은(기)', null, null, '12664', '경기도 여주시 점동면 삼합리길 207', null, null, null, '⊙서기영', null, '(휴) 010-2772-9036', 42),
  ('장로회 연합회', 'person', null, '김준혁', '고문', '은광', null, null, null, null, null, null, null, '010-3733-3511', 43),
  ('장로회 연합회', 'person', null, '고석진', '고문', '목자', null, null, null, null, null, null, null, '010-5617-8820', 44),
  ('장로회 연합회', 'person', null, '박영수', '증경회장', '안산샬롬', null, null, null, null, null, null, null, '010-8598-1169', 45),
  ('장로회 연합회', 'person', null, '송영식', '증경회장', '반월', null, null, null, null, null, null, null, '010-2978-8945', 46),
  ('장로회 연합회', 'person', null, '김재열', '증경회장', '섬기는', null, null, null, null, null, null, null, '010-4738-1234', 47),
  ('장로회 연합회', 'person', null, '임선규', '증경회장', '은광', null, null, null, null, null, null, null, '010-9640-0691', 48),
  ('장로회 연합회', 'person', null, '윤위석', '증경회장', '은광', null, null, null, null, null, null, null, '010-7107-9324', 49),
  ('장로회 연합회', 'person', null, '정재영', '증경회장', '반월', null, null, null, null, null, null, null, '010-3789-9045', 50),
  ('장로회 연합회', 'person', null, '이시우', '증경회장', '은광', null, null, null, null, null, null, null, '010-5318-2912', 51),
  ('장로회 연합회', 'person', null, '김창룡', '증경회장', '반월', null, null, null, null, null, null, null, '010-6288-4226', 52),
  ('장로회 연합회', 'person', null, '윤성복', '명예회장', '섬기는', null, null, null, null, null, null, null, '010-9064-6470', 53),
  ('장로회 연합회', 'person', null, '이신영', '회장', '수암제일', null, null, null, null, null, null, null, '010-5092-9187', 54),
  ('장로회 연합회', 'person', null, '고동욱', '부회장', '섬기는', null, null, null, null, null, null, null, '010-8717-0877', 55),
  ('장로회 연합회', 'person', null, '김득철', '부회장', '은광', null, null, null, null, null, null, null, '010-8782-3062', 56),
  ('장로회 연합회', 'person', null, '백윤복', '부회장', '성산', null, null, null, null, null, null, null, '010-8276-9497', 57),
  ('장로회 연합회', 'person', null, '김성훈', '총무', '목자', null, null, null, null, null, null, null, '010-2601-9892', 58),
  ('장로회 연합회', 'person', null, '김영천', '부총무', '섬김의', null, null, null, null, null, null, null, '010-3361-7267', 59),
  ('장로회 연합회', 'person', null, '윤여걸', '부총무', '섬기는', null, null, null, null, null, null, null, '010-5359-8998', 60),
  ('장로회 연합회', 'person', null, '임병문', '부총무', '반월', null, null, null, null, null, null, null, '010-3307-3728', 61),
  ('장로회 연합회', 'person', null, '류춘수', '서기', '목자', null, null, null, null, null, null, null, '010-9345-7893', 62),
  ('장로회 연합회', 'person', null, '김종선', '부서기', '은광', null, null, null, null, null, null, null, '010-3256-6776', 63),
  ('장로회 연합회', 'person', null, '김성조', '부서기', '새힘', null, null, null, null, null, null, null, '010-2260-9068', 64),
  ('장로회 연합회', 'person', null, '김완수', '부서기', '섬김의', null, null, null, null, null, null, null, '010-3686-4328', 65),
  ('장로회 연합회', 'person', null, '박홍규', '회의록서기', '섬기는', null, null, null, null, null, null, null, '010-9261-5869', 66),
  ('장로회 연합회', 'person', null, '이재복', '부회의록서기', '안산상록', null, null, null, null, null, null, null, '010-7194-0297', 67),
  ('장로회 연합회', 'person', null, '김종서', '부회의록서기', '힘찬', null, null, null, null, null, null, null, '010-2305-6570', 68),
  ('장로회 연합회', 'person', null, '박아론', '부회의록서기', '수암새권능', null, null, null, null, null, null, null, '010-7686-5055', 69),
  ('장로회 연합회', 'person', null, '김해철', '회계', '반월', null, null, null, null, null, null, null, '010-7657-5660', 70),
  ('장로회 연합회', 'person', null, '김영우', '부회계', '새솔제일', null, null, null, null, null, null, null, '010-9265-1172', 71),
  ('장로회 연합회', 'person', null, '유승열', '부회계', '시흥생수', null, null, null, null, null, null, null, '010-2595-1657', 72),
  ('장로회 연합회', 'person', null, '김동수', '감사', '섬기는', null, null, null, null, null, null, null, '010-5339-1851', 73),
  ('장로회 연합회', 'person', null, '송언빈', '감사', '서안문호', null, null, null, null, null, null, null, '010-5271-2424', 74),
  ('남전도회 연합회', 'person', null, '고석진 장로', '증경회장', '목자', null, null, null, null, null, null, null, '010-5617-8820', 75),
  ('남전도회 연합회', 'person', null, '박영수 장로', '증경회장', '안산샬롬', null, null, null, null, null, null, null, '010-8598-1169', 76),
  ('남전도회 연합회', 'person', null, '김재열 장로', '증경회장', '섬기는', null, null, null, null, null, null, null, '010-4738-1234', 77),
  ('남전도회 연합회', 'person', null, '김병직 장로', '증경회장', '반월', null, null, null, null, null, null, null, '010-5608-9993', 78),
  ('남전도회 연합회', 'person', null, '최경섭 장로', '증경회장', '은광', null, null, null, null, null, null, null, '010-6264-0898', 79),
  ('남전도회 연합회', 'person', null, '김창룡 장로', '증경회장', '반월', null, null, null, null, null, null, null, '010-6288-4226', 80),
  ('남전도회 연합회', 'person', null, '장세경 장로', '증경회장', '반석', null, null, null, null, null, null, null, '010-8788-2645', 81),
  ('남전도회 연합회', 'person', null, '정재영 장로', '명예회장', '반월', null, null, null, null, null, null, null, '010-3789-9049', 82),
  ('남전도회 연합회', 'person', null, '백윤복 장로', '회장', '성산', null, null, null, null, null, null, null, '010-8276-9497', 83),
  ('남전도회 연합회', 'person', null, '윤위석 장로', '부회장', '은광', null, null, null, null, null, null, null, '010-7107-9324', 84),
  ('남전도회 연합회', 'person', null, '임정택 장로', '부회장', '발안제일', null, null, null, null, null, null, null, '010-7112-9066', 85),
  ('남전도회 연합회', 'person', null, '신용화 장로', '부회장', '운평장로', null, null, null, null, null, null, null, '010-8234-7799', 86),
  ('남전도회 연합회', 'person', null, '이신영 장로', '부회장', '수암제일', null, null, null, null, null, null, null, '010-5092-9187', 87),
  ('남전도회 연합회', 'person', null, '고동욱 장로', '총무', '섬기는', null, null, null, null, null, null, null, '010-8717-0877', 88),
  ('남전도회 연합회', 'person', null, '김정곤 집사', '부총무', '은광', null, null, null, null, null, null, null, '010-2208-1482', 89),
  ('남전도회 연합회', 'person', null, '류건욱 집사', '부총무', '목자', null, null, null, null, null, null, null, '010-3396-3053', 90),
  ('남전도회 연합회', 'person', null, '이원민 집사', '부총무', '은광', null, null, null, null, null, null, null, '010-6216-9205', 91),
  ('남전도회 연합회', 'person', null, '류춘수 장로', '서기', '목자', null, null, null, null, null, null, null, '010-9345-7893', 92),
  ('남전도회 연합회', 'person', null, '유경종 집사', '부서기', '반월', null, null, null, null, null, null, null, '010-7759-2815', 93),
  ('남전도회 연합회', 'person', null, '나관주 집사', '회록서기', '성산', null, null, null, null, null, null, null, '010-8265-1927', 94),
  ('남전도회 연합회', 'person', null, '정응식 집사', '부회록서기', '반월', null, null, null, null, null, null, null, '010-3714-0100', 95),
  ('남전도회 연합회', 'person', null, '신경원 집사', '회계', '목자', null, null, null, null, null, null, null, '010-3797-6082', 96),
  ('남전도회 연합회', 'person', null, '김명관 집사', '부회계', '반석', null, null, null, null, null, null, null, '010-8949-9344', 97),
  ('남전도회 연합회', 'person', null, '김종군 장로', '감사', '성산', null, null, null, null, null, null, null, '010-5281-9395', 98),
  ('남전도회 연합회', 'person', null, '김상조 집사', '감사', '반월', null, null, null, null, null, null, null, '010-4163-8248', 99),
  ('남전도회 연합회', 'person', null, '김종서 장로', '감사', '힘찬', null, null, null, null, null, null, null, '010-2305-6570', 100),
  ('여전도회 연합회', 'person', null, '양효정 권사', '회장', '반월', null, null, null, null, null, null, null, '010-2773-5726', 101),
  ('여전도회 연합회', 'person', null, '김연옥 권사', '부회장', '성산', null, null, null, null, null, null, null, '010-2317-9394', 102),
  ('여전도회 연합회', 'person', null, '차영선 권사', '총무', '운평장로', null, null, null, null, null, null, null, '010-3940-7799', 103),
  ('여전도회 연합회', 'person', null, '유인숙 권사', '회계', '새솔제일', null, null, null, null, null, null, null, '010-8996-6169', 104),
  ('여전도회 연합회', 'person', null, '하경순 권사', '서기', '운평장로', null, null, null, null, null, null, null, '010-5688-0765', 105),
  ('여전도회 연합회', 'person', null, '신영희 집사', '회의록서기', '성산', null, null, null, null, null, null, null, '010-8287-7659', 106),
  ('여전도회 연합회', 'person', null, '곽정옥 집사', '감사', '성산', null, null, null, null, null, null, null, '010-8438-2570', 107),
  ('주일학교 연합회', 'person', null, '고석진 장로', '증경회장', '목자', null, null, null, null, null, null, null, '010-5617-8820', 108),
  ('주일학교 연합회', 'person', null, '박영수 장로', '증경회장', '안산샬롬', null, null, null, null, null, null, null, '010-8598-1169', 109),
  ('주일학교 연합회', 'person', null, '김재열 장로', '증경회장', '섬기는', null, null, null, null, null, null, null, '010-4738-1234', 110),
  ('주일학교 연합회', 'person', null, '김병직 장로', '증경회장', '반월', null, null, null, null, null, null, null, '010-5608-9993', 111),
  ('주일학교 연합회', 'person', null, '임정택 장로', '증경회장', '발안제일', null, null, null, null, null, null, null, '010-7112-9066', 112),
  ('주일학교 연합회', 'person', null, '장세경 장로', '명예회장', '반석', null, null, null, null, null, null, null, '010-8788-2645', 113),
  ('주일학교 연합회', 'person', null, '윤위석 장로', '회장', '은광', null, null, null, null, null, null, null, '010-7107-9324', 114),
  ('주일학교 연합회', 'person', null, '이신영 장로', '부회장', '수암제일', null, null, null, null, null, null, null, '010-5092-9187', 115),
  ('주일학교 연합회', 'person', null, '백윤복 장로', '부회장', '성산', null, null, null, null, null, null, null, '010-8276-9497', 116),
  ('주일학교 연합회', 'person', null, '윤성복 장로', '부회장', '섬기는', null, null, null, null, null, null, null, '010-9064-6470', 117),
  ('주일학교 연합회', 'person', null, '한상권 집사', '총무', '은광', null, null, null, null, null, null, null, '010-9989-0836', 118),
  ('주일학교 연합회', 'person', null, '임철규 집사', '부총무', '시흥생수', null, null, null, null, null, null, null, '010-2718-9435', 119),
  ('주일학교 연합회', 'person', null, '류춘수 장로', '서기', '목자', null, null, null, null, null, null, null, '010-9435-7893', 120),
  ('주일학교 연합회', 'person', null, '김득철 장로', '부서기', '은광', null, null, null, null, null, null, null, '010-8782-3062', 121),
  ('주일학교 연합회', 'person', null, '김문수 집사', '회록서기', '반월', null, null, null, null, null, null, null, null, 122),
  ('주일학교 연합회', 'person', null, '유영지 집사', '부회록서기', '발안제일', null, null, null, null, null, null, null, '010-9774-4869', 123),
  ('주일학교 연합회', 'person', null, '신은화 집사', '회계', '목자', null, null, null, null, null, null, null, '010-4394-7578', 124),
  ('주일학교 연합회', 'person', null, '박우경 집사', '부회계', '은광', null, null, null, null, null, null, null, '010-4518-2985', 125),
  ('주일학교 연합회', 'person', null, '신용화 장로', '감사', '운평장로', null, null, null, null, null, null, null, '010-8234-7799', 126),
  ('주일학교 연합회', 'person', null, '송언빈 장로', '감사', '서안문호', null, null, null, null, null, null, null, '010-7321-3379', 127),
  ('주일학교 연합회', 'person', null, '고동욱 장로', '감사', '섬기는', null, null, null, null, null, null, null, '010-8717-0877', 128)
) as v(section, kind, no, name, role, church, postcode, address, address2, website, email, pastor, elders, phone, sort)
where not exists (select 1 from public.presbytery_directory limit 1);
update public.presbytery_directory set source_report_id = (select id from public.presbytery_reports where session = 20 order by id limit 1), updated_by = '제20회 회의자료'
 where source_report_id is null;

-- 제20회 정기노회(2026-10-12) 청빙 결의 반영: 책자 인쇄 뒤 담임(시무목사)이 바뀐 세 교회
-- (위임식 전까지는 시무목사. 바뀐 뒤에는 「책자와 대조」로 다음 책자와 맞춘다)
update public.presbytery_directory set pastor = '⊙송지용', updated_by = '제20회 청빙 결의' where section = '북부시찰' and name = '목자'   and pastor like '(임)%';
update public.presbytery_directory set pastor = '⊙손병민', updated_by = '제20회 청빙 결의' where section = '남부시찰' and name = '노진'   and pastor like '(임)%';
update public.presbytery_directory set pastor = '⊙김영창', updated_by = '제20회 청빙 결의' where section = '남부시찰' and name = '경기은목' and pastor like '(임)%';
