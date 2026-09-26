// Estas cabeceras son el CONTRATO entre exportar e importar el catálogo de
// almacén: /api/exports/almacen-productos las escribe, y
// /api/imports/almacen-productos las lee por nombre (en cualquier orden).
// No cambiar el texto de una sin actualizar la otra.
export const CATALOG_HEADERS = [
  'EAN',
  'REFERENCIA',
  'MARCA',
  'MODELO',
  'LINEA',
  'VOLTIOS',
  'CAPACIDAD_AH',
  'CCA',
  'TECNOLOGIA',
  'POLARIDAD',
  'LARGO_MM',
  'ANCHO_MM',
  'ALTO_MM',
  'CAJA',
  'SUJECION',
  'PESO_KG',
  'UDS_POR_CAPA',
  'CAPAS_POR_PALET',
  'UDS_POR_PALET',
  'PVP',
  'STOCK_ALMACEN',
  'STOCK_MINIMO_ALERTA',
  'ACTIVO',
] as const;
