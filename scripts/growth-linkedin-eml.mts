import type { LinkedInParserInput } from '../libs/growth/src/index.ts';

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name) || name in headers) continue;
    headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}

function splitMessage(raw: string): [string, string] | null {
  const match = /\r?\n\r?\n/.exec(raw);
  const head = match ? raw.slice(0, match.index) : raw;
  if (!/^[A-Za-z0-9-]+:/.test(head)) return null;
  return [head, match ? raw.slice(match.index + match[0].length) : ''];
}

function decodeBody(body: string, encoding: string | undefined): string {
  const mode = (encoding ?? '').trim().toLowerCase();
  if (mode === 'quoted-printable') {
    const bytes: number[] = [];
    const joined = body.replace(/=\r?\n/g, '');
    for (let index = 0; index < joined.length; index += 1) {
      const hex = /^=([0-9A-Fa-f]{2})/.exec(joined.slice(index, index + 3));
      if (hex) {
        bytes.push(parseInt(hex[1], 16));
        index += 2;
      } else {
        bytes.push(...Buffer.from(joined[index], 'utf8'));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  if (mode === 'base64') {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  return body;
}

export function parseEml(raw: string): LinkedInParserInput | null {
  const split = splitMessage(raw);
  if (!split) return null;
  const headers = parseHeaderBlock(split[0]);
  const contentType = headers['content-type'] ?? 'text/plain';
  let text: string | null = null;
  let html: string | null = null;

  const assign = (
    type: string,
    partHeaders: Record<string, string>,
    body: string
  ): void => {
    const decoded = decodeBody(body, partHeaders['content-transfer-encoding']);
    if (/^text\/plain/i.test(type) && text === null) text = decoded.trim();
    else if (/^text\/html/i.test(type) && html === null) html = decoded.trim();
  };

  if (/^multipart\//i.test(contentType)) {
    const boundary = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
    const token = boundary?.[1] ?? boundary?.[2];
    if (!token) return null;
    for (const part of split[1].split(`--${token}`).slice(1)) {
      if (part.startsWith('--')) break;
      const partSplit = splitMessage(part.replace(/^\r?\n/, ''));
      if (!partSplit) continue;
      const partHeaders = parseHeaderBlock(partSplit[0]);
      assign(
        partHeaders['content-type'] ?? 'text/plain',
        partHeaders,
        partSplit[1]
      );
    }
  } else {
    assign(contentType, headers, split[1]);
  }
  return {
    from: headers['from'] ?? '',
    subject: headers['subject'] ?? null,
    text,
    html,
    headers,
  };
}
