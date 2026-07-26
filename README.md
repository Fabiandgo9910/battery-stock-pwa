# StockBat — Sistema de gestión de almacén, conductores y puntos de venta

PWA instalable (Next.js 14 + Tailwind + Supabase) para gestionar el stock de un
almacén de baterías, las entregas a conductores, las ventas y la facturación.
El modelo de datos es genérico: aunque hoy gestiona baterías, mañana puedes
usarlo para cualquier otro producto sin cambiar la arquitectura.

---

## 1. Estructura del proyecto

```
battery-stock-pwa/
├── supabase/schema.sql        ← Todo el esquema de base de datos (ejecutar en Supabase)
├── app/                       ← Next.js App Router
│   ├── login/                 ← Autenticación
│   ├── dashboard/             ← Todas las pantallas (por rol)
│   └── api/                   ← Capa de API separada (Route Handlers), organizada
│                                 por módulo: reception, driver-orders, driver-sale,
│                                 warehouse-sale, returns, commercial-sale,
│                                 wallet-reset, product-models, users,
│                                 points-of-sale, suppliers, invoices,
│                                 admin/driver-overview, admin/daily-sales
├── components/                ← BarcodeScanner, ConfirmModal (UI reutilizable)
├── hooks/useProfile.ts        ← Hook de sesión/rol del usuario
├── lib/                       ← Clientes de Supabase (browser/server/route handler)
├── types/                     ← Tipos TypeScript del dominio
├── middleware.ts              ← Protección de rutas por rol
└── public/manifest.json       ← Configuración PWA
```

La API (`app/api/**`) está deliberadamente separada de la UI: cada módulo es un
conjunto de Route Handlers independiente. El día que quieras convertir un
módulo en un microservicio aparte, puedes mover esa carpeta a un proyecto
Node/Express o a Supabase Edge Functions sin tocar el resto.

---

## 2. Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → **New Project**.
2. Cuando esté listo, ve a **SQL Editor** → pega el contenido completo de
   `supabase/schema.sql` → **Run**. Esto crea todas las tablas, roles, RLS
   y funciones de negocio (instalación nueva, desde cero).
   - Si vienes de una instalación anterior (ya tenías el proyecto
     funcionando antes de esta versión), en vez del paso anterior ejecuta
     **en este orden exacto** en el SQL Editor:
     1. `supabase/migration_002_role_restrictions.sql`
     2. `supabase/migration_003_permission_updates.sql`
     3. `supabase/migration_004_major_update.sql`
     Ninguna borra datos de negocio. La migración 004 es la más importante:
     elimina por completo el antiguo sistema de auditoría (tabla, funciones
     y triggers, sin dejar rastro), añade pedidos a conductor con
     aceptación/rechazo, devoluciones (simples y de garantía), venta directa
     de almacén, y los campos nuevos de venta (matrícula, batería vieja,
     origen, garantía).
3. Ve a **Project Settings → API** y copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (¡nunca la expongas en el
     cliente! Solo se usa en `app/api/users/route.ts` para crear usuarios)

---

## 3. Configurar variables de entorno

```bash
cp .env.local.example .env.local
```

Edita `.env.local` con tus valores reales de Supabase.

---

## 4. Crear el primer usuario administrador

1. En Supabase → **Authentication → Users → Add user**, crea tu usuario admin
   con email y contraseña (marca "Auto Confirm User").
2. Copia el `UID` generado.
3. En **SQL Editor**, ejecuta:

```sql
insert into profiles (id, full_name, email, role)
values ('PEGA-AQUI-EL-UID', 'Tu Nombre', 'tu-correo@empresa.com', 'admin');
```

A partir de aquí, **ya puedes crear el resto de usuarios (almacenero,
conductores, comercial) directamente desde la app**, en `Usuarios` (menú del
administrador) — no hace falta volver a tocar Supabase.

---

