/**
 * F23A flashcard content: twelve new decks of twelve words. Written by hand,
 * original examples. `level` is a content tag for filtering, not a learner
 * result.
 */
export type RawWord = {
  word: string;
  pos: string;
  ipaUs: string;
  ipaUk: string;
  meaningVi: string;
  exampleEn: string;
  exampleVi: string;
  collocation: { phrase: string; meaningVi: string };
};

export type RawDeck = {
  title: string;
  description: string;
  level: string;
  categoryName: string;
  words: RawWord[];
};

const w = (
  word: string,
  pos: string,
  ipaUs: string,
  ipaUk: string,
  meaningVi: string,
  exampleEn: string,
  exampleVi: string,
  phrase: string,
  phraseVi: string,
): RawWord => ({
  word,
  pos,
  ipaUs,
  ipaUk,
  meaningVi,
  exampleEn,
  exampleVi,
  collocation: { phrase, meaningVi: phraseVi },
});

const DAILY = 'Tiếng Anh hằng ngày';
const REAL = 'Giao tiếp thực tế';
const WORK = 'Tiếng Anh công việc';
const TECH = 'Tiếng Anh công nghệ';
const ACADEMIC = 'Tiếng Anh học thuật';

export const LEVELS_FOR_EXISTING: Array<{ id: number; title: string; level: string }> = [
  { id: 1, title: 'Daily Routines & Time', level: 'A1' },
  { id: 2, title: 'Travel & Transportation', level: 'A2' },
  { id: 3, title: 'Office & Meetings', level: 'B1' },
  { id: 4, title: 'Customer Service & Retail', level: 'B1' },
  { id: 5, title: 'Finance & Business', level: 'B2' },
  { id: 6, title: 'Technology & Projects', level: 'B1' },
  { id: 7, title: 'Marketing & Sales', level: 'B1' },
  { id: 8, title: 'Health, Learning & Well-being', level: 'A2' },
];

