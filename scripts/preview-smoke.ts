import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { db } from '../src/core.js';
import { copy, type Language } from '../src/language.js';

const base = process.env.PREVIEW_URL?.replace(/\/$/, '');
if (!base) throw new Error('PREVIEW_URL is required');
const admin = db();
const email = `preview-${crypto.randomUUID()}@example.invalid`;
const password = crypto.randomUUID() + 'A1!';
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw new Error('Could not create test user');
const userId = created.data.user.id;
let uploadId: string | undefined;
const imagePath = '/private/tmp/truework-preview-check.png';
function call(
  path: string,
  token: string,
  method = 'GET',
  body?: string,
  image = false,
  idempotencyKey?: string,
): any {
  const args = [
    'curl',
    base + path,
    '--',
    '--silent',
    '--show-error',
    '--request',
    method,
    '--header',
    `Authorization: Bearer ${token}`,
    '--write-out',
    '\n__STATUS__:%{http_code}',
  ];
  if (idempotencyKey) args.push('--header', `Idempotency-Key: ${idempotencyKey}`);
  if (body)
    args.push(
      '--header',
      image ? 'Content-Type: image/png' : 'Content-Type: application/json',
      image ? '--data-binary' : '--data',
      body,
    );
  const output = execFileSync('vercel', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const match = output.match(/\n__STATUS__:(\d+)\s*$/);
  if (!match) throw new Error('Missing HTTP status');
  const status = Number(match[1]);
  const data = JSON.parse(output.slice(0, match.index));
  if (status >= 400) throw new Error(`${path}: HTTP ${status} ${data.error?.code || ''}`);
  return data;
}
async function waitFor(id: string, token: string) {
  for (let i = 0; i < 40; i++) {
    const result = call(`/api/v1/job-checks/${id}`, token);
    if (result.status === 'COMPLETED') return result;
    if (result.status === 'FAILED') throw new Error(`${id}: ${result.failure_code}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${id}: timeout`);
}
try {
  const signed = await db().auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error('Could not sign in test user');
  const token = signed.data.session.access_token;
  assert.equal(call('/health/live', token).status, 'ok');
  assert.equal(call('/health/ready', token).status, 'ready');
  assert.ok(call('/api/v1/openapi.json', token).openapi);
  const jobs = call('/api/v1/jobs?limit=5', token);
  assert.ok(jobs.items.length >= 2);
  const jobId = jobs.items[0].id;
  assert.equal(call(`/api/v1/jobs/${jobId}`, token).job.id, jobId);
  assert.equal(call(`/api/v1/jobs/${jobId}/save`, token, 'POST').saved, true);
  assert.equal(call('/api/v1/users/me/saved-jobs', token).items[0].job.id, jobId);
  assert.equal(call('/api/v1/users/me/preferences', token).preferences.work_scope, 'BOTH');
  assert.equal(
    call(
      '/api/v1/users/me/preferences',
      token,
      'PUT',
      JSON.stringify({
        occupations: ['Nursing assistant'],
        locations: ['Germany'],
        work_scope: 'OVERSEAS',
      }),
    ).preferences.work_scope,
    'OVERSEAS',
  );
  assert.ok(Array.isArray(call('/api/v1/jobs?sort=recommended', token).items));
  assert.equal(call(`/api/v1/jobs/${jobId}/save`, token, 'DELETE').saved, false);
  assert.equal(call('/api/v1/users/me/saved-jobs', token).items.length, 0);
  console.log(
    JSON.stringify({
      catalog: 'ok',
      saved_jobs: 'ok',
      preferences: 'ok',
      openapi: 'ok',
      health: 'ok',
    }),
  );
  const svg =
    '<svg width="800" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="30" y="80" font-size="30">Factory worker position</text><text x="30" y="140" font-size="25">Duties: assemble and inspect parts.</text><text x="30" y="200" font-size="25">Contact Telegram. Pay registration fee.</text></svg>';
  writeFileSync(imagePath, await sharp(Buffer.from(svg)).png().toBuffer());
  const uploaded = call('/api/v1/uploads/job-checks', token, 'POST', '@' + imagePath, true);
  uploadId = uploaded.upload_id;
  const cases = [
    {
      input_type: 'TEXT',
      content:
        'Factory worker position. Duties: assemble and inspect parts. Contact Telegram and pay a registration fee before applying.',
    },
    {
      input_type: 'TEXT',
      language: 'korean',
      content:
        'Factory worker position. Duties: assemble and inspect parts. Contact Telegram and pay a registration fee before applying.',
    },
    {
      input_type: 'TEXT',
      language: 'vietnamese',
      content:
        'Factory worker position. Duties: assemble and inspect parts. Contact Telegram and pay a registration fee before applying.',
    },
    { input_type: 'URL', content: 'https://example.com' },
    {
      input_type: 'URL',
      content:
        'https://colab.moha.gov.vn/tin-tuc/5647/Tuyen-chon-nguoi-lao-dong-tham-gia-Chuong-trinh-Tro-ly-dieu-duong-CHLB-Duc-khoa-4-nam-2026.aspx',
    },
    { input_type: 'SCREENSHOT', upload_id: uploadId },
  ];
  const failures: string[] = [];
  const idempotencyKey = `preview-${crypto.randomUUID()}`;
  assert.throws(
    () => call('/api/v1/job-checks?language=french', token, 'POST', JSON.stringify(cases[0])),
    /INVALID_INPUT/,
  );
  const selectedCases = process.env.SMOKE_SCREENSHOT_ONLY
    ? cases.filter((item) => item.input_type === 'SCREENSHOT')
    : process.env.SMOKE_LANG_ONLY
      ? cases.filter((item) => item.input_type === 'TEXT')
      : cases;
  for (const entry of selectedCases) {
    try {
      const language = ('language' in entry ? entry.language : undefined) as Language | undefined;
      const path = `/api/v1/job-checks${language ? `?language=${language}` : ''}`;
      const key = entry.input_type === 'TEXT' && !language ? idempotencyKey : undefined;
      const made = call(
        path,
        token,
        'POST',
        JSON.stringify({
          input_type: entry.input_type,
          content: 'content' in entry ? entry.content : undefined,
          upload_id: 'upload_id' in entry ? entry.upload_id : undefined,
        }),
        false,
        key,
      );
      assert.equal(made.language, language ?? 'english');
      if (key) {
        const repeated = call(
          path,
          token,
          'POST',
          JSON.stringify({ input_type: entry.input_type, content: entry.content }),
          false,
          idempotencyKey,
        );
        assert.equal(repeated.check_id, made.check_id);
        assert.throws(
          () =>
            call(
              '/api/v1/job-checks?language=korean',
              token,
              'POST',
              JSON.stringify({ input_type: entry.input_type, content: entry.content }),
              false,
              idempotencyKey,
            ),
          /IDEMPOTENCY_CONFLICT/,
        );
      }
      const done = await waitFor(made.check_id, token);
      assert.equal(done.language, language ?? 'english');
      assert.equal(
        done.verification.summary,
        copy[done.language as Language].summary[
          done.verification.status as keyof typeof copy.english.summary
        ],
      );
      assert.equal('raw_text' in done.extraction, false);
      if (language === 'korean') {
        assert.match(done.explanation, /[가-힣]/);
        assert.match(done.extraction.job_duties, /[가-힣]/);
      }
      if (language === 'vietnamese') {
        assert.match(done.explanation, /[À-ỹ]/);
        assert.match(done.extraction.job_duties, /[À-ỹ]/);
      }
      assert.ok(
        Array.isArray(call(`/api/v1/job-checks/${made.check_id}/alternatives`, token).items),
      );
      console.log(
        JSON.stringify({
          input_type: entry.input_type,
          language: done.language,
          source: entry.input_type === 'URL' ? entry.content : undefined,
          status: done.status,
          verification_status: done.verification?.status,
          evidence: done.verification?.evidence?.length,
        }),
      );
    } catch (error) {
      failures.push(`${entry.input_type}: ${String(error)}`);
      console.error(failures.at(-1));
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  if (uploadId) await admin.storage.from('job-checks').remove([`${userId}/${uploadId}.jpg`]);
  await admin.auth.admin.deleteUser(userId);
  try {
    unlinkSync(imagePath);
  } catch {}
}
