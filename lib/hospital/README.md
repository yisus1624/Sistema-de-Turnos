# Capa de integracion con el hospital (`lib/hospital`)

Esta carpeta aislara la integracion con el sistema existente de la **ESE Hospital
San Rafael de Chinu**. Su unico proposito es implementar el contrato
[`TurnoRepository`](../turnos/repository.ts) contra la fuente de datos real.

## Estado: PENDIENTE DE CONFIRMACION

El hospital aun **no ha compartido** la informacion de integracion. Hasta que la
entregue, aqui **no** se implementa nada ni se inventan endpoints, rutas, campos
ni datos de ejemplo.

## El flujo que hay que soportar

Confirmado por el hospital (no esta en el documento de requerimientos v1.0):

1. La API entrega las **citas del dia**: paciente, profesional, servicio y hora.
2. El paciente llega y admisiones lo busca **por numero de documento**.
3. El funcionario confirma la llegada; la cita queda "presentado".
4. Solo las citas presentadas generan turno y entran a la fila.
5. Cada **profesional ve unicamente sus pacientes** y pulsa "siguiente".
6. El llamado sale en la pantalla de la sala de espera y por audio.

Los servicios de ventanilla (admisiones, facturacion, SIAU) no tienen cita: su
fila es compartida por orden de llegada, como en el documento original.

## Lo que necesitamos del hospital antes de implementar

### Conexion

- [ ] URL base de la API.
- [ ] Metodo de autenticacion (token, API key, OAuth, IP allowlist, VPN...).
- [ ] Credenciales / tokens y su ciclo de vida.
- [ ] Formato y esquema de las respuestas (JSON/XML).
- [ ] Documentacion (OpenAPI/Swagger u otra).

### Citas y agenda

- [ ] Endpoint de **citas del dia**, y si se puede filtrar por documento del
      paciente y por profesional.
- [ ] Campos que devuelve cada cita: documento, nombre, profesional, servicio,
      hora. **Que no incluya datos clinicos**: no los necesitamos y no los
      queremos almacenar (requerimiento seccion 17).
- [ ] Con cuanta frecuencia se puede consultar (limites de uso), y si hay
      webhooks o hay que hacer sondeo.
- [ ] Que pasa con las citas canceladas o reprogramadas durante el dia.
- [ ] Si el "paciente llego / se presento" debe **escribirse de vuelta** en el
      sistema del hospital o solo vive en el sistema de turnos.

### Catalogos

- [ ] Catalogo de **servicios** y cuales atienden por cita y cuales por
      ventanilla.
- [ ] Catalogo de **modulos**: consultorios y ventanillas.
- [ ] Catalogo de **profesionales** y en que consultorio atiende cada uno.

### Usuarios

- [ ] Si la autenticacion de funcionarios usa el directorio del hospital
      (SSO/AD) o cuentas propias de este sistema.
- [ ] Como se relaciona la cuenta de un doctor con su ficha de profesional en
      la agenda (que campo los une). Hoy el profesional se elige a mano en la
      pantalla del consultorio; con este dato se toma de la sesion.

### Decisiones a confirmar

- [ ] **Quien es la fuente de verdad** del estado del turno: el hospital o este
      sistema. Hoy asumimos que este sistema lo es y que la API solo aporta la
      agenda.
- [ ] Si se muestra el **nombre del paciente** en la pantalla publica. Hoy sale
      enmascarado ("JUAN P.") porque el nombre completo junto al servicio
      revelaria un dato de salud en un lugar publico (Ley 1581 de 2012). Si el
      hospital pide el nombre completo, que quede por escrito de su parte; se
      cambia solo en [`privacidad.ts`](../turnos/privacidad.ts).
- [ ] El documento de requerimientos (secciones 21.B y 27) pide base de datos y
      modelo de datos como entregable, pero se acordo no tener base de datos
      propia. Aclarar.

## Cuando llegue la API

Se creara `hospital-api.adapter.ts` que implemente `TurnoRepository`, traduciendo
entre nuestros tipos de dominio (`lib/turnos/types.ts`) y el formato real del
hospital. La interfaz de usuario **no cambiara**.
