import {
  assignDialogueGenders,
  requestedGender,
  speakerGender,
} from './listening-voice.logic';

const genders = (...ids: string[]) =>
  Object.fromEntries(assignDialogueGenders(ids.map((id) => ({ id }))));

describe('dialogue voices (owner 2026-11-25: "Mark" and "Sarah" both got the male voice)', () => {
  it('gives Mark and Sarah different voices in either order', () => {
    expect(genders('Mark', 'Sarah')).toEqual({ Mark: 'male', Sarah: 'female' });
    expect(genders('Sarah', 'Mark')).toEqual({ Sarah: 'female', Mark: 'male' });
  });

  it('gives an unknown name the voice the other speaker does not have', () => {
    expect(genders('Mark', 'Quinn')).toEqual({ Mark: 'male', Quinn: 'female' });
    expect(genders('Quinn', 'Mark')).toEqual({ Quinn: 'female', Mark: 'male' });
    expect(genders('Quinn', 'Nora')).toEqual({ Quinn: 'male', Nora: 'female' });
  });

  it('keeps the old positional rule for two unknown speakers and a lone speaker', () => {
    expect(genders('Receptionist', 'Tourist')).toEqual({
      Receptionist: 'female',
      Tourist: 'male',
    });
    expect(genders('speaker-1')).toEqual({ 'speaker-1': 'female' });
  });

  it('never lets two speakers share one voice: a second man takes the other voice', () => {
    expect(genders('Mark', 'David')).toEqual({ Mark: 'male', David: 'female' });
  });

  it('an explicit voiceKey wins, even when both ask for the same voice', () => {
    expect(
      Object.fromEntries(
        assignDialogueGenders([
          { id: 'Mark', voiceKey: 'en-us-female-01' },
          { id: 'Sarah' },
        ]),
      ),
    ).toEqual({ Mark: 'female', Sarah: 'male' });
    expect(
      Object.fromEntries(
        assignDialogueGenders([
          { id: 'A', voiceKey: 'female-01' },
          { id: 'B', voiceKey: 'female-01' },
        ]),
      ),
    ).toEqual({ A: 'female', B: 'female' });
  });

  it('reads common first names as whole words, and roles as before', () => {
    expect(speakerGender('Sarah')).toBe('female');
    expect(speakerGender('Dr. Emily Stone')).toBe('female');
    expect(speakerGender('John')).toBe('male');
    expect(speakerGender('Khách hàng')).toBe('female');
    expect(speakerGender('Nhân viên')).toBe('male');
    expect(speakerGender('Tourist')).toBeNull();
    expect(requestedGender('en-gb-male-01')).toBe('male');
    expect(requestedGender(undefined)).toBeNull();
  });
});
