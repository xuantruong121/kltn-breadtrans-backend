/**
 * Content of TOEIC fix batch C (owner approved the scope on 2026-11-06),
 * written by hand for BreadTrans; no generator was used.
 *   Part 3: two three-speaker conversations (W1, M, W2) with one
 *           implied-meaning question each, and three graphic groups (62-70).
 *   Part 4: two graphic groups (95-100).
 *   Part 7: exam 3 176-200 become 2 double and 3 triple sets; exam 1 176-185
 *           become 2 double sets.
 * Group ids and question numbers do not change.
 *
 * Speaker order matters for the voices: the TTS gives voices by order of
 * appearance (female, male, female, male), so every dialogue here opens with
 * a woman, and a three-speaker one runs W1, M, W2.
 */
export type CQuestion = {
  n: number;
  text: string;
  options: [string, string, string, string];
  key: 0 | 1 | 2 | 3;
  explanation: string;
};
export type CGraphic = { title: string; columns: string[]; rows: string[][] };
export type CGroup = {
  examId: number;
  groupId: number;
  part: 3 | 4 | 7;
  kind: 'THREE_SPEAKERS' | 'GRAPHIC' | 'DOUBLE' | 'TRIPLE';
  transcript?: string;
  passage?: string;
  graphic?: CGraphic;
  questions: CQuestion[];
};

