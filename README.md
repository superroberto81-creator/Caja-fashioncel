# Caja de Bolsillo · Fashioncel

Punto de venta web para Fashioncel: varios empleados cobran desde el celular, los tickets se imprimen por Bluetooth y se envían por WhatsApp o correo, y los clientes pueden solicitar factura desde su ticket digital.

**En producción:** https://tickets-8e88b.web.app

## Cómo se publica

Cada cambio que se guarda en la rama `main` se publica solo en Firebase (ver `.github/workflows/deploy.yml`). El avance se ve en la pestaña **Actions** de este repositorio. También se puede publicar a mano desde Actions → *Publicar en Firebase* → **Run workflow**.

El robot usa el secreto `FIREBASE_SERVICE_ACCOUNT` (Settings → Secrets and variables → Actions).

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `public/index.html` | Estructura y estilos de la app |
| `public/app.js` | Lógica: sesión, ventas, tickets, facturas, equipo, ajustes |
| `public/printer.js` | Impresión ESC/POS por Bluetooth y RawBT |
| `public/fiscal.js` | Catálogos SAT y validación de datos fiscales |
| `public/ticket.html` | Ticket digital público y solicitud de factura del cliente |
| `public/firebase-config.js` | Datos de conexión al proyecto de Firebase |
| `public/sw.js` | Service worker (app instalable) |
| `firestore.rules` | Reglas de seguridad de la base de datos |
| `firebase.json` | Configuración de hosting y reglas |

Al cambiar archivos de `public/`, sube la versión de caché en `public/sw.js` (`caja-vN`) para que los celulares tomen la versión nueva.
