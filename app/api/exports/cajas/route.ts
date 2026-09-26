import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabaseServer';
import ExcelJS from 'exceljs';

const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF94A3B8' } };
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

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'EFECTIVO',
  card: 'TARJETA',
  transfer: 'TRANSFERENCIA',
  mixed: 'MIXTO',
  warranty: 'GARANTÍA',
};

// GET /api/exports/cajas?from=YYYY-MM-DD&to=YYYY-MM-DD
// Genera un Excel con dos hojas — "CAJA CONDUCTORES" y "CAJA COMERCIAL" — con
// el mismo diseño que las plantillas de la empresa, filtrado por fecha.
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

    // -------------------------------------------------------------------
    // DATOS: ventas de conductores en el rango, con su code de batería
    // -------------------------------------------------------------------
    const { data: driverSales, error: salesErr } = await supabase
      .from('sales')
      .select(
        `id, payment_method, amount_cash, amount_card, total_amount, is_warranty,
         customer_vehicle_plate, old_battery_returned, notes, sold_at,
         seller:profiles(full_name, vehicle_plate),
         sale_items(quantity, product_model:product_models(brand, model_name), battery_unit:battery_units(code))`
      )
      .eq('sale_channel', 'driver')
      .gte('sold_at', from.toISOString())
      .lte('sold_at', to.toISOString())
      .order('sold_at');

    if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 });

    // -------------------------------------------------------------------
    // DATOS: pedidos comerciales con salida dada en el rango
    // -------------------------------------------------------------------
    const { data: commercialOrders, error: ordersErr } = await supabase
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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Battery Stock';
    workbook.created = new Date();

    // =====================================================================
    // HOJA 1: CAJA CONDUCTORES
    // =====================================================================
    const wsCond = workbook.addWorksheet('CAJA CONDUCTORES', { pageSetup: { orientation: 'landscape', fitToPage: true } });
    wsCond.columns = [
      { width: 16 }, { width: 12 }, { width: 12 }, { width: 8 }, { width: 20 },
      { width: 20 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 },
      { width: 8 }, { width: 22 },
    ];

    wsCond.mergeCells('A1:D1');
    dataCell(wsCond.getCell('A1'), 'SOLO ACEPTAMOS PAGOS EN EFECTIVO O TARJETA', { bold: true });
    wsCond.mergeCells('E1:H1');
    const titleCell = wsCond.getCell('E1');
    titleCell.value = 'CAJA CONDUCTORES';
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };
    wsCond.getCell('I1').value = `${fromParam} a ${toParam}`;
    wsCond.getCell('I1').font = { italic: true, size: 10 };

    const condHeaders = ['CHOFER', 'VEHICULO', 'MATRICULA', 'FOTO', 'BATERIA', 'Nª BATERIA', 'IMPORTE', 'EFECT/TARJE', 'COBRO', 'RECICLAJE', 'VENDE', 'OBSERVACION'];
    condHeaders.forEach((h, idx) => headerCell(wsCond.getCell(2, idx + 1), h));

    let row = 3;
    let totalCash = 0;
    let totalCard = 0;
    let totalWarranty = 0;

    for (const sale of driverSales ?? []) {
      const items = (sale as any).sale_items ?? [];
      const seller = (sale as any).seller;
      if (items.length === 0) {
        // Venta sin líneas (no debería pasar, pero no perdemos la fila)
        continue;
      }
      for (const item of items) {
        dataCell(wsCond.getCell(row, 1), seller?.full_name ?? '');
        dataCell(wsCond.getCell(row, 2), seller?.vehicle_plate ?? '');
        dataCell(wsCond.getCell(row, 3), sale.customer_vehicle_plate ?? '');
        dataCell(wsCond.getCell(row, 4), '');
        dataCell(wsCond.getCell(row, 5), item.product_model ? `${item.product_model.brand} ${item.product_model.model_name}` : '');
        dataCell(wsCond.getCell(row, 6), item.battery_unit?.code ?? '');
        dataCell(wsCond.getCell(row, 7), Number(sale.total_amount ?? 0), { align: 'right' });
        dataCell(wsCond.getCell(row, 8), PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method, { align: 'center' });
        dataCell(wsCond.getCell(row, 9), ''); // COBRO: sin dato equivalente, se deja en blanco
        dataCell(wsCond.getCell(row, 10), sale.old_battery_returned === false ? 'NO' : 'SÍ', { align: 'center' });
        dataCell(wsCond.getCell(row, 11), ''); // VENDE: sin dato equivalente, se deja en blanco
        dataCell(wsCond.getCell(row, 12), sale.notes ?? '');
        row += 1;
      }
      totalCash += Number(sale.amount_cash ?? 0);
      totalCard += Number(sale.amount_card ?? 0);
      if (sale.is_warranty) totalWarranty += Number(sale.total_amount ?? 0);
    }

    if ((driverSales ?? []).length === 0) {
      dataCell(wsCond.getCell(row, 1), 'Sin ventas de conductores en este rango de fechas.');
      wsCond.mergeCells(row, 1, row, 12);
      row += 1;
    }

    row += 1;
    const totalsHeaderRow = row;
    ['CONDUCTOR', 'CONCEPTO DEL GASTO', '', 'COCHE/MATRICULA', '', 'IMPORTE', 'FIRMA            FECHA'].forEach((h, idx) => {
      if (h) headerCell(wsCond.getCell(totalsHeaderRow, idx + 1), h);
    });
    headerCell(wsCond.getCell(totalsHeaderRow, 10), 'GARANTÍA');
    dataCell(wsCond.getCell(totalsHeaderRow, 11), totalWarranty.toFixed(2), { align: 'right' });
    headerCell(wsCond.getCell(totalsHeaderRow + 1, 10), 'TARJETA');
    dataCell(wsCond.getCell(totalsHeaderRow + 1, 11), totalCard.toFixed(2), { align: 'right' });
    headerCell(wsCond.getCell(totalsHeaderRow + 2, 10), 'EFECTIVO');
    dataCell(wsCond.getCell(totalsHeaderRow + 2, 11), totalCash.toFixed(2), { align: 'right' });
    headerCell(wsCond.getCell(totalsHeaderRow + 3, 10), 'TOTAL');
    dataCell(wsCond.getCell(totalsHeaderRow + 3, 11), (totalCard + totalCash).toFixed(2), { align: 'right', bold: true });

    // =====================================================================
    // HOJA 2: CAJA COMERCIAL
    // =====================================================================
    const wsCom = workbook.addWorksheet('CAJA COMERCIAL', { pageSetup: { orientation: 'landscape', fitToPage: true } });
    wsCom.columns = [{ width: 20 }, { width: 20 }, { width: 10 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 24 }];

    wsCom.mergeCells('A1:C1');
    dataCell(wsCom.getCell('A1'), `${fromParam} a ${toParam}`, { bold: true });
    wsCom.mergeCells('D1:F1');
    const comTitle = wsCom.getCell('D1');
    comTitle.value = 'CAJA COMERCIAL';
    comTitle.font = { bold: true, size: 14 };
    comTitle.alignment = { horizontal: 'center' };
    wsCom.getCell('G1').value = 'Nº HOJAS';
    wsCom.getCell('G1').font = { bold: true, size: 9 };
    wsCom.getCell('H1').value = commercialOrders?.length ?? 0;

    wsCom.mergeCells('A2:H2');
    wsCom.getCell('A2').value = '';

    const comHeaderRow = 3;
    headerCell(wsCom.getCell(comHeaderRow, 1), 'MODELO BATERIA');
    headerCell(wsCom.getCell(comHeaderRow, 2), 'CANTIDAD');
    headerCell(wsCom.getCell(comHeaderRow, 3), 'EMPRESA');
    headerCell(wsCom.getCell(comHeaderRow, 4), 'ENTREGA');
    wsCom.mergeCells(comHeaderRow, 5, comHeaderRow, 6);
    headerCell(wsCom.getCell(comHeaderRow, 5), 'ALBARAN');
    headerCell(wsCom.getCell(comHeaderRow, 7), 'OBSERVACIÓN');
    headerCell(wsCom.getCell(comHeaderRow + 1, 5), 'NUMERO');
    headerCell(wsCom.getCell(comHeaderRow + 1, 6), 'ENTREGADO');
    wsCom.mergeCells(comHeaderRow, 1, comHeaderRow + 1, 1);
    wsCom.mergeCells(comHeaderRow, 2, comHeaderRow + 1, 2);
    wsCom.mergeCells(comHeaderRow, 3, comHeaderRow + 1, 3);
    wsCom.mergeCells(comHeaderRow, 4, comHeaderRow + 1, 4);
    wsCom.mergeCells(comHeaderRow, 7, comHeaderRow + 1, 7);

    let comRow = comHeaderRow + 2;
    for (const order of commercialOrders ?? []) {
      const items = (order as any).commercial_order_items ?? [];
      const pos = (order as any).point_of_sale;
      const dispatchedDate = order.dispatched_at ? new Date(order.dispatched_at).toLocaleDateString('es-ES') : '';
      if (items.length === 0) continue;
      for (const item of items) {
        dataCell(wsCom.getCell(comRow, 1), item.product_model ? `${item.product_model.brand} ${item.product_model.model_name}` : '');
        dataCell(wsCom.getCell(comRow, 2), item.quantity ?? 0, { align: 'center' });
        dataCell(wsCom.getCell(comRow, 3), pos?.name ?? '');
        dataCell(wsCom.getCell(comRow, 4), dispatchedDate, { align: 'center' });
        dataCell(wsCom.getCell(comRow, 5), ''); // ALBARAN > NUMERO: sin dato equivalente, se deja en blanco
        dataCell(wsCom.getCell(comRow, 6), ''); // ALBARAN > ENTREGADO: sin dato equivalente, se deja en blanco
        dataCell(wsCom.getCell(comRow, 7), order.notes ?? '');
        comRow += 1;
      }
    }
    if ((commercialOrders ?? []).length === 0) {
      dataCell(wsCom.getCell(comRow, 1), 'Sin salidas comerciales en este rango de fechas.');
      wsCom.mergeCells(comRow, 1, comRow, 7);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="cajas_${fromParam}_a_${toParam}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('GET /api/exports/cajas', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado al generar el Excel' },
      { status: 500 }
    );
  }
}