export const C_GROUPS: CGroup[] = [
  // ───────────────────────── Exam 3 ─────────────────────────
  {
    examId: 3, groupId: 1045, part: 3, kind: 'THREE_SPEAKERS',
    transcript: `W1: Hi, Tom. Hi, Grace. Thanks for meeting with me. The brochures for the garden show have to be at the printer by Thursday, but the photos still aren't ready.
M: I spoke with the photographer this morning. She said the rain last week delayed the outdoor shoots, so she needs two more days.
W2: Two more days? That would push us past the printer's deadline.
W1: Well, the printer did say they could take the files on Friday if we pay a rush fee.
M: How much is the fee?
W1: About three hundred dollars.
W2: I'm not sure the budget will cover that.
M: Then let's ask the photographer to send whatever shots she has finished today. We can use those for the cover and add the rest to our website later.
W1: Good idea. Tom, could you call her right after this meeting?`,
    questions: [
      { n: 50, text: 'What are the speakers preparing?', options: ['A product catalog', 'A photography class', 'A company website', 'Brochures for a garden show'], key: 3,
        explanation: 'Người phụ nữ thứ nhất nói tập brochure cho triển lãm vườn (the brochures for the garden show) phải gửi nhà in trước thứ Năm.' },
      { n: 51, text: 'Why does the woman say, "I\'m not sure the budget will cover that"?', options: ['To suggest a cheaper printer', 'To express doubt about paying a rush fee', 'To ask for a larger budget', 'To complain about a photographer\'s price'], key: 1,
        explanation: 'Câu này nói ngay sau khi nghe phí in gấp khoảng 300 đô la, nên người phụ nữ nghi ngờ ngân sách đủ trả khoản phí đó.' },
      { n: 52, text: 'What will the man most likely do next?', options: ['Visit the printer', 'Update the website', 'Call the photographer', 'Take some outdoor photos'], key: 2,
        explanation: 'Người phụ nữ nhờ Tom (người đàn ông) gọi cho nhiếp ảnh gia ngay sau cuộc họp.' },
    ],
  },
  {
    examId: 3, groupId: 1047, part: 3, kind: 'THREE_SPEAKERS',
    transcript: `W1: Excuse me, I bought this bookshelf here on Saturday, but two of the shelves are a different color from the rest.
M: I'm sorry about that. Let me check with my manager. Ms. Patel, could you come here for a moment?
W2: Of course. What seems to be the problem?
M: This customer's bookshelf has two shelves in the wrong color.
W2: I see. That model came in a new batch last week, and a few boxes were packed incorrectly. We can give you two replacement shelves today.
W1: That's great, but I came by bus. Those shelves look heavy.
W2: No problem. We deliver free within the city. If you leave your address with Jason, the shelves can be at your door tomorrow morning.
W1: Tomorrow works. Thank you.`,
    questions: [
      { n: 56, text: 'What problem does the customer report?', options: ['A shelf is broken.', 'Some parts are the wrong color.', 'A delivery is late.', 'The instructions are missing.'], key: 1,
        explanation: 'Khách hàng nói hai tấm kệ có màu khác với phần còn lại (a different color from the rest).' },
      { n: 57, text: 'What does the customer imply when she says, "I came by bus"?', options: ['She cannot easily carry the shelves home.', 'She lives far from the store.', 'She arrived at the store late.', 'She wants the store to pay her fare.'], key: 0,
        explanation: 'Cô nói đi xe buýt rồi thêm "những tấm kệ trông nặng", tức là cô khó tự mang kệ về nhà.' },
      { n: 58, text: 'What will the customer most likely do next?', options: ['Pay a delivery charge', 'Return the bookshelf', 'Give her address to an employee', 'Wait for another manager'], key: 2,
        explanation: 'Quản lý bảo khách để lại địa chỉ cho Jason để giao kệ miễn phí vào sáng mai, và khách đồng ý. Việc giao hàng không mất phí.' },
    ],
  },
  {
    examId: 3, groupId: 1049, part: 3, kind: 'GRAPHIC',
    graphic: {
      title: 'Riverside Line — Departures to Westport',
      columns: ['Train', 'Departs', 'Platform'],
      rows: [['214', '8:05', '2'], ['218', '8:40', '4'], ['222', '9:15', '1'], ['226', '9:50', '3']],
    },
    transcript: `W: Hi, Ken. Are you still at the station? The client meeting in Westport starts at eleven.
M: I'm here, but I just missed the eight-oh-five train. The doors closed right as I got to the platform.
W: Oh no. When is the next one?
M: There's one at eight-forty, but the board says it's canceled because of track repairs. So I'll take the one after that.
W: That should still get you there on time. The trip takes about an hour, right?
M: Yes, about an hour. While I wait, could you e-mail me the latest sales figures? I want to review them before the meeting.
W: Sure. I'll send the spreadsheet as soon as I'm back at my desk.`,
    questions: [
      { n: 62, text: 'What problem does the man mention?', options: ['He lost his ticket.', 'He missed a train.', 'He forgot a document.', 'He went to the wrong station.'], key: 1,
        explanation: 'Người đàn ông nói vừa lỡ chuyến tàu 8:05 vì cửa đóng ngay khi anh tới sân ga.' },
      { n: 63, text: 'Look at the graphic. Which platform will the man most likely go to?', options: ['Platform 2', 'Platform 4', 'Platform 1', 'Platform 3'], key: 2,
        explanation: 'Chuyến 8:05 đã lỡ, chuyến 8:40 bị huỷ, nên anh đi chuyến kế tiếp là 9:15. Theo bảng, chuyến 9:15 (tàu 222) xuất phát ở sân ga 1.' },
      { n: 64, text: 'What does the man ask the woman to do?', options: ['Call the client', 'Reschedule the meeting', 'Book a hotel room', 'Send some sales figures'], key: 3,
        explanation: 'Người đàn ông nhờ gửi e-mail số liệu bán hàng mới nhất (the latest sales figures) để xem trước cuộc họp.' },
    ],
  },
  {
    examId: 3, groupId: 1050, part: 3, kind: 'GRAPHIC',
    graphic: {
      title: 'Brightway Printing — Business Card Prices',
      columns: ['Quantity', 'Price'],
      rows: [['100 cards', '$25'], ['250 cards', '$45'], ['500 cards', '$70'], ['1,000 cards', '$120']],
    },
    transcript: `W: Hi, I'd like to order business cards for our new team members. There are five of them.
M: Certainly. How many cards does each person need?
W: Each person needs about two hundred, so a thousand in total.
M: Then you're in luck. This week we're offering free delivery on orders of that size or larger.
W: Great. Our office is across town, so that helps. Can we also add our new logo? The design team just finished it.
M: Of course. Just upload the logo file on our website, and we'll print a sample for you to approve first.
W: Perfect. I'll upload it this afternoon.`,
    questions: [
      { n: 65, text: 'Why is the woman ordering business cards?', options: ['Her company changed its address.', 'She is attending a trade fair.', 'Her old cards were damaged.', 'New employees have joined her team.'], key: 3,
        explanation: 'Người phụ nữ đặt danh thiếp cho các thành viên mới của nhóm (our new team members).' },
      { n: 66, text: 'Look at the graphic. How much will the woman most likely pay for the cards?', options: ['$25', '$45', '$70', '$120'], key: 3,
        explanation: 'Năm người, mỗi người khoảng 200 tấm, tổng cộng 1.000 tấm. Theo bảng giá, 1.000 tấm giá 120 đô la; phí giao hàng được miễn.' },
      { n: 67, text: 'What will the woman do this afternoon?', options: ['Visit the print shop', 'Upload a file', 'Approve a sample', 'Pay for delivery'], key: 1,
        explanation: 'Cô nói sẽ tải tệp logo lên trang web vào chiều nay (I\'ll upload it this afternoon).' },
    ],
  },
  {
    examId: 3, groupId: 1095, part: 3, kind: 'GRAPHIC',
    graphic: {
      title: 'Lakeside Medical Center — Floor Guide',
      columns: ['Floor', 'Department'],
      rows: [['1', 'Reception and Pharmacy'], ['2', 'Radiology'], ['3', 'Physical Therapy'], ['4', 'Administration']],
    },
    transcript: `W: Good morning. I have an appointment for an X-ray at ten thirty, but I'm not sure where to go.
M: X-rays are done in Radiology. You can see it on the floor guide next to the elevators.
W: Thanks. Is it all right if I'm a little early? The traffic was lighter than I expected.
M: That's fine. Just check in at the Radiology desk, and they'll call you when they're ready. Did you bring your insurance card?
W: Oh, I think I left it in my car.
M: Not a problem. You can show it at the reception desk when you leave.`,
    questions: [
      { n: 68, text: 'Why is the woman at the medical center?', options: ['To pick up some medicine', 'To start a new job', 'To have an X-ray', 'To visit a patient'], key: 2,
        explanation: 'Người phụ nữ có lịch chụp X-quang lúc 10 giờ 30.' },
      { n: 69, text: 'Look at the graphic. Which floor will the woman go to?', options: ['Floor 1', 'Floor 2', 'Floor 3', 'Floor 4'], key: 1,
        explanation: 'Chụp X-quang làm ở khoa Radiology. Theo bảng hướng dẫn, Radiology ở tầng 2.' },
      { n: 70, text: 'What did the woman forget?', options: ['Her insurance card', 'Her appointment letter', 'Her car keys', 'Her bus pass'], key: 0,
        explanation: 'Khi được hỏi có mang thẻ bảo hiểm không, cô nói đã để quên trong xe.' },
    ],
  },
  {
    examId: 3, groupId: 1059, part: 4, kind: 'GRAPHIC',
    graphic: {
      title: 'Northfield Small Business Conference — Morning Program',
      columns: ['Time', 'Session', 'Speaker'],
      rows: [['9:00', 'Opening remarks', 'Ruth Adler'], ['10:00', 'Digital marketing trends', 'Lena Ortiz'], ['11:00', 'Building customer loyalty', 'Paul Grant'], ['1:00', 'Social media budgets', 'Mia Chen']],
    },
    transcript: `Good morning, everyone, and welcome to the Northfield Small Business Conference. Before we begin, I have a change to announce. Paul Grant, who was going to speak about customer loyalty, is stuck at the airport because of the snowstorm. Instead, Mia Chen has kindly agreed to give her talk in his time slot, and Mr. Grant will speak after lunch if his flight lands in time. Also, lunch today will be served in the garden tent rather than the main hall, since the hall is being set up for this evening's awards dinner. Finally, please remember to pick up your name badge at the registration table. You'll need it to enter every session today.`,
    questions: [
      { n: 95, text: 'Where is the announcement being made?', options: ['At a business conference', 'At a trade show', 'At an awards dinner', 'At an airport'], key: 0,
        explanation: 'Người nói chào mừng mọi người đến Hội nghị Doanh nghiệp nhỏ Northfield (Northfield Small Business Conference).' },
      { n: 96, text: 'Look at the graphic. What time will Mia Chen most likely speak?', options: ['9:00', '10:00', '11:00', '1:00'], key: 2,
        explanation: 'Mia Chen sẽ nói vào khung giờ của Paul Grant. Theo chương trình, phần của Paul Grant lúc 11:00.' },
      { n: 97, text: 'Why will lunch be served in a tent?', options: ['The weather is warm.', 'The main hall is being prepared for another event.', 'The kitchen is closed.', 'More guests are expected.'], key: 1,
        explanation: 'Hội trường chính đang được chuẩn bị cho tiệc trao giải tối nay, nên bữa trưa chuyển ra lều ngoài vườn.' },
    ],
  },
  {
    examId: 3, groupId: 1063, part: 4, kind: 'GRAPHIC',
    graphic: {
      title: 'Greenleaf Grocery — Daily Specials This Week',
      columns: ['Day', 'Special'],
      rows: [['Monday', 'Fresh bread, 20% off'], ['Tuesday', 'Fruit, 15% off'], ['Wednesday', 'Dairy, 10% off'], ['Thursday', 'Seafood, 25% off']],
    },
    transcript: `Attention, Greenleaf shoppers. Thank you for shopping with us this afternoon. We'd like to remind you about this week's daily specials, which are listed on the signs at every entrance. Because of a problem with one of our delivery trucks, today's seafood discount will be moved to tomorrow, so please check back then. Today we are also opening our new self-checkout area near the pharmacy. Staff members will be there all afternoon to show you how to use the machines. And don't forget, members of our free rewards program earn double points on every purchase this weekend. You can sign up at the customer service desk.`,
    questions: [
      { n: 98, text: 'Why has a discount been moved?', options: ['A delivery truck had a problem.', 'A product sold out.', 'Prices went up.', 'A sign was printed incorrectly.'], key: 0,
        explanation: 'Người nói cho biết một xe giao hàng gặp sự cố (a problem with one of our delivery trucks), nên giảm giá hải sản dời sang ngày mai.' },
      { n: 99, text: 'Look at the graphic. On what day is the announcement most likely being made?', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], key: 3,
        explanation: 'Hôm nay là ngày giảm giá hải sản. Theo bảng, hải sản giảm giá vào thứ Năm.' },
      { n: 100, text: 'What can shoppers do near the pharmacy?', options: ['Sign up for a rewards program', 'Try free samples', 'Collect double points', 'Use new self-checkout machines'], key: 3,
        explanation: 'Khu tự thanh toán mới mở gần quầy thuốc, có nhân viên hướng dẫn cả buổi chiều. Đăng ký thành viên làm ở quầy dịch vụ khách hàng.' },
    ],
  },
  {
    examId: 3, groupId: 1090, part: 7, kind: 'DOUBLE',
    passage: `DOCUMENT 1 — E-MAIL
From: Helen Park <hpark@lindenlaw.com>
To: orders@bluebasilcatering.com
Date: May 12
Subject: Lunch order for May 20

Hello,
Our firm is holding a training day for new staff on Tuesday, May 20, and we would like to order lunch for 18 people. Two of our guests do not eat meat, so please include vegetarian options. Lunch should be delivered to the fourth floor of the Linden Building by 12:15 P.M., because the afternoon session starts at 1:00. Could you also send me your price list?

Helen Park, Office Manager, Linden Law Group

DOCUMENT 2 — E-MAIL
From: Marco Silva <orders@bluebasilcatering.com>
To: Helen Park <hpark@lindenlaw.com>
Date: May 13
Subject: RE: Lunch order for May 20

Dear Ms. Park,
Thank you for your order. Our Classic Lunch costs $16 per person and includes a sandwich, a salad, and a dessert. Our Deluxe Lunch costs $22 per person and adds soup and fresh juice. Both come with vegetarian choices. Please note that we deliver to offices above the second floor only if someone meets our driver at the front entrance of the building. Let me know which lunch you prefer by May 16.

Marco Silva, Blue Basil Catering`,
    questions: [
      { n: 176, text: 'Why did Ms. Park write the e-mail?', options: ['To complain about a delivery', 'To order food for an event', 'To book a training room', 'To apply for a job'], key: 1,
        explanation: 'Bà Park viết để đặt bữa trưa cho 18 người trong ngày đào tạo nhân viên mới.' },
      { n: 177, text: 'What is indicated about the training day?', options: ['It ends at 12:15 P.M.', 'It takes place on a Monday.', 'It includes an afternoon session.', 'It is for 22 people.'], key: 2,
        explanation: 'E-mail thứ nhất nói buổi chiều bắt đầu lúc 1:00 (the afternoon session starts at 1:00). Ngày 20/5 là thứ Ba, và có 18 người.' },
      { n: 178, text: 'What is included in the Deluxe Lunch but not in the Classic Lunch?', options: ['Salad', 'Dessert', 'Sandwiches', 'Soup'], key: 3,
        explanation: 'Deluxe Lunch có thêm súp và nước ép (adds soup and fresh juice) so với Classic Lunch.' },
      { n: 179, text: 'What will Ms. Park\'s firm most likely need to do on May 20?', options: ['Pay the driver in cash', 'Send someone to meet the driver', 'Pick up the food at the restaurant', 'Order extra desserts'], key: 1,
        explanation: 'Câu hỏi kết hợp hai e-mail: đồ ăn giao lên tầng bốn, mà nhà hàng chỉ giao lên trên tầng hai khi có người ra cửa trước đón tài xế.' },
      { n: 180, text: 'By when should Ms. Park choose a lunch?', options: ['May 12', 'May 13', 'May 16', 'May 20'], key: 2,
        explanation: 'Ông Silva đề nghị cho biết loại bữa trưa trước ngày 16/5 (by May 16).' },
    ],
  },
  {
    examId: 3, groupId: 1091, part: 7, kind: 'DOUBLE',
    passage: `DOCUMENT 1 — NOTICE
Westfield Public Library — Meeting Rooms

Library card holders may reserve our meeting rooms free of charge for up to three hours.
Room 1: seats 8, whiteboard
Room 2: seats 20, projector
Room 3: seats 40, projector and sound system
Reservations must be made at least two days in advance. Food and drinks other than bottled water are not allowed in any room.

DOCUMENT 2 — RESERVATION FORM
Name: Daniel Okafor          Library card: Yes
Group: Westfield Photography Club
Date: Saturday, June 7        Time: 10:00 A.M. – 12:00 P.M.
Expected attendance: 15
Equipment needed: Projector, to show members' photos
Comments: We would like to serve coffee and cookies during a short break. Please let me know if this is a problem.`,
    questions: [
      { n: 181, text: 'What is stated about the meeting rooms?', options: ['They are open only on weekends.', 'They must be booked a week ahead.', 'They can be reserved for a full day.', 'Card holders can use them for free.'], key: 3,
        explanation: 'Thông báo ghi người có thẻ thư viện được đặt phòng miễn phí (free of charge), tối đa ba giờ, đặt trước ít nhất hai ngày.' },
      { n: 182, text: 'Which room will Mr. Okafor most likely be given?', options: ['Room 1', 'Room 2', 'Room 3', 'The main reading room'], key: 1,
        explanation: 'Câu lạc bộ có 15 người và cần máy chiếu. Phòng 1 chỉ 8 chỗ, không có máy chiếu; Phòng 2 có 20 chỗ và máy chiếu là phòng vừa nhất.' },
      { n: 183, text: 'Why does the club need a projector?', options: ['To show a film', 'To give a sales presentation', 'To display photographs', 'To hold a video call'], key: 2,
        explanation: 'Phiếu đặt phòng ghi cần máy chiếu để chiếu ảnh của các thành viên (to show members\' photos).' },
      { n: 184, text: 'What part of Mr. Okafor\'s request is not allowed?', options: ['The length of the meeting', 'The number of people', 'The use of a projector', 'Serving coffee and cookies'], key: 3,
        explanation: 'Thông báo cấm đồ ăn và đồ uống trừ nước đóng chai, nên việc mời cà phê và bánh quy không được phép.' },
      { n: 185, text: 'How long will the club meeting last?', options: ['One hour', 'Two hours', 'Three hours', 'Four hours'], key: 1,
        explanation: 'Buổi họp từ 10:00 đến 12:00, tức là hai giờ.' },
    ],
  },
  {
    examId: 3, groupId: 1092, part: 7, kind: 'TRIPLE',
    passage: `DOCUMENT 1 — WEB PAGE
Oakridge Home — Office Chairs
Model A20: Basic chair, black, $89
Model A35: Comfort chair with armrests, black or gray, $129
Model A50: Ergonomic chair with adjustable armrests and neck support, gray only, $199
Free delivery on orders over $150. Assembly service: $25 per chair.

DOCUMENT 2 — ORDER CONFIRMATION
Order number: 58213          Date: September 3
Customer: Priya Nair, Nair Design Studio
Item: Model A35, black, quantity 4 ........ $516
Assembly service: None
Delivery: Free
Expected delivery: September 9

DOCUMENT 3 — E-MAIL
To: support@oakridgehome.com
From: Priya Nair
Date: September 10
Subject: Order 58213

Hello,
My chairs arrived yesterday as promised, but one of the four is gray rather than black. Since our studio uses a black-and-white design, I would like it exchanged. I also realized that putting the chairs together takes longer than I thought. Could your team assemble the replacement chair when it is delivered? I am happy to pay the usual fee.

Priya Nair`,
    questions: [
      { n: 186, text: 'Which chair is available in only one color?', options: ['Model A20 and Model A35', 'Model A35 only', 'Model A20 and Model A50', 'None of the models'], key: 2,
        explanation: 'Model A20 chỉ có màu đen và Model A50 chỉ có màu xám; Model A35 có cả đen và xám.' },
      { n: 187, text: 'Why did Ms. Nair receive free delivery?', options: ['She is a regular customer.', 'She used a coupon.', 'She picked up the chairs herself.', 'Her order was over $150.'], key: 3,
        explanation: 'Trang web miễn phí giao hàng cho đơn trên 150 đô la; đơn của bà Nair là 516 đô la.' },
      { n: 188, text: 'When did the chairs arrive?', options: ['September 3', 'September 8', 'September 9', 'September 10'], key: 2,
        explanation: 'E-mail ngày 10/9 nói ghế đến hôm qua đúng hẹn (arrived yesterday as promised), tức là ngày 9/9, khớp với ngày giao dự kiến.' },
      { n: 189, text: 'What feature does the chair Ms. Nair ordered have?', options: ['Armrests', 'Neck support', 'A gray frame only', 'Locking wheels'], key: 0,
        explanation: 'Bà Nair đặt Model A35, loại ghế có tay vịn (Comfort chair with armrests).' },
      { n: 190, text: 'How much will Ms. Nair most likely pay for the extra service?', options: ['$89', '$129', '$25', '$150'], key: 2,
        explanation: 'Bà nhờ lắp ráp một chiếc ghế thay thế và sẵn lòng trả phí thông thường; phí lắp ráp là 25 đô la mỗi ghế.' },
    ],
  },
  {
    examId: 3, groupId: 1093, part: 7, kind: 'TRIPLE',
    passage: `DOCUMENT 1 — ADVERTISEMENT
Harbor City Food Festival
August 15–17, Pier 9
Taste dishes from more than 60 local restaurants, watch cooking demonstrations, and enjoy live music every evening.
Tickets: one day $12; three days $30. Children under 10 enter free.
Buy your tickets online before August 1 and save 20%.

DOCUMENT 2 — E-MAIL
From: Laura Becker
To: tickets@harborfoodfest.com
Date: July 28

Hello,
I bought two three-day tickets online yesterday for my husband and me. We will also bring our daughter, who is 8. Does she need a ticket? Also, the website says the cooking demonstrations need a separate reservation. How can I reserve seats for Saturday's demonstration?

Laura Becker

DOCUMENT 3 — SCHEDULE
Cooking Demonstrations (reservations at the information tent)
Friday, August 15, 6:00 P.M. — Fresh pasta, Chef Anna Rossi
Saturday, August 16, 2:00 P.M. — Seafood grilling, Chef Ken Ito
Sunday, August 17, 11:00 A.M. — Vietnamese street food, Chef Linh Pham`,
    questions: [
      { n: 191, text: 'What is NOT mentioned as part of the festival?', options: ['Live music', 'Cooking demonstrations', 'Food from local restaurants', 'A baking contest'], key: 3,
        explanation: 'Quảng cáo nêu món ăn của hơn 60 nhà hàng, biểu diễn nấu ăn và nhạc sống; không nhắc đến cuộc thi làm bánh.' },
      { n: 192, text: 'How much did Ms. Becker most likely pay for each ticket?', options: ['$12', '$24', '$30', '$36'], key: 1,
        explanation: 'Vé ba ngày giá 30 đô la. Bà Becker mua trực tuyến ngày 27/7, trước ngày 1/8, nên được giảm 20%: còn 24 đô la mỗi vé.' },
      { n: 193, text: 'What is suggested about Ms. Becker\'s daughter?', options: ['She can enter the festival for free.', 'She needs a one-day ticket.', 'She will cook at the festival.', 'She must reserve her own seat.'], key: 0,
        explanation: 'Con gái bà 8 tuổi; quảng cáo ghi trẻ dưới 10 tuổi được vào cửa miễn phí.' },
      { n: 194, text: 'Which demonstration does Ms. Becker want to attend?', options: ['Fresh pasta', 'Seafood grilling', 'Vietnamese street food', 'Dessert baking'], key: 1,
        explanation: 'Bà muốn đặt chỗ cho buổi biểu diễn ngày thứ Bảy; theo lịch, thứ Bảy 16/8 là buổi nướng hải sản.' },
      { n: 195, text: 'Where can Ms. Becker reserve seats?', options: ['On the festival website', 'By e-mail', 'At the information tent', 'At Pier 7'], key: 2,
        explanation: 'Lịch biểu diễn ghi đặt chỗ tại lều thông tin (reservations at the information tent).' },
    ],
  },
  {
    examId: 3, groupId: 1094, part: 7, kind: 'TRIPLE',
    passage: `DOCUMENT 1 — NOTICE
To all residents of Maple Court Apartments
The water heaters in Building B will be replaced next week. Hot water in Building B will be unavailable from 9:00 A.M. to 3:00 P.M. on the day the work is done on your floor. Residents who need help moving items away from the water heater closets may contact the building office at 555-0148.
— Building Management

DOCUMENT 2 — SCHEDULE
Water heater replacement, Building B
Monday: Floors 1 and 2
Tuesday: Floor 3
Wednesday: Floor 4
Thursday: Floor 5
Friday: Extra day, if needed

DOCUMENT 3 — E-MAIL
To: Maple Court Building Office
From: Samuel Ortiz, Apartment B-402

Hello,
I saw the notice about the water heaters. I work from home, so I will be in my apartment during the work, but I have a large bookcase in front of the closet that I cannot move by myself. Could someone help me with it the day before the work? Thank you.

Samuel Ortiz`,
    questions: [
      { n: 196, text: 'What is the purpose of the notice?', options: ['To announce new rent prices', 'To explain a repair project', 'To introduce a new manager', 'To ask residents to move out'], key: 1,
        explanation: 'Thông báo cho cư dân biết bình nước nóng của tòa B sẽ được thay vào tuần tới.' },
      { n: 197, text: 'What will happen while the work is being done?', options: ['The elevators will stop.', 'Residents must leave the building.', 'The building office will close.', 'Hot water will be unavailable.'], key: 3,
        explanation: 'Thông báo ghi tòa B sẽ không có nước nóng từ 9:00 đến 15:00 vào ngày làm việc ở tầng của mỗi người.' },
      { n: 198, text: 'When will the work be done on Mr. Ortiz\'s floor?', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], key: 2,
        explanation: 'Ông Ortiz ở căn B-402, tức là tầng 4. Theo lịch, tầng 4 làm vào thứ Tư.' },
      { n: 199, text: 'When does Mr. Ortiz want someone to help him?', options: ['Monday', 'Tuesday', 'Wednesday', 'Friday'], key: 1,
        explanation: 'Ông muốn được giúp vào ngày trước khi làm việc ở tầng mình. Tầng 4 làm thứ Tư, nên ngày trước đó là thứ Ba.' },
      { n: 200, text: 'What is indicated about Mr. Ortiz?', options: ['He works from home.', 'He lives on the fifth floor.', 'He is moving out soon.', 'He works for the building office.'], key: 0,
        explanation: 'Ông Ortiz viết "I work from home", nên sẽ ở nhà trong lúc thợ làm việc.' },
    ],
  },

  // ───────────────────────── Exam 1 ─────────────────────────
  {
    examId: 1, groupId: 38, part: 3, kind: 'THREE_SPEAKERS',
    transcript: `W1: Thanks for staying after the staff meeting. Patients keep telling us it's hard to book appointments by phone.
M: That's true. The phone line is busy most mornings, and we only have one receptionist.
W2: What if we let patients book online? The clinic across the street started doing that in the spring.
W1: I like that idea, but I'm worried about the cost.
M: Actually, the scheduling software we already use has an online booking feature. We just never turned it on.
W2: Really? Then it might not cost anything extra.
W1: Let's find out. Ahmed, could you contact the software company this afternoon and ask how to set it up?
M: Sure, I'll call them after lunch.`,
    questions: [
      { n: 50, text: 'Where do the speakers most likely work?', options: ['At a medical clinic', 'At a software company', 'At a call center', 'At a bank'], key: 0,
        explanation: 'Các người nói nhắc tới bệnh nhân (patients), lịch hẹn và lễ tân, nên họ làm ở một phòng khám.' },
      { n: 51, text: 'Why does the woman say, "The clinic across the street started doing that in the spring"?', options: ['To complain about a competitor', 'To show that the idea can work', 'To explain why patients are leaving', 'To recommend a new location'], key: 1,
        explanation: 'Cô vừa đề xuất cho bệnh nhân đặt lịch trực tuyến, rồi dẫn ví dụ phòng khám bên kia đường đã làm như vậy để cho thấy ý tưởng khả thi.' },
      { n: 52, text: 'What will the man do this afternoon?', options: ['Hire a receptionist', 'Update a website', 'Contact a software company', 'Call some patients'], key: 2,
        explanation: 'Người phụ nữ nhờ Ahmed liên hệ công ty phần mềm chiều nay, và anh nói sẽ gọi sau bữa trưa.' },
    ],
  },
  {
    examId: 1, groupId: 40, part: 3, kind: 'THREE_SPEAKERS',
    transcript: `W1: Hi, I'm calling about the book signing with Daniel Brooks on Saturday. Do I need a ticket?
M: No ticket is needed, but space is limited. Let me ask my manager how many seats are left. Rachel?
W2: Hi there. We've had a lot of interest, so most seats are already reserved. We still have about ten left for the two o'clock session.
W1: Two o'clock? I thought it started at eleven.
W2: It did, but Mr. Brooks's train now arrives later than planned, so we moved it.
W1: That's fine. Can I reserve two seats?
W2: Certainly. And if you buy his new novel in advance, you'll also get a free tote bag.
W1: Great. I'll stop by tomorrow to pick up the book.`,
    questions: [
      { n: 56, text: 'What is the woman calling about?', options: ['A job opening', 'A book signing', 'A train schedule', 'A lost item'], key: 1,
        explanation: 'Người phụ nữ gọi hỏi về buổi ký tặng sách của Daniel Brooks vào thứ Bảy.' },
      { n: 57, text: 'Why does the woman say, "I thought it started at eleven"?', options: ['She is surprised that the time has changed.', 'She wants to correct the manager.', 'She is asking for an earlier session.', 'She is explaining why she called late.'], key: 0,
        explanation: 'Cô nghe buổi ký tặng lúc 2 giờ trong khi cô tưởng là 11 giờ, nên câu này thể hiện sự bất ngờ vì giờ đã đổi; quản lý giải thích ngay là đã dời vì tàu của tác giả đến muộn.' },
      { n: 58, text: 'What does the woman say she will do tomorrow?', options: ['Visit the store', 'Call the author', 'Pay for a tote bag', 'Cancel a reservation'], key: 0,
        explanation: 'Cô nói ngày mai sẽ ghé cửa hàng để lấy sách (I\'ll stop by tomorrow to pick up the book). Túi vải được tặng miễn phí.' },
    ],
  },
  {
    examId: 1, groupId: 42, part: 3, kind: 'GRAPHIC',
    graphic: {
      title: 'City Center Garage — Parking Rates',
      columns: ['Time parked', 'Rate'],
      rows: [['Up to 1 hour', '$4'], ['1–3 hours', '$9'], ['3–6 hours', '$15'], ['Over 6 hours', '$20']],
    },
    transcript: `W: Excuse me, I'm here for a job interview at the Pearson Building. Is it all right to park in this garage?
M: Yes, the Pearson Building is right across the street. How long do you expect to stay?
W: The interview is two hours, and then I'm having lunch with a friend nearby, so maybe four hours in total.
M: All right. Just keep your ticket and pay at the machine near the exit when you leave.
W: Does the machine take credit cards?
M: It does. But the elevator to the street is out of service today, so you'll have to use the stairs on the north side.
W: No problem. Thanks for your help.`,
    questions: [
      { n: 62, text: 'Why is the woman visiting the area?', options: ['To meet a client', 'To go shopping', 'To repair an elevator', 'To attend a job interview'], key: 3,
        explanation: 'Người phụ nữ nói cô đến dự phỏng vấn xin việc ở tòa nhà Pearson.' },
      { n: 63, text: 'Look at the graphic. How much will the woman most likely pay for parking?', options: ['$4', '$9', '$15', '$20'], key: 2,
        explanation: 'Cô dự định ở khoảng bốn giờ (phỏng vấn hai giờ rồi ăn trưa). Theo bảng giá, từ 3 đến 6 giờ là 15 đô la.' },
      { n: 64, text: 'What does the man say about the elevator?', options: ['It is very slow.', 'It is not working today.', 'It goes only to the north side.', 'It is for staff only.'], key: 1,
        explanation: 'Người đàn ông nói thang máy ra phố hôm nay ngừng hoạt động (out of service), nên phải đi cầu thang phía bắc.' },
    ],
  },
  {
    examId: 1, groupId: 43, part: 3, kind: 'GRAPHIC',
    graphic: {
      title: 'Meeting Rooms — Thursday',
      columns: ['Room', 'Booked', 'Seats'],
      rows: [['Oak', '9:00–10:30 Marketing', '12'], ['Pine', '9:00–12:00 Training', '20'], ['Cedar', '1:00–3:00 Budget review', '8'], ['Maple', 'Available all day', '10']],
    },
    transcript: `W: Kevin, the clients from Lisbon are coming on Thursday, and we need a room for our presentation in the morning.
M: Let me check the booking system. Most rooms are taken by other teams, but one is free all day.
W: Great. Is it big enough for eight people?
M: It holds ten, so we'll be fine. But it doesn't have a projector.
W: That's OK. I'll bring the portable one from my office. Could you book it from nine to eleven?
M: Done. Should I also order coffee and pastries for the meeting?
W: Yes, please. And ask the café to deliver them by eight forty-five.`,
    questions: [
      { n: 65, text: 'Who is visiting on Thursday?', options: ['A new manager', 'Job applicants', 'Building inspectors', 'Some clients'], key: 3,
        explanation: 'Người phụ nữ nói khách hàng từ Lisbon sẽ đến vào thứ Năm.' },
      { n: 66, text: 'Look at the graphic. Which room will the speakers use?', options: ['Oak', 'Pine', 'Cedar', 'Maple'], key: 3,
        explanation: 'Người đàn ông nói chỉ một phòng trống cả ngày và chứa được mười người. Theo bảng, đó là phòng Maple.' },
      { n: 67, text: 'What will the woman bring to the meeting?', options: ['Coffee and pastries', 'A projector', 'Printed handouts', 'Extra chairs'], key: 1,
        explanation: 'Phòng không có máy chiếu, nên cô sẽ mang máy chiếu di động từ văn phòng mình. Cà phê và bánh do quán cà phê giao.' },
    ],
  },
  {
    examId: 1, groupId: 44, part: 3, kind: 'GRAPHIC',
    graphic: {
      title: 'Swift Courier — Shipping Options',
      columns: ['Service', 'Delivery time', 'Price'],
      rows: [['Economy', '5–7 days', '$8'], ['Standard', '3–4 days', '$12'], ['Express', '2 days', '$20'], ['Overnight', 'Next day', '$35']],
    },
    transcript: `W: Hi, I need to send these product samples to a customer in Denver. They have to arrive before the trade fair starts on Friday.
M: Today is Tuesday, so the two-day service would get them there on Thursday.
W: That works. Is there a cheaper choice that still arrives in time?
M: I'm afraid not. Standard takes three to four days, so it might arrive too late.
W: All right, I'll take the two-day service. And could you add insurance? The samples are quite valuable.
M: Of course. Insurance is an extra five dollars. Please fill out this form with the value of the items.`,
    questions: [
      { n: 68, text: 'What is the woman sending?', options: ['Trade fair tickets', 'Legal documents', 'Product samples', 'A birthday gift'], key: 2,
        explanation: 'Người phụ nữ gửi các mẫu sản phẩm (product samples) cho một khách hàng ở Denver.' },
      { n: 69, text: 'Look at the graphic. How much will the woman pay for shipping, not including insurance?', options: ['$8', '$12', '$20', '$35'], key: 2,
        explanation: 'Cô chọn dịch vụ hai ngày. Theo bảng, dịch vụ hai ngày là Express, giá 20 đô la; bảo hiểm tính thêm 5 đô la riêng.' },
      { n: 70, text: 'What does the man ask the woman to do?', options: ['Pay in cash', 'Fill out a form', 'Come back on Thursday', 'Repack the items'], key: 1,
        explanation: 'Người đàn ông đề nghị cô điền vào mẫu đơn giá trị hàng hoá (fill out this form).' },
    ],
  },
  {
    examId: 1, groupId: 53, part: 4, kind: 'GRAPHIC',
    graphic: {
      title: 'Brookfield — Weekend Weather',
      columns: ['Day', 'Forecast', 'High'],
      rows: [['Friday', 'Sunny', '24°C'], ['Saturday', 'Heavy rain', '18°C'], ['Sunday', 'Cloudy', '20°C'], ['Monday', 'Sunny', '23°C']],
    },
    transcript: `Hello, this is Megan Ross from the Brookfield Parks Department with an update for everyone signed up for this weekend's community clean-up at Riverside Park. As you may know, heavy rain is expected on the day we originally planned, so we've decided to hold the event one day later instead. We'll still meet at the main gate at eight A.M. Gloves, trash bags, and water will be provided, but please wear comfortable shoes. Also, the local café Bean There has offered free breakfast sandwiches to all volunteers, so come a little early if you'd like one. If you can no longer join us on the new day, please reply to this message so we can plan the groups.`,
    questions: [
      { n: 95, text: 'What event is the speaker discussing?', options: ['A sports tournament', 'A café opening', 'A walking tour', 'A park clean-up'], key: 3,
        explanation: 'Người nói thông báo về buổi dọn dẹp cộng đồng ở công viên Riverside (community clean-up).' },
      { n: 96, text: 'Look at the graphic. On what day will the event most likely be held?', options: ['Friday', 'Saturday', 'Sunday', 'Monday'], key: 2,
        explanation: 'Ngày dự định ban đầu có mưa lớn; theo bảng, đó là thứ Bảy. Sự kiện dời lại một ngày, tức là Chủ nhật.' },
      { n: 97, text: 'What does the speaker ask listeners to do if they cannot attend?', options: ['Call the parks department', 'Reply to the message', 'Find a replacement', 'Visit the café'], key: 1,
        explanation: 'Người nói đề nghị ai không tham gia được thì trả lời tin nhắn này (reply to this message).' },
    ],
  },
  {
    examId: 1, groupId: 54, part: 4, kind: 'GRAPHIC',
    graphic: {
      title: 'Harlow Electronics — Customer Service Menu',
      columns: ['Press', 'Department'],
      rows: [['1', 'Order status'], ['2', 'Returns and exchanges'], ['3', 'Technical support'], ['4', 'Billing questions']],
    },
    transcript: `Hi, this is Olivia Grant calling for Mr. Shaw. I'm returning your call about the laptop you bought from our online store last week. I'm sorry to hear that the screen stopped working after only a few days. Because the laptop is still under warranty, we can either repair it or send you a new one. Since repairs can take up to two weeks, I'd recommend a replacement. If you agree, you'll need to speak with the department that handles returns. Just call our main number and choose that option from the menu. Please have your order number ready when you call. Thank you, and again, I apologize for the trouble.`,
    questions: [
      { n: 98, text: 'What problem does the listener have?', options: ['An order was delivered late.', 'He was charged twice.', 'He lost his receipt.', 'A laptop screen stopped working.'], key: 3,
        explanation: 'Người nói nhắc màn hình chiếc laptop ông Shaw mua đã ngừng hoạt động sau vài ngày.' },
      { n: 99, text: 'What does the speaker recommend?', options: ['Waiting for a repair', 'Buying a longer warranty', 'Visiting a store', 'Getting a replacement'], key: 3,
        explanation: 'Vì sửa có thể mất đến hai tuần, người nói khuyên đổi máy mới (I\'d recommend a replacement).' },
      { n: 100, text: 'Look at the graphic. Which number should the listener press?', options: ['1', '2', '3', '4'], key: 1,
        explanation: 'Ông Shaw cần nói chuyện với bộ phận xử lý đổi trả. Theo bảng, phím 2 là Returns and exchanges.' },
    ],
  },
  {
    examId: 1, groupId: 70, part: 7, kind: 'DOUBLE',
    passage: `DOCUMENT 1 — MEMO
To: All employees
From: Rita Gomez, Communications
Date: March 3
Subject: New staff photos

We are updating the staff photos on our company website. A photographer will be in Conference Room C on March 12 and 13 from 9:00 A.M. to 4:00 P.M. Each session takes about ten minutes. Please sign up for a time on the sheet outside my office by March 7. Staff who work at the Elm Street branch will have their photos taken there on March 14.

DOCUMENT 2 — E-MAIL
To: Rita Gomez
From: Victor Lam
Date: March 6
Subject: Photo session

Hi Rita,
I signed up for 10:30 A.M. on March 12, but I just learned that I have to visit a client in Boston that day and the next. Since I will be working at the Elm Street branch on March 14, could I have my photo taken there instead? I have already crossed my name off the sign-up sheet.

Victor`,
    questions: [
      { n: 176, text: 'Why was the memo sent?', options: ['To announce a new website', 'To invite staff to have their photos taken', 'To introduce a new photographer', 'To change a meeting room'], key: 1,
        explanation: 'Bản ghi nhớ thông báo chụp lại ảnh nhân viên cho trang web và mời mọi người đăng ký giờ chụp.' },
      { n: 177, text: 'How long does each photo session take?', options: ['About ten minutes', 'About five minutes', 'About thirty minutes', 'About one hour'], key: 0,
        explanation: 'Bản ghi nhớ ghi mỗi lượt chụp mất khoảng mười phút.' },
      { n: 178, text: 'By when must employees sign up?', options: ['March 3', 'March 6', 'March 7', 'March 12'], key: 2,
        explanation: 'Nhân viên phải đăng ký trên tờ danh sách trước ngày 7/3 (by March 7).' },
      { n: 179, text: 'Why can\'t Mr. Lam keep his appointment?', options: ['He will be on vacation.', 'He is moving to another branch.', 'He has a doctor\'s appointment.', 'He will be visiting a client.'], key: 3,
        explanation: 'Ông Lam phải đi gặp khách hàng ở Boston vào ngày 12 và 13/3.' },
      { n: 180, text: 'What is suggested about Mr. Lam?', options: ['He would like to have his photo taken on March 14.', 'He works in Conference Room C.', 'He is a professional photographer.', 'He missed the sign-up deadline.'], key: 0,
        explanation: 'Kết hợp hai văn bản: chi nhánh Elm Street chụp ngày 14/3, và ông Lam sẽ làm ở đó hôm ấy nên xin chụp ở đó.' },
    ],
  },
  {
    examId: 1, groupId: 71, part: 7, kind: 'DOUBLE',
    passage: `DOCUMENT 1 — ADVERTISEMENT
FreshPress Laundry & Dry Cleaning
210 Grant Avenue
• Same-day service on shirts and trousers dropped off before 9:00 A.M.
• Dry cleaning of suits and dresses: ready in two days
• Free pickup and delivery for orders over $40
• New this month: 15% off curtain cleaning
Open Monday to Saturday, 7:00 A.M. to 7:00 P.M.

DOCUMENT 2 — ONLINE REVIEW
Rating: 4 out of 5 — posted by Hannah Wu
I dropped off five shirts at 8:30 on Monday morning and picked them up clean and pressed that evening. The staff were friendly and even sewed a missing button back on for free. My only complaint is the parking. There are only three spaces in front of the shop, and I had to drive around the block twice. Next time I'll try the pickup service, since my curtain order should be large enough to qualify for it.`,
    questions: [
      { n: 181, text: 'What is NOT offered by FreshPress?', options: ['Same-day shirt cleaning', 'Curtain cleaning', 'Shoe repair', 'Free delivery'], key: 2,
        explanation: 'Quảng cáo nêu giặt áo trong ngày, giặt rèm và giao nhận miễn phí; không có sửa giày.' },
      { n: 182, text: 'When is FreshPress closed?', options: ['On Sundays', 'On Saturday afternoons', 'On Monday mornings', 'On weekday evenings at 6:00'], key: 0,
        explanation: 'Cửa hàng mở từ thứ Hai đến thứ Bảy, nên đóng cửa vào Chủ nhật.' },
      { n: 183, text: 'Why were Ms. Wu\'s shirts ready the same day?', options: ['She paid an extra fee.', 'She dropped them off before 9:00 A.M.', 'She ordered online.', 'She is a regular customer.'], key: 1,
        explanation: 'Bà Wu gửi áo lúc 8:30; quảng cáo ghi áo gửi trước 9:00 sáng được làm trong ngày.' },
      { n: 184, text: 'What did Ms. Wu like about the staff?', options: ['They delivered her order.', 'They gave her a discount.', 'They helped her park.', 'They fixed her shirt at no charge.'], key: 3,
        explanation: 'Nhân viên khâu lại chiếc cúc bị mất miễn phí (sewed a missing button back on for free).' },
      { n: 185, text: 'What is suggested about Ms. Wu\'s curtain order?', options: ['It will cost more than $40.', 'It will be ready the same day.', 'It has already been delivered.', 'It will not receive a discount.'], key: 0,
        explanation: 'Kết hợp hai văn bản: dịch vụ giao nhận miễn phí cho đơn trên 40 đô la, và bà Wu nói đơn rèm đủ lớn để được dịch vụ này.' },
    ],
  },
];
