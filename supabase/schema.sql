-- ============================================================================
-- SISTEMA DE GESTIÓN DE ALMACÉN Y VENTAS - ESQUEMA SUPABASE
-- Diseñado para baterías pero genérico (product_categories flexibles)
-- SIN sistema de auditoría: no existe trazabilidad de "quién editó qué" más
-- allá del histórico de negocio propiamente dicho (recepciones, entregas,
-- ventas, devoluciones, movimientos de stock), que es la operativa en sí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONES
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
create type user_role as enum ('admin', 'almacenero', 'conductor', 'comercial');
create type battery_tech as enum ('normal', 'agm', 'efb');
create type movement_type as enum (
  'reception',            -- entrada de distribuidor al almacén
  'dispatch_to_driver',   -- salida de almacén a conductor (al aceptar el pedido)
  'dispatch_to_pos',      -- salida de almacén a punto de venta
  'sale_driver',          -- venta unitaria de un conductor
  'sale_commercial',      -- venta del comercial (factura, transferencia)
  'sale_warehouse_direct',-- venta directa del almacenero desde almacén
  'sale_pos',             -- venta desde un punto de venta
  'adjustment',           -- ajuste manual de stock (admin)
  'return_to_warehouse',  -- devolución simple al almacén
  'return_garantia'       -- devolución por garantía (va a almacén aparte)
);
create type payment_method as enum ('cash', 'card', 'transfer', 'mixed', 'warranty');
create type invoice_status as enum ('draft', 'issued', 'paid', 'cancelled');
-- 'requested'  = lo pidió el conductor, el almacén todavía no lo ha preparado
-- 'pending'    = el almacén ya lo preparó y envió, el conductor debe aceptar/rechazar
-- 'accepted' / 'rejected' = respuesta del conductor
create type driver_order_status as enum ('requested', 'pending', 'accepted', 'rejected');
create type return_type as enum ('devolucion', 'garantia');
create type sale_origin_type as enum ('particular', 'web', 'mapfre');
-- Pedidos de venta comercial (admin/comercial piden, el almacén da salida)
create type commercial_order_status as enum ('pending', 'dispatched', 'cancelled');
-- Préstamos de baterías (salen del almacén sin ser una venta; si se devuelven,
-- reponen el stock)
create type loan_status as enum ('prestado', 'parcial', 'devuelto');

-- ---------------------------------------------------------------------------
-- PERFILES DE USUARIO (extiende auth.users de Supabase)
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,
  role user_role not null default 'conductor',
  active boolean not null default true,
  avatar_url text,
  -- si el rol es 'conductor', puede tener info adicional (vehículo, zona)
  vehicle_plate text,
  zone text,
  -- código corto propio del conductor, usado para generar el code de cada
  -- batería que se le entrega (p.ej. "SB" -> "TK720 SB220801")
  driver_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on profiles(role);
create unique index idx_profiles_driver_code on profiles (upper(driver_code))
  where driver_code is not null and trim(driver_code) <> '';

-- ---------------------------------------------------------------------------
-- PRODUCTOS - MODELO GENÉRICO (para que mañana no sea solo baterías)
-- ---------------------------------------------------------------------------
create table product_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  slug text not null unique,
  attributes_schema jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table product_models (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references product_categories(id) on delete restrict,
  brand text not null,
  model_name text not null,
  amperage_ah numeric(6,2),
  cold_cranking_amps integer,
  battery_tech battery_tech,
  is_special boolean not null default false,
  special_reason text,
  extra_attributes jsonb not null default '{}',
  min_stock_alert integer not null default 5,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, brand, model_name, amperage_ah, cold_cranking_amps, battery_tech)
);

create index idx_product_models_category on product_models(category_id);
create index idx_product_models_brand on product_models(brand);

