alter table public.church_staff add column if not exists honored_on date;
comment on column public.church_staff.honored_on is '원로장로 추대일';
