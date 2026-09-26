import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import ExcelJS from 'exceljs';
import { CATALOG_HEADERS } from '@/lib/catalogHeaders';

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text ?? '').trim();
  if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result ?? '').trim();
  return String(v).trim();
}
function cellNumber(v: ExcelJS.CellValue): number | null {
  const s = cellText(v).replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// POST /api/imports/almacen-productos -> admin: sube un Excel con el MISMO
// formato que exporta /api/exports/almacen-productos (mismas cabeceras,
// incluido EAN) y actualiza/crea modelos y su stock en el almacén central.
// No borra nada que no venga en el Excel; solo crea o actualiza.
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo un administrador puede importar el catálogo.' }, { status: 403 });
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Adjunta el archivo Excel (campo "file").' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const ws = workbook.worksheets[0];
    if (!ws) return NextResponse.json({ error: 'El Excel no tiene ninguna hoja.' }, { status: 400 });

    // Cabeceras: aceptamos cualquier orden de columnas, buscando por nombre.
    const headerRow = ws.getRow(1);
    const colIndexByHeader: Record<string, number> = {};
    headerRow.eachCell((cell, colNumber) => {
      const h = cellText(cell.value).toUpperCase();
      if (h) colIndexByHeader[h] = colNumber;
    });
    const missing = CATALOG_HEADERS.filter((h) => !(h in colIndexByHeader));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Faltan columnas en el Excel: ${missing.join(', ')}. Usa "Exportar catálogo" para tener siempre el formato correcto.` },
        { status: 400 }
      );
    }
    function get(row: ExcelJS.Row, header: (typeof CATALOG_HEADERS)[number]) {
      return row.getCell(colIndexByHeader[header]).value;
    }

    const { data: category } = await supabase.from('product_categories').select('id').eq('slug', 'baterias').single();
    const { data: warehouse } = await supabase
      .from('warehouses')
      .select('id')
      .eq('active', true)
      .eq('is_warranty_holding', false)
      .limit(1)
      .single();

    if (!category || !warehouse) {
      return NextResponse.json({ error: 'Falta configurar la categoría "Baterías" o el almacén central.' }, { status: 500 });
    }

    let created = 0;
    let updated = 0;
    const warnings: string[] = [];

    for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
      const row = ws.getRow(rowNumber);
      const brand = cellText(get(row, 'MARCA'));
      const modelName = cellText(get(row, 'MODELO'));
      if (!brand && !modelName) continue; // fila vacía

      if (!brand || !modelName) {
        warnings.push(`Fila ${rowNumber}: falta MARCA o MODELO, se ha saltado.`);
        continue;
      }

      const eanRaw = cellText(get(row, 'EAN'));
      // Un modelo = un EAN: si la celda trae varios separados por coma, solo
      // se usa el primero (el resto se avisa, no se reparten entre modelos).
      const eanList = eanRaw.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
      const ean = eanList[0] ?? null;
      if (eanList.length > 1) {
        warnings.push(`Fila ${rowNumber} (${brand} ${modelName}): traía varios EAN, solo se ha usado el primero (${ean}).`);
      }
      if (!ean) {
        warnings.push(`Fila ${rowNumber} (${brand} ${modelName}): sin EAN, se ha saltado (el EAN es obligatorio para importar).`);
        continue;
      }
      const referenceCode = cellText(get(row, 'REFERENCIA')) || null;

      // 1) El EAN es el identificador real de cada modelo: si ya existe,
      //    ACTUALIZA ese modelo (y su stock). Si no existe, se crea uno
      //    nuevo y se le asigna este EAN.
      let productModelId: string | null = null;
      const { data: existingEan } = await supabase
        .from('product_ean_codes')
        .select('product_model_id')
        .eq('ean_code', ean)
        .maybeSingle();
      if (existingEan) productModelId = existingEan.product_model_id;

      const techLine = cellText(get(row, 'LINEA')) || null;
      const techRaw = cellText(get(row, 'TECNOLOGIA')).toLowerCase();
      const battery_tech = (['normal', 'agm', 'efb'] as const).includes(techRaw as any) ? techRaw : null;

      const fields = {
        category_id: category.id,
        brand,
        model_name: modelName,
        amperage_ah: cellNumber(get(row, 'CAPACIDAD_AH')),
        cold_cranking_amps: cellNumber(get(row, 'CCA')),
        battery_tech,
        reference_code: referenceCode,
        tech_line: techLine,
        polarity: cellText(get(row, 'POLARIDAD')) || null,
        length_mm: cellNumber(get(row, 'LARGO_MM')),
        width_mm: cellNumber(get(row, 'ANCHO_MM')),
        height_mm: cellNumber(get(row, 'ALTO_MM')),
        box_code: cellText(get(row, 'CAJA')) || null,
        hold_down_code: cellText(get(row, 'SUJECION')) || null,
        weight_kg: cellNumber(get(row, 'PESO_KG')),
        pcs_per_layer: cellNumber(get(row, 'UDS_POR_CAPA')),
        layers_per_pallet: cellNumber(get(row, 'CAPAS_POR_PALET')),
        pcs_per_pallet: cellNumber(get(row, 'UDS_POR_PALET')),
        price_pvp: cellNumber(get(row, 'PVP')),
        min_stock_alert: cellNumber(get(row, 'STOCK_MINIMO_ALERTA')) ?? 5,
        active: cellText(get(row, 'ACTIVO')).toUpperCase() !== 'NO',
      };

      if (productModelId) {
        const { error: updErr } = await supabase.from('product_models').update(fields).eq('id', productModelId);
        if (updErr) {
          warnings.push(`Fila ${rowNumber} (${brand} ${modelName}): ${updErr.message}`);
          continue;
        }
        updated += 1;
      } else {
        const { data: createdModel, error: insErr } = await supabase
          .from('product_models')
          .insert({ ...fields, created_by: session.user.id })
          .select('id')
          .single();
        if (insErr || !createdModel) {
          warnings.push(`Fila ${rowNumber} (${brand} ${modelName}): ${insErr?.message ?? 'no se pudo crear'}`);
          continue;
        }
        productModelId = createdModel.id;
        created += 1;
      }

      // 2) El EAN de esta fila ya queda ligado a este modelo (si es nuevo,
      //    se enlaza aquí; si ya existía, no hay nada más que hacer).
      if (!existingEan) {
        const { error: eanErr } = await supabase.from('product_ean_codes').insert({ ean_code: ean, product_model_id: productModelId });
        if (eanErr) {
          warnings.push(`Fila ${rowNumber}: no se pudo asociar el EAN ${ean} (${eanErr.message}).`);
        }
      }

      // 3) Stock del almacén central (si la columna trae un número).
      const stockValue = cellNumber(get(row, 'STOCK_ALMACEN'));
      if (stockValue !== null) {
        await supabase.from('warehouse_stock').upsert(
          { warehouse_id: warehouse.id, product_model_id: productModelId, quantity: Math.max(0, Math.round(stockValue)), updated_at: new Date().toISOString() },
          { onConflict: 'warehouse_id,product_model_id' }
        );
      }
    }

    return NextResponse.json({ created, updated, warnings });
  } catch (err) {
    console.error('POST /api/imports/almacen-productos', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al importar el Excel' },
      { status: 500 }
    );
  }
}
