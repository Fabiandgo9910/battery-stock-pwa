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
   y funciones de negocio (instalación nueva, desde cero, ya incluye todo).
   - Si vienes de una instalación anterior (ya tenías el proyecto
     funcionando antes de esta versión), en vez del paso anterior ejecuta
     **en este orden exacto, cada archivo como su propia pulsación de "Run"**
     (no los pegues todos juntos):
     1. `supabase/migration_002_role_restrictions.sql`
     2. `supabase/migration_003_permission_updates.sql`
     3. `supabase/migration_004a_enum_values.sql` ⚠️ **ejecuta este solo, espera a que termine, y comprueba su verificación antes de seguir**
     4. `supabase/migration_004b_major_update.sql`
     5. `supabase/migration_005_stock_reclaim_and_notifications.sql`
     6. `supabase/migration_006_cancel_order.sql`
     7. `supabase/migration_007_realtime_orders.sql` — corrige el bug real de
        las devoluciones (`fn_process_return`), vuelve a aplicar
        `fn_cancel_driver_order` por si acaso, y activa Supabase Realtime en
        los pedidos a conductor para que se actualicen al instante.
     8. `supabase/migration_008a_enum_values.sql` ⚠️ **ejecuta este solo,
        espera a que termine, y comprueba su verificación antes de seguir**
     9. `supabase/migration_008b_orders_loans.sql` — pedidos solicitados por
        el conductor, pedidos comerciales (pedido → salida de almacén, sin
        factura), préstamos, y el motivo obligatorio cuando no se recoge la
        batería vieja.

     Ninguna borra datos de negocio. Los pasos 3 y 4 tienen que ir
     **separados** a propósito: `ALTER TYPE ... ADD VALUE` (paso 3) no puede
     usarse en la misma transacción en la que luego se usa ese valor nuevo
     (paso 4) — si los pegas juntos en una sola ejecución, Postgres lo
     rechaza y la migración queda a medias (esto es lo que causaba que las
     devoluciones no funcionasen). El 004b añade pedidos a conductor con
     aceptación/rechazo, devoluciones (simples y de garantía), venta directa
     de almacén, y los campos nuevos de venta (matrícula, batería vieja,
     origen, garantía). El 005 añade que el admin pueda retirar stock a un
     conductor y devolverlo al almacén, y el aviso de "pedido rechazado"
     para almacén/admin. El 006 añade la posibilidad de deshacer un pedido
     mientras siga pendiente.
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
- **Usuarios**: crear, editar y **eliminar de verdad** (sin estados de
  "activo/inactivo": solo edición y borrado, para mantenerlo simple).
  El borrado físico se bloquea automáticamente (con un mensaje explícito) si
  el usuario todavía tiene stock de baterías asignado — hay que retirárselo
  primero (entregarlo a otro conductor o hacer una devolución al almacén).
  Sin stock pendiente, se elimina sin dejar rastro.
- **Cajas de conductores**: caja (efectivo/tarjeta) y stock de cada
  conductor en la misma pantalla, con buscador por conductor y por batería
  (marca/modelo/EAN, para ver quién la lleva). Reinicio de caja individual.
  También puedes **retirarle stock a un conductor** directamente desde
  aquí (tocando la batería en cuestión): vuelve al almacén central.
- **Ventas del día**: resumen por conductor/vendedor, con unidades y dinero
  separado por efectivo y tarjeta, cuántas ventas fueron con cada método, y
  cuántas **baterías viejas se han recogido**. Por defecto muestra hasta el
  momento actual (no hay que esperar a que acabe el día); se puede elegir
  cualquier día anterior.

### Almacenero (y admin en todo lo de aquí abajo)
- **Recepción**: escanea el EAN del palet. Si no existe, rellena marca,
  modelo, amperaje, arranque en frío (CCA), tecnología (normal/AGM/EFB), si
  es especial y motivo. Si el modelo ya existía, también puedes tocar
  **Editar** ahí mismo para corregir sus datos antes de dar entrada. Luego
  indica la empresa distribuidora y la cantidad → se suma al stock del
  almacén. También puedes marcar que la recepción **es la devolución de un
  préstamo** (en vez de dar de alta stock nuevo): buscas el préstamo activo
  por quién lo tiene o por la batería, e indicas cuánto se devuelve.
- **Entregar a conductor**: arma un pedido escaneando una o varias
  baterías y lo envía a un conductor. El stock del almacén **no se
  descuenta todavía** — el conductor tiene que aceptar el pedido desde su
  móvil para que se mueva el stock (o rechazarlo, y no se mueve nada).
