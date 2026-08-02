-- ============================================================================
-- MIGRACIÓN 004b — el resto de la actualización grande (pedidos, devoluciones,
-- venta directa de almacén, garantía en ventas, permisos)
-- ============================================================================
-- Ejecuta esto DESPUÉS de que migration_004a_enum_values.sql haya terminado
-- (en una ejecución separada). No borra datos de negocio.
-- ----------------------------------------------------------------------------
-- 1) ELIMINAR POR COMPLETO EL SISTEMA DE AUDITORÍA (sin dejar rastro)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_audit_product_models on product_models;
drop trigger if exists trg_audit_warehouse_stock on warehouse_stock;
drop trigger if exists trg_audit_driver_stock on driver_stock;
drop trigger if exists trg_audit_pos_stock on pos_stock;
drop trigger if exists trg_audit_sales on sales;
drop trigger if exists trg_audit_driver_wallets on driver_wallets;
drop trigger if exists trg_audit_invoices on invoices;
drop trigger if exists trg_audit_points_of_sale on points_of_sale;
drop trigger if exists trg_audit_profiles on profiles;
drop function if exists audit_trigger_fn();
drop table if exists audit_log;

-- ----------------------------------------------------------------------------
-- 2) PERMITIR ELIMINAR USUARIOS DE VERDAD: las referencias históricas dejan de
--    bloquear el borrado (pasan a NULL en vez de impedirlo). El stock de un
--    conductor SIGUE bloqueando el borrado a propósito (eso se comprueba a
--    nivel de aplicación con un mensaje explícito antes de intentar borrar).
-- ----------------------------------------------------------------------------
alter table receptions alter column received_by drop not null;
alter table receptions drop constraint if exists receptions_received_by_fkey;
alter table receptions add constraint receptions_received_by_fkey
  foreign key (received_by) references profiles(id) on delete set null;

alter table driver_deliveries alter column driver_id drop not null;
alter table driver_deliveries drop constraint if exists driver_deliveries_driver_id_fkey;
alter table driver_deliveries add constraint driver_deliveries_driver_id_fkey
  foreign key (driver_id) references profiles(id) on delete set null;

alter table driver_deliveries alter column delivered_by drop not null;
alter table driver_deliveries drop constraint if exists driver_deliveries_delivered_by_fkey;
alter table driver_deliveries add constraint driver_deliveries_delivered_by_fkey
  foreign key (delivered_by) references profiles(id) on delete set null;

alter table driver_wallets drop constraint if exists driver_wallets_last_reset_by_fkey;
alter table driver_wallets add constraint driver_wallets_last_reset_by_fkey
  foreign key (last_reset_by) references profiles(id) on delete set null;

alter table driver_wallet_transactions drop constraint if exists driver_wallet_transactions_driver_id_fkey;
alter table driver_wallet_transactions add constraint driver_wallet_transactions_driver_id_fkey
  foreign key (driver_id) references profiles(id) on delete cascade;

alter table driver_wallet_transactions drop constraint if exists driver_wallet_transactions_created_by_fkey;
alter table driver_wallet_transactions add constraint driver_wallet_transactions_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table sales alter column seller_id drop not null;
alter table sales drop constraint if exists sales_seller_id_fkey;
alter table sales add constraint sales_seller_id_fkey
  foreign key (seller_id) references profiles(id) on delete set null;

alter table invoices alter column issued_by drop not null;
alter table invoices drop constraint if exists invoices_issued_by_fkey;
alter table invoices add constraint invoices_issued_by_fkey
  foreign key (issued_by) references profiles(id) on delete set null;

alter table stock_movements alter column performed_by drop not null;
alter table stock_movements drop constraint if exists stock_movements_performed_by_fkey;
alter table stock_movements add constraint stock_movements_performed_by_fkey
  foreign key (performed_by) references profiles(id) on delete set null;

