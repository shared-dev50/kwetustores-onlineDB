export interface CloverImage {
  url: string;
}

export interface CloverCategory {
  id?: string;
  name?: string;
}

export interface CloverTag {
  id?: string;
  name?: string;
}

export interface CloverItem {
  id: string;
  name: string;
  price: number;
  code: string;
  sku: string;
  stockCount: number;
  stockQuantity: number;
  available: boolean;
  hidden: boolean;
  onlineName: string;
  description: string;
  enabledOnline: boolean;
  modifiedTime: number;

  categories: {
    elements: CloverCategory[];
  };
  tags: {
    elements: CloverTag[];
  };
  images: {
    elements: CloverImage[];
  };

  priceType: "FIXED" | "VARIABLE";
  unitName: string;
  isAgeRestricted: boolean;
  deleted: boolean;
}
