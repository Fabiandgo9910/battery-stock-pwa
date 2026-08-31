import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import ExcelJS from 'exceljs';

const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF64748B' } };
const MEDIUM: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF334155' } };
const BORDER_ALL: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, right: THIN, bottom: THIN };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

function headerCell(cell: ExcelJS.Cell, value: string, opts?: { fill?: ExcelJS.Fill }) {
  cell.value = value;
  cell.font = { bold: true, size: 10 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = opts?.fill ?? HEADER_FILL;
  cell.border = BORDER_ALL;
}

function dataCell(cell: ExcelJS.Cell, value: string | number | Date | null, opts?: { bold?: boolean; align?: 'left' | 'center' | 'right'; fill?: ExcelJS.Fill }) {
  cell.value = value ?? '';
  cell.font = { size: 10, bold: opts?.bold ?? false };
  cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'middle', wrapText: true };
  cell.border = BORDER_ALL;
  if (opts?.fill) cell.fill = opts.fill;
}

/** Aplica un borde grueso (medium) alrededor del perímetro de un rango, sin tocar el interior. */
function outlineRange(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      const border: Partial<ExcelJS.Borders> = { ...cell.border };
      if (r === r1) border.top = MEDIUM;
      if (r === r2) border.bottom = MEDIUM;
      if (c === c1) border.left = MEDIUM;
      if (c === c2) border.right = MEDIUM;
      cell.border = border;
    }
  }
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'EFECTIVO',
  card: 'TARJETA',
  transfer: 'TRANSFERENCIA',
  mixed: 'MIXTO',
  warranty: 'GARANTÍA',
};

const COLUMN_WIDTHS = [18, 12, 12, 8, 24, 20, 12, 13, 10, 12, 9, 30];
const TOTAL_COLS = COLUMN_WIDTHS.length;

