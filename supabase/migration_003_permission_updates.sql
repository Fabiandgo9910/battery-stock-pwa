-- ============================================================================
-- MIGRACIÓN 003
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase (una sola vez,
-- después de la migración 002). No borra ningún dato existente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Arregla el bug de "no me salen todos los conductores al entregar stock":
--    el almacenero necesita poder LEER todos los perfiles (para elegir el
--    conductor), no solo el suyo propio.
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or current_user_role() in ('admin','almacenero'));

-- ----------------------------------------------------------------------------
-- 2) Admin y almacenero también pueden hacer venta comercial: necesitan
--    poder LEER los clientes de venta comercial (antes solo admin/comercial).
--    La gestión (crear/editar/eliminar clientes) se queda solo en admin/comercial.
-- ----------------------------------------------------------------------------
drop policy if exists pos_read on points_of_sale;
create policy pos_read on points_of_sale for select
  using (current_user_role() in ('admin','comercial','almacenero'));

drop policy if exists pos_stock_read on pos_stock;
create policy pos_stock_read on pos_stock for select
  using (current_user_role() in ('admin','comercial','almacenero'));

-- ----------------------------------------------------------------------------
-- 3) El almacenero también puede ELIMINAR modelos de producto (antes solo
--    podía editarlos, no borrarlos).
-- ----------------------------------------------------------------------------
drop policy if exists product_models_delete on product_models;
create policy product_models_delete on product_models for delete
  using (current_user_role() in ('admin','almacenero'));

-- ============================================================================
-- Fin de la migración 003.
-- ============================================================================
