import { describe, it, expect } from 'vitest';
import { normalizeUrl, getUrlParam } from '../src/lib/urlUtils';

describe('normalizeUrl', () => {
    it('strips volatile params from citytile URLs', () => {
        const raw = 'https://node.windy.com/citytile/v1.0/arome/9/258/186?hours=68&labelsVersion=v2.0&refTime=2026-05-30T15:00:00Z&step=1&pr=0&sc=425&token2=eyJhbG...&uid=abc123&v=50.0.3&poc=43';
        const normalized = normalizeUrl(raw);
        const parsed = new URL(normalized);

        // Must keep model params
        expect(parsed.pathname).toContain('arome/9/258/186');
        expect(parsed.searchParams.get('hours')).toBe('68');
        expect(parsed.searchParams.get('refTime')).toBe('2026-05-30T15:00:00Z');
        expect(parsed.searchParams.get('step')).toBe('1');

        // Must strip volatiles
        expect(parsed.searchParams.has('token2')).toBe(false);
        expect(parsed.searchParams.has('uid')).toBe(false);
        expect(parsed.searchParams.has('poc')).toBe(false);
        expect(parsed.searchParams.has('pr')).toBe(false);
        expect(parsed.searchParams.has('sc')).toBe(false);
        expect(parsed.searchParams.has('labelsVersion')).toBe(false);
        expect(parsed.searchParams.has('v')).toBe(false);
    });

    it('produces the same key for different volatile params', () => {
        const url1 = 'https://node.windy.com/citytile/v1.0/gfs/5/16/10?hours=51&refTime=2026-05-30T00:00:00Z&step=3&token2=AAA&uid=111&poc=1';
        const url2 = 'https://node.windy.com/citytile/v1.0/gfs/5/16/10?hours=51&refTime=2026-05-30T00:00:00Z&step=3&token2=BBB&uid=222&poc=99&pr=1&sc=500';

        expect(normalizeUrl(url1)).toBe(normalizeUrl(url2));
    });

    it('does not modify non-citytile URLs', () => {
        const url = 'https://node.windy.com/pois/v2/wind/tiles/9/256/184?pr=0&sc=424&token2=abc';
        expect(normalizeUrl(url)).toBe(url);
    });
});

describe('getUrlParam', () => {
    it('extracts a param from the URL', () => {
        const url = 'https://node.windy.com/citytile/v1.0/arome/9/258/186?hours=68&step=1';
        expect(getUrlParam(url, 'hours')).toBe('68');
        expect(getUrlParam(url, 'step')).toBe('1');
        expect(getUrlParam(url, 'nonexistent')).toBeNull();
    });
});
