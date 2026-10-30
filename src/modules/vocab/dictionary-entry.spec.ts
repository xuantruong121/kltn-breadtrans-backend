import {
  entryDataFromWord,
  flattenDeckWord,
  headwordOf,
  posOf,
} from './dictionary-entry';

describe('dictionary entry helpers', () => {
  it('normalizes the lookup key and part of speech', () => {
    expect(headwordOf('  Follow   Up ')).toBe('follow up');
    expect(posOf(' Verb ')).toBe('verb');
    expect(posOf('')).toBe('noun');
  });

  it('folds the entry into the flat word shape, keeping the deck-word id', () => {
    const flat = flattenDeckWord({
      id: 7,
      topicId: 3,
      entryId: 40,
      order: 2,
      createdAt: new Date(0),
      entry: {
        id: 40,
        headword: 'agenda',
        displayWord: 'agenda',
        pos: 'noun',
        ipaUs: '/əˈdʒendə/',
        ipaUk: null,
        audioUs: null,
        audioUk: null,
        meaningVi: 'chương trình họp',
        definitionEn: null,
        exampleEn: 'Stick to the agenda.',
        exampleVi: null,
        collocations: null,
        synonyms: null,
        antonyms: null,
        source: 'CURATED',
        status: 'APPROVED',
        reviewedAt: null,
        reviewedBy: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    } as any);
    expect(flat).toMatchObject({
      id: 7,
      topicId: 3,
      entryId: 40,
      word: 'agenda',
      meaning: 'chương trình họp',
      ipaUs: '/əˈdʒendə/',
    });
    expect('entry' in flat).toBe(false);
  });

  it('maps only the fields sent, blank strings to null', () => {
    expect(
      entryDataFromWord({ word: ' Agenda ', meaning: 'x', ipaUk: ' ' }),
    ).toEqual({
      headword: 'agenda',
      displayWord: 'Agenda',
      meaningVi: 'x',
      ipaUk: null,
    });
  });
});
