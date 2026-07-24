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
│                                 por módulo: reception, dispatch-driver, driver-sale,
│                                 commercial-sale, wallet-reset, product-models,
│                                 users, points-of-sale, suppliers, invoices, audit
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
   `supabase/schema.sql` → **Run**. Esto crea todas las tablas, roles, RLS,
   triggers de auditoría y funciones de negocio.
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
Acceso total. Da de alta usuarios (`Usuarios`), reinicia cajas de
conductores (`Cajas de conductores`), y consulta la trazabilidad completa
(`Auditoría`).

### Almacenero
- **Recepción**: escanea el EAN del palet. Si no existe, rellena marca,
  modelo, amperaje, arranque en frío (CCA), tecnología (normal/AGM/EFB), si
  es especial y motivo. Luego indica la empresa distribuidora, quién
  recepciona (automático, el usuario logueado) y la cantidad → se suma al
  stock del almacén.
- **Entregar a conductor**: escanea, selecciona el conductor, indica
  cantidad → resta del almacén y suma al conductor, con fecha y quién hizo
  la entrega.
- **Modelos de producto** / **Distribuidores**: catálogos de consulta y alta.

### Conductor / Vendedor
- **Vender**: escanea la batería, indica cuánto cobra en efectivo y/o
  tarjeta → resta de su stock y suma a su caja (separada por efectivo y
  tarjeta).
- **Mi stock**: qué lleva y cuánto.
- **Mi caja**: saldo actual y movimientos. Solo un administrador puede
  reiniciarla a cero (queda registrado quién y cuándo).

### Comercial
- **Venta comercial**: escanea todos los productos de la venta, selecciona
  el punto de venta/cliente → se genera una factura en **borrador con los
  precios en blanco**.
- **Facturas**: rellena el precio de cada línea y emite la factura (se
  calculan automáticamente subtotal, IVA y total).
- También gestiona **Puntos de venta**.

---

## 9. Seguridad y trazabilidad

- Autenticación con Supabase Auth (email + contraseña).
- **Row Level Security** en todas las tablas: cada rol solo ve/edita lo que
  le corresponde (ej. un conductor no puede ver el stock de otro conductor
  ni el stock del almacén central).
- **`middleware.ts`** bloquea además el acceso a rutas de la interfaz que no
  correspondan al rol del usuario.
- **`audit_log`**: cada INSERT/UPDATE/DELETE en las tablas sensibles
  (productos, stock, ventas, facturas, cajas, usuarios, puntos de venta)
  queda registrado con usuario, fecha, y el estado anterior/nuevo del
  registro. Visible en el panel de Auditoría.
- Las operaciones críticas (recepción, entrega, venta, reinicio de caja) se
  ejecutan como **funciones SQL transaccionales** (`fn_*` en `schema.sql`),
  no como varias llamadas sueltas desde el frontend — así el stock nunca
  queda a medias si algo falla a mitad de camino.

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