export const NEW_DECKS: RawDeck[] = [
  {
    title: 'Family & People',
    description: 'Từ cơ bản để nói về gia đình và những người xung quanh.',
    level: 'A1',
    categoryName: DAILY,
    words: [
      w('father', 'noun', '/ˈfɑː.ðɚ/', '/ˈfɑː.ðə/', 'bố, cha', 'My father works in a bank.', 'Bố tôi làm việc ở ngân hàng.', 'my father', 'bố tôi'),
      w('mother', 'noun', '/ˈmʌð.ɚ/', '/ˈmʌð.ə/', 'mẹ', 'My mother cooks very well.', 'Mẹ tôi nấu ăn rất ngon.', 'my mother', 'mẹ tôi'),
      w('brother', 'noun', '/ˈbrʌð.ɚ/', '/ˈbrʌð.ə/', 'anh trai, em trai', 'I have one older brother.', 'Tôi có một anh trai.', 'older brother', 'anh trai'),
      w('sister', 'noun', '/ˈsɪs.tɚ/', '/ˈsɪs.tə/', 'chị gái, em gái', 'My sister is a nurse.', 'Chị tôi là y tá.', 'younger sister', 'em gái'),
      w('husband', 'noun', '/ˈhʌz.bənd/', '/ˈhʌz.bənd/', 'chồng', 'Her husband is a teacher.', 'Chồng cô ấy là giáo viên.', 'her husband', 'chồng của cô ấy'),
      w('wife', 'noun', '/waɪf/', '/waɪf/', 'vợ', 'His wife works from home.', 'Vợ anh ấy làm việc ở nhà.', 'his wife', 'vợ của anh ấy'),
      w('son', 'noun', '/sʌn/', '/sʌn/', 'con trai', 'Their son is five years old.', 'Con trai họ năm tuổi.', 'only son', 'con trai duy nhất'),
      w('daughter', 'noun', '/ˈdɑː.t̬ɚ/', '/ˈdɔː.tə/', 'con gái', 'Our daughter likes drawing.', 'Con gái chúng tôi thích vẽ.', 'little daughter', 'cô con gái nhỏ'),
      w('friend', 'noun', '/frend/', '/frend/', 'bạn bè', 'She is my best friend.', 'Cô ấy là bạn thân nhất của tôi.', 'best friend', 'bạn thân nhất'),
      w('neighbor', 'noun', '/ˈneɪ.bɚ/', '/ˈneɪ.bə/', 'hàng xóm', 'Our neighbor is very kind.', 'Hàng xóm của chúng tôi rất tốt bụng.', 'next-door neighbor', 'người hàng xóm sát vách'),
      w('baby', 'noun', '/ˈbeɪ.bi/', '/ˈbeɪ.bi/', 'em bé', 'The baby is sleeping now.', 'Em bé đang ngủ.', 'newborn baby', 'em bé sơ sinh'),
      w('parent', 'noun', '/ˈper.ənt/', '/ˈpeə.rənt/', 'bố hoặc mẹ', 'My parents live in Hue.', 'Bố mẹ tôi sống ở Huế.', 'single parent', 'người nuôi con một mình'),
    ],
  },
  {
    title: 'Food & Drink',
    description: 'Tên món ăn và đồ uống thường gặp mỗi ngày.',
    level: 'A1',
    categoryName: DAILY,
    words: [
      w('rice', 'noun', '/raɪs/', '/raɪs/', 'cơm, gạo', 'We eat rice every day.', 'Chúng tôi ăn cơm mỗi ngày.', 'fried rice', 'cơm rang'),
      w('bread', 'noun', '/bred/', '/bred/', 'bánh mì', 'I buy fresh bread in the morning.', 'Tôi mua bánh mì mới vào buổi sáng.', 'fresh bread', 'bánh mì mới'),
      w('chicken', 'noun', '/ˈtʃɪk.ɪn/', '/ˈtʃɪk.ɪn/', 'thịt gà, con gà', 'The chicken soup is hot.', 'Món súp gà còn nóng.', 'grilled chicken', 'gà nướng'),
      w('egg', 'noun', '/eɡ/', '/eɡ/', 'trứng', 'She has an egg for breakfast.', 'Cô ấy ăn một quả trứng vào bữa sáng.', 'boiled egg', 'trứng luộc'),
      w('vegetable', 'noun', '/ˈvedʒ.tə.bəl/', '/ˈvedʒ.tə.bəl/', 'rau củ', 'Please eat more vegetables.', 'Hãy ăn nhiều rau hơn.', 'green vegetables', 'rau xanh'),
      w('fruit', 'noun', '/fruːt/', '/fruːt/', 'trái cây', 'I eat fruit after lunch.', 'Tôi ăn trái cây sau bữa trưa.', 'fresh fruit', 'trái cây tươi'),
      w('water', 'noun', '/ˈwɑː.t̬ɚ/', '/ˈwɔː.tə/', 'nước', 'Can I have a glass of water?', 'Cho tôi xin một cốc nước được không?', 'a glass of water', 'một cốc nước'),
      w('coffee', 'noun', '/ˈkɑː.fi/', '/ˈkɒf.i/', 'cà phê', 'He drinks coffee every morning.', 'Anh ấy uống cà phê mỗi sáng.', 'black coffee', 'cà phê đen'),
      w('tea', 'noun', '/tiː/', '/tiː/', 'trà', 'Would you like some green tea?', 'Bạn có muốn uống trà xanh không?', 'green tea', 'trà xanh'),
      w('soup', 'noun', '/suːp/', '/suːp/', 'súp, canh', 'This soup needs more salt.', 'Món súp này cần thêm muối.', 'hot soup', 'súp nóng'),
      w('salt', 'noun', '/sɑːlt/', '/sɔːlt/', 'muối', 'Please pass the salt.', 'Làm ơn đưa giúp lọ muối.', 'a pinch of salt', 'một nhúm muối'),
      w('sugar', 'noun', '/ˈʃʊɡ.ɚ/', '/ˈʃʊɡ.ə/', 'đường', 'I don\'t put sugar in my tea.', 'Tôi không cho đường vào trà.', 'a spoonful of sugar', 'một thìa đường'),
    ],
  },
  {
    title: 'Home & Household',
    description: 'Phòng và đồ vật quen thuộc trong nhà.',
    level: 'A2',
    categoryName: DAILY,
    words: [
      w('kitchen', 'noun', '/ˈkɪtʃ.ən/', '/ˈkɪtʃ.ɪn/', 'nhà bếp', 'We have dinner in the kitchen.', 'Chúng tôi ăn tối trong bếp.', 'kitchen table', 'bàn bếp'),
      w('bedroom', 'noun', '/ˈbed.ruːm/', '/ˈbed.ruːm/', 'phòng ngủ', 'My bedroom is on the second floor.', 'Phòng ngủ của tôi ở tầng hai.', 'master bedroom', 'phòng ngủ chính'),
      w('bathroom', 'noun', '/ˈbæθ.ruːm/', '/ˈbɑːθ.ruːm/', 'phòng tắm', 'The bathroom is next to the kitchen.', 'Phòng tắm ở cạnh nhà bếp.', 'clean the bathroom', 'dọn phòng tắm'),
      w('sofa', 'noun', '/ˈsoʊ.fə/', '/ˈsəʊ.fə/', 'ghế sô-pha', 'The cat is sleeping on the sofa.', 'Con mèo đang ngủ trên ghế sô-pha.', 'comfortable sofa', 'ghế sô-pha êm'),
      w('table', 'noun', '/ˈteɪ.bəl/', '/ˈteɪ.bəl/', 'cái bàn', 'Put the plates on the table.', 'Đặt đĩa lên bàn.', 'dining table', 'bàn ăn'),
      w('chair', 'noun', '/tʃer/', '/tʃeə/', 'cái ghế', 'This chair is very comfortable.', 'Chiếc ghế này rất thoải mái.', 'office chair', 'ghế văn phòng'),
      w('window', 'noun', '/ˈwɪn.doʊ/', '/ˈwɪn.dəʊ/', 'cửa sổ', 'Please open the window.', 'Làm ơn mở cửa sổ.', 'open the window', 'mở cửa sổ'),
      w('door', 'noun', '/dɔːr/', '/dɔː/', 'cửa ra vào', 'Someone is at the door.', 'Có người ở ngoài cửa.', 'front door', 'cửa trước'),
      w('mirror', 'noun', '/ˈmɪr.ɚ/', '/ˈmɪr.ə/', 'gương', 'She looked in the mirror.', 'Cô ấy nhìn vào gương.', 'bathroom mirror', 'gương phòng tắm'),
      w('towel', 'noun', '/ˈtaʊ.əl/', '/ˈtaʊ.əl/', 'khăn tắm', 'I need a clean towel.', 'Tôi cần một chiếc khăn sạch.', 'clean towel', 'khăn sạch'),
      w('blanket', 'noun', '/ˈblæŋ.kɪt/', '/ˈblæŋ.kɪt/', 'chăn', 'It is cold, so I need a blanket.', 'Trời lạnh nên tôi cần một cái chăn.', 'warm blanket', 'chăn ấm'),
      w('refrigerator', 'noun', '/rɪˈfrɪdʒ.ə.reɪ.t̬ɚ/', '/rɪˈfrɪdʒ.ər.eɪ.tə/', 'tủ lạnh', 'Keep the milk in the refrigerator.', 'Hãy để sữa trong tủ lạnh.', 'in the refrigerator', 'trong tủ lạnh'),
    ],
  },
  {
    title: 'Shopping & Money',
    description: 'Từ cần dùng khi mua sắm và trả tiền.',
    level: 'A2',
    categoryName: REAL,
    words: [
      w('price', 'noun', '/praɪs/', '/praɪs/', 'giá tiền', 'The price of this bag is too high.', 'Giá chiếc túi này quá cao.', 'full price', 'giá gốc'),
      w('cheap', 'adjective', '/tʃiːp/', '/tʃiːp/', 'rẻ', 'These shoes are cheap but good.', 'Đôi giày này rẻ mà tốt.', 'cheap ticket', 'vé rẻ'),
      w('expensive', 'adjective', '/ɪkˈspen.sɪv/', '/ɪkˈspen.sɪv/', 'đắt', 'This restaurant is very expensive.', 'Nhà hàng này rất đắt.', 'too expensive', 'quá đắt'),
      w('cash', 'noun', '/kæʃ/', '/kæʃ/', 'tiền mặt', 'Do you pay by card or in cash?', 'Bạn trả bằng thẻ hay tiền mặt?', 'pay in cash', 'trả bằng tiền mặt'),
      w('receipt', 'noun', '/rɪˈsiːt/', '/rɪˈsiːt/', 'biên lai, hoá đơn', 'Please keep your receipt.', 'Vui lòng giữ biên lai.', 'keep the receipt', 'giữ biên lai'),
      w('change', 'noun', '/tʃeɪndʒ/', '/tʃeɪndʒ/', 'tiền thừa', 'Here is your change.', 'Đây là tiền thừa của bạn.', 'keep the change', 'không cần trả lại tiền thừa'),
      w('wallet', 'noun', '/ˈwɑː.lɪt/', '/ˈwɒl.ɪt/', 'ví tiền', 'I left my wallet at home.', 'Tôi để quên ví ở nhà.', 'lose a wallet', 'mất ví'),
      w('sale', 'noun', '/seɪl/', '/seɪl/', 'đợt giảm giá', 'The shop has a big sale this week.', 'Cửa hàng có đợt giảm giá lớn tuần này.', 'on sale', 'đang giảm giá'),
      w('size', 'noun', '/saɪz/', '/saɪz/', 'kích cỡ', 'Do you have this shirt in a larger size?', 'Bạn có áo này cỡ lớn hơn không?', 'a larger size', 'cỡ lớn hơn'),
      w('market', 'noun', '/ˈmɑːr.kɪt/', '/ˈmɑː.kɪt/', 'chợ', 'My mother goes to the market every morning.', 'Mẹ tôi đi chợ mỗi sáng.', 'local market', 'chợ địa phương'),
      w('pay', 'verb', '/peɪ/', '/peɪ/', 'trả tiền', 'I will pay for lunch today.', 'Hôm nay tôi sẽ trả tiền bữa trưa.', 'pay the bill', 'thanh toán hoá đơn'),
      w('buy', 'verb', '/baɪ/', '/baɪ/', 'mua', 'I want to buy a new phone.', 'Tôi muốn mua điện thoại mới.', 'buy online', 'mua trực tuyến'),
    ],
  },
  {
    title: 'Weather & Nature',
    description: 'Từ nói về thời tiết và thiên nhiên.',
    level: 'A2',
    categoryName: REAL,
    words: [
      w('rain', 'noun', '/reɪn/', '/reɪn/', 'mưa', 'We stayed at home because of the rain.', 'Chúng tôi ở nhà vì trời mưa.', 'heavy rain', 'mưa to'),
      w('sunny', 'adjective', '/ˈsʌn.i/', '/ˈsʌn.i/', 'có nắng', 'It is a sunny day today.', 'Hôm nay trời nắng.', 'sunny day', 'ngày nắng'),
      w('windy', 'adjective', '/ˈwɪn.di/', '/ˈwɪn.di/', 'có gió', 'It is very windy at the beach.', 'Ở bãi biển gió rất to.', 'windy day', 'ngày nhiều gió'),
      w('cloud', 'noun', '/klaʊd/', '/klaʊd/', 'đám mây', 'There are dark clouds in the sky.', 'Trên trời có nhiều mây đen.', 'dark cloud', 'mây đen'),
      w('storm', 'noun', '/stɔːrm/', '/stɔːm/', 'cơn bão', 'The storm closed the airport.', 'Cơn bão khiến sân bay phải đóng cửa.', 'tropical storm', 'bão nhiệt đới'),
      w('snow', 'noun', '/snoʊ/', '/snəʊ/', 'tuyết', 'Children love playing in the snow.', 'Trẻ em thích chơi trong tuyết.', 'heavy snow', 'tuyết dày'),
      w('temperature', 'noun', '/ˈtem.pɚ.ə.tʃɚ/', '/ˈtem.prə.tʃə/', 'nhiệt độ', 'The temperature is 35 degrees today.', 'Hôm nay nhiệt độ là 35 độ.', 'high temperature', 'nhiệt độ cao'),
      w('season', 'noun', '/ˈsiː.zən/', '/ˈsiː.zən/', 'mùa', 'Summer is my favorite season.', 'Mùa hè là mùa tôi thích nhất.', 'rainy season', 'mùa mưa'),
      w('river', 'noun', '/ˈrɪv.ɚ/', '/ˈrɪv.ə/', 'dòng sông', 'The Red River flows through Hanoi.', 'Sông Hồng chảy qua Hà Nội.', 'along the river', 'dọc theo con sông'),
      w('mountain', 'noun', '/ˈmaʊn.tən/', '/ˈmaʊn.tɪn/', 'ngọn núi', 'We climbed a mountain last summer.', 'Mùa hè trước chúng tôi đã leo núi.', 'climb a mountain', 'leo núi'),
      w('forest', 'noun', '/ˈfɔːr.ɪst/', '/ˈfɒr.ɪst/', 'khu rừng', 'Many animals live in the forest.', 'Nhiều loài vật sống trong rừng.', 'tropical forest', 'rừng nhiệt đới'),
      w('sea', 'noun', '/siː/', '/siː/', 'biển', 'The hotel is near the sea.', 'Khách sạn ở gần biển.', 'by the sea', 'cạnh biển'),
    ],
  },
  {
    title: 'Jobs & Careers',
    description: 'Từ dùng khi tìm việc, phỏng vấn và phát triển nghề nghiệp.',
    level: 'B1',
    categoryName: WORK,
    words: [
      w('resume', 'noun', '/ˈrez.ə.meɪ/', '/ˈrez.juː.meɪ/', 'hồ sơ xin việc', 'Please send your resume by email.', 'Vui lòng gửi hồ sơ xin việc qua email.', 'update a resume', 'cập nhật hồ sơ xin việc'),
      w('interview', 'noun', '/ˈɪn.t̬ɚ.vjuː/', '/ˈɪn.tə.vjuː/', 'buổi phỏng vấn', 'She has a job interview tomorrow.', 'Ngày mai cô ấy có buổi phỏng vấn xin việc.', 'job interview', 'phỏng vấn xin việc'),
      w('salary', 'noun', '/ˈsæl.ɚ.i/', '/ˈsæl.ər.i/', 'tiền lương', 'The salary is paid every month.', 'Lương được trả hằng tháng.', 'monthly salary', 'lương tháng'),
      w('experience', 'noun', '/ɪkˈspɪr.i.əns/', '/ɪkˈspɪə.ri.əns/', 'kinh nghiệm', 'He has five years of sales experience.', 'Anh ấy có năm năm kinh nghiệm bán hàng.', 'work experience', 'kinh nghiệm làm việc'),
      w('skill', 'noun', '/skɪl/', '/skɪl/', 'kỹ năng', 'Communication is a useful skill.', 'Giao tiếp là một kỹ năng hữu ích.', 'communication skill', 'kỹ năng giao tiếp'),
      w('applicant', 'noun', '/ˈæp.lɪ.kənt/', '/ˈæp.lɪ.kənt/', 'ứng viên', 'We received fifty applicants for this job.', 'Chúng tôi nhận được năm mươi ứng viên cho công việc này.', 'job applicant', 'người xin việc'),
      w('promotion', 'noun', '/prəˈmoʊ.ʃən/', '/prəˈməʊ.ʃən/', 'sự thăng chức', 'She got a promotion after two years.', 'Cô ấy được thăng chức sau hai năm.', 'get a promotion', 'được thăng chức'),
      w('career', 'noun', '/kəˈrɪr/', '/kəˈrɪə/', 'sự nghiệp', 'He wants a career in design.', 'Anh ấy muốn theo sự nghiệp thiết kế.', 'career path', 'con đường sự nghiệp'),
      w('qualification', 'noun', '/ˌkwɑː.lə.fəˈkeɪ.ʃən/', '/ˌkwɒl.ɪ.fɪˈkeɪ.ʃən/', 'bằng cấp, trình độ chuyên môn', 'This job needs a teaching qualification.', 'Công việc này cần bằng cấp sư phạm.', 'professional qualification', 'bằng cấp chuyên môn'),
      w('vacancy', 'noun', '/ˈveɪ.kən.si/', '/ˈveɪ.kən.si/', 'vị trí tuyển dụng', 'There is a vacancy in our sales team.', 'Nhóm bán hàng của chúng tôi có một vị trí trống.', 'job vacancy', 'vị trí đang tuyển'),
      w('internship', 'noun', '/ˈɪn.tɝːn.ʃɪp/', '/ˈɪn.tɜːn.ʃɪp/', 'kỳ thực tập', 'I did a three-month internship last year.', 'Năm ngoái tôi thực tập ba tháng.', 'summer internship', 'thực tập mùa hè'),
      w('recruit', 'verb', '/rɪˈkruːt/', '/rɪˈkruːt/', 'tuyển dụng', 'The company plans to recruit ten engineers.', 'Công ty dự định tuyển mười kỹ sư.', 'recruit staff', 'tuyển nhân viên'),
    ],
  },
  {
    title: 'Software Development',
    description: 'Từ thường gặp khi làm phần mềm.',
    level: 'B1',
    categoryName: TECH,
    words: [
      w('software', 'noun', '/ˈsɑːft.wer/', '/ˈsɒft.weə/', 'phần mềm', 'Our team builds accounting software.', 'Nhóm chúng tôi làm phần mềm kế toán.', 'software engineer', 'kỹ sư phần mềm'),
      w('bug', 'noun', '/bʌɡ/', '/bʌɡ/', 'lỗi phần mềm', 'We found a bug in the payment page.', 'Chúng tôi tìm thấy một lỗi ở trang thanh toán.', 'fix a bug', 'sửa lỗi'),
      w('release', 'noun', '/rɪˈliːs/', '/rɪˈliːs/', 'bản phát hành', 'The next release comes out on Friday.', 'Bản phát hành tiếp theo ra mắt vào thứ Sáu.', 'new release', 'bản phát hành mới'),
      w('repository', 'noun', '/rɪˈpɑː.zə.tɔːr.i/', '/rɪˈpɒz.ɪ.tər.i/', 'kho mã nguồn', 'The code is stored in a shared repository.', 'Mã nguồn được lưu trong kho dùng chung.', 'code repository', 'kho mã nguồn'),
      w('server', 'noun', '/ˈsɝː.vɚ/', '/ˈsɜː.və/', 'máy chủ', 'The server restarted last night.', 'Máy chủ đã khởi động lại tối qua.', 'web server', 'máy chủ web'),
      w('framework', 'noun', '/ˈfreɪm.wɝːk/', '/ˈfreɪm.wɜːk/', 'bộ khung phần mềm', 'We use a popular web framework.', 'Chúng tôi dùng một bộ khung web phổ biến.', 'web framework', 'khung phát triển web'),
      w('deploy', 'verb', '/dɪˈplɔɪ/', '/dɪˈplɔɪ/', 'triển khai', 'We deploy new code every week.', 'Chúng tôi triển khai mã mới mỗi tuần.', 'deploy an update', 'triển khai bản cập nhật'),
      w('debug', 'verb', '/ˌdiːˈbʌɡ/', '/ˌdiːˈbʌɡ/', 'tìm và sửa lỗi', 'It took two hours to debug the login page.', 'Mất hai giờ để tìm và sửa lỗi trang đăng nhập.', 'debug the code', 'gỡ lỗi mã nguồn'),
      w('interface', 'noun', '/ˈɪn.t̬ɚ.feɪs/', '/ˈɪn.tə.feɪs/', 'giao diện', 'The new interface is easy to use.', 'Giao diện mới rất dễ dùng.', 'user interface', 'giao diện người dùng'),
      w('requirement', 'noun', '/rɪˈkwaɪr.mənt/', '/rɪˈkwaɪə.mənt/', 'yêu cầu', 'Please read the requirements before you start.', 'Hãy đọc yêu cầu trước khi bắt đầu.', 'meet a requirement', 'đáp ứng yêu cầu'),
      w('version', 'noun', '/ˈvɝː.ʒən/', '/ˈvɜː.ʃən/', 'phiên bản', 'Please install the latest version.', 'Vui lòng cài phiên bản mới nhất.', 'latest version', 'phiên bản mới nhất'),
      w('code', 'noun', '/koʊd/', '/kəʊd/', 'mã nguồn', 'She reviews the code before release.', 'Cô ấy rà soát mã nguồn trước khi phát hành.', 'write code', 'viết mã'),
    ],
  },
  {
    title: 'Hotels & Tourism',
    description: 'Từ dùng trong khách sạn, nhà hàng và du lịch.',
    level: 'B1',
    categoryName: REAL,
    words: [
      w('reservation', 'noun', '/ˌrez.ɚˈveɪ.ʃən/', '/ˌrez.əˈveɪ.ʃən/', 'sự đặt chỗ', 'I would like to make a reservation for two.', 'Tôi muốn đặt chỗ cho hai người.', 'make a reservation', 'đặt chỗ'),
      w('reception', 'noun', '/rɪˈsep.ʃən/', '/rɪˈsep.ʃən/', 'quầy lễ tân', 'Please leave your key at reception.', 'Vui lòng để chìa khoá ở quầy lễ tân.', 'reception desk', 'quầy lễ tân'),
      w('guest', 'noun', '/ɡest/', '/ɡest/', 'khách', 'The hotel welcomes guests from many countries.', 'Khách sạn đón khách từ nhiều nước.', 'hotel guest', 'khách của khách sạn'),
      w('suite', 'noun', '/swiːt/', '/swiːt/', 'phòng hạng sang', 'They booked a suite with a sea view.', 'Họ đặt một phòng hạng sang nhìn ra biển.', 'luxury suite', 'phòng hạng sang'),
      w('amenity', 'noun', '/əˈmen.ə.t̬i/', '/əˈmiː.nə.ti/', 'tiện nghi', 'The hotel amenities include a pool and a gym.', 'Tiện nghi khách sạn gồm hồ bơi và phòng tập.', 'hotel amenities', 'tiện nghi khách sạn'),
      w('souvenir', 'noun', '/ˌsuː.vəˈnɪr/', '/ˌsuː.vəˈnɪə/', 'quà lưu niệm', 'I bought a souvenir for my friend.', 'Tôi mua một món quà lưu niệm cho bạn.', 'souvenir shop', 'cửa hàng lưu niệm'),
      w('tourist', 'noun', '/ˈtʊr.ɪst/', '/ˈtʊə.rɪst/', 'khách du lịch', 'Many tourists visit Hoi An every year.', 'Nhiều khách du lịch đến Hội An mỗi năm.', 'foreign tourist', 'khách du lịch nước ngoài'),
      w('attraction', 'noun', '/əˈtræk.ʃən/', '/əˈtræk.ʃən/', 'điểm tham quan', 'The old town is a popular attraction.', 'Phố cổ là một điểm tham quan nổi tiếng.', 'tourist attraction', 'điểm du lịch'),
      w('accommodation', 'noun', '/əˌkɑː.məˈdeɪ.ʃən/', '/əˌkɒm.əˈdeɪ.ʃən/', 'chỗ ở', 'The price includes accommodation and meals.', 'Giá đã gồm chỗ ở và bữa ăn.', 'hotel accommodation', 'chỗ ở khách sạn'),
      w('excursion', 'noun', '/ɪkˈskɝː.ʒən/', '/ɪkˈskɜː.ʃən/', 'chuyến tham quan ngắn', 'We joined a one-day excursion to the islands.', 'Chúng tôi tham gia chuyến đi một ngày ra đảo.', 'day excursion', 'chuyến đi trong ngày'),
      w('housekeeping', 'noun', '/ˈhaʊsˌkiː.pɪŋ/', '/ˈhaʊsˌkiː.pɪŋ/', 'bộ phận buồng phòng', 'Please call housekeeping for more towels.', 'Vui lòng gọi bộ phận buồng phòng để lấy thêm khăn.', 'housekeeping staff', 'nhân viên buồng phòng'),
      w('cuisine', 'noun', '/kwɪˈziːn/', '/kwɪˈziːn/', 'ẩm thực', 'Vietnamese cuisine is famous for its fresh herbs.', 'Ẩm thực Việt Nam nổi tiếng với rau thơm tươi.', 'local cuisine', 'ẩm thực địa phương'),
    ],
  },
  {
    title: 'Study & Research',
    description: 'Từ dùng ở trường đại học và trong nghiên cứu.',
    level: 'B1',
    categoryName: ACADEMIC,
    words: [
      w('assignment', 'noun', '/əˈsaɪn.mənt/', '/əˈsaɪn.mənt/', 'bài tập được giao', 'The assignment is due next Monday.', 'Bài tập phải nộp vào thứ Hai tới.', 'submit an assignment', 'nộp bài tập'),
      w('lecture', 'noun', '/ˈlek.tʃɚ/', '/ˈlek.tʃə/', 'bài giảng', 'The lecture starts at eight o\'clock.', 'Bài giảng bắt đầu lúc tám giờ.', 'attend a lecture', 'dự bài giảng'),
      w('thesis', 'noun', '/ˈθiː.sɪs/', '/ˈθiː.sɪs/', 'luận văn', 'She is writing her graduation thesis.', 'Cô ấy đang viết luận văn tốt nghiệp.', 'graduation thesis', 'luận văn tốt nghiệp'),
      w('semester', 'noun', '/səˈmes.tɚ/', '/sɪˈmes.tə/', 'học kỳ', 'The new semester begins in September.', 'Học kỳ mới bắt đầu vào tháng Chín.', 'first semester', 'học kỳ một'),
      w('scholarship', 'noun', '/ˈskɑː.lɚ.ʃɪp/', '/ˈskɒl.ə.ʃɪp/', 'học bổng', 'He won a scholarship to study in Japan.', 'Anh ấy giành học bổng du học Nhật Bản.', 'apply for a scholarship', 'xin học bổng'),
      w('research', 'noun', '/ˈriː.sɝːtʃ/', '/rɪˈsɜːtʃ/', 'nghiên cứu', 'Her research focuses on online learning.', 'Nghiên cứu của cô ấy tập trung vào học trực tuyến.', 'do research', 'làm nghiên cứu'),
      w('reference', 'noun', '/ˈref.ɚ.əns/', '/ˈref.ər.əns/', 'tài liệu tham khảo', 'Add the reference at the end of your essay.', 'Hãy thêm tài liệu tham khảo vào cuối bài luận.', 'reference list', 'danh mục tham khảo'),
      w('citation', 'noun', '/saɪˈteɪ.ʃən/', '/saɪˈteɪ.ʃən/', 'trích dẫn', 'Every citation must show the source.', 'Mỗi trích dẫn phải ghi rõ nguồn.', 'citation style', 'kiểu trích dẫn'),
      w('experiment', 'noun', '/ɪkˈsper.ə.mənt/', '/ɪkˈsper.ɪ.mənt/', 'thí nghiệm', 'The students did an experiment in the lab.', 'Sinh viên làm thí nghiệm trong phòng lab.', 'carry out an experiment', 'tiến hành thí nghiệm'),
      w('hypothesis', 'noun', '/haɪˈpɑː.θə.sɪs/', '/haɪˈpɒθ.ə.sɪs/', 'giả thuyết', 'The data supports our hypothesis.', 'Dữ liệu ủng hộ giả thuyết của chúng tôi.', 'test a hypothesis', 'kiểm chứng giả thuyết'),
      w('seminar', 'noun', '/ˈsem.ə.nɑːr/', '/ˈsem.ɪ.nɑː/', 'buổi hội thảo', 'We have a seminar on data analysis today.', 'Hôm nay chúng tôi có buổi hội thảo về phân tích dữ liệu.', 'attend a seminar', 'dự hội thảo'),
      w('tutor', 'noun', '/ˈtuː.t̬ɚ/', '/ˈtʃuː.tə/', 'gia sư', 'My tutor helps me with my writing.', 'Gia sư giúp tôi cải thiện kỹ năng viết.', 'private tutor', 'gia sư riêng'),
    ],
  },
  {
    title: 'Contracts & Agreements',
    description: 'Từ thường gặp trong hợp đồng và thoả thuận.',
    level: 'B2',
    categoryName: WORK,
    words: [
      w('agreement', 'noun', '/əˈɡriː.mənt/', '/əˈɡriː.mənt/', 'thoả thuận', 'Both companies signed the agreement.', 'Hai công ty đã ký thoả thuận.', 'reach an agreement', 'đạt được thoả thuận'),
      w('clause', 'noun', '/klɑːz/', '/klɔːz/', 'điều khoản', 'Please read clause five carefully.', 'Vui lòng đọc kỹ điều khoản năm.', 'contract clause', 'điều khoản hợp đồng'),
      w('party', 'noun', '/ˈpɑːr.t̬i/', '/ˈpɑː.ti/', 'bên tham gia hợp đồng', 'Each party keeps a copy of the contract.', 'Mỗi bên giữ một bản hợp đồng.', 'third party', 'bên thứ ba'),
      w('term', 'noun', '/tɝːm/', '/tɜːm/', 'điều kiện, điều khoản', 'The terms of payment are listed below.', 'Các điều kiện thanh toán được liệt kê bên dưới.', 'terms and conditions', 'điều khoản và điều kiện'),
      w('signature', 'noun', '/ˈsɪɡ.nə.tʃɚ/', '/ˈsɪɡ.nə.tʃə/', 'chữ ký', 'We need your signature on page three.', 'Chúng tôi cần chữ ký của bạn ở trang ba.', 'digital signature', 'chữ ký số'),
      w('liability', 'noun', '/ˌlaɪ.əˈbɪl.ə.t̬i/', '/ˌlaɪ.əˈbɪl.ə.ti/', 'trách nhiệm pháp lý', 'The contract limits our liability.', 'Hợp đồng giới hạn trách nhiệm pháp lý của chúng tôi.', 'limited liability', 'trách nhiệm hữu hạn'),
      w('renewal', 'noun', '/rɪˈnuː.əl/', '/rɪˈnjuː.əl/', 'sự gia hạn', 'The renewal date is in December.', 'Ngày gia hạn là vào tháng Mười Hai.', 'contract renewal', 'gia hạn hợp đồng'),
      w('breach', 'noun', '/briːtʃ/', '/briːtʃ/', 'sự vi phạm', 'Late delivery is a breach of the contract.', 'Giao hàng trễ là vi phạm hợp đồng.', 'breach of contract', 'vi phạm hợp đồng'),
      w('obligation', 'noun', '/ˌɑː.bləˈɡeɪ.ʃən/', '/ˌɒb.lɪˈɡeɪ.ʃən/', 'nghĩa vụ', 'The supplier has an obligation to replace faulty goods.', 'Nhà cung cấp có nghĩa vụ đổi hàng lỗi.', 'legal obligation', 'nghĩa vụ pháp lý'),
      w('confidential', 'adjective', '/ˌkɑːn.fəˈden.ʃəl/', '/ˌkɒn.fɪˈden.ʃəl/', 'bảo mật', 'This information is strictly confidential.', 'Thông tin này được bảo mật nghiêm ngặt.', 'confidential data', 'dữ liệu mật'),
      w('amendment', 'noun', '/əˈmend.mənt/', '/əˈmend.mənt/', 'phần sửa đổi', 'Both sides approved the amendment.', 'Hai bên đã thông qua phần sửa đổi.', 'contract amendment', 'sửa đổi hợp đồng'),
      w('terminate', 'verb', '/ˈtɝː.mə.neɪt/', '/ˈtɜː.mɪ.neɪt/', 'chấm dứt', 'Either side may terminate the contract with notice.', 'Mỗi bên có thể chấm dứt hợp đồng khi báo trước.', 'terminate a contract', 'chấm dứt hợp đồng'),
    ],
  },
  {
    title: 'Human Resources',
    description: 'Từ dùng trong quản lý nhân sự.',
    level: 'B2',
    categoryName: WORK,
    words: [
      w('recruitment', 'noun', '/rɪˈkruːt.mənt/', '/rɪˈkruːt.mənt/', 'sự tuyển dụng', 'Recruitment takes about six weeks.', 'Việc tuyển dụng mất khoảng sáu tuần.', 'recruitment process', 'quy trình tuyển dụng'),
      w('onboarding', 'noun', '/ˈɑːnˌbɔːr.dɪŋ/', '/ˈɒnˌbɔː.dɪŋ/', 'quá trình tiếp nhận nhân viên mới', 'Onboarding lasts for two weeks.', 'Quá trình tiếp nhận nhân viên mới kéo dài hai tuần.', 'onboarding program', 'chương trình tiếp nhận nhân viên'),
      w('payroll', 'noun', '/ˈpeɪ.roʊl/', '/ˈpeɪ.rəʊl/', 'bảng lương', 'Payroll is processed at the end of each month.', 'Bảng lương được xử lý vào cuối mỗi tháng.', 'payroll system', 'hệ thống tính lương'),
      w('benefit', 'noun', '/ˈben.ə.fɪt/', '/ˈben.ɪ.fɪt/', 'phúc lợi', 'Health insurance is one of our benefits.', 'Bảo hiểm sức khoẻ là một trong các phúc lợi của chúng tôi.', 'employee benefits', 'phúc lợi nhân viên'),
      w('appraisal', 'noun', '/əˈpreɪ.zəl/', '/əˈpreɪ.zəl/', 'đánh giá năng lực', 'My annual appraisal is next week.', 'Tuần sau tôi có buổi đánh giá năng lực hằng năm.', 'performance appraisal', 'đánh giá hiệu suất'),
      w('resignation', 'noun', '/ˌrez.ɪɡˈneɪ.ʃən/', '/ˌrez.ɪɡˈneɪ.ʃən/', 'sự từ chức', 'He handed in his resignation on Monday.', 'Anh ấy nộp đơn từ chức vào thứ Hai.', 'letter of resignation', 'đơn từ chức'),
      w('overtime', 'noun', '/ˈoʊ.vɚ.taɪm/', '/ˈəʊ.və.taɪm/', 'giờ làm thêm', 'The team worked overtime to finish the order.', 'Nhóm làm thêm giờ để hoàn thành đơn hàng.', 'overtime pay', 'tiền làm thêm giờ'),
      w('workforce', 'noun', '/ˈwɝːk.fɔːrs/', '/ˈwɜːk.fɔːs/', 'lực lượng lao động', 'Women make up half of our workforce.', 'Phụ nữ chiếm một nửa lực lượng lao động của chúng tôi.', 'skilled workforce', 'lực lượng lao động lành nghề'),
      w('retention', 'noun', '/rɪˈten.ʃən/', '/rɪˈten.ʃən/', 'sự giữ chân', 'Good training improves staff retention.', 'Đào tạo tốt giúp giữ chân nhân viên.', 'staff retention', 'giữ chân nhân viên'),
      w('supervisor', 'noun', '/ˈsuː.pɚ.vaɪ.zɚ/', '/ˈsuː.pə.vaɪ.zə/', 'người giám sát', 'Please ask your supervisor for approval.', 'Vui lòng xin người giám sát phê duyệt.', 'direct supervisor', 'cấp trên trực tiếp'),
      w('mentor', 'noun', '/ˈmen.tɔːr/', '/ˈmen.tɔː/', 'người hướng dẫn', 'Each new employee has a mentor.', 'Mỗi nhân viên mới có một người hướng dẫn.', 'senior mentor', 'người hướng dẫn giàu kinh nghiệm'),
      w('absence', 'noun', '/ˈæb.səns/', '/ˈæb.səns/', 'sự vắng mặt', 'Please report any absence to your manager.', 'Vui lòng báo mọi trường hợp vắng mặt cho quản lý.', 'leave of absence', 'nghỉ phép dài ngày'),
    ],
  },
  {
    title: 'Data & Analytics',
    description: 'Từ dùng khi làm việc với số liệu và báo cáo.',
    level: 'B2',
    categoryName: TECH,
    words: [
      w('dataset', 'noun', '/ˈdeɪ.t̬ə.set/', '/ˈdeɪ.tə.set/', 'bộ dữ liệu', 'The dataset contains ten thousand records.', 'Bộ dữ liệu có mười nghìn bản ghi.', 'large dataset', 'bộ dữ liệu lớn'),
      w('trend', 'noun', '/trend/', '/trend/', 'xu hướng', 'The chart shows a rising trend.', 'Biểu đồ cho thấy xu hướng tăng.', 'market trend', 'xu hướng thị trường'),
      w('metric', 'noun', '/ˈmet.rɪk/', '/ˈmet.rɪk/', 'chỉ số đo lường', 'Revenue is our main metric.', 'Doanh thu là chỉ số chính của chúng tôi.', 'key metric', 'chỉ số chính'),
      w('chart', 'noun', '/tʃɑːrt/', '/tʃɑːt/', 'biểu đồ', 'The chart compares sales by region.', 'Biểu đồ so sánh doanh số theo khu vực.', 'bar chart', 'biểu đồ cột'),
      w('survey', 'noun', '/ˈsɝː.veɪ/', '/ˈsɜː.veɪ/', 'khảo sát', 'We sent a survey to our customers.', 'Chúng tôi gửi khảo sát cho khách hàng.', 'customer survey', 'khảo sát khách hàng'),
      w('sample', 'noun', '/ˈsæm.pəl/', '/ˈsɑːm.pəl/', 'mẫu', 'We tested a sample of five hundred users.', 'Chúng tôi kiểm tra một mẫu năm trăm người dùng.', 'random sample', 'mẫu ngẫu nhiên'),
      w('average', 'noun', '/ˈæv.ɚ.ɪdʒ/', '/ˈæv.ər.ɪdʒ/', 'mức trung bình', 'The average is higher than last month.', 'Mức trung bình cao hơn tháng trước.', 'on average', 'tính trung bình'),
      w('analysis', 'noun', '/əˈnæl.ə.sɪs/', '/əˈnæl.ə.sɪs/', 'sự phân tích', 'The analysis took three days.', 'Việc phân tích mất ba ngày.', 'data analysis', 'phân tích dữ liệu'),
      w('insight', 'noun', '/ˈɪn.saɪt/', '/ˈɪn.saɪt/', 'hiểu biết sâu', 'The report gives useful insights into customer behavior.', 'Báo cáo cho hiểu biết hữu ích về hành vi khách hàng.', 'valuable insight', 'hiểu biết giá trị'),
      w('accuracy', 'noun', '/ˈæk.jɚ.ə.si/', '/ˈæk.jə.rə.si/', 'độ chính xác', 'Please check the accuracy of these numbers.', 'Vui lòng kiểm tra độ chính xác của các con số này.', 'high accuracy', 'độ chính xác cao'),
      w('variable', 'noun', '/ˈver.i.ə.bəl/', '/ˈveə.ri.ə.bəl/', 'biến số', 'Price is the main variable in this model.', 'Giá là biến số chính trong mô hình này.', 'key variable', 'biến số chính'),
      w('visualize', 'verb', '/ˈvɪʒ.u.ə.laɪz/', '/ˈvɪʒ.u.ə.laɪz/', 'trực quan hoá', 'We use charts to visualize the results.', 'Chúng tôi dùng biểu đồ để trực quan hoá kết quả.', 'visualize data', 'trực quan hoá dữ liệu'),
    ],
  },
];
