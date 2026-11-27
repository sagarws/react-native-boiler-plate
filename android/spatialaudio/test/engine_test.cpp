// Desktop verification of the spatial audio engine: builds the same
// src/main/cpp/engine sources with the host compiler, checks the acoustic
// behaviour with measurements (ITD, ILD, spectra, levels, clicks), times the
// CPU cost and renders demo WAVs into test/out/. Run: make -C test run
#include <sys/stat.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <complex>
#include <cstdarg>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "spatial_engine.h"

using namespace sa;

namespace {

constexpr int kFs = 48000;
constexpr int kBlock = 256;
int gFails = 0;

void report(bool ok, const char* name, const char* fmt, ...) {
  if (!ok) ++gFails;
  std::printf("%s  %-34s ", ok ? "PASS" : "FAIL", name);
  va_list args;
  va_start(args, fmt);
  std::vprintf(fmt, args);
  va_end(args);
  std::printf("\n");
}

struct Params {
  float v[kParamCount];
  Params() { defaultParams(v); }
  float& operator[](int i) { return v[i]; }
};

// A single still source with no room, reverb or bed: isolates the HRTF.
Params cleanParams() {
  Params p;
  p[kQuality] = 2;
  p[kPattern] = kStatic;
  p[kRpm] = 0;
  p[kReverbMix] = 0;
  p[kRoomDepth] = 0;
  p[kSurround] = 0;
  p[kEcho] = 0;
  return p;
}

std::vector<float> noise(int frames, int ch, float amp, uint32_t seed = 1) {
  Lcg rng;
  rng.s = seed;
  std::vector<float> v(size_t(frames) * size_t(ch));
  for (float& x : v) x = amp * rng.next();
  return v;
}

// Runs interleaved input through a fresh engine in kBlock blocks; `hook` may
// change parameters before each block (it gets the frame offset).
template <class Hook>
std::vector<float> render(const std::vector<float>& in, int ch, Params p, Hook hook, int fs = kFs) {
  auto e = std::make_unique<Engine>(fs);
  e->setParams(p.v, kParamCount);
  const int frames = int(in.size()) / ch;
  std::vector<float> out(size_t(frames) * 2);
  for (int off = 0; off < frames; off += kBlock) {
    const int n = std::min(kBlock, frames - off);
    if (hook(off, p, *e)) e->setParams(p.v, kParamCount);
    e->process(&in[size_t(off) * size_t(ch)], ch, &out[size_t(off) * 2], n, true);
  }
  return out;
}

std::vector<float> render(const std::vector<float>& in, int ch, const Params& p) {
  return render(in, ch, p, [](int, Params&, Engine&) { return false; });
}

std::vector<float> channel(const std::vector<float>& st, int c, int from = 0, int to = -1) {
  const int frames = int(st.size()) / 2;
  if (to < 0 || to > frames) to = frames;
  std::vector<float> v;
  for (int i = from; i < to; ++i) v.push_back(st[size_t(i) * 2 + size_t(c)]);
  return v;
}

double rms(const std::vector<float>& v) {
  double s = 0;
  for (float x : v) s += double(x) * x;
  return std::sqrt(s / double(std::max<size_t>(v.size(), 1)));
}

double db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }

void fft(std::vector<std::complex<double>>& a) {
  const size_t n = a.size();
  for (size_t i = 1, j = 0; i < n; ++i) {
    size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(a[i], a[j]);
  }
  for (size_t len = 2; len <= n; len <<= 1) {
    const double ang = -2.0 * M_PI / double(len);
    const std::complex<double> wl(std::cos(ang), std::sin(ang));
    for (size_t i = 0; i < n; i += len) {
      std::complex<double> w(1);
      for (size_t k = 0; k < len / 2; ++k) {
        const auto u = a[i + k], t = w * a[i + k + len / 2];
        a[i + k] = u + t;
        a[i + k + len / 2] = u - t;
        w *= wl;
      }
    }
  }
}

// Welch power spectrum, Hann window, 4096 points.
std::vector<double> psd(const std::vector<float>& x) {
  const size_t n = 4096;
  std::vector<double> acc(n / 2 + 1, 0.0);
  std::vector<std::complex<double>> buf(n);
  for (size_t start = 0; start + n <= x.size(); start += n / 2) {
    for (size_t i = 0; i < n; ++i) buf[i] = x[start + i] * (0.5 - 0.5 * std::cos(2 * M_PI * double(i) / double(n)));
    fft(buf);
    for (size_t i = 0; i <= n / 2; ++i) acc[i] += std::norm(buf[i]);
  }
  return acc;
}

