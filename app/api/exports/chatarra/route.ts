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
function dataCell(cell: ExcelJS.Cell, value: string | number | null, opts?: { bold?: boolean; align?: 'left' | 'center' | 'right' }) {
  cell.value = value ?? '';
  cell.font = { size: 10, bold: opts?.bold ?? false };
  cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'middle' };
  cell.border = BORDER_ALL;
}
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

// GET /api/exports/chatarra?from=YYYY-MM-DD&to=YYYY-MM-DD -> Excel con las
// entregas de baterías viejas de comerciales en ese rango de fechas.
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || !['admin', 'almacenero', 'comercial'].includes(profile.role)) {
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

    const { data: deliveries, error } = await supabase
      .from('scrap_deliveries')
      .select('quantity, weight_kg, notes, created_at, point_of_sale:points_of_sale(name)')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Battery Stock';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('CHATARRA', {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = [{ width: 14 }, { width: 28 }, { width: 12 }, { width: 12 }, { width: 34 }];

    const title = ws.getCell('A1');
    title.value = 'ENTREGA DE BATERÍAS VIEJAS (CHATARRA)';
    title.font = { bold: true, size: 14 };
    ws.mergeCells('A1:E1');
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    title.border = BORDER_ALL;

    const subtitle = ws.getCell('A2');
    subtitle.value = `${fromParam} a ${toParam}`;
    subtitle.font = { italic: true, size: 9 };
    ws.mergeCells('A2:E2');
    subtitle.border = BORDER_ALL;

    const headerRow = 3;
    ['FECHA', 'EMPRESA', 'CANTIDAD', 'PESO (kg)', 'OBSERVACIÓN'].forEach((h, idx) =>
      headerCell(ws.getCell(headerRow, idx + 1), h)
    );

    let row = headerRow + 1;
    let totalQty = 0;
    let totalWeight = 0;
    for (const d of deliveries ?? []) {
      ws.getRow(row).height = 18;
      dataCell(ws.getCell(row, 1), new Date(d.created_at).toLocaleDateString('es-ES'), { align: 'center' });
      dataCell(ws.getCell(row, 2), (d as any).point_of_sale?.name ?? '');
      dataCell(ws.getCell(row, 3), d.quantity, { align: 'center' });
      dataCell(ws.getCell(row, 4), d.weight_kg ?? '', { align: 'center' });
      dataCell(ws.getCell(row, 5), d.notes ?? '');
      totalQty += d.quantity ?? 0;
      totalWeight += Number(d.weight_kg ?? 0);
      row += 1;
    }
    if ((deliveries ?? []).length === 0) {
      dataCell(ws.getCell(row, 1), 'Sin entregas de chatarra en este rango de fechas.');
      ws.mergeCells(row, 1, row, 5);
      row += 1;
    } else {
      headerCell(ws.getCell(row, 2), 'TOTAL');
      dataCell(ws.getCell(row, 3), totalQty, { bold: true, align: 'center' });
      dataCell(ws.getCell(row, 4), totalWeight > 0 ? totalWeight : '', { bold: true, align: 'center' });
      dataCell(ws.getCell(row, 1), '');
      dataCell(ws.getCell(row, 5), '');
      row += 1;
    }
    outlineRange(ws, 1, 1, row - 1, 5);
    outlineRange(ws, headerRow, 1, headerRow, 5);

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="chatarra_${fromParam}_a_${toParam}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('GET /api/exports/chatarra', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al generar el Excel' },
      { status: 500 }
    );
  }
}
