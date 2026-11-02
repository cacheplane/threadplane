import { parseEml } from './growth-linkedin-eml.mts';

describe('parseEml', () => {
  test('reads a plain message with folded headers', () => {
    const r = parseEml(
      'From: A <a@b.c>\r\nSubject: hi\r\n there\r\nContent-Type: text/plain\r\n\r\nbody'
    );
    expect(r).toMatchObject({
      from: 'A <a@b.c>',
      subject: 'hi there',
      text: 'body',
      html: null,
    });
  });

  test('picks text and html parts from multipart, decoding quoted-printable', () => {
    const raw = [
      'From: a@b.c',
      'Content-Type: multipart/alternative; boundary="XX"',
      '',
      '--XX',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'caf=C3=A9 =3D ok',
      '--XX',
      'Content-Type: text/html',
      '',
      '<p>x</p>',
      '--XX--',
    ].join('\n');
    expect(parseEml(raw)).toMatchObject({
      text: 'café = ok',
      html: '<p>x</p>',
    });
  });

  test('returns null for unreadable input', () => {
    expect(parseEml('no headers here')).toBeNull();
  });
});
