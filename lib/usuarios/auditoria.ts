/**
 * QUE QUEDA ESCRITO cuando se toca una cuenta.
 *
 * Vive aparte de la ruta por dos motivos:
 *
 * 1. ES LA UNICA PUERTA POR LA QUE PASAN LOS DATOS DE UNA CUENTA HACIA EL
 *    REGISTRO. Lo que se apunta se arma SOLO a partir de `fichaAuditable`, que
 *    enumera a mano los campos permitidos. Asi, el dia que `Usuario` gane un
 *    campo nuevo —o que alguien pase por error el objeto con `passwordHash`
 *    dentro— no se cuela en la bitacora por no haberse acordado de filtrarlo:
 *    para entrar hay que nombrarlo aqui.
 *
 * 2. ES PURO Y SE PUEDE PROBAR sin Next, sin base y sin sesion. La regla dura
 *    —"la contrasena nunca aparece en el registro"— se comprueba leyendo lo que
 *    devuelven estas funciones.
 *
 * LA CONTRASENA NO ES UN CAMPO AUDITABLE. De ella solo queda EL HECHO de que
 * cambio, nunca su valor ni su hash.
 */
import { camposCambiados } from '@/lib/seguridad/cambios'
import { EVENTOS, type TipoEvento } from '@/lib/seguridad/eventos'
import type { Usuario } from './types'

/** Un apunte listo para el registro, a falta de quien lo hizo y desde donde. */
export interface ApunteDeCuenta {
  tipo: TipoEvento
  exito: boolean
  /** Sobre que se actuo: el nombre de entrada de la cuenta afectada. */
  identificador: string
  detalle: Record<string, unknown>
}

/**
 * Los campos de una cuenta que pueden llegar al registro.
 *
 * Lista blanca a proposito: ver la nota de arriba.
 */
function fichaAuditable(usuario: Usuario) {
  return {
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    rol: usuario.rol,
    area: usuario.area,
    activo: usuario.activo,
    // `null` significa "las de su rol"; se escribe tal cual para que el antes y
    // el despues se comparen igual que en el resto del sistema.
    secciones: usuario.secciones ?? null,
  }
}

export interface CuentaEditada {
  antes: Usuario
  despues: Usuario
  /** Si la peticion traia contrasena nueva. NUNCA la contrasena en si. */
  passwordCambiada: boolean
}

/**
 * Los apuntes que deja una edicion de cuenta.
 *
 * Son varios y no uno solo porque se buscan por separado: "quien modifico esta
 * cuenta" es una pregunta, "quien la renombro" y "a quien le cambiaron la
 * contrasena" son otras dos, y en el registro se filtra por tipo de evento.
 */
export function apuntesDeEdicion({ antes, despues, passwordCambiada }: CuentaEditada): ApunteDeCuenta[] {
  const cambios = camposCambiados(fichaAuditable(antes), fichaAuditable(despues))
  const comun = { exito: true as const, identificador: despues.usuario, objetivoId: despues.id }

  const apuntes: ApunteDeCuenta[] = [
    {
      tipo: EVENTOS.USUARIO_ACTUALIZADO,
      exito: comun.exito,
      identificador: comun.identificador,
      detalle: { objetivoId: comun.objetivoId, cambios, ...(passwordCambiada ? { passwordCambiada: true } : {}) },
    },
  ]

  if (antes.usuario !== despues.usuario) {
    apuntes.push({
      tipo: EVENTOS.USUARIO_RENOMBRADO,
      exito: comun.exito,
      identificador: comun.identificador,
      // El nombre ANTERIOR y el NUEVO, siempre juntos: es lo que permite
      // atribuir despues los eventos firmados con el nombre de antes.
      detalle: {
        objetivoId: comun.objetivoId,
        usuario: { antes: antes.usuario, despues: despues.usuario },
      },
    })
  }

  if (passwordCambiada) {
    apuntes.push({
      tipo: EVENTOS.USUARIO_CONTRASENA_CAMBIADA,
      exito: comun.exito,
      identificador: comun.identificador,
      detalle: { objetivoId: comun.objetivoId, desde: 'administracion de usuarios' },
    })
  }

  return apuntes
}

/** El apunte de un renombrado que no se pudo hacer. */
export function apunteDeRenombradoFallido(cuenta: Usuario, pedido: string, motivo: string): ApunteDeCuenta {
  return {
    tipo: EVENTOS.USUARIO_RENOMBRADO,
    exito: false,
    identificador: cuenta.usuario,
    detalle: { objetivoId: cuenta.id, usuario: { antes: cuenta.usuario, despues: pedido }, motivo },
  }
}

/** El apunte del cambio de contrasena que hace uno mismo sobre su cuenta. */
export function apunteDeContrasenaPropia(cuenta: Usuario, exito: boolean, motivo?: string): ApunteDeCuenta {
  return {
    tipo: EVENTOS.USUARIO_CONTRASENA_CAMBIADA,
    exito,
    identificador: cuenta.usuario,
    detalle: { objetivoId: cuenta.id, desde: 'mi cuenta', ...(motivo ? { motivo } : {}) },
  }
}