double binHz(size_t i) { return double(i) * kFs / 4096.0; }

double bandPowerDb(const std::vector<double>& p, double f1, double f2) {
  double s = 0;
  for (size_t i = 0; i < p.size(); ++i)
    if (binHz(i) >= f1 && binHz(i) < f2) s += p[i];
  return 10.0 * std::log10(s + 1e-30);
}

double centroid(const std::vector<double>& p) {
  double num = 0, den = 0;
  for (size_t i = 1; i < p.size(); ++i) {
    num += binHz(i) * p[i];
    den += p[i];
  }
  return num / den;
}

// Mean |dB difference| over third-octave bands in [f1, f2].
double spectralDiffDb(const std::vector<double>& a, const std::vector<double>& b, double f1, double f2) {
  double sum = 0;
  int count = 0;
  for (double f = f1; f < f2; f *= std::pow(2.0, 1.0 / 3.0)) {
    const double hi = f * std::pow(2.0, 1.0 / 3.0);
    sum += std::fabs(bandPowerDb(a, f, hi) - bandPowerDb(b, f, hi));
    ++count;
  }
  return sum / count;
}

// Lag (ms) maximising sum a[n] b[n-k]; positive = a lags b. Parabolic refinement.
double xcorrLagMs(const std::vector<float>& a, const std::vector<float>& b, int maxLag) {
  std::vector<double> c(size_t(2 * maxLag + 1));
  for (int k = -maxLag; k <= maxLag; ++k) {
    double s = 0;
    for (size_t n = size_t(maxLag); n + size_t(maxLag) < a.size(); ++n) s += double(a[n]) * b[size_t(int(n) - k)];
    c[size_t(k + maxLag)] = s;
  }
  const size_t best = size_t(std::max_element(c.begin(), c.end()) - c.begin());
  double frac = 0;
  if (best > 0 && best + 1 < c.size()) {
    const double y0 = c[best - 1], y1 = c[best], y2 = c[best + 1];
    frac = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
  }
  return (double(best) - maxLag + frac) * 1000.0 / kFs;
}

void testItdIld() {
  const auto in = noise(kFs, 1, 0.3f);
  for (int side : {1, -1}) {
    Params p = cleanParams();
    p[kAzimuth] = 90.f * float(side);
    const auto out = render(in, 1, p);
    const auto l = channel(out, 0, kFs / 10), r = channel(out, 1, kFs / 10);
    // Positive lag of L against R = the right ear leads.
    const double itd = xcorrLagMs(l, r, kFs * 3 / 2000) * side;
    const double ild = (bandPowerDb(psd(side > 0 ? r : l), 3000, 20000) - bandPowerDb(psd(side > 0 ? l : r), 3000, 20000));
    char name[64];
    std::snprintf(name, sizeof name, "ITD source %+d deg", 90 * side);
    report(itd >= 0.6 && itd <= 0.7, name, "near ear leads by %.3f ms (want 0.6-0.7)", itd);
    std::snprintf(name, sizeof name, "ILD >3 kHz source %+d deg", 90 * side);
    report(ild > 6.0, name, "near ear louder by %.1f dB (want > 6)", ild);
  }
}

std::vector<double> earSpectrum(float az, float el, int ear) {
  Params p = cleanParams();
  p[kAzimuth] = az;
  p[kElevation] = el;
  p[kFrontRear] = 1;
  const auto out = render(noise(2 * kFs, 1, 0.3f), 1, p);
  return psd(channel(out, ear, kFs / 10));
}

void testFrontBackElevation() {
  const auto front = earSpectrum(0, 0, 0), back = earSpectrum(180, 0, 0);
  const double fb = spectralDiffDb(front, back, 3000, 10000);
  report(fb > 1.0, "front (0) vs back (180) 3-10 kHz", "mean third-octave |diff| %.2f dB, back band level %+.2f dB vs front", fb,
         bandPowerDb(back, 3000, 10000) - bandPowerDb(front, 3000, 10000));
  const auto up = earSpectrum(0, 60, 0);
  const double ud = spectralDiffDb(front, up, 3000, 10000);
  report(ud > 1.0, "elevation +60 vs 0 3-10 kHz", "mean third-octave |diff| %.2f dB", ud);
}

