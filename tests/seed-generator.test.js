import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  generateImage,
  buildPromptFromCard,
  regenerateSeedCard,
  BASE_PROMPT,
} from '../netlify/functions/lib/seed-generator.js';

// Helper para construir el chain mock estilo Supabase: db.from('cards').select(...).eq(...).maybeSingle()
function buildDbMock({ card, fetchErr, uploadErr, updateErr, publicUrl = 'https://mock.supabase.co/storage/v1/object/public/Avatars/seeds/x.jpg' }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: card, error: fetchErr || null });
  const eqSelect = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqSelect }));

  const eqUpdate = vi.fn().mockResolvedValue({ error: updateErr || null });
  const update = vi.fn(() => ({ eq: eqUpdate }));

  const uploadFn = vi.fn().mockResolvedValue({ error: uploadErr || null });
  const getPublicUrl = vi.fn(() => ({ data: { publicUrl } }));

  const storageFrom = vi.fn(() => ({ upload: uploadFn, getPublicUrl }));

  const fromImpl = vi.fn((table) => {
    if (table === 'cards') return { select, update };
    return {};
  });

  return {
    db: { from: fromImpl, storage: { from: storageFrom } },
    spies: { maybeSingle, eqSelect, select, eqUpdate, update, uploadFn, getPublicUrl, storageFrom, from: fromImpl },
  };
}

function geminiOk({ mimeType = 'image/png', data = 'AAAA' } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
    }),
  };
}

