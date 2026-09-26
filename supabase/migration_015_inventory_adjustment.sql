-- ============================================================================
-- MIGRACIÓN 015 — AJUSTE DE INVENTARIO (contar y fijar stock real)
--
-- Usado por la función "Hacer inventario" en Productos: se escanea cada
-- batería, se introduce la cantidad contada, y esto FIJA (no suma) el stock
-- del almacén central a ese número exacto, dejando constancia en
-- stock_movements del ajuste (diferencia entre lo que había y lo contado).
-- ============================================================================

create or replace function fn_set_warehouse_stock(
  p_warehouse_id uuid,
  p_product_model_id uuid,
  p_new_quantity integer,
  p_notes text default null
) returns void as $$
declare
  v_user uuid := auth.uid();
  v_role user_role;
  v_current integer;
  v_delta integer;
begin
  select role into v_role from profiles where id = v_user;
  if v_role is distinct from 'admin' and v_role is distinct from 'almacenero' then
    raise exception 'Solo el almacén o un administrador pueden ajustar el inventario';
  end if;

  if p_new_quantity < 0 then
    raise exception 'La cantidad contada no puede ser negativa';
  end if;

  select quantity into v_current from warehouse_stock
    where warehouse_id = p_warehouse_id and product_model_id = p_product_model_id
    for update;

  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  insert into warehouse_stock(warehouse_id, product_model_id, quantity)
  values (p_warehouse_id, p_product_model_id, p_new_quantity)
  on conflict (warehouse_id, product_model_id)
  do update set quantity = p_new_quantity, updated_at = now();

  if v_delta <> 0 then
    insert into stock_movements(movement_type, product_model_id, quantity, from_location, to_location, reference_table, performed_by)
    values ('adjustment', p_product_model_id, v_delta, 'inventario', 'warehouse', 'inventory_count', v_user);
  end if;
end;
$$ language plpgsql security definer;

grant execute on function fn_set_warehouse_stock(uuid, uuid, integer, text) to authenticated;
grant execute on function fn_set_warehouse_stock(uuid, uuid, integer, text) to service_role;
