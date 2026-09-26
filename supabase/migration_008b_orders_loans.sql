-- ============================================================================
-- MIGRACIÓN 008b
-- Ejecuta esto DESPUÉS de que migration_008a_enum_values.sql haya terminado
-- (en una ejecución separada). No borra ningún dato existente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Nuevos tipos enum (tipos nuevos, no añaden valores a uno existente, así
--    que no tienen el problema de transacción de más arriba)
-- ----------------------------------------------------------------------------
do $$ begin
  create type commercial_order_status as enum ('pending', 'dispatched', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type loan_status as enum ('prestado', 'parcial', 'devuelto');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2) Motivo cuando NO se recoge la batería vieja (venta de conductor y venta
--    directa de almacén)
-- ----------------------------------------------------------------------------
alter table sales add column if not exists old_battery_reason text;

-- ----------------------------------------------------------------------------
-- 3) PEDIDOS COMERCIALES: admin/comercial piden, el almacén prepara y da
--    salida. Sustituye a la venta comercial con factura.
-- ----------------------------------------------------------------------------
create table if not exists commercial_orders (
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

create table if not exists commercial_order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references commercial_orders(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  quantity integer not null check (quantity > 0)
);

create index if not exists idx_commercial_orders_status on commercial_orders(status);
create index if not exists idx_commercial_orders_pos on commercial_orders(point_of_sale_id);

-- ----------------------------------------------------------------------------
-- 4) PRÉSTAMOS
-- ----------------------------------------------------------------------------
create table if not exists loans (
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

create table if not exists loan_returns (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid not null references loans(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  returned_by uuid references profiles(id) on delete set null,
  returned_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_loans_status on loans(status);

-- ----------------------------------------------------------------------------
-- 5) RLS de las tablas nuevas
-- ----------------------------------------------------------------------------
alter table commercial_orders enable row level security;
alter table commercial_order_items enable row level security;
alter table loans enable row level security;
alter table loan_returns enable row level security;

drop policy if exists commercial_orders_read on commercial_orders;
create policy commercial_orders_read on commercial_orders for select
  using (current_user_role() in ('admin','almacenero','comercial'));
drop policy if exists commercial_orders_insert on commercial_orders;
create policy commercial_orders_insert on commercial_orders for insert
  with check (current_user_role() in ('admin','comercial'));
drop policy if exists commercial_orders_update on commercial_orders;
create policy commercial_orders_update on commercial_orders for update
  using (current_user_role() in ('admin','almacenero'));

drop policy if exists commercial_order_items_read on commercial_order_items;
create policy commercial_order_items_read on commercial_order_items for select
  using (exists (select 1 from commercial_orders o where o.id = order_id
    and current_user_role() in ('admin','almacenero','comercial')));
drop policy if exists commercial_order_items_write on commercial_order_items;
create policy commercial_order_items_write on commercial_order_items for all
  using (current_user_role() in ('admin','almacenero','comercial'));

drop policy if exists loans_read on loans;
create policy loans_read on loans for select
  using (current_user_role() in ('admin','almacenero'));
drop policy if exists loans_write on loans;
create policy loans_write on loans for all
  using (current_user_role() in ('admin','almacenero'));

drop policy if exists loan_returns_read on loan_returns;
create policy loan_returns_read on loan_returns for select
  using (current_user_role() in ('admin','almacenero'));
drop policy if exists loan_returns_write on loan_returns;
create policy loan_returns_write on loan_returns for insert
  with check (current_user_role() in ('admin','almacenero'));

-- ----------------------------------------------------------------------------
-- 6) FUNCIONES: pedidos solicitados por conductor
-- ----------------------------------------------------------------------------
create or replace function fn_driver_request_order(
  p_items jsonb,
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

create or replace function fn_process_driver_order_request(
  p_order_id uuid,
  p_items jsonb,
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

-- ----------------------------------------------------------------------------
-- 7) FUNCIONES: pedidos comerciales (pedido -> salida de almacén)
-- ----------------------------------------------------------------------------
create or replace function fn_create_commercial_order(
  p_point_of_sale_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
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

create or replace function fn_dispatch_commercial_order(
  p_order_id uuid,
  p_items jsonb default null,
  p_notes text default null
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_status commercial_order_status;
  v_warehouse_id uuid;
  v_item record;
  v_current_stock integer;
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

-- ----------------------------------------------------------------------------
-- 8) FUNCIONES: préstamos
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 9) Actualiza fn_driver_sale y fn_warehouse_sale para exigir motivo cuando
--    no se recoge la batería vieja
-- ----------------------------------------------------------------------------
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

  if p_old_battery_returned is false and coalesce(trim(p_old_battery_reason), '') = '' then
    raise exception 'Indica el motivo por el que no se recoge la batería vieja';
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
                     is_warranty, customer_vehicle_plate, old_battery_returned, old_battery_reason, sale_origin)
  values (p_driver_id, 'driver', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_old_battery_returned, p_old_battery_reason, p_sale_origin)
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
                     is_warranty, customer_vehicle_plate, old_battery_returned, old_battery_reason, sale_origin)
  values (p_seller_id, 'warehouse_direct', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_old_battery_returned, p_old_battery_reason, p_sale_origin)
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
-- 10) Refresca la caché de esquema de PostgREST
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- Fin de la migración 008b.
-- ============================================================================
