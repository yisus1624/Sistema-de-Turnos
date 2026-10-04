/*
 * Service worker de la app instalable.
 *
 * NO INTERCEPTA NINGUNA PETICION, a proposito. Este sistema muestra turnos y
 * pacientes en vivo: una pantalla servida desde una copia vieja estaria
 * mintiendo, y un intermediario que fallara al pedirle la pagina al servidor
 * dejaria al medico viendo "sin conexion" con el servidor funcionando. Chrome
 * y Edge ya no lo exigen para ofrecer "Instalar"; se registra para los
 * navegadores que todavia lo piden.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))
