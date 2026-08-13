import { PrismaClient, TopicCategory, QuizType } from '@prisma/client';

const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });

async function seedPractice() {
  console.log('Seeding Practice Data...');

  // 1. Vocab Topics & Words
  const vocabTopics = [
    {
      title: 'Office Commute',
      categoryName: '600 TỪ VỰNG TOEIC',
      iconUrl: '💼',
      words: [
        { word: 'Commute', pos: 'verb', meaning: 'Đi làm, di chuyển', ipaUs: '/kəˈmjuːt/', exampleEn: 'I commute to work by bus.', exampleVi: 'Tôi đi làm bằng xe buýt.' },
        { word: 'Briefcase', pos: 'noun', meaning: 'Cặp xách', ipaUs: '/ˈbriːf.keɪs/', exampleEn: 'He forgot his briefcase.', exampleVi: 'Anh ấy quên cặp xách của mình.' },
        { word: 'Colleague', pos: 'noun', meaning: 'Đồng nghiệp', ipaUs: '/ˈkɑː.liːɡ/', exampleEn: 'My colleague helped me.', exampleVi: 'Đồng nghiệp đã giúp tôi.' },
        { word: 'Conference', pos: 'noun', meaning: 'Hội nghị', ipaUs: '/ˈkɑːn.fɚ.əns/', exampleEn: 'The conference is tomorrow.', exampleVi: 'Hội nghị sẽ diễn ra vào ngày mai.' },
        { word: 'Agenda', pos: 'noun', meaning: 'Chương trình nghị sự', ipaUs: '/əˈdʒen.də/', exampleEn: 'What is on the agenda?', exampleVi: 'Chương trình nghị sự có gì?' },
      ]
    },
    {
      title: 'Travel & Vacation',
      categoryName: '600 TỪ VỰNG TOEIC',
      iconUrl: '✈️',
      words: [
        { word: 'Itinerary', pos: 'noun', meaning: 'Lịch trình', ipaUs: '/aɪˈtɪn.ə.rer.i/', exampleEn: 'We received our itinerary.', exampleVi: 'Chúng tôi đã nhận được lịch trình.' },
        { word: 'Luggage', pos: 'noun', meaning: 'Hành lý', ipaUs: '/ˈlʌɡ.ɪdʒ/', exampleEn: 'Don\'t leave your luggage.', exampleVi: 'Đừng để quên hành lý.' },
        { word: 'Depart', pos: 'verb', meaning: 'Khởi hành', ipaUs: '/dɪˈpɑːrt/', exampleEn: 'The plane departs at 8.', exampleVi: 'Máy bay khởi hành lúc 8 giờ.' },
        { word: 'Destination', pos: 'noun', meaning: 'Điểm đến', ipaUs: '/ˌdes.təˈneɪ.ʃən/', exampleEn: 'Our destination is Paris.', exampleVi: 'Điểm đến của chúng tôi là Paris.' },
        { word: 'Accommodation', pos: 'noun', meaning: 'Chỗ ở', ipaUs: '/əˌkɑː.məˈdeɪ.ʃən/', exampleEn: 'We booked accommodation.', exampleVi: 'Chúng tôi đã đặt chỗ ở.' },
      ]
    }
  ];

  for (const topicData of vocabTopics) {
    const topic = await prisma.vocabTopic.create({
      data: {
        title: topicData.title,
        categoryName: topicData.categoryName,
        iconUrl: topicData.iconUrl,
        totalWords: topicData.words.length,
      }
    });

    for (let i = 0; i < topicData.words.length; i++) {
      await prisma.vocabWord.create({
        data: {
          ...topicData.words[i],
          topicId: topic.id,
          order: i,
        }
      });
    }
  }

  // 2. Practice Topics (Reading Bilingual)
  const practiceTopics = [
    {
      name: 'The Future of AI in Education',
      vietnameseName: 'Tương lai của AI trong Giáo dục',
      category: TopicCategory.BILINGUAL_LEVEL,
      iconUrl: '🤖',
      order: 1
    },
    {
      name: 'Global Warming Effects',
      vietnameseName: 'Ảnh hưởng của Trái Đất Nóng Lên',
      category: TopicCategory.BILINGUAL_LEVEL,
      iconUrl: '🌍',
      order: 2
    }
  ];

  for (const pt of practiceTopics) {
    const practiceTopic = await prisma.practiceTopic.create({
      data: pt
    });

    // Create Bilingual Quiz for this topic
    await prisma.quiz.create({
      data: {
        practiceTopicId: practiceTopic.id,
        title: `Reading Practice: ${pt.name}`,
        description: 'Read the following bilingual article and answer the questions.',
        type: QuizType.BILINGUAL_READING,
        bilingualContent: [
          {
            en: 'Artificial Intelligence is revolutionizing the way students learn by providing personalized experiences.',
            vi: 'Trí tuệ nhân tạo đang cách mạng hóa cách học sinh học tập bằng cách cung cấp những trải nghiệm cá nhân hóa.'
          },
          {
            en: 'AI tutors can identify a student’s weaknesses and generate custom exercises to improve their skills.',
            vi: 'Gia sư AI có thể xác định điểm yếu của học sinh và tạo ra các bài tập tùy chỉnh để cải thiện kỹ năng của họ.'
          }
        ],
        questions: {
          create: [
            {
              type: 'MULTIPLE_CHOICE',
              order: 1,
              content: {
                text: 'What is AI doing to the way students learn?',
                options: ['Destroying it', 'Revolutionizing it', 'Ignoring it', 'Complicating it'],
                correct: 'Revolutionizing it'
              }
            }
          ]
        }
      }
    });
  }

  // 3. Speaking Exercises
  const speakingExercises = [
    {
      title: 'Self Introduction',
      targetText: 'Hello, my name is Alex. I am a software engineer and I love building web applications.',
      difficulty: 'BEGINNER',
      category: 'GENERAL'
    },
    {
      title: 'TOEIC Part 1: Picture Description',
      targetText: 'The man is standing at the desk. He is holding a pen in his right hand and looking at the computer screen.',
      imageUrl: 'https://images.unsplash.com/photo-1573164713988-8665fc963095?w=500',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC'
    }
  ];

  for (const exercise of speakingExercises) {
    await prisma.speakingExercise.create({
      data: exercise
    });
  }

  // 4. Listening Quiz (Dictation)
  await prisma.quiz.create({
    data: {
      title: 'Dictation Practice: Daily Conversations',
      description: 'Listen to the audio and type exactly what you hear.',
      type: QuizType.LISTENING_PRACTICE,
      questions: {
        create: [
          {
            type: 'FILL_IN_BLANK',
            order: 1,
            content: {
              text: 'Could you please send me the report by ___?',
              audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
              correct: 'Friday'
            }
          }
        ]
      }
    }
  });

  console.log('Seeding Practice Data finished successfully.');
}

seedPractice()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
