/**
 * F23A grammar content: nine new tense topics and five more questions for each
 * published topic, so every topic has ten. Written by hand, original material.
 * `a` is the correct option; the loader shuffles the options.
 */
export type RawQuestion = {
  q: string;
  a: string;
  w: [string, string, string];
  e: string;
  n: [string, string, string];
};

export type RawTopic = {
  title: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  order: number;
  keyFormula: string;
  description: string;
  questions: RawQuestion[];
};

const q = (
  question: string,
  a: string,
  w: [string, string, string],
  e: string,
  n: [string, string, string],
): RawQuestion => ({ q: question, a, w, e, n });

export const NEW_TOPICS: RawTopic[] = [
  {
    title: 'Present Continuous',
    level: 'BEGINNER',
    order: 13,
    keyFormula: 'am/is/are + V-ing; now, at the moment, Look!, Listen!',
    description: 'Việc đang diễn ra lúc nói, việc tạm thời và kế hoạch đã sắp xếp.',
    questions: [
      q('Please be quiet. The baby ______ right now.', 'is sleeping', ['sleeps', 'slept', 'has slept'], '"Right now" cho biết việc đang diễn ra, dùng is + V-ing.', ['Hiện tại đơn dùng cho thói quen, không cho việc đang diễn ra.', 'Quá khứ đơn không hợp với "right now".', 'Hiện tại hoàn thành không hợp với "right now".']),
      q('Look! It ______ outside.', 'is raining', ['rains', 'rained', 'has rained'], '"Look!" báo hiệu việc đang xảy ra trước mắt.', ['Hiện tại đơn nói về sự thật chung, không phải việc đang thấy.', 'Quá khứ đơn nói về việc đã xong.', 'Hiện tại hoàn thành không hợp với lời gọi chú ý "Look!".']),
      q('I ______ for the bus at the moment, so I will call you later.', 'am waiting', ['wait', 'waited', 'have waited'], '"At the moment" đi với thì hiện tại tiếp diễn.', ['Thiếu dạng am + V-ing.', 'Quá khứ đơn không hợp với "at the moment".', 'Hiện tại hoàn thành không hợp với "at the moment".']),
      q('They ______ a new office this month.', 'are building', ['builds', 'built', 'has built'], 'Việc đang tiến hành trong giai đoạn hiện tại, chủ ngữ số nhiều dùng are + V-ing.', ['"Builds" chia cho chủ ngữ số ít.', '"This month" chưa kết thúc nên không dùng quá khứ đơn ở đây.', '"Has" chia cho chủ ngữ số ít.']),
      q('______ you listening to me now?', 'Are', ['Do', 'Did', 'Have'], 'Câu hỏi hiện tại tiếp diễn: Are + chủ ngữ + V-ing.', ['"Do" đi với động từ nguyên mẫu.', '"Did" đi với động từ nguyên mẫu.', '"Have" đi với V3 hoặc been + V-ing.']),
      q('She ______ not working today; she is at home.', 'is', ['does', 'did', 'do'], 'Phủ định hiện tại tiếp diễn: is not + V-ing.', ['"Does not" đi với động từ nguyên mẫu.', '"Did not" đi với động từ nguyên mẫu.', '"Do" không chia cho "she".']),
      q('Which sentence is correct?', 'He knows the answer.', ['He is knowing the answer.', 'He knowing the answer.', 'He are knowing the answer.'], '"Know" là động từ chỉ trạng thái, không dùng dạng tiếp diễn.', ['"Know" không dùng ở dạng V-ing trong nghĩa này.', 'Thiếu trợ động từ và "know" không dùng dạng tiếp diễn.', '"Are" sai với chủ ngữ "he".']),
      q('We ______ dinner with our clients tomorrow evening; the table is booked.', 'are having', ['have had', 'had', 'were having'], 'Kế hoạch đã sắp xếp cho tương lai gần dùng hiện tại tiếp diễn.', ['Hiện tại hoàn thành không dùng với "tomorrow evening".', 'Quá khứ đơn không dùng với "tomorrow evening".', 'Quá khứ tiếp diễn không dùng với "tomorrow evening".']),
      q('The children ______ in the garden at the moment.', 'are playing', ['play', 'played', 'is playing'], 'Chủ ngữ số nhiều và "at the moment": are + V-ing.', ['Hiện tại đơn không hợp với "at the moment".', 'Quá khứ đơn không hợp với "at the moment".', '"Is" chia cho chủ ngữ số ít, "children" là số nhiều.']),
      q('Sales ______ this quarter, so the team is happy.', 'are rising', ['rises', 'rising', 'is rise'], 'Xu hướng đang diễn ra trong giai đoạn hiện tại: are + V-ing.', ['"Rises" chia cho chủ ngữ số ít.', 'Thiếu trợ động từ "are".', 'Sau "is" cần V-ing, và "sales" là số nhiều.']),
    ],
  },
  {
    title: 'Past Continuous',
    level: 'BEGINNER',
    order: 14,
    keyFormula: 'was/were + V-ing; while, when, at 8 p.m. yesterday',
    description: 'Việc đang diễn ra tại một thời điểm trong quá khứ hoặc bị một việc khác xen vào.',
    questions: [
      q('I ______ dinner when the phone rang.', 'was cooking', ['cook', 'am cooking', 'have cooked'], 'Việc đang diễn ra thì việc khác xen vào: was + V-ing và quá khứ đơn.', ['Hiện tại đơn không hợp với mốc quá khứ "rang".', 'Hiện tại tiếp diễn không hợp với mốc quá khứ.', 'Hiện tại hoàn thành không dùng với mệnh đề "when + quá khứ đơn".']),
      q('At 8 p.m. yesterday, they ______ a film.', 'were watching', ['watch', 'are watching', 'have watched'], 'Mốc giờ cụ thể trong quá khứ dùng quá khứ tiếp diễn.', ['Hiện tại đơn không hợp với "yesterday".', 'Hiện tại tiếp diễn không hợp với "yesterday".', 'Hiện tại hoàn thành không dùng với mốc quá khứ xác định.']),
      q('While she ______ to work, she saw an accident.', 'was driving', ['drives', 'is driving', 'has driven'], '"While" đi với việc đang diễn ra trong quá khứ.', ['Hiện tại đơn không hợp với "saw".', 'Hiện tại tiếp diễn không hợp với "saw".', 'Hiện tại hoàn thành không dùng sau "while" trong câu này.']),
      q('What ______ you doing at ten o\'clock last night?', 'were', ['are', 'do', 'did'], 'Câu hỏi quá khứ tiếp diễn: were + chủ ngữ + V-ing.', ['"Are" dùng cho hiện tại, không hợp với "last night".', '"Do" đi với động từ nguyên mẫu.', '"Did" đi với động từ nguyên mẫu.']),
      q('We ______ not listening when the manager explained the rule.', 'were', ['are', 'did', 'do'], 'Phủ định quá khứ tiếp diễn: were not + V-ing.', ['"Are" dùng cho hiện tại.', '"Did not" đi với động từ nguyên mẫu.', '"Do not" đi với động từ nguyên mẫu.']),
      q('It ______ heavily when we left the office.', 'was raining', ['rains', 'is raining', 'has rained'], 'Bối cảnh đang diễn ra lúc một việc quá khứ xảy ra.', ['Hiện tại đơn không hợp với "left".', 'Hiện tại tiếp diễn không hợp với "left".', 'Hiện tại hoàn thành không dùng với mệnh đề "when + quá khứ đơn".']),
      q('He fell asleep while he ______ the report.', 'was reading', ['reads', 'is reading', 'has read'], 'Sau "while" dùng quá khứ tiếp diễn cho việc đang làm.', ['Hiện tại đơn không hợp với "fell".', 'Hiện tại tiếp diễn không hợp với "fell".', 'Hiện tại hoàn thành không hợp với "fell".']),
      q('The printer stopped while I ______ the contract.', 'was printing', ['print', 'am printing', 'have printed'], 'Việc đang làm dở thì bị việc khác xen vào.', ['Hiện tại đơn không hợp với "stopped".', 'Hiện tại tiếp diễn không hợp với "stopped".', 'Hiện tại hoàn thành không hợp với "stopped".']),
      q('______ they waiting for you when you arrived?', 'Were', ['Are', 'Do', 'Did'], 'Câu hỏi quá khứ tiếp diễn với chủ ngữ số nhiều.', ['"Are" dùng cho hiện tại.', '"Do" đi với động từ nguyên mẫu.', '"Did" đi với động từ nguyên mẫu.']),
      q('While the teacher was talking, the students ______ notes.', 'were taking', ['are taking', 'take', 'have taken'], 'Hai việc cùng diễn ra trong quá khứ đều dùng quá khứ tiếp diễn.', ['Hiện tại tiếp diễn không hợp với "was talking".', 'Hiện tại đơn không hợp với "was talking".', 'Hiện tại hoàn thành không hợp với "was talking".']),
    ],
  },
  {
    title: 'Future Simple',
    level: 'BEGINNER',
    order: 15,
    keyFormula: 'will + V; won\'t + V; think, promise, perhaps, tomorrow',
    description: 'Quyết định ngay lúc nói, lời hứa và dự đoán về tương lai.',
    questions: [
      q('Don\'t worry, I ______ you with your homework.', 'will help', ['helped', 'have helped', 'helping'], 'Lời hứa hoặc đề nghị giúp đỡ dùng will + V.', ['Quá khứ đơn không hợp với lời hứa.', 'Hiện tại hoàn thành nói về việc đã xảy ra.', 'V-ing không đứng một mình làm động từ chính.']),
      q('I think it ______ tomorrow.', 'will rain', ['rained', 'raining', 'has rained'], 'Dự đoán sau "I think" dùng will + V.', ['Quá khứ đơn không hợp với "tomorrow".', 'V-ing không đứng một mình làm động từ chính.', 'Hiện tại hoàn thành không hợp với "tomorrow".']),
      q('She ______ not come to the party tomorrow.', 'will', ['did', 'has', 'was'], 'Phủ định tương lai đơn: will not + V.', ['"Did" không hợp với "tomorrow".', '"Has not" cần V3.', '"Was not" cần V-ing hoặc tính từ.']),
      q('______ you call me tonight?', 'Will', ['Did', 'Were', 'Have'], 'Câu hỏi tương lai đơn: Will + chủ ngữ + V.', ['"Did" không hợp với "tonight" sắp tới.', '"Were" cần V-ing.', '"Have" cần V3.']),
      q('The phone is ringing. — I ______ it!', 'will answer', ['answered', 'have answered', 'answering'], 'Quyết định ngay lúc nói dùng will.', ['Quá khứ đơn nói về việc đã xong.', 'Hiện tại hoàn thành nói về việc đã xong.', 'V-ing không đứng một mình làm động từ chính.']),
      q('I promise I ______ late again.', 'won\'t be', ['wasn\'t', 'weren\'t', 'haven\'t been'], 'Lời hứa về tương lai dùng won\'t + V.', ['Quá khứ đơn không hợp với lời hứa.', '"Weren\'t" sai với chủ ngữ "I".', 'Hiện tại hoàn thành không hợp với lời hứa.']),
      q('Perhaps they ______ the project next month.', 'will finish', ['finished', 'have finished', 'finishing'], '"Perhaps" và "next month" chỉ dự đoán tương lai.', ['Quá khứ đơn không hợp với "next month".', 'Hiện tại hoàn thành không hợp với "next month".', 'V-ing không đứng một mình làm động từ chính.']),
      q('If you need a lift, I ______ you.', 'will drive', ['drove', 'have driven', 'driving'], 'Đề nghị giúp đỡ cho tương lai dùng will + V.', ['Quá khứ đơn không hợp với mệnh đề "If you need".', 'Hiện tại hoàn thành không hợp ở đây.', 'V-ing không đứng một mình làm động từ chính.']),
      q('We ______ probably arrive at six tomorrow.', 'will', ['were', 'did', 'had'], '"Probably" và "tomorrow": will + V.', ['"Were" không đi với động từ nguyên mẫu.', '"Did" không hợp với "tomorrow".', '"Had" không đi với động từ nguyên mẫu.']),
      q('He ______ be 30 next year.', 'will', ['was', 'has', 'did'], '"Next year" là tương lai: will be.', ['"Was" là quá khứ và không đi cùng "be".', '"Has" không đi với "be".', '"Did" không hợp với "next year".']),
    ],
  },
  {
    title: 'Present Perfect Continuous',
    level: 'INTERMEDIATE',
    order: 16,
    keyFormula: 'have/has been + V-ing; for, since, how long, all day',
    description: 'Việc bắt đầu trong quá khứ, kéo dài tới hiện tại và nhấn mạnh quá trình.',
    questions: [
      q('I ______ for you for two hours.', 'have been waiting', ['wait', 'am waiting', 'was waiting'], '"For two hours" tới hiện tại: have been + V-ing.', ['Hiện tại đơn không đi với khoảng thời gian tới hiện tại.', 'Hiện tại tiếp diễn không đi với "for two hours".', 'Quá khứ tiếp diễn không nối tới hiện tại.']),
      q('She ______ here since 2020.', 'has been working', ['works', 'is working', 'was working'], '"Since" với mốc bắt đầu trong quá khứ.', ['Hiện tại đơn không đi với "since".', 'Hiện tại tiếp diễn không đi với "since".', 'Quá khứ tiếp diễn không đi với "since 2020" ở đây.']),
      q('How long ______ you been studying English?', 'have', ['do', 'are', 'did'], 'Câu hỏi: How long + have + chủ ngữ + been + V-ing.', ['"Do" không đi với "been".', '"Are" không đi với "been".', '"Did" không đi với "been".']),
      q('He is tired because he ______ all morning.', 'has been running', ['runs', 'is run', 'was run'], 'Việc vừa kéo dài và để lại kết quả ở hiện tại.', ['Hiện tại đơn nói về thói quen, không giải thích sự mệt lúc này.', '"Is run" là bị động.', '"Was run" là bị động.']),
      q('It ______ since this morning, so the roads are wet.', 'has been raining', ['rains', 'rain', 'is rain'], '"Since this morning" và kết quả hiện tại.', ['Hiện tại đơn không đi với "since".', '"Rain" không chia cho "it".', 'Sau "is" không dùng động từ nguyên mẫu.']),
      q('They ______ the report all day and it is still not finished.', 'have been writing', ['write', 'are written', 'was writing'], 'Việc kéo dài và chưa xong: have been + V-ing.', ['Hiện tại đơn không đi với "all day" ở đây.', '"Are written" là bị động.', '"Was" sai với chủ ngữ "they".']),
      q('We ______ been living in Da Nang for three years.', 'have', ['are', 'do', 'were'], 'Trợ động từ của thì này là have/has.', ['"Are" không đi với "been".', '"Do" không đi với "been".', '"Were" không đi với "been".']),
      q('Why are your hands dirty? — I ______ the car.', 'have been repairing', ['repairs', 'am repaired', 'will repair'], 'Việc vừa làm để lại dấu vết ở hiện tại.', ['"Repairs" sai với chủ ngữ "I".', '"Am repaired" là bị động.', 'Tương lai không giải thích được bàn tay đã bẩn.']),
      q('______ she been learning to drive for long?', 'Has', ['Is', 'Does', 'Was'], 'Chủ ngữ "she" dùng "has" trong câu hỏi.', ['"Is" không đi với "been".', '"Does" không đi với "been".', '"Was" không đi với "been".']),
      q('The team ______ on this bug since Monday.', 'has been working', ['works', 'is working', 'worked'], '"Since Monday" tới hiện tại.', ['Hiện tại đơn không đi với "since".', 'Hiện tại tiếp diễn không đi với "since".', 'Quá khứ đơn không đi với "since Monday" khi việc còn tiếp tục.']),
    ],
  },
  {
    title: 'Past Perfect',
    level: 'INTERMEDIATE',
    order: 17,
    keyFormula: 'had + V3; before, after, by the time, already',
    description: 'Việc xảy ra trước một việc khác trong quá khứ.',
    questions: [
      q('When we arrived, the film ______.', 'had already started', ['already starts', 'will already start', 'is already starting'], 'Phim bắt đầu trước lúc đến: had + V3.', ['Hiện tại đơn không hợp với "arrived".', 'Tương lai không hợp với "arrived".', 'Hiện tại tiếp diễn không hợp với "arrived".']),
      q('She was tired because she ______ badly the night before.', 'had slept', ['sleeps', 'will sleep', 'is sleeping'], 'Nguyên nhân xảy ra trước một trạng thái quá khứ.', ['Hiện tại đơn không hợp với "was".', 'Tương lai không hợp với "the night before".', 'Hiện tại tiếp diễn không hợp với "the night before".']),
      q('After he ______ the email, he left the office.', 'had sent', ['sends', 'will send', 'is sending'], 'Việc xong trước "left" dùng had + V3.', ['Hiện tại đơn không hợp với "left".', 'Tương lai không hợp với "left".', 'Hiện tại tiếp diễn không hợp với "left".']),
      q('By the time the manager came, we ______ the meeting.', 'had finished', ['finish', 'are finishing', 'will finish'], '"By the time + quá khứ đơn" đi với quá khứ hoàn thành.', ['Hiện tại đơn không hợp với "came".', 'Hiện tại tiếp diễn không hợp với "came".', 'Tương lai không hợp với "came".']),
      q('I didn\'t recognize him because he ______ so much.', 'had changed', ['changes', 'will change', 'is changing'], 'Sự thay đổi xảy ra trước lúc gặp lại.', ['Hiện tại đơn không hợp với "didn\'t recognize".', 'Tương lai không hợp với "didn\'t recognize".', 'Hiện tại tiếp diễn không hợp với "didn\'t recognize".']),
      q('______ you ever visited Hue before you moved there?', 'Had', ['Do', 'Did', 'Are'], 'Câu hỏi: Had + chủ ngữ + V3.', ['"Do" đi với động từ nguyên mẫu.', '"Did" đi với động từ nguyên mẫu, không đi với "visited".', '"Are" không đi với V3 ở thể chủ động này.']),
      q('They ______ not eaten anything before the trip.', 'had', ['did', 'were', 'are'], 'Phủ định: had not + V3.', ['"Did not" đi với động từ nguyên mẫu.', '"Were not eaten" là bị động, sai nghĩa.', '"Are not eaten" là bị động, sai nghĩa.']),
      q('She told me she ______ the key.', 'had lost', ['loses', 'will lose', 'is losing'], 'Việc mất chìa khoá xảy ra trước lúc kể.', ['Hiện tại đơn không hợp với "told".', 'Tương lai không hợp với ý đã mất.', 'Hiện tại tiếp diễn không hợp với "told".']),
      q('Before she joined us, she ______ for a bank.', 'had worked', ['works', 'is working', 'will work'], 'Việc xảy ra trước "joined".', ['Hiện tại đơn không hợp với "joined".', 'Hiện tại tiếp diễn không hợp với "joined".', 'Tương lai không hợp với "joined".']),
      q('The train ______ when I got to the station.', 'had already left', ['already leaves', 'will already leave', 'is already leaving'], 'Tàu rời đi trước lúc tới ga.', ['Hiện tại đơn không hợp với "got".', 'Tương lai không hợp với "got".', 'Hiện tại tiếp diễn không hợp với "got".']),
    ],
  },
  {
    title: 'Future Continuous',
    level: 'INTERMEDIATE',
    order: 18,
    keyFormula: 'will be + V-ing; at this time tomorrow, this time next week',
    description: 'Việc sẽ đang diễn ra tại một thời điểm trong tương lai.',
    questions: [
      q('At 9 a.m. tomorrow, I ______ on the plane.', 'will be sitting', ['sit', 'sat', 'have sat'], 'Mốc giờ cụ thể trong tương lai: will be + V-ing.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với "tomorrow".', 'Hiện tại hoàn thành không hợp với "tomorrow".']),
      q('This time next week, we ______ on the beach.', 'will be lying', ['lay', 'lie', 'have lain'], '"This time next week" đi với tương lai tiếp diễn.', ['"Lay" là quá khứ của "lie" và không hợp với "next week".', 'Hiện tại đơn không hợp với mốc này.', 'Hiện tại hoàn thành không hợp với "next week".']),
      q('Don\'t call at 8; I ______ dinner then.', 'will be having', ['have', 'had', 'have had'], 'Lúc 8 giờ việc ăn tối sẽ đang diễn ra.', ['Hiện tại đơn không nói được việc đang diễn ra lúc đó.', 'Quá khứ đơn không hợp với lời dặn cho tương lai.', 'Hiện tại hoàn thành không hợp với "then" ở tương lai.']),
      q('______ you be using the meeting room this afternoon?', 'Will', ['Do', 'Did', 'Have'], 'Câu hỏi: Will + chủ ngữ + be + V-ing.', ['"Do" không đi với "be using".', '"Did" không đi với "be using".', '"Have" không đi với "be using".']),
      q('At noon tomorrow, she ______ the clients.', 'will be meeting', ['meets', 'met', 'has met'], 'Việc sẽ đang diễn ra lúc trưa mai.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với "tomorrow".', 'Hiện tại hoàn thành không hợp với "tomorrow".']),
      q('They ______ not be working next Monday because it is a holiday.', 'will', ['did', 'have', 'were'], 'Phủ định: will not be + V-ing.', ['"Did" không đi với "be working".', '"Have" không đi với "be working".', '"Were" không đi với "be working".']),
      q('When you arrive, I ______ at the gate.', 'will be waiting', ['wait', 'waited', 'have waited'], 'Việc sẽ đang diễn ra lúc bạn tới.', ['Hiện tại đơn không nói được việc đang diễn ra lúc đó.', 'Quá khứ đơn không hợp với mệnh đề tương lai.', 'Hiện tại hoàn thành không hợp ở đây.']),
      q('This time tomorrow, the team ______ the new system.', 'will be testing', ['tests', 'tested', 'has tested'], '"This time tomorrow" đi với tương lai tiếp diễn.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với "tomorrow".', 'Hiện tại hoàn thành không hợp với "tomorrow".']),
      q('What ______ you be doing at this time next year?', 'will', ['do', 'did', 'have'], 'Câu hỏi: What + will + chủ ngữ + be + V-ing.', ['"Do" không đi với "be doing".', '"Did" không đi với "be doing".', '"Have" không đi với "be doing".']),
      q('From 2 to 4 p.m. tomorrow, the manager ______ interviews.', 'will be conducting', ['conducts', 'conducted', 'has conducted'], 'Khoảng thời gian cụ thể trong tương lai.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với "tomorrow".', 'Hiện tại hoàn thành không hợp với "tomorrow".']),
    ],
  },
  {
    title: 'Past Perfect Continuous',
    level: 'ADVANCED',
    order: 19,
    keyFormula: 'had been + V-ing; for, since, before, when, how long',
    description: 'Việc kéo dài tới trước một mốc trong quá khứ, nhấn mạnh quá trình.',
    questions: [
      q('She was exhausted because she ______ for twelve hours.', 'had been working', ['works', 'is working', 'has been working'], 'Quá trình kéo dài trước "was exhausted".', ['Hiện tại đơn không hợp với "was".', 'Hiện tại tiếp diễn không hợp với "was".', 'Hiện tại hoàn thành tiếp diễn nối tới hiện tại, không tới mốc quá khứ.']),
      q('They ______ for two hours when the bus finally came.', 'had been waiting', ['wait', 'are waiting', 'have been waiting'], 'Kéo dài tới lúc xe đến trong quá khứ.', ['Hiện tại đơn không hợp với "came".', 'Hiện tại tiếp diễn không hợp với "came".', 'Mốc là quá khứ nên không dùng have been.']),
      q('How long ______ you been living there before you moved?', 'had', ['have', 'do', 'are'], 'Mốc quá khứ "moved" cần had been + V-ing.', ['"Have" nối tới hiện tại.', '"Do" không đi với "been".', '"Are" không đi với "been".']),
      q('His eyes were red because he ______.', 'had been crying', ['cries', 'is crying', 'has been crying'], 'Dấu vết ở quá khứ do quá trình trước đó.', ['Hiện tại đơn không hợp với "were".', 'Hiện tại tiếp diễn không hợp với "were".', 'Mốc là quá khứ nên không dùng has been.']),
      q('We ______ been discussing the budget for an hour when the power went out.', 'had', ['have', 'are', 'do'], 'Trợ động từ "had" với mốc "went out".', ['"Have" nối tới hiện tại.', '"Are" không đi với "been".', '"Do" không đi với "been".']),
      q('The ground was wet because it ______ all night.', 'had been raining', ['rains', 'is raining', 'has been raining'], 'Mưa kéo dài trước trạng thái quá khứ "was wet".', ['Hiện tại đơn không hợp với "was".', 'Hiện tại tiếp diễn không hợp với "was".', 'Mốc là quá khứ nên không dùng has been.']),
      q('She ______ not been sleeping well before the exam.', 'had', ['has', 'is', 'does'], 'Phủ định: had not been + V-ing.', ['"Has" nối tới hiện tại, không hợp với mốc thi đã qua trong câu.', '"Is" không đi với "been".', '"Does" không đi với "been".']),
      q('By 2020, he ______ in the company for ten years.', 'had been working', ['works', 'is working', 'has been working'], '"By 2020" là mốc quá khứ.', ['Hiện tại đơn không hợp với "by 2020".', 'Hiện tại tiếp diễn không hợp với "by 2020".', 'Mốc là quá khứ nên không dùng has been.']),
      q('I ______ the report for three hours before my laptop crashed.', 'had been writing', ['write', 'am writing', 'have been writing'], 'Quá trình trước sự cố "crashed".', ['Hiện tại đơn không hợp với "crashed".', 'Hiện tại tiếp diễn không hợp với "crashed".', 'Mốc là quá khứ nên không dùng have been.']),
      q('______ they been arguing before you came in?', 'Had', ['Have', 'Do', 'Are'], 'Câu hỏi: Had + chủ ngữ + been + V-ing.', ['"Have" không hợp với mốc "came in".', '"Do" không đi với "been".', '"Are" không đi với "been".']),
    ],
  },
  {
    title: 'Future Perfect',
    level: 'ADVANCED',
    order: 20,
    keyFormula: 'will have + V3; by + mốc tương lai, by the time',
    description: 'Việc sẽ hoàn thành trước một mốc trong tương lai.',
    questions: [
      q('By next Friday, I ______ the report.', 'will have finished', ['finish', 'finished', 'am finishing'], '"By next Friday": xong trước mốc tương lai.', ['Hiện tại đơn không hợp với "by next Friday".', 'Quá khứ đơn không hợp với "next Friday".', 'Hiện tại tiếp diễn không nói được ý hoàn thành trước mốc.']),
      q('By 2030, she ______ here for ten years.', 'will have worked', ['works', 'worked', 'is working'], 'Tính tới mốc tương lai 2030.', ['Hiện tại đơn không hợp với "by 2030".', 'Quá khứ đơn không hợp với mốc tương lai.', 'Hiện tại tiếp diễn không hợp với "by 2030".']),
      q('The meeting ______ by the time you arrive.', 'will have ended', ['ends', 'ended', 'is ending'], 'Cuộc họp xong trước lúc bạn tới.', ['Hiện tại đơn không nói được ý xong trước.', 'Quá khứ đơn không hợp với "you arrive".', 'Hiện tại tiếp diễn không nói được ý xong trước.']),
      q('By this time tomorrow, we ______ in Tokyo.', 'will have landed', ['land', 'landed', 'are landing'], 'Việc hạ cánh xong trước mốc ngày mai.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với "tomorrow".', 'Hiện tại tiếp diễn không nói được ý đã xong.']),
      q('______ you have finished the design by Monday?', 'Will', ['Do', 'Did', 'Are'], 'Câu hỏi: Will + chủ ngữ + have + V3.', ['"Do" không đi với "have finished".', '"Did" không đi với "have finished".', '"Are" không đi với "have finished".']),
      q('She ______ not have completed the course by June.', 'will', ['does', 'did', 'is'], 'Phủ định: will not have + V3.', ['"Does" không đi với "have completed".', '"Did" không đi với "have completed".', '"Is" không đi với "have completed".']),
      q('By the end of this year, they ______ 500 units.', 'will have sold', ['sell', 'sold', 'are selling'], '"By the end of this year": tổng kết tới mốc tương lai.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với mốc chưa tới.', 'Hiện tại tiếp diễn không nói được tổng đã đạt.']),
      q('I ______ all my exams by July.', 'will have taken', ['take', 'took', 'am taking'], 'Xong trước tháng Bảy.', ['Hiện tại đơn không hợp với "by July".', 'Quá khứ đơn không hợp với mốc tương lai.', 'Hiện tại tiếp diễn không hợp với "by July".']),
      q('By the time he retires, he ______ over 200 students.', 'will have taught', ['teaches', 'taught', 'is teaching'], 'Tổng kết tới lúc nghỉ hưu trong tương lai.', ['Hiện tại đơn không hợp với "by the time".', 'Quá khứ đơn không hợp với "retires".', 'Hiện tại tiếp diễn không nói được tổng đã đạt.']),
      q('In two hours, the team ______ the update.', 'will have deployed', ['deploys', 'deployed', 'is deploying'], 'Trong vòng hai giờ tới việc sẽ xong.', ['Hiện tại đơn không nói được ý xong trước mốc.', 'Quá khứ đơn không hợp với mốc tương lai.', 'Hiện tại tiếp diễn nói việc đang làm, không phải đã xong.']),
    ],
  },
  {
    title: 'Future Perfect Continuous',
    level: 'ADVANCED',
    order: 21,
    keyFormula: 'will have been + V-ing; by + mốc tương lai + for + khoảng thời gian',
    description: 'Quá trình kéo dài tới một mốc trong tương lai.',
    questions: [
      q('By next month, I ______ here for five years.', 'will have been working', ['work', 'worked', 'am working'], 'Quá trình kéo dài tới mốc tương lai.', ['Hiện tại đơn không hợp với "by next month".', 'Quá khứ đơn không hợp với mốc tương lai.', 'Hiện tại tiếp diễn không đi với "for five years" ở đây.']),
      q('By 6 p.m., she ______ for eight hours.', 'will have been studying', ['studies', 'studied', 'is studying'], '"By 6 p.m." và "for eight hours".', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với mốc sắp tới.', 'Hiện tại tiếp diễn không đi với "for eight hours" ở đây.']),
      q('In July, they ______ in this house for a decade.', 'will have been living', ['live', 'lived', 'are living'], 'Tính tới tháng Bảy sắp tới.', ['Hiện tại đơn không đi với "for a decade" ở đây.', 'Quá khứ đơn không nói được ý kéo dài tới tháng Bảy.', 'Hiện tại tiếp diễn không đi với "for a decade".']),
      q('How long ______ you have been teaching by the end of this year?', 'will', ['do', 'did', 'are'], 'Câu hỏi: How long + will + chủ ngữ + have been + V-ing.', ['"Do" không đi với "have been".', '"Did" không đi với "have been".', '"Are" không đi với "have been".']),
      q('By the time you arrive, we ______ for an hour.', 'will have been waiting', ['wait', 'waited', 'are waiting'], 'Kéo dài tới lúc bạn tới.', ['Hiện tại đơn không đi với "for an hour" ở đây.', 'Quá khứ đơn không hợp với "you arrive".', 'Hiện tại tiếp diễn không đi với "for an hour".']),
      q('Next week, the team ______ on this project for six months.', 'will have been working', ['works', 'worked', 'is working'], 'Tính tới tuần sau.', ['Hiện tại đơn không đi với "for six months".', 'Quá khứ đơn không hợp với "next week".', 'Hiện tại tiếp diễn không đi với "for six months".']),
      q('By 2030, he ______ English for twenty years.', 'will have been teaching', ['teaches', 'taught', 'is teaching'], '"By 2030" và "for twenty years".', ['Hiện tại đơn không hợp với "by 2030".', 'Quá khứ đơn không hợp với mốc tương lai.', 'Hiện tại tiếp diễn không hợp với "by 2030".']),
      q('She ______ not have been driving for long when she reaches the city.', 'will', ['does', 'did', 'is'], 'Phủ định: will not have been + V-ing.', ['"Does" không đi với "have been".', '"Did" không đi với "have been".', '"Is" không đi với "have been".']),
      q('By noon, it ______ for twelve hours without stopping.', 'will have been raining', ['rains', 'rained', 'is raining'], 'Mưa kéo dài tới trưa nay.', ['Hiện tại đơn không hợp với mốc này.', 'Quá khứ đơn không hợp với mốc sắp tới.', 'Hiện tại tiếp diễn không đi với "for twelve hours".']),
      q('At the end of this term, I ______ at this school for three years.', 'will have been studying', ['study', 'studied', 'am studying'], 'Tính tới cuối học kỳ.', ['Hiện tại đơn không đi với "for three years" ở đây.', 'Quá khứ đơn không hợp với mốc chưa tới.', 'Hiện tại tiếp diễn không đi với "for three years".']),
    ],
  },
];

