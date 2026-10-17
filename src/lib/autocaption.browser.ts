// Browser side of automatic captions: decode the video's audio locally, send short
// 16 kHz WAV pieces to the server for speech recognition, then build a timed VTT track.
import { buildAutoVtt, MAX_AUTO_SECONDS, segmentWindows, type Segment } from "./autocaption.core";
import { transcribeChunk } from "./api.functions";

const RATE = 16000;

function wav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

const b64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const loud = (x: Float32Array) => { let m = 0; for (let i = 0; i < x.length; i += 50) m = Math.max(m, Math.abs(x[i]!)); return m > 0.01; };

export async function autoCaption(file: File, token: () => Promise<string>, onProgress: (done: number, total: number) => void): Promise<{ vtt: string; cues: number }> {
  const Ctx = window.OfflineAudioContext;
  const raw = await new AudioContext().decodeAudioData(await file.arrayBuffer()).catch(() => null);
  if (!raw) throw new Error("This video's audio couldn't be read in the browser.");
  if (raw.duration > MAX_AUTO_SECONDS) throw new Error("Automatic captions support videos up to 30 minutes.");
  const off = new Ctx(1, Math.ceil(raw.duration * RATE), RATE);
  const src = off.createBufferSource(); src.buffer = raw; src.connect(off.destination); src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const wins = segmentWindows(raw.duration);
  const segs: Segment[] = [];
  for (let i = 0; i < wins.length; i++) {
    const { start, end } = wins[i]!;
    const piece = mono.subarray(Math.floor(start * RATE), Math.floor(end * RATE));
    let text = "";
    if (loud(piece)) {
      const audio = await b64(wav(piece));
      for (let attempt = 0; ; attempt++) {
        try { text = (await transcribeChunk({ data: { token: await token(), audio } })).text; break; }
        catch (e: any) {
          if (attempt >= 3 || !/retry/i.test(e?.message ?? "")) throw e;
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt + Math.random() * 500));
        }
      }
    }
    segs.push({ start, end, text });
    onProgress(i + 1, wins.length);
  }
  const vtt = buildAutoVtt(segs);
  return { vtt, cues: (vtt.match(/-->/g) ?? []).length };
}