void testDistance() {
  // 0.3 s burst then silence: burst window = direct sound, tail = reverb.
  // SURROUND 0: the virtual speaker bed is a fixed ambience layer, not the source.
  auto in = noise(2 * kFs, 2, 0.3f);
  std::fill(in.begin() + 2 * (kFs * 3 / 10), in.end(), 0.f);
  struct Result {
    double level, centroid, tail;
  } res[2];
  const float dists[2] = {0.1f, 1.0f};
  for (int i = 0; i < 2; ++i) {
    Params p;  // default room depth and reverb
    p[kQuality] = 2;
    p[kPattern] = kStatic;
    p[kAzimuth] = 30;
    p[kSurround] = 0;
    p[kDistance] = dists[i];
    const auto out = render(in, 2, p);
    std::vector<float> burst = channel(out, 0, kFs / 20, kFs * 3 / 10), tail = channel(out, 0, kFs * 3 / 10 + kFs / 12, kFs * 3 / 2);
    const auto burstR = channel(out, 1, kFs / 20, kFs * 3 / 10), tailR = channel(out, 1, kFs * 3 / 10 + kFs / 12, kFs * 3 / 2);
    burst.insert(burst.end(), burstR.begin(), burstR.end());
    tail.insert(tail.end(), tailR.begin(), tailR.end());
    res[i] = {db(rms(burst)), centroid(psd(burst)), db(rms(tail))};
  }
  report(res[1].level < res[0].level - 6, "distance: far quieter", "near %.1f dB, far %.1f dB", res[0].level, res[1].level);
  report(res[1].centroid < res[0].centroid * 0.85, "distance: far darker", "spectral centroid near %.0f Hz, far %.0f Hz", res[0].centroid,
         res[1].centroid);
  report(res[1].tail > res[0].tail + 1, "distance: far has more reverb", "tail level near %.1f dB, far %.1f dB (direct-to-reverb %.1f vs %.1f dB)",
         res[0].tail, res[1].tail, res[0].level - res[0].tail, res[1].level - res[1].tail);
}

// Largest |second difference| relative to the peak: a sine has ~(2 pi f / fs)^2,
// a click or step shows up orders of magnitude larger.
double roughness(const std::vector<float>& st, int from, int to, double* maxStep) {
  double d2 = 0, peak = 1e-9, step = 0;
  for (int c = 0; c < 2; ++c)
    for (int i = from + 2; i < to; ++i) {
      const double y0 = st[size_t(i) * 2 + size_t(c)], y1 = st[size_t(i - 1) * 2 + size_t(c)], y2 = st[size_t(i - 2) * 2 + size_t(c)];
      d2 = std::max(d2, std::fabs(y0 - 2 * y1 + y2));
      step = std::max(step, std::fabs(y0 - y1));
      peak = std::max(peak, std::fabs(y0));
    }
  *maxStep = step;
  return d2 / peak;
}

