import { toeicQuestionType } from './toeic-question-type';

const t = (
  part: number,
  text: string | null,
  options: string[] = [],
  correctIndex = 0,
  groupText?: string,
) => toeicQuestionType({ part, text, options, correctIndex, groupText });

describe('TOEIC question type (rule-based, from the item text)', () => {
  it('Part 1: people vs objects from the correct statement', () => {
    expect(
      t(
        1,
        null,
        ['A woman is opening a window.', 'Some folders are being thrown away.'],
        0,
      ),
    ).toBe('Tranh tả người');
    expect(
      t(
        1,
        null,
        [
          'People are riding bicycles.',
          'Some bicycles have been parked outside a building.',
        ],
        1,
      ),
    ).toBe('Tranh tả vật, cảnh');
    expect(t(1, null, ['The workers are planting trees.'], 0)).toBe(
      'Tranh tả người',
    );
  });

  it('Part 2: from the spoken prompt', () => {
    const p2 = (prompt: string) =>
      t(
        2,
        'Choose the best response.',
        ['a', 'b', 'c'],
        0,
        `AUDIO PROMPT: ${prompt}`,
      );
    expect(p2('When will the new printer be delivered?')).toBe('Câu hỏi When');
    expect(p2('Who is leading the client presentation?')).toBe('Câu hỏi Who');
    expect(p2('Could you send me the updated price list?')).toBe(
      'Câu đề nghị, yêu cầu',
    );
    expect(p2('Haven’t you submitted the travel form yet?')).toBe(
      'Câu hỏi Yes/No',
    );
    expect(p2('Should we meet on Monday or Tuesday?')).toBe('Câu hỏi lựa chọn');
    expect(p2("The report is ready, isn't it?")).toBe('Câu hỏi đuôi');
    expect(p2('The printer on the third floor is out of paper.')).toBe(
      'Câu trần thuật',
    );
  });

  it('Part 3/4: from the question stem', () => {
    expect(t(3, 'What are the speakers discussing?')).toBe('Chủ đề, mục đích');
    expect(t(3, 'What will the man probably do?')).toBe('Hành động tiếp theo');
    expect(t(3, 'What does the woman request?')).toBe('Đề nghị, yêu cầu');
    expect(t(3, 'What problem does the woman mention?')).toBe(
      'Vấn đề, khó khăn',
    );
    expect(t(4, 'Who most likely is the speaker?')).toBe('Danh tính, nơi chốn');
    expect(t(3, 'What changed about the meeting?')).toBe('Chi tiết');
  });

  it('Part 5/6: from the answer options', () => {
    expect(t(5, '', ['during', 'among', 'until', 'beside'])).toBe('Giới từ');
    expect(t(5, '', ['unless', 'despite', 'although', 'because'])).toBe(
      'Liên từ, giới từ',
    );
    expect(t(5, '', ['reliability', 'reliably', 'reliable', 'rely'])).toBe(
      'Từ loại',
    );
    expect(t(5, '', ['review', 'reviewed', 'reviewing', 'reviews'])).toBe(
      'Dạng động từ, thì',
    );
    expect(t(5, '', ['schedule', 'invoice', 'budget', 'receipt'])).toBe(
      'Từ vựng',
    );
    expect(
      t(6, '', [
        'We will contact you once the order ships.',
        'Please keep this receipt for your records today.',
      ]),
    ).toBe('Chọn câu phù hợp');
  });

  it('items the old fallbacks mislabelled (found on the authored exam)', () => {
    const p2 = (prompt: string) =>
      t(2, '', ['a', 'b', 'c'], 0, `AUDIO PROMPT: ${prompt}`);
    // A request, not a statement.
    expect(p2('Could I borrow your charger for a few minutes?')).toBe(
      'Câu đề nghị, yêu cầu',
    );
    expect(p2('Would you like tea or coffee?')).toBe('Câu hỏi lựa chọn');
    expect(t(4, 'Why is Daniel calling?')).toBe('Chủ đề, mục đích');
    expect(t(4, 'What is the speaker discussing?')).toBe('Chủ đề, mục đích');
    // A place in the talk, not the speakers' identity.
    expect(t(4, 'Where is breakfast served?')).toBe('Chi tiết');
    expect(t(4, 'Why is public transportation recommended?')).toBe('Chi tiết');
    expect(t(3, 'How does the man propose solving the problem?')).toBe(
      'Đề nghị, yêu cầu',
    );
    expect(t(3, 'What is suggested about Thursday?')).toBe('Chưa phân loại');
    // Part 5/6 sets that were all "Từ vựng" before.
    expect(t(5, '', ['was', 'are', 'is', 'be'])).toBe('Dạng động từ, thì');
    expect(
      t(6, '', ['will begin', 'began', 'has begun yesterday', 'beginning']),
    ).toBe('Dạng động từ, thì');
    expect(t(5, '', ['because of', 'although', 'however', 'unless'])).toBe(
      'Liên từ, giới từ',
    );
    expect(t(5, '', ['which', 'when', 'where', 'who'])).toBe('Đại từ quan hệ');
    expect(t(5, '', ['goodness', 'well', 'good', 'betterly'])).toBe(
      'Chưa phân loại',
    );
    expect(t(5, '', ['order', 'addition of', 'spite', 'case'])).toBe(
      'Chưa phân loại',
    );
    expect(t(7, 'Why is Jordan likely qualified?')).toBe('Suy luận');
  });

  it('Part 7: from the question stem', () => {
    expect(t(7, 'What is the email mainly about?')).toBe('Ý chính, mục đích');
    expect(t(7, 'What is being announced?')).toBe('Ý chính, mục đích');
    expect(t(7, 'What is NOT mentioned about the desk?')).toBe(
      'Thông tin đúng, không đúng',
    );
    expect(t(7, 'What is most likely true about Ms. Ruiz?')).toBe(
      'Thông tin đúng, không đúng',
    );
    expect(t(7, 'Who most likely wrote the review?')).toBe('Suy luận');
    expect(t(7, 'The word "cover" is closest in meaning to')).toBe(
      'Từ đồng nghĩa',
    );
    expect(t(7, 'When should final revisions be uploaded?')).toBe('Chi tiết');
  });
});
