import { LocationService } from './location.service';

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(() => {
    // Instantiate with no redis to test local fallback & snapshot integrity
    service = new LocationService();
  });

  it('loads authoritative 34 provinces from verified snapshot when external API is unreachable', async () => {
    const provinces = await service.getProvinces();
    expect(provinces.length).toBe(34);
    const hcm = provinces.find((p) => p.code === '79');
    expect(hcm).toBeDefined();
    expect(hcm?.name).toBe('Thành phố Hồ Chí Minh');
    const hn = provinces.find((p) => p.code === '1');
    expect(hn).toBeDefined();
    expect(hn?.name).toBe('Thành phố Hà Nội');
  });

  it('loads wards filtered by provinceCode from snapshot', async () => {
    const hcmWards = await service.getWards('79');
    expect(hcmWards.length).toBeGreaterThan(0);
    hcmWards.forEach((w) => {
      expect(w.provinceCode).toBe('79');
      expect(['phường', 'xã', 'đặc khu']).toContain(
        w.divisionType.toLowerCase(),
      );
    });

    const emptyWards = await service.getWards('invalid-code');
    expect(emptyWards).toHaveLength(0);
  });

  it('validates whether a ward belongs to a province', async () => {
    const hcmWards = await service.getWards('79');
    const validWard = hcmWards[0];

    // Valid pair
    const validResult = await service.validateWardBelongsToProvince(
      '79',
      validWard.code,
    );
    expect(validResult.valid).toBe(true);
    expect(validResult.provinceName).toBe('Thành phố Hồ Chí Minh');
    expect(validResult.wardName).toBe(validWard.name);

    // Cross-province pair: Ha Noi province ('1') with HCM ward
    const crossResult = await service.validateWardBelongsToProvince(
      '1',
      validWard.code,
    );
    expect(crossResult.valid).toBe(false);
    expect(crossResult.provinceName).toBe('Thành phố Hà Nội');

    // Unknown province
    const unknownProv = await service.validateWardBelongsToProvince(
      '999',
      '12345',
    );
    expect(unknownProv.valid).toBe(false);
    expect(unknownProv.provinceName).toBeUndefined();
  });

  it('exposes provenance snapshot metadata', () => {
    const metadata = service.getSnapshotMetadata();
    expect(metadata.expectedProvinceCount).toBe(34);
    expect(metadata.expectedWardCount).toBe(3321);
    expect(metadata.administrativeModel).toBe('TWO_LEVEL_POST_2025');
  });
});