void testRotationAndClicks() {
  const int frames = 12 * kFs;
  std::vector<float> in(size_t(frames) * 2);
  for (int i = 0; i < frames; ++i) in[size_t(i) * 2] = in[size_t(i) * 2 + 1] = 0.4f * float(std::sin(2 * M_PI * 220.0 * i / kFs));
  Params p;
  p[kQuality] = 2;
  p[kPattern] = kCircleCw;
  p[kRpm] = 30;
  std::vector<float> az;
  double maxAdvance = 0, minAdvance = 1e9;
  const int changeAt = 4 * kFs;
  int changes = 0;
  const auto out = render(in, 2, p, [&](int off, Params& q, Engine& e) {
    float st[kStateCount];
    e.state(st, kStateCount);
    if (off > kFs / 2 && off < changeAt) {
      if (!az.empty()) {
        double d = st[0] - az.back();
        if (d < -180) d += 360;
        maxAdvance = std::max(maxAdvance, d);
        minAdvance = std::min(minAdvance, d);
      }
      az.push_back(st[0]);
    }
    // After 4 s: change motion, position and mode parameters every 0.25 s.
    if (off < changeAt || (off / kBlock) % (kFs / 4 / kBlock) != 0) return false;
    ++changes;
    const int k = changes;
    q[kRpm] = float((k * 17) % 61);
    q[kPattern] = float(k % kPatternCount);
    q[kAzimuth] = (k & 1) ? 180.f : -60.f;
    q[kElevation] = (k % 3 == 0) ? 60.f : -30.f;
    q[kDistance] = (k & 2) ? 0.0f : 1.0f;
    q[kSourceMode] = float(k % 3);
    q[kQuality] = float(k % 3);
    q[kSurround] = (k & 4) ? 1.f : 0.f;
    q[kMoveIntensity] = (k & 8) ? 0.2f : 1.f;
    q[kEnabled] = (k % 5 == 4) ? 0.f : 1.f;
    q[kHrtf] = (k & 1) ? 0.4f : 1.f;
    q[kWidth] = float(k % 3) * 0.9f;
    q[kFrontRear] = (k & 2) ? 0.f : 1.f;
    q[kRoomDepth] = (k & 4) ? 1.f : 0.f;
    q[kRoomSize] = (k & 1) ? 1.f : 0.f;
    q[kPredelay] = (k & 2) ? 100.f : 0.f;
    q[kReverbMix] = (k & 4) ? 0.6f : 0.1f;
    q[kReverbDecay] = (k & 8) ? 8.f : 0.5f;
    q[kEcho] = (k & 1) ? 0.5f : 0.f;
    q[kEqEnabled] = (k % 7 == 3) ? 0.f : 1.f;
    q[kEq0 + k % kEqBands] = (k & 1) ? 12.f : -12.f;
    q[kPreamp] = (k & 2) ? -6.f : 0.f;
    q[kBass] = (k & 4) ? 9.f : 0.f;
    q[kVocal] = (k & 8) ? 1.f : 0.f;
    q[kWarmth] = (k & 1) ? 1.f : 0.f;
    q[kSmoothing] = (k & 2) ? 1.f : 0.f;
    q[kCompressor] = (k & 4) ? 1.f : 0.f;
    q[kLoudness] = (k & 8) ? 1.f : 0.f;
    q[kOutput] = (k & 1) ? -6.f : 0.f;
    q[kSpeaker0 + k % kSpeakers] = (k & 2) ? 0.f : 1.5f;
    return true;
  });
  report(minAdvance > 0 && maxAdvance < 2.0, "rotation: azimuth advances", "per-block advance %.3f..%.3f deg (30 RPM = %.3f)", minAdvance,
         maxAdvance, 180.0 * kBlock / kFs);
  double stepBase, stepChange;
  const double base = roughness(out, kFs, changeAt, &stepBase);
  const double change = roughness(out, changeAt, frames, &stepChange);
  report(change < 3 * base && stepChange < 0.05, "no clicks while params change",
         "%d changes of ~40 params; max|d2|/peak %.5f vs steady %.5f, max|step| %.4f vs %.4f", changes, change, base, stepChange, stepBase);
}

void testEq() {
  constexpr float kHz[kEqBands] = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
  auto level = [](float hz, int idx, float gain) {
    Params p;
    p[kEnabled] = 0;
    p[kReverbMix] = 0;
    if (idx >= 0) p[idx] = gain;
    const int frames = kFs / 2;
    std::vector<float> in(size_t(frames) * 2);
    for (int i = 0; i < frames; ++i) in[size_t(i) * 2] = in[size_t(i) * 2 + 1] = 0.1f * float(std::sin(2 * M_PI * hz * i / kFs));
    return db(rms(channel(render(in, 2, p), 0, frames / 2)));
  };
  double worst = 0;
  std::string detail;
  for (int b = 0; b < kEqBands; ++b) {
    const double flat = level(kHz[b], -1, 0);
    for (float g : {9.f, -9.f}) {
      const double err = level(kHz[b], kEq0 + b, g) - flat - g;
      worst = std::max(worst, std::fabs(err));
      char buf[48];
      std::snprintf(buf, sizeof buf, " %g:%+.2f", kHz[b], err);
      if (g > 0) detail += buf;
    }
  }
  report(worst <= 0.75, "EQ band gain at centre (+/-9 dB)", "worst error %.3f dB; +9 dB errors:%s", worst, detail.c_str());
  const double bass = level(40, kBass, 9) - level(40, -1, 0);
  report(bass > 6, "BASS shelf +9 dB at 40 Hz", "%+.2f dB", bass);
  const double treble = level(14000, kTreble, 9) - level(14000, -1, 0);
  const double trebleCut = level(14000, kTreble, -9) - level(14000, -1, 0);
  report(treble > 6 && trebleCut < -6, "TREBLE shelf +/-9 dB at 14 kHz", "%+.2f / %+.2f dB", treble, trebleCut);
}

