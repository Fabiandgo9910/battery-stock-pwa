-- ============================================================================
-- MIGRACIÓN 014 — EL EAN COMO IDENTIFICADOR ÚNICO DE CADA MODELO
--
-- Regla de negocio: un modelo de batería no puede tener dos EAN, y dos
-- modelos no pueden compartir el mismo EAN (esto último ya estaba impuesto
-- por el "unique" en ean_code; lo que faltaba era el 1 EAN por modelo).
--
-- IMPORTANTE antes de ejecutar esta migración: si algún modelo tiene HOY más
-- de un EAN asociado, esta migración fallará al crear el índice único (para
-- protegerte de perder datos en silencio). El propio error de Postgres te
-- dirá qué filas chocan. Este SELECT te lo dice de antemano:
--
--   select product_model_id, count(*) from product_ean_codes
--   group by product_model_id having count(*) > 1;
--
-- Si aparece alguna fila, decide primero qué EAN es el correcto para ese
-- modelo y borra los EAN sobrantes de esa tabla antes de continuar.
-- ============================================================================

create unique index if not exists idx_product_ean_codes_one_per_model
  on product_ean_codes (product_model_id);

comment on index idx_product_ean_codes_one_per_model is
  'Un modelo de batería solo puede tener un EAN (y un EAN solo puede pertenecer a un modelo, ya garantizado por el unique de ean_code).';
