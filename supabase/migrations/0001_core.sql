create extension if not exists pgcrypto;

create type public.work_scope as enum ('DOMESTIC','OVERSEAS','BOTH');
create type public.verification_status as enum ('OFFICIAL','VERIFIED_EMPLOYER','UNVERIFIED','WARNING');
create type public.check_input_type as enum ('SCREENSHOT','URL','TEXT');
create type public.check_status as enum ('QUEUED','EXTRACTING','VERIFYING','EXPLAINING','COMPLETED','FAILED');
create type public.evidence_kind as enum ('POSITIVE','NEGATIVE','UNKNOWN');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  occupations text[] not null default '{}', locations text[] not null default '{}',
  work_scope public.work_scope not null default 'BOTH', experience_level text,
  expected_salary_min numeric check (expected_salary_min >= 0),
  expected_salary_max numeric check (expected_salary_max >= expected_salary_min),
  currency char(3), updated_at timestamptz not null default now()
);
create table public.sources (
  id uuid primary key default gen_random_uuid(), name text not null, type text not null,
  country char(2) not null, official_domain text not null,
  verification_level text not null check (verification_level in ('OFFICIAL','VERIFIED')),
  last_checked_at timestamptz not null, active boolean not null default false,
  unique (official_domain)
);
create table public.companies (
  id uuid primary key default gen_random_uuid(), name text not null,
  normalized_name text not null, official_domain text,
  contact_info jsonb, verification_status text not null default 'UNVERIFIED',
  last_checked_at timestamptz
);
create index companies_normalized_name_idx on public.companies(normalized_name);
create table public.jobs (
  id uuid primary key default gen_random_uuid(), title text not null,
  company_id uuid references public.companies(id), company_name text not null,
  location text not null, country char(2) not null,
  work_scope public.work_scope not null check (work_scope <> 'BOTH'),
  work_type text, occupation text, industry text,
  salary_min numeric check (salary_min >= 0), salary_max numeric check (salary_max >= salary_min),
  currency char(3), description text not null, requirements jsonb not null default '[]',
  source_id uuid not null references public.sources(id), source_url text not null unique,
  closes_at timestamptz,
  published_at timestamptz, retrieved_at timestamptz not null default now(),
  verification_status public.verification_status not null default 'UNVERIFIED',
  verification_summary text not null, last_verified_at timestamptz not null default now(),
  active boolean not null default false,
  check ((salary_min is null and salary_max is null) or currency is not null),
  check (source_url ~* '^https://')
);
create index jobs_active_recent_idx on public.jobs(active,published_at desc,id);
create index jobs_filters_idx on public.jobs(country,work_scope,occupation,industry);
create index jobs_search_idx on public.jobs using gin (to_tsvector('simple', title || ' ' || company_name || ' ' || description));
create table public.saved_jobs (
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,job_id)
);
create table public.job_check_uploads (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  storage_key text not null unique, mime_type text not null, size_bytes integer not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  consumed_by uuid unique
);
create table public.job_checks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  input_type public.check_input_type not null, input_ref text not null,
  idempotency_key text, request_hash text not null, status public.check_status not null default 'QUEUED',
  extracted_data jsonb, verification_status public.verification_status,
  verification_summary text, explanation text, disclaimer text,
  safety_guidance jsonb not null default '[]', failure_code text,
  policy_version text, model_name text, prompt_version text, schema_version text,
  llm_usage jsonb, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), completed_at timestamptz,
  unique(user_id,idempotency_key)
);
alter table public.job_check_uploads add constraint uploads_consumed_fk
  foreign key(consumed_by) references public.job_checks(id);
