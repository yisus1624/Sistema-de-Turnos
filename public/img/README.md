# Imagenes estaticas

## `logo-hospital.png` (requerido)

Logo institucional de la ESE Hospital San Rafael de Chinu. Lo usan la barra
lateral, el inicio de sesion, la pantalla de la sala de espera y el favicon.

- Formato: PNG con fondo transparente o blanco.
- Tamano recomendado: cuadrado, minimo 512x512 px.
- Si el hospital entrega una version nueva, se reemplaza este archivo y cambia
  en toda la aplicacion: la ruta esta en un solo sitio
  (`components/brand/Marca.tsx`).

No se usa ningun servicio externo de imagenes: el sistema debe funcionar en la
red interna del hospital aunque no haya internet.
