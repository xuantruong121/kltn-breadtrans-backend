/**
 * Which voice (male or female) each speaker of a listening dialogue takes
 * (owner 2026-11-25: an AI dialogue between "Mark" and "Sarah" failed with
 * "Mỗi người nói trong hội thoại phải được ánh xạ sang một giọng đọc khác
 * nhau". Mark was known male; Sarah was not in any list, so the positional
 * tie-breaker gave the second speaker the male voice too.)
 *
 * The voices are chosen for the whole dialogue at once:
 * - an explicit voiceKey ("female-01", "en-us-male-01") wins;
 * - a speaker whose name or role is known keeps that gender;
 * - an unknown speaker takes the gender fewer speakers have so far (a tie
 *   keeps the old rule: first slot female, second male);
 * - if every speaker still ends up on one gender, later speakers without an
 *   explicit voiceKey switch to the other one: the registry has one voice per
 *   gender and accent, and two speakers must never share a voice.
 *
 * Pure: no I/O.
 */
export type VoiceGender = 'male' | 'female';

const MALE =
  /male|man|agent|manager|guy|ethan|leo|ben|dan|customer-2|nhân viên|nhan vien|hỗ trợ|ho tro|support|assistant|staff|mark/;
const FEMALE =
  /female|woman|lady|maya|nora|mia|linh|jenny|khách hàng|khach hang|customer-1|customer|caller|client|buyer|guest/;
// Common first names, matched as whole words: AI drafts invent them freely.
const MALE_NAMES = new Set(
  'john david james tom michael mike peter paul robert daniel chris kevin brian jason ryan adam jack harry george william henry alex sam oliver lucas noah nam minh tuan hung duc khoa'.split(
    ' ',
  ),
);
const FEMALE_NAMES = new Set(
  'sarah emma anna lisa kate sophie olivia emily lucy hannah amy rachel laura jessica grace chloe julia alice helen mary jane susan linda karen lily zoe ella ava mai lan hoa thu ngoc'.split(
    ' ',
  ),
);

/** Gender from a speaker's name or role, or null when it says nothing. */
export function speakerGender(speakerId: string): VoiceGender | null {
  const name = speakerId.toLowerCase();
  const words = name.split(/[^a-zà-ỹđ]+/i).filter(Boolean);
  const male = MALE.test(name) || words.some((word) => MALE_NAMES.has(word));
  const female =
    FEMALE.test(name) || words.some((word) => FEMALE_NAMES.has(word));
  if (male && !female) return 'male';
  if (female && !male) return 'female';
  return null;
}

/** Gender asked for by an explicit voiceKey, or null for none. */
export function requestedGender(voiceKey?: string): VoiceGender | null {
  if (!voiceKey) return null;
  const key = voiceKey.toLowerCase();
  if (key.includes('female')) return 'female';
  if (key.includes('male')) return 'male';
  return null;
}

/** One gender per speaker, in order of first appearance. */
export function assignDialogueGenders(
  speakers: Array<{ id: string; voiceKey?: string }>,
): Map<string, VoiceGender> {
  const result = new Map<string, VoiceGender>();
  const fixed = new Set<string>();
  const count = { male: 0, female: 0 };
  for (const { id, voiceKey } of speakers) {
    const gender = requestedGender(voiceKey) ?? speakerGender(id);
    if (!gender) continue;
    result.set(id, gender);
    if (requestedGender(voiceKey)) fixed.add(id);
    count[gender]++;
  }
  speakers.forEach(({ id }, slot) => {
    if (result.has(id)) return;
    const gender: VoiceGender =
      count.female < count.male
        ? 'female'
        : count.male < count.female
          ? 'male'
          : slot % 2 === 1
            ? 'male'
            : 'female';
    result.set(id, gender);
    count[gender]++;
  });
  if (speakers.length > 1 && new Set(result.values()).size === 1) {
    const only = result.get(speakers[0].id) as VoiceGender;
    const other: VoiceGender = only === 'male' ? 'female' : 'male';
    speakers.forEach(({ id }, slot) => {
      if (slot > 0 && !fixed.has(id)) result.set(id, other);
    });
  }
  return result;
}