create index job_checks_owner_idx on public.job_checks(user_id,created_at desc);
create table public.evidence (
  id uuid primary key default gen_random_uuid(), job_check_id uuid not null references public.job_checks(id) on delete cascade,
  kind public.evidence_kind not null, code text not null, title text not null,
  description text not null, source_name text, source_url text,
  checked_at timestamptz not null default now(), unique(job_check_id,code)
);
create table public.risk_indicator_definitions (
  code text primary key, title text not null, severity text not null
    check (severity in ('LOW','MEDIUM','HIGH')), explanation_template text not null,
  active boolean not null default true, rule_version text not null
);
create table public.job_check_risks (
  job_check_id uuid not null references public.job_checks(id) on delete cascade,
  risk_code text not null references public.risk_indicator_definitions(code),
  severity text not null, explanation text not null,
  evidence_ids uuid[] not null default '{}', triggered_at timestamptz not null default now(),
  primary key(job_check_id,risk_code)
);
create table public.check_audit (
  id bigint generated always as identity primary key,
  job_check_id uuid not null references public.job_checks(id) on delete cascade,
  event text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.api_rate_limits (
  identity text not null, window_start timestamptz not null,
  count integer not null default 1, primary key(identity,window_start)
);
create or replace function public.take_rate_limit(p_identity text, p_window timestamptz, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into api_rate_limits(identity,window_start,count) values(p_identity,p_window,1)
  on conflict(identity,window_start) do update set count=api_rate_limits.count+1
  returning count into n;
  return n <= p_limit;
end $$;
revoke all on function public.take_rate_limit(text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text,timestamptz,integer) to service_role;

create or replace function public.enforce_official_job() returns trigger language plpgsql as $$
declare s public.sources%rowtype; host text;
begin
  if new.verification_status <> 'OFFICIAL' then return new; end if;
  select * into s from public.sources where id=new.source_id;
  host := lower(split_part(split_part(new.source_url,'/',3),':',1));
  if not found or not s.active or s.verification_level <> 'OFFICIAL'
    or not (host = lower(s.official_domain) or host like '%.' || lower(s.official_domain))
    or new.last_verified_at < s.last_checked_at then
    raise exception 'OFFICIAL requires active matching source and current verification';
  end if;
  return new;
end $$;
create trigger jobs_official_guard before insert or update on public.jobs
for each row execute function public.enforce_official_job();

create or replace function public.new_user() returns trigger language plpgsql security definer
set search_path = public as $$ begin
  insert into public.users(id) values(new.id) on conflict do nothing;
  return new;
end $$;
create trigger auth_user_created after insert on auth.users for each row execute function public.new_user();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('job-checks','job-checks',false,4194304,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

alter table public.users enable row level security;
alter table public.user_preferences enable row level security;
alter table public.sources enable row level security;
alter table public.companies enable row level security;
alter table public.jobs enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.job_check_uploads enable row level security;
alter table public.job_checks enable row level security;
alter table public.evidence enable row level security;
alter table public.job_check_risks enable row level security;
alter table public.check_audit enable row level security;
alter table public.api_rate_limits enable row level security;
create policy own_user on public.users for select to authenticated using(id=auth.uid());
create policy own_preferences on public.user_preferences for all to authenticated
using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy read_sources on public.sources for select to authenticated using(active);
create policy read_companies on public.companies for select to authenticated using(true);
create policy read_jobs on public.jobs for select to authenticated using(active);
create policy own_saved on public.saved_jobs for all to authenticated
using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_checks on public.job_checks for select to authenticated using(user_id=auth.uid());
create policy own_uploads on public.job_check_uploads for select to authenticated using(user_id=auth.uid());
create policy own_evidence on public.evidence for select to authenticated using(
  exists(select 1 from public.job_checks c where c.id=job_check_id and c.user_id=auth.uid()));
create policy own_risks on public.job_check_risks for select to authenticated using(
  exists(select 1 from public.job_checks c where c.id=job_check_id and c.user_id=auth.uid()));

insert into public.risk_indicator_definitions(code,title,severity,explanation_template,rule_version) values
('UNKNOWN_EMPLOYER','Employer not verified','LOW','Employer identity could not be verified.','1'),
('UNKNOWN_RECRUITER','Recruiter not verified','LOW','Recruiter identity could not be verified.','1'),
('NO_ORIGINAL_SOURCE','Original listing not found','LOW','An original listing could not be matched.','1'),
('UNCLEAR_JOB_DUTIES','Unclear duties','MEDIUM','Job duties are unclear.','1'),
('UNUSUAL_SALARY_PROMISE','Unusual salary promise','MEDIUM','The salary promise needs independent confirmation.','1'),
('PAYMENT_REQUESTED','Payment requested','HIGH','The offer requests a fee or payment.','1'),
('DOCUMENT_REQUESTED_EARLY','Documents requested early','HIGH','Sensitive documents are requested before verification.','1'),
('URGENCY_PRESSURE','Urgent decision requested','MEDIUM','The offer pressures an immediate decision.','1'),
('PRIVATE_COMMUNICATION','Private channel requested','MEDIUM','The offer moves communication to a private channel.','1'),
('TRAVEL_BEFORE_VERIFICATION','Travel requested early','HIGH','Travel is requested before conditions are verified.','1');
