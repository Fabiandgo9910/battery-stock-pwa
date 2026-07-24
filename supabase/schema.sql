-- ============================================================================
-- SISTEMA DE GESTIÓN DE ALMACÉN Y VENTAS - ESQUEMA SUPABASE
-- Diseñado para baterías pero genérico (product_categories flexibles)
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
  'reception',        -- entrada de distribuidor al almacén
  'dispatch_to_driver',-- salida de almacén a conductor
  'dispatch_to_pos',   -- salida de almacén a punto de venta (comercial/pos)
  'sale_driver',       -- venta unitaria de un conductor
  'sale_commercial',   -- venta del comercial (factura, transferencia)
  'sale_pos',          -- venta desde un punto de venta
  'adjustment',        -- ajuste manual de stock (admin)
  'return_to_warehouse'-- devolución de conductor a almacén
);
create type payment_method as enum ('cash', 'card', 'transfer', 'mixed');
create type invoice_status as enum ('draft', 'issued', 'paid', 'cancelled');

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on profiles(role);

-- ---------------------------------------------------------------------------
-- PRODUCTOS - MODELO GENÉRICO (para que mañana no sea solo baterías)
-- ---------------------------------------------------------------------------
create table product_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,           -- ej: 'Baterías', 'Neumáticos', etc.
  slug text not null unique,
  attributes_schema jsonb not null default '{}', -- define campos dinámicos esperados
  created_at timestamptz not null default now()
);

-- Modelos de producto específicos. Para baterías: marca, modelo, amperaje, etc.
create table product_models (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references product_categories(id) on delete restrict,
  brand text not null,
  model_name text not null,
  -- Campos específicos de baterías (nullable para que sirva a otras categorías)
  amperage_ah numeric(6,2),               -- amperaje (Ah)
  cold_cranking_amps integer,             -- capacidad de arranque en frío (CCA)
  battery_tech battery_tech,              -- normal / agm / efb
  is_special boolean not null default false,
  special_reason text,
  -- Extensible: cualquier atributo adicional para otras categorías de producto
  extra_attributes jsonb not null default '{}',
  min_stock_alert integer not null default 5,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, brand, model_name, amperage_ah, cold_cranking_amps, battery_tech)
);

create index idx_product_models_category on product_models(category_id);
create index idx_product_models_brand on product_models(brand);

