import { z } from 'zod'

/** Inicio de sesion con usuario y contrasena (requerimiento seccion 17). */
export const loginSchema = z.object({
  usuario: z
    .string()
    .trim()
    .min(3, 'Ingresa tu usuario.')
    .max(40, 'El usuario es demasiado largo.'),
  password: z.string().min(1, 'Ingresa tu contrasena.'),
})

export type LoginInput = z.infer<typeof loginSchema>