void testLimiter() {
  Params p;
  p[kQuality] = 2;
  p[kPreamp] = 6;
  p[kOutput] = 6;
  p[kBass] = 12;
  p[kTreble] = 12;
  p[kVocal] = 1;
  p[kWarmth] = 1;
  p[kLoudness] = 1;
  p[kWidth] = 2;
  p[kSurround] = 1;
  p[kSourceMode] = 1;
  p[kDistance] = 0;
  p[kReverbMix] = 1;
  p[kEcho] = 1;
  for (int b = 0; b < kEqBands; ++b) p[kEq0 + b] = 12;
  for (int s = 0; s < kSpeakers; ++s) p[kSpeaker0 + s] = 1.5f;
  float gr = 0;
  const auto out = render(noise(10 * kFs, 2, 4.0f), 2, p, [&](int, Params&, Engine& e) {
    float st[kStateCount];
    e.state(st, kStateCount);
    gr = std::max(gr, st[5]);
    return false;
  });
  float peak = 0;
  for (float x : out) peak = std::max(peak, std::fabs(x));
  report(peak <= 0.98f, "limiter ceiling, +12 dB hot input", "max |out| %.5f, reported gain reduction up to %.1f dB", peak, gr);
}

void testParameterEffects() {
  struct Move {
    float to;
    int prereq;
    float prereqValue;
  };
  Move moves[kParamCount];
  const float to[kParamCount] = {0, 0, 90, 45, 0.9f, 7, 40, 0.4f, 1, 0.8f, 0.3f, 1.8f, 0.9f, 0.1f, 0.6f, 6, 1, 0.95f, 0.6f, 80,
                                 -6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 9, 1, 1, 1, 1, 1, 1, -6,
                                 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  for (int i = 0; i < kParamCount; ++i) moves[i] = {to[i], -1, 0};
  moves[kLimiter] = {0, kOutput, 6};       // limiter must be working to matter
  moves[kEqEnabled] = {0, kEq0 + 5, 6};    // EQ must be non-flat to matter
  const char* names[kParamCount] = {"ENABLED", "QUALITY", "AZIMUTH", "ELEVATION", "DISTANCE", "PATTERN", "RPM", "MOVE_INTENSITY",
                                    "SOURCE_MODE", "SURROUND", "HRTF", "WIDTH", "ROOM_DEPTH", "FRONT_REAR", "REVERB_MIX",
                                    "REVERB_DECAY", "ROOM_SIZE", "REVERB_DAMP", "ECHO", "PREDELAY", "PREAMP", "EQ_31", "EQ_62",
                                    "EQ_125", "EQ_250", "EQ_500", "EQ_1k", "EQ_2k", "EQ_4k", "EQ_8k", "EQ_16k", "BASS", "TREBLE",
                                    "VOCAL", "WARMTH", "HARSHNESS", "SMOOTHING", "COMPRESSOR", "LOUDNESS", "OUTPUT", "LIMITER",
                                    "SPEAKER_FL", "SPEAKER_FR", "SPEAKER_SL", "SPEAKER_SR", "SPEAKER_RL", "SPEAKER_RR",
                                    "SPEAKER_UL", "SPEAKER_UR", "EQ_ENABLED"};
  // Music-like level so the limiter is idle at the baseline.
  const auto in = noise(2 * kFs, 2, 0.35f, 7);
  std::printf("\n  idx  parameter        default -> moved   RMS diff vs baseline\n");
  int dead = 0;
  for (int i = 0; i < kParamCount; ++i) {
    Params base;
    base[kQuality] = 2;
    if (moves[i].prereq >= 0) base[moves[i].prereq] = moves[i].prereqValue;
    Params moved = base;
    moved[i] = moves[i].to;
    const auto a = render(in, 2, base), b = render(in, 2, moved);
    double diff = 0, ref = 0;
    for (size_t k = size_t(kFs) / 2 * 2; k < a.size(); ++k) {
      diff += double(a[k] - b[k]) * (a[k] - b[k]);
      ref += double(a[k]) * a[k];
    }
    const double d = 10.0 * std::log10(diff / ref + 1e-30);
    const bool ok = d > -60.0;
    if (!ok) ++dead;
    std::printf("  %3d  %-16s %7.2f -> %-7.2f %8.1f dB%s\n", i, names[i], base[i], moves[i].to, d, ok ? "" : "   <-- no effect");
  }
  report(dead == 0, "every parameter changes the output", "%d of %d parameters below -60 dB", dead, kParamCount);
}

void testIoPaths() {
  const auto mono = noise(kFs, 1, 0.3f, 3);
  std::vector<float> dual(mono.size() * 2);
  for (size_t i = 0; i < mono.size(); ++i) dual[i * 2] = dual[i * 2 + 1] = mono[i];
  Params p;
  p[kQuality] = 2;
  const auto a = render(mono, 1, p), b = render(dual, 2, p);
  float monoDiff = 0;
  for (size_t i = 0; i < a.size(); ++i) monoDiff = std::max(monoDiff, std::fabs(a[i] - b[i]));
  report(monoDiff == 0.f, "mono input == dual-mono stereo", "max diff %.2e", double(monoDiff));

  // In place: input and output are the same buffer.
  const auto st = noise(kFs, 2, 0.3f, 4);
  const auto sep = render(st, 2, p);
  {
    auto e = std::make_unique<Engine>(kFs);
    e->setParams(p.v, kParamCount);
    std::vector<float> buf = st;
    for (int off = 0; off < kFs; off += kBlock) e->process(&buf[size_t(off) * 2], 2, &buf[size_t(off) * 2], std::min(kBlock, kFs - off), true);
    float d = 0;
    for (size_t i = 0; i < buf.size(); ++i) d = std::max(d, std::fabs(buf[i] - sep[i]));
    report(d == 0.f, "in-place buffers", "max diff vs separate buffers %.2e", double(d));
  }

  // 16-bit path against the float path fed the same quantised samples.
  std::vector<int16_t> pcm(st.size());
  std::vector<float> quant(st.size());
  for (size_t i = 0; i < st.size(); ++i) {
    pcm[i] = int16_t(std::lrintf(st[i] * 32767.f));
    quant[i] = float(pcm[i]) / 32768.f;
  }
  const auto fl = render(quant, 2, p);
  auto e = std::make_unique<Engine>(kFs);
  e->setParams(p.v, kParamCount);
  std::vector<int16_t> out(st.size());
  for (int off = 0; off < kFs; off += kBlock) e->process(&pcm[size_t(off) * 2], 2, &out[size_t(off) * 2], std::min(kBlock, kFs - off), false);
  double worst = 0;
  for (size_t i = 0; i < out.size(); ++i) worst = std::max(worst, std::fabs(double(out[i]) - double(fl[i]) * 32767.0));
  report(worst <= 1.0, "16-bit path matches float path", "max diff %.2f LSB", worst);
}

// A UI thread hammering setParams/state/reset while the audio thread runs.
void testConcurrentParams() {
  auto e = std::make_unique<Engine>(kFs);
  std::atomic<bool> done{false};
  std::thread writer([&] {
    Lcg rng;
    float st[kStateCount];
    for (int k = 0; !done.load(); ++k) {
      float v[kParamCount];
      for (int i = 0; i < kParamCount; ++i)
        v[i] = kParamSpecs[i].min + (kParamSpecs[i].max - kParamSpecs[i].min) * (0.5f + 0.5f * rng.next());
      v[kLimiter] = 1;  // so the ceiling is still checkable
      e->setParams(v, k % 2 ? kParamCount : 20);  // short arrays keep the remaining values
      e->state(st, kStateCount);
      if (k % 5000 == 0) e->reset();
    }
  });
  const auto in = noise(5 * kFs, 2, 0.3f, 11);
  std::vector<float> out(in.size());
  for (int off = 0; off < 5 * kFs; off += kBlock) e->process(&in[size_t(off) * 2], 2, &out[size_t(off) * 2], kBlock, true);
  done = true;
  writer.join();
  bool finite = true;
  float peak = 0;
  for (float x : out) {
    finite = finite && std::isfinite(x);
    peak = std::max(peak, std::fabs(x));
  }
  report(finite && peak <= 0.98f, "concurrent setParams/state/reset", "5 s under a writer thread: finite, peak %.3f", peak);
}

void testSampleRates() {
  for (int fs : {22050, 44100, 96000}) {
    Params p;
    p[kQuality] = 2;
    p[kSurround] = 1;
    p[kRoomDepth] = 1;
    p[kRpm] = 60;
    p[kSourceMode] = 1;
    const auto out = render(noise(3 * fs, 2, 0.3f), 2, p, [](int, Params&, Engine&) { return false; }, fs);
    float peak = 0;
    bool finite = true;
    for (float x : out) {
      finite = finite && std::isfinite(x);
      peak = std::max(peak, std::fabs(x));
    }
    char name[48];
    std::snprintf(name, sizeof name, "runs at %d Hz", fs);
    report(finite && peak <= 0.98f && peak > 0.01f, name, "finite, peak %.3f", peak);
  }
}

void testCpu() {
  Params p;
  p[kQuality] = 2;
  p[kPattern] = kRandom3d;
  p[kRpm] = 20;
  p[kSourceMode] = 1;
  p[kSurround] = 1;
  p[kRoomDepth] = 1;
  p[kReverbMix] = 0.4f;
  p[kEcho] = 0.4f;
  p[kBass] = 6;
  p[kTreble] = 3;
  p[kVocal] = 0.5f;
  p[kWarmth] = 0.5f;
  p[kHarshness] = 0.5f;
  p[kSmoothing] = 0.3f;
  p[kCompressor] = 0.5f;
  p[kLoudness] = 0.5f;
  p[kWidth] = 1.3f;
  for (int b = 0; b < kEqBands; ++b) p[kEq0 + b] = float(b % 2 ? 3 : -2);
  const int frames = 60 * kFs;
  const auto in = noise(frames, 2, 0.3f, 9);
  std::vector<float> out(in.size());
  auto e = std::make_unique<Engine>(kFs);
  e->setParams(p.v, kParamCount);
  const auto t0 = std::chrono::steady_clock::now();
  for (int off = 0; off < frames; off += kBlock) e->process(&in[size_t(off) * 2], 2, &out[size_t(off) * 2], kBlock, true);
  const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  const double rtf = 60.0 / sec, us = sec * 1e6 / (frames / kBlock);
  report(rtf > 20, "CPU, 60 s 48 kHz, quality 2, all on", "%.2f s -> %.0fx real time, %.1f us per 256-frame block (budget 5333 us)", sec,
         rtf, us);
}

// ---------- demo renders ----------

void writeWav(const std::string& path, const std::vector<float>& st) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return;
  const uint32_t frames = uint32_t(st.size() / 2), dataBytes = frames * 4, rate = kFs, byteRate = kFs * 4;
  const uint16_t fmt = 1, ch = 2, align = 4, bits = 16;
  const uint32_t riff = 36 + dataBytes, fmtLen = 16;
  std::fwrite("RIFF", 1, 4, f);
  std::fwrite(&riff, 4, 1, f);
  std::fwrite("WAVEfmt ", 1, 8, f);
  std::fwrite(&fmtLen, 4, 1, f);
  std::fwrite(&fmt, 2, 1, f);
  std::fwrite(&ch, 2, 1, f);
  std::fwrite(&rate, 4, 1, f);
  std::fwrite(&byteRate, 4, 1, f);
  std::fwrite(&align, 2, 1, f);
  std::fwrite(&bits, 2, 1, f);
  std::fwrite("data", 1, 4, f);
  std::fwrite(&dataBytes, 4, 1, f);
  for (float x : st) {
    const int16_t s = int16_t(std::lrintf(std::max(-1.f, std::min(1.f, x)) * 32767.f));
    std::fwrite(&s, 2, 1, f);
  }
  std::fclose(f);
}

