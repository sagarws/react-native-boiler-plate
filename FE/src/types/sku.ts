/** Types copied from TrackVid-FE `slices/skuSlice.ts` and `api/skuData-service.ts`. */

export interface ProductSku {
  _id: string;
  id?: string;
  companyId: string;
  fileKey: string;
  userId: string;
  sellerSkuCode: string;
  color: string;
  size: string;
  /** Image (or product video) link shown in the preview dialog. */
  imageLink: string;
  imageSize?: string;
  isDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

export interface GetProductSkuDataPayload {
  page: number;
  limit: number;
  searchInput: string;
  color?: string;
  size?: string;
}

export interface ProductSkuResponse {
  order: ProductSku[];
  metadata: {
    limit: number;
    page: number;
    total: number;
    totalPage: number;
  };
  colors: string[];
  sizes: string[];
}
