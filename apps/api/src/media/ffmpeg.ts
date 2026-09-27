import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** JPEG wants full-range YUV; newer ffmpeg refuses limited range from video sources. */
const JPEG = 'out_range=full,format=yuvj420p';

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.slice(-800)}`)),
    );
  });
}

/** Runs ffmpeg over a buffer in a scratch dir; `outputs` are file names ffmpeg writes, returned as buffers. */
export async function withFfmpeg(
  input: Buffer,
  inExt: string,
  build: (inPath: string, out: (name: string) => string) => string[][],
  outputs: string[],
) {
  const dir = await mkdtemp(join(tmpdir(), 'itp-'));
  try {
    const inPath = join(dir, `in.${inExt}`);
    await writeFile(inPath, input);
    for (const args of build(inPath, (n) => join(dir, n)))
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    const read = await Promise.all(outputs.map((n) => readFile(join(dir, n)).catch(() => null)));
    if (read[0] === null) throw new Error(`ffmpeg produced no ${outputs[0]}`);
    return read.filter((b) => b !== null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Feed rendition: 720p H.264 (short side 720), AAC, faststart, capped at 15 s; plus a poster frame. */
export const transcodeVideo = (buf: Buffer, ext: string) =>
  withFfmpeg(
    buf,
    ext,
    (i, o) => [
      [
        '-i',
        i,
        '-t',
        '15',
        '-vf',
        "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        o('out.mp4'),
      ],
      [
        '-ss',
        '0.5',
        '-i',
        o('out.mp4'),
        '-vf',
        `scale=iw:ih:${JPEG}`,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        o('poster.jpg'),
      ],
    ],
    ['out.mp4', 'poster.jpg'],
  );

/** Photo rendition: JPEG, long side at most 1440 px (also normalizes HEIC/PNG for the feed). */
export const transcodePhoto = (buf: Buffer, ext: string, maxPx = 1440) =>
  withFfmpeg(
    buf,
    ext,
    (i, o) => [
      [
        '-i',
        i,
        '-vf',
        `scale='min(${maxPx},iw)':'min(${maxPx},ih)':force_original_aspect_ratio=decrease:${JPEG}`,
        '-q:v',
        '3',
        o('out.jpg'),
      ],
    ],
    ['out.jpg'],
  );

/** Ambient clip: ~3 s AAC in an m4a container. */
export const transcodeAudio = (buf: Buffer, ext: string) =>
  withFfmpeg(
    buf,
    ext,
    (i, o) => [['-i', i, '-t', '4', '-vn', '-c:a', 'aac', '-b:a', '96k', o('out.m4a')]],
    ['out.m4a'],
  );

/** Up to three frames (first, then every 150th: ~5 s apart at 30 fps) for the safety check; a short clip yields just the first. */
export const videoFrames = (buf: Buffer, ext: string) =>
  withFfmpeg(
    buf,
    ext,
    (i, o) => [
      [
        '-i',
        i,
        '-vf',
        `select='not(mod(n,150))',scale=512:-2:${JPEG}`,
        '-fps_mode',
        'vfr',
        '-frames:v',
        '3',
        o('f%d.jpg'),
      ],
    ],
    ['f1.jpg', 'f2.jpg', 'f3.jpg'],
  );

/** Public keys are unguessable: the CDN serves them without signing. */
export const renditionKey = (ext: string) => `r/${randomBytes(16).toString('hex')}.${ext}`;
