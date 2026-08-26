import { parseDurationToSeconds } from './duration';

describe('parseDurationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['7d', 604_800],
    ['3600', 3600],
  ])('convierte "%s" a %i segundos', (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it('acepta mayúsculas y espacios sobrantes', () => {
    expect(parseDurationToSeconds(' 15M ')).toBe(900);
    expect(parseDurationToSeconds('2H')).toBe(7200);
  });

  it.each(['', 'abc', '15x', 'm15', '-5m', '1.5h'])(
    'rechaza la duración inválida "%s"',
    (input) => {
      expect(() => parseDurationToSeconds(input)).toThrow(/Duración inválida/);
    },
  );
});
