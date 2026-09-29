-- Verified against the linked original notices on 2026-09-29.
-- Closing times prevent expired recruitment from appearing in the API.
insert into public.sources(name,type,country,official_domain,verification_level,last_checked_at,active)
values
('Trung tâm Lao động ngoài nước (COLAB)','Government','VN','colab.moha.gov.vn','OFFICIAL',now(),true),
('VietnamWorks','Job board','VN','vietnamworks.com','VERIFIED',now(),true)
on conflict(official_domain) do update set name=excluded.name,type=excluded.type,
  verification_level=excluded.verification_level,last_checked_at=now(),active=true;

insert into public.jobs(title,company_name,location,country,work_scope,work_type,occupation,industry,
 salary_min,currency,description,requirements,source_id,source_url,retrieved_at,last_verified_at,
 verification_status,verification_summary,active,closes_at)
values
('Taiwan manufacturing operators and technicians — Nam Bo Hoa Thanh','Công ty HHCP Nam Bộ Hoá Thành',
 'Pingtung, Taiwan','TW','OVERSEAS','3-year contract','Factory worker','Manufacturing',29500,'TWD',
 'COLAB notice recruiting 10 workers. Operator and technician duties include machinery operation, quality checks and packaging. Read the original notice for fees, accommodation and application requirements.',
 '["Machinery operation or maintenance experience","Basic computer skills"]'::jsonb,
 (select id from public.sources where official_domain='colab.moha.gov.vn'),
 'https://colab.moha.gov.vn/tin-tuc/5689/Tuyen-chon-10-nguoi-lao-dong-di-lam-viec-tai-Dai-Loan-Cong-ty-HHCP-Nam-Bo-Hoa-Thanh.aspx',
 now(),now(),'OFFICIAL','Original recruitment notice published on the active COLAB government site.',true,'2026-09-30 16:59:00+00'),
('Germany nursing assistant programme — 2026 cohort 4','COLAB nursing assistant programme',
 'Germany','DE','OVERSEAS','Programme','Nursing assistant','Healthcare',3063.06,'EUR',
 'COLAB recruitment notice for 30–35 nursing assistant candidates. Online application closes 15 October 2026; supporting documents close 20 October 2026. Read the original notice for eligibility and administrative costs.',
 '["Nursing college or university degree","Nursing practice certificate"]'::jsonb,
 (select id from public.sources where official_domain='colab.moha.gov.vn'),
 'https://colab.moha.gov.vn/tin-tuc/5647/Tuyen-chon-nguoi-lao-dong-tham-gia-Chuong-trinh-Tro-ly-dieu-duong-CHLB-Duc-khoa-4-nam-2026.aspx',
 now(),now(),'OFFICIAL','Original recruitment notice published on the active COLAB government site.',true,'2026-10-20 16:59:00+00')
on conflict(source_url) do update set title=excluded.title,description=excluded.description,
  requirements=excluded.requirements,retrieved_at=now(),last_verified_at=now(),
  verification_status=excluded.verification_status,verification_summary=excluded.verification_summary,
  active=excluded.active,closes_at=excluded.closes_at;
