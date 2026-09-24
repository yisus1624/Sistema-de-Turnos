-- Clave con la que la carga diaria reconoce cada servicio del reporte.
--
-- La carga buscaba el servicio por su nombre EXACTO, mientras que consultorios
-- y doctores se emparejan por `claveExterna` desde 20260914043312. El
-- administrador puede renombrar servicios, y cada renombre rompia la carga
-- siguiente: cambiando solo mayusculas ("CONSULTA EXTERNA") la carga intentaba
-- crearlo otra vez y el indice de nombre normalizado la tumbaba en cada
-- subida; con una tilde ("Odontología") creaba en silencio un duplicado con
-- otra letra de turno.
--
-- SOLO AGREGA. La columna nace NULL (los servicios hechos a mano se quedan
-- asi) y el indice unico es sobre ella, asi que no puede chocar con los datos
-- que ya hay. No se toca ninguna otra columna.
ALTER TABLE "servicios" ADD COLUMN "claveExterna" TEXT;

CREATE UNIQUE INDEX "servicios_claveExterna_key" ON "servicios"("claveExterna");

-- Relleno de la columna nueva en los servicios que ya creo la carga.
--
-- Las dos claves son las de `lib/citas/reporte-hospital.ts`
-- (SERVICIO_ODONTOLOGIA y SERVICIO_CONSULTA_EXTERNA). Se le pone a cada
-- servicio cuyo nombre, sin mayusculas, tildes ni espacios de sobra, sea el del
-- reporte, y SOLO si hay exactamente uno: con dos que se llaman igual (restos
-- del duplicado) no se adivina aqui; lo decide la carga siguiente con la regla
-- de `lib/citas/servicio-del-reporte.ts`. Rellenar aqui, y no esperar a la
-- primera carga, cierra el hueco de un renombre hecho entre el despliegue y
-- esa carga. Como mucho una fila por clave: no puede chocar con el indice.
--
-- Lo que NO se puede rellenar: un servicio que el administrador ya renombro a
-- algo irreconocible ("Salud oral") no dice de que servicio del reporte era.
-- Si la carga ya le habia creado un duplicado con el nombre original, es el
-- duplicado el que se queda con la clave, que es lo mismo que la carga venia
-- haciendo; juntar los dos es una decision del administrador.
UPDATE "servicios" AS s
SET "claveExterna" = n.clave
FROM (
  SELECT id, clave, count(*) OVER (PARTITION BY clave) AS iguales
  FROM (
    SELECT id,
           upper(btrim(regexp_replace(translate("nombre", 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU'), '\s+', ' ', 'g'))) AS clave
    FROM "servicios"
  ) AS normalizados
) AS n
WHERE s.id = n.id
  AND n.clave IN ('ODONTOLOGIA', 'CONSULTA EXTERNA')
  AND n.iguales = 1
  AND s."claveExterna" IS NULL;
