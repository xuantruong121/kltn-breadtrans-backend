export class MarketProductDto {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  rarity: string;
  price: number;
  imageUrl: string | null;
  stock: number;
  available: boolean;
  purchaseCount: number;
  isActive: boolean;
}
