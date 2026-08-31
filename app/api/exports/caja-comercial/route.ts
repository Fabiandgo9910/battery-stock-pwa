import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import ExcelJS from 'exceljs';

const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF64748B' } };
const MEDIUM: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF334155' } };
const BORDER_ALL: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, right: THIN, bottom: THIN };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

function headerCell(cell: ExcelJS.Cell, value: string) {
  cell.value = value;
  cell.font = { bold: true, size: 10 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = HEADER_FILL;
  cell.border = BORDER_ALL;
}

function dataCell(cell: ExcelJS.Cell, value: string | number | Date | null, opts?: { bold?: boolean; align?: 'left' | 'center' | 'right' }) {
  cell.value = value ?? '';
  cell.font = { size: 10, bold: opts?.bold ?? false };
  cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'middle', wrapText: true };
  cell.border = BORDER_ALL;
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

// La plantilla original empieza en la columna B (A queda como margen).
// [A, B, C, D, E, F, G, H]
const COLUMN_WIDTHS = [4, 26, 11, 26, 16, 13, 13, 30];

// GET /api/exports/caja-comercial?from=YYYY-MM-DD&to=YYYY-MM-DD
// Genera el Excel "CAJA COMERCIAL" con el mismo diseño que la plantilla de la
// empresa. Si en el rango una misma empresa se ha llevado el mismo modelo
// varias veces (en distintos pedidos/salidas), se unifica en una sola fila
// sumando las cantidades.
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

    const { data: orders, error: ordersErr } = await supabase
      .from('commercial_orders')
      .select(
        `id, dispatched_at, notes,
         point_of_sale:points_of_sale(name),
         commercial_order_items(quantity, product_model:product_models(brand, model_name))`
      )
      .eq('status', 'dispatched')
      .gte('dispatched_at', from.toISOString())
      .lte('dispatched_at', to.toISOString())
      .order('dispatched_at');

    if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 });

    // --- Unificar: misma empresa + mismo modelo -> se suman las cantidades --
    interface GroupRow {
      company: string;
      model: string;
      quantity: number;
      lastDate: Date | null;
      notes: Set<string>;
    }
    const groups = new Map<string, GroupRow>();
    for (const order of orders ?? []) {
      const company = (order as any).point_of_sale?.name ?? '';
      const date = order.dispatched_at ? new Date(order.dispatched_at) : null;
      for (const item of (order as any).commercial_order_items ?? []) {
        const model = item.product_model ? `${item.product_model.brand} ${item.product_model.model_name}` : '';
        const key = `${company}|${model}`;
        const existing = groups.get(key);
        if (existing) {
          existing.quantity += item.quantity ?? 0;
          if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
          if (order.notes) existing.notes.add(order.notes);
        } else {
          groups.set(key, {
            company,
            model,
            quantity: item.quantity ?? 0,
            lastDate: date,
            notes: new Set(order.notes ? [order.notes] : []),
          });
        }
      }
    }
    const rowsData = Array.from(groups.values()).sort((a, b) => a.company.localeCompare(b.company) || a.model.localeCompare(b.model));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Battery Stock';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('CAJA COMERCIAL', {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));
    ws.getRow(1).height = 20;
    ws.getRow(3).height = 24;
    ws.getRow(4).height = 20;

    ws.mergeCells('B1:C1');
    const dateCell = ws.getCell('B1');
    dateCell.value = new Date(toParam);
    dateCell.numFmt = 'dd/mm/yyyy';
    dateCell.font = { bold: true, size: 11 };
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
    dateCell.border = BORDER_ALL;

    const titleCell = ws.getCell('D1');
    titleCell.value = 'CAJA COMERCIAL';
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.border = BORDER_ALL;

    ws.mergeCells('E1:G1');
    const numHojaLabel = ws.getCell('E1');
    numHojaLabel.value = 'NUMERO HOJA';
    numHojaLabel.font = { bold: true, size: 9 };
    numHojaLabel.alignment = { horizontal: 'center', vertical: 'middle' };
    numHojaLabel.border = BORDER_ALL;

    const numHojaValue = ws.getCell('H1');
    numHojaValue.value = ''; // numeración manual de la empresa, se deja en blanco
    numHojaValue.border = BORDER_ALL;

    ws.mergeCells('B2:H2');
    const subtitleCell = ws.getCell('B2');
    subtitleCell.value = `${fromParam} a ${toParam}`;
    subtitleCell.font = { italic: true, size: 9 };
    subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    subtitleCell.border = BORDER_ALL;

    const headerRow = 3;
    headerCell(ws.getCell(headerRow, 2), 'MODELO BATERIA');
    headerCell(ws.getCell(headerRow, 3), 'CANTIDAD');
    headerCell(ws.getCell(headerRow, 4), 'EMPRESA');
    headerCell(ws.getCell(headerRow, 5), 'ENTREGA');
    ws.mergeCells(headerRow, 6, headerRow, 7);
    headerCell(ws.getCell(headerRow, 6), 'ALBARAN');
    headerCell(ws.getCell(headerRow, 8), 'OBSERVACIÒN');
    headerCell(ws.getCell(headerRow + 1, 6), 'NUMERO');
    headerCell(ws.getCell(headerRow + 1, 7), 'ENTREGADO');
    ws.mergeCells(headerRow, 2, headerRow + 1, 2);
    ws.mergeCells(headerRow, 3, headerRow + 1, 3);
    ws.mergeCells(headerRow, 4, headerRow + 1, 4);
    ws.mergeCells(headerRow, 5, headerRow + 1, 5);
    ws.mergeCells(headerRow, 8, headerRow + 1, 8);

    let row = headerRow + 2;
    const FIRST_DATA_ROW = row;
    for (const g of rowsData) {
      ws.getRow(row).height = 20;
      dataCell(ws.getCell(row, 2), g.model);
      dataCell(ws.getCell(row, 3), g.quantity, { align: 'center' });
      dataCell(ws.getCell(row, 4), g.company);
      dataCell(ws.getCell(row, 5), g.lastDate ? g.lastDate.toLocaleDateString('es-ES') : '', { align: 'center' });
      dataCell(ws.getCell(row, 6), ''); // ALBARAN > NUMERO: sin dato equivalente, se deja en blanco
      dataCell(ws.getCell(row, 7), ''); // ALBARAN > ENTREGADO: sin dato equivalente, se deja en blanco
      dataCell(ws.getCell(row, 8), Array.from(g.notes).join(' · '));
      row += 1;
    }
    if (rowsData.length === 0) {
      dataCell(ws.getCell(row, 2), 'Sin salidas comerciales en este rango de fechas.');
      ws.mergeCells(row, 2, row, 8);
      row += 1;
    }

    const lastRow = row - 1;
    outlineRange(ws, 1, 2, 2, 8);
    outlineRange(ws, headerRow, 2, lastRow, 8);
    outlineRange(ws, headerRow, 2, headerRow + 1, 8); // refuerza el borde bajo la cabecera

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="caja_comercial_${fromParam}_a_${toParam}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('GET /api/exports/caja-comercial', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al generar el Excel' },
      { status: 500 }
    );
  }
}