// GET /api/exports/caja-conductores?from=YYYY-MM-DD&to=YYYY-MM-DD
// Genera el Excel "CAJA CONDUCTORES" con el mismo diseño que la plantilla de
// la empresa. Incluye ventas de conductor Y venta directa de almacén.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin' && profile?.role !== 'almacenero') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const fromParam = req.nextUrl.searchParams.get('from');
    const toParam = req.nextUrl.searchParams.get('to');
    if (!fromParam || !toParam) {
      return NextResponse.json({ error: 'Indica el rango de fechas (from/to)' }, { status: 400 });
    }
    const from = new Date(fromParam);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toParam);
    to.setHours(23, 59, 59, 999);

    const { data: sales, error: salesErr } = await supabase
      .from('sales')
      .select(
        `id, sale_channel, payment_method, amount_cash, amount_card, total_amount, is_warranty,
         customer_vehicle_plate, customer_vehicle_model, old_battery_returned, notes, sold_at,
         seller:profiles(full_name, vehicle_plate),
         sale_items(quantity, product_model:product_models(brand, model_name), battery_unit:battery_units(code), battery_code_manual)`
      )
      .in('sale_channel', ['driver', 'warehouse_direct'])
      .gte('sold_at', from.toISOString())
      .lte('sold_at', to.toISOString())
      .order('sold_at');

    if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Battery Stock';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('CAJA CONDUCTORES', {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));
    ws.getRow(1).height = 20;
    ws.getRow(2).height = 32;

    // --- Cabecera exacta de la plantilla -----------------------------------
    ws.mergeCells(1, 1, 1, 4);
    dataCell(ws.getCell(1, 1), 'SOLO ACEPTAMOS PAGOS EN EFECTIVO O TARJETA', { bold: true, align: 'center' });
    ws.mergeCells(1, 5, 1, 8);
    const titleCell = ws.getCell(1, 5);
    titleCell.value = 'CAJA CONDUCTORES';
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.border = BORDER_ALL;

    ws.mergeCells(1, 9, 1, 10);
    const dateCell = ws.getCell(1, 9);
    dateCell.value = new Date(fromParam);
    dateCell.numFmt = 'dd/mm/yyyy';
    dateCell.font = { size: 10 };
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
    dateCell.border = BORDER_ALL;

    ws.mergeCells(1, 11, 1, 12);
    const sheetNumCell = ws.getCell(1, 11);
    sheetNumCell.value = ''; // Nº de hoja: numeración manual de la empresa, se deja en blanco
    sheetNumCell.border = BORDER_ALL;

    const condHeaders = ['CHOFER', 'VEHICULO', 'MATRICULA', 'FOTO', 'BATERIA', 'Nª BATERIA', 'IMPORTE', 'EFECT/TARJE', 'COBRO', 'RECICLAJE', 'VENDE', 'OBSERVACION'];
    condHeaders.forEach((h, idx) => headerCell(ws.getCell(2, idx + 1), h));

    // --- Filas de datos: 23 filas fijas (3 a 25), como en la plantilla ------
    const FIRST_DATA_ROW = 3;
    const LAST_TEMPLATE_DATA_ROW = 25;

    let totalCash = 0;
    let totalCard = 0;
    let totalWarranty = 0;
    let row = FIRST_DATA_ROW;

    for (const sale of sales ?? []) {
      const items = (sale as any).sale_items ?? [];
      const seller = (sale as any).seller;
      const isWarehouseDirect = sale.sale_channel === 'warehouse_direct';
      ws.getRow(row).height = 18;
      for (const item of items) {
        dataCell(ws.getCell(row, 1), isWarehouseDirect ? `${seller?.full_name ?? ''} (almacén)` : seller?.full_name ?? '');
        dataCell(ws.getCell(row, 2), isWarehouseDirect ? '' : seller?.vehicle_plate ?? '');
        dataCell(ws.getCell(row, 3), sale.customer_vehicle_plate ?? '');
        dataCell(ws.getCell(row, 4), '', { align: 'center' });
        dataCell(ws.getCell(row, 5), item.product_model ? `${item.product_model.brand} ${item.product_model.model_name}` : '');
        dataCell(ws.getCell(row, 6), item.battery_unit?.code ?? item.battery_code_manual ?? '', { align: 'center' });
        dataCell(ws.getCell(row, 7), Number(sale.total_amount ?? 0), { align: 'right' });
        ws.getCell(row, 7).numFmt = '#,##0.00 €';
        dataCell(ws.getCell(row, 8), PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method, { align: 'center' });
        dataCell(ws.getCell(row, 9), ''); // COBRO: sin dato equivalente, se deja en blanco
        dataCell(ws.getCell(row, 10), sale.old_battery_returned === false ? 'NO' : sale.old_battery_returned === true ? 'SÍ' : '', { align: 'center' });
        dataCell(ws.getCell(row, 11), ''); // VENDE: sin dato equivalente, se deja en blanco
        dataCell(ws.getCell(row, 12), sale.notes ?? '');
        row += 1;
      }
      totalCash += Number(sale.amount_cash ?? 0);
      totalCard += Number(sale.amount_card ?? 0);
      if (sale.is_warranty) totalWarranty += Number(sale.total_amount ?? 0);
    }

    // Si hay menos filas que la plantilla, rellenamos vacías con el mismo
    // formato hasta llegar al tamaño original (para que se vea igual al
    // imprimir); si hay más, seguimos añadiendo filas después.
    const lastDataRow = Math.max(row - 1, FIRST_DATA_ROW - 1);
    for (let r = lastDataRow + 1; r <= LAST_TEMPLATE_DATA_ROW; r++) {
      ws.getRow(r).height = 18;
      for (let c = 1; c <= TOTAL_COLS; c++) dataCell(ws.getCell(r, c), '');
    }
    const lastFilledRow = Math.max(lastDataRow, LAST_TEMPLATE_DATA_ROW);
    outlineRange(ws, 1, 1, lastFilledRow, TOTAL_COLS);
    outlineRange(ws, 2, 1, lastFilledRow, TOTAL_COLS); // refuerza el borde bajo la cabecera

    // --- Bloque inferior fijo de la plantilla (gastos + totales) -----------
    const bottomStart = lastFilledRow + 2;
    ws.getRow(bottomStart).height = 22;
    headerCell(ws.getCell(bottomStart, 1), 'CONDUCTOR');
    ws.mergeCells(bottomStart, 2, bottomStart, 3);
    headerCell(ws.getCell(bottomStart, 2), 'CONCEPTO DEL GASTO');
    ws.mergeCells(bottomStart, 4, bottomStart, 5);
    headerCell(ws.getCell(bottomStart, 4), 'COCHE/MATRICULA');
    headerCell(ws.getCell(bottomStart, 6), 'IMPORTE');
    ws.mergeCells(bottomStart, 7, bottomStart, 9);
    headerCell(ws.getCell(bottomStart, 7), 'FIRMA / FECHA');

    // Filas en blanco para anotar gastos a mano, con el mismo ancho de columnas.
    const EXPENSE_ROWS = 5;
    for (let i = 1; i <= EXPENSE_ROWS; i++) {
      const r = bottomStart + i;
      ws.getRow(r).height = 20;
      dataCell(ws.getCell(r, 1), '');
      ws.mergeCells(r, 2, r, 3);
      dataCell(ws.getCell(r, 2), '');
      ws.mergeCells(r, 4, r, 5);
      dataCell(ws.getCell(r, 4), '');
      dataCell(ws.getCell(r, 6), '');
      ws.mergeCells(r, 7, r, 9);
      dataCell(ws.getCell(r, 7), '');
    }
    outlineRange(ws, bottomStart, 1, bottomStart + EXPENSE_ROWS, 9);

    // Totales (columnas J/K), alineados con la cabecera de gastos.
    headerCell(ws.getCell(bottomStart, 10), 'GARANTIA', { fill: TOTAL_FILL });
    dataCell(ws.getCell(bottomStart, 11), totalWarranty, { align: 'right', fill: TOTAL_FILL });
    ws.getCell(bottomStart, 11).numFmt = '#,##0.00 €';
    headerCell(ws.getCell(bottomStart + 1, 10), 'TRANSFER', { fill: TOTAL_FILL });
    dataCell(ws.getCell(bottomStart + 1, 11), '', { fill: TOTAL_FILL }); // sin canal de transferencia registrado, se deja en blanco
    headerCell(ws.getCell(bottomStart + 2, 10), 'TARJETA', { fill: TOTAL_FILL });
    dataCell(ws.getCell(bottomStart + 2, 11), totalCard, { align: 'right', fill: TOTAL_FILL });
    ws.getCell(bottomStart + 2, 11).numFmt = '#,##0.00 €';
    headerCell(ws.getCell(bottomStart + 3, 10), 'EFECTIVO', { fill: TOTAL_FILL });
    dataCell(ws.getCell(bottomStart + 3, 11), totalCash, { align: 'right', fill: TOTAL_FILL });
    ws.getCell(bottomStart + 3, 11).numFmt = '#,##0.00 €';
    headerCell(ws.getCell(bottomStart + 4, 10), 'TOTAL', { fill: TOTAL_FILL });
    dataCell(ws.getCell(bottomStart + 4, 11), totalCard + totalCash, { bold: true, align: 'right', fill: TOTAL_FILL });
    ws.getCell(bottomStart + 4, 11).numFmt = '#,##0.00 €';
    outlineRange(ws, bottomStart, 10, bottomStart + 4, 11);

    if ((sales ?? []).length === 0) {
      ws.getCell(FIRST_DATA_ROW, 1).value = 'Sin ventas en este rango de fechas.';
    }

    ws.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="caja_conductores_${fromParam}_a_${toParam}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('GET /api/exports/caja-conductores', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al generar el Excel' },
      { status: 500 }
    );
  }
}
