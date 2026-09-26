-- ============================================================================
-- MIGRACIÓN 011
--   1) Modelo del coche del cliente (además de matrícula), en venta de
--      conductor y venta directa de almacén.
--   2) Venta directa de almacén: code de batería manual (no viene de una
--      entrega a conductor, así que se escribe directamente).
--   3) "Caja de oficina": el dinero de las ventas directas de almacén deja de
--      mezclarse en la billetera personal de quien la registró, y pasa a una
--      caja única de oficina — se ve y se reinicia igual que las de los
--      conductores.
--   4) Al dar salida a un pedido comercial, no se puede superar la cantidad
--      originalmente pedida para un modelo que ya estaba en el pedido.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Modelo del coche del cliente
-- ---------------------------------------------------------------------------
alter table sales add column if not exists customer_vehicle_model text;

-- ---------------------------------------------------------------------------
-- 2) Code de batería manual (ventas sin battery_unit generado, p.ej. venta
--    directa de almacén). battery_unit_id sigue usándose cuando sí existe.
-- ---------------------------------------------------------------------------
alter table sale_items add column if not exists battery_code_manual text;

-- ---------------------------------------------------------------------------
-- 3) CAJA DE OFICINA (dinero de venta directa de almacén)
-- ---------------------------------------------------------------------------
create table if not exists office_wallet (
  id integer primary key default 1,
  cash_balance numeric(12,2) not null default 0,
  card_balance numeric(12,2) not null default 0,
  last_reset_at timestamptz,
  last_reset_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint office_wallet_singleton check (id = 1)
);
insert into office_wallet(id) values (1) on conflict (id) do nothing;

create table if not exists office_wallet_transactions (
  id uuid primary key default uuid_generate_v4(),
  amount numeric(12,2) not null,
  method payment_method not null,
  type text not null default 'sale',
  related_sale_id uuid,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  notes text
);

alter table office_wallet enable row level security;
drop policy if exists office_wallet_admin on office_wallet;
create policy office_wallet_admin on office_wallet for select using (current_user_role() = 'admin');
drop policy if exists office_wallet_write on office_wallet;
create policy office_wallet_write on office_wallet for all using (current_user_role() in ('admin','almacenero'));

alter table office_wallet_transactions enable row level security;
drop policy if exists office_wallet_tx_admin on office_wallet_transactions;
create policy office_wallet_tx_admin on office_wallet_transactions for select using (current_user_role() = 'admin');
drop policy if exists office_wallet_tx_write on office_wallet_transactions;
create policy office_wallet_tx_write on office_wallet_transactions for insert with check (current_user_role() in ('admin','almacenero'));

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

-- ---------------------------------------------------------------------------
-- fn_warehouse_sale: modelo del coche, code manual, y el dinero ahora va a
-- la caja de oficina (antes se mezclaba con la billetera personal del
-- almacenero que hacía login, lo cual no tenía sentido para reconciliar caja).
-- ---------------------------------------------------------------------------
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

  -- El dinero de venta directa de almacén va a la caja de oficina, no a la
  -- billetera personal de quien hizo login.
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

-- ---------------------------------------------------------------------------
-- fn_driver_sale: añade el modelo del coche del cliente.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) fn_dispatch_commercial_order: no permite superar, para un modelo que ya
--    estaba en el pedido, la cantidad originalmente solicitada (si el pedido
--    era de 100, no se puede dar salida a 101 de ese modelo). Los modelos
--    NUEVOS añadidos al preparar la salida (que no estaban en el pedido) no
--    tienen tope aquí — solo el del stock disponible, como ya validaba antes.
-- ---------------------------------------------------------------------------
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
