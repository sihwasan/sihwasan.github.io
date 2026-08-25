-- =====================================================================
--  41. 자기 교회 정보는 그 교회가 직접 고칠 수 있게
--
--  관내 교회의 주소·연락처·홈페이지는 그 교회가 가장 잘 압니다.
--  시찰장·서기가 일일이 받아 적지 않아도 되도록, 그 교회 소속
--  정회원이 자기 교회의 정보를 직접 고칠 수 있게 합니다.
--
--    · 자기 교회      → 담임목사·홈페이지·주소·연락처·비고를 고친다
--    · 남의 교회      → 보기만 한다
--    · 시찰장·서기    → 관내 모든 교회를 고치고, 교회를 더하고 지운다
--
--  다만 <교회 이름>과 <소속 시찰>은 명부의 뼈대이므로 시찰장·서기만
--  바꿀 수 있습니다. 그러지 않으면 자기 교회 이름을 남의 교회 이름으로
--  바꿔 그 줄을 차지할 수 있기 때문입니다.
--
--  실행 방법
--    Supabase 대시보드 → SQL Editor → New query →
--    이 파일 전체를 붙여넣고 Run 클릭
--
--  ※ 35_sichal.sql 을 먼저 실행하셔야 합니다.
--  ※ 여러 번 실행해도 안전합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 누가 무엇을 할 수 있는가
-- ---------------------------------------------------------------------
drop policy if exists sichal_churches_write  on public.sichal_churches;
drop policy if exists sichal_churches_insert on public.sichal_churches;
drop policy if exists sichal_churches_update on public.sichal_churches;
drop policy if exists sichal_churches_delete on public.sichal_churches;

-- 교회를 더하는 일 : 시찰장·서기
create policy sichal_churches_insert on public.sichal_churches for insert
  with check (public.is_sichal_officer(sichal));

-- 정보를 고치는 일 : 시찰장·서기, 또는 그 교회 소속 정회원
create policy sichal_churches_update on public.sichal_churches for update
  using (
    public.is_sichal_officer(sichal)
    or (public.is_member() and public.my_church() = name)
  )
  with check (
    public.is_sichal_officer(sichal)
    or (public.is_member() and public.my_church() = name)
  );

-- 교회를 목록에서 지우는 일 : 시찰장·서기
create policy sichal_churches_delete on public.sichal_churches for delete
  using (public.is_sichal_officer(sichal));


-- ---------------------------------------------------------------------
-- 2. 교회 이름과 소속 시찰은 시찰장·서기만 바꾼다
--    (자기 교회 이름을 남의 교회 이름으로 바꿔 그 줄을 차지하는 일을 막는다)
-- ---------------------------------------------------------------------
create or replace function public.lock_church_identity()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.name is distinct from old.name or new.sichal is distinct from old.sichal then
    if not (public.is_sichal_officer(old.sichal) and public.is_sichal_officer(new.sichal)) then
      raise exception '교회 이름과 소속 시찰은 시찰장·서기가 정합니다. 주소·연락처 등만 고쳐 주세요.';
    end if;
  end if;
  return new;
end
$fn$;

drop trigger if exists lock_church_identity_trg on public.sichal_churches;
create trigger lock_church_identity_trg
  before update on public.sichal_churches
  for each row execute function public.lock_church_identity();


-- ---------------------------------------------------------------------
-- 3. 확인
-- ---------------------------------------------------------------------
select polname as "정책", cmd as "무엇을"
  from (
    select p.polname,
           case p.polcmd when 'r' then 'select' when 'a' then 'insert'
                         when 'w' then 'update' when 'd' then 'delete'
                         else 'all' end as cmd
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
     where c.relname = 'sichal_churches'
  ) t
 order by cmd, polname;
