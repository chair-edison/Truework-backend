# Truework backend

Hono API built from the supplied Truework backend requirements. Runtime: Node 20, Vercel Functions, Supabase Postgres/Auth/private Storage, OpenAI.

## Local setup

1. Install Node 20 and Docker Desktop. Run `npm ci`.
2. Start Supabase locally (`supabase start`) and apply `supabase/migrations/0001_core.sql` followed by `supabase/seed.sql` (`supabase db reset` uses the default seed file). The seed contains two [COLAB](https://colab.moha.gov.vn/) recruitment notices checked on 2026-09-29 and a VietnamWorks source registry entry. VietnamWorks has no seeded job because a current original listing was not verified. Closing timestamps stop expired notices from appearing. Recheck the original notices before any demo.
3. Copy `.env.example` to `.env` and set the local Supabase URL and service role key, OpenAI key, allowed frontend origins, and a random `CRON_SECRET`. Never expose the service role key to the frontend.
4. Run `npm run dev`, then `npm run build`, `npm test`, and `npm run smoke`. For authenticated smoke checks, set `SMOKE_TOKEN` to a Supabase user access token. API docs: `http://localhost:8787/api/v1/openapi.json`.

`POST /api/v1/uploads/job-checks` accepts the image bytes as the request body with a bearer token. It returns `upload_id`; use that ID in a `SCREENSHOT` check. `POST /api/v1/job-checks` accepts `{input_type,content}` for TEXT or URL, or `{input_type:"SCREENSHOT",upload_id}`. Supply a stable `Idempotency-Key` of 8–128 URL-safe characters. Poll `GET /api/v1/job-checks/{id}` after the returned interval. All check results require the same user's token.

## Verification policy

The server determines `OFFICIAL`, `VERIFIED_EMPLOYER`, `UNVERIFIED`, and `WARNING`. `WARNING` wins when a medium or high severity rule triggers. `OFFICIAL` requires an active official source, matching HTTPS domain, current source verification, and an active original listing. Jobs are downgraded in responses if source integrity no longer holds. The OpenAI model extracts structured fields and drafts an explanation; it never chooses the final status. Risk results link to individual evidence rows. Reports are immutable snapshots under policy version `1`.

The initial rule set is a transparent keyword and registry policy, not a fraud classifier. Fees and identity documents in legitimate official migration programmes may produce warnings; users should inspect the linked original notice. Unknown external matches remain `UNKNOWN` evidence. No scraped web result enters alternatives unless it is already a verified active job in the database.

## Operations and deployment sequence

1. Create separate Supabase projects for staging and production. Apply the migration, then review and apply the seed. Recheck source URLs and close or deactivate expired jobs. Create a Supabase Auth test user.
2. Connect this repository to Vercel. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`, and `CRON_SECRET` separately for Preview and Production. Set `ALLOWED_ORIGINS` to exact deployed frontend origins. The function duration is 60 seconds; move checks to a durable queue if real workloads exceed it.
3. Deploy staging, run `GET /health/live` and `GET /health/ready`, then `SMOKE_BASE_URL=<staging URL> SMOKE_TOKEN=<test token> npm run smoke`. Manually verify TEXT, URL, and SCREENSHOT checks, saved jobs, and alternatives against staging Supabase and OpenAI.
4. Deploy production only after staging checks pass. Retain the previous Vercel deployment for rollback. Roll back API deployment first if needed; make schema changes backward compatible and use a forward migration to undo data changes. Daily Vercel Cron deletes uploads after 24 hours and job check records after 30 days.

## Current verification boundary

Automated tests cover the policy, schema validation, provenance, basic error contract, and CORS. A live DB, Auth, Storage, OpenAI integration run requires project credentials. The local environment used for development did not have a running Docker daemon or Supabase credentials, so `supabase db reset` and the three live check journeys could not be completed here.
