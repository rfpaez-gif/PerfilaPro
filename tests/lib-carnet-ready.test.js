import { describe, it, expect } from 'vitest';
import { carnetReadiness, isCarnetReady } from '../netlify/functions/lib/carnet-ready.js';

describe('carnetReadiness', () => {
  const full = { role: 'jugador', foto_url: 'https://x/p.png', team_id: 't1', dorsal: 10 };

  it('listo con foto + equipo + dorsal', () => {
    expect(carnetReadiness(full)).toEqual({ ready: true, missing: [] });
    expect(isCarnetReady(full)).toBe(true);
  });
  it('acepta team_name si no hay team_id', () => {
    expect(carnetReadiness({ role: 'jugador', foto_url: 'x', team_name: 'Infantil A', dorsal: 7 }).ready).toBe(true);
  });
  it('lista lo que falta', () => {
    expect(carnetReadiness({ role: 'jugador' }).missing).toEqual(['foto', 'equipo', 'dorsal']);
    expect(carnetReadiness({ role: 'jugador', foto_url: 'x', team_id: 't1' }).missing).toEqual(['dorsal']);
    expect(carnetReadiness({ role: 'jugador', team_id: 't1', dorsal: 9 }).missing).toEqual(['foto']);
  });
  it('dorsal 0 cuenta como presente; vacío/null no', () => {
    expect(carnetReadiness({ role: 'jugador', foto_url: 'x', team_id: 't1', dorsal: 0 }).ready).toBe(true);
    expect(carnetReadiness({ role: 'jugador', foto_url: 'x', team_id: 't1', dorsal: '' }).missing).toEqual(['dorsal']);
  });
  it('no aplica a cuerpo técnico (no jugador)', () => {
    expect(carnetReadiness({ role: 'entrenador', foto_url: 'x', team_id: 't1', dorsal: 1 })).toEqual({ ready: false, missing: [] });
  });
});
