/**
 * Text a learner or an admin reads (notifications, error messages, AI
 * prompts that shape what the AI writes) uses one name for each thing, as
 * the frontend glossary does (frontend src/lib/ui/glossary.ts, owner
 * 2026-11-12), and no emoji. Only string literals are read; log lines and
 * code names such as `streakCount` or the plan code 'PLUS' are not text.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

const RULES: Array<{ name: string; wrong: RegExp; right: string }> = [
  {
    name: 'emoji',
    wrong: /(?![©®™])\p{Extended_Pictographic}|[✓✕✔✗]/u,
    right: 'no emoji',
  },
  {
    name: 'streak',
    // In Vietnamese text only, and not a property such as `input.streak`.
    wrong: /^(?=.*[À-ỹ])(?=.*(?<![.\w])[Ss]treak\b)/,
    right: 'chuỗi',
  },
  {
    name: 'plan names',
    wrong: /\b[gG]ói (FREE|PLUS|PRO)\b|BreadTrans (FREE|PLUS|PRO)\b/,
    right: 'gói Free / Plus / Pro',
  },
  {
    name: 'assistant',
    wrong: /Trợ Lý Bánh Mì|[tT]rợ lý học tập|Gia [sS]ư|Bánh Mì Gia Sư/,
    right: 'Trợ lý Bánh Mì',
  },
  { name: 'dictation', wrong: /[Cc]hép chính tả/, right: 'nghe chép' },
  { name: 'level', wrong: /\bLv\.\s?\d|\bLv\.\s?\$\{/, right: 'Cấp N' },
  {
    name: 'shield',
    wrong: /thẻ giữ chuỗi|Streak Freeze/,
    right: 'khiên giữ chuỗi',
  },
  { name: 'currency', wrong: /\bBánh mì\b/, right: 'Bánh Mì' },
  {
    name: 'transcript',
    // In Vietnamese text only; `transcript` as a field or a route is code.
    wrong: /^(?=.*[À-ỹ])(?=.*(?<![./\w-])[Tt]ranscript\b)|kịch bản/,
    right: 'lời thoại (bài nghe) / lời nói (bài nói)',
  },
  { name: 'paid content', wrong: /\bPremium\b/, right: 'gói Plus / gói Pro' },
  {
    name: 'Title Case term',
    wrong:
      /Đấu Trường|Cửa Hàng|Thú Cưng|Huy Hiệu|Nhiệm Vụ|Bảng Xếp Hạng|Sổ Lỗi|Thông Báo|Ngữ Pháp|Luyện Đề|Giữ Chuỗi|Nghe Chép|Trợ Lý/,
    right: 'sentence case: Đấu trường, Cửa hàng, Thú cưng...',
  },
  { name: 'English unit', wrong: /\b24h\b|\bBoost\b/, right: '24 giờ' },
];

/** Real exceptions, with the reason. */
const ALLOW: Array<{ file: string; rule: string; why: string }> = [
  {
    file: 'modules/gamification/gamification.controller.ts',
    rule: 'streak',
    why: 'Swagger text listing API field names (`streak` is a field)',
  },
  {
    file: 'modules/market/market.service.ts',
    rule: 'Title Case term',
    why: 'matches shop product names stored in the database, not shown text',
  },
];

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const LOG_LINE =
  /\b(logger|this\.logger|console)\.(log|warn|error|debug|verbose)\(|new Logger\(/;

describe('learner and admin text follows the glossary', () => {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(LITERAL)) {
      const line = text.slice(0, m.index).split('\n').length;
      const lineText = text.split('\n')[line - 1] ?? '';
      if (LOG_LINE.test(lineText)) continue;
      const value = m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ' ');
      for (const rule of RULES)
        if (
          rule.wrong.test(value) &&
          !ALLOW.some((a) => a.file === rel && a.rule === rule.name)
        )
          found.push(
            `${rel}:${line} [${rule.name} -> ${rule.right}] ${value.slice(0, 80)}`,
          );
    }
  }

  it('has no wording or emoji outside the glossary', () => {
    expect(found).toEqual([]);
  });
});
