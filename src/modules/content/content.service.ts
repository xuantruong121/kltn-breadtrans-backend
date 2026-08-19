import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getContentTopics(category?: string) {
    let topics = await this.prisma.contentTopic.findMany({
      where: category ? { category } : undefined,
      orderBy: { order: 'asc' },
    });

    if (topics.length === 0) {
      // Auto seed default movie & music topics if empty
      await this.prisma.contentTopic.createMany({
        data: [
          {
            topicId: 'movie-zootopia-interview',
            category: 'movie',
            title: 'Zootopia: Judy Hopps Phỏng Vấn Tuyển Dụng',
            order: 1,
            materialLinks: {
              youtubeId: 'jWM0ct-OLsM',
              thumbnail: 'https://img.youtube.com/vi/jWM0ct-OLsM/maxresdefault.jpg',
              duration: '3:45',
              level: 'BEGINNER',
              description: 'Luyện nghe phản xạ giao tiếp tiếng Anh công sở qua đoạn hội thoại tuyển dụng trong phim Zootopia.',
            },
            exercises: [
              {
                id: 1,
                question: 'Judy Hopps cảm thấy như thế nào khi nhận nhiệm vụ đầu tiên?',
                options: ['Hào hứng và quyết tâm', 'Thất vọng và muốn bỏ cuộc', 'Sợ hãi', 'Tức giận'],
                correctIndex: 0,
                explanation: 'Judy luôn giữ tinh thần lạc quan và nói: "I won\'t let you down!"',
              },
              {
                id: 2,
                question: 'Từ "Traffic Duty" trong video có nghĩa là gì?',
                options: ['Nhiệm vụ điều phối giao thông', 'Điều tra trọng án', 'Bảo vệ tổng thống', 'Lập biên bản phạt đậu xe'],
                correctIndex: 0,
                explanation: 'Traffic Duty nghĩa là nhiệm vụ điều tiết, kiểm soát giao thông.',
              },
            ],
          },
          {
            topicId: 'movie-coco-remember-me',
            category: 'movie',
            title: 'Coco: Bài Hát Remember Me & Tình Cảm Gia Đình',
            order: 2,
            materialLinks: {
              youtubeId: 'E7s5h7BvT6Q',
              thumbnail: 'https://img.youtube.com/vi/E7s5h7BvT6Q/maxresdefault.jpg',
              duration: '4:10',
              level: 'INTERMEDIATE',
              description: 'Khám phá từ vựng miêu tả ký ức, tình cảm gia đình và giai điệu ấm áp của phim hoạt hình Coco.',
            },
            exercises: [
              {
                id: 1,
                question: 'Cụm từ "Remember me though I have to say goodbye" mang ý nghĩa gì?',
                options: ['Hãy nhớ đến tôi dù tôi phải nói lời tạm biệt', 'Đừng quên tôi khi bạn đi xa', 'Chào tạm biệt mọi người', 'Hãy giữ lại những bức ảnh cũ'],
                correctIndex: 0,
                explanation: '"Though" = Mặc dù, "say goodbye" = nói lời tạm biệt.',
              },
            ],
          },
          {
            topicId: 'music-count-on-me-bruno',
            category: 'music',
            title: 'Count On Me - Bruno Mars (Bài Ca Tình Bạn)',
            order: 1,
            materialLinks: {
              youtubeId: 'Yc6T9iY9rs8',
              thumbnail: 'https://img.youtube.com/vi/Yc6T9iY9rs8/maxresdefault.jpg',
              duration: '3:15',
              level: 'BEGINNER',
              description: 'Học các cụm từ đếm số, thì hiện tại đơn và câu điều kiện loại 1 qua ca khúc kinh điển về tình bạn.',
            },
            exercises: [
              {
                id: 1,
                question: 'Cụm từ "Count on me" có nghĩa là gì trong tiếng Anh?',
                options: ['Hãy tin tưởng / Trông cậy vào tôi', 'Hãy đếm số cùng tôi', 'Hãy tính toán tiền nong', 'Hãy đi cùng tôi'],
                correctIndex: 0,
                explanation: '"Count on someone" là một idiom phổ biến có nghĩa là tin tưởng, trông cậy vào ai đó.',
              },
              {
                id: 2,
                question: 'Điền từ vào chỗ trống: "If you ever find yourself stuck in the middle of the _______"',
                options: ['sea', 'tree', 'street', 'city'],
                correctIndex: 0,
                explanation: 'Lời bài hát: "If you ever find yourself stuck in the middle of the sea, I\'ll sail the world to find you".',
              },
            ],
          },
          {
            topicId: 'music-try-everything-shakira',
            category: 'music',
            title: 'Try Everything - Shakira (Không Ngại Thất Bại)',
            order: 2,
            materialLinks: {
              youtubeId: 'c6rP-YP4c5I',
              thumbnail: 'https://img.youtube.com/vi/c6rP-YP4c5I/maxresdefault.jpg',
              duration: '3:20',
              level: 'INTERMEDIATE',
              description: 'Nạp năng lượng học tiếng Anh với các động từ hành động mạnh mẽ và thông điệp kiên trì vượt qua khó khăn.',
            },
            exercises: [
              {
                id: 1,
                question: 'Ý nghĩa của thông điệp "I won\'t give up, no I won\'t give in" là gì?',
                options: ['Tôi sẽ không bỏ cuộc, không đầu hàng', 'Tôi sẽ từ bỏ sớm', 'Tôi không muốn tiếp tục', 'Tôi rất mệt mỏi'],
                correctIndex: 0,
                explanation: '"Give up" = bỏ cuộc, "Give in" = nhượng bộ/đầu hàng.',
              },
            ],
          },
        ],
      });

      topics = await this.prisma.contentTopic.findMany({
        where: category ? { category } : undefined,
        orderBy: { order: 'asc' },
      });
    }

    return topics;
  }

  async getContentTopicById(identifier: string) {
    const isNumeric = !isNaN(Number(identifier));
    const topic = isNumeric
      ? await this.prisma.contentTopic.findUnique({ where: { id: Number(identifier) } })
      : await this.prisma.contentTopic.findUnique({ where: { topicId: identifier } });

    if (!topic) {
      throw new NotFoundException(`Content topic ${identifier} not found`);
    }

    return topic;
  }

  async createContentTopic(dto: any) {
    return this.prisma.contentTopic.create({
      data: {
        topicId: dto.topicId || `topic-${Date.now()}`,
        category: dto.category || 'movie',
        title: dto.title,
        order: dto.order || 0,
        materialLinks: dto.materialLinks || {},
        exercises: dto.exercises || [],
      },
    });
  }

  async deleteContentTopic(id: number) {
    return this.prisma.contentTopic.delete({ where: { id } });
  }
}
