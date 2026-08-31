-- ============================================================================
-- MIGRACIÓN 004a — SOLO valores nuevos de enum
-- ============================================================================
-- IMPORTANTE: ejecuta este archivo EN SOLITARIO, como su propia pulsación de
-- "Run" en el SQL Editor de Supabase, y espera a que termine ANTES de
-- ejecutar migration_004b_major_update.sql.
--
-- Motivo técnico: `ALTER TYPE ... ADD VALUE` no puede usarse en la misma
-- transacción en la que luego se USA ese valor nuevo (INSERT, comparación,
-- etc.) — Postgres lo rechaza con el error "unsafe use of new value of enum
-- type". Cuando pegas un script completo en el SQL Editor y le das a "Run",
-- Postgres ejecuta TODO el texto como una única transacción implícita. Si
-- estas líneas y el resto de la migración 004 se ejecutan juntas en una sola
-- pasada (como ocurría antes de esta corrección), la migración falla o queda
-- a medias — esta es la causa más probable de que "las devoluciones no
-- funcionaran": la función fn_process_return y la tabla returns podían no
-- haberse creado correctamente si esta parte falló silenciosamente junto al
-- resto.
-- ============================================================================

alter type payment_method add value if not exists 'warranty';
alter type movement_type add value if not exists 'sale_warehouse_direct';
alter type movement_type add value if not exists 'return_garantia';

-- Verificación: comprueba que 'warranty' aparezca en la primera lista, y
-- 'sale_warehouse_direct' + 'return_garantia' en la segunda. Si falta algo,
-- NO continúes con migration_004b_major_update.sql todavía.
select enumlabel as payment_method_values from pg_enum
  where enumtypid = 'payment_method'::regtype order by enumsortorder;

select enumlabel as movement_type_values from pg_enum
  where enumtypid = 'movement_type'::regtype order by enumsortorder;

-- ============================================================================
-- Fin de la migración 004a. Ahora ejecuta migration_004b_major_update.sql
-- como una ejecución SEPARADA.
-- ============================================================================
