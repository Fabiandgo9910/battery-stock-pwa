-- ============================================================================
-- MIGRACIÓN 008a — SOLO el valor de enum nuevo
-- ============================================================================
-- IMPORTANTE: ejecuta este archivo EN SOLITARIO, como su propia pulsación de
-- "Run" en el SQL Editor de Supabase, y espera a que termine ANTES de
-- ejecutar migration_008b_orders_loans.sql.
--
-- Motivo técnico (ya nos pasó antes con las devoluciones): `ALTER TYPE ...
-- ADD VALUE` no puede usarse en la misma transacción en la que luego se usa
-- ese valor nuevo. El editor SQL de Supabase ejecuta todo el texto pegado
-- como una única transacción, así que esto tiene que ir aparte.
-- ============================================================================

alter type driver_order_status add value if not exists 'requested';

-- Verificación: debe aparecer 'requested' en esta lista antes de continuar.
select enumlabel as driver_order_status_values from pg_enum
  where enumtypid = 'driver_order_status'::regtype order by enumsortorder;

-- ============================================================================
-- Fin de la migración 008a. Ahora ejecuta migration_008b_orders_loans.sql
-- como una ejecución SEPARADA.
-- ============================================================================