// 20 s of chords + kick/hat + a formant "voice", all synthesised.
std::vector<float> musicSignal() {
  const int frames = 20 * kFs;
  std::vector<float> st(size_t(frames) * 2, 0.f);
  const float chords[4][3] = {{220.f, 261.63f, 329.63f}, {174.61f, 220.f, 261.63f}, {261.63f, 329.63f, 392.f}, {196.f, 246.94f, 293.66f}};
  Lcg rng;
  BiquadCoefs formant[3];
  BiquadState fs[3];
  const float vowels[2][3] = {{700, 1220, 2600}, {300, 2300, 3000}};  // "ah", "ee"
  BiquadCoefs hatHp = designHighPass(kFs, 7000, 0.7f);
  BiquadState hatS;
  double voicePhase = 0;
  for (int i = 0; i < frames; ++i) {
    const double t = double(i) / kFs;
    const int chord = int(t / 2.5) % 4;
    const double tc = std::fmod(t, 2.5);
    const double env = std::min(1.0, tc / 0.05) * std::exp(-tc * 0.6);
    double l = 0, r = 0;
    for (int v = 0; v < 3; ++v)
      for (int h = 1; h <= 6; ++h) {
        const double f = chords[chord][v] * h;
        l += env * 0.05 / h * std::sin(2 * M_PI * f * 1.002 * t);
        r += env * 0.05 / h * std::sin(2 * M_PI * f * 0.998 * t + v);
      }
    const double tb = std::fmod(t, 0.5);  // kick on the beat
    const double kick = 0.5 * std::exp(-tb * 25) * std::sin(2 * M_PI * (50 * tb + 70 * (1 - std::exp(-tb * 30)) / 30));
    const double th = std::fmod(t + 0.25, 0.5);  // hat on the off-beat
    const double hat = 0.25 * std::exp(-th * 90) * hatS.process(hatHp, rng.next());
    if (i % 4800 == 0) {
      const int vw = int(t / 1.25) % 2;
      for (int k = 0; k < 3; ++k) formant[k] = designBandPass(kFs, vowels[vw][k], 8.f);
    }
    const double pitch = (t < 10 ? 147.0 : 165.0) * (1 + 0.012 * std::sin(2 * M_PI * 5.5 * t));
    voicePhase += pitch / kFs;
    voicePhase -= std::floor(voicePhase);
    const float saw = float(2 * voicePhase - 1);
    float voice = 0;
    for (int k = 0; k < 3; ++k) voice += fs[k].process(formant[k], saw) * (k == 0 ? 1.f : 0.5f);
    const double venv = 0.5 + 0.5 * std::sin(2 * M_PI * t / 5 - M_PI / 2);
    st[size_t(i) * 2] = float(l + kick + hat + 0.35 * venv * voice);
    st[size_t(i) * 2 + 1] = float(r + kick + hat + 0.35 * venv * voice);
  }
  float peak = 0;
  for (float x : st) peak = std::max(peak, std::fabs(x));
  for (float& x : st) x *= 0.5f / peak;
  return st;
}

