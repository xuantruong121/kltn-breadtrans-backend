import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding TOEIC Vocabulary topics & words...');

  // 1. Contracts Topic
  const contractsTopic = await prisma.vocabTopic.upsert({
    where: { id: 1 },
    update: {
      title: 'Contracts',
      categoryName: '600 TỪ VỰNG TOEIC',
      totalWords: 12,
      isPro: false,
    },
    create: {
      id: 1,
      title: 'Contracts',
      categoryName: '600 TỪ VỰNG TOEIC',
      totalWords: 12,
      isPro: false,
    },
  });

  const contractsWords = [
    {
      word: 'abide by',
      pos: 'verb',
      ipaUs: "/ə'baɪd baɪ/",
      ipaUk: "/ə'baɪd baɪ/",
      meaning: 'tuân theo',
      exampleEn: 'All employees must abide by company safety regulations during work hours.',
      exampleVi: 'Tất cả nhân viên phải tuân theo các quy định an toàn công ty trong giờ làm việc.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=abide+by&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=abide+by&type=1',
      order: 1,
    },
    {
      word: 'agreement',
      pos: 'noun',
      ipaUs: '/əˈɡriːmənt/',
      ipaUk: '/əˈɡriːmənt/',
      meaning: 'hợp đồng, thỏa thuận',
      exampleEn: 'The two companies signed a long-term agreement to supply materials.',
      exampleVi: 'Hai công ty ký một thỏa thuận dài hạn để cung cấp vật liệu.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=agreement&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=agreement&type=1',
      order: 2,
    },
    {
      word: 'assurance',
      pos: 'noun',
      ipaUs: '/əˈʃʊərəns/',
      ipaUk: '/əˈʃʊərəns/',
      meaning: 'sự cam đoan, sự bảo đảm',
      exampleEn: 'The sales manager gave her assurance that the shipment would arrive tomorrow.',
      exampleVi: 'Trưởng phòng kinh doanh cam đoan rằng lô hàng sẽ đến vào ngày mai.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=assurance&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=assurance&type=1',
      order: 3,
    },
    {
      word: 'cancellation',
      pos: 'noun',
      ipaUs: '/ˌkænsəˈleɪʃn/',
      ipaUk: '/ˌkænsəˈleɪʃn/',
      meaning: 'sự hủy bỏ',
      exampleEn: 'The cancellation of the contract caused significant financial loss.',
      exampleVi: 'Việc hủy bỏ hợp đồng đã gây ra tổn thất tài chính đáng kể.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=cancellation&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=cancellation&type=1',
      order: 4,
    },
    {
      word: 'determine',
      pos: 'verb',
      ipaUs: '/dɪˈtɜːrmɪn/',
      ipaUk: '/dɪˈtɜːmɪn/',
      meaning: 'xác định, quyết định',
      exampleEn: 'The lawyer will determine whether the contract clause is legally binding.',
      exampleVi: 'Luật sư sẽ xác định liệu điều khoản hợp đồng có ràng buộc pháp lý hay không.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=determine&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=determine&type=1',
      order: 5,
    },
    {
      word: 'engage',
      pos: 'verb',
      ipaUs: "/ɪn'ɡeɪdʒ/",
      ipaUk: "/ɪn'ɡeɪdʒ/",
      meaning: 'tham gia, hứa hẹn, thuê',
      exampleEn: 'We decided to engage a consultant to review our vendor contracts.',
      exampleVi: 'Chúng tôi quyết định thuê một cố vấn để xem xét các hợp đồng nhà cung cấp.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=engage&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=engage&type=1',
      order: 6,
    },
    {
      word: 'establish',
      pos: 'verb',
      ipaUs: '/ɪˈstæblɪʃ/',
      ipaUk: '/ɪˈstæblɪʃ/',
      meaning: 'thiết lập, thành lập',
      exampleEn: 'The partnership agreement helped establish a strong business relationship.',
      exampleVi: 'Hợp đồng đối tác đã giúp thiết lập mối quan hệ kinh doanh vững chắc.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=establish&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=establish&type=1',
      order: 7,
    },
    {
      word: 'obligate',
      pos: 'verb',
      ipaUs: '/ˈɑːblɪɡeɪt/',
      ipaUk: '/ˈɒblɪɡeɪt/',
      meaning: 'bắt buộc, cưỡng bách',
      exampleEn: 'The terms of the lease obligate the tenant to pay rent on the first of each month.',
      exampleVi: 'Các điều khoản thuê nhà bắt buộc người thuê phải trả tiền nhà vào ngày mùng 1 hàng tháng.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=obligate&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=obligate&type=1',
      order: 8,
    },
    {
      word: 'party',
      pos: 'noun',
      ipaUs: '/ˈpɑːrti/',
      ipaUk: '/ˈpɑːti/',
      meaning: 'bên (trong hợp đồng), phía',
      exampleEn: 'Both parties agreed to modify the payment schedule.',
      exampleVi: 'Cả hai bên đã đồng ý sửa đổi lịch trình thanh toán.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=party&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=party&type=1',
      order: 9,
    },
    {
      word: 'provision',
      pos: 'noun',
      ipaUs: '/prəˈvɪʒn/',
      ipaUk: '/prəˈvɪʒn/',
      meaning: 'dự phòng, điều khoản',
      exampleEn: 'The agreement contains a special provision for early termination.',
      exampleVi: 'Hợp đồng chứa một điều khoản đặc biệt cho việc chấm dứt sớm.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=provision&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=provision&type=1',
      order: 10,
    },
    {
      word: 'resolve',
      pos: 'verb',
      ipaUs: '/rɪˈzɑːlv/',
      ipaUk: '/rɪˈzɒlv/',
      meaning: 'giải quyết',
      exampleEn: 'The mediator helped resolve the dispute between the two companies.',
      exampleVi: 'Người hòa giải đã giúp giải quyết tranh chấp giữa hai công ty.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=resolve&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=resolve&type=1',
      order: 11,
    },
    {
      word: 'specific',
      pos: 'adjective',
      ipaUs: '/spəˈsɪfɪk/',
      ipaUk: '/spəˈsɪfɪk/',
      meaning: 'cụ thể, rành mạch',
      exampleEn: 'The contract includes specific details about delivery dates.',
      exampleVi: 'Hợp đồng bao gồm các chi tiết cụ thể về ngày giao hàng.',
      audioUs: 'https://dict.youdao.com/dictvoice?audio=specific&type=2',
      audioUk: 'https://dict.youdao.com/dictvoice?audio=specific&type=1',
      order: 12,
    },
  ];

  for (const w of contractsWords) {
    await prisma.vocabWord.upsert({
      where: { id: w.order },
      update: { ...w, topicId: contractsTopic.id },
      create: { ...w, topicId: contractsTopic.id },
    });
  }

  // Other topics
  const topicsData = [
    { id: 2, title: 'Marketing', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: false },
    { id: 3, title: 'Warranties', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: false },
    { id: 4, title: 'Business Planning', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: true },
    { id: 5, title: 'Conferences', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: false },
    { id: 6, title: 'Computers', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: false },
    { id: 7, title: 'Office Technology', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: false },
    { id: 8, title: 'Office Procedures', categoryName: '600 TỪ VỰNG TOEIC', totalWords: 12, isPro: true },
    { id: 9, title: 'Part 5 Vocab Set 1', categoryName: 'Đề 2023 (10)', totalWords: 10, isPro: false },
    { id: 10, title: 'Part 5 Vocab Set 2', categoryName: 'Đề 2024 (10)', totalWords: 10, isPro: false },
    { id: 11, title: 'Part 5 Vocab Set 3', categoryName: 'Đề 2026 (10)', totalWords: 10, isPro: false },
    { id: 12, title: 'Advanced Business Terms', categoryName: 'TOEIC MASTER (3)', totalWords: 12, isPro: true },
  ];

  for (const t of topicsData) {
    await prisma.vocabTopic.upsert({
      where: { id: t.id },
      update: t,
      create: t,
    });
  }

  console.log('✅ Seeding Vocab completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
