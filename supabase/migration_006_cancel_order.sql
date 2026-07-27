-- ============================================================================
-- MIGRACIÓN 006
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase, después de
-- las migraciones 002, 003, 004a, 004b y 005. No borra ningún dato.
-- ============================================================================

-- Deshacer/cancelar un pedido que sigue pendiente (admin/almacenero). Como
-- todavía no se ha movido ningún stock (eso solo pasa al aceptar), se borra
-- sin más: es como si nunca se hubiera creado.
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

-- ============================================================================
-- Fin de la migración 006.
-- ============================================================================
