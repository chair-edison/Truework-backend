import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { app } from '../src/app.js';

const url = process.env.SUPABASE_URL,
  service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) throw Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, service, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket as any },
});
const email = `truework-test-${crypto.randomUUID()}@example.invalid`,
  password = crypto.randomUUID() + 'A1!';
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error || Error('Failed to create test user');
const userId = created.data.user.id;
let otherId: string | undefined;
let uploadId: string | undefined;
try {
  const login = createClient(url, service, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });
  const signed = await login.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error || Error('Sign in failed');
  const token = signed.data.session.access_token;
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  const list = await call('/api/v1/jobs?limit=5');
  assert.equal(list.status, 200);
  const jobs = (await list.json()) as any;
  assert.ok(jobs.items.length >= 2);
  const jobId = jobs.items[0].id;
  assert.equal(jobs.items[0].verification_status, 'OFFICIAL');
  const detail = await call(`/api/v1/jobs/${jobId}`);
  assert.equal(detail.status, 200);
  assert.equal(((await detail.json()) as any).job.source_url, jobs.items[0].source_url);
  for (let i = 0; i < 2; i++)
    assert.equal((await call(`/api/v1/jobs/${jobId}/save`, { method: 'POST' })).status, 200);
  const saved = await call('/api/v1/users/me/saved-jobs');
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as any).items.length, 1);
  const pref = await call('/api/v1/users/me/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      occupations: ['Nursing assistant'],
      locations: ['Germany'],
      work_scope: 'OVERSEAS',
    }),
  });
  assert.equal(pref.status, 200);
  const ranked = await call('/api/v1/jobs?sort=recommended');
  assert.equal(ranked.status, 200);
  assert.ok(((await ranked.json()) as any).items.length >= 2);
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  const upload = await call('/api/v1/uploads/job-checks', {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array(png),
  });
  assert.equal(upload.status, 201);
  uploadId = ((await upload.json()) as any).upload_id;
  assert.ok(uploadId);
  const check = await call('/api/v1/job-checks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'local-integration-test' },
    body: JSON.stringify({ input_type: 'SCREENSHOT', upload_id: uploadId }),
  });
  assert.equal(check.status, 202);
  const checkId = ((await check.json()) as any).check_id;
  const same = await call('/api/v1/job-checks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'local-integration-test' },
    body: JSON.stringify({ input_type: 'SCREENSHOT', upload_id: uploadId }),
  });
  assert.equal(((await same.json()) as any).check_id, checkId);
  const changed = await call('/api/v1/job-checks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'local-integration-test' },
    body: JSON.stringify({
      input_type: 'TEXT',
      content: 'Another offer with enough text to pass the minimum length.',
    }),
  });
  assert.equal(changed.status, 409);
  const ownership = await app.request(`/api/v1/job-checks/${checkId}`);
  assert.equal(ownership.status, 401);
  const otherEmail = `truework-test-${crypto.randomUUID()}@example.invalid`;
  const other = await admin.auth.admin.createUser({
    email: otherEmail,
    password,
    email_confirm: true,
  });
  if (other.error || !other.data.user) throw other.error || Error('Second user failed');
  otherId = other.data.user.id;
  const otherLogin = createClient(url, service, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });
  const otherSession = await otherLogin.auth.signInWithPassword({ email: otherEmail, password });
  if (otherSession.error || !otherSession.data.session)
    throw otherSession.error || Error('Second sign in failed');
  const blocked = await app.request(`/api/v1/job-checks/${checkId}`, {
    headers: { authorization: `Bearer ${otherSession.data.session.access_token}` },
  });
  assert.equal(blocked.status, 404);
  const state = await call(`/api/v1/job-checks/${checkId}`);
  assert.equal(state.status, 200);
  assert.ok(['QUEUED', 'EXTRACTING', 'FAILED'].includes(((await state.json()) as any).status));
  assert.equal((await call(`/api/v1/jobs/${jobId}/save`, { method: 'DELETE' })).status, 200);
  console.log(
    JSON.stringify({
      status: 'ok',
      jobs: jobs.items.length,
      auth: true,
      save: true,
      preferences: true,
      upload: true,
      idempotency: true,
    }),
  );
} finally {
  if (uploadId) await admin.storage.from('job-checks').remove([`${userId}/${uploadId}.jpg`]);
  if (otherId) await admin.auth.admin.deleteUser(otherId);
  await admin.auth.admin.deleteUser(userId);
}
