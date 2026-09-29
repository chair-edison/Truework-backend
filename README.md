# Truework backend

Hono API built from the supplied Truework backend requirements. Local runtime: Node 20; the staging Vercel project uses Node 24. Services: Vercel Functions, Supabase Postgres/Auth/private Storage, OpenAI.

## Local setup

1. Install Node 20 and Docker Desktop. Run `npm ci`.
2. Start Supabase locally (`supabase start`) and apply the migrations in `supabase/migrations/` followed by `supabase/seed.sql` (`supabase db reset` uses the default seed file). The seed contains two [COLAB](https://colab.moha.gov.vn/) recruitment notices checked on 2026-09-29 and a VietnamWorks source registry entry. VietnamWorks has no seeded job because a current original listing was not verified. Closing timestamps stop expired notices from appearing. Recheck the original notices before any demo.
3. Copy `.env.example` to `.env` and set the local Supabase URL and service role key, OpenAI key, allowed frontend origins, and a random `CRON_SECRET`. Never expose the service role key to the frontend.
4. Run `npm run dev`, then `npm run build`, `npm test`, and `npm run smoke`. For authenticated smoke checks, set `SMOKE_TOKEN` to a Supabase user access token. API docs: `http://localhost:8787/api/v1/openapi.json`.

Run `npm run format` to apply Prettier to TypeScript and project JSON files, or `npm run format:check` to verify formatting without changing files.

`POST /api/v1/uploads/job-checks` accepts up to 4MB of image bytes as the request body with a bearer token. The limit fits [Vercel's 4.5MB function request limit](https://vercel.com/docs/functions/limitations). It returns `upload_id`; use that ID in a `SCREENSHOT` check. `POST /api/v1/job-checks` accepts `{input_type,content}` for TEXT or URL, or `{input_type:"SCREENSHOT",upload_id}`. Supply a stable `Idempotency-Key` of 8–128 URL-safe characters. Poll `GET /api/v1/job-checks/{id}` after the returned interval. All check results require the same user's token.

Add `?language=english|korean|vietnamese` to `POST /api/v1/job-checks` to choose the report language; it defaults to `english`. The choice is stored with the check, so polling needs no language parameter. A reused idempotency key with a different language returns `IDEMPOTENCY_CONFLICT`. Human-readable report fields use the selected language; machine-readable codes, URLs, proper names, and country codes remain unchanged. Original `raw_text` stays in the private record for evidence and is omitted from the report response. Reports created before this feature are marked `legacy` and retain their original wording.

## Verification policy

The server determines `OFFICIAL`, `VERIFIED_EMPLOYER`, `UNVERIFIED`, and `WARNING`. `WARNING` wins when a medium or high severity rule triggers. `OFFICIAL` requires an active official source, matching HTTPS domain, current source verification, and an active original listing. Jobs are downgraded in responses if source integrity no longer holds. The OpenAI model extracts structured fields and drafts an explanation; it never chooses the final status. Risk results link to individual evidence rows. Reports are immutable snapshots under policy version `1`.

The initial rule set is a transparent keyword and registry policy, not a fraud classifier. Fees and identity documents in legitimate official migration programmes may produce warnings; users should inspect the linked original notice. Unknown external matches remain `UNKNOWN` evidence. No scraped web result enters alternatives unless it is already a verified active job in the database.

## Operations and deployment sequence

1. Create separate Supabase projects for staging and production. Apply the migration, then review and apply the seed. Recheck source URLs and close or deactivate expired jobs. Create a Supabase Auth test user.
2. Connect this repository to Vercel. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`, and `CRON_SECRET` separately for Preview and Production. Set `ALLOWED_ORIGINS` to exact deployed frontend origins. The function duration is 60 seconds; move checks to a durable queue if real workloads exceed it.
3. Deploy Preview with `vercel deploy --target preview --yes`. Check `GET /health/live` and `GET /health/ready` using `vercel curl` when Vercel Authentication protects Preview. Run `SMOKE_BASE_URL=<preview URL> SMOKE_TOKEN=<test token> npm run smoke`. To verify actual OpenAI extraction for TEXT, URL, and SCREENSHOT, set `PREVIEW_URL=<preview URL>` and run `node --env-file=.env.staging.local --import tsx scripts/preview-smoke.ts`. The script creates and deletes a temporary Supabase Auth user and upload; `.env.staging.local` must contain the staging Supabase URL and service role key. Check saved jobs and alternatives against staging Supabase.
4. Deploy production only after staging checks pass. Retain the previous Vercel deployment for rollback. Roll back API deployment first if needed; make schema changes backward compatible and use a forward migration to undo data changes. Daily Vercel Cron deletes uploads after 24 hours and job check records after 30 days.

## Current verification boundary

Automated tests cover the policy, schema validation, provenance, basic error contract, CORS, and private URL rejection. Local Supabase migration/seed plus DB, Auth, Storage, ownership, and idempotency integration checks passed. The protected Vercel Preview passed live and ready health checks, job listing, and authenticated TEXT, URL (including a COLAB notice), and SCREENSHOT extraction with OpenAI. The temporary test user and upload were removed after the run. The integration test also confirmed the safe failure path when the model is unavailable.
