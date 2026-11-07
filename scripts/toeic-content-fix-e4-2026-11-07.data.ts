/**
 * Exam 1 Part 7 single passages (q147-175, groups 60-69), rewritten by hand
 * for fix E4 (2026-11-07): the old passages were 40-70 words with literal
 * look-up questions and absurd distractors. Each passage is now 100-160 words
 * and the set uses the question types of the real test: purpose, detail,
 * inference, NOT, word meaning, sentence insertion and a text-chain
 * "what does X mean". Group ids and question numbers do not change.
 */
export type E4Question = {
  n: number;
  text: string;
  options: [string, string, string, string];
  key: 0 | 1 | 2 | 3;
  explanation: string;
};
export type E4Group = { groupId: number; passage: string; questions: E4Question[] };

const INSERT = (sentence: string) =>
  `In which of the positions marked [1], [2], [3], and [4] does the following sentence best belong? "${sentence}"`;
const POSITIONS: [string, string, string, string] = ['[1]', '[2]', '[3]', '[4]'];

export const E4_GROUPS: E4Group[] = [
  {
    groupId: 60,
    passage: `EMAIL
From: Nina Wong, Office Manager
To: All Staff, Harbor Street Office
Date: Monday, March 9
Subject: New room-booking system

Dear colleagues,
Starting next Monday, meeting rooms on all three floors must be reserved through RoomLink, our new online booking system, instead of the paper sheets posted outside each room. [1] You can sign in with your usual company password, and the system will show which rooms are free and what equipment each one has. [2]
Bookings may be made up to four weeks in advance. Please cancel a reservation as soon as you know you will not need the room, because unused bookings prevent others from finding space. [3] Rooms that are booked but not checked into within fifteen minutes will be released automatically.
A short training video is available on the company intranet. [4] If you have any questions, please contact me at extension 214.

Nina Wong`,
    questions: [
      { n: 147, text: 'What is the purpose of the e-mail?', options: ['To announce a change in how rooms are reserved', 'To ask staff to clean the meeting rooms', 'To report that a room is under repair', 'To invite staff to a training session'], key: 0,
        explanation: 'E-mail thông báo từ thứ Hai tới phải đặt phòng họp qua hệ thống trực tuyến RoomLink thay cho tờ giấy dán ngoài phòng.' },
      { n: 148, text: 'What will happen if a booked room is not checked into within fifteen minutes?', options: ['The employee will be charged a fee.', 'The office manager will call the employee.', 'The room will become available to others.', 'The booking will be moved to the next day.'], key: 2,
        explanation: 'Phòng đã đặt mà không nhận trong 15 phút sẽ được tự động trả lại (released automatically), tức là người khác có thể đặt.' },
      { n: 149, text: INSERT('It takes less than five minutes to watch.'), options: POSITIONS, key: 3,
        explanation: 'Câu này nói về độ dài của một video, nên đứng ngay sau câu nhắc đến video hướng dẫn trên mạng nội bộ, tức là vị trí [4].' },
    ],
  },
  {
    groupId: 61,
    passage: `NOTICE
West Garage Resurfacing — November 2 to 4

Levels 3 and 4 of the West Garage will be closed from Monday, November 2, through Wednesday, November 4, while the parking surface is repaired and repainted. Levels 1 and 2 will remain open during regular hours, but spaces there are expected to fill quickly, especially before 9 A.M.
During the closure, employees may park in the East Garage on Maple Avenue at no charge by showing their staff ID card at the entrance. A free shuttle bus will run between the East Garage and the main building every ten minutes from 7:00 A.M. to 7:00 P.M. Employees who usually take public transportation are encouraged to continue doing so during this period.
Vehicles left on Levels 3 or 4 after 8:00 P.M. on Sunday, November 1, will be moved at the owner's expense.`,
    questions: [
      { n: 150, text: 'What is the notice mainly about?', options: ['A new parking fee', 'A temporary closure of part of a garage', 'The opening of a new building', 'A change in shuttle bus routes'], key: 1,
        explanation: 'Thông báo cho biết tầng 3 và 4 của West Garage đóng cửa từ 2 đến 4/11 để sửa mặt sàn, tức là đóng cửa tạm thời một phần bãi xe.' },
      { n: 151, text: 'What is indicated about the East Garage?', options: ['It closes at 7:00 P.M.', 'It is reserved for visitors.', 'Staff can park there for free.', 'It is next to the main building.'], key: 2,
        explanation: 'Nhân viên được đỗ xe ở East Garage miễn phí (at no charge) khi xuất trình thẻ nhân viên. 7:00 P.M. là giờ cuối của xe đưa đón, không phải giờ đóng cửa bãi xe.' },
      { n: 152, text: 'What are employees asked to do by Sunday evening?', options: ['Register their vehicles online', 'Move their cars off Levels 3 and 4', 'Pick up a new ID card', 'Reserve a seat on the shuttle'], key: 1,
        explanation: 'Xe còn ở tầng 3 hoặc 4 sau 8 giờ tối Chủ nhật 1/11 sẽ bị dời đi và chủ xe chịu phí, nên nhân viên cần chuyển xe ra trước thời điểm đó.' },
    ],
  },
  {
    groupId: 62,
    passage: `ADVERTISEMENT
BrightDesk Pro — Work Your Way

Sitting all day is hard on your back. The BrightDesk Pro lets you move from sitting to standing in seconds with the touch of a button. Its quiet motor adjusts the height from 65 to 125 centimeters, and two memory settings let you return to your favorite positions instantly.
The desk comes with a built-in cable tray to keep wires out of sight and is backed by a five-year warranty on all parts. Choose from three surface colors: white oak, walnut, or charcoal.
Order before October 15 and standard delivery is free. Customers who would rather not put the desk together themselves can add our professional assembly service for $49. Visit brightdesk.example/pro or call 555-0188 to place an order.`,
    questions: [
      { n: 153, text: 'What is a feature of the BrightDesk Pro?', options: ['A built-in lamp', 'Wheels for moving it', 'A ten-year warranty', 'Electric height adjustment'], key: 3,
        explanation: 'Bàn đổi chiều cao bằng động cơ chỉ với một nút bấm (with the touch of a button, quiet motor). Bảo hành là 5 năm, không phải 10 năm.' },
      { n: 154, text: 'The word "backed" in paragraph 2 is closest in meaning to', options: ['supported', 'moved', 'returned', 'reversed'], key: 0,
        explanation: '"Backed by a five-year warranty" nghĩa là được bảo đảm, hỗ trợ bởi chế độ bảo hành 5 năm, nên gần nghĩa nhất là supported.' },
      { n: 155, text: 'What is suggested about the assembly service?', options: ['It is included in every order.', 'It is available only before October 15.', 'It is provided by a partner company.', 'It costs extra and is optional.'], key: 3,
        explanation: 'Khách không muốn tự lắp có thể thêm dịch vụ lắp đặt với giá 49 đô la, tức là dịch vụ tính thêm tiền và không bắt buộc. Mốc 15/10 chỉ áp dụng cho giao hàng miễn phí.' },
    ],
  },
  {
    groupId: 63,
    passage: `TEXT MESSAGE CHAIN
Carla Mendes [9:12 A.M.]: Hi Tom, are you still at the printer's? The brochures for the trade fair need to be at our booth by noon.
Tom Reyes [9:15 A.M.]: Yes, I'm here. The covers are done, but the inside pages are still printing. They say about forty more minutes.
Carla Mendes [9:16 A.M.]: That's cutting it close. The setup crew leaves the warehouse at 11:00.
Tom Reyes [9:18 A.M.]: I could take the first 200 copies now and bring the rest later this morning.
Carla Mendes [9:20 A.M.]: Good idea. Drop the first box at the warehouse so it goes with the crew. I'll tell Ahmed to expect you.
Tom Reyes [9:21 A.M.]: Will do. I'll text you when I'm on my way back.`,
    questions: [
      { n: 156, text: 'Why did Ms. Mendes contact Mr. Reyes?', options: ['To ask about the status of a printing order', 'To change the design of a brochure', 'To cancel a trade fair booth', 'To request directions to a warehouse'], key: 0,
        explanation: 'Cô hỏi Tom có còn ở nhà in không, vì tờ rơi phải có mặt ở gian hàng trước buổi trưa, tức là hỏi tiến độ đơn in.' },
      { n: 157, text: 'At 9:16 A.M., what does Ms. Mendes most likely mean when she writes, "That\'s cutting it close"?', options: ['The brochures cost too much.', 'There may barely be enough time.', 'The printer is located far away.', 'The covers were printed incorrectly.'], key: 1,
        explanation: 'Tom nói còn khoảng 40 phút nữa mới in xong, trong khi đội dựng gian hàng rời kho lúc 11:00. "Cutting it close" nghĩa là sát giờ, gần như không kịp.' },
      { n: 158, text: 'What will Mr. Reyes most likely do next?', options: ['Wait until all the copies are printed', 'Call the setup crew', 'Take some brochures to the warehouse', 'Go directly to the trade fair booth'], key: 2,
        explanation: 'Tom đề nghị mang trước 200 bản, và Carla bảo anh đưa thùng đầu tiên đến kho để đi cùng đội dựng gian hàng; anh trả lời "Will do".' },
    ],
  },
  {
    groupId: 64,
    passage: `EMAIL
From: Northline Supplies <orders@northline.example>
To: Rajiv Patel
Date: Tuesday, May 12
Subject: Your order #8042 has shipped

Dear Mr. Patel,
Thank you for your recent order. Your package containing 12 boxes of printer paper, 4 ink cartridges, and a desk organizer left our warehouse this morning. Standard delivery to your area usually takes two business days, so it should arrive by Thursday, May 14.
Please note that the wireless keyboard you also ordered is temporarily out of stock. It will be sent separately as soon as it arrives from the manufacturer, at no extra shipping cost to you. If you would prefer a refund for this item instead, simply reply to this e-mail.
Once the courier scans your parcel, you will receive a separate message with a tracking link.

Sincerely,
Customer Service, Northline Supplies`,
    questions: [
      { n: 159, text: 'What is the purpose of the e-mail?', options: ['To advertise a new product', 'To request payment for an order', 'To apologize for a damaged parcel', 'To confirm that an order has been sent'], key: 3,
        explanation: 'Tiêu đề và câu đầu cho biết kiện hàng của đơn #8042 đã rời kho sáng nay, tức là xác nhận đơn hàng đã được gửi đi.' },
      { n: 160, text: 'What item is NOT included in the package?', options: ['A wireless keyboard', 'Printer paper', 'Ink cartridges', 'A desk organizer'], key: 0,
        explanation: 'Bàn phím không dây đang tạm hết hàng và sẽ được gửi riêng; giấy in, hộp mực và khay để bàn đều có trong kiện hàng.' },
      { n: 161, text: 'What can Mr. Patel do if he does not want to wait for one item?', options: ['Visit the warehouse', 'Reply to the e-mail', 'Call the courier', 'Change the delivery address'], key: 1,
        explanation: 'Nếu muốn hoàn tiền cho món hàng đang hết thay vì chờ, ông chỉ cần trả lời e-mail này (simply reply to this e-mail).' },
    ],
  },
  {
    groupId: 65,
    passage: `NOTICE
Community Learning Center — Business English Workshop

This Wednesday's evening workshop, "Writing Clear Business E-mails," will be held in Room 204 on the second floor instead of Room 118. Room 118 is being repainted this week and will reopen on Monday.
The workshop will still begin at 6:30 P.M. and end at 8:00 P.M. Participants should bring the worksheet that was sent by e-mail on Monday, as the instructor, Ms. Haruka Sato, will use it throughout the session. Anyone who did not receive the worksheet can pick up a printed copy at the reception desk before class. The elevator is located to the left of the main entrance.`,
    questions: [
      { n: 162, text: 'Why has the workshop been moved?', options: ['More people have registered.', 'The instructor asked for a larger room.', 'Room 118 is being painted.', 'The elevator is out of service.'], key: 2,
        explanation: 'Phòng 118 đang được sơn lại trong tuần này (is being repainted), nên buổi học chuyển sang phòng 204.' },
      { n: 163, text: 'What should participants bring to the workshop?', options: ['A worksheet', 'A laptop', 'A registration fee', 'A copy of a business letter'], key: 0,
        explanation: 'Học viên cần mang theo phiếu bài tập (worksheet) đã gửi qua e-mail hôm thứ Hai, vì giảng viên dùng nó suốt buổi.' },
    ],
  },
  {
    groupId: 66,
    passage: `ARTICLE
Central Library Opens Digital Skills Lab

OAKDALE (April 3) — The Central Library has opened a new digital skills lab on its third floor, giving residents free access to modern computers and training. The lab offers weekly workshops on spreadsheet basics, online safety, and digital design, as well as one-on-one help sessions for job seekers who need to prepare a résumé.
"Many people in our community do not have a computer at home," said library director Helen Brooks. "We want everyone to have the skills that today's employers expect."
Classes are limited to twelve participants so that instructors can give each person individual attention. Registration opens two weeks before each workshop and can be completed online or at the front desk. When no class is in session, library members may use the lab computers for up to two hours a day.
The lab was funded by a grant from the Oakdale Business Association.`,
    questions: [
      { n: 164, text: 'What is the article mainly about?', options: ["A library's new facility", 'A shortage of computers in schools', 'A job fair for local residents', 'The renovation of a business center'], key: 0,
        explanation: 'Bài báo giới thiệu phòng kỹ năng số mới mở ở tầng 3 của thư viện trung tâm.' },
      { n: 165, text: 'According to Ms. Brooks, why was the lab created?', options: ['To attract more library members', 'To help residents gain job-related skills', 'To replace an old computer room', 'To train library staff'], key: 1,
        explanation: 'Bà Brooks nói thư viện muốn mọi người có những kỹ năng mà nhà tuyển dụng ngày nay mong đợi.' },
      { n: 166, text: 'What is suggested about library members?', options: ['They pay a fee to join workshops.', 'They can register only at the front desk.', 'They may use the lab outside class times.', 'They must attend at least one workshop.'], key: 2,
        explanation: 'Khi không có lớp, thành viên thư viện được dùng máy tính trong phòng tối đa hai giờ mỗi ngày. Đăng ký làm được cả trực tuyến lẫn tại quầy.' },
    ],
  },
  {
    groupId: 67,
    passage: `SCHEDULE
Community Business Center — Small Business Day, Wednesday, June 10

9:00–10:00  Starting a Small Business (Room 1) — Dana Kim, business adviser
10:30–11:30  Social Media Basics (Room 3) — Luis Ortega, marketing consultant
12:00–1:00  Lunch Break (Café, ground floor) — included with registration
1:30–2:30  Managing Business Costs (Room 2) — Grace Hall, accountant
3:00–4:30  Networking Workshop (Room 1) — please bring at least 20 business cards

Registration: $25 per person before June 1; $35 from June 1. Seats in each session are limited to 40 and are assigned when participants check in at the front desk.`,
    questions: [
      { n: 167, text: 'Who will most likely lead a session about controlling expenses?', options: ['Dana Kim', 'Luis Ortega', 'Grace Hall', 'The café manager'], key: 2,
        explanation: 'Buổi "Managing Business Costs" (quản lý chi phí) do Grace Hall, một kế toán viên, phụ trách.' },
      { n: 168, text: 'What are participants in the final session asked to bring?', options: ['A laptop', 'Business cards', 'A lunch voucher', 'A registration form'], key: 1,
        explanation: 'Buổi cuối là Networking Workshop, và lịch ghi người tham gia mang theo ít nhất 20 danh thiếp.' },
      { n: 169, text: 'What is indicated about registration?', options: ['It costs less before June 1.', 'It does not include lunch.', 'It must be completed by phone.', 'It is limited to 20 people.'], key: 0,
        explanation: 'Phí đăng ký là 25 đô la trước ngày 1/6 và 35 đô la từ ngày 1/6, nên đăng ký sớm rẻ hơn. Bữa trưa đã gồm trong phí.' },
    ],
  },
  {
    groupId: 68,
    passage: `MEMO
To: All employees, Lakeview Tower
From: Facilities Team
Date: Thursday, September 17
Subject: Water service interruption

Water service on floors 6 through 10 will be shut off from 7:00 P.M. to 10:00 P.M. this Friday while a main valve is replaced. [1] During this time, sinks and restrooms on those floors will not be available. [2]
Employees working late on Friday should use the restrooms on floors 2 through 5. [3] Drinking-water dispensers on all floors will continue to operate normally because they are connected to a separate supply.
The work was originally scheduled for next month, but it has been moved forward after a leak was found during a routine inspection. [4] We apologize for any inconvenience and thank you for your patience.`,
    questions: [
      { n: 170, text: 'What is the purpose of the memo?', options: ['To announce a planned repair', 'To introduce new water dispensers', 'To change office working hours', 'To report the results of a survey'], key: 0,
        explanation: 'Bản ghi nhớ thông báo nước ở tầng 6–10 sẽ bị ngắt tối thứ Sáu để thay van chính, tức là một đợt sửa chữa đã lên kế hoạch.' },
      { n: 171, text: 'Why was the work moved to an earlier date?', options: ['The building is being sold.', 'Employees complained about the water.', 'A contractor became available.', 'A leak was discovered.'], key: 3,
        explanation: 'Công việc vốn dự kiến vào tháng sau nhưng được đẩy sớm lên vì phát hiện rò rỉ trong một lần kiểm tra định kỳ.' },
      { n: 172, text: INSERT('Signs will be posted on the restroom doors of the affected floors as a reminder.'), options: POSITIONS, key: 1,
        explanation: 'Câu này nói về biển báo trên cửa nhà vệ sinh, nên đứng ngay sau câu cho biết bồn rửa và nhà vệ sinh ở các tầng đó không dùng được, tức là vị trí [2].' },
    ],
  },
  {
    groupId: 69,
    passage: `REVIEW
Ocean View Hotel — 4 out of 5 stars
Posted by Marcus Lee, October 22

I stayed at the Ocean View Hotel for three nights while attending a conference at the Harbor Convention Center. The location could hardly be better: the convention center is a ten-minute walk away, and there are several good restaurants nearby.
My room was clean, quiet, and larger than I expected, and the front-desk staff kindly let me check in at 10 A.M., four hours before the usual time. The free Wi-Fi was fast enough for video calls.
My only complaint is breakfast. The dining area is small, and after 8 A.M. it was so crowded that I had to wait for a table on two mornings. I recommend arriving early if you are in a hurry. Overall, I would happily stay here again.`,
    questions: [
      { n: 173, text: 'Why did Mr. Lee stay at the hotel?', options: ['To visit relatives', 'To take a beach vacation', 'To attend a conference', 'To interview for a job'], key: 2,
        explanation: 'Ông Lee ở khách sạn ba đêm trong thời gian dự hội nghị tại Harbor Convention Center.' },
      { n: 174, text: 'What is NOT mentioned as a strength of the hotel?', options: ['Its location', 'The size of the rooms', 'The internet connection', 'The breakfast area'], key: 3,
        explanation: 'Ông khen vị trí, phòng rộng hơn mong đợi và Wi-Fi nhanh; khu ăn sáng là điều duy nhất ông phàn nàn vì nhỏ và đông.' },
      { n: 175, text: 'What does Mr. Lee suggest guests do?', options: ['Check in four hours early', 'Eat breakfast before 8 A.M.', "Use the hotel's shuttle bus", 'Reserve a table at a nearby restaurant'], key: 1,
        explanation: 'Sau 8 giờ sáng khu ăn sáng rất đông, nên ông khuyên ai vội thì nên đến sớm, tức là ăn sáng trước 8 giờ.' },
    ],
  },
];
