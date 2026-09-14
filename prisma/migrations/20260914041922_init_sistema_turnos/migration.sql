-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMINISTRADOR', 'OPERADOR');

-- CreateEnum
CREATE TYPE "ModoFila" AS ENUM ('COMPARTIDA', 'POR_PROFESIONAL');

-- CreateEnum
CREATE TYPE "Jornada" AS ENUM ('MANANA', 'TARDE', 'COMPLETA');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('PROGRAMADA', 'PRESENTADO', 'ATENDIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('EN_ESPERA', 'LLAMADO', 'EN_ATENCION', 'ATENDIDO', 'AUSENTE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PrioridadTurno" AS ENUM ('NORMAL', 'PRIORITARIO');

-- CreateEnum
CREATE TYPE "OrigenCita" AS ENUM ('MANUAL', 'IMPORTACION');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "area" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "secciones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "prefijo" TEXT NOT NULL,
    "modoFila" "ModoFila" NOT NULL DEFAULT 'POR_PROFESIONAL',
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "servicioId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "modulos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesionales" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "jornada" "Jornada" NOT NULL DEFAULT 'COMPLETA',
    "moduloId" TEXT,
    "usuarioId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "profesionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accesos_profesional" (
    "id" TEXT NOT NULL,
    "profesionalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadoEn" TIMESTAMP(3),
    "ultimoUsoEn" TIMESTAMP(3),

    CONSTRAINT "accesos_profesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" TEXT NOT NULL,
    "documentoPaciente" TEXT NOT NULL,
    "tipoDocumento" TEXT,
    "nombrePaciente" TEXT NOT NULL,
    "profesionalId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "horaCita" TIMESTAMP(3) NOT NULL,
    "fecha" TEXT NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'PROGRAMADA',
    "origen" "OrigenCita" NOT NULL DEFAULT 'MANUAL',
    "procedimiento" TEXT,
    "cups" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadaPor" TEXT,
    "horaCitaOriginal" TIMESTAMP(3),
    "vecesReprogramada" INTEGER NOT NULL DEFAULT 0,
    "reprogramadaEn" TIMESTAMP(3),
    "reprogramadaPor" TEXT,
    "motivoReprogramacion" TEXT,
    "canceladaEn" TIMESTAMP(3),
    "canceladaPor" TEXT,
    "motivoCancelacion" TEXT,
    "cargaId" TEXT,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "estado" "EstadoTurno" NOT NULL DEFAULT 'EN_ESPERA',
    "prioridad" "PrioridadTurno" NOT NULL DEFAULT 'NORMAL',
    "fechaGeneracion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha" TEXT NOT NULL,
    "horaLlamado" TIMESTAMP(3),
    "horaPrimerLlamado" TIMESTAMP(3),
    "horaAtencion" TIMESTAMP(3),
    "moduloId" TEXT,
    "funcionarioId" TEXT,
    "vecesLlamado" INTEGER NOT NULL DEFAULT 0,
    "cerradoPor" TEXT,
    "cerradoEn" TIMESTAMP(3),
    "cierreAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "citaId" TEXT,
    "profesionalId" TEXT,
    "horaCita" TIMESTAMP(3),
    "nombrePaciente" TEXT,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion" (
    "id" TEXT NOT NULL DEFAULT 'unica',
    "audioActivo" BOOLEAN NOT NULL DEFAULT true,
    "volumen" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "ultimosVisibles" INTEGER NOT NULL DEFAULT 5,
    "mensajePie" TEXT NOT NULL DEFAULT '',
    "duracionCitaMinutos" INTEGER NOT NULL DEFAULT 15,
    "jornadaMananaInicio" TEXT NOT NULL DEFAULT '07:00',
    "jornadaMananaFin" TEXT NOT NULL DEFAULT '12:00',
    "jornadaTardeInicio" TEXT NOT NULL DEFAULT '13:00',
    "jornadaTardeFin" TEXT NOT NULL DEFAULT '17:00',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_seguridad" (
    "id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" TEXT NOT NULL,
    "exito" BOOLEAN NOT NULL,
    "usuarioId" TEXT,
    "identificador" TEXT,
    "ip" TEXT,
    "detalle" JSONB,

    CONSTRAINT "eventos_seguridad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargas_citas" (
    "id" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "subidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidaPor" TEXT,
    "fecha" TEXT,
    "filasLeidas" INTEGER NOT NULL DEFAULT 0,
    "creadas" INTEGER NOT NULL DEFAULT 0,
    "actualizadas" INTEGER NOT NULL DEFAULT 0,
    "omitidas" INTEGER NOT NULL DEFAULT 0,
    "errores" JSONB,

    CONSTRAINT "cargas_citas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_nombre_key" ON "servicios"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "modulos_nombre_key" ON "modulos"("nombre");

-- CreateIndex
CREATE INDEX "modulos_servicioId_idx" ON "modulos"("servicioId");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_nombre_key" ON "profesionales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_usuarioId_key" ON "profesionales"("usuarioId");

-- CreateIndex
CREATE INDEX "profesionales_servicioId_idx" ON "profesionales"("servicioId");

-- CreateIndex
CREATE INDEX "profesionales_moduloId_idx" ON "profesionales"("moduloId");

-- CreateIndex
CREATE UNIQUE INDEX "accesos_profesional_tokenHash_key" ON "accesos_profesional"("tokenHash");

-- CreateIndex
CREATE INDEX "accesos_profesional_profesionalId_idx" ON "accesos_profesional"("profesionalId");

-- CreateIndex
CREATE INDEX "citas_fecha_idx" ON "citas"("fecha");

-- CreateIndex
CREATE INDEX "citas_fecha_profesionalId_idx" ON "citas"("fecha", "profesionalId");

-- CreateIndex
CREATE INDEX "citas_documentoPaciente_idx" ON "citas"("documentoPaciente");

-- CreateIndex
CREATE INDEX "citas_cargaId_idx" ON "citas"("cargaId");

-- CreateIndex
CREATE UNIQUE INDEX "citas_fecha_documentoPaciente_profesionalId_horaCita_key" ON "citas"("fecha", "documentoPaciente", "profesionalId", "horaCita");

-- CreateIndex
CREATE INDEX "turnos_fecha_estado_idx" ON "turnos"("fecha", "estado");

-- CreateIndex
CREATE INDEX "turnos_fecha_profesionalId_estado_idx" ON "turnos"("fecha", "profesionalId", "estado");

-- CreateIndex
CREATE INDEX "turnos_fecha_servicioId_estado_idx" ON "turnos"("fecha", "servicioId", "estado");

-- CreateIndex
CREATE INDEX "turnos_citaId_idx" ON "turnos"("citaId");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_fecha_codigo_key" ON "turnos"("fecha", "codigo");

-- CreateIndex
CREATE INDEX "eventos_seguridad_fecha_idx" ON "eventos_seguridad"("fecha");

-- CreateIndex
CREATE INDEX "eventos_seguridad_tipo_fecha_idx" ON "eventos_seguridad"("tipo", "fecha");

-- CreateIndex
CREATE INDEX "cargas_citas_subidaEn_idx" ON "cargas_citas"("subidaEn");

-- AddForeignKey
ALTER TABLE "modulos" ADD CONSTRAINT "modulos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "modulos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_profesional" ADD CONSTRAINT "accesos_profesional_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_cargaId_fkey" FOREIGN KEY ("cargaId") REFERENCES "cargas_citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "modulos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_citas" ADD CONSTRAINT "cargas_citas_subidaPor_fkey" FOREIGN KEY ("subidaPor") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
