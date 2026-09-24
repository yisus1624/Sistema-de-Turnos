-- Version de credenciales del usuario: sube con cada cambio de contrasena y
-- el callback jwt rechaza los tokens emitidos con una version anterior.
--
-- SOLO AGREGA. Nace en 0 para todas las filas; los tokens ya emitidos no
-- llevan la marca y se siguen aceptando, asi que nadie pierde la sesion al
-- desplegar. No se toca ninguna otra columna.
ALTER TABLE "usuarios" ADD COLUMN "versionCredenciales" INTEGER NOT NULL DEFAULT 0;