alter table points_of_sale drop constraint if exists points_of_sale_created_by_fkey;
alter table points_of_sale add constraint points_of_sale_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table product_models drop constraint if exists product_models_created_by_fkey;
alter table product_models add constraint product_models_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 3) Los valores nuevos de enum ('warranty', 'sale_warehouse_direct',
--    'return_garantia') se añaden en migration_004a_enum_values.sql, que debe
--    haberse ejecutado y completado ANTES que este archivo, en una ejecución
--    separada. Si no lo has hecho todavía, para aquí y ejecútalo primero.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 4) NUEVOS TIPOS PARA PEDIDOS Y DEVOLUCIONES
-- ----------------------------------------------------------------------------
do $$ begin
  create type driver_order_status as enum ('pending', 'accepted', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type return_type as enum ('devolucion', 'garantia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_origin_type as enum ('particular', 'web', 'mapfre');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 5) PEDIDOS A CONDUCTOR: el conductor debe aceptar/rechazar antes de que se
--    mueva el stock. Añadimos el estado a las entregas existentes.
-- ----------------------------------------------------------------------------
alter table driver_deliveries add column if not exists status driver_order_status not null default 'accepted';
alter table driver_deliveries add column if not exists responded_at timestamptz;
-- Las entregas ya existentes (de antes de esta migración) se consideran ya
-- aceptadas, porque su stock YA se movió en su momento.
update driver_deliveries set status = 'accepted', responded_at = coalesce(responded_at, delivered_at) where status is null;

drop policy if exists driver_deliveries_write on driver_deliveries;
create policy driver_deliveries_write on driver_deliveries for insert
  with check (current_user_role() in ('admin','almacenero'));

drop policy if exists driver_deliveries_respond on driver_deliveries;
create policy driver_deliveries_respond on driver_deliveries for update
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));

-- La función antigua de entrega inmediata queda obsoleta: la sustituyen
-- fn_create_driver_order + fn_respond_driver_order (se crean más abajo).
drop function if exists fn_dispatch_to_driver(uuid, uuid, uuid, integer, text);

create or replace function fn_create_driver_order(
  p_warehouse_id uuid,
  p_driver_id uuid,
  p_items jsonb,
  p_notes text default null
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

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select quantity into v_current_stock from warehouse_stock
      where warehouse_id = p_warehouse_id and product_model_id = (v_item->>'product_model_id')::uuid;
    if v_current_stock is null or v_current_stock < (v_item->>'quantity')::integer then
      raise exception 'Stock insuficiente en almacén para el modelo %', v_item->>'product_model_id';
    end if;
  end loop;

  insert into driver_deliveries(driver_id, delivered_by, warehouse_id, notes, status)
  values (p_driver_id, v_user, p_warehouse_id, p_notes, 'pending')
  returning id into v_delivery_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into driver_delivery_items(delivery_id, product_model_id, quantity)
    values (v_delivery_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  return v_delivery_id;
end;
$$ language plpgsql security definer;

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
    raise exception 'Este pedido ya fue respondido';
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

-- ----------------------------------------------------------------------------
-- 6) CAMPOS NUEVOS EN VENTAS (matrícula, batería vieja, origen, garantía)
-- ----------------------------------------------------------------------------
alter table sales add column if not exists is_warranty boolean not null default false;
alter table sales add column if not exists customer_vehicle_plate text;
alter table sales add column if not exists old_battery_returned boolean;
alter table sales add column if not exists sale_origin sale_origin_type not null default 'particular';
create index if not exists idx_sales_channel_date on sales(sale_channel, sold_at);

-- ----------------------------------------------------------------------------
-- 7) VENTA DE CONDUCTOR: se actualiza para admitir garantía (0€ o solo la
--    diferencia) y los nuevos campos.
-- ----------------------------------------------------------------------------
drop function if exists fn_driver_sale(uuid, uuid, text, integer, numeric, numeric, text);

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
  p_sale_origin sale_origin_type default 'particular',
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
                     is_warranty, customer_vehicle_plate, old_battery_returned, sale_origin)
  values (p_driver_id, 'driver', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_old_battery_returned, p_sale_origin)
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