create table product_ean_codes (
  id uuid primary key default uuid_generate_v4(),
  ean_code text not null unique,
  product_model_id uuid not null references product_models(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_ean_code on product_ean_codes(ean_code);

-- ---------------------------------------------------------------------------
-- ALMACÉN - STOCK CENTRAL (puede haber varios almacenes; uno especial para garantías)
-- ---------------------------------------------------------------------------
create table warehouses (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'Almacén Central',
  address text,
  is_warranty_holding boolean not null default false, -- almacén aparte para devoluciones de garantía
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table warehouse_stock (
  id uuid primary key default uuid_generate_v4(),
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  product_model_id uuid not null references product_models(id) on delete restrict,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, product_model_id)
);

create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  tax_id text,
  contact_phone text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table receptions (
  id uuid primary key default uuid_generate_v4(),
  warehouse_id uuid not null references warehouses(id),
  supplier_id uuid references suppliers(id) on delete set null,
  received_by uuid references profiles(id) on delete set null,
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table reception_items (
  id uuid primary key default uuid_generate_v4(),
  reception_id uuid not null references receptions(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  ean_code text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- VENTA COMERCIAL: clientes (empresas/talleres)
-- ---------------------------------------------------------------------------
create table points_of_sale (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_name text,
  tax_id text,
  address text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pos_stock (
  id uuid primary key default uuid_generate_v4(),
  point_of_sale_id uuid not null references points_of_sale(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (point_of_sale_id, product_model_id)
);

-- ---------------------------------------------------------------------------
-- STOCK DE CONDUCTORES (lo que llevan en la furgoneta)
-- ---------------------------------------------------------------------------
create table driver_stock (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null references profiles(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (driver_id, product_model_id)
);

-- Pedidos de almacén a conductor: el conductor debe ACEPTAR o RECHAZAR.
-- El stock solo se mueve (almacén -> conductor) cuando se acepta.
create table driver_deliveries (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid references profiles(id) on delete set null,
  delivered_by uuid references profiles(id) on delete set null,
  warehouse_id uuid not null references warehouses(id),
  status driver_order_status not null default 'pending',
  -- 'conductor' = entrega normal (usa el código propio del conductor);
  -- 'ofi' = entrega extraordinaria (usa el token OFI en el code de batería);
  -- 'web' = pedido web (usa el token WEB en el code de batería).
  delivery_type text not null default 'conductor' check (delivery_type in ('conductor', 'ofi', 'web')),
  delivered_at timestamptz not null default now(),
  responded_at timestamptz,
  rejection_acknowledged_at timestamptz, -- cuándo el almacenero/admin marcó como vista una entrega rechazada
  notes text,
  created_at timestamptz not null default now()
);

create index idx_driver_deliveries_driver on driver_deliveries(driver_id);
create index idx_driver_deliveries_status on driver_deliveries(status);

create table driver_delivery_items (
  id uuid primary key default uuid_generate_v4(),
  delivery_id uuid not null references driver_deliveries(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  quantity integer not null check (quantity > 0)
);

-- ---------------------------------------------------------------------------
-- BILLETERA / CAJA (de conductores Y de almaceneros que venden directo)
-- ---------------------------------------------------------------------------
create table driver_wallets (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null unique references profiles(id) on delete cascade,
  cash_balance numeric(12,2) not null default 0,
  card_balance numeric(12,2) not null default 0,
  last_reset_at timestamptz,
  last_reset_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table driver_wallet_transactions (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null references profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  method payment_method not null,
  type text not null default 'sale',
  related_sale_id uuid,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  notes text
);

-- ---------------------------------------------------------------------------
-- CAJA DE OFICINA: dinero recaudado en ventas directas de almacén (no
-- pertenece a ningún conductor concreto). Es una fila única (id=1) que
-- funciona y se reinicia igual que la billetera de un conductor.
-- ---------------------------------------------------------------------------
create table office_wallet (
  id integer primary key default 1,
  cash_balance numeric(12,2) not null default 0,
  card_balance numeric(12,2) not null default 0,
  last_reset_at timestamptz,
  last_reset_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint office_wallet_singleton check (id = 1)
);
insert into office_wallet(id) values (1);

create table office_wallet_transactions (
  id uuid primary key default uuid_generate_v4(),
  amount numeric(12,2) not null,
  method payment_method not null,
  type text not null default 'sale',
  related_sale_id uuid,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  notes text
);

-- ---------------------------------------------------------------------------
-- VENTAS (conductor unidad a unidad, comercial por factura, almacenero directo)
-- ---------------------------------------------------------------------------
create table sales (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid references profiles(id) on delete set null,
  sale_channel text not null, -- 'driver' | 'commercial' | 'warehouse_direct' | 'pos'
  point_of_sale_id uuid references points_of_sale(id) on delete set null,
  payment_method payment_method not null,
  amount_cash numeric(12,2) not null default 0,
  amount_card numeric(12,2) not null default 0,
  amount_transfer numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  -- Datos adicionales de venta a cliente particular (conductor / almacenero directo)
  is_warranty boolean not null default false,          -- venta de garantía (0€ salvo diferencia)
  customer_vehicle_plate text,                          -- matrícula del coche del cliente
  customer_vehicle_model text,                          -- modelo del coche del cliente
  old_battery_returned boolean,                          -- si el cliente entrega la batería vieja
  old_battery_reason text,                                -- motivo si NO la entrega
  sale_origin sale_origin_type not null default 'particular', -- particular / web / mapfre
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  notes text
);

create index idx_sales_channel_date on sales(sale_channel, sold_at);

create table sale_items (
  id uuid primary key default uuid_generate_v4(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  ean_code text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2),
  battery_unit_id uuid, -- fk añadida más abajo, tras crear battery_units
  battery_code_manual text -- code escrito a mano cuando no viene de una entrega a conductor (p.ej. venta directa de almacén)
);

-- ---------------------------------------------------------------------------
-- UNIDADES DE BATERÍA CON CÓDIGO PROPIO: cada batería física entregada a un
-- conductor recibe su propio code (etiquetable/imprimible) con el formato
-- MODELO + TOKEN(código del conductor | OFI | WEB) + DDMM + Nº(01,02...).
-- Al montarla, el conductor escanea y elige su code exacto (ver fn_driver_sale).
-- ---------------------------------------------------------------------------
create table battery_units (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  product_model_id uuid not null references product_models(id),
  delivery_id uuid references driver_deliveries(id) on delete cascade,
  driver_id uuid references profiles(id) on delete set null,
  delivery_type text not null default 'conductor'
    check (delivery_type in ('conductor', 'ofi', 'web')),
  status text not null default 'assigned'
    check (status in ('assigned', 'sold', 'returned', 'cancelled')),
  sale_id uuid references sales(id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at timestamptz
);

create index idx_battery_units_driver on battery_units(driver_id, product_model_id, status);
create index idx_battery_units_delivery on battery_units(delivery_id);
create index idx_battery_units_code on battery_units(code);

alter table sale_items add constraint sale_items_battery_unit_id_fkey
  foreign key (battery_unit_id) references battery_units(id);

-- ---------------------------------------------------------------------------
-- FACTURAS (generadas por el rol Comercial, precio editable, en blanco por defecto)
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text not null unique,
  sale_id uuid references sales(id),
  point_of_sale_id uuid references points_of_sale(id) on delete set null,
  issued_by uuid references profiles(id) on delete set null,
  status invoice_status not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 21.00,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table invoice_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2),
  line_total numeric(12,2)
);

-- ---------------------------------------------------------------------------
-- DEVOLUCIONES: simples (vuelven a stock normal) o de garantía (almacén aparte)
-- ---------------------------------------------------------------------------
create table returns (
  id uuid primary key default uuid_generate_v4(),
  type return_type not null,
  product_model_id uuid not null references product_models(id),
  quantity integer not null check (quantity > 0),
  source text not null, -- 'driver:<uuid>' | 'other'
  source_driver_id uuid references profiles(id) on delete set null,
  destination_warehouse_id uuid not null references warehouses(id),
  performed_by uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_returns_type on returns(type);

-- ---------------------------------------------------------------------------
-- PEDIDOS COMERCIALES (admin/comercial piden, el almacenero prepara y da
-- salida). Sustituye a la venta comercial con factura: aquí solo queda
-- registrada la SALIDA del almacén hacia una empresa/taller concreto.
-- ---------------------------------------------------------------------------
create table commercial_orders (
  id uuid primary key default uuid_generate_v4(),
  point_of_sale_id uuid not null references points_of_sale(id) on delete restrict,
  warehouse_id uuid not null references warehouses(id),
  status commercial_order_status not null default 'pending',
  requested_by uuid references profiles(id) on delete set null,
  dispatched_by uuid references profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  dispatched_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table commercial_order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references commercial_orders(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  quantity integer not null check (quantity > 0)
);

create index idx_commercial_orders_status on commercial_orders(status);
create index idx_commercial_orders_pos on commercial_orders(point_of_sale_id);

-- ---------------------------------------------------------------------------
-- PRÉSTAMOS: salen del almacén sin ser una venta ni una entrega a conductor.
-- Si se devuelven (total o parcialmente), reponen el stock del almacén y
-- quedan enlazados aquí — así en Recepción se puede marcar "es la
-- devolución de un préstamo" en vez de darlo de alta como stock nuevo.
-- ---------------------------------------------------------------------------
create table loans (
  id uuid primary key default uuid_generate_v4(),
  product_model_id uuid not null references product_models(id),
  warehouse_id uuid not null references warehouses(id),
  quantity integer not null check (quantity > 0),
  quantity_returned integer not null default 0,
  status loan_status not null default 'prestado',
  borrower_name text not null,
  borrower_contact text,
  loaned_by uuid references profiles(id) on delete set null,
  loaned_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table loan_returns (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid not null references loans(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  returned_by uuid references profiles(id) on delete set null,
  returned_at timestamptz not null default now(),
  notes text
);

create index idx_loans_status on loans(status);

-- ---------------------------------------------------------------------------
-- MOVIMIENTOS DE STOCK (ledger de negocio: entradas/salidas de inventario)
-- ---------------------------------------------------------------------------
create table stock_movements (
  id uuid primary key default uuid_generate_v4(),
  movement_type movement_type not null,
  product_model_id uuid not null references product_models(id),
  quantity integer not null,
  from_location text,
  to_location text,
  reference_table text,
  reference_id uuid,
  performed_by uuid references profiles(id) on delete set null,
  performed_at timestamptz not null default now()
);

create index idx_stock_movements_product on stock_movements(product_model_id);
create index idx_stock_movements_date on stock_movements(performed_at);

-- ============================================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();
create trigger trg_product_models_updated before update on product_models
  for each row execute function set_updated_at();
create trigger trg_pos_updated before update on points_of_sale
  for each row execute function set_updated_at();
create trigger trg_invoices_updated before update on invoices
  for each row execute function set_updated_at();

-- Helper: devuelve el rol del usuario autenticado actual
create or replace function current_user_role()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

-- ============================================================================
-- FUNCIONES DE NEGOCIO (RPC) - transacciones atómicas
-- ============================================================================

-- 1) RECEPCIÓN DE MERCANCÍA (entrada a almacén)
create or replace function fn_receive_stock(
  p_warehouse_id uuid,
  p_supplier_id uuid,
  p_product_model_id uuid,
  p_ean_code text,
  p_quantity integer,
  p_notes text default null
) returns uuid as $$
declare
  v_reception_id uuid;
  v_user uuid := auth.uid();
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  insert into receptions(warehouse_id, supplier_id, received_by, notes)
  values (p_warehouse_id, p_supplier_id, v_user, p_notes)
  returning id into v_reception_id;

  insert into reception_items(reception_id, product_model_id, ean_code, quantity)
  values (v_reception_id, p_product_model_id, p_ean_code, p_quantity);

  insert into warehouse_stock(warehouse_id, product_model_id, quantity)
  values (p_warehouse_id, p_product_model_id, p_quantity)
  on conflict (warehouse_id, product_model_id)
  do update set quantity = warehouse_stock.quantity + excluded.quantity, updated_at = now();

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('reception', p_product_model_id, p_quantity, 'supplier', 'warehouse', 'receptions', v_reception_id, v_user);

  return v_reception_id;
end;
$$ language plpgsql security definer;

-- 2) CREAR PEDIDO PARA CONDUCTOR (NO mueve stock: queda pendiente de que el
--    conductor lo acepte o lo rechace). Puede llevar varias baterías o solo una.
--    p_delivery_type: 'conductor' (normal) | 'ofi' (extraordinaria) | 'web'
--    (pedido web) — solo determina el token usado en el code de cada batería.
create or replace function fn_create_driver_order(
  p_warehouse_id uuid,
  p_driver_id uuid,
  p_items jsonb, -- [{"product_model_id": "...", "quantity": n}, ...]
  p_notes text default null,
  p_delivery_type text default 'conductor'
) returns uuid as $$
declare
  v_delivery_id uuid;
  v_user uuid := auth.uid();
  v_item jsonb;
  v_current_stock integer;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no puede estar vacío';
  end if;
  if p_delivery_type not in ('conductor', 'ofi', 'web') then
    raise exception 'Tipo de entrega no válido';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select quantity into v_current_stock from warehouse_stock
      where warehouse_id = p_warehouse_id and product_model_id = (v_item->>'product_model_id')::uuid;
    if v_current_stock is null or v_current_stock < (v_item->>'quantity')::integer then
      raise exception 'Stock insuficiente en almacén para el modelo %', v_item->>'product_model_id';
    end if;
  end loop;

  insert into driver_deliveries(driver_id, delivered_by, warehouse_id, notes, status, delivery_type)
  values (p_driver_id, v_user, p_warehouse_id, p_notes, 'pending', p_delivery_type)
  returning id into v_delivery_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into driver_delivery_items(delivery_id, product_model_id, quantity)
    values (v_delivery_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  perform fn_generate_battery_units_for_delivery(v_delivery_id);

  return v_delivery_id;
end;
$$ language plpgsql security definer;

-- 2z) GENERA LOS CÓDIGOS DE BATERÍA DE UNA ENTREGA (uno por unidad física).
--     Formato: "<MODELO> <TOKEN><DD><MM><SEC>" p.ej. "TK720 SB220801".
--     El nº de secuencia continúa a partir del último ya usado ese mismo día
--     para el mismo modelo+token, así nunca se repite un code.
create or replace function fn_generate_battery_units_for_delivery(p_delivery_id uuid)
returns void as $$
declare
  v_driver_id uuid;
  v_delivery_type text;
  v_driver_token text;
  v_item record;
  v_model_token text;
  v_dd text := to_char(now(), 'DD');
  v_mm text := to_char(now(), 'MM');
  v_next_seq integer;
  v_i integer;
  v_code text;
begin
  select driver_id, delivery_type into v_driver_id, v_delivery_type
    from driver_deliveries where id = p_delivery_id;

  if v_delivery_type is null then
    v_delivery_type := 'conductor';
  end if;

  if v_delivery_type = 'ofi' then
    v_driver_token := 'OFI';
  elsif v_delivery_type = 'web' then
    v_driver_token := 'WEB';
  else
    select upper(driver_code) into v_driver_token from profiles where id = v_driver_id;
    if v_driver_token is null or trim(v_driver_token) = '' then
      raise exception 'El conductor seleccionado todavía no tiene un código asignado. Configúralo en Usuarios antes de entregarle baterías.';
    end if;
  end if;

  for v_item in
    select product_model_id, quantity
    from driver_delivery_items
    where delivery_id = p_delivery_id
  loop
    if exists (select 1 from battery_units where delivery_id = p_delivery_id and product_model_id = v_item.product_model_id) then
      continue;
    end if;

    select upper(regexp_replace(model_name, '\s+', '', 'g')) into v_model_token
      from product_models where id = v_item.product_model_id;

    select coalesce(max(substring(code from '(\d\d)$')::int), 0) into v_next_seq
      from battery_units
      where product_model_id = v_item.product_model_id
        and code like (v_model_token || ' ' || v_driver_token || v_dd || v_mm || '%');

    for v_i in 1..v_item.quantity loop
      v_next_seq := v_next_seq + 1;
      v_code := v_model_token || ' ' || v_driver_token || v_dd || v_mm || lpad(v_next_seq::text, 2, '0');
      insert into battery_units(code, product_model_id, delivery_id, driver_id, delivery_type, status)
      values (v_code, v_item.product_model_id, p_delivery_id, v_driver_id, v_delivery_type, 'assigned');
    end loop;
  end loop;
end;
$$ language plpgsql security definer;

-- 2b) EL CONDUCTOR SOLICITA UN PEDIDO (queda "pendiente de preparar" para el
--     almacén; todavía no se comprueba ni mueve stock alguno).
create or replace function fn_driver_request_order(
  p_items jsonb, -- [{"product_model_id": "...", "quantity": n}, ...]
  p_notes text default null
) returns uuid as $$
declare
  v_delivery_id uuid;
  v_user uuid := auth.uid();
  v_role user_role;
  v_item jsonb;
  v_warehouse_id uuid;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'conductor' then
    raise exception 'Solo un conductor puede solicitar un pedido';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no puede estar vacío';
  end if;

  select id into v_warehouse_id from warehouses where is_warranty_holding = false and active = true order by created_at limit 1;

  insert into driver_deliveries(driver_id, delivered_by, warehouse_id, notes, status)
  values (v_user, null, v_warehouse_id, p_notes, 'requested')
  returning id into v_delivery_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into driver_delivery_items(delivery_id, product_model_id, quantity)
    values (v_delivery_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  return v_delivery_id;
end;
$$ language plpgsql security definer;

-- 2c) EL ALMACÉN PREPARA/PROCESA UNA SOLICITUD DE PEDIDO: puede editar los
--     modelos/cantidades (por ejemplo si un modelo no existe todavía o no
--     hay suficiente stock) y, al procesarla, pasa a 'pending' — a partir de
--     ahí sigue el flujo normal: el conductor debe aceptarlo o rechazarlo.
--     Sigue sin mover stock: eso solo pasa cuando el conductor acepta.
create or replace function fn_process_driver_order_request(
  p_order_id uuid,
  p_items jsonb, -- [{"product_model_id": "...", "quantity": n}, ...]
  p_notes text default null
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_status driver_order_status;
  v_item jsonb;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden procesar un pedido';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no puede quedar vacío';
  end if;

  select status into v_status from driver_deliveries where id = p_order_id for update;
  if v_status is null then
    raise exception 'El pedido no existe';
  end if;
  if v_status <> 'requested' then
    raise exception 'Este pedido ya fue procesado';
  end if;

  delete from driver_delivery_items where delivery_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into driver_delivery_items(delivery_id, product_model_id, quantity)
    values (p_order_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  update driver_deliveries
    set status = 'pending', delivered_by = v_user, delivered_at = now(),
        notes = coalesce(p_notes, notes)
    where id = p_order_id;
end;
$$ language plpgsql security definer;

-- 3) EL CONDUCTOR RESPONDE A SU PEDIDO (aceptar mueve el stock; rechazar no)
create or replace function fn_respond_driver_order(
  p_delivery_id uuid,
  p_accept boolean
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_driver_id uuid;
  v_warehouse_id uuid;
  v_status driver_order_status;
  v_item record;
  v_current_stock integer;
begin
  select driver_id, warehouse_id, status into v_driver_id, v_warehouse_id, v_status
    from driver_deliveries where id = p_delivery_id for update;

  if v_driver_id is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_driver_id <> v_user then
    raise exception 'Este pedido no te pertenece';
  end if;
  if v_status <> 'pending' then
    raise exception 'Este pedido ya fue respondido, o todavía no lo ha preparado el almacén';
  end if;

  if not p_accept then
    update driver_deliveries set status = 'rejected', responded_at = now() where id = p_delivery_id;
    return;
  end if;

  for v_item in select product_model_id, quantity from driver_delivery_items where delivery_id = p_delivery_id
  loop
    select quantity into v_current_stock from warehouse_stock
      where warehouse_id = v_warehouse_id and product_model_id = v_item.product_model_id
      for update;

    if v_current_stock is null or v_current_stock < v_item.quantity then
      raise exception 'Stock insuficiente en almacén para el modelo % (disponible: %)', v_item.product_model_id, coalesce(v_current_stock, 0);
    end if;

    update warehouse_stock set quantity = quantity - v_item.quantity, updated_at = now()
      where warehouse_id = v_warehouse_id and product_model_id = v_item.product_model_id;

    insert into driver_stock(driver_id, product_model_id, quantity)
    values (v_driver_id, v_item.product_model_id, v_item.quantity)
    on conflict (driver_id, product_model_id)
    do update set quantity = driver_stock.quantity + excluded.quantity, updated_at = now();

    insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
    values ('dispatch_to_driver', v_item.product_model_id, v_item.quantity, 'warehouse', 'driver:' || v_driver_id::text, 'driver_deliveries', p_delivery_id, v_user);
  end loop;

  update driver_deliveries set status = 'accepted', responded_at = now() where id = p_delivery_id;
end;
$$ language plpgsql security definer;

-- 3b) DESHACER/CANCELAR UN PEDIDO. Si sigue 'requested', el propio conductor
-- que lo pidió (o admin/almacenero) puede cancelarlo. Si ya está 'pending'
-- (preparado y enviado), solo admin/almacenero, y solo mientras el conductor
-- no lo haya respondido. En ningún caso hay stock movido todavía, así que
-- basta con borrar: es como si nunca se hubiera creado.
create or replace function fn_cancel_driver_order(p_order_id uuid)
returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_status driver_order_status;
  v_driver_id uuid;
begin
  select role into v_role from profiles where id = v_user;
  select status, driver_id into v_status, v_driver_id from driver_deliveries where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido no existe';
  end if;

  if v_status = 'requested' then
    if v_driver_id is distinct from v_user and v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
      raise exception 'No puedes cancelar este pedido';
    end if;
  elsif v_status = 'pending' then
    if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
      raise exception 'Solo el almacén o un administrador pueden deshacer un pedido ya preparado';
    end if;
  else
    raise exception 'Solo se puede deshacer un pedido que todavía está pendiente';
  end if;

  delete from driver_deliveries where id = p_order_id;
end;
$$ language plpgsql security definer;

-- 4) VENTA DE CONDUCTOR (resta stock del conductor, suma a su billetera).
--    Admite venta de garantía (0€, o solo la diferencia si sube de gama).
create or replace function fn_driver_sale(
  p_driver_id uuid,
  p_product_model_id uuid,
  p_ean_code text,
  p_quantity integer,
  p_amount_cash numeric,
  p_amount_card numeric,
  p_is_warranty boolean default false,
  p_customer_vehicle_plate text default null,
  p_old_battery_returned boolean default null,
  p_old_battery_reason text default null,
  p_sale_origin sale_origin_type default 'particular',
  p_notes text default null,
  p_battery_unit_id uuid default null,
  p_customer_vehicle_model text default null
) returns uuid as $$
declare
  v_sale_id uuid;
  v_user uuid := auth.uid();
  v_current_stock integer;
  v_method payment_method;
  v_total numeric;
  v_unit_driver_id uuid;
  v_unit_model_id uuid;
  v_unit_status text;
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  if p_old_battery_returned is false and coalesce(trim(p_old_battery_reason), '') = '' then
    raise exception 'Indica el motivo por el que no se recoge la batería vieja';
  end if;

  select quantity into v_current_stock from driver_stock
    where driver_id = p_driver_id and product_model_id = p_product_model_id
    for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Stock insuficiente del conductor (disponible: %)', coalesce(v_current_stock, 0);
  end if;

  if p_battery_unit_id is not null then
    select driver_id, product_model_id, status into v_unit_driver_id, v_unit_model_id, v_unit_status
      from battery_units where id = p_battery_unit_id for update;
    if v_unit_driver_id is null then
      raise exception 'El code de batería indicado no existe';
    end if;
    if v_unit_driver_id <> p_driver_id or v_unit_model_id <> p_product_model_id then
      raise exception 'El code de batería indicado no corresponde a este conductor/modelo';
    end if;
    if v_unit_status <> 'assigned' then
      raise exception 'Esa batería ya no está disponible (code ya usado o devuelto)';
    end if;
  end if;

  v_total := coalesce(p_amount_cash,0) + coalesce(p_amount_card,0);
  if not p_is_warranty and v_total <= 0 then
    raise exception 'El importe cobrado debe ser mayor que 0';
  end if;

  if p_amount_cash > 0 and p_amount_card > 0 then
    v_method := 'mixed';
  elsif p_amount_card > 0 then
    v_method := 'card';
  elsif p_amount_cash > 0 then
    v_method := 'cash';
  elsif p_is_warranty then
    v_method := 'warranty';
  else
    v_method := 'cash';
  end if;

  update driver_stock set quantity = quantity - p_quantity, updated_at = now()
    where driver_id = p_driver_id and product_model_id = p_product_model_id;

  insert into sales(seller_id, sale_channel, payment_method, amount_cash, amount_card, total_amount, notes,
                     is_warranty, customer_vehicle_plate, customer_vehicle_model, old_battery_returned, old_battery_reason, sale_origin)
  values (p_driver_id, 'driver', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_customer_vehicle_model, p_old_battery_returned, p_old_battery_reason, p_sale_origin)
  returning id into v_sale_id;

  insert into sale_items(sale_id, product_model_id, ean_code, quantity, unit_price, battery_unit_id)
  values (v_sale_id, p_product_model_id, p_ean_code, p_quantity, v_total / p_quantity, p_battery_unit_id);

  if p_battery_unit_id is not null then
    update battery_units set status = 'sold', sale_id = v_sale_id, sold_at = now()
      where id = p_battery_unit_id;
  end if;

  insert into driver_wallets(driver_id, cash_balance, card_balance)
  values (p_driver_id, coalesce(p_amount_cash,0), coalesce(p_amount_card,0))
  on conflict (driver_id)
  do update set
    cash_balance = driver_wallets.cash_balance + coalesce(p_amount_cash,0),
    card_balance = driver_wallets.card_balance + coalesce(p_amount_card,0),
    updated_at = now();

  if p_amount_cash > 0 then
    insert into driver_wallet_transactions(driver_id, amount, method, type, related_sale_id, created_by)
    values (p_driver_id, p_amount_cash, 'cash', 'sale', v_sale_id, v_user);
  end if;
  if p_amount_card > 0 then
    insert into driver_wallet_transactions(driver_id, amount, method, type, related_sale_id, created_by)
    values (p_driver_id, p_amount_card, 'card', 'sale', v_sale_id, v_user);
  end if;

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('sale_driver', p_product_model_id, -p_quantity, 'driver:' || p_driver_id, 'customer', 'sales', v_sale_id, v_user);

  return v_sale_id;
end;
$$ language plpgsql security definer;

-- 5) VENTA DIRECTA DESDE ALMACÉN (almacenero/admin, funciona como venta de
--    conductor pero descuenta directamente del almacén central)
create or replace function fn_warehouse_sale(
  p_seller_id uuid,
  p_warehouse_id uuid,
  p_product_model_id uuid,
  p_ean_code text,
  p_quantity integer,
  p_amount_cash numeric,
  p_amount_card numeric,
  p_is_warranty boolean default false,
  p_customer_vehicle_plate text default null,
  p_old_battery_returned boolean default null,
  p_old_battery_reason text default null,
  p_sale_origin sale_origin_type default 'particular',
  p_notes text default null,
  p_customer_vehicle_model text default null,
  p_battery_code text default null
) returns uuid as $$
declare
  v_sale_id uuid;
  v_user uuid := auth.uid();
  v_current_stock integer;
  v_method payment_method;
  v_total numeric;
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  if p_old_battery_returned is false and coalesce(trim(p_old_battery_reason), '') = '' then
    raise exception 'Indica el motivo por el que no se recoge la batería vieja';
  end if;

  select quantity into v_current_stock from warehouse_stock
    where warehouse_id = p_warehouse_id and product_model_id = p_product_model_id
    for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Stock insuficiente en almacén (disponible: %)', coalesce(v_current_stock, 0);
  end if;

  v_total := coalesce(p_amount_cash,0) + coalesce(p_amount_card,0);
  if not p_is_warranty and v_total <= 0 then
    raise exception 'El importe cobrado debe ser mayor que 0';
  end if;

  if p_amount_cash > 0 and p_amount_card > 0 then
    v_method := 'mixed';
  elsif p_amount_card > 0 then
    v_method := 'card';
  elsif p_amount_cash > 0 then
    v_method := 'cash';
  elsif p_is_warranty then
    v_method := 'warranty';
  else
    v_method := 'cash';
  end if;

  update warehouse_stock set quantity = quantity - p_quantity, updated_at = now()
    where warehouse_id = p_warehouse_id and product_model_id = p_product_model_id;

  insert into sales(seller_id, sale_channel, payment_method, amount_cash, amount_card, total_amount, notes,
                     is_warranty, customer_vehicle_plate, customer_vehicle_model, old_battery_returned, old_battery_reason, sale_origin)
  values (p_seller_id, 'warehouse_direct', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_customer_vehicle_model, p_old_battery_returned, p_old_battery_reason, p_sale_origin)
  returning id into v_sale_id;

  insert into sale_items(sale_id, product_model_id, ean_code, quantity, unit_price, battery_code_manual)
  values (v_sale_id, p_product_model_id, p_ean_code, p_quantity, v_total / p_quantity, nullif(trim(coalesce(p_battery_code, '')), ''));

  -- El dinero de venta directa de almacén va a la caja de oficina (no a la
  -- billetera personal de quien tenga la sesión iniciada).
  update office_wallet
    set cash_balance = cash_balance + coalesce(p_amount_cash,0),
        card_balance = card_balance + coalesce(p_amount_card,0),
        updated_at = now()
    where id = 1;

  if p_amount_cash > 0 then
    insert into office_wallet_transactions(amount, method, type, related_sale_id, created_by)
    values (p_amount_cash, 'cash', 'sale', v_sale_id, v_user);
  end if;
  if p_amount_card > 0 then
    insert into office_wallet_transactions(amount, method, type, related_sale_id, created_by)
    values (p_amount_card, 'card', 'sale', v_sale_id, v_user);
  end if;

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('sale_warehouse_direct', p_product_model_id, -p_quantity, 'warehouse', 'customer', 'sales', v_sale_id, v_user);

  return v_sale_id;
end;
$$ language plpgsql security definer;

-- 5b) RESET DE CAJA DE OFICINA (solo admin, deja histórico)
create or replace function fn_reset_office_wallet()
returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_cash numeric;
  v_card numeric;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' then
    raise exception 'Solo un administrador puede reiniciar la caja de oficina';
  end if;

  select cash_balance, card_balance into v_cash, v_card from office_wallet where id = 1;

  insert into office_wallet_transactions(amount, method, type, created_by, notes)
  values (-coalesce(v_cash,0), 'cash', 'reset', v_user, 'Reinicio de caja de oficina por administrador'),
         (-coalesce(v_card,0), 'card', 'reset', v_user, 'Reinicio de caja de oficina por administrador');

  update office_wallet
    set cash_balance = 0, card_balance = 0, last_reset_at = now(), last_reset_by = v_user, updated_at = now()
    where id = 1;
end;
$$ language plpgsql security definer;

-- 6) RESET DE BILLETERA (solo admin, deja histórico)
create or replace function fn_reset_driver_wallet(p_driver_id uuid)
returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_cash numeric;
  v_card numeric;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' then
    raise exception 'Solo un administrador puede reiniciar la billetera';
  end if;

  select cash_balance, card_balance into v_cash, v_card from driver_wallets where driver_id = p_driver_id;

  insert into driver_wallet_transactions(driver_id, amount, method, type, created_by, notes)
  values (p_driver_id, -coalesce(v_cash,0), 'cash', 'reset', v_user, 'Reinicio de caja por administrador'),
         (p_driver_id, -coalesce(v_card,0), 'card', 'reset', v_user, 'Reinicio de caja por administrador');

  update driver_wallets
    set cash_balance = 0, card_balance = 0, last_reset_at = now(), last_reset_by = v_user, updated_at = now()
    where driver_id = p_driver_id;
end;
$$ language plpgsql security definer;

-- 6b) EL ADMIN RETIRA STOCK A UN CONDUCTOR Y LO DEVUELVE AL ALMACÉN (no es una
-- devolución de cliente/garantía: es simplemente corregir/recuperar stock que
-- el conductor lleva encima). Solo admin.
create or replace function fn_admin_reclaim_driver_stock(
  p_driver_id uuid,
  p_product_model_id uuid,
  p_quantity integer,
  p_warehouse_id uuid default null,
  p_notes text default null
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_current_stock integer;
  v_dest_warehouse uuid;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' then
    raise exception 'Solo un administrador puede retirar stock a un conductor';
  end if;

  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  select quantity into v_current_stock from driver_stock
    where driver_id = p_driver_id and product_model_id = p_product_model_id
    for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'El conductor no tiene esa cantidad en su stock (disponible: %)', coalesce(v_current_stock, 0);
  end if;

  v_dest_warehouse := coalesce(
    p_warehouse_id,
    (select id from warehouses where is_warranty_holding = false and active = true order by created_at limit 1)
  );

  update driver_stock set quantity = quantity - p_quantity, updated_at = now()
    where driver_id = p_driver_id and product_model_id = p_product_model_id;

  insert into warehouse_stock(warehouse_id, product_model_id, quantity)
  values (v_dest_warehouse, p_product_model_id, p_quantity)
  on conflict (warehouse_id, product_model_id)
  do update set quantity = warehouse_stock.quantity + excluded.quantity, updated_at = now();

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values (
    'return_to_warehouse', p_product_model_id, p_quantity,
    'driver:' || p_driver_id::text, 'warehouse:' || v_dest_warehouse::text,
    'profiles', p_driver_id, v_user
  );
end;
$$ language plpgsql security definer;

-- 7) VENTA COMERCIAL (genera factura en borrador con precios en blanco)
create or replace function fn_commercial_sale(
  p_seller_id uuid,
  p_warehouse_id uuid,
  p_point_of_sale_id uuid,
  p_items jsonb
) returns uuid as $$
declare
  v_sale_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_user uuid := auth.uid();
  v_item jsonb;
  v_current_stock integer;
begin
  insert into sales(seller_id, sale_channel, payment_method, total_amount)
  values (p_seller_id, 'commercial', 'transfer', 0)
  returning id into v_sale_id;

  v_invoice_number := 'FAC-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_sale_id::text, 1, 8);

  insert into invoices(invoice_number, sale_id, point_of_sale_id, issued_by, status, subtotal, total)
  values (v_invoice_number, v_sale_id, p_point_of_sale_id, v_user, 'draft', 0, 0)
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select quantity into v_current_stock from warehouse_stock
      where warehouse_id = p_warehouse_id and product_model_id = (v_item->>'product_model_id')::uuid
      for update;

    if v_current_stock is null or v_current_stock < (v_item->>'quantity')::integer then
      raise exception 'Stock insuficiente para el modelo %', v_item->>'product_model_id';
    end if;

    update warehouse_stock set quantity = quantity - (v_item->>'quantity')::integer, updated_at = now()
      where warehouse_id = p_warehouse_id and product_model_id = (v_item->>'product_model_id')::uuid;

    insert into sale_items(sale_id, product_model_id, ean_code, quantity)
    values (v_sale_id, (v_item->>'product_model_id')::uuid, v_item->>'ean_code', (v_item->>'quantity')::integer);

    insert into invoice_items(invoice_id, product_model_id, description, quantity, unit_price, line_total)
    select v_invoice_id, pm.id, pm.brand || ' ' || pm.model_name, (v_item->>'quantity')::integer, null, null
    from product_models pm where pm.id = (v_item->>'product_model_id')::uuid;

    insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
    values ('sale_commercial', (v_item->>'product_model_id')::uuid, -(v_item->>'quantity')::integer, 'warehouse', 'customer', 'sales', v_sale_id, v_user);
  end loop;

  return v_invoice_id;
end;
$$ language plpgsql security definer;

-- 7b) PEDIDO COMERCIAL: admin/comercial lo solicita (sin mover stock
--     todavía). Sustituye a la venta comercial con factura: aquí solo se
--     registra una SALIDA de almacén hacia una empresa/taller concreto.
create or replace function fn_create_commercial_order(
  p_point_of_sale_id uuid,
  p_warehouse_id uuid,
  p_items jsonb, -- [{"product_model_id": "...", "quantity": n}, ...]
  p_notes text default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_user uuid := auth.uid();
  v_role user_role;
  v_item jsonb;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'comercial' then
    raise exception 'Solo un administrador o comercial puede solicitar un pedido comercial';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no puede estar vacío';
  end if;

  insert into commercial_orders(point_of_sale_id, warehouse_id, requested_by, notes, status)
  values (p_point_of_sale_id, p_warehouse_id, v_user, p_notes, 'pending')
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into commercial_order_items(order_id, product_model_id, quantity)
    values (v_order_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  return v_order_id;
end;
$$ language plpgsql security definer;

-- 7c) EL ALMACÉN PREPARA Y DA SALIDA A UN PEDIDO COMERCIAL: puede editar
--     modelos/cantidades (por ejemplo si un modelo no existía) y, al dar
--     salida, se descuenta el stock del almacén y queda registrada la
--     salida (fecha, empresa, quién la dio).
create or replace function fn_dispatch_commercial_order(
  p_order_id uuid,
  p_items jsonb default null, -- si se pasa, sustituye los ítems antes de dar salida
  p_notes text default null
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_status commercial_order_status;
  v_warehouse_id uuid;
  v_item record;
  v_current_stock integer;
  v_original_qty integer;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden dar salida a un pedido comercial';
  end if;

  select status, warehouse_id into v_status, v_warehouse_id from commercial_orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'El pedido no existe';
  end if;
  if v_status <> 'pending' then
    raise exception 'Este pedido ya fue procesado';
  end if;

  if p_items is not null then
    if jsonb_array_length(p_items) = 0 then
      raise exception 'El pedido no puede quedar vacío';
    end if;

    -- No se puede superar, para un modelo que ya estaba en el pedido, la
    -- cantidad originalmente pedida (si el pedido era de 100, no se puede
    -- dar salida a 101 de ese modelo). Modelos nuevos añadidos al preparar
    -- la salida no tienen tope aquí (solo el del stock, más abajo).
    for v_item in
      select (i->>'product_model_id')::uuid as product_model_id, (i->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) as i
    loop
      select quantity into v_original_qty from commercial_order_items
        where order_id = p_order_id and product_model_id = v_item.product_model_id;
      if v_original_qty is not null and v_item.quantity > v_original_qty then
        raise exception 'No puedes superar la cantidad pedida para ese modelo (pedidas: %, intentas dar salida a: %)', v_original_qty, v_item.quantity;
      end if;
    end loop;

    delete from commercial_order_items where order_id = p_order_id;
    insert into commercial_order_items(order_id, product_model_id, quantity)
    select p_order_id, (i->>'product_model_id')::uuid, (i->>'quantity')::integer
    from jsonb_array_elements(p_items) as i;
  end if;

  for v_item in select product_model_id, quantity from commercial_order_items where order_id = p_order_id
  loop
    select quantity into v_current_stock from warehouse_stock
      where warehouse_id = v_warehouse_id and product_model_id = v_item.product_model_id
      for update;

    if v_current_stock is null or v_current_stock < v_item.quantity then
      raise exception 'Stock insuficiente en almacén para el modelo % (disponible: %)', v_item.product_model_id, coalesce(v_current_stock, 0);
    end if;

    update warehouse_stock set quantity = quantity - v_item.quantity, updated_at = now()
      where warehouse_id = v_warehouse_id and product_model_id = v_item.product_model_id;

    insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
    values ('sale_commercial', v_item.product_model_id, -v_item.quantity, 'warehouse', 'commercial_order', 'commercial_orders', p_order_id, v_user);
  end loop;

  update commercial_orders
    set status = 'dispatched', dispatched_by = v_user, dispatched_at = now(),
        notes = coalesce(p_notes, notes)
    where id = p_order_id;
end;
$$ language plpgsql security definer;

-- 7d) CANCELAR UN PEDIDO COMERCIAL MIENTRAS SIGA PENDIENTE (no se ha movido
--     stock todavía)
create or replace function fn_cancel_commercial_order(p_order_id uuid)
returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_status commercial_order_status;
  v_requested_by uuid;
begin
  select role into v_role from profiles where id = v_user;
  select status, requested_by into v_status, v_requested_by from commercial_orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'El pedido no existe';
  end if;
  if v_status <> 'pending' then
    raise exception 'Solo se puede cancelar un pedido que todavía está pendiente de salida';
  end if;
  if v_requested_by is distinct from v_user and v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'No puedes cancelar este pedido';
  end if;

  update commercial_orders set status = 'cancelled' where id = p_order_id;
end;
$$ language plpgsql security definer;

-- 7d-bis) ENTREGA DIRECTA A UNA EMPRESA: crea el pedido y le da salida en el
-- mismo paso (admin/almacenero) — para cuando no hace falta el circuito
-- completo de "pedido pendiente -> procesar -> dar salida".
create or replace function fn_direct_commercial_delivery(
  p_point_of_sale_id uuid,
  p_warehouse_id uuid,
  p_items jsonb, -- [{"product_model_id": "...", "quantity": n}, ...]
  p_notes text default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_user uuid := auth.uid();
  v_role user_role;
  v_item jsonb;
  v_current_stock integer;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden hacer una entrega directa';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'La entrega no puede estar vacía';
  end if;

  insert into commercial_orders(point_of_sale_id, warehouse_id, requested_by, dispatched_by, notes, status, dispatched_at)
  values (p_point_of_sale_id, p_warehouse_id, v_user, v_user, p_notes, 'dispatched', now())
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select quantity into v_current_stock from warehouse_stock
      where warehouse_id = p_warehouse_id and product_model_id = (v_item->>'product_model_id')::uuid
      for update;

    if v_current_stock is null or v_current_stock < (v_item->>'quantity')::integer then
      raise exception 'Stock insuficiente para el modelo %', v_item->>'product_model_id';
    end if;

    update warehouse_stock set quantity = quantity - (v_item->>'quantity')::integer, updated_at = now()
      where warehouse_id = p_warehouse_id and product_model_id = (v_item->>'product_model_id')::uuid;

    insert into commercial_order_items(order_id, product_model_id, quantity)
    values (v_order_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);

    insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
    values ('sale_commercial', (v_item->>'product_model_id')::uuid, -(v_item->>'quantity')::integer, 'warehouse', 'commercial_order', 'commercial_orders', v_order_id, v_user);
  end loop;

  return v_order_id;
end;
$$ language plpgsql security definer;

-- 7e) PRÉSTAMOS: sale del almacén sin ser una venta (admin/almacenero)
create or replace function fn_create_loan(
  p_product_model_id uuid,
  p_quantity integer,
  p_borrower_name text,
  p_borrower_contact text default null,
  p_notes text default null,
  p_warehouse_id uuid default null
) returns uuid as $$
declare
  v_loan_id uuid;
  v_user uuid := auth.uid();
  v_role user_role;
  v_warehouse_id uuid;
  v_current_stock integer;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden registrar un préstamo';
  end if;

  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;
  if coalesce(trim(p_borrower_name), '') = '' then
    raise exception 'Indica a quién se le presta';
  end if;

  v_warehouse_id := coalesce(
    p_warehouse_id,
    (select id from warehouses where is_warranty_holding = false and active = true order by created_at limit 1)
  );

  select quantity into v_current_stock from warehouse_stock
    where warehouse_id = v_warehouse_id and product_model_id = p_product_model_id
    for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Stock insuficiente en almacén (disponible: %)', coalesce(v_current_stock, 0);
  end if;

  update warehouse_stock set quantity = quantity - p_quantity, updated_at = now()
    where warehouse_id = v_warehouse_id and product_model_id = p_product_model_id;

  insert into loans(product_model_id, warehouse_id, quantity, borrower_name, borrower_contact, loaned_by, notes)
  values (p_product_model_id, v_warehouse_id, p_quantity, p_borrower_name, p_borrower_contact, v_user, p_notes)
  returning id into v_loan_id;

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('adjustment', p_product_model_id, -p_quantity, 'warehouse', 'loan:' || v_loan_id::text, 'loans', v_loan_id, v_user);

  return v_loan_id;
end;
$$ language plpgsql security definer;

-- 7f) DEVOLUCIÓN DE UN PRÉSTAMO: repone el stock del almacén (total o
--     parcialmente). Se usa desde Recepción marcando "es la devolución de
--     un préstamo" en vez de dar de alta stock nuevo.
create or replace function fn_return_loan(
  p_loan_id uuid,
  p_quantity integer,
  p_notes text default null
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_loan record;
  v_remaining integer;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden registrar la devolución de un préstamo';
  end if;

  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  select * into v_loan from loans where id = p_loan_id for update;
  if v_loan is null then
    raise exception 'El préstamo no existe';
  end if;

  v_remaining := v_loan.quantity - v_loan.quantity_returned;
  if p_quantity > v_remaining then
    raise exception 'Solo quedan % unidades pendientes de devolver de este préstamo', v_remaining;
  end if;

  update warehouse_stock set quantity = quantity + p_quantity, updated_at = now()
    where warehouse_id = v_loan.warehouse_id and product_model_id = v_loan.product_model_id;
  if not found then
    insert into warehouse_stock(warehouse_id, product_model_id, quantity)
    values (v_loan.warehouse_id, v_loan.product_model_id, p_quantity);
  end if;

  insert into loan_returns(loan_id, quantity, returned_by, notes)
  values (p_loan_id, p_quantity, v_user, p_notes);

  update loans
    set quantity_returned = quantity_returned + p_quantity,
        status = (case when quantity_returned + p_quantity >= quantity then 'devuelto' else 'parcial' end)::loan_status
    where id = p_loan_id;

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('return_to_warehouse', v_loan.product_model_id, p_quantity, 'loan:' || p_loan_id::text, 'warehouse', 'loans', p_loan_id, v_user);
end;
$$ language plpgsql security definer;

-- 8) DEVOLUCIONES: simples (vuelven al almacén normal) o de garantía (van a
--    un almacén aparte, sin mezclarse con el stock vendible)
create or replace function fn_process_return(
  p_type return_type,
  p_product_model_id uuid,
  p_quantity integer,
  p_source_driver_id uuid default null,
  p_destination_warehouse_id uuid default null,
  p_notes text default null
) returns uuid as $$
declare
  v_return_id uuid;
  v_user uuid := auth.uid();
  v_dest_warehouse uuid;
  v_current_driver_stock integer;
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  if p_type = 'garantia' then
    select id into v_dest_warehouse from warehouses where is_warranty_holding = true limit 1;
    if v_dest_warehouse is null then
      raise exception 'No existe un almacén de garantías configurado';
    end if;
  else
    v_dest_warehouse := coalesce(
      p_destination_warehouse_id,
      (select id from warehouses where is_warranty_holding = false and active = true order by created_at limit 1)
    );
  end if;

  if p_source_driver_id is not null then
    select quantity into v_current_driver_stock from driver_stock
      where driver_id = p_source_driver_id and product_model_id = p_product_model_id
      for update;
    if v_current_driver_stock is null or v_current_driver_stock < p_quantity then
      raise exception 'El conductor no tiene esa cantidad en su stock (disponible: %)', coalesce(v_current_driver_stock, 0);
    end if;
    update driver_stock set quantity = quantity - p_quantity, updated_at = now()
      where driver_id = p_source_driver_id and product_model_id = p_product_model_id;
  end if;

  insert into warehouse_stock(warehouse_id, product_model_id, quantity)
  values (v_dest_warehouse, p_product_model_id, p_quantity)
  on conflict (warehouse_id, product_model_id)
  do update set quantity = warehouse_stock.quantity + excluded.quantity, updated_at = now();

  insert into returns(type, product_model_id, quantity, source, source_driver_id, destination_warehouse_id, performed_by, notes)
  values (
    p_type, p_product_model_id, p_quantity,
    case when p_source_driver_id is not null then 'driver:' || p_source_driver_id::text else 'other' end,
    p_source_driver_id, v_dest_warehouse, v_user, p_notes
  )
  returning id into v_return_id;

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values (
    (case when p_type = 'garantia' then 'return_garantia' else 'return_to_warehouse' end)::movement_type,
    p_product_model_id, p_quantity,
    case when p_source_driver_id is not null then 'driver:' || p_source_driver_id::text else 'other' end,
    'warehouse:' || v_dest_warehouse::text,
    'returns', v_return_id, v_user
  );

  return v_return_id;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table profiles enable row level security;
alter table product_categories enable row level security;
alter table product_models enable row level security;
alter table product_ean_codes enable row level security;
alter table warehouses enable row level security;
alter table warehouse_stock enable row level security;
alter table suppliers enable row level security;
alter table receptions enable row level security;
alter table reception_items enable row level security;
alter table points_of_sale enable row level security;
alter table pos_stock enable row level security;
alter table driver_stock enable row level security;
alter table driver_deliveries enable row level security;
alter table driver_delivery_items enable row level security;
alter table driver_wallets enable row level security;
alter table driver_wallet_transactions enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table returns enable row level security;
alter table commercial_orders enable row level security;
alter table commercial_order_items enable row level security;
alter table loans enable row level security;
alter table loan_returns enable row level security;
alter table stock_movements enable row level security;

-- PROFILES
create policy profiles_select on profiles for select
  using (id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy profiles_update_self on profiles for update
  using (id = auth.uid() or current_user_role() = 'admin');
create policy profiles_admin_all on profiles for all
  using (current_user_role() = 'admin');

-- CATALOGO DE PRODUCTOS
create policy product_categories_read on product_categories for select using (auth.uid() is not null);
create policy product_categories_write on product_categories for all
  using (current_user_role() in ('admin','almacenero'));

create policy product_models_read on product_models for select using (auth.uid() is not null);
create policy product_models_write on product_models for insert
  with check (current_user_role() in ('admin','almacenero'));
create policy product_models_update on product_models for update
  using (current_user_role() in ('admin','almacenero'));
create policy product_models_delete on product_models for delete
  using (current_user_role() in ('admin','almacenero'));

create policy ean_codes_read on product_ean_codes for select using (auth.uid() is not null);
create policy ean_codes_write on product_ean_codes for insert
  with check (current_user_role() in ('admin','almacenero'));

-- ALMACENES Y STOCK: lectura admin/almacenero/comercial; conductor no ve stock central
create policy warehouses_read on warehouses for select
  using (current_user_role() in ('admin','almacenero','comercial'));
create policy warehouses_write on warehouses for all using (current_user_role() = 'admin');

create policy warehouse_stock_read on warehouse_stock for select
  using (current_user_role() in ('admin','almacenero','comercial'));
create policy warehouse_stock_write on warehouse_stock for all
  using (current_user_role() in ('admin','almacenero'));

create policy suppliers_read on suppliers for select
  using (current_user_role() in ('admin','almacenero'));
create policy suppliers_write on suppliers for all
  using (current_user_role() in ('admin','almacenero'));

create policy receptions_read on receptions for select
  using (current_user_role() in ('admin','almacenero'));
create policy receptions_write on receptions for insert
  with check (current_user_role() in ('admin','almacenero'));
create policy reception_items_read on reception_items for select
  using (current_user_role() in ('admin','almacenero'));
create policy reception_items_write on reception_items for insert
  with check (current_user_role() in ('admin','almacenero'));

-- VENTA COMERCIAL (clientes): almacenero/comercial pueden LEER; solo admin/comercial gestionan
create policy pos_read on points_of_sale for select
  using (current_user_role() in ('admin','comercial','almacenero'));
create policy pos_write on points_of_sale for all
  using (current_user_role() in ('admin','comercial'));

create policy pos_stock_read on pos_stock for select
  using (current_user_role() in ('admin','comercial','almacenero'));
create policy pos_stock_write on pos_stock for all
  using (current_user_role() in ('admin','comercial'));

-- STOCK DE CONDUCTOR
create policy driver_stock_read on driver_stock for select
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy driver_stock_write on driver_stock for all
  using (current_user_role() in ('admin','almacenero'));

-- PEDIDOS A CONDUCTOR: el conductor ve y puede responder los suyos; almacenero/admin los crean y ven todos
create policy driver_deliveries_read on driver_deliveries for select
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy driver_deliveries_write on driver_deliveries for insert
  with check (current_user_role() in ('admin','almacenero'));
create policy driver_deliveries_respond on driver_deliveries for update
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));

create policy driver_delivery_items_read on driver_delivery_items for select
  using (exists (select 1 from driver_deliveries d where d.id = delivery_id
    and (d.driver_id = auth.uid() or current_user_role() in ('admin','almacenero'))));
create policy driver_delivery_items_write on driver_delivery_items for insert
  with check (current_user_role() in ('admin','almacenero'));

-- BILLETERA (conductores y almaceneros con venta directa)
create policy driver_wallets_read on driver_wallets for select
  using (driver_id = auth.uid() or current_user_role() = 'admin');
create policy driver_wallets_write on driver_wallets for all
  using (current_user_role() = 'admin');

create policy driver_wallet_tx_read on driver_wallet_transactions for select
  using (driver_id = auth.uid() or current_user_role() = 'admin');
create policy driver_wallet_tx_write on driver_wallet_transactions for insert
  with check (driver_id = auth.uid() or current_user_role() = 'admin');

-- CAJA DE OFICINA (venta directa de almacén) — solo admin la consulta/gestiona
alter table office_wallet enable row level security;
alter table office_wallet_transactions enable row level security;
create policy office_wallet_read on office_wallet for select
  using (current_user_role() = 'admin');
create policy office_wallet_write on office_wallet for all
  using (current_user_role() in ('admin','almacenero'));
create policy office_wallet_tx_read on office_wallet_transactions for select
  using (current_user_role() = 'admin');
create policy office_wallet_tx_write on office_wallet_transactions for insert
  with check (current_user_role() in ('admin','almacenero'));

-- VENTAS
create policy sales_read on sales for select
  using (seller_id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy sales_write on sales for insert
  with check (seller_id = auth.uid() or current_user_role() = 'admin');

create policy sale_items_read on sale_items for select
  using (exists (select 1 from sales s where s.id = sale_id
    and (s.seller_id = auth.uid() or current_user_role() in ('admin','almacenero'))));
create policy sale_items_write on sale_items for insert with check (auth.uid() is not null);

-- FACTURAS
create policy invoices_read on invoices for select
  using (issued_by = auth.uid() or current_user_role() = 'admin');
create policy invoices_write on invoices for all
  using (issued_by = auth.uid() or current_user_role() = 'admin');

create policy invoice_items_read on invoice_items for select
  using (exists (select 1 from invoices i where i.id = invoice_id
    and (i.issued_by = auth.uid() or current_user_role() = 'admin')));
create policy invoice_items_write on invoice_items for all
  using (exists (select 1 from invoices i where i.id = invoice_id
    and (i.issued_by = auth.uid() or current_user_role() = 'admin')));

-- DEVOLUCIONES: admin/almacenero
create policy returns_read on returns for select
  using (current_user_role() in ('admin','almacenero'));
create policy returns_write on returns for insert
  with check (current_user_role() in ('admin','almacenero'));

-- PEDIDOS COMERCIALES: admin/almacenero/comercial leen y crean; solo
-- admin/almacenero editan (dar salida / cancelar se hace vía función, pero
-- dejamos también update por si acaso alguna acción futura lo necesita)
create policy commercial_orders_read on commercial_orders for select
  using (current_user_role() in ('admin','almacenero','comercial'));
create policy commercial_orders_insert on commercial_orders for insert
  with check (current_user_role() in ('admin','comercial'));
create policy commercial_orders_update on commercial_orders for update
  using (current_user_role() in ('admin','almacenero'));

create policy commercial_order_items_read on commercial_order_items for select
  using (exists (select 1 from commercial_orders o where o.id = order_id
    and current_user_role() in ('admin','almacenero','comercial')));
create policy commercial_order_items_write on commercial_order_items for all
  using (current_user_role() in ('admin','almacenero','comercial'));

-- PRÉSTAMOS: admin/almacenero
create policy loans_read on loans for select
  using (current_user_role() in ('admin','almacenero'));
create policy loans_write on loans for all
  using (current_user_role() in ('admin','almacenero'));

create policy loan_returns_read on loan_returns for select
  using (current_user_role() in ('admin','almacenero'));
create policy loan_returns_write on loan_returns for insert
  with check (current_user_role() in ('admin','almacenero'));

-- MOVIMIENTOS DE STOCK (ledger de negocio, no confundir con auditoría de usuarios)
create policy stock_movements_read on stock_movements for select
  using (current_user_role() in ('admin','almacenero')
    or from_location = 'driver:' || auth.uid()::text
    or to_location = 'driver:' || auth.uid()::text);
create policy stock_movements_write on stock_movements for insert with check (auth.uid() is not null);

-- ============================================================================
-- REALTIME: pedidos a conductor en vivo (para que "Pedidos pendientes" y el
-- aviso de rechazo se actualicen al instante, sin depender solo de sondeo)
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table driver_deliveries;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table driver_delivery_items;
exception when duplicate_object then
  null;
end $$;

alter table driver_deliveries replica identity full;

-- ============================================================================
-- DATOS INICIALES
-- ============================================================================
insert into warehouses (name, is_warranty_holding) values ('Almacén Central', false);
insert into warehouses (name, is_warranty_holding) values ('Almacén de Garantías', true);
insert into product_categories (name, slug) values ('Baterías', 'baterias');

-- NOTA: crea el primer usuario admin desde Supabase Auth y luego ejecuta:
-- insert into profiles (id, full_name, email, role)
-- values ('<uuid-del-usuario-auth>', 'Nombre Admin', 'admin@tuempresa.com', 'admin');
