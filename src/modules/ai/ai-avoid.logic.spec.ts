import {
  aiAvoidList,
  avoidRule,
  itemKey,
  withoutAvoidedItems,
} from './ai-avoid.logic';

describe('ai-avoid.logic ("Tạo câu khác", owner 2026-11-25)', () => {
  it('treats items that differ only in case, spacing or end marks as one, Vietnamese included', () => {
    expect(itemKey('  Tôi đã  ăn sáng. ')).toBe(itemKey('tôi đã ăn sáng'));
    expect(itemKey('"Where is the agenda?"')).toBe(
      itemKey('where is the agenda'),
    );
    expect(itemKey('chương trình')).not.toBe(itemKey('chương trinh'));
  });

  it('keeps strings only, one line each, without blanks or repeats, at most 40', () => {
    expect(aiAvoidList(['a  b', 'A B.', '', 7, null, 'c'])).toEqual([
      'a b',
      'c',
    ]);
    expect(aiAvoidList('x')).toEqual([]);
    expect(
      aiAvoidList(Array.from({ length: 50 }, (_, i) => `line ${i}`)),
    ).toHaveLength(40);
    expect(aiAvoidList(['x'.repeat(400)])[0]).toHaveLength(300);
  });

  it('adds an avoid line only when there is a list', () => {
    expect(avoidRule('questions', [])).toBe('');
    expect(avoidRule('questions', ['q'])).toMatch(
      /already has the questions in the avoid list/,
    );
  });

  it('drops new items that repeat an avoided one', () => {
    const items = [{ word: 'Agenda' }, { word: 'minutes' }];
    expect(withoutAvoidedItems(items, (item) => item.word, ['agenda'])).toEqual(
      [{ word: 'minutes' }],
    );
    expect(withoutAvoidedItems(items, (item) => item.word, [])).toBe(items);
  });
});
