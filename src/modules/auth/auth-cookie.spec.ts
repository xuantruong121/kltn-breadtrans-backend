import { DEVICE_COOKIE, deviceIdFrom, setDeviceCookie } from './auth-cookie';

describe('device cookie', () => {
  const id = '0b7c6a7e-4f2d-4f7b-9d65-2a1f3c9e8b10';

  it('reads a well-formed device id from the Cookie header', () => {
    expect(deviceIdFrom(`bt_rt=abc; ${DEVICE_COOKIE}=${id}; theme=dark`)).toBe(
      id,
    );
    expect(deviceIdFrom(`${DEVICE_COOKIE}=${id.toUpperCase()}`)).toBe(
      id.toUpperCase(),
    );
  });

  it('ignores a missing, empty or malformed value, so nothing odd reaches a Redis key', () => {
    expect(deviceIdFrom(undefined)).toBeNull();
    expect(deviceIdFrom('bt_rt=abc')).toBeNull();
    expect(deviceIdFrom(`${DEVICE_COOKIE}=`)).toBeNull();
    expect(
      deviceIdFrom(`${DEVICE_COOKIE}=..%2F..%2Fauth:session:1:x`),
    ).toBeNull();
    expect(deviceIdFrom(`${DEVICE_COOKIE}=${id}-extra`)).toBeNull();
  });

  it('is HttpOnly, Strict, on the auth path and lasts a year', () => {
    const res = { cookie: jest.fn() };
    setDeviceCookie(res, id);
    expect(res.cookie).toHaveBeenCalledWith(
      DEVICE_COOKIE,
      id,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 365 * 24 * 3600 * 1000,
      }),
    );
  });
});
