-- Reglas del negocio que la base no respaldaba.
--
-- Todas se comprobaban leyendo y escribiendo despues. Con un solo operador
-- nunca fallan; con dos trabajando a la vez, entre la lectura y la escritura
-- cabe el otro. Aqui pasan a ser indices, que es lo unico que de verdad las
-- garantiza.
--
-- ANTES DE APLICAR: las tres primeras sentencias fallan si YA hay datos que
-- incumplen la regla. Es intencionado —crear el indice ignorando lo que ya esta
-- mal solo aplaza el problema—, y el DO de cada bloque avisa con los nombres
-- concretos que hay que corregir en la administracion antes de volver a
-- intentarlo.

-- ---------------------------------------------------------------------------
-- 1. El nombre del consultorio, del servicio y del doctor: unico SIN distinguir
--    mayusculas ni espacios.
--
--    El `@unique` de Postgres compara la cadena exacta y la regla de negocio
--    compara con `mode: 'insensitive'`. Por esa rendija entraban "Consultorio
--    3" y "CONSULTORIO 3": para el paciente son el mismo consultorio, y el
--    nombre del consultorio es LO UNICO que le dice por que puerta entrar.
--
--    Se hace con un indice sobre la expresion `lower(trim(nombre))` y no con
--    `citext`: citext obliga a instalar una extension y cambia como compara la
--    columna en TODAS las consultas, incluidas las que Prisma genera. El indice
--    de expresion no cambia ninguna consulta existente; solo rechaza la
--    escritura repetida.
DO $$
DECLARE repetidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT nombre, ', ') INTO repetidos
  FROM "modulos"
  WHERE lower(trim(nombre)) IN (
    SELECT lower(trim(nombre)) FROM "modulos" GROUP BY lower(trim(nombre)) HAVING count(*) > 1
  );
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay consultorios con el mismo nombre: %. Renombralos o desactivalos antes de aplicar esta migracion.', repetidos;
  END IF;

  SELECT string_agg(DISTINCT nombre, ', ') INTO repetidos
  FROM "servicios"
  WHERE lower(trim(nombre)) IN (
    SELECT lower(trim(nombre)) FROM "servicios" GROUP BY lower(trim(nombre)) HAVING count(*) > 1
  );
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay servicios con el mismo nombre: %. Renombralos antes de aplicar esta migracion.', repetidos;
  END IF;

  SELECT string_agg(DISTINCT nombre, ', ') INTO repetidos
  FROM "profesionales"
  WHERE lower(trim(nombre)) IN (
    SELECT lower(trim(nombre)) FROM "profesionales" GROUP BY lower(trim(nombre)) HAVING count(*) > 1
  );
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay profesionales con el mismo nombre: %. Renombralos antes de aplicar esta migracion.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX "modulos_nombre_normalizado_unico" ON "modulos" (lower(trim("nombre")));
CREATE UNIQUE INDEX "servicios_nombre_normalizado_unico" ON "servicios" (lower(trim("nombre")));
CREATE UNIQUE INDEX "profesionales_nombre_normalizado_unico" ON "profesionales" (lower(trim("nombre")));

-- ---------------------------------------------------------------------------
-- 2. El prefijo del servicio es unico.
--
--    Dos servicios con la misma letra no producen codigos repetidos en el
--    televisor —eso lo corta el unico (fecha, codigo) de los turnos—, pero
--    pasan a COMPARTIR la numeracion del dia: Odontologia saca O-001 y luego
--    O-003 porque el otro servicio se llevo el O-002.
DO $$
DECLARE repetidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT prefijo, ', ') INTO repetidos
  FROM "servicios"
  WHERE prefijo IN (SELECT prefijo FROM "servicios" GROUP BY prefijo HAVING count(*) > 1);
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay prefijos de turno repetidos: %. Asigna uno distinto a cada servicio antes de aplicar esta migracion.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX "servicios_prefijo_key" ON "servicios" ("prefijo");

-- ---------------------------------------------------------------------------
-- 3. Un paciente por cupo en las citas creadas A MANO.
--
--    ES PARCIAL A PROPOSITO, y no se puede sustituir por un unico total: el
--    hospital SI cita a dos pacientes con el mismo doctor a la misma hora en su
--    reporte, y el sistema lo soporta queriendo (la parrilla los apila). Lo que
--    no puede pasar es que el operador entregue A MANO un cupo que ya esta
--    dado, que es lo que ocurria cuando dos personas agendaban a la vez en la
--    misma celda libre.
--
--    Deja fuera las canceladas: liberar el cupo de una cita cancelada y volver
--    a darlo es justo lo que se espera.
--
--    Meter la validacion y el insert en una transaccion NO habria bastado: con
--    READ COMMITTED (lo que usa este sistema) las dos transacciones leen la
--    parrilla sin la cita de la otra y las dos insertan igual.
DO $$
DECLARE repetidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT fecha || ' ' || to_char("horaCita", 'HH24:MI'), ', ') INTO repetidos
  FROM "citas"
  WHERE origen = 'MANUAL' AND estado <> 'CANCELADA'
    AND (fecha, "profesionalId", "horaCita") IN (
      SELECT fecha, "profesionalId", "horaCita"
      FROM "citas"
      WHERE origen = 'MANUAL' AND estado <> 'CANCELADA'
      GROUP BY fecha, "profesionalId", "horaCita"
      HAVING count(*) > 1
    );
  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay cupos con dos citas creadas a mano: %. Mueve una de cada par antes de aplicar esta migracion.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX "citas_cupo_manual_unico"
  ON "citas" ("fecha", "profesionalId", "horaCita")
  WHERE "origen" = 'MANUAL'::"OrigenCita" AND "estado" <> 'CANCELADA'::"EstadoCita";
