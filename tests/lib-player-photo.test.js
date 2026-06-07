import { describe, it, expect } from 'vitest';
import { validatePlayerPhoto, uploadPlayerPhoto, MAX_PHOTO_BYTES } from '../netlify/functions/lib/player-photo.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('validatePlayerPhoto', () => {
  it('acepta png/jpg/webp y devuelve buffer + ext', () => {
    expect(validatePlayerPhoto({ base64: PNG, contentType: 'image/png' }).ext).toBe('png');
    expect(validatePlayerPhoto({ base64: PNG, contentType: 'image/jpeg' }).ext).toBe('jpg');
    expect(validatePlayerPhoto({ base64: PNG, contentType: 'image/webp' }).ext).toBe('webp');
  });
  it('rechaza MIME no permitido', () => {
    expect(validatePlayerPhoto({ base64: PNG, contentType: 'image/gif' }).error).toBe('mime');
    expect(validatePlayerPhoto({ base64: PNG, contentType: 'application/pdf' }).error).toBe('mime');
  });
  it('rechaza faltantes', () => {
    expect(validatePlayerPhoto({ contentType: 'image/png' }).error).toBe('missing');
    expect(validatePlayerPhoto({ base64: PNG }).error).toBe('missing');
    expect(validatePlayerPhoto({}).error).toBe('missing');
  });
  it('rechaza si supera el máximo de 2 MB', () => {
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1).toString('base64');
    expect(validatePlayerPhoto({ base64: big, contentType: 'image/png' }).error).toBe('too_large');
  });
});

describe('uploadPlayerPhoto', () => {
  const okStorage = {
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        getPublicUrl: (n) => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/Avatars/' + n } }),
      }),
    },
  };

  it('sube y devuelve url con key players/{slug}-{ts}.{ext}', async () => {
    const out = await uploadPlayerPhoto(okStorage, 'p-abc12345', { base64: PNG, contentType: 'image/png' });
    expect(out.url).toContain('/Avatars/players/p-abc12345-');
    expect(out.url).toMatch(/\.png$/);
  });
  it('propaga error de validación sin tocar storage', async () => {
    const out = await uploadPlayerPhoto(okStorage, 'p-1', { base64: PNG, contentType: 'image/gif' });
    expect(out.error).toBe('mime');
  });
  it('error si no hay storage en el cliente', async () => {
    const out = await uploadPlayerPhoto({}, 'p-1', { base64: PNG, contentType: 'image/png' });
    expect(out.error).toBe('no_storage');
  });
  it('propaga error de upload de storage', async () => {
    const failStorage = { storage: { from: () => ({ upload: () => Promise.resolve({ error: { message: 'boom' } }), getPublicUrl: () => ({ data: {} }) }) } };
    const out = await uploadPlayerPhoto(failStorage, 'p-1', { base64: PNG, contentType: 'image/png' });
    expect(out.error).toBe('boom');
  });
});
