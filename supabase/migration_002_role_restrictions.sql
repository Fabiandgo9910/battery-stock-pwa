-- ============================================================================
-- MIGRACIÓN 002
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase (una sola vez).
-- No borra ningún dato existente, solo ajusta permisos y claves foráneas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) El almacenero deja de poder gestionar puntos de venta: solo entrega
--    stock a conductores. Admin y comercial siguen teniendo acceso completo.
-- ----------------------------------------------------------------------------
drop policy if exists pos_read on points_of_sale;
create policy pos_read on points_of_sale for select
  using (current_user_role() in ('admin','comercial'));

drop policy if exists pos_write on points_of_sale;
create policy pos_write on points_of_sale for all
  using (current_user_role() in ('admin','comercial'));

drop policy if exists pos_stock_read on pos_stock;
create policy pos_stock_read on pos_stock for select
  using (current_user_role() in ('admin','comercial'));

drop policy if exists pos_stock_write on pos_stock;
create policy pos_stock_write on pos_stock for all
  using (current_user_role() in ('admin','comercial'));

-- Permite además que admin/comercial ELIMINEN (no solo desactiven) un punto
-- de venta, incluso si ya tiene ventas o facturas asociadas: esas referencias
-- pasan a NULL en vez de bloquear el borrado, así se conserva el histórico
-- de la venta/factura pero deja de estar ligado a un punto de venta borrado.
alter table sales drop constraint if exists sales_point_of_sale_id_fkey;
alter table sales add constraint sales_point_of_sale_id_fkey
  foreign key (point_of_sale_id) references points_of_sale(id) on delete set null;

alter table invoices drop constraint if exists invoices_point_of_sale_id_fkey;
alter table invoices add constraint invoices_point_of_sale_id_fkey
  foreign key (point_of_sale_id) references points_of_sale(id) on delete set null;

-- (pos_stock ya tenía "on delete cascade" desde el esquema original; se deja igual)

-- ----------------------------------------------------------------------------
-- 2) Permite eliminar (no solo desactivar) un distribuidor incluso si ya
--    tiene recepciones registradas: las recepciones antiguas conservan su
--    historial, pero dejan de apuntar a un distribuidor borrado.
-- ----------------------------------------------------------------------------
alter table receptions drop constraint if exists receptions_supplier_id_fkey;
alter table receptions add constraint receptions_supplier_id_fkey
  foreign key (supplier_id) references suppliers(id) on delete set null;

alter table receptions alter column supplier_id drop not null;

-- ============================================================================
-- Fin de la migración 002.
-- ============================================================================
