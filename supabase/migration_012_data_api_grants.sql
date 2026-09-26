-- ============================================================================
-- MIGRACIÓN 012 — GRANTS EXPLÍCITOS PARA LA DATA API (aviso de Supabase)
--
-- A partir del 30 de octubre, Supabase deja de conceder automáticamente
-- acceso de la Data API (supabase-js / PostgREST) a las tablas NUEVAS del
-- schema "public". Las tablas que ya existen a día de hoy NO se ven
-- afectadas (mantienen el acceso que ya tenían) — pero para que este
-- proyecto quede a prueba de futuro, aquí se dejan los GRANT explícitos en
-- TODAS las tablas actuales, y de aquí en adelante toda migración que cree
-- una tabla nueva DEBE incluir sus propios GRANT en la misma migración
-- (ver la plantilla al final de este archivo).
--
-- Esta migración es 100% segura de ejecutar en cualquier momento: solo
-- concede permisos, no borra ni modifica datos ni estructuras, y es
-- reejecutable sin problema (los GRANT son idempotentes).
--
-- Nota de seguridad: a diferencia del ejemplo genérico de Supabase, aquí NO
-- se concede nada al rol "anon" (usuarios sin sesión). Esta aplicación
-- exige inicio de sesión para absolutamente todo, y las políticas RLS ya
-- bloquean a "anon" en la práctica — pero no conceder el GRANT es una capa
-- extra de seguridad: así ni siquiera se puede intentar una consulta anónima
-- contra estas tablas. Los roles "authenticated" (usuarios con sesión) y
-- "service_role" (usado por las rutas /api que actúan como admin) son los
-- que de verdad necesita esta app, y son los que se conceden abajo.
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'product_categories', 'product_models', 'product_ean_codes',
    'warehouses', 'warehouse_stock', 'suppliers', 'receptions', 'reception_items',
    'points_of_sale', 'pos_stock', 'driver_stock', 'driver_deliveries',
    'driver_delivery_items', 'battery_units', 'driver_wallets',
    'driver_wallet_transactions', 'office_wallet', 'office_wallet_transactions',
    'sales', 'sale_items', 'invoices', 'invoice_items', 'returns',
    'commercial_orders', 'commercial_order_items', 'loans', 'loan_returns',
    'stock_movements'
  ];
begin
  foreach t in array tables loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Las funciones RPC (fn_*) ya llevan "security definer", pero además hace
-- falta permiso de EXECUTE para poder llamarlas desde la Data API/RPC.
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
  loop
    execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.args);
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
  end loop;
end $$;

-- ============================================================================
-- PLANTILLA A PARTIR DE AHORA: cada vez que una migración cree una tabla
-- nueva, añadir inmediatamente debajo (en la MISMA migración):
--
--   grant select, insert, update, delete on public.mi_tabla_nueva to authenticated;
--   grant select, insert, update, delete on public.mi_tabla_nueva to service_role;
--   -- (grant select ... to anon;  -- SOLO si de verdad debe ser pública)
--
-- Y si la migración crea una función fn_nueva(...), añadir también:
--   grant execute on function public.fn_nueva(<mismos_argumentos>) to authenticated;
--   grant execute on function public.fn_nueva(<mismos_argumentos>) to service_role;
-- ============================================================================
