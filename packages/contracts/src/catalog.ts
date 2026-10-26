export const PRODUCT_SORTS = ['popular', 'new', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const SURFACES = ['wood', 'lacquer', 'metal', 'fabric'] as const;
export type Surface = (typeof SURFACES)[number];
