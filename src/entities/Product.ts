export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  colorCode: string;
  deleted: boolean;
}

export interface Categories {
  elements: Category[];
}

export interface Tags {
  elements: unknown[];
}

export interface Product {
  id: string;
  hidden: boolean;
  available: boolean;
  autoManage: boolean;
  name: string;
  alternateName: string;
  code: string;
  sku: string;
  price: number;
  priceType: "FIXED" | "VARIABLE";
  defaultTaxRates: boolean;
  unitName: string;
  isRevenue: boolean;
  stockCount: number;

  categories?: Categories;
  tags?: Tags;

  modifiedTime: number;
  priceWithoutVat: number;
  deleted: boolean;
  onlineName: string;
  description: string;
  enabledOnline: boolean;
  isAgeRestricted: boolean;
}
