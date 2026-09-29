alter table public.job_checks add column language text;

-- Reports created before language selection used the original mixed-language format.
update public.job_checks set language = 'legacy';

alter table public.job_checks
  alter column language set default 'english',
  alter column language set not null,
  add constraint job_checks_language_check
    check (language in ('english', 'korean', 'vietnamese', 'legacy'));
