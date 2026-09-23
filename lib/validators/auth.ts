import { z } from 'zod'

/** Inicio de sesion con usuario y contrasena (requerimiento seccion 17). */
export const loginSchema = z.object({
  usuario: z
    .string()
    .trim()
    .min(3, 'Ingresa tu usuario.')
    .max(40, 'El usuario es demasiado largo.'),
  // Con tope: la contrasena se compara con bcrypt en el servidor, y una de
  // megas es trabajo gratis para quien quiera cansarlo.
  password: z.string().min(1, 'Ingresa tu contrasena.').max(200, 'La contrasena es demasiado larga.'),
})

export type LoginInput = z.infer<typeof loginSchema>
