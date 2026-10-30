import {
  listeningScriptLengthIssue,
  listeningScriptLengthRule,
  spokenWordCount,
} from './toeic-listening-length';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

describe('TOEIC Listening script length', () => {
  it('counts spoken words, not speaker labels', () => {
    expect(
      spokenWordCount('M: Hello there. W: Hi! Woman 2: Good morning.'),
    ).toBe(5);
    expect(spokenWordCount('W2: It costs $40 - ok?')).toBe(4);
  });

  it('rejects the 35-word dialogues that made the section 33 minutes', () => {
    const old =
      "M: The client moved tomorrow's meeting from ten to eleven thirty. W: That works, but Conference Room A is booked then. M: I'll reserve Room C instead.";
    expect(listeningScriptLengthIssue(3, old)).toMatch(/quá ngắn/);
  });

  it('accepts a conversation and a talk of real-test length', () => {
    expect(
      listeningScriptLengthIssue(3, `M: ${words(60)} W: ${words(50)}`),
    ).toBe(null);
    expect(listeningScriptLengthIssue(4, words(140))).toBe(null);
  });

  it('rejects a script far over length', () => {
    expect(listeningScriptLengthIssue(4, words(260))).toMatch(/quá dài/);
  });

  it('leaves Parts 1-2 and Reading alone', () => {
    expect(listeningScriptLengthIssue(2, 'Where is it?')).toBe(null);
    expect(listeningScriptLengthIssue(7, '')).toBe(null);
    expect(listeningScriptLengthRule(1)).toBe('');
  });

  it('tells the generator the word range', () => {
    expect(listeningScriptLengthRule(3)).toContain('85-160');
    expect(listeningScriptLengthRule(4)).toContain('100-180');
  });
});
