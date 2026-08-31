export type UserRole = 'admin' | 'almacenero' | 'conductor' | 'comercial';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  active: boolean;
  avatar_url: string | null;
  vehicle_plate: string | null;
  zone: string | null;
  driver_code: string | null;
  created_at: string;
  updated_at: string;
}

export type DeliveryType = 'conductor' | 'ofi' | 'web';

export type BatteryUnitStatus = 'assigned' | 'sold' | 'returned' | 'cancelled';

export interface BatteryUnit {
  id: string;
  code: string;
  product_model_id: string;
  delivery_id: string | null;
  driver_id: string | null;
  delivery_type: DeliveryType;
  status: BatteryUnitStatus;
  sale_id: string | null;
  created_at: string;
  sold_at: string | null;
}

export type BatteryTech = 'normal' | 'agm' | 'efb';

export interface ProductModel {
  id: string;
  category_id: string;
  brand: string;
  model_name: string;
  amperage_ah: number | null;
  cold_cranking_amps: number | null;
  battery_tech: BatteryTech | null;
  is_special: boolean;
  special_reason: string | null;
  extra_attributes: Record<string, unknown>;
  min_stock_alert: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductEanCode {
  id: string;
  ean_code: string;
  product_model_id: string;
}

export interface WarehouseStockRow {
  id: string;
  warehouse_id: string;
  product_model_id: string;
  quantity: number;
  updated_at: string;
  product_model?: ProductModel;
}

export interface DriverStockRow {
  id: string;
  driver_id: string;
  product_model_id: string;
  quantity: number;
  updated_at: string;
  product_model?: ProductModel;
}

export interface PointOfSale {
  id: string;
  name: string;
  owner_name: string | null;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DriverWallet {
  id: string;
  driver_id: string;
  cash_balance: number;
  card_balance: number;
  last_reset_at: string | null;
  last_reset_by: string | null;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  tax_id: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  active: boolean;
}

export interface NewProductModelInput {
  brand: string;
  model_name: string;
  amperage_ah?: number;
  cold_cranking_amps?: number;
  battery_tech?: BatteryTech;
  is_special: boolean;
  special_reason?: string;
  min_stock_alert?: number;
}
