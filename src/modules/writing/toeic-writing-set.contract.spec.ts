import {
  TOEIC_WRITING_SLOT_CONTRACT,
  validateToeicWritingStructure,
} from './toeic-writing-set.contract';

const items = TOEIC_WRITING_SLOT_CONTRACT.map((taskKind, index) => ({
  order: index + 1,
  taskKind,
}));

describe('TOEIC Writing slot contract', () => {
  it('accepts exactly five picture, two request and one essay slot', () => {
    expect(validateToeicWritingStructure(items)).toMatchObject({
      valid: true,
      counts: {
        total: 8,
        pictureSentence: 5,
        writtenRequest: 2,
        opinionEssay: 1,
      },
    });
  });

  it.each([
    ['missing essay', items.slice(0, 7)],
    [
      'wrong order kind',
      items.map((item, index) =>
        index === 5 ? { ...item, taskKind: 'PICTURE_SENTENCE' } : item,
      ),
    ],
    [
      'duplicate order',
      items.map((item, index) => (index === 7 ? { ...item, order: 7 } : item)),
    ],
  ])('rejects %s', (_name, invalidItems) => {
    expect(validateToeicWritingStructure(invalidItems)).toMatchObject({
      valid: false,
    });
  });
});
