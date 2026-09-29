import { describe, it, expect } from 'vitest';
import {
  assess,
  extractionSchema,
  fetchOffer,
  sanitizeDbText,
  sanitizeExtraction,
} from '../src/verify.js';
import { languages, parseLanguage } from '../src/language.js';
import { hostOf, matchesDomain, officialJob, safeJob } from '../src/core.js';

const x = {
  raw_text: 'Factory worker position. Duties include assembling parts and checking quality.',
  employer: 'Acme',
  job_title: 'Factory worker',
  location: 'Hanoi',
  salary: null,
  recruiter: 'Jane',
  contact_method: 'official website',
  recruitment_fee: null,
  job_duties: 'Assemble parts and check quality',
  employment_conditions: 'Full time',
  source_url: 'https://jobs.example.org/opening/1',
  country: 'VN',
  work_scope: 'DOMESTIC' as const,
};
const company = {
  name: 'Acme',
  official_domain: 'jobs.example.org',
  last_checked_at: '2026-01-01T00:00:00Z',
};
const source = {
  name: 'Example',
  official_domain: 'example.org',
  active: true,
  verification_level: 'OFFICIAL',
};
const original = { source_url: x.source_url };
describe('database-safe extraction', () => {
  it('removes NUL and replaces unpaired surrogates while preserving valid Unicode', () => {
    expect(sanitizeDbText('A\u0000B\ud800C\udc00😀한글')).toBe('AB�C�😀한글');
  });
  it('sanitizes every extracted string field before JSONB persistence', () => {
    const cleaned = sanitizeExtraction({ ...x, raw_text: 'OCR\u0000', employer: 'Acme\ud800' });
    expect(cleaned.raw_text).toBe('OCR');
    expect(cleaned.employer).toBe('Acme�');
    expect(cleaned.salary).toBeNull();
    expect(cleaned.work_scope).toBe('DOMESTIC');
  });
});
describe('domain and provenance', () => {
  it('matches only the same host or a real subdomain', () => {
    expect(matchesDomain(hostOf('https://jobs.example.org/a'), 'example.org')).toBe(true);
    expect(matchesDomain(hostOf('https://example.org.evil.test/a'), 'example.org')).toBe(false);
    expect(hostOf('http://example.org')).toBeNull();
  });
  it('downgrades stale or mismatched OFFICIAL records', () => {
    const j = { source_url: x.source_url, last_verified_at: '2026-02-01T00:00:00Z' };
    expect(officialJob(j, { ...source, last_checked_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(officialJob(j, { ...source, last_checked_at: '2026-03-01T00:00:00Z' })).toBe(false);
    expect(
      officialJob(j, {
        ...source,
        official_domain: 'evil.test',
        last_checked_at: '2026-01-01T00:00:00Z',
      }),
    ).toBe(false);
  });
  it('downgrades unsupported employer verification', () => {
    const j = {
      source_url: 'https://evil.test/job',
      last_verified_at: '2026-02-01T00:00:00Z',
      verification_status: 'VERIFIED_EMPLOYER',
      companies: company,
    };
    expect(safeJob(j).verification_status).toBe('UNVERIFIED');
  });
});
describe('verification policy', () => {
  it('defaults to English and rejects unsupported report languages', () => {
    expect(parseLanguage(undefined)).toBe('english');
    expect(parseLanguage('KOREAN')).toBe('korean');
    expect(() => parseLanguage('french')).toThrow();
  });
  it('localizes every human-readable risk and evidence field', () => {
    const offer = {
      ...x,
      raw_text:
        'Guaranteed high income. Pay a processing fee. Send passport copy. Act now. Contact Telegram. Travel first.',
      job_duties: null,
      recruiter: null,
      recruitment_fee: 'pay required',
    };
    for (const language of languages) {
      const result = assess(offer, { company: null, source: null, original: null }, language);
      expect(result.risks).toHaveLength(10);
      expect(result.summary).toBeTruthy();
      expect(result.evidence.every((item) => item.title && item.description)).toBe(true);
      expect(result.risks.every((item) => item.explanation)).toBe(true);
      expect(result.safety_guidance[0]).toBeTruthy();
      expect(result.disclaimer).toBeTruthy();
      if (language === 'english') {
        expect(result.summary).toBe('This offer has signals that need further checking.');
        expect(result.risks.every((item) => !/[가-힣]/.test(item.explanation))).toBe(true);
      }
      if (language === 'korean') expect(result.summary).toBe('확인이 필요한 위험 신호가 있습니다.');
      if (language === 'vietnamese')
        expect(result.summary).toBe('Có dấu hiệu rủi ro cần kiểm tra thêm.');
    }
  });
  it('does not let unknown low-severity signals override an official match', () => {
    const d = assess({ ...x, recruiter: null }, { company, source, original });
    expect(d.status).toBe('OFFICIAL');
    expect(d.risks.some((r) => r.risk_code === 'UNKNOWN_RECRUITER')).toBe(true);
  });
  it('produces linked evidence for each of the ten risk rules', () => {
    const y = {
      ...x,
      raw_text:
        'Guaranteed high income. Pay a processing fee. Send passport copy. Act now. Contact Telegram. Travel first.',
      job_duties: null,
      recruiter: null,
      recruitment_fee: 'pay required',
    };
    const d = assess(y, { company: null, source: null, original: null });
    expect(d.status).toBe('WARNING');
    expect(d.risks).toHaveLength(10);
    for (const r of d.risks)
      expect(r.evidence_ids.every((id) => d.evidence.some((e) => e.id === id))).toBe(true);
  });
  it('keeps insufficient evidence unverified', () => {
    const d = assess(x, { company: null, source: null, original: null });
    expect(d.status).toBe('UNVERIFIED');
  });
  it('validates extraction schema strictly', () => {
    expect(extractionSchema.safeParse({ ...x, extra: 'bad' }).success).toBe(false);
    expect(extractionSchema.safeParse(x).success).toBe(true);
  });
  it('rejects direct private URL targets', async () => {
    await expect(fetchOffer('https://127.0.0.1/latest/meta-data')).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
  });
});
