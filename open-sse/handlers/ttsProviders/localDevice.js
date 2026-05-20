// Local device TTS — macOS `say` + Windows SAPI + ffmpeg
// Guard all Node.js-specific imports for Workers compatibility

let _nodeAvailable = false;
let execFileAsync, mkdtemp, readFile, rm, tmpdir, join;

try {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const fsPromises = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  execFileAsync = promisify(execFile);
  mkdtemp = fsPromises.mkdtemp;
  readFile = fsPromises.readFile;
  rm = fsPromises.rm;
  tmpdir = os.tmpdir;
  join = path.join;
  _nodeAvailable = true;
} catch {
  _nodeAvailable = false;
}

let _voicesCache = null;

async function fetchVoicesMac() {
  const { stdout } = await execFileAsync("say", ["-v", "?"]);
  const voices = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^([^\s].*?)\s{2,}([a-z]{2}_[A-Z]{2})/);
    if (!m) continue;
    const name = m[1].trim();
    const locale = m[2].trim();
    const lang = locale.split("_")[0];
    const country = locale.split("_")[1];
    voices.push({ id: name, name, locale, lang, country, gender: "" });
  }
  return voices;
}

async function fetchVoicesWin() {
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$s.GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo;",
    "[PSCustomObject]@{ Name=$v.Name; Culture=$v.Culture.Name; Gender=$v.Gender } }",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true }
  );
  const raw = JSON.parse(stdout.trim() || "[]");
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => {
    const culture = v.Culture || "en-US";
    const [lang, country = ""] = culture.split("-");
    const genderMap = { 1: "Male", 2: "Female", Male: "Male", Female: "Female" };
    return {
      id: v.Name, name: v.Name,
      locale: culture.replace("-", "_"),
      lang, country,
      gender: genderMap[v.Gender] || "",
    };
  });
}

export async function fetchLocalDeviceVoices() {
  if (!_nodeAvailable) return [];
  if (_voicesCache) return _voicesCache;
  try {
    const voices = process.platform === "win32" ? await fetchVoicesWin() : await fetchVoicesMac();
    _voicesCache = voices;
    return voices;
  } catch {
    return [];
  }
}

async function synthesizeMacOrWin(text, voiceId) {
  const dir = await mkdtemp(join(tmpdir(), "tts-"));
  const aiffPath = join(dir, "out.aiff");
  const mp3Path = join(dir, "out.mp3");
  try {
    const args = voiceId ? ["-v", voiceId, "-o", aiffPath, text] : ["-o", aiffPath, text];
    await execFileAsync("say", args);
    await execFileAsync("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-qscale:a", "4", mp3Path]);
    const buf = await readFile(mp3Path);
    return buf.toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default {
  noAuth: true,
  async synthesize(text, model) {
    if (!_nodeAvailable) throw new Error("localDevice TTS requires Node.js runtime (child_process, fs, os)");
    const base64 = await synthesizeMacOrWin(text, model);
    return { base64, format: "mp3" };
  },
};
