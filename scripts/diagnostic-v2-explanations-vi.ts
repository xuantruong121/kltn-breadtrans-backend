/**
 * Learner-facing Vietnamese explanations for the 25 objective items of the
 * Entry Diagnostic V2 (assessment 5), replacing the English item-writer
 * rationales that the importer copied from answerRationale (owner request,
 * 2026-11-05). Each explanation names the right answer, quotes the line of
 * the audio or passage that decides it, and says why the tempting option is
 * wrong. Questions, options and keys are not touched.
 *
 * Items are found by their stableKey, so the script survives a re-import:
 * run it again after importing the content.
 *
 * Dry run by default; --apply writes, in one transaction, after saving the
 * current explanations to a rollback file.
 *
 * Usage: npx ts-node scripts/diagnostic-v2-explanations-vi.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const ASSESSMENT_ID = 5;

export const EXPLANATIONS_VI: Record<string, { answer: string; text: string }> =
  {
    LST_Q_001: {
      answer: 'Working on their project together',
      text: 'Đáp án: "Working on their project together". Cả hai đều còn việc dang dở của cùng một bài nhóm ("I\'ve still got the slides to finish for our group thing" – "Same. Should we just do it together?") và thống nhất làm chung. Thư viện chỉ là nơi gặp nhau; không ai nhắc chuyện trả sách hay buổi học bị lỡ.',
    },
    LST_Q_002: {
      answer: "Meet at three o'clock",
      text: 'Đáp án: "Meet at three o\'clock". A đề nghị "let\'s aim for three" và B đồng ý bằng "Deal". "After four" là lúc phòng đọc đông nên họ tránh giờ đó; "grab the corner table" là ai đến trước thì giữ chỗ, không phải đặt phòng trước.',
    },
    LST_Q_003: {
      answer: 'The second-floor computer room',
      text: 'Đáp án: "The second-floor computer room". Thông báo nói tầng hai đang đi lại dây điện nên "the computer room up there stays closed until Thursday". Thang máy bị hỏng là phía bắc ("north-side"), còn thang phía nam vẫn dùng được; phòng lab ngôn ngữ mở như bình thường.',
    },
    LST_Q_004: {
      answer: 'At the desk',
      text: 'Đáp án: "At the desk". "Our online booking system is down, so reserve a room at the desk this week instead" – hệ thống đặt phòng online đang hỏng nên tuần này phải đặt tại quầy.',
    },
    LST_Q_005: {
      answer: "This week's release code",
      text: 'Đáp án: "This week\'s release code". "Pick up this week\'s release code from the front desk; your ID card alone won\'t start the machines" – cần lấy mã in của tuần tại quầy. Chỉ có thẻ sinh viên thì không in được, đó là phương án dễ chọn nhầm.',
    },
    LST_Q_006: {
      answer: 'One page came through blank',
      text: 'Đáp án: "One page came through blank". Người gọi nói phần đã điền đều ổn ("Everything you filled in is fine"), nhưng còn cần chữ ký của chủ nhà và "that page came through blank" – trang đó bị trống. Không có chuyện nộp trễ hay phải điền lại từ đầu.',
    },
    LST_Q_007: {
      answer: 'To request one more thing for the form',
      text: 'Đáp án: "To request one more thing for the form". Cuộc gọi nhằm xin bổ sung chữ ký của chủ nhà ("we need your current landlord\'s signature as well") trước thứ Sáu. Người gọi không nhắc tiền, cuộc hẹn hay việc hồ sơ bị từ chối.',
    },
    LST_Q_008: {
      answer: "Meeting it would avoid a month's delay",
      text: 'Đáp án: "Meeting it would avoid a month\'s delay". "If you can get it to us by Friday, we can still process everything this month. Otherwise it rolls into the next cycle" – nộp kịp thứ Sáu thì hồ sơ được xử lý ngay trong tháng này, nếu không phải chờ sang đợt sau. Người gọi không nói hạn này có thể gia hạn.',
    },
    LST_Q_009: {
      answer: 'A technical problem spoiled their plan',
      text: 'Đáp án: "A technical problem spoiled their plan". B không trả lời thẳng mà chỉ nói mọi người vỗ tay, rồi kể máy chiếu không đọc được file ("the projector wouldn\'t read my file"), phải nói theo trí nhớ và cắt bớt một phần. Ghép các chi tiết lại: sự cố kỹ thuật làm hỏng phần đã chuẩn bị. Tràng vỗ tay không chứng minh bài trình bày tốt.',
    },
    LST_Q_010: {
      answer: 'The speaker left out a section',
      text: 'Đáp án: "The speaker left out a section". "Twelve, in the end. I cut the part I was least sure about" – bài còn 12 phút vì người nói tự bỏ phần mình kém chắc chắn nhất, không phải vì bị yêu cầu dừng sớm hay hết giờ.',
    },
    RDG_Q_001: {
      answer: 'To explain where to park bicycles during building work',
      text: 'Đáp án: "To explain where to park bicycles during building work". Thông báo cho biết giá để xe sau tòa C bị dỡ trong lúc lát lại sân, hướng dẫn để xe ở khu có mái cạnh nhà thể thao và nêu các quy định trong 8 tuần đó. Thông báo không nhắc phí gửi xe, việc đăng ký xe hay nạn trộm xe.',
    },
    RDG_Q_002: {
      answer: 'It is taken to the campus store',
      text: 'Đáp án: "It is taken to the campus store". "If they are not moved within three days they will be taken to the campus store" – xe bị gắn thẻ, quá ba ngày không dời thì bị mang về kho. Xe không bị dời ngay và chủ xe không bị phạt tiền.',
    },
    RDG_Q_003: {
      answer: 'On weekday mornings',
      text: 'Đáp án: "On weekday mornings". Người nhận xe phải mang giấy tờ chứng minh quyền sở hữu đến "the facilities desk, which is open on weekday mornings only" – quầy chỉ mở vào buổi sáng các ngày trong tuần. "Ba ngày" là thời hạn trước khi xe bị mang đi, không phải thời gian được nhận lại xe.',
    },
    RDG_Q_004: {
      answer:
        'Rereading feels effective but recalling from memory works better',
      text: 'Đáp án: "Rereading feels effective but recalling from memory works better". Đoạn 1: đọc đi đọc lại tạo cảm giác đã thuộc. Đoạn 2: gấp vở lại và tự nhớ thì khó hơn nhưng nhớ lâu hơn. Đoạn 3: đọc lại không vô ích, chỉ là chưa đủ. Vì vậy "never reread" là quá tuyệt đối.',
    },
    RDG_Q_005: {
      answer: 'They remember more a week later',
      text: 'Đáp án: "They remember more a week later". "Those who persist tend to remember more a week later" – ai kiên trì tự nhớ lại thì một tuần sau nhớ được nhiều hơn. Bài không nói họ đọc nhanh hơn, bớt lo lắng hay học ít thời gian hơn.',
    },
    RDG_Q_006: {
      answer: 'the feeling that familiar material has already been learned',
      text: 'Đáp án: "the feeling that familiar material has already been learned". Câu trước nói "familiarity is easily mistaken for knowledge" – thấy quen dễ bị nhầm là đã biết; câu sau minh họa: đọc đến lần thứ tư thấy trôi chảy nên tưởng đã nắm chắc. "Fluency" ở đây không nói về tốc độ đọc hay nói.',
    },
    RDG_Q_007: {
      answer: 'retrieving information from memory',
      text: 'Đáp án: "retrieving information from memory". Câu đầy đủ là "Retrieval is slower, and it feels worse" – "it" thay cho "retrieval" vừa nhắc ngay trước, tức việc tự nhớ lại kiến thức.',
    },
    RDG_Q_008: {
      answer: 'slower, messier service in return for teaching owners to repair',
      text: 'Đáp án: "slower, messier service in return for teaching owners to repair". Câu ngay trước nói "Teaching the repair is slower and messier, and on a busy morning the line grows long" – dạy chủ đồ tự sửa thì chậm và lộn xộn hơn. "That trade-off" là chấp nhận điều đó để chủ đồ học được cách sửa.',
    },
    RDG_Q_009: {
      answer: 'So that they can handle similar problems without help later',
      text: 'Đáp án: "So that they can handle similar problems without help later". Bài giải thích rằng sửa giúp miễn phí "would also leave the owner no better placed the next time something broke" – lần sau đồ hỏng, chủ vẫn không tự xử lý được. Vì vậy chủ đồ tự làm để lần sau tự sửa được. Bài không nói tình nguyện viên thiếu kỹ năng, và cách này còn chậm hơn.',
    },
    RDG_Q_010: {
      answer: 'It has become useful beyond the cafe itself',
      text: 'Đáp án: "It has become useful beyond the cafe itself". Danh sách các đồ bị dán kín, không mở ra sửa được, nay được chuyển cho một nhóm bảo vệ người tiêu dùng "which draws on it in its own campaigns" – nhóm này dùng nó cho chiến dịch của họ, nên danh sách có ích cả bên ngoài quán. Bài không nói hầu hết đồ gia dụng không sửa được.',
    },
    LU_Q_001: {
      answer: 'am trying',
      text: 'Đáp án: "am trying". "Quiet, please" cho thấy việc đang diễn ra ngay lúc nói, nên dùng thì hiện tại tiếp diễn: "I am trying to hear the instructions."',
    },
    LU_Q_002: {
      answer: 'at',
      text: 'Đáp án: "at". Trước một giờ cụ thể dùng "at": "at half past nine" (lúc 9 giờ 30). "On" dùng cho ngày, "in" dùng cho tháng, năm hoặc buổi trong ngày.',
    },
    LU_Q_003: {
      answer: 'have studied',
      text: 'Đáp án: "have studied". "Since September" cho biết việc bắt đầu từ tháng Chín và vẫn kéo dài đến bây giờ, nên dùng thì hiện tại hoàn thành: "We have studied in this building since September."',
    },
    LU_Q_004: {
      answer: 'do',
      text: 'Đáp án: "do". "Do someone a favor" (giúp ai một việc) là cụm cố định; không dùng "make", "give" hay "take" với "a favor" theo nghĩa này.',
    },
    LU_Q_005: {
      answer: 'contribution',
      text: 'Đáp án: "contribution". Sau "her main" cần một danh từ chỉ sự việc: "her main contribution" (phần đóng góp chính của cô ấy). "Contributor" là người đóng góp, không hợp với vế sau "was the data analysis".',
    },
  };

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    console.log(
      `Target: ${url.hostname}:${url.port}${url.pathname} (${apply ? 'APPLY' : 'dry run'})`,
    );
    const rows = await prisma.diagnosticQuestion.findMany({
      where: { assessmentId: ASSESSMENT_ID, taskType: 'MCQ' },
      select: {
        id: true,
        options: true,
        correctIndex: true,
        explanation: true,
      },
      orderBy: { order: 'asc' },
    });
    const plan: Array<{
      id: number;
      key: string;
      before: string | null;
      after: string;
    }> = [];
    const problems: string[] = [];
    for (const row of rows) {
      const options = row.options as {
        stableKey?: string;
        values?: string[];
      } | null;
      const key = options?.stableKey ?? '';
      const target = EXPLANATIONS_VI[key];
      if (!target) {
        problems.push(`no explanation for ${key || `question ${row.id}`}`);
        continue;
      }
      // The explanation names the keyed option; refuse if the key moved.
      const keyed = options?.values?.[row.correctIndex];
      if (keyed !== target.answer)
        problems.push(
          `${key}: keyed option is "${keyed}", explanation names "${target.answer}"`,
        );
      plan.push({
        id: row.id,
        key,
        before: row.explanation,
        after: target.text,
      });
    }
    const missing = Object.keys(EXPLANATIONS_VI).filter(
      (k) => !plan.some((p) => p.key === k),
    );
    if (missing.length)
      problems.push(
        `not found in assessment ${ASSESSMENT_ID}: ${missing.join(', ')}`,
      );
    console.log(
      `items: ${rows.length}, planned: ${plan.length}, problems: ${problems.length}`,
    );
    for (const p of problems) console.log(`  PROBLEM ${p}`);
    if (problems.length) {
      process.exitCode = 1;
      return;
    }
    const changed = plan.filter((p) => p.before !== p.after);
    console.log(`would change: ${changed.length}`);
    if (!apply) return;

    const rollback = `artifacts/diagnostic-v2-explanations-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(
      rollback,
      JSON.stringify(
        {
          assessmentId: ASSESSMENT_ID,
          target: `${url.hostname}:${url.port}${url.pathname}`,
          rows: plan.map(({ id, key, before }) => ({
            id,
            key,
            explanation: before,
          })),
        },
        null,
        2,
      ),
    );
    await prisma.$transaction(
      changed.map((p) =>
        prisma.diagnosticQuestion.update({
          where: { id: p.id },
          data: { explanation: p.after },
        }),
      ),
    );
    console.log(`applied: ${changed.length}; rollback saved to ${rollback}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