- **Pedidos de conductores**: aquí llegan tanto los que tú preparas como
  los que el conductor **solicita** él mismo (quedan "por preparar" hasta
  que tú los revisas — puedes editar modelos y cantidades, por ejemplo si
  pidió algo que no existe en el catálogo — y los envías). Se actualiza al
  instante (Realtime) en cuanto el conductor responde, y siempre puedes
  **ver los detalles** completos de cualquier pedido. Mientras un pedido
  siga pendiente (por preparar o ya enviado sin responder), puedes
  **deshacerlo**. Si un conductor **rechaza** un pedido, te salta al
  instante un aviso emergente hasta que lo marques como visto.
- **Pedidos comerciales**: los que ha solicitado admin/comercial para una
  empresa o taller. Los preparas (puedes editar modelos/cantidades) y les
  **das salida** — ahí es cuando de verdad se descuenta el almacén y queda
  registrada la salida. Sin factura: es solo un registro de qué salió,
  cuándo y para quién.
- **Salidas de almacén**: todas las salidas ya dadas, con filtro por
  empresa y por fecha, y el detalle completo de cada una.
- **Préstamos**: sacan baterías del almacén sin ser una venta. Registra a
  quién se le presta y cuánto; cuando te las devuelvan, registra la
  devolución (total o parcial) desde aquí o marcándolo en Recepción — en
  ambos casos repone el stock del almacén.
- **Venta directa de almacén**: vende a un cliente particular directamente
  desde el stock del almacén central (no tiene nada que ver con los
  pedidos comerciales). Igual que la venta de un conductor: matrícula del
  coche, si se lleva la batería vieja (con motivo obligatorio si no la
  lleva), origen (particular/web/Mapfre), y opción de marcarla como
  garantía.
- **Devoluciones**: registra devoluciones simples (vuelven al stock
  vendible) o de garantía (van a un almacén de garantías aparte, sin
  mezclarse con lo que se puede vender), con observaciones para detallar el
  motivo. El proceso de escaneo funciona igual que en Recepción: si el EAN
  no está en el catálogo, se da de alta ahí mismo. Puede venir de un
  conductor (se le resta de su stock) o directamente de un cliente/taller.
- **Modelos de producto**: catálogo de baterías, con edición y eliminación.
- **Distribuidores**: alta, edición y eliminación de empresas suministradoras.

### Conductor / Vendedor
- En cuanto tiene un pedido sin responder, le aparece **al instante** un
  aviso a pantalla completa que no se puede cerrar hasta que lo acepte o lo
  rechace (salta en cualquier pantalla de la app). Usa Supabase Realtime.
- **Pedidos**: lo que el almacén le prepara (para aceptar/rechazar) y lo
  que él mismo ha solicitado (a la espera de que lo preparen, cancelable
  mientras tanto). Siempre puede **ver los detalles** de cualquier pedido.
- **Solicitar pedido**: pide él mismo lo que necesita escaneando modelos y
  cantidades. Le llega al almacén como "por preparar"; cuando lo procesen y
  envíen, le aparecerá para aceptar/rechazar como cualquier otro pedido.
- **Vender**: escanea la batería y cobra en efectivo y/o tarjeta. Pide
  también la matrícula del coche del cliente y si entrega la batería vieja
  — si no la entrega, hay que indicar el motivo. Puede marcar la venta como
  **garantía**: el cobro es 0 €, salvo que el cliente suba de gama, en cuyo
  caso solo se cobra (efectivo o tarjeta) la diferencia.
- **Mi stock**: qué lleva y cuánto.
- **Mi caja**: saldo actual (efectivo y tarjeta por separado) y
  movimientos. Solo un administrador puede reiniciarla a cero.

### Comercial (y también admin)
- **Nuevo pedido comercial**: pide baterías (uno o varios modelos, con sus
  cantidades) para una empresa o taller. No mueve stock — es una solicitud
  que el almacén tiene que preparar y a la que dar salida. No hay factura:
  el registro de la operación es la propia salida de almacén.
- **Ventas comerciales** (gestión de clientes): alta, edición y baja de las
  empresas/talleres a los que se les puede pedir.
- También puede consultar **Salidas de almacén**, con los mismos filtros
  por empresa y fecha que ve el almacenero.

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
- **Eliminar usuarios**: no hay estado "activo/inactivo" — solo editar y
  eliminar. El borrado se bloquea automáticamente si el usuario tiene stock
  de baterías asignado, con un mensaje explícito indicando qué stock hay
  que retirar antes.
- **Login con mensajes precisos**: si el inicio de sesión falla, la app te
  dice si es porque no existe ninguna cuenta con ese correo o porque la
  contraseña es incorrecta — en vez
  del mensaje genérico de siempre.
- **Todas las listas están paginadas** (usuarios, distribuidores, modelos
  de producto, facturas, clientes, cajas, ventas del día, stock, pedidos,
  devoluciones), con buscador donde tiene sentido, para que sigan yendo
  rápido aunque crezcan mucho con el tiempo.

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