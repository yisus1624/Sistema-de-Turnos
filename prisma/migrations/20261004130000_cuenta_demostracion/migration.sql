-- Cuentas de demostracion: trabajan contra el hospital de mentira en memoria
-- (lib/demostracion/mundo.ts) y nunca contra las tablas de turnos.
ALTER TABLE "usuarios" ADD COLUMN "esDemostracion" BOOLEAN NOT NULL DEFAULT false;
