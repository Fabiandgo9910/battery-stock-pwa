-- ============================================================================
-- MIGRACIÓN 007
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase, después de
-- las migraciones 002, 003, 004a, 004b, 005 y 006. No borra ningún dato.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0a) FIX del bug de devoluciones: "column movement_type is of type
--     movement_type but expression is of type text". El CASE que elegía
--     entre 'return_garantia'/'return_to_warehouse' no tenía cast explícito
--     al tipo enum, y Postgres no lo castea solo cuando el resultado viene
--     de un CASE con literales de texto. Re-creamos la función completa,
--     ya corregida.
-- ----------------------------------------------------------------------------
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
-- 0b) Re-aplica fn_cancel_driver_order por si la migración 006 no se llegó
--     a ejecutar o PostgREST no recogió la función todavía (ver el punto 2
--     de este mismo archivo). CREATE OR REPLACE es seguro de repetir.
-- ----------------------------------------------------------------------------
create or replace function fn_cancel_driver_order(p_order_id uuid)
returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_status driver_order_status;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden deshacer un pedido';
  end if;

  select status into v_status from driver_deliveries where id = p_order_id for update;
  if v_status is null then
    raise exception 'El pedido no existe';
  end if;
  if v_status <> 'pending' then
    raise exception 'Solo se puede deshacer un pedido que todavía está pendiente de respuesta';
  end if;

  delete from driver_deliveries where id = p_order_id;
end;
$$ language plpgsql security definer;

-- ----------------------------------------------------------------------------
-- 1) Activa Supabase Realtime en driver_deliveries, para que los pedidos
--    pendientes y sus respuestas (aceptado/rechazado) se actualicen al
--    instante en todas las pantallas conectadas, sin esperar al sondeo
--    periódico. Es seguro volver a ejecutar esto aunque ya estuviera activo.
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table driver_deliveries;
exception when duplicate_object then
  null; -- ya estaba añadida, no pasa nada
end $$;

do $$
begin
  alter publication supabase_realtime add table driver_delivery_items;
exception when duplicate_object then
  null;
end $$;

-- Necesario para que Realtime pueda enviar el estado anterior en updates
-- (nos sirve para detectar el cambio pending -> rejected/accepted al vuelo).
alter table driver_deliveries replica identity full;

-- ----------------------------------------------------------------------------
-- 2) Refresca la caché de esquema de PostgREST, por si acaso las funciones
--    de migraciones anteriores (fn_cancel_driver_order, fn_process_return)
--    no se hubieran recogido todavía.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- Fin de la migración 007.
-- ============================================================================
