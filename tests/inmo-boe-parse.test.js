import { describe, it, expect } from 'vitest';
import boe from '../netlify/functions/lib/inmo/boe-client.js';

// Fixtures representativos de la estructura del Portal de Subastas
// (etiqueta en un nodo, valor en el siguiente). Las etiquetas son las
// reales del dominio; confirmar contra el HTML vivo en la primera
// ejecución (ver docs/inmo-subastas.md).
const LISTADO = `
  <ul class="resultados">
    <li><a href="/detalleSubasta.php?idSub=SUB-JA-2024-111">Ver</a></li>
    <li><a href="/detalleSubasta.php?idSub=SUB-AT-2024-222">Ver</a></li>
    <li><a href="/detalleSubasta.php?idSub=SUB-JA-2024-111">dup</a></li>
  </ul>`;

const DETALLE = `
  <html><body>
  <h1>Subasta SUB-JA-2024-111</h1>
  <div><span class="lbl">Estado</span><span class="val">En plazo</span></div>
  <div><span class="lbl">Valor de subasta</span><span class="val">120.000,00 €</span></div>
  <div><span class="lbl">Tasación</span><span class="val">180.000,00 €</span></div>
  <div><span class="lbl">Importe del depósito</span><span class="val">6.000,00 €</span></div>
  <div><span class="lbl">Fecha de conclusión</span><span class="val">20-07-2024 18:00:00</span></div>
  <div><span class="lbl">Lote</span><span class="val">1</span></div>
  <div><span class="lbl">Tipo de bien</span><span class="val">Vivienda</span></div>
  <div><span class="lbl">Localidad</span><span class="val">Cambrils</span></div>
  <div><span class="lbl">Provincia</span><span class="val">Tarragona</span></div>
  <div><span class="lbl">Dirección</span><span class="val">Carrer del Mar 12</span></div>
  <div><span class="lbl">Referencia catastral</span><span class="val">1234567AB1234C0001XY</span></div>
  <p>Publicado en BOE-B-2024-555</p>
  <img src="/media/imagenBien_999.jpg">
  </body></html>`;

describe('inmo · boe-client parse', () => {
  it('extractIdSubs devuelve identificadores únicos en orden', () => {
    expect(boe.extractIdSubs(LISTADO)).toEqual(['SUB-JA-2024-111', 'SUB-AT-2024-222']);
  });

  it('parseDetalle extrae los campos clave', () => {
    const d = boe.parseDetalle(DETALLE, { idSubasta: 'SUB-JA-2024-111', detalleUrl: 'https://x' });
    expect(d.estado).toBe('En plazo');
    expect(d.valorSubasta).toBe('120.000,00 €');
    expect(d.tasacion).toBe('180.000,00 €');
    expect(d.deposito).toBe('6.000,00 €');
    expect(d.fechaFin).toBe('20-07-2024 18:00:00');
    expect(d.lote).toBe(1);
    expect(d.tipoBien).toBe('Vivienda');
    expect(d.localidad).toBe('Cambrils');
    expect(d.provincia).toBe('Tarragona');
    expect(d.direccion).toBe('Carrer del Mar 12');
    expect(d.refCatastral).toBe('1234567AB1234C0001XY');
    expect(d.boeAnuncio).toBe('BOE-B-2024-555');
    expect(d.boeUrl).toContain('BOE-B-2024-555');
    expect(d.fotos).toEqual(['https://subastas.boe.es/media/imagenBien_999.jpg']);
  });

  it('parseDetalle no confunde localidad con provincia', () => {
    const d = boe.parseDetalle(DETALLE, { idSubasta: 'SUB-JA-2024-111' });
    expect(d.localidad).toBe('Cambrils');
    expect(d.provincia).toBe('Tarragona');
  });
});

export { LISTADO, DETALLE };
