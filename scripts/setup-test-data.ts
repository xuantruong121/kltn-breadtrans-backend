import { PrismaClient, CourseStatus, ClassStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const teacher = await prisma.user.findUnique({
    where: { email: 'teacher1@breadtrans.com' },
  });

  if (!teacher) {
    console.error('Teacher teacher1@breadtrans.com not found');
    return;
  }

  // 1. DRAFT course
  let draft = await prisma.course.findFirst({
    where: { teacherId: teacher.id, status: CourseStatus.DRAFT },
  });
  if (!draft) {
    draft = await prisma.course.create({
      data: {
        title: 'Khóa học TOEIC Cấp Tốc 30 Ngày (Bản Nháp)',
        description: 'Lộ trình cấp tốc 30 ngày tập trung trọng điểm các dạng đề thi thường gặp.',
        level: 'BEGINNER',
        status: CourseStatus.DRAFT,
        teacherId: teacher.id,
        thumbnail: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=500&auto=format&fit=crop&q=80',
        lessons: {
          create: [
            { title: 'Bài 1: Chiến thuật xử lý Part 1 và Part 2', order: 1 },
          ],
        },
      },
    });
    console.log('Created draft course ID:', draft.id);
  } else {
    console.log('Existing draft course ID:', draft.id);
  }

  // 2. PUBLISHED course with NO ongoing classes
  let pubNoOngoing = await prisma.course.findFirst({
    where: { teacherId: teacher.id, title: 'Kỹ năng Giao Tiếp Nơi Công Sở (No Ongoing)' },
  });
  if (!pubNoOngoing) {
    pubNoOngoing = await prisma.course.create({
      data: {
        title: 'Kỹ năng Giao Tiếp Nơi Công Sở (No Ongoing)',
        description: 'Khóa học thực chiến kỹ năng giao tiếp tiếng Anh trong môi trường làm việc quốc tế.',
        level: 'INTERMEDIATE',
        status: CourseStatus.PUBLISHED,
        teacherId: teacher.id,
        thumbnail: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=500&auto=format&fit=crop&q=80',
        lessons: {
          create: [
            { title: 'Bài 1: Chào hỏi và giới thiệu bản thân chuyên nghiệp', order: 1 },
            { title: 'Bài 2: Viết email trao đổi công việc chuẩn mực', order: 2 },
          ],
        },
      },
    });
    console.log('Created pubNoOngoing course ID:', pubNoOngoing.id);
  } else {
    console.log('Existing pubNoOngoing course ID:', pubNoOngoing.id);
  }

  // 3. UPCOMING class for pubNoOngoing course
  let upcomingClass = await prisma.class.findFirst({
    where: { teacherId: teacher.id, status: ClassStatus.UPCOMING },
  });
  if (!upcomingClass) {
    upcomingClass = await prisma.class.create({
      data: {
        name: 'Lớp Giao Tiếp Công Sở K01 (Sắp diễn ra)',
        courseId: pubNoOngoing.id,
        teacherId: teacher.id,
        capacity: 25,
        status: ClassStatus.UPCOMING,
        startDate: new Date('2026-10-01T08:00:00Z'),
        endDate: new Date('2026-11-01T10:00:00Z'),
        meetingLink: 'https://breadtrans-kltn.daily.co/upcoming-k01',
      },
    });
    console.log('Created upcoming class ID:', upcomingClass.id);
  } else {
    console.log('Existing upcoming class ID:', upcomingClass.id);
  }

  // 4. COMPLETED class
  let completedClass = await prisma.class.findFirst({
    where: { teacherId: teacher.id, status: ClassStatus.COMPLETED },
  });
  if (!completedClass) {
    completedClass = await prisma.class.create({
      data: {
        name: 'Lớp Giao Tiếp K02 (Đã kết thúc)',
        courseId: pubNoOngoing.id,
        teacherId: teacher.id,
        capacity: 25,
        status: ClassStatus.COMPLETED,
        startDate: new Date('2026-06-01T08:00:00Z'),
        endDate: new Date('2026-07-01T10:00:00Z'),
        meetingLink: 'https://breadtrans-kltn.daily.co/completed-k02',
      },
    });
    console.log('Created completed class ID:', completedClass.id);
  } else {
    console.log('Existing completed class ID:', completedClass.id);
  }

  // 5. CANCELLED class
  let cancelledClass = await prisma.class.findFirst({
    where: { teacherId: teacher.id, status: ClassStatus.CANCELLED },
  });
  if (!cancelledClass) {
    cancelledClass = await prisma.class.create({
      data: {
        name: 'Lớp Giao Tiếp K03 (Đã hủy)',
        courseId: pubNoOngoing.id,
        teacherId: teacher.id,
        capacity: 25,
        status: ClassStatus.CANCELLED,
        startDate: new Date('2026-07-01T08:00:00Z'),
        endDate: new Date('2026-08-01T10:00:00Z'),
        meetingLink: 'https://breadtrans-kltn.daily.co/cancelled-k03',
      },
    });
    console.log('Created cancelled class ID:', cancelledClass.id);
  } else {
    console.log('Existing cancelled class ID:', cancelledClass.id);
  }

  // 6. Disposable empty class for Delete test
  let disposableClass = await prisma.class.findFirst({
    where: { name: 'Lớp Test Xóa (Disposable Empty)' },
  });
  if (!disposableClass) {
    disposableClass = await prisma.class.create({
      data: {
        name: 'Lớp Test Xóa (Disposable Empty)',
        courseId: pubNoOngoing.id,
        teacherId: teacher.id,
        capacity: 20,
        status: ClassStatus.UPCOMING,
        startDate: new Date('2026-11-01T08:00:00Z'),
        endDate: new Date('2026-12-01T10:00:00Z'),
      },
    });
    console.log('Created disposable class ID:', disposableClass.id);
  } else {
    console.log('Existing disposable class ID:', disposableClass.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
