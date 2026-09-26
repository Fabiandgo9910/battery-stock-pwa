-- ============================================================================
-- MIGRACIÓN 010: CÓDIGO POR BATERÍA (unidad a unidad) + CÓDIGO DE CONDUCTOR
--
-- Contexto (petición del negocio):
--   - Cada conductor tiene su propio código corto (se configura en Usuarios).
--   - Al entregar baterías a un conductor, CADA batería (unidad física) debe
--     llevar un código propio para poder etiquetarla/imprimirla:
--       MODELO + CÓDIGO(conductor | OFI si es entrega extraordinaria | WEB
--       si es pedido web) + DÍA(2) + MES(2) + Nº DE BATERÍA EN ESE PEDIDO (2)
--     Ejemplos: "TK720 SB220801", "TK720 OFI220801", "TK720 WEB220801".
--       Si en el mismo pedido van 2 baterías del mismo modelo: 01 y 02.
--   - Al montar (vender) una batería, el conductor debe escanear y elegir de
--     una lista el código EXACTO de la unidad que está montando. Ese código
--     queda guardado en la venta, para la exportación de ventas/cajas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CÓDIGO DE CADA CONDUCTOR (se asigna desde Usuarios)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists driver_code text;

-- Solo puede haber un conductor con cada código (evita colisiones al generar
-- códigos de batería). Se ignoran nulos/vacíos.
create unique index if not exists idx_profiles_driver_code
  on profiles (upper(driver_code))
  where driver_code is not null and trim(driver_code) <> '';

-- ---------------------------------------------------------------------------
-- 2) TIPO DE ENTREGA A CONDUCTOR: normal / extraordinaria (OFI) / pedido WEB
--    Solo afecta a qué token se usa al generar el código de cada batería.
-- ---------------------------------------------------------------------------
alter table driver_deliveries add column if not exists delivery_type text not null default 'conductor';
alter table driver_deliveries drop constraint if exists driver_deliveries_delivery_type_check;
alter table driver_deliveries add constraint driver_deliveries_delivery_type_check
  check (delivery_type in ('conductor', 'ofi', 'web'));

-- ---------------------------------------------------------------------------
-- 3) UNIDADES DE BATERÍA CON CÓDIGO PROPIO
-- ---------------------------------------------------------------------------
create table if not exists battery_units (
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

create index if not exists idx_battery_units_driver on battery_units(driver_id, product_model_id, status);
create index if not exists idx_battery_units_delivery on battery_units(delivery_id);
create index if not exists idx_battery_units_code on battery_units(code);

-- Qué unidad concreta se vendió/montó, para la exportación de ventas.
alter table sale_items add column if not exists battery_unit_id uuid references battery_units(id);

-- ---------------------------------------------------------------------------
-- 4) GENERAR LOS CÓDIGOS DE LAS BATERÍAS DE UNA ENTREGA
--    Formato: "<MODELO> <TOKEN><DD><MM><SEC>" p.ej. "TK720 SB220801"
--    El nº de secuencia (01, 02...) continúa a partir de la última unidad ya
--    generada ese mismo día para el mismo modelo+token, así nunca se repite.
-- ---------------------------------------------------------------------------
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
    -- Evita duplicar códigos si esta función se llamara dos veces sobre la misma entrega.
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

-- ---------------------------------------------------------------------------
-- 5) fn_create_driver_order: añade p_delivery_type y genera los códigos
-- ---------------------------------------------------------------------------
create or replace function fn_create_driver_order(
  p_warehouse_id uuid,
  p_driver_id uuid,
  p_items jsonb,
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

-- ---------------------------------------------------------------------------
-- 6) fn_process_driver_order_request: también genera los códigos al preparar
--    la solicitud del conductor (pasa a 'pending').
-- ---------------------------------------------------------------------------
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
  delete from battery_units where delivery_id = p_order_id; -- por si se reprocesa antes de aceptar

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into driver_delivery_items(delivery_id, product_model_id, quantity)
    values (p_order_id, (v_item->>'product_model_id')::uuid, (v_item->>'quantity')::integer);
  end loop;

  update driver_deliveries
    set status = 'pending', delivered_by = v_user, delivered_at = now(),
        notes = coalesce(p_notes, notes)
    where id = p_order_id;

  perform fn_generate_battery_units_for_delivery(p_order_id);
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- 7) fn_respond_driver_order: si se rechaza, se invalidan los códigos ya
--    generados (las baterías nunca salieron realmente del almacén).
-- ---------------------------------------------------------------------------
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
    update battery_units set status = 'cancelled' where delivery_id = p_delivery_id;
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

-- ---------------------------------------------------------------------------
-- 8) fn_driver_sale: admite p_battery_unit_id (el code escaneado/elegido al
--    montar) y lo guarda en sale_items para la exportación de ventas.
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
  p_battery_unit_id uuid default null
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
                     is_warranty, customer_vehicle_plate, old_battery_returned, old_battery_reason, sale_origin)
  values (p_driver_id, 'driver', v_method, coalesce(p_amount_cash,0), coalesce(p_amount_card,0), v_total, p_notes,
          p_is_warranty, p_customer_vehicle_plate, p_old_battery_returned, p_old_battery_reason, p_sale_origin)
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
-- 9) RLS de battery_units (mismo patrón que driver_stock)
-- ---------------------------------------------------------------------------
alter table battery_units enable row level security;

drop policy if exists battery_units_read on battery_units;
create policy battery_units_read on battery_units for select
  using (driver_id = auth.uid() or current_user_role() in ('admin','almacenero'));

drop policy if exists battery_units_write on battery_units;
create policy battery_units_write on battery_units for all
  using (current_user_role() in ('admin','almacenero'));
