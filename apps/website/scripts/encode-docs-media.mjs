import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const stamp = (time) =>
  new Date(Math.round(time * 1000)).toISOString().slice(11, 23);
/** Validates captions against actual encoded footage before writing any public assets. */
export function validateCues(cues, duration) {
  let previous = 0;
  assert(
    cues.length > 0 && Number.isFinite(duration) && duration > 0,
    'Caption timeline is required'
  );
  for (const cue of cues) {
    assert(
      Number.isFinite(cue.from) &&
        Number.isFinite(cue.to) &&
        cue.from >= previous &&
        cue.to > cue.from &&
        cue.to <= duration,
      'Caption interval is outside footage'
    );
    assert(
      cue.text.trim() && cue.text.length / (cue.to - cue.from) <= 20,
      'Caption is too fast to read'
    );
    previous = cue.to;
  }
}

/** Encodes actual captured frames, then stages the complete accessible asset set. */
export function encodeDocsMedia({ root, raw, captureDir, metadata }) {
  const staged = join(captureDir, 'encoded');
  mkdirSync(staged, { recursive: true });
  const commands = [];
  const run = (args) => {
    commands.push(args);
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
  };
  const duration = metadata.edits.trimEnd - metadata.edits.trimStart;
  const input = [
    '-ss',
    String(metadata.edits.trimStart),
    '-i',
    raw,
    '-t',
    String(duration),
    '-an',
    '-vf',
    'fps=25,format=yuv420p',
  ];
  run([
    ...input,
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-movflags',
    '+faststart',
    join(staged, metadata.id + '.mp4'),
  ]);
  run([
    ...input,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-cpu-used',
    '4',
    join(staged, metadata.id + '.webm'),
  ]);
  const encodedDuration = Number(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        join(staged, metadata.id + '.mp4'),
      ],
      { encoding: 'utf8' }
    ).trim()
  );
  const cues = metadata.phases.map((phase, index) => ({
    from: Math.round(phase.time * 1000) / 1000,
    to: Math.min(
      encodedDuration,
      Math.round((metadata.phases[index + 1]?.time ?? encodedDuration) * 1000) /
        1000
    ),
    text: phase.text,
  }));
  validateCues(cues, encodedDuration);
  run([
    '-ss',
    String(Math.max(0, encodedDuration - 2)),
    '-i',
    join(staged, metadata.id + '.mp4'),
    '-frames:v',
    '1',
    join(staged, metadata.id + '-poster.png'),
  ]);
  for (const extension of ['mp4', 'webm'])
    run(['-i', join(staged, metadata.id + '.' + extension), '-f', 'null', '-']);
  writeFileSync(
    join(staged, metadata.id + '.vtt'),
    'WEBVTT\n\n' +
      cues
        .map((cue) => `${stamp(cue.from)} --> ${stamp(cue.to)}\n${cue.text}\n`)
        .join('\n')
  );
  writeFileSync(
    join(staged, metadata.id + '-transcript.txt'),
    `${metadata.id}\n\n${
      metadata.sourceDescription
    }\nFootage runs at actual speed; initial page loading is trimmed. No narration.\n\nInput: ${
      metadata.input
    }\n\n${cues
      .map((cue) => `${stamp(cue.from)} ${cue.text}`)
      .join('\n')}\n\nFinal visible result:\n${metadata.finalText}\n`
  );
  const assets = ['mp4', 'webm', 'vtt', '-poster.png', '-transcript.txt'].map(
    (extension) =>
      metadata.id + (extension.startsWith('-') ? '' : '.') + extension
  );
  const publicMetadata = {
    ...metadata,
    duration: encodedDuration,
    captions: cues,
    ffmpeg: {
      version: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split(
        '\n'
      )[0],
      commands: commands.map((args) =>
        args.map((arg) =>
          arg === raw
            ? '<raw-capture.webm>'
            : arg.replaceAll(captureDir, '<capture-directory>')
        )
      ),
    },
    assets: Object.fromEntries(
      assets.map((name) => [
        name,
        {
          sha256: createHash('sha256')
            .update(readFileSync(join(staged, name)))
            .digest('hex'),
          bytes: readFileSync(join(staged, name)).length,
        },
      ])
    ),
  };
  writeFileSync(
    join(staged, metadata.id + '-capture.json'),
    JSON.stringify(publicMetadata, null, 2) + '\n'
  );
  const destination = join(root, 'apps/website/public/media/docs');
  mkdirSync(destination, { recursive: true });
  for (const name of [...assets, metadata.id + '-capture.json'])
    copyFileSync(join(staged, name), join(destination, name));
}