## 5. Instalar y ejecutar en local

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`. Te redirigirá a `/login`.

> Nota: el service worker de la PWA está desactivado en modo desarrollo
> (`next-pwa` lo activa solo en `npm run build && npm run start`).

---

## 6. Probar el build de producción y la instalación como PWA

```bash
npm run build
npm run start
```

Abre `http://localhost:3000` desde el navegador de tu móvil (o Chrome
desktop) y usa "Instalar aplicación" / "Añadir a pantalla de inicio". Al
escanear un código por primera vez, el navegador pedirá permiso de cámara:
acéptalo. Un lector físico USB/Bluetooth que emule teclado también funciona
sin configuración adicional (el sistema detecta el patrón de tecleo rápido +
Enter).

---

## 7. Desplegar en producción

La forma más simple es [Vercel](https://vercel.com) (creado por el mismo
equipo de Next.js):

1. Sube este proyecto a un repositorio de GitHub.
2. En Vercel → **New Project** → importa el repositorio.
3. Añade las mismas variables de entorno del paso 3 en
   **Settings → Environment Variables**.
4. Deploy. Vercel te da una URL HTTPS (obligatoria para que la cámara
   funcione en PWA) y todos los dispositivos podrán instalarla.

También puedes desplegarlo en cualquier hosting compatible con Next.js
(Node.js) — Railway, Render, un VPS con `next start`, etc.

---

## 8. Flujo de uso por rol

### Administrador
Acceso total a todo lo de abajo, más:
- **Usuarios**: crear, editar, desactivar/reactivar y **eliminar de verdad**.
  El borrado físico se bloquea automáticamente (con un mensaje explícito) si
  el usuario todavía tiene stock de baterías asignado — hay que retirárselo
  primero (entregarlo a otro conductor o hacer una devolución al almacén).
  Sin stock pendiente, se elimina sin dejar rastro.
- **Cajas de conductores**: caja (efectivo/tarjeta) y stock de cada
  conductor en la misma pantalla, con buscador por conductor y por batería
  (marca/modelo/EAN, para ver quién la lleva). Reinicio de caja individual.
- **Ventas del día**: resumen por conductor/vendedor, con unidades y dinero
  separado por efectivo y tarjeta, y cuántas ventas fueron con cada método.
  Por defecto muestra hasta el momento actual (no hay que esperar a que
  acabe el día); se puede elegir cualquier día anterior.

### Almacenero
- **Recepción**: escanea el EAN del palet. Si no existe, rellena marca,
  modelo, amperaje, arranque en frío (CCA), tecnología (normal/AGM/EFB), si
  es especial y motivo. Luego indica la empresa distribuidora y la cantidad
  → se suma al stock del almacén.
- **Entregar a conductor**: arma un pedido escaneando una o varias
  baterías (con las cantidades que quiera) y lo envía a un conductor. El
  stock del almacén **no se descuenta todavía** — el conductor tiene que
  aceptar el pedido desde su móvil para que se mueva el stock (o rechazarlo,
  y entonces no se mueve nada).
- **Venta directa de almacén**: vende a un cliente particular directamente
  desde el stock del almacén central (no tiene nada que ver con la venta
  comercial). Funciona igual que la venta de un conductor: matrícula del
  coche, si se lleva la batería vieja, origen (particular/web/Mapfre), y
  opción de marcarla como garantía.
- **Devoluciones**: registra devoluciones simples (vuelven al stock
  vendible) o de garantía (van a un almacén de garantías aparte, sin
  mezclarse con lo que se puede vender). Puede venir de un conductor
  (se le resta de su stock) o directamente de un cliente/taller.
- **Modelos de producto**: catálogo de baterías, con edición y eliminación
  (si el modelo ya tiene movimientos, se desactiva en vez de borrarse, para
  no perder el histórico).
- **Distribuidores**: alta, edición y eliminación de empresas suministradoras.
- También puede hacer **venta comercial** (ver más abajo).

