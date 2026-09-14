// Sustituto de `server-only` para las pruebas.
//
// Ese paquete existe para que la COMPILACION falle si un componente de cliente
// acaba importando codigo de servidor (ver `lib/prisma.ts`). Lo consigue con un
// index.js que lanza siempre, y del que el bundler de Next se salva porque
// resuelve la condicion "react-server".
//
// Node no aplica esa condicion, asi que al ejecutar un route handler en las
// pruebas el paquete lanza y el archivo entero falla sin haber probado nada. Se
// sustituye por este modulo vacio, que es exactamente lo que el bundler usa en
// el servidor. La barrera sigue existiendo donde importa: en `npm run build`.
export {}
