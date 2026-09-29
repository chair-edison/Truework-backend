import { Hono } from 'hono';
import {
  ApiError,
  assertDb,
  db,
  invalid,
  positiveInt,
  requireAuth,
  safeJob,
  uuid,
  type AppEnv,
} from './core.js';

export const jobs = new Hono<AppEnv>();
const fields = '*, sources!inner(*), companies(*)';
const filters = [
  'location',
  'country',
  'work_scope',
  'occupation',
  'work_type',
  'verification_status',
  'industry',
] as const;
jobs.get('/', async (c) => {
  const q = c.req.query(),
    limit = positiveInt(q.limit, 20, 50),
    page = positiveInt(q.page, 1, 10000);
  if (q.sort && !['relevance', 'newest', 'recommended'].includes(q.sort)) throw invalid('sort');
  const client = db();
  let query = client
    .from('jobs')
    .select(fields, { count: 'exact' })
    .eq('active', true)
    .eq('sources.active', true)
    .or(`closes_at.is.null,closes_at.gte.${new Date().toISOString()}`);
  if (q.sort === 'recommended')
    query = query.in('verification_status', ['OFFICIAL', 'VERIFIED_EMPLOYER']);
  for (const f of filters)
    if (q[f]) {
      if (q[f]!.length > 100) throw invalid(f);
      query =
        f === 'location' ? query.ilike(f, `%${q[f]!.replace(/[%_,]/g, '')}%`) : query.eq(f, q[f]);
    }
  if (q.source_type) query = query.eq('sources.type', q.source_type);
  if (q.q) {
    const term = q.q.trim().replace(/[%_,]/g, '').slice(0, 100);
    if (term)
      query = query.or(
        `title.ilike.%${term}%,company_name.ilike.%${term}%,occupation.ilike.%${term}%`,
      );
  }
  const ranked = q.sort === 'recommended' || q.sort === 'relevance';
  query = query
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(ranked ? 0 : (page - 1) * limit, ranked ? 499 : page * limit - 1);
  const { data, error, count } = await query;
  assertDb(error);
  let items = (data || [])
    .map(safeJob)
    .filter(
      (j) =>
        (!q.verification_status || j.verification_status === q.verification_status) &&
        (q.sort !== 'recommended' ||
          ['OFFICIAL', 'VERIFIED_EMPLOYER'].includes(j.verification_status)),
    );
  if (ranked) {
    let prefs: any = null;
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (token) {
      const user = await client.auth.getUser(token);
      if (user.data.user) {
        const p = await client
          .from('user_preferences')
          .select('*')
          .eq('user_id', user.data.user.id)
          .maybeSingle();
        prefs = p.data;
      }
    }
    const term = (q.q || '').toLowerCase();
    const score = (j: any) =>
      (term && j.title.toLowerCase().includes(term) ? 4 : 0) +
      (term && j.occupation?.toLowerCase().includes(term) ? 2 : 0) +
      (q.sort === 'recommended'
        ? (j.verification_status === 'OFFICIAL' ? 3 : 2) +
          (prefs?.occupations?.some((v: string) =>
            j.occupation?.toLowerCase().includes(v.toLowerCase()),
          )
            ? 3
            : 0) +
          (prefs?.locations?.some((v: string) => j.location.toLowerCase().includes(v.toLowerCase()))
            ? 2
            : 0) +
          (prefs?.work_scope === j.work_scope ? 1 : 0)
        : 0);
    items = items
      .sort(
        (a: any, b: any) =>
          score(b) - score(a) ||
          String(b.published_at || '').localeCompare(String(a.published_at || '')) ||
          a.id.localeCompare(b.id),
      )
      .slice((page - 1) * limit, page * limit);
  }
  const total = ranked ? Math.min(count || 0, 500) : count || 0;
  return c.json({
    items,
    page,
    limit,
    total,
    has_more: page * limit < total,
    result_cap: ranked ? 500 : null,
  });
});
jobs.get('/:id', async (c) => {
  const client = db();
  const id = uuid(c.req.param('id'));
  const { data, error } = await client
    .from('jobs')
    .select(fields)
    .eq('id', id)
    .eq('active', true)
    .or(`closes_at.is.null,closes_at.gte.${new Date().toISOString()}`)
    .maybeSingle();
  assertDb(error);
  if (!data || !data.sources?.active)
    throw new ApiError(404, 'NOT_FOUND', '공고를 찾을 수 없습니다.');
  let saved = false;
  const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (token) {
    const user = await client.auth.getUser(token);
    if (user.data.user) {
      const found = await client
        .from('saved_jobs')
        .select('job_id')
        .eq('job_id', id)
        .eq('user_id', user.data.user.id)
        .maybeSingle();
      saved = !!found.data;
    }
  }
  return c.json({ job: safeJob(data), saved });
});
jobs.post('/:id/save', requireAuth, async (c) => {
  await rate(c);
  const id = uuid(c.req.param('id') || ''),
    client = c.get('db');
  const found = await client
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle();
  assertDb(found.error);
  if (!found.data) throw new ApiError(404, 'NOT_FOUND', '공고를 찾을 수 없습니다.');
  const { error } = await client
    .from('saved_jobs')
    .upsert({ user_id: c.get('userId'), job_id: id }, { onConflict: 'user_id,job_id' });
  assertDb(error);
  return c.json({ saved: true });
});
jobs.delete('/:id/save', requireAuth, async (c) => {
  await rate(c);
  const { error } = await c
    .get('db')
    .from('saved_jobs')
    .delete()
    .eq('user_id', c.get('userId'))
    .eq('job_id', uuid(c.req.param('id') || ''));
  assertDb(error);
  return c.json({ saved: false });
});
async function rate(c: any) {
  const { rateLimit } = await import('./core.js');
  await rateLimit(c, 'saved');
}

