/**
 * Question type of a TOEIC L&R item, for the learner statistics table
 * ("[Part 2] Câu hỏi Where", "[Part 5] Từ loại", ...).
 *
 * BreadTrans questions carry no stored type, so the type is derived from the
 * item's own text with fixed rules: the Part 1 answer statement, the Part 2
 * spoken prompt, the Part 3/4/7 question stem, and the Part 5/6 answer
 * options. Deterministic and explainable. These are automatic labels, not
 * authored metadata: an item no rule recognises reliably is reported as
 * UNCLASSIFIED instead of a guessed label.
 */

export const UNCLASSIFIED = 'Chưa phân loại';

type Item = {
  part: number;
  text: string | null;
  options: unknown;
  correctIndex: number;
  /** Group passage; for Part 2 the spoken prompt ("AUDIO PROMPT: ..."). */
  groupText?: string | null;
};

const PEOPLE =
  /^(a|an|the|some|several|two|three|many|one of the|both)?\s*(man|men|woman|women|people|person|worker|workers|customer|customers|waiter|waitress|travell?ers?|passengers?|staff|employees?|students?|shoppers?|diners?|visitors?|clerk|chef|cyclists?|pedestrians?|speakers?|presenters?|audience|team|they|he|she|someone)\b/i;

const set = (s: string) => new Set(s.split(' '));
const PREPOSITIONS = set(
  'about above across after against along among around at before behind below beneath beside besides between beyond by despite during except for from in inside into like near of off on onto opposite out outside over past per regarding since through throughout to toward towards under underneath until up upon via with within without',
);
/** Words that make up conjunctions and linking adverbs, single or multi-word. */
const CONNECTORS = set(
  'although because unless whereas while if whether though since once so yet nor or and but therefore however moreover nevertheless otherwise meanwhile even as soon that provided in case than when of',
);
const PRONOUNS = set(
  'i me my mine myself you your yours yourself yourselves he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves each one',
);
const RELATIVES = set('who whom whose which that when where why what');
const AUXILIARIES = set(
  'to will would has have had be been being is are was were do does did can could may might must should shall',
);

const words = (s: string) =>
  s.trim().toLowerCase().split(/\s+/).filter(Boolean);

const root = (word: string, length = 4) =>
  word.replace(/[^a-z]/g, '').slice(0, length);

/** The content word of an option: its first word that is not an auxiliary. */
const head = (option: string) =>
  words(option).find((w) => !AUXILIARIES.has(w)) ?? words(option)[0] ?? '';

/** How many options share the most common root. */
function sharedRoot(heads: string[], length = 4) {
  const counts = new Map<string, number>();
  for (const h of heads)
    counts.set(root(h, length), (counts.get(root(h, length)) ?? 0) + 1);
  return Math.max(...counts.values());
}

function part1(item: Item) {
  const options = Array.isArray(item.options) ? (item.options as string[]) : [];
  const answer = (options[item.correctIndex] ?? '').trim();
  if (!answer) return UNCLASSIFIED;
  return PEOPLE.test(answer) ? 'Tranh tả người' : 'Tranh tả vật, cảnh';
}

function part2(item: Item) {
  const prompt = (item.groupText ?? '')
    .replace(/^\s*AUDIO\s+PROMPT\s*:\s*/i, '')
    .trim();
  const lower = prompt.toLowerCase().replace(/[’‘]/g, "'");
  if (!prompt) return UNCLASSIFIED;
  if (
    /,\s*(isn't|aren't|wasn't|weren't|don't|doesn't|didn't|won't|haven't|hasn't|can't|shouldn't|right)\b[^,]*\?$/.test(
      lower,
    )
  )
    return 'Câu hỏi đuôi';
  if (
    /\bor\b/.test(lower) &&
    prompt.endsWith('?') &&
    !/^(who|what|when|where|why|how|which)\b/.test(lower)
  )
    return 'Câu hỏi lựa chọn';
  if (
    /^(would|could|can|will) you\b|^(could|can|may) i\b|^(can|could|shall) we\b|^why don't|^let's|^shall\b|^how about|^please\b/.test(
      lower,
    )
  )
    return 'Câu đề nghị, yêu cầu';
  const wh = /^(who|whose|what|which|when|where|why|how)\b/.exec(lower)?.[1];
  if (wh)
    return `Câu hỏi ${wh === 'whose' ? 'Who' : wh[0].toUpperCase() + wh.slice(1)}`;
  if (
    /^(do|does|did|is|are|was|were|have|has|had|will|can|should|may|might|must|haven't|hasn't|isn't|aren't|don't|doesn't|didn't|won't|wasn't)\b/.test(
      lower,
    )
  )
    return 'Câu hỏi Yes/No';
  return prompt.endsWith('?') ? UNCLASSIFIED : 'Câu trần thuật';
}

const WH_STEM = /^(what|when|where|who|whom|whose|why|how|which)\b/;

