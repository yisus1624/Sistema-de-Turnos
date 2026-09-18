-- El registro de actividad pasa a guardarse de verdad.
--
-- La tabla ya existia pero no la escribia nadie: los eventos vivian en un
-- arreglo en memoria del proceso y se perdian en cada reinicio. Se le agrega
-- el nombre de quien hizo la accion, copiado en el momento, para que el
-- registro siga siendo legible aunque la cuenta se renombre o se de de baja.

ALTER TABLE "eventos_seguridad" ADD COLUMN "usuarioNombre" TEXT;

CREATE INDEX "eventos_seguridad_usuarioId_fecha_idx" ON "eventos_seguridad"("usuarioId", "fecha");
