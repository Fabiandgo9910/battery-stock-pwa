-- ============================================================================
-- MIGRACIÓN 009
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase, después de
-- las migraciones 002 a 008b. No borra ningún dato.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) FIX del bug de "la devolución de un préstamo da error": el mismo tipo
--    de problema que ya vimos con las devoluciones — un CASE con literales
--    de texto ('devuelto'/'parcial') insertado en una columna enum
--    (loan_status) sin cast explícito. Re-creamos la función corregida.
-- ----------------------------------------------------------------------------
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
-- 2) Entrega directa a una empresa: crea el pedido y le da salida en el
--    mismo paso (admin/almacenero), sin pasar por "pendiente".
-- ----------------------------------------------------------------------------
create or replace function fn_direct_commercial_delivery(
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

-- ----------------------------------------------------------------------------
-- 3) Refresca la caché de esquema de PostgREST
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- Fin de la migración 009.
-- ============================================================================
