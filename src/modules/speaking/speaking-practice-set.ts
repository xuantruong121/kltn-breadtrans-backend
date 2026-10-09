export interface SpeakingPracticeSetDefinition {
  key: string;
  title: string;
  description: string;
}

export interface SpeakingPracticeSetSource {
  title: string;
  category: string;
}

/**
 * The catalog grouping used by both the Speaking API and cross-skill progress.
 * Keep this based on structured title/category conventions until a dedicated
 * practice-set column is introduced by a separate content migration.
 */
export function resolveSpeakingPracticeSet(
  item: SpeakingPracticeSetSource,
): SpeakingPracticeSetDefinition {
  const title = item.title.toLowerCase();
  if (title.startsWith('read aloud')) {
    return item.category.toUpperCase() === 'TOEIC'
      ? {
          key: 'read-aloud-toeic',
          title: 'Đọc thành tiếng — Ngữ cảnh TOEIC',
          description:
            'Luyện đọc các thông báo và tình huống thường gặp trong môi trường công việc.',
        }
      : {
          key: 'read-aloud-general',
          title: 'Đọc thành tiếng — Giao tiếp hằng ngày',
          description:
            'Luyện đọc các câu tiếng Anh đời sống với nhịp điệu và phát âm rõ ràng.',
        };
  }
  if (title.startsWith('pronunciation')) {
    return {
      key: 'pronunciation-foundations',
      title: 'Nền tảng phát âm',
      description:
        'Củng cố âm cuối, trọng âm, nối âm và cách đọc số liệu trong câu thực tế.',
    };
  }
  if (title.startsWith('question response')) {
    return item.category.toUpperCase() === 'BUSINESS'
      ? {
          key: 'question-response-business',
          title: 'Phản hồi câu hỏi — Công việc',
          description:
            'Luyện trả lời câu hỏi trong các tình huống họp, dịch vụ và giao tiếp công sở.',
        }
      : {
          key: 'question-response-general',
          title: 'Phản hồi câu hỏi — Đời sống',
          description:
            'Luyện phản xạ trả lời các câu hỏi quen thuộc bằng câu nói tự nhiên.',
        };
  }
  if (title.startsWith('opinion')) {
    return item.category.toUpperCase() === 'BUSINESS'
      ? {
          key: 'opinion-business',
          title: 'Trình bày quan điểm — Công việc',
          description:
            'Trình bày ý kiến có lý do và ví dụ trong các chủ đề nghề nghiệp.',
        }
      : {
          key: 'opinion-general',
          title: 'Trình bày quan điểm — Hằng ngày',
          description:
            'Luyện diễn đạt quan điểm cá nhân mạch lạc, tự nhiên và có dẫn chứng.',
        };
  }
  if (title.startsWith('toeic speaking')) {
    return {
      key: 'toeic-speaking-practice',
      title: 'Luyện nhiệm vụ TOEIC Speaking',
      description:
        'Luyện theo nhóm nhiệm vụ đọc thành tiếng, mô tả và phản hồi trong TOEIC Speaking.',
    };
  }
  return {
    key: `custom-${item.category.toLowerCase()}`,
    title: `Luyện nói — ${item.category}`,
    description: 'Một bộ câu luyện nói theo chủ đề.',
  };
}