function talk(item: Item) {
  const q = (item.text ?? '').toLowerCase().replace(/[’‘]/g, "'");
  if (/mean when|imply|implies|mean by/.test(q)) return 'Hàm ý câu nói';
  if (/graphic|look at the/.test(q)) return 'Câu hỏi kèm biểu đồ, bảng';
  if (
    /mainly (about|discussing)|(are|is) the speakers? discussing|is the (talk|announcement|message|broadcast|conversation) (mainly )?about|purpose|^why is .+ calling|main topic/.test(
      q,
    )
  )
    return 'Chủ đề, mục đích';
  // Only questions about the speakers or listeners themselves; "Where is
  // breakfast served?" is a detail, not the speakers' identity or place.
  if (
    /^(who|where) (most likely )?(is|are|does|do) the (speakers?|man|woman|listeners?|caller)\b|work(s)? (at|for)|occupation|profession|most likely (are|is) the (speakers?|man|woman|listeners?)/.test(
      q,
    )
  )
    return 'Danh tính, nơi chốn';
  if (/is suggested about|is implied about/.test(q)) return UNCLASSIFIED;
  if (/^why\b/.test(q)) return 'Chi tiết';
  if (
    /(will|plan to|going to|probably) .*do( next| first)?\?|happen next|do next/.test(
      q,
    )
  )
    return 'Hành động tiếp theo';
  if (
    /suggest|recommend|offer|request|propose|ask(s|ed)? .* to|advise|invite/.test(
      q,
    )
  )
    return 'Đề nghị, yêu cầu';
  if (/problem|concern|worried|issue|complain/.test(q))
    return 'Vấn đề, khó khăn';
  return WH_STEM.test(q) ? 'Chi tiết' : UNCLASSIFIED;
}

function grammar(item: Item) {
  const options = (
    Array.isArray(item.options) ? (item.options as unknown[]) : []
  ).map((o) => String(o).trim().toLowerCase());
  if (!options.length) return UNCLASSIFIED;
  if (options.every((o) => words(o).length >= 5)) return 'Chọn câu phù hợp';
  const single = options.every((o) => words(o).length === 1);
  if (single && options.every((o) => PREPOSITIONS.has(o))) return 'Giới từ';
  if (single && options.every((o) => RELATIVES.has(o))) return 'Đại từ quan hệ';
  if (single && options.every((o) => PRONOUNS.has(o))) return 'Đại từ';
  if (
    options.every((o) =>
      words(o).every((w) => PREPOSITIONS.has(w) || CONNECTORS.has(w)),
    )
  )
    return 'Liên từ, giới từ';
  const heads = options.map(head);
  const verbal = (o: string) =>
    words(o).some((w) => AUXILIARIES.has(w)) || /(ed|ing)$/.test(head(o));
  if (sharedRoot(heads) >= Math.max(2, options.length - 1)) {
    const wordForm = heads.some((h) =>
      /(tion|sion|ment|ness|ity|ly|able|ible|ive|ous|ful|al|ance|ence)$/.test(
        h,
      ),
    );
    return wordForm ? 'Từ loại' : 'Dạng động từ, thì';
  }
  // Auxiliary-only sets (was / are / is / be) and irregular verb families
  // (begin / began / begun) are verb-form items.
  if (
    options.every((o) => words(o).every((w) => AUXILIARIES.has(w))) ||
    (options.some(verbal) && sharedRoot(heads, 3) === options.length)
  )
    return 'Dạng động từ, thì';
  // Different single content words with no shared family: a word-choice item.
  if (
    single &&
    sharedRoot(heads) === 1 &&
    options.every((o) => !PREPOSITIONS.has(o) && !CONNECTORS.has(o))
  )
    return 'Từ vựng';
  return UNCLASSIFIED;
}

function reading(item: Item) {
  const raw = (item.text ?? '').replace(/[’‘]/g, "'");
  const q = raw.toLowerCase();
  if (/closest in meaning/.test(q)) return 'Từ đồng nghĩa';
  if (/positions? marked|best belong/.test(q)) return 'Điền câu vào văn bản';
  if (/mean when .* (writes?|says?)/.test(q)) return 'Hàm ý câu nói';
  if (/\bNOT\b/.test(raw) || /true about|is true/.test(q))
    return 'Thông tin đúng, không đúng';
  if (
    /mainly (about|discuss)|main purpose|purpose of|why (was|is) .* (written|sent)|what is being announced|what is the (article|notice|email|letter|memo) about/.test(
      q,
    )
  )
    return 'Ý chính, mục đích';
  if (
    /likely|probably|suggested|implied|inferred|indicated|can be inferred/.test(
      q,
    )
  )
    return 'Suy luận';
  return WH_STEM.test(q) ? 'Chi tiết' : UNCLASSIFIED;
}

export function toeicQuestionType(item: Item): string {
  switch (item.part) {
    case 1:
      return part1(item);
    case 2:
      return part2(item);
    case 3:
    case 4:
      return talk(item);
    case 5:
    case 6:
      return grammar(item);
    default:
      return reading(item);
  }
}
