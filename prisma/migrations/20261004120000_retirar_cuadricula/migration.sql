-- Se retira el diseño CUADRICULA del televisor: quedan CARTELERA y
-- CARTELERA_PACIENTE. Las salas que lo tenian pasan a la cartelera de siempre
-- (turno, medico y consultorio), nunca a la que muestra el nombre del paciente.
UPDATE "configuracion" SET "disenoPantalla" = 'CARTELERA' WHERE "disenoPantalla" = 'CUADRICULA';
ALTER TABLE "configuracion" ALTER COLUMN "disenoPantalla" SET DEFAULT 'CARTELERA';