-- ----------------------------------------------------------------------------
-- 8) VENTA DIRECTA DESDE ALMACÉN (nuevo, para almacenero/admin)
-- ----------------------------------------------------------------------------
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
  p_sale_origin sale_origin_type default 'particular',
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
                     is_warranty, customer_vehicle_plate, old_battery_returned, sale_origin)
  values (p_seller_id, 'warehouse_direct', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_old_battery_returned, p_sale_origin)
  returning id into v_sale_id;

  insert into sale_items(sale_id, product_model_id, ean_code, quantity, unit_price)
  values (v_sale_id, p_product_model_id, p_ean_code, p_quantity, v_total / p_quantity);

  insert into driver_wallets(driver_id, cash_balance, card_balance)
  values (p_seller_id, coalesce(p_amount_cash,0), coalesce(p_amount_card,0))
  on conflict (driver_id)
  do update set
    cash_balance = driver_wallets.cash_balance + coalesce(p_amount_cash,0),
    card_balance = driver_wallets.card_balance + coalesce(p_amount_card,0),
    updated_at = now();

  if p_amount_cash > 0 then
    insert into driver_wallet_transactions(driver_id, amount, method, type, related_sale_id, created_by)
    values (p_seller_id, p_amount_cash, 'cash', 'sale', v_sale_id, v_user);
  end if;
  if p_amount_card > 0 then
    insert into driver_wallet_transactions(driver_id, amount, method, type, related_sale_id, created_by)
    values (p_seller_id, p_amount_card, 'card', 'sale', v_sale_id, v_user);
  end if;

  insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, reference_id, performed_by)
  values ('sale_warehouse_direct', p_product_model_id, -p_quantity, 'warehouse', 'customer', 'sales', v_sale_id, v_user);

  return v_sale_id;
end;
$$ language plpgsql security definer;

-- ----------------------------------------------------------------------------
-- 9) DEVOLUCIONES (nuevo): simples o de garantía (a almacén aparte)
-- ----------------------------------------------------------------------------
alter table warehouses add column if not exists is_warranty_holding boolean not null default false;

insert into warehouses (name, is_warranty_holding)
select 'Almacén de Garantías', true
where not exists (select 1 from warehouses where is_warranty_holding = true);

create table if not exists returns (
  id uuid primary key default uuid_generate_v4(),
  type return_type not null,
  product_model_id uuid not null references product_models(id),
  quantity integer not null check (quantity > 0),
  source text not null,
  source_driver_id uuid references profiles(id) on delete set null,
  destination_warehouse_id uuid not null references warehouses(id),
  performed_by uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_returns_type on returns(type);

alter table returns enable row level security;
drop policy if exists returns_read on returns;
create policy returns_read on returns for select
  using (current_user_role() in ('admin','almacenero'));
drop policy if exists returns_write on returns;
create policy returns_write on returns for insert
  with check (current_user_role() in ('admin','almacenero'));

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

-- ----------------------------------------------------------------------------
-- 10) EL ADMIN PUEDE RETIRAR STOCK A UN CONDUCTOR Y DEVOLVERLO AL ALMACÉN
-- ----------------------------------------------------------------------------
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

-- ============================================================================
-- Fin de la migración 004b.
--
-- VERIFICACIÓN (ejecútala y comprueba visualmente el resultado):
-- Debe devolver exactamente 2 almacenes: uno normal y otro de garantías con
-- is_warranty_holding = true. Si no ves el de garantías, las devoluciones de
-- tipo "garantía" fallarán con "No existe un almacén de garantías
-- configurado" — vuelve a ejecutar el bloque de la sección 9 de este archivo.
-- ============================================================================
select id, name, is_warranty_holding, active from warehouses order by is_warranty_holding;