// Broadband interaural level over a circle on the (bass-heavy) demo music:
// the low-frequency ILD term must make the movement felt, not just the highs.
void testMusicSwing() {
  Params p;
  p[kQuality] = 2;
  p[kRpm] = 12;
  const auto out = render(musicSignal(), 2, p);
  const int win = kFs / 4;
  double lo = 0, hi = 0;
  for (int s = 2 * kFs; s + win <= 12 * kFs; s += win) {
    const double d = db(rms(channel(out, 1, s, s + win))) - db(rms(channel(out, 0, s, s + win)));
    lo = std::min(lo, d);
    hi = std::max(hi, d);
  }
  report(hi >= 5 && lo <= -5, "circle on music: broadband L/R swing", "R-L level %+.1f .. %+.1f dB over 0.25 s windows (want >= +/-5)", lo,
         hi);
}

void renderDemos(const std::string& dir) {
  mkdir(dir.c_str(), 0755);
  const auto music = musicSignal();
  auto none = [](int, Params&, Engine&) { return false; };
  struct Demo {
    const char* file;
    void (*setup)(Params&);
  };
  const Demo demos[] = {
      {"bypass.wav",
       [](Params& p) {
         p[kEnabled] = 0;
         p[kReverbMix] = 0;
       }},
      {"circle.wav",
       [](Params& p) {
         p[kQuality] = 2;
         p[kRpm] = 12;
       }},
      {"front_back.wav",
       [](Params& p) {
         p[kQuality] = 2;
         p[kPattern] = kFrontToBack;
         p[kRpm] = 8;
         p[kFrontRear] = 1;
       }},
      {"concert_hall.wav",
       [](Params& p) {
         p[kQuality] = 2;
         p[kRpm] = 4;
         p[kSurround] = 0.5f;
         p[kRoomDepth] = 0.7f;
         p[kReverbMix] = 0.45f;
         p[kReverbDecay] = 3.5f;
         p[kRoomSize] = 0.95f;
         p[kReverbDamp] = 0.35f;
         p[kPredelay] = 35;
       }},
  };
  for (const Demo& d : demos) {
    Params p;
    d.setup(p);
    writeWav(dir + "/" + d.file, render(music, 2, p, none));
  }
  // Near -> far -> near over the 20 s, source 30 degrees right, static.
  Params p;
  p[kQuality] = 2;
  p[kPattern] = kStatic;
  p[kAzimuth] = 30;
  writeWav(dir + "/near_far.wav", render(music, 2, p, [](int off, Params& q, Engine&) {
             const float t = float(off) / float(10 * kFs);
             q[kDistance] = t < 1.f ? t : 2.f - t;
             return true;
           }));
  writeWav(dir + "/input.wav", music);
  std::printf("\nDemo WAVs written to %s: input, bypass, circle, front_back, near_far, concert_hall\n", dir.c_str());
}

}  // namespace

int main(int argc, char** argv) {
  const std::string outDir = argc > 1 ? argv[1] : "out";
  testItdIld();
  testFrontBackElevation();
  testDistance();
  testRotationAndClicks();
  testEq();
  testLimiter();
  testIoPaths();
  testConcurrentParams();
  testSampleRates();
  testCpu();
  testMusicSwing();
  testParameterEffects();
  renderDemos(outDir);
  std::printf("\n%s: %d failure(s)\n", gFails ? "FAILED" : "ALL PASSED", gFails);
  return gFails ? 1 : 0;
}
