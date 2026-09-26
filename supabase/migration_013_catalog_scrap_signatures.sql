-- ============================================================================
-- MIGRACIÓN 013
--   1) Ficha de producto ampliada para el catálogo de almacén (a partir del
--      Excel de Tudor: referencia GPN, polaridad, medidas, caja, sujeción,
--      peso, embalaje/palet y PVP).
--   2) Entrega de baterías viejas (chatarra) de comerciales: empresa,
--      cantidad, peso (opcional), observación.
--   3) Firma digital al entregar cualquier batería desde almacén (a
--      conductor, a comercial, o venta directa), con observación.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CATÁLOGO DE ALMACÉN AMPLIADO (compatible con la ficha de Tudor)
-- ---------------------------------------------------------------------------
alter table product_models add column if not exists reference_code text;       -- GPN / referencia del fabricante
alter table product_models add column if not exists polarity text;             -- p.ej. "ETN 0"
alter table product_models add column if not exists length_mm integer;         -- L (mm)
alter table product_models add column if not exists width_mm integer;         -- W (mm)
alter table product_models add column if not exists height_mm integer;         -- H (mm)
alter table product_models add column if not exists box_code text;             -- BOX (p.ej. "B24")
alter table product_models add column if not exists hold_down_code text;       -- HOLD DOWN (p.ej. "B0")
alter table product_models add column if not exists weight_kg numeric(6,2);    -- BATTERY WEIGHT
alter table product_models add column if not exists pcs_per_layer integer;     -- Pcs x Layers
alter table product_models add column if not exists layers_per_pallet integer; -- nº de Layers
alter table product_models add column if not exists pcs_per_pallet integer;    -- PCS PALLET
alter table product_models add column if not exists price_pvp numeric(10,2);   -- PVP
alter table product_models add column if not exists tech_line text;            -- línea del fabricante (p.ej. "GEL PRO", "HD PRO", "TECHNICA"...)

create unique index if not exists idx_product_models_reference_code
  on product_models (upper(reference_code))
  where reference_code is not null and trim(reference_code) <> '';

-- ---------------------------------------------------------------------------
-- 2) ENTREGA DE BATERÍAS VIEJAS (CHATARRA) DE COMERCIALES
-- ---------------------------------------------------------------------------
create table scrap_deliveries (
  id uuid primary key default uuid_generate_v4(),
  point_of_sale_id uuid not null references points_of_sale(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  weight_kg numeric(8,2),  -- opcional
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_scrap_deliveries_pos on scrap_deliveries(point_of_sale_id);
create index idx_scrap_deliveries_created_at on scrap_deliveries(created_at);

grant select, insert, update, delete on public.scrap_deliveries to authenticated;
grant select, insert, update, delete on public.scrap_deliveries to service_role;

alter table scrap_deliveries enable row level security;
create policy scrap_deliveries_read on scrap_deliveries for select
  using (current_user_role() in ('admin','almacenero','comercial'));
create policy scrap_deliveries_write on scrap_deliveries for all
  using (current_user_role() in ('admin','almacenero','comercial'));

-- ---------------------------------------------------------------------------
-- 3) FIRMA DIGITAL AL ENTREGAR DESDE ALMACÉN
-- ---------------------------------------------------------------------------
create table delivery_signatures (
  id uuid primary key default uuid_generate_v4(),
  kind text not null check (kind in ('driver_delivery', 'commercial_order', 'warehouse_sale')),
  reference_id uuid not null,
  signer_name text,
  notes text, -- observación de la entrega
  signature_data_url text not null, -- PNG en base64 (data:image/png;base64,...)
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, reference_id)
);
create index idx_delivery_signatures_ref on delivery_signatures(kind, reference_id);

grant select, insert, update, delete on public.delivery_signatures to authenticated;
grant select, insert, update, delete on public.delivery_signatures to service_role;

alter table delivery_signatures enable row level security;
create policy delivery_signatures_read on delivery_signatures for select
  using (
    current_user_role() in ('admin','almacenero','comercial')
    or (kind = 'driver_delivery' and exists (
      select 1 from driver_deliveries d where d.id = reference_id and d.driver_id = auth.uid()
    ))
  );
create policy delivery_signatures_write on delivery_signatures for insert
  with check (current_user_role() in ('admin','almacenero','comercial'));
