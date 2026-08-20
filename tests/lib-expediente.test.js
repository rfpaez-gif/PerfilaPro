import { describe, it, expect } from 'vitest';
import {
  PERIODICIDAD_CODES,
  isValidPeriodicidad,
  sumarDias,
  diasEntre,
  finDeMes,
  seasonRange,
  hitosDe,
  proyectarObligaciones,
  buildMatrizRow,
} from '../netlify/functions/lib/expediente.js';

const T = seasonRange(2026); // 2026-07-01 → 2027-06-30

describe('utilidades de fecha', () => {
  it('sumarDias cruza fin de mes y de año', () => {
    expect(sumarDias('2026-12-30', 3)).toBe('2027-01-02');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('diasEntre', () => {
    expect(diasEntre('2026-07-01', '2026-07-15')).toBe(14);
  });
  it('finDeMes acierta en febrero bisiesto', () => {
    expect(finDeMes('2028-02-10')).toBe('2028-02-29');
    expect(finDeMes('2027-02-10')).toBe('2027-02-28');
  });
  it('seasonRange usa el verano como corte', () => {
    expect(T).toEqual({ inicio: '2026-07-01', fin: '2027-06-30' });
  });
});

describe('hitosDe', () => {
  it('alta: un hito a 14 días de la incorporación', () => {
    const h = hitosDe('alta', T, '2026-09-10');
    expect(h).toEqual([{ etiqueta: 'Alta', fechaLimite: '2026-09-24' }]);
  });

  it('alta: si se incorpora antes del inicio, cuenta desde el inicio', () => {
    expect(hitosDe('alta', T, '2026-05-01')[0].fechaLimite).toBe('2026-07-15');
  });

  it('inicial-final: dos hitos', () => {
    const h = hitosDe('inicial-final', T, '2026-07-01');
    expect(h.map((x) => x.etiqueta)).toEqual(['Evaluación inicial', 'Evaluación final']);
    expect(h[1].fechaLimite).toBe('2027-06-16');
  });

  it('trimestral: tres hitos, el intermedio a mitad de temporada', () => {
    const h = hitosDe('trimestral', T, '2026-07-01');
    expect(h.map((x) => x.etiqueta)).toEqual([
      'Evaluación inicial', 'Evaluación intermedia', 'Evaluación final',
    ]);
    expect(h[1].fechaLimite).toBe('2026-12-30');
  });

  it('mensual: un hito por mes de temporada', () => {
    expect(hitosDe('mensual', T, '2026-07-01').length).toBe(12);
  });

  it('mensual: incorporación tardía genera menos hitos', () => {
    expect(hitosDe('mensual', T, '2027-04-15').length).toBe(3);
  });

  it('por-evento y continua no generan hitos programados', () => {
    expect(hitosDe('por-evento', T, '2026-07-01')).toEqual([]);
    expect(hitosDe('continua', T, '2026-07-01')).toEqual([]);
  });

  it('periodicidad desconocida no revienta', () => {
    expect(hitosDe('cada-luna-llena', T, '2026-07-01')).toEqual([]);
  });

  describe('regla "activar genera hacia delante"', () => {
    it('activar en marzo descarta los hitos ya vencidos', () => {
      const h = hitosDe('trimestral', T, '2026-09-01', '2027-03-01');
      expect(h.map((x) => x.etiqueta)).toEqual(['Evaluación final']);
    });

    it('sin suelo, se generan todos', () => {
      expect(hitosDe('trimestral', T, '2026-09-01').length).toBe(3);
    });

    it('activar al final de temporada no genera nada', () => {
      expect(hitosDe('trimestral', T, '2026-09-01', '2027-06-20')).toEqual([]);
    });

    it('un hito que vence justo el día del suelo sí cuenta', () => {
      const h = hitosDe('alta', T, '2026-09-10', '2026-09-24');
      expect(h.length).toBe(1);
    });
  });
});

describe('proyectarObligaciones', () => {
  const CAT_A = 'cat-benjamin';
  const CAT_B = 'cat-juvenil';
  const jugadoras = [
    { card_slug: 'p-1', category_id: CAT_A, joined_at: '2026-07-01' },
    { card_slug: 'p-2', category_id: CAT_A, joined_at: '2026-07-01' },
    { card_slug: 'p-3', category_id: CAT_B, joined_at: '2026-07-01' },
  ];

  it('multiplica hitos por jugadoras de esa categoría', () => {
    const p = proyectarObligaciones({
      seleccion: [{ modulo_id: 'identidad', category_id: CAT_A, aplica: true, periodicidad: 'alta' }],
      jugadoras, temporada: T,
    });
    expect(p.total).toBe(2);          // sólo las dos de benjamín
    expect(p.por_modulo.identidad).toBe(2);
  });

  it('ignora los módulos con aplica=false', () => {
    const p = proyectarObligaciones({
      seleccion: [{ modulo_id: 'identidad', category_id: CAT_A, aplica: false, periodicidad: 'alta' }],
      jugadoras, temporada: T,
    });
    expect(p.total).toBe(0);
  });

  it('atribuye las obligaciones a la persona que cubre el rol', () => {
    const p = proyectarObligaciones({
      seleccion: [{ modulo_id: 'perfil_fisico', category_id: CAT_A, aplica: true, periodicidad: 'trimestral', role_code: 'preparador' }],
      jugadoras, temporada: T,
      responsablePorRol: { preparador: 'Carmen R.' },
    });
    expect(p.total).toBe(6);                    // 2 jugadoras × 3 hitos
    expect(p.por_responsable['Carmen R.']).toBe(6);
    expect(p.sin_responsable).toBe(0);
  });

  it('cuenta aparte lo que no tiene responsable — el hueco se ve', () => {
    const p = proyectarObligaciones({
      seleccion: [{ modulo_id: 'perfil_fisico', category_id: CAT_A, aplica: true, periodicidad: 'trimestral', role_code: 'preparador' }],
      jugadoras, temporada: T,
      responsablePorRol: {},                    // nadie cubre preparación física
    });
    expect(p.sin_responsable).toBe(6);
    expect(p.por_responsable).toEqual({});
  });

  it('todos los módulos a una sola persona: el número se ve antes de confirmar', () => {
    const seleccion = ['identidad', 'perfil_fisico', 'perfil_emocional'].flatMap((m) =>
      [CAT_A, CAT_B].map((c) => ({
        modulo_id: m, category_id: c, aplica: true,
        periodicidad: 'trimestral', role_code: 'coordinacion',
      }))
    );
    const p = proyectarObligaciones({
      seleccion, jugadoras, temporada: T,
      responsablePorRol: { coordinacion: 'Mariona' },
    });
    expect(p.total).toBe(27);                   // 3 jugadoras × 3 módulos × 3 hitos
    expect(p.por_responsable.Mariona).toBe(27);
  });

  it('sin jugadoras la proyección es cero, no un error', () => {
    const p = proyectarObligaciones({
      seleccion: [{ modulo_id: 'identidad', category_id: CAT_A, aplica: true, periodicidad: 'alta' }],
      jugadoras: [], temporada: T,
    });
    expect(p.total).toBe(0);
    expect(p.jugadoras).toBe(0);
  });

  it('entradas ausentes no lanzan', () => {
    const p = proyectarObligaciones({ temporada: T });
    expect(p.total).toBe(0);
  });

  it('respeta el suelo de activación', () => {
    const p = proyectarObligaciones({
      seleccion: [{ modulo_id: 'perfil_fisico', category_id: CAT_A, aplica: true, periodicidad: 'trimestral' }],
      jugadoras, temporada: T, desde: '2027-03-01',
    });
    expect(p.total).toBe(2);                    // sólo la evaluación final
  });
});

describe('buildMatrizRow', () => {
  const ctx = { moduloIds: ['identidad', 'perfil_fisico'], categoryIds: ['cat-1'] };

  it('normaliza una fila válida', () => {
    const { row, error } = buildMatrizRow(
      { modulo_id: 'identidad', category_id: 'cat-1', aplica: true, periodicidad: 'alta', role_code: 'entrenador' },
      ctx
    );
    expect(error).toBeNull();
    expect(row.aplica).toBe(true);
    expect(row.role_code).toBe('entrenador');
  });

  it('rechaza módulo, categoría, periodicidad y rol desconocidos', () => {
    expect(buildMatrizRow({ modulo_id: 'x', category_id: 'cat-1', periodicidad: 'alta' }, ctx).error).toMatch(/Módulo/);
    expect(buildMatrizRow({ modulo_id: 'identidad', category_id: 'x', periodicidad: 'alta' }, ctx).error).toMatch(/Categoría/);
    expect(buildMatrizRow({ modulo_id: 'identidad', category_id: 'cat-1', periodicidad: 'x' }, ctx).error).toMatch(/Periodicidad/);
    expect(buildMatrizRow({ modulo_id: 'identidad', category_id: 'cat-1', periodicidad: 'alta', role_code: 'x' }, ctx).error).toMatch(/Rol/);
  });

  it('permite activar sin responsable asignado todavía', () => {
    const { row, error } = buildMatrizRow(
      { modulo_id: 'identidad', category_id: 'cat-1', aplica: true, periodicidad: 'alta', role_code: '' },
      ctx
    );
    expect(error).toBeNull();
    expect(row.role_code).toBeNull();
  });

  it('sanea las notas de variante y las acota', () => {
    const { row } = buildMatrizRow(
      { modulo_id: 'identidad', category_id: 'cat-1', periodicidad: 'alta', variante_notas: '<b>Observacional</b>' },
      ctx
    );
    expect(row.variante_notas).toBe('Observacional');
  });

  it('aplica sólo es true con true estricto', () => {
    const { row } = buildMatrizRow(
      { modulo_id: 'identidad', category_id: 'cat-1', aplica: 'sí', periodicidad: 'alta' }, ctx
    );
    expect(row.aplica).toBe(false);
  });
});

describe('catálogo de periodicidades', () => {
  it('coincide con el CHECK de la migración 050', () => {
    expect(PERIODICIDAD_CODES).toEqual([
      'alta', 'inicial-final', 'trimestral', 'mensual', 'por-evento', 'continua',
    ]);
  });
  it('isValidPeriodicidad rechaza no-strings', () => {
    expect(isValidPeriodicidad(null)).toBe(false);
    expect(isValidPeriodicidad(3)).toBe(false);
  });
});