describe('seed-generator', () => {
  describe('generateImage', () => {
    it('devuelve buffer y mimeType cuando Gemini contesta con imagen', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(geminiOk({ data: 'AAAA' }));
      const out = await generateImage('mujer albañil', { fetch: fetchMock, apiKey: 'k' });
      expect(out.buffer).toBeInstanceOf(Buffer);
      expect(out.buffer.length).toBe(3); // 'AAAA' base64 = 3 bytes
      expect(out.mimeType).toBe('image/png');
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('gemini-2.5-flash-image');
      expect(url).toContain('key=k');
      expect(JSON.parse(opts.body).contents[0].parts[0].text).toBe('mujer albañil');
    });

    it('lanza no_api_key si falta la clave', async () => {
      await expect(generateImage('x', { fetch: vi.fn(), apiKey: '' })).rejects.toThrow('no_api_key');
    });

    it('lanza empty_prompt si el prompt está vacío', async () => {
      await expect(generateImage('   ', { fetch: vi.fn(), apiKey: 'k' })).rejects.toThrow('empty_prompt');
    });

    it('lanza gemini_http_429 con detalle si Gemini devuelve error HTTP', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'quota exceeded' } }),
      });
      await expect(generateImage('x', { fetch: fetchMock, apiKey: 'k' }))
        .rejects.toThrow('gemini_http_429: quota exceeded');
    });

    it('lanza no_image_returned si Gemini contesta solo texto', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'no puedo' }] } }] }),
      });
      await expect(generateImage('x', { fetch: fetchMock, apiKey: 'k' }))
        .rejects.toThrow(/no_image_returned/);
    });

    it('lanza network_error cuando fetch rechaza', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(generateImage('x', { fetch: fetchMock, apiKey: 'k' }))
        .rejects.toThrow(/network_error/);
    });

    it('lanza invalid_gemini_response si el JSON no parsea', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new Error('boom'); },
      });
      await expect(generateImage('x', { fetch: fetchMock, apiKey: 'k' }))
        .rejects.toThrow('invalid_gemini_response');
    });
  });

  describe('buildPromptFromCard', () => {
    it('usa profession_label si existe', () => {
      expect(buildPromptFromCard({ profession_label: 'electricista' }))
        .toBe(`${BASE_PROMPT} A electricista at work.`);
    });

    it('cae a tagline si no hay profession_label', () => {
      expect(buildPromptFromCard({ tagline: 'fontanero' }))
        .toBe(`${BASE_PROMPT} A fontanero at work.`);
    });

    it('cae a "professional" sin datos', () => {
      expect(buildPromptFromCard({}))
        .toBe(`${BASE_PROMPT} A professional at work.`);
    });
  });

  describe('regenerateSeedCard', () => {
    let fetchMock;
    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(geminiOk());
    });

    it('lanza missing_slug si no se pasa slug', async () => {
      const { db } = buildDbMock({ card: null });
      await expect(regenerateSeedCard(db, '', { apiKey: 'k', fetch: fetchMock }))
        .rejects.toThrow('missing_slug');
    });

    it('lanza card_not_found si el slug no existe', async () => {
      const { db } = buildDbMock({ card: null });
      await expect(regenerateSeedCard(db, 'inexistente', { apiKey: 'k', fetch: fetchMock }))
        .rejects.toThrow('card_not_found');
    });

    it('lanza db_fetch_error si la query devuelve error', async () => {
      const { db } = buildDbMock({ card: null, fetchErr: { message: 'pg down' } });
      await expect(regenerateSeedCard(db, 'x', { apiKey: 'k', fetch: fetchMock }))
        .rejects.toThrow(/db_fetch_error/);
    });

    it('lanza upload_error si Storage falla', async () => {
      const { db } = buildDbMock({
        card: { slug: 'seed-x', profession_label: 'electricista' },
        uploadErr: { message: 'bucket_not_found' },
      });
      await expect(regenerateSeedCard(db, 'seed-x', { apiKey: 'k', fetch: fetchMock }))
        .rejects.toThrow(/upload_error: bucket_not_found/);
    });

    it('lanza update_error si UPDATE falla', async () => {
      const { db } = buildDbMock({
        card: { slug: 'seed-x', profession_label: 'electricista' },
        updateErr: { message: 'rls denied' },
      });
      await expect(regenerateSeedCard(db, 'seed-x', { apiKey: 'k', fetch: fetchMock }))
        .rejects.toThrow(/update_error: rls denied/);
    });

    it('en éxito sube a seeds/<slug>.jpg, actualiza foto_url con cache-bust y devuelve la URL', async () => {
      const { db, spies } = buildDbMock({
        card: { slug: 'seed-ana', profession_label: 'electricista' },
        publicUrl: 'https://mock.supabase.co/storage/v1/object/public/Avatars/seeds/seed-ana.jpg',
      });
      const fixedNow = 1700000000000;

      const result = await regenerateSeedCard(db, 'seed-ana', {
        apiKey: 'k',
        fetch: fetchMock,
        now: () => fixedNow,
      });

      expect(result.slug).toBe('seed-ana');
      expect(result.foto_url).toBe(`https://mock.supabase.co/storage/v1/object/public/Avatars/seeds/seed-ana.jpg?v=${fixedNow}`);

      // Storage.upload llamada con path estable y upsert
      expect(spies.storageFrom).toHaveBeenCalledWith('Avatars');
      expect(spies.uploadFn).toHaveBeenCalledOnce();
      const [path, buf, opts] = spies.uploadFn.mock.calls[0];
      expect(path).toBe('seeds/seed-ana.jpg');
      expect(buf).toBeInstanceOf(Buffer);
      expect(opts).toEqual({ contentType: 'image/png', upsert: true });

      // UPDATE de cards.foto_url
      const updatedFields = spies.update.mock.calls[0][0];
      expect(updatedFields).toEqual({ foto_url: result.foto_url });
      expect(spies.eqUpdate).toHaveBeenCalledWith('slug', 'seed-ana');
    });

    it('inyectable: usa generateImage de opts si se proporciona (sin tocar fetch)', async () => {
      const { db } = buildDbMock({
        card: { slug: 'seed-y', profession_label: 'fontanero' },
      });
      const stubGen = vi.fn().mockResolvedValue({ buffer: Buffer.from('zzz'), mimeType: 'image/jpeg' });
      const result = await regenerateSeedCard(db, 'seed-y', {
        apiKey: 'k',
        generateImage: stubGen,
        now: () => 42,
      });
      expect(stubGen).toHaveBeenCalledOnce();
      const [prompt] = stubGen.mock.calls[0];
      expect(prompt).toContain('fontanero');
      expect(result.foto_url).toContain('?v=42');
    });
  });
});