### Conductor / Vendedor
- **Pedidos**: los pedidos que le prepara el almacén aparecen aquí
  pendientes de respuesta. Al aceptar, las baterías pasan a su stock; al
  rechazar, no se mueve nada.
- **Vender**: escanea la batería y cobra en efectivo y/o tarjeta. Pide
  también la matrícula del coche del cliente y si entrega la batería vieja.
  Puede marcar la venta como **garantía**: en ese caso el cobro es 0 €,
  salvo que el cliente suba de gama, en cuyo caso solo se cobra (en
  efectivo o tarjeta) la diferencia.
- **Mi stock**: qué lleva y cuánto.
- **Mi caja**: saldo actual (efectivo y tarjeta por separado) y
  movimientos. Solo un administrador puede reiniciarla a cero.

### Comercial (y también admin/almacenero)
- **Venta comercial**: escanea todos los productos de la venta a una
  empresa o taller → se genera una factura en **borrador con los precios en
  blanco**. Es un canal totalmente distinto a la venta directa de almacén:
  esta es siempre por transferencia y con factura.
- **Facturas**: rellena el precio de cada línea y emite la factura (se
  calculan automáticamente subtotal, IVA y total).
- **Ventas comerciales** (gestión de clientes): alta, edición y baja de las
  empresas/talleres a los que se les puede vender.

---

## 9. Seguridad

- Autenticación con Supabase Auth (email + contraseña).
- **Row Level Security** en todas las tablas: cada rol solo ve/edita lo que
  le corresponde (ej. un conductor no puede ver el stock de otro conductor
  ni el stock del almacén central).
- **`middleware.ts`** bloquea además el acceso a rutas de la interfaz que no
  correspondan al rol del usuario.
- **No existe ningún sistema de auditoría ni registro de "quién hizo qué"
  a nivel de usuario.** La única traza que queda es la operativa de negocio
  en sí (recepciones, pedidos, ventas, devoluciones, movimientos de stock),
  necesaria para que las cantidades cuadren — no hay tabla ni log que
  registre acciones de los usuarios más allá de eso.
- Las operaciones críticas (recepción, pedidos a conductor, venta, reinicio
  de caja, devoluciones) se ejecutan como **funciones SQL transaccionales**
  (`fn_*` en `schema.sql`), no como varias llamadas sueltas desde el
  frontend — así el stock nunca queda a medias si algo falla a mitad de
  camino.
- **Eliminar usuarios**: el borrado físico (no la simple desactivación) se
  bloquea automáticamente si el usuario tiene stock de baterías asignado,
  con un mensaje explícito indicando qué stock hay que retirar antes.

---

## 10. Extender el sistema

- **Otro tipo de producto**: crea una fila nueva en `product_categories` y
  usa el campo `extra_attributes` (JSONB) de `product_models` para
  atributos específicos de esa categoría, sin tocar el esquema.
- **Nuevo módulo de API independiente**: cada carpeta de `app/api/*` está
  aislada; puedes copiarla a un servicio aparte (o a una Supabase Edge
  Function) y solo tendrás que actualizar la URL desde donde el frontend la
  llama.
- **Tipos de Supabase generados**: para tener autocompletado real en vez del
  `any` de `types/database.ts`, instala la CLI de Supabase y ejecuta:

  ```bash
  npx supabase gen types typescript --project-id TU-PROYECTO > types/database.ts
  ```

- **Recomendación futura**: `@supabase/auth-helpers-nextjs` está marcado
  como *deprecated* en favor de `@supabase/ssr`. El sistema funciona
  perfectamente con la versión actual, pero cuando tengas tiempo conviene
  migrar (`lib/supabaseClient.ts`, `lib/supabaseServer.ts` y
  `middleware.ts` son los únicos archivos que tocarían).

---

## 11. Comandos de referencia

```bash
npm run dev      # desarrollo local
npm run build    # build de producción
npm run start    # servir el build de producción (con PWA activa)
npm run lint     # comprobar el código
```
