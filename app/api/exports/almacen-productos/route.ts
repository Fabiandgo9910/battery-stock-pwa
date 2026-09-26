import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import ExcelJS from 'exceljs';
import { CATALOG_HEADERS } from '@/lib/catalogHeaders';

const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF64748B' } };
const BORDER_ALL: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, right: THIN, bottom: THIN };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

// Estas cabeceras son el CONTRATO entre exportar e importar: la importación
// (/api/imports/almacen-productos) lee estas mismas columnas por nombre, en
// cualquier orden. No cambiar el texto sin actualizar también el import.
// (Definidas en lib/catalogHeaders.ts para poder importarlas desde ambas
// rutas sin romper las reglas de exports de Next.js Route Handlers.)

function headerCell(cell: ExcelJS.Cell, value: string) {
  cell.value = value;
  cell.font = { bold: true, size: 10 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = HEADER_FILL;
  cell.border = BORDER_ALL;
}
function dataCell(cell: ExcelJS.Cell, value: string | number | boolean | null) {
  cell.value = value === null || value === undefined ? '' : value;
  cell.font = { size: 10 };
  cell.alignment = { vertical: 'middle' };
  cell.border = BORDER_ALL;
}

// GET /api/exports/almacen-productos -> Excel con TODOS los modelos, su
// stock en el almacén central y todas sus propiedades (incluido el EAN).
// Mismo formato que espera /api/imports/almacen-productos.
export async function GET() {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin' && profile?.role !== 'almacenero') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { data: warehouse } = await supabase
      .from('warehouses')
      .select('id')
      .eq('active', true)
      .eq('is_warranty_holding', false)
      .limit(1)
      .single();

    const { data: models, error } = await supabase
      .from('product_models')
      .select(
        `id, brand, model_name, tech_line, amperage_ah, cold_cranking_amps, battery_tech, polarity,
         length_mm, width_mm, height_mm, box_code, hold_down_code, weight_kg, pcs_per_layer,
         layers_per_pallet, pcs_per_pallet, price_pvp, reference_code, min_stock_alert, active,
         product_ean_codes(ean_code),
         warehouse_stock(warehouse_id, quantity)`
      )
      .order('brand')
      .order('model_name');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Battery Stock';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('CATALOGO ALMACEN', { views: [{ state: 'frozen', ySplit: 1 }] });

    const widths: Record<string, number> = {
      EAN: 16, REFERENCIA: 20, MARCA: 12, MODELO: 12, LINEA: 14, VOLTIOS: 9, CAPACIDAD_AH: 12,
      CCA: 8, TECNOLOGIA: 11, POLARIDAD: 10, LARGO_MM: 10, ANCHO_MM: 10, ALTO_MM: 10, CAJA: 8,
      SUJECION: 10, PESO_KG: 10, UDS_POR_CAPA: 12, CAPAS_POR_PALET: 14, UDS_POR_PALET: 12,
      PVP: 10, STOCK_ALMACEN: 13, STOCK_MINIMO_ALERTA: 16, ACTIVO: 8,
    };
    ws.columns = CATALOG_HEADERS.map((h) => ({ width: widths[h] ?? 14 }));
    CATALOG_HEADERS.forEach((h, idx) => headerCell(ws.getCell(1, idx + 1), h));

    let row = 2;
    for (const m of models ?? []) {
      const eanCodes = ((m as any).product_ean_codes ?? []).map((e: any) => e.ean_code).join(', ');
      const stockRow = ((m as any).warehouse_stock ?? []).find((s: any) => s.warehouse_id === warehouse?.id);
      const values: Record<string, string | number | boolean | null> = {
        EAN: eanCodes,
        REFERENCIA: m.reference_code,
        MARCA: m.brand,
        MODELO: m.model_name,
        LINEA: m.tech_line,
        VOLTIOS: 12,
        CAPACIDAD_AH: m.amperage_ah,
        CCA: m.cold_cranking_amps,
        TECNOLOGIA: m.battery_tech,
        POLARIDAD: m.polarity,
        LARGO_MM: m.length_mm,
        ANCHO_MM: m.width_mm,
        ALTO_MM: m.height_mm,
        CAJA: m.box_code,
        SUJECION: m.hold_down_code,
        PESO_KG: m.weight_kg,
        UDS_POR_CAPA: m.pcs_per_layer,
        CAPAS_POR_PALET: m.layers_per_pallet,
        UDS_POR_PALET: m.pcs_per_pallet,
        PVP: m.price_pvp,
        STOCK_ALMACEN: stockRow?.quantity ?? 0,
        STOCK_MINIMO_ALERTA: m.min_stock_alert,
        ACTIVO: m.active ? 'SI' : 'NO',
      };
      CATALOG_HEADERS.forEach((h, idx) => dataCell(ws.getCell(row, idx + 1), values[h] ?? ''));
      row += 1;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="catalogo_almacen_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('GET /api/exports/almacen-productos', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al generar el Excel' },
      { status: 500 }
    );
  }
}
