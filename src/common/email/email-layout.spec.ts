import { renderEmail } from './email-layout';

describe('renderEmail', () => {
  const base = {
    preheader: 'Xem trước <ngắn>',
    greeting: 'Chào bạn,',
    paragraphs: ['Dòng một & "hai"'],
    signOff: ['Chúc bạn học tốt,', 'Đội ngũ BreadTrans'],
    footer: 'Email tự động.',
  };

  it('escapes every text and the button address', () => {
    const html = renderEmail({
      ...base,
      action: {
        label: 'Mở <trang>',
        url: 'https://app.example.com/plans?a=1&b="2"',
      },
    });
    expect(html).toContain('Xem trước &lt;ngắn&gt;');
    expect(html).toContain('Dòng một &amp; &quot;hai&quot;');
    expect(html).toContain('Mở &lt;trang&gt;');
    expect(html).toContain(
      'href="https://app.example.com/plans?a=1&amp;b=&quot;2&quot;"',
    );
    expect(html).not.toContain('<trang>');
  });

  it('writes the button address out as a plain link too, and signs off on two lines', () => {
    const html = renderEmail({
      ...base,
      action: { label: 'Gia hạn', url: 'https://app.example.com/plans' },
    });
    expect(html).toContain('Nếu nút trên không mở được');
    expect(
      html.match(/href="https:\/\/app\.example\.com\/plans"/g),
    ).toHaveLength(2);
    expect(html).toContain('Chúc bạn học tốt,<br>Đội ngũ BreadTrans');
  });

  it('has no button block without an action', () => {
    expect(renderEmail(base)).not.toContain('Nếu nút trên không mở được');
  });
});
