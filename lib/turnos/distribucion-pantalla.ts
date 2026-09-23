/**
 * Como se reparten las casillas en el televisor, para CUALQUIER televisor.
 *
 * No se sabe que televisor va a tener la sala: 720p, 1080p, 4K, un monitor 4:3
 * o uno puesto en vertical. La distribucion se calcula con el espacio REAL
 * (medido en la pagina), el tamaño de la pantalla y el numero de consultorios:
 *
 *   - nunca se recorta, solapa ni oculta ninguna casilla, ni hace scroll;
 *   - la letra es la mayor que quepa, medida contra la pantalla y nunca por
 *     debajo de lo que se lee desde el fondo de la sala
 *     (ver `legibilidad-pantalla.ts`);
 *   - si con el minimo no caben, se reparten en mas columnas;
 *   - y solo como ultimo recurso, en paginas que rotan solas.
 *
 * Este archivo es la puerta de entrada: cada diseño tiene su calculo
 * (`distribucion-cartelera.ts`, `distribucion-cuadricula.ts`) y aqui vive lo
 * que comparten, la rotacion de paginas.
 */

export { MAXIMO_EN_UNA_PANTALLA, MINIMO_TEXTO, MINIMO_TURNO, ladoCorto, type Espacio, type Letra, type TextosDeCasilla } from './legibilidad-pantalla'
export { POCAS_FILAS, planDeCartelera, tablaConFoto, type CeldasDeFila, type FormaDeFila, type PlanDeCartelera } from './distribucion-cartelera'
export {
  planDeCuadricula,
  type CasillaDeCuadricula,
  type PaginaDeCuadricula,
  type PlanDeCuadricula,
} from './distribucion-cuadricula'

// --- Rotacion de paginas ---------------------------------------------------------

export interface EstadoDePagina {
  pagina: number
  /** Cuando toca pasar a la siguiente pagina (ms). */
  cambioEn: number
}

/**
 * Que pagina mostrar ahora.
 *
 * Sin llamados, rota cada `msPorPagina`. PERO SIGUE AL LLAMADO: si el
 * consultorio que acaba de llamar esta en otra pagina, salta a ella en el
 * acto. Antes sonaba la campana y el turno no aparecia hasta que la rotacion
 * llegara a su pagina (hasta 10 s por cada pagina de por medio), y el resalte
 * podia apagarse antes. Tras el salto, la pagina se queda al menos lo que dura
 * el resalte y despues vuelve a contar desde cero.
 */
export function decidirPagina(
  estado: EstadoDePagina,
  entrada: { paginas: number; ahora: number; msPorPagina: number; llamado?: { pagina: number; retenerMs: number } },
): EstadoDePagina {
  const { paginas, ahora, msPorPagina, llamado } = entrada
  if (paginas <= 1) return { pagina: 0, cambioEn: ahora + msPorPagina }
  if (llamado) return { pagina: llamado.pagina % paginas, cambioEn: ahora + llamado.retenerMs + msPorPagina }
  if (ahora >= estado.cambioEn) return { pagina: (estado.pagina + 1) % paginas, cambioEn: ahora + msPorPagina }
  return { pagina: estado.pagina % paginas, cambioEn: estado.cambioEn }
}
