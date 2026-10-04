-- Entrada de los medicos con PIN (ver app/medico y lib/consultorio).

-- Como entran los medicos y la version de los equipos autorizados.
ALTER TABLE "configuracion" ADD COLUMN "accesoProfesionales" TEXT NOT NULL DEFAULT 'AMBOS';
ALTER TABLE "configuracion" ADD COLUMN "versionEquipos" INTEGER NOT NULL DEFAULT 0;

-- El PIN de cada medico: huella para entrar, copia cifrada para volver a verlo.
CREATE TABLE "pines_profesional" (
    "profesionalId" TEXT NOT NULL,
    "pinHuella" TEXT NOT NULL,
    "pinCifrado" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pines_profesional_pkey" PRIMARY KEY ("profesionalId")
);

CREATE UNIQUE INDEX "pines_profesional_pinHuella_key" ON "pines_profesional"("pinHuella");

ALTER TABLE "pines_profesional" ADD CONSTRAINT "pines_profesional_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