/** Existing topics by title: five more questions each, ten in total. */
export const EXTRA_QUESTIONS: Record<string, RawQuestion[]> = {
  'Present Simple & Adverbs of Frequency': [
    q('She usually ______ to work by bus.', 'goes', ['go', 'going', 'gone'], 'Thói quen với "usually", chủ ngữ số ít thêm -es.', ['"Go" không chia cho "she".', 'V-ing không đứng một mình làm động từ chính.', '"Gone" là V3.']),
    q('______ your brother live in Hanoi?', 'Does', ['Do', 'Is', 'Are'], 'Chủ ngữ số ít: Does + chủ ngữ + V.', ['"Do" đi với chủ ngữ số nhiều.', '"Is" không đi với động từ nguyên mẫu "live".', '"Are" không đi với động từ nguyên mẫu "live".']),
    q('Water ______ at 100 degrees Celsius.', 'boils', ['boil', 'boiling', 'boiled'], 'Sự thật khoa học dùng hiện tại đơn.', ['"Boil" không chia cho danh từ không đếm được "water".', 'V-ing không đứng một mình làm động từ chính.', 'Sự thật chung không dùng quá khứ.']),
    q('They ______ not work on Sundays.', 'do', ['does', 'are', 'is'], 'Phủ định với chủ ngữ số nhiều: do not + V.', ['"Does" đi với chủ ngữ số ít.', '"Are not" không đi với động từ nguyên mẫu.', '"Is" đi với chủ ngữ số ít.']),
    q('How often ______ she check her email?', 'does', ['do', 'is', 'are'], '"How often" hỏi tần suất, chủ ngữ "she" dùng "does".', ['"Do" đi với chủ ngữ số nhiều.', '"Is" không đi với động từ nguyên mẫu "check".', '"Are" không đi với "she".']),
  ],
  'Past Simple & Time Expressions': [
    q('We ______ to Da Lat last summer.', 'went', ['go', 'gone', 'going'], '"Last summer" dùng quá khứ đơn, "go" bất quy tắc thành "went".', ['Hiện tại đơn không hợp với "last summer".', '"Gone" là V3, cần trợ động từ.', 'V-ing không đứng một mình làm động từ chính.']),
    q('______ you see the news last night?', 'Did', ['Do', 'Were', 'Have'], 'Câu hỏi quá khứ đơn: Did + chủ ngữ + V.', ['"Do" không hợp với "last night".', '"Were" không đi với động từ nguyên mẫu "see".', '"Have" không đi với "see" và "last night".']),
    q('She ______ not call me yesterday.', 'did', ['does', 'was', 'has'], 'Phủ định quá khứ đơn: did not + V.', ['"Does" không hợp với "yesterday".', '"Was" không đi với động từ nguyên mẫu "call".', '"Has" không hợp với "yesterday".']),
    q('I ______ my keys two days ago.', 'lost', ['lose', 'losing', 'have lost'], '"Ago" đi với quá khứ đơn.', ['Hiện tại đơn không hợp với "ago".', 'V-ing không đứng một mình làm động từ chính.', 'Hiện tại hoàn thành không dùng với "ago".']),
    q('The meeting ______ at 3 p.m. yesterday.', 'ended', ['ends', 'ending', 'has ended'], 'Mốc quá khứ xác định dùng quá khứ đơn.', ['Hiện tại đơn không hợp với "yesterday".', 'V-ing không đứng một mình làm động từ chính.', 'Hiện tại hoàn thành không dùng với "yesterday".']),
  ],
  'Present Perfect': [
    q('I ______ this film three times.', 'have seen', ['see', 'seeing', 'am seeing'], 'Trải nghiệm tính tới hiện tại, không nêu thời điểm.', ['Hiện tại đơn không đi với "three times" ở đây.', 'V-ing không đứng một mình làm động từ chính.', '"See" với nghĩa này không dùng dạng tiếp diễn.']),
    q('Have you ______ been to Japan?', 'ever', ['ago', 'last', 'yesterday'], '"Ever" dùng trong câu hỏi về trải nghiệm.', ['"Ago" đi với quá khứ đơn.', '"Last" cần danh từ thời gian đi kèm.', '"Yesterday" không dùng với hiện tại hoàn thành.']),
    q('She has lived here ______ ten years.', 'for', ['since', 'ago', 'from'], '"For" đi với khoảng thời gian.', ['"Since" đi với mốc thời gian.', '"Ago" đứng sau khoảng thời gian và đi với quá khứ đơn.', '"From" cần đi cùng mốc bắt đầu.']),
    q('They ______ not finished the report yet.', 'have', ['did', 'were', 'are'], '"Yet" và V3 "finished": have not + V3.', ['"Did not" đi với động từ nguyên mẫu.', '"Were not finished" là bị động, sai nghĩa.', '"Are not finished" không đi với tân ngữ "the report".']),
    q('The price ______ twice this year.', 'has gone up', ['go up', 'going up', 'is go up'], '"This year" chưa kết thúc: has + V3.', ['"Go up" không chia cho "the price".', 'V-ing không đứng một mình làm động từ chính.', 'Sau "is" không dùng động từ nguyên mẫu.']),
  ],
  'Future Forms': [
    q('Look at those clouds! It ______ rain.', 'is going to', ['goes to', 'going', 'went to'], 'Dự đoán dựa trên dấu hiệu trước mắt: be going to.', ['"Goes to" có nghĩa đi tới một nơi.', 'Thiếu "is" và "to".', 'Quá khứ không hợp với dấu hiệu hiện tại.']),
    q('We ______ to Singapore next week; the tickets are booked.', 'are flying', ['flew', 'have flown', 'flying'], 'Kế hoạch đã sắp xếp dùng hiện tại tiếp diễn.', ['Quá khứ đơn không hợp với "next week".', 'Hiện tại hoàn thành không hợp với "next week".', 'Thiếu trợ động từ "are".']),
    q('The train ______ at 7:30 tomorrow morning, according to the timetable.', 'leaves', ['left', 'has left', 'leaving'], 'Lịch trình cố định dùng hiện tại đơn.', ['Quá khứ đơn không hợp với "tomorrow".', 'Hiện tại hoàn thành không hợp với "tomorrow".', 'V-ing không đứng một mình làm động từ chính.']),
    q('I\'ve decided: I ______ study abroad next year.', 'am going to', ['went to', 'have gone to', 'going to'], 'Dự định đã quyết từ trước: be going to.', ['Quá khứ không hợp với "next year".', 'Hiện tại hoàn thành không hợp với "next year".', 'Thiếu "am".']),
    q('I\'ll call you when I ______ home.', 'get', ['will get', 'got', 'getting'], 'Sau "when" nói về tương lai dùng hiện tại đơn.', ['Không dùng "will" trong mệnh đề thời gian này.', 'Quá khứ không hợp với "I\'ll call".', 'V-ing không đứng một mình làm động từ chính.']),
  ],
  'Parts of Speech': [
    q('The manager gave a very ______ speech.', 'effective', ['effect', 'effectively', 'effectiveness'], 'Trước danh từ "speech" cần tính từ.', ['"Effect" là danh từ.', '"Effectively" là trạng từ.', '"Effectiveness" là danh từ.']),
    q('She answered the question ______.', 'correctly', ['correct', 'correction', 'corrects'], 'Bổ nghĩa cho động từ "answered" cần trạng từ.', ['"Correct" là tính từ, không bổ nghĩa cho động từ ở đây.', '"Correction" là danh từ.', '"Corrects" là động từ.']),
    q('We need more ______ about the project.', 'information', ['inform', 'informative', 'informed'], 'Sau "more" và trước "about" cần danh từ.', ['"Inform" là động từ.', '"Informative" là tính từ.', '"Informed" là tính từ hoặc V3.']),
    q('His ______ to the team was impressive.', 'contribution', ['contribute', 'contributive', 'contributed'], 'Sau tính từ sở hữu "his" cần danh từ.', ['"Contribute" là động từ.', '"Contributive" là tính từ.', '"Contributed" là động từ chia quá khứ.']),
    q('The new policy will ______ all employees.', 'benefit', ['beneficial', 'beneficially', 'beneficiary'], 'Sau "will" cần động từ nguyên mẫu.', ['"Beneficial" là tính từ.', '"Beneficially" là trạng từ.', '"Beneficiary" là danh từ.']),
  ],
  'Modals & Polite Requests': [
    q('You ______ smoke here; it is forbidden.', 'mustn\'t', ['don\'t have to', 'needn\'t', 'might'], '"Forbidden" là cấm, dùng mustn\'t.', ['"Don\'t have to" nghĩa là không cần, không phải cấm.', '"Needn\'t" nghĩa là không cần.', '"Might" chỉ khả năng.']),
    q('______ you pass me the salt, please?', 'Could', ['Must', 'Should', 'Might'], 'Lời nhờ lịch sự dùng Could you.', ['"Must you" mang nghĩa trách móc.', '"Should you" không dùng để nhờ.', '"Might you" không dùng để nhờ.']),
    q('It\'s very cold. You ______ wear a coat.', 'should', ['mustn\'t', 'shouldn\'t', 'wouldn\'t'], 'Lời khuyên dùng should.', ['"Mustn\'t" là cấm, trái nghĩa.', '"Shouldn\'t" là khuyên không nên, trái nghĩa.', '"Wouldn\'t" không dùng để khuyên.']),
    q('The lights are off, so she ______ be at home.', 'can\'t', ['must', 'should', 'will'], 'Suy luận phủ định chắc chắn từ dấu hiệu dùng can\'t.', ['"Must be" khẳng định, trái với dấu hiệu.', '"Should be" là kỳ vọng, trái với dấu hiệu.', '"Will be" là dự đoán, trái với dấu hiệu.']),
    q('We ______ work tomorrow; it is a holiday.', 'don\'t have to', ['must', 'have to', 'should'], 'Không bắt buộc dùng don\'t have to.', ['"Must" là bắt buộc, trái ngữ cảnh ngày nghỉ.', '"Have to" là bắt buộc, trái ngữ cảnh ngày nghỉ.', '"Should" là nên, trái ngữ cảnh ngày nghỉ.']),
  ],
  'Passive Voice': [
    q('This report ______ by our team last week.', 'was written', ['wrote', 'is writing', 'writes'], 'Báo cáo được viết: was + V3.', ['Chủ động, nhưng báo cáo không tự viết.', 'Hiện tại tiếp diễn chủ động không hợp với "last week".', 'Hiện tại đơn chủ động không hợp với "last week".']),
    q('English ______ in many countries.', 'is spoken', ['speaks', 'spoke', 'speaking'], 'Tiếng Anh được nói: is + V3.', ['Chủ động, sai nghĩa.', 'Chủ động quá khứ, sai nghĩa.', 'V-ing không đứng một mình làm động từ chính.']),
    q('The contract ______ by the director tomorrow.', 'will be signed', ['will sign', 'signs', 'signed'], 'Hợp đồng được ký: will be + V3.', ['Chủ động, hợp đồng không tự ký.', 'Chủ động hiện tại, sai nghĩa.', 'Quá khứ không hợp với "tomorrow".']),
    q('The package has ______ to your address.', 'been sent', ['sent', 'sending', 'send'], 'Hoàn thành bị động: has been + V3.', ['"Has sent" là chủ động, gói hàng không tự gửi.', 'Sau "has" không dùng V-ing.', 'Sau "has" không dùng động từ nguyên mẫu.']),
    q('The road ______ at the moment.', 'is being repaired', ['repairs', 'repaired', 'is repairing'], 'Bị động tiếp diễn: is being + V3.', ['Chủ động, con đường không tự sửa.', 'Không hợp với "at the moment".', 'Chủ động tiếp diễn, sai nghĩa.']),
  ],
  'Comparatives & Quantifiers': [
    q('This laptop is ______ than that one.', 'lighter', ['light', 'lightest', 'more light'], 'Trước "than" cần so sánh hơn, tính từ ngắn thêm -er.', ['Thiếu dạng so sánh.', '"Lightest" là so sánh nhất.', 'Tính từ ngắn không dùng "more".']),
    q('She is the ______ student in the class.', 'most careful', ['carefuller', 'more careful', 'carefully'], '"The" và "in the class": so sánh nhất của tính từ dài.', ['Tính từ dài không thêm -er.', 'Đây là so sánh hơn, không đi với "the ... in the class".', '"Carefully" là trạng từ.']),
    q('There isn\'t ______ milk in the fridge.', 'much', ['many', 'few', 'a few'], '"Milk" không đếm được, câu phủ định dùng much.', ['"Many" đi với danh từ đếm được.', '"Few" đi với danh từ đếm được.', '"A few" đi với danh từ đếm được.']),
    q('We have ______ customers this year than last year.', 'fewer', ['less', 'little', 'much'], '"Customers" đếm được, so sánh dùng fewer.', ['"Less" đi với danh từ không đếm được.', '"Little" đi với danh từ không đếm được.', '"Much" đi với danh từ không đếm được.']),
    q('The new model is as ______ as the old one.', 'fast', ['faster', 'fastest', 'more fast'], 'So sánh bằng: as + tính từ nguyên dạng + as.', ['Không dùng so sánh hơn trong "as ... as".', 'Không dùng so sánh nhất trong "as ... as".', '"More fast" sai dạng.']),
  ],
  'Conditionals': [
    q('If it rains tomorrow, we ______ at home.', 'will stay', ['stayed', 'would have stayed', 'staying'], 'Điều kiện có thể xảy ra: If + hiện tại đơn, will + V.', ['Quá khứ đơn không hợp với "tomorrow".', 'Dạng này dùng cho điều kiện trái quá khứ.', 'V-ing không đứng một mình làm động từ chính.']),
    q('If I ______ you, I would accept the offer.', 'were', ['am', 'have been', 'will be'], 'Giả định trái hiện tại: If I were you.', ['"Am" không dùng trong giả định này.', 'Hiện tại hoàn thành không hợp với "would accept".', '"Will" không dùng trong mệnh đề if này.']),
    q('If she had left earlier, she ______ the train.', 'would have caught', ['will catch', 'catches', 'caught'], 'Trái quá khứ: If + had V3, would have V3.', ['Dạng tương lai không hợp với "had left".', 'Hiện tại đơn không hợp với "had left".', 'Quá khứ đơn không hợp với mệnh đề kết quả loại này.']),
    q('Unless you hurry, you ______ late.', 'will be', ['were', 'are being', 'have been'], '"Unless" nghĩa là nếu không, kết quả dùng will + V.', ['Quá khứ không hợp với "you hurry".', 'Hiện tại tiếp diễn không dùng cho kết quả tương lai này.', 'Hiện tại hoàn thành không hợp ở đây.']),
    q('If you heat ice, it ______.', 'melts', ['melted', 'would have melted', 'melting'], 'Sự thật chung: If + hiện tại đơn, hiện tại đơn.', ['Quá khứ không hợp với "you heat".', 'Dạng này dùng cho điều kiện trái quá khứ.', 'V-ing không đứng một mình làm động từ chính.']),
  ],
  'Relative Clauses': [
    q('The woman ______ lives next door is a doctor.', 'who', ['which', 'whose', 'where'], 'Thay cho người, làm chủ ngữ của "lives".', ['"Which" dùng cho vật.', '"Whose" cần danh từ theo sau.', '"Where" dùng cho nơi chốn.']),
    q('This is the book ______ I told you about.', 'that', ['who', 'where', 'whose'], 'Thay cho vật "the book".', ['"Who" dùng cho người.', '"Where" dùng cho nơi chốn, câu đã có "about".', '"Whose" cần danh từ theo sau.']),
    q('That is the company ______ my sister works.', 'where', ['who', 'which', 'whose'], 'Nơi chốn, mệnh đề sau đã đủ thành phần.', ['"Who" dùng cho người.', '"Which" cần giới từ "at" hoặc "for" trong mệnh đề.', '"Whose" cần danh từ theo sau.']),
    q('The man ______ car was stolen called the police.', 'whose', ['who', 'which', 'whom'], 'Sở hữu: whose + danh từ.', ['"Who" không đứng trước danh từ để chỉ sở hữu.', '"Which" dùng cho vật.', '"Whom" làm tân ngữ, không chỉ sở hữu.']),
    q('Ho Chi Minh City, ______ is in southern Vietnam, is very busy.', 'which', ['that', 'who', 'where'], 'Mệnh đề có dấu phẩy, thay cho vật, làm chủ ngữ.', ['"That" không dùng sau dấu phẩy.', '"Who" dùng cho người.', '"Where" không làm chủ ngữ của "is".']),
  ],
  'Gerunds & Infinitives': [
    q('She enjoys ______ to music.', 'listening', ['listen', 'to listen', 'listened'], 'Sau "enjoy" dùng V-ing.', ['Không dùng nguyên mẫu sau "enjoy".', 'Không dùng to-V sau "enjoy".', 'Không dùng dạng quá khứ sau "enjoy".']),
    q('I decided ______ a new job.', 'to find', ['finding', 'find', 'found'], 'Sau "decide" dùng to-V.', ['Không dùng V-ing sau "decide".', 'Thiếu "to".', 'Không dùng dạng quá khứ sau "decide".']),
    q('He is good at ______ problems.', 'solving', ['solve', 'to solve', 'solved'], 'Sau giới từ "at" dùng V-ing.', ['Sau giới từ không dùng nguyên mẫu.', 'Sau giới từ không dùng to-V.', 'Sau giới từ không dùng dạng quá khứ.']),
    q('We look forward to ______ you soon.', 'seeing', ['see', 'saw', 'seen'], '"To" ở đây là giới từ nên dùng V-ing.', ['"Look forward to" không đi với nguyên mẫu.', 'Không dùng quá khứ sau giới từ.', 'Không dùng V3 sau giới từ.']),
    q('They agreed ______ the contract.', 'to sign', ['signing', 'sign', 'signed'], 'Sau "agree" dùng to-V.', ['Không dùng V-ing sau "agree".', 'Thiếu "to".', 'Không dùng dạng quá khứ sau "agree".']),
  ],
  'Connectors & Coherence': [
    q('She was tired; ______, she finished the report.', 'however', ['because', 'so that', 'unless'], 'Ý tương phản sau dấu chấm phẩy.', ['"Because" chỉ nguyên nhân.', '"So that" chỉ mục đích.', '"Unless" chỉ điều kiện.']),
    q('______ it was raining, we went out.', 'Although', ['Because of', 'Despite', 'However'], 'Trước mệnh đề, ý tương phản: Although.', ['"Because of" đi với danh từ và chỉ nguyên nhân.', '"Despite" đi với danh từ hoặc V-ing.', '"However" không nối mệnh đề theo cách này.']),
    q('He passed the exam ______ he studied hard.', 'because', ['although', 'however', 'despite'], 'Mệnh đề sau là nguyên nhân.', ['"Although" chỉ tương phản.', '"However" chỉ tương phản và không nối theo cách này.', '"Despite" không đi với mệnh đề.']),
    q('______ the bad weather, the flight left on time.', 'Despite', ['Although', 'Because', 'However'], 'Trước cụm danh từ, ý tương phản: Despite.', ['"Although" cần một mệnh đề.', '"Because" cần mệnh đề và chỉ nguyên nhân.', '"However" không đứng trước cụm danh từ.']),
    q('The product is cheap. ______, it is very reliable.', 'Moreover', ['Although', 'Because', 'Unless'], 'Thêm một ý cùng chiều.', ['"Although" chỉ tương phản và không đứng trước dấu phẩy như vậy.', '"Because" chỉ nguyên nhân.', '"Unless" chỉ điều kiện.']),
  ],
};