export const users = new Hono<AppEnv>();
users.use('/*', requireAuth);
users.get('/me/saved-jobs', async (c) => {
  const limit = positiveInt(c.req.query('limit'), 20, 50),
    page = positiveInt(c.req.query('page'), 1, 10000);
  const { data, error, count } = await c
    .get('db')
    .from('saved_jobs')
    .select('created_at,jobs(*,sources(*),companies(*))', { count: 'exact' })
    .eq('user_id', c.get('userId'))
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  assertDb(error);
  return c.json({
    items: (data || [])
      .map((row: any) => ({ saved_at: row.created_at, job: row.jobs ? safeJob(row.jobs) : null }))
      .filter((x: any) => x.job?.active),
    page,
    limit,
    total: count || 0,
    has_more: page * limit < (count || 0),
  });
});
users.get('/me/preferences', async (c) => {
  const { data, error } = await c
    .get('db')
    .from('user_preferences')
    .select('*')
    .eq('user_id', c.get('userId'))
    .maybeSingle();
  assertDb(error);
  return c.json({
    preferences: data || {
      occupations: [],
      locations: [],
      work_scope: 'BOTH',
      experience_level: null,
      expected_salary_min: null,
      expected_salary_max: null,
      currency: null,
    },
  });
});
users.put('/me/preferences', async (c) => {
  await rate(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('body');
  const allowed = [
    'occupations',
    'locations',
    'work_scope',
    'experience_level',
    'expected_salary_min',
    'expected_salary_max',
    'currency',
  ];
  if (Object.keys(body).some((k) => !allowed.includes(k))) throw invalid('body');
  for (const k of ['occupations', 'locations'])
    if (
      body[k] !== undefined &&
      (!Array.isArray(body[k]) ||
        body[k].length > 20 ||
        body[k].some((x: any) => typeof x !== 'string' || x.length > 100))
    )
      throw invalid(k);
  if (body.work_scope && !['DOMESTIC', 'OVERSEAS', 'BOTH'].includes(body.work_scope))
    throw invalid('work_scope');
  for (const k of ['expected_salary_min', 'expected_salary_max'])
    if (body[k] != null && (typeof body[k] !== 'number' || body[k] < 0)) throw invalid(k);
  if (
    body.expected_salary_max != null &&
    body.expected_salary_min != null &&
    body.expected_salary_max < body.expected_salary_min
  )
    throw invalid('expected_salary_max');
  if (body.currency != null && !/^[A-Z]{3}$/.test(body.currency)) throw invalid('currency');
  const { data, error } = await c
    .get('db')
    .from('user_preferences')
    .upsert({ ...body, user_id: c.get('userId'), updated_at: new Date().toISOString() })
    .select()
    .single();
  assertDb(error);
  return c.json({ preferences: data });
});
