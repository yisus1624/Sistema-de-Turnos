-- Con que aspecto se dibuja el televisor de la sala de espera.
--
-- Dos columnas en la fila unica de configuracion, las dos con valor por
-- defecto, asi que la migracion es segura sobre una base con datos: las filas
-- que ya existen se quedan con el diseño de siempre y nada cambia de aspecto
-- por el solo hecho de actualizar. Cambiarlo es una decision que alguien toma
-- en "Pantalla y audio", no el efecto secundario de un despliegue.
--
-- `disenoPantalla` es TEXTO y no un enum de la base a proposito: agregar un
-- diseño nuevo mas adelante no deberia costar otra migracion. La lista de
-- valores validos vive en la aplicacion (`DISENOS_PANTALLA` en
-- lib/turnos/types.ts) y se comprueba tanto al guardar como al leer, de modo
-- que un valor desconocido —de una version anterior, o puesto a mano en la
-- base— deja el televisor en el diseño de siempre en lugar de en blanco.
ALTER TABLE "configuracion" ADD COLUMN "disenoPantalla" TEXT NOT NULL DEFAULT 'CUADRICULA';

-- Ruta de la imagen de fondo de la cartelera, servida desde `public/`
-- (por ejemplo "/img/fondo-sala.jpg"). Vacio = fondo liso, sin imagen.
--
-- Se guarda la RUTA, no el archivo: el televisor pide la imagen como cualquier
-- otro recurso del sitio, sin que pase por la base ni por la aplicacion en cada
-- refresco de cada pantalla encendida durante toda la jornada.
ALTER TABLE "configuracion" ADD COLUMN "fondoPantalla" TEXT NOT NULL DEFAULT '';