-- Códigos EAN/código de barras. Un modelo puede tener varios EAN (packs distintos del distribuidor)
create table product_ean_codes (
  id uuid primary key default uuid_generate_v4(),
  ean_code text not null unique,
  product_model_id uuid not null references product_models(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_ean_code on product_ean_codes(ean_code);

-- ---------------------------------------------------------------------------
-- ALMACÉN - STOCK CENTRAL
-- ---------------------------------------------------------------------------
create table warehouses (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'Almacén Central',
  address text,
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

-- Distribuidores (empresas que suministran)
create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  tax_id text,
  contact_phone text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Recepciones de mercancía (entrada por palet/lote)
create table receptions (
  id uuid primary key default uuid_generate_v4(),
  warehouse_id uuid not null references warehouses(id),
  supplier_id uuid references suppliers(id) on delete set null,
  received_by uuid not null references profiles(id),
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
-- PUNTOS DE VENTA (chiringuitos / clientes fijos)
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
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stock asignado/entregado a cada punto de venta
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

-- Historial de cada entrega de almacén a conductor
create table driver_deliveries (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null references profiles(id),
  delivered_by uuid not null references profiles(id), -- almacenero/admin que hizo la entrega
  warehouse_id uuid not null references warehouses(id),
  delivered_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create table driver_delivery_items (
  id uuid primary key default uuid_generate_v4(),
  delivery_id uuid not null references driver_deliveries(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  quantity integer not null check (quantity > 0)
);

-- ---------------------------------------------------------------------------
-- BILLETERA / CAJA DE CADA CONDUCTOR
-- ---------------------------------------------------------------------------
create table driver_wallets (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null unique references profiles(id) on delete cascade,
  cash_balance numeric(12,2) not null default 0,
  card_balance numeric(12,2) not null default 0,
  last_reset_at timestamptz,
  last_reset_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table driver_wallet_transactions (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null references profiles(id),
  amount numeric(12,2) not null,
  method payment_method not null, -- cash / card
  type text not null default 'sale', -- 'sale' | 'reset' | 'adjustment'
  related_sale_id uuid, -- referencia opcional a sales.id
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  notes text
);

-- ---------------------------------------------------------------------------
-- VENTAS (unificado: conductor unidad a unidad, comercial por factura, pos)
-- ---------------------------------------------------------------------------
create table sales (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references profiles(id), -- conductor o comercial
  sale_channel text not null, -- 'driver' | 'commercial' | 'pos'
  point_of_sale_id uuid references points_of_sale(id) on delete set null,
  payment_method payment_method not null,
  amount_cash numeric(12,2) not null default 0,
  amount_card numeric(12,2) not null default 0,
  amount_transfer numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  notes text
);

create table sale_items (
  id uuid primary key default uuid_generate_v4(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  ean_code text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2)
);

-- ---------------------------------------------------------------------------
-- FACTURAS (generadas por el rol Comercial, precio editable, en blanco por defecto)
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text not null unique,
  sale_id uuid references sales(id),
  point_of_sale_id uuid references points_of_sale(id) on delete set null,
  issued_by uuid not null references profiles(id),
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
  unit_price numeric(12,2), -- en blanco (null) hasta que se edite
  line_total numeric(12,2)
);

-- ---------------------------------------------------------------------------
-- MOVIMIENTOS DE STOCK (ledger unificado para trazabilidad total de inventario)
-- ---------------------------------------------------------------------------
create table stock_movements (
  id uuid primary key default uuid_generate_v4(),
  movement_type movement_type not null,
  product_model_id uuid not null references product_models(id),
  quantity integer not null, -- positivo = entra, negativo = sale (según origen/destino)
  from_location text,  -- 'warehouse' | 'driver:<id>' | 'pos:<id>' | 'supplier'
  to_location text,    -- idem
  reference_table text, -- tabla origen del movimiento (receptions, sales, driver_deliveries...)
  reference_id uuid,
  performed_by uuid not null references profiles(id),
  performed_at timestamptz not null default now()
);

create index idx_stock_movements_product on stock_movements(product_model_id);
create index idx_stock_movements_date on stock_movements(performed_at);

-- ---------------------------------------------------------------------------
-- AUDITORÍA GENERAL (trazabilidad de TODAS las acciones sensibles)
-- ---------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  action text not null,          -- ej: 'INSERT', 'UPDATE', 'DELETE'
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index idx_audit_log_table on audit_log(table_name);
create index idx_audit_log_user on audit_log(user_id);
create index idx_audit_log_date on audit_log(created_at);

-- ============================================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================================

-- updated_at automático
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

-- Auditoría genérica: se engancha a las tablas críticas
create or replace function audit_trigger_fn()
returns trigger as $$
declare
  v_user uuid;
begin
  begin
    v_user := auth.uid();
  exception when others then
    v_user := null;
  end;

  if (tg_op = 'DELETE') then
    insert into audit_log(user_id, action, table_name, record_id, old_data)
    values (v_user, tg_op, tg_table_name, old.id, to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into audit_log(user_id, action, table_name, record_id, old_data, new_data)
    values (v_user, tg_op, tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'INSERT') then
    insert into audit_log(user_id, action, table_name, record_id, new_data)
    values (v_user, tg_op, tg_table_name, new.id, to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger trg_audit_product_models
  after insert or update or delete on product_models
  for each row execute function audit_trigger_fn();
create trigger trg_audit_warehouse_stock
  after insert or update or delete on warehouse_stock
  for each row execute function audit_trigger_fn();
create trigger trg_audit_driver_stock
  after insert or update or delete on driver_stock
  for each row execute function audit_trigger_fn();
create trigger trg_audit_pos_stock
  after insert or update or delete on pos_stock
  for each row execute function audit_trigger_fn();
create trigger trg_audit_sales
  after insert or update or delete on sales
  for each row execute function audit_trigger_fn();
create trigger trg_audit_driver_wallets
  after insert or update or delete on driver_wallets
  for each row execute function audit_trigger_fn();
create trigger trg_audit_invoices
  after insert or update or delete on invoices
  for each row execute function audit_trigger_fn();
create trigger trg_audit_points_of_sale
  after insert or update or delete on points_of_sale
  for each row execute function audit_trigger_fn();
create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function audit_trigger_fn();

-- Helper: devuelve el rol del usuario autenticado actual
create or replace function current_user_role()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

-- ============================================================================
-- FUNCIONES DE NEGOCIO (RPC) - transacciones atómicas
-- ============================================================================

-- 1) RECEPCIÓN DE MERCANCÍA (entrada a almacén, registra movimiento y auditoría)
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

-- 2) ENTREGA DE ALMACÉN A CONDUCTOR (resta almacén, suma al conductor)
create or replace function fn_dispatch_to_driver(
  p_warehouse_id uuid,
  p_driver_id uuid,
  p_product_model_id uuid,
  p_quantity integer,
  p_notes text default null
) returns uuid as $$
declare
  v_delivery_id uuid;
  v_user uuid := auth.uid();
  v_current_stock integer;
begin
  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que 0';
  end if;

  select quantity into v_current_stock from warehouse_stock
    where warehouse_id = p_warehouse_id and product_model_id = p_product_model_id
    for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Stock insuficiente en almacén (disponible: %)', coalesce(v_current_stock, 0);
  end if;

  update warehouse_stock set quantity = quantity - p_quantity, updated_at = now()
    where warehouse_id = p_warehouse_id and product_model_id = p_product_model_id;

  insert into driver_deliveries(driver_id, delivered_by, warehouse_id, notes)
  values (p_driver_id, v_user, p_warehouse_id, p_notes)
  returning id into v_delivery_id;

  insert into driver_delivery_items(delivery_id, product_model_id, quantity)
  values (v_delivery_id, p_product_model_id, p_quantity);

  insert into driver_stock(driver_id, product_model_id, quantity)
  values (p_driver_id, p_product_model_id, p_quantity)
  on conflict (driver_id, product_model_id)
  do update set quantity = driver_stock.quantity + excluded.quantity, updated_at = now();

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('dispatch_to_driver', p_product_model_id, p_quantity, 'warehouse', 'driver:' || p_driver_id, 'driver_deliveries', v_delivery_id, v_user);

  return v_delivery_id;
end;
$$ language plpgsql security definer;

-- 3) VENTA DE CONDUCTOR (resta stock del conductor, suma a su billetera)
create or replace function fn_driver_sale(
  p_driver_id uuid,
  p_product_model_id uuid,
  p_ean_code text,
  p_quantity integer,
  p_amount_cash numeric,
  p_amount_card numeric,
  p_notes text default null
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

  select quantity into v_current_stock from driver_stock
    where driver_id = p_driver_id and product_model_id = p_product_model_id
    for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Stock insuficiente del conductor (disponible: %)', coalesce(v_current_stock, 0);
  end if;

  v_total := coalesce(p_amount_cash,0) + coalesce(p_amount_card,0);
  if v_total <= 0 then
    raise exception 'El importe cobrado debe ser mayor que 0';
  end if;

  if p_amount_cash > 0 and p_amount_card > 0 then
    v_method := 'mixed';
  elsif p_amount_card > 0 then
    v_method := 'card';
  else
    v_method := 'cash';
  end if;

  update driver_stock set quantity = quantity - p_quantity, updated_at = now()
    where driver_id = p_driver_id and product_model_id = p_product_model_id;

  insert into sales(seller_id, sale_channel, payment_method, amount_cash, amount_card, total_amount, notes)
  values (p_driver_id, 'driver', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes)
  returning id into v_sale_id;

  insert into sale_items(sale_id, product_model_id, ean_code, quantity, unit_price)
  values (v_sale_id, p_product_model_id, p_ean_code, p_quantity, v_total / p_quantity);

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

-- 4) RESET DE BILLETERA (solo admin, deja histórico)
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

-- 5) VENTA COMERCIAL (genera factura en borrador con precios en blanco)
create or replace function fn_commercial_sale(
  p_seller_id uuid,
  p_warehouse_id uuid,
  p_point_of_sale_id uuid,
  p_items jsonb -- [{"product_model_id": "...", "ean_code":"...", "quantity": n}, ...]
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
alter table stock_movements enable row level security;
alter table audit_log enable row level security;

-- PROFILES: cada uno ve el suyo; admin y almacenero ven todos (el almacenero
-- necesita ver la lista de conductores para poder entregarles stock)
create policy profiles_select on profiles for select
  using (id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy profiles_update_self on profiles for update
  using (id = auth.uid() or current_user_role() = 'admin');
create policy profiles_admin_all on profiles for all
  using (current_user_role() = 'admin');

-- CATALOGO DE PRODUCTOS: lectura para todos los autenticados, escritura admin/almacenero
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

-- PUNTOS DE VENTA (venta comercial): almacenero y comercial pueden LEER (para
-- poder elegir el cliente al vender), pero solo admin/comercial pueden
-- crear/editar/eliminar clientes.
create policy pos_read on points_of_sale for select
  using (current_user_role() in ('admin','comercial','almacenero'));
create policy pos_write on points_of_sale for all
  using (current_user_role() in ('admin','comercial'));

create policy pos_stock_read on pos_stock for select
  using (current_user_role() in ('admin','comercial','almacenero'));
create policy pos_stock_write on pos_stock for all
  using (current_user_role() in ('admin','comercial'));

-- STOCK DE CONDUCTOR: el propio conductor ve el suyo; admin/almacenero ven todos
create policy driver_stock_read on driver_stock for select
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy driver_stock_write on driver_stock for all
  using (current_user_role() in ('admin','almacenero'));

create policy driver_deliveries_read on driver_deliveries for select
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy driver_deliveries_write on driver_deliveries for insert
  with check (current_user_role() in ('admin','almacenero'));

create policy driver_delivery_items_read on driver_delivery_items for select
  using (exists (select 1 from driver_deliveries d where d.id = delivery_id
    and (d.driver_id = auth.uid() or current_user_role() in ('admin','almacenero'))));
create policy driver_delivery_items_write on driver_delivery_items for insert
  with check (current_user_role() in ('admin','almacenero'));

-- BILLETERA: el propio conductor ve la suya, admin ve todas
create policy driver_wallets_read on driver_wallets for select
  using (driver_id = auth.uid() or current_user_role() = 'admin');
create policy driver_wallets_write on driver_wallets for all
  using (current_user_role() = 'admin');

create policy driver_wallet_tx_read on driver_wallet_transactions for select
  using (driver_id = auth.uid() or current_user_role() = 'admin');
create policy driver_wallet_tx_write on driver_wallet_transactions for insert
  with check (driver_id = auth.uid() or current_user_role() = 'admin');

-- VENTAS: cada vendedor ve las suyas; admin ve todas; almacenero ve todas (para reportes)
create policy sales_read on sales for select
  using (seller_id = auth.uid() or current_user_role() in ('admin','almacenero'));
create policy sales_write on sales for insert
  with check (seller_id = auth.uid() or current_user_role() = 'admin');

create policy sale_items_read on sale_items for select
  using (exists (select 1 from sales s where s.id = sale_id
    and (s.seller_id = auth.uid() or current_user_role() in ('admin','almacenero'))));
create policy sale_items_write on sale_items for insert with check (auth.uid() is not null);

-- FACTURAS: comercial ve las suyas, admin ve todas
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

-- MOVIMIENTOS DE STOCK: lectura amplia para trazabilidad (admin/almacenero); conductor solo lo suyo
create policy stock_movements_read on stock_movements for select
  using (current_user_role() in ('admin','almacenero')
    or from_location = 'driver:' || auth.uid()::text
    or to_location = 'driver:' || auth.uid()::text);
create policy stock_movements_write on stock_movements for insert with check (auth.uid() is not null);

-- AUDITORÍA: solo admin
create policy audit_log_read on audit_log for select using (current_user_role() = 'admin');

-- ============================================================================
-- DATOS INICIALES
-- ============================================================================
insert into warehouses (name) values ('Almacén Central');
insert into product_categories (name, slug) values ('Baterías', 'baterias');

-- NOTA: crea el primer usuario admin desde Supabase Auth y luego ejecuta:
-- insert into profiles (id, full_name, email, role)
-- values ('<uuid-del-usuario-auth>', 'Nombre Admin', 'admin@tuempresa.com', 'admin');
