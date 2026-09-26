-- ============================================================================
-- MIGRACIÓN 005
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase, después de
-- las migraciones 002, 003, 004a y 004b. No borra ningún dato.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Columna para que el almacenero/admin pueda marcar como "vista" una
--    entrega que un conductor rechazó (para el aviso emergente).
-- ----------------------------------------------------------------------------
alter table driver_deliveries add column if not exists rejection_acknowledged_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2) El admin puede retirar stock a un conductor y devolverlo al almacén.
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
-- Fin de la migración 005.
-- ============================================================================
