import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

export interface VietnamProvinceItem {
  code: string;
  name: string;
  divisionType: string;
  codename: string;
  phoneCode?: number;
}

export interface VietnamWardItem {
  code: string;
  name: string;
  divisionType: string;
  codename: string;
  provinceCode: string;
}

interface LocalSnapshotData {
  metadata: {
    source: string;
    generatedAt: string;
    provider: string;
    apiVersion: string;
    officialValidationDate: string;
    expectedProvinceCount: number;
    expectedWardCount: number;
    administrativeModel: string;
  };
  provinces: VietnamProvinceItem[];
  wards: VietnamWardItem[];
}

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private localSnapshot: LocalSnapshotData | null = null;
  private readonly CACHE_TTL_SECONDS = 86400; // 24 hours
  private readonly API_TIMEOUT_MS = 4000;
  private readonly PROVINCE_API_BASE = 'https://provinces.open-api.vn/api/v2';

  constructor(@Optional() @InjectRedis() private readonly redis?: Redis) {
    this.loadLocalSnapshot();
  }

  private loadLocalSnapshot(): LocalSnapshotData {
    if (this.localSnapshot) return this.localSnapshot;

    try {
      const filePath = path.join(__dirname, 'data', 'vietnam-administrative-units-v2.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        this.localSnapshot = JSON.parse(raw);
        return this.localSnapshot!;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to read local location snapshot file: ${err?.message}`);
    }

    // Default minimal empty fallback if file read failed
    this.localSnapshot = {
      metadata: {
        source: 'local-fallback',
        generatedAt: new Date().toISOString(),
        provider: 'Province Open API',
        apiVersion: 'v2',
        officialValidationDate: '2026-10-10',
        expectedProvinceCount: 34,
        expectedWardCount: 3321,
        administrativeModel: 'TWO_LEVEL_POST_2025',
      },
      provinces: [],
      wards: [],
    };
    return this.localSnapshot;
  }

  async getProvinces(): Promise<VietnamProvinceItem[]> {
    const cacheKey = 'breadtrans:location:provinces:v2';

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Redis getProvinces error: ${err?.message}`);
      }
    }

    // Try fetching from external Provider Open API v2
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.API_TIMEOUT_MS);
      const res = await fetch(`${this.PROVINCE_API_BASE}/p/`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const rawList = await res.json();
        if (Array.isArray(rawList) && rawList.length > 0) {
          const provinces: VietnamProvinceItem[] = rawList.map((p: any) => ({
            code: String(p.code),
            name: p.name,
            divisionType: p.division_type,
            codename: p.codename,
            phoneCode: p.phone_code,
          }));

          if (this.redis) {
            try {
              await this.redis.set(cacheKey, JSON.stringify(provinces), 'EX', this.CACHE_TTL_SECONDS);
            } catch (err: any) {
              this.logger.warn(`Redis cache set error: ${err?.message}`);
            }
          }
          return provinces;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Province Open API v2 fetch error, using local snapshot: ${err?.message}`);
    }

    // Fallback to local verified snapshot
    const snapshot = this.loadLocalSnapshot();
    return snapshot.provinces;
  }

  async getWards(provinceCode: string): Promise<VietnamWardItem[]> {
    const normalizedProvinceCode = String(provinceCode || '').trim();
    if (!normalizedProvinceCode) return [];

    const cacheKey = `breadtrans:location:wards:v2:${normalizedProvinceCode}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Redis getWards error: ${err?.message}`);
      }
    }

    // Try fetching province details with wards (depth=2) from Provider Open API v2
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.API_TIMEOUT_MS);
      const res = await fetch(`${this.PROVINCE_API_BASE}/p/${normalizedProvinceCode}?depth=2`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const provinceObj = await res.json();
        if (provinceObj && Array.isArray(provinceObj.wards)) {
          const wards: VietnamWardItem[] = provinceObj.wards.map((w: any) => ({
            code: String(w.code),
            name: w.name,
            divisionType: w.division_type,
            codename: w.codename,
            provinceCode: String(w.province_code || normalizedProvinceCode),
          }));

          if (this.redis) {
            try {
              await this.redis.set(cacheKey, JSON.stringify(wards), 'EX', this.CACHE_TTL_SECONDS);
            } catch (err: any) {
              this.logger.warn(`Redis cache set error for wards: ${err?.message}`);
            }
          }
          return wards;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Province Open API v2 wards fetch error, using local snapshot: ${err?.message}`);
    }

    // Fallback to local snapshot filtered by provinceCode
    const snapshot = this.loadLocalSnapshot();
    return snapshot.wards.filter((w) => String(w.provinceCode) === normalizedProvinceCode);
  }

  async validateWardBelongsToProvince(
    provinceCode: string,
    wardCode: string,
  ): Promise<{ valid: boolean; provinceName?: string; wardName?: string }> {
    const normalizedProvinceCode = String(provinceCode || '').trim();
    const normalizedWardCode = String(wardCode || '').trim();

    if (!normalizedProvinceCode || !normalizedWardCode) {
      return { valid: false };
    }

    const provinces = await this.getProvinces();
    const province = provinces.find((p) => String(p.code) === normalizedProvinceCode);
    if (!province) {
      return { valid: false };
    }

    const wards = await this.getWards(normalizedProvinceCode);
    const ward = wards.find(
      (w) => String(w.code) === normalizedWardCode && String(w.provinceCode) === normalizedProvinceCode,
    );
    if (!ward) {
      return { valid: false, provinceName: province.name };
    }

    return {
      valid: true,
      provinceName: province.name,
      wardName: ward.name,
    };
  }

  getSnapshotMetadata() {
    return this.loadLocalSnapshot().metadata;
  }
}
