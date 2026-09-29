import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';
describe('public API', () => {
  it('returns liveness without credentials', async () => {
    const res = await app.request('/health/live');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]+$/);
  });
  it('returns a standard auth error on protected routes', async () => {
    const res = await app.request('/api/v1/users/me/preferences');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(body.error.request_id).toBeTruthy();
  });
  it('rejects unapproved CORS origins', async () => {
    const res = await app.request('/api/v1/jobs', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
