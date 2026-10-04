-- La entrada de los medicos es UNO U OTRO: con enlace o con PIN. "AMBOS" ya
-- no existe; quien lo tenia vuelve a "ENLACE", que es como se trabajaba, y el
-- administrador enciende el PIN a proposito en "Pantalla y audio".
UPDATE "configuracion" SET "accesoProfesionales" = 'ENLACE' WHERE "accesoProfesionales" NOT IN ('ENLACE', 'PIN');
ALTER TABLE "configuracion" ALTER COLUMN "accesoProfesionales" SET DEFAULT 'ENLACE';
