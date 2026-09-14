-- AlterTable
ALTER TABLE "modulos" ADD COLUMN     "claveExterna" TEXT;

-- AlterTable
ALTER TABLE "profesionales" ADD COLUMN     "claveExterna" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "modulos_claveExterna_key" ON "modulos"("claveExterna");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_claveExterna_key" ON "profesionales"("claveExterna");

