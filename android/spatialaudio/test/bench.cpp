// Per-stage CPU profile of the engine, built for the host or cross-compiled
// for a phone (make device-bench). It drives the same stage objects in the
// same order as Engine::render, timing each one, and also times the real
// Engine::process end to end. 48 kHz, 16-bit stereo in/out, 256-frame blocks.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "spatial_engine.h"

using namespace sa;

namespace {

constexpr int kFs = 48000;
constexpr int kBlock = 256;
constexpr int kSeconds = 10;

using Clock = std::chrono::steady_clock;

enum Stage { kIo, kEq, kSpatial, kWidth, kReverb, kTone, kLimit, kStages };
const char* kStageNames[kStages] = {"io", "eq", "spatial", "width", "reverb", "tone", "limiter"};

void setFtz() {
#if defined(__aarch64__)
  uint64_t fpcr;
  asm volatile("mrs %0, fpcr" : "=r"(fpcr));
  asm volatile("msr fpcr, %0" : : "r"(fpcr | (uint64_t(1) << 24)));
#endif
}

struct Config {
  const char* name;
  void (*setup)(float*);
};

void runConfig(const Config& c, const std::vector<int16_t>& in) {
  float p[kParamCount];
  defaultParams(p);
  c.setup(p);

  // Stage-by-stage, mirroring Engine::render (width inline, like the engine).
  auto eq = std::make_unique<Equalizer>();
  auto spatial = std::make_unique<SpatialStage>();
  auto reverb = std::make_unique<Reverb>();
  auto tone = std::make_unique<ToneDynamics>();
  auto limiter = std::make_unique<Limiter>();
  eq->prepare(kFs);
  spatial->prepare(kFs);
  reverb->prepare(kFs);
  tone->prepare(kFs);
  limiter->prepare(kFs);
  eq->reset(p);
  spatial->reset(p);
  reverb->reset(p);
  tone->reset(p);
  limiter->reset();
  const int frames = int(in.size() / 2);
  std::vector<int16_t> out(in.size());
  double ns[kStages] = {};
  float L[kChunk], R[kChunk], send[kChunk];
  Ramp width{1.f};
  for (int off = 0; off < frames; off += kChunk) {
    auto t0 = Clock::now();
    for (int i = 0; i < kChunk; ++i) {
      L[i] = float(in[size_t(off + i) * 2]) * (1.f / 32768.f);
      R[i] = float(in[size_t(off + i) * 2 + 1]) * (1.f / 32768.f);
    }
    auto t1 = Clock::now();
    ns[kIo] += double((t1 - t0).count());
    eq->process(L, R, kChunk, p);
    auto t2 = Clock::now();
    ns[kEq] += double((t2 - t1).count());
    spatial->process(L, R, send, kChunk, p);
    auto t3 = Clock::now();
    ns[kSpatial] += double((t3 - t2).count());
    width.to(p[kWidth], kChunk, false);
    if (!width.unity())
      for (int i = 0; i < kChunk; ++i) {
        const float m = 0.5f * (L[i] + R[i]), s = 0.5f * (L[i] - R[i]) * width.at(i);
        L[i] = m + s;
        R[i] = m - s;
      }
    auto t4 = Clock::now();
    ns[kWidth] += double((t4 - t3).count());
    reverb->process(L, R, send, kChunk, p);
    auto t5 = Clock::now();
    ns[kReverb] += double((t5 - t4).count());
    tone->process(L, R, kChunk, p);
    auto t6 = Clock::now();
    ns[kTone] += double((t6 - t5).count());
    limiter->process(L, R, kChunk, p[kLimiter] > 0.5f);
    auto t7 = Clock::now();
    ns[kLimit] += double((t7 - t6).count());
    for (int i = 0; i < kChunk; ++i) {
      out[size_t(off + i) * 2] = int16_t(std::lrintf(clampf(L[i], -1.f, 1.f) * 32767.f));
      out[size_t(off + i) * 2 + 1] = int16_t(std::lrintf(clampf(R[i], -1.f, 1.f) * 32767.f));
    }
    ns[kIo] += double((Clock::now() - t7).count());
  }

  // The real thing, end to end.
  auto e = std::make_unique<Engine>(kFs);
  e->setParams(p, kParamCount);
  const auto t0 = Clock::now();
  for (int off = 0; off < frames; off += kBlock) e->process(&in[size_t(off) * 2], 2, &out[size_t(off) * 2], kBlock, false);
  const double total = double((Clock::now() - t0).count());

  const double blocks = double(frames) / kBlock;
  const double budget = 1e6 * kBlock / kFs;  // us of audio per block
  std::printf("%-22s", c.name);
  for (double v : ns) std::printf(" %7.1f", v / 1e3 / blocks);
  const double us = total / 1e3 / blocks;
  std::printf(" | %7.1f us  %5.1f%% core\n", us, 100.0 * us / budget);
}

}  // namespace

int main() {
  setFtz();
  // Music-like level: pink-ish noise at about -18 dBFS RMS.
  std::vector<int16_t> in(size_t(kFs) * kSeconds * 2);
  Lcg rng;
  float lp[2] = {0, 0};
  for (size_t i = 0; i < in.size(); ++i) {
    float& z = lp[i & 1];
    z += 0.3f * (rng.next() - z);
    in[i] = int16_t(z * 6000.f + rng.next() * 1500.f);
  }
  const Config configs[] = {
      {"q0 defaults", [](float* p) { p[kQuality] = 0; }},
      {"q1 defaults", [](float* p) { p[kQuality] = 1; }},
      {"q2 defaults", [](float* p) { p[kQuality] = 2; }},
      {"q1 no surround bed", [](float* p) {
         p[kQuality] = 1;
         p[kSurround] = 0;
       }},
      {"q1 no early refl.", [](float* p) {
         p[kQuality] = 1;
         p[kRoomDepth] = 0;
       }},
      {"q1 ENABLED=0", [](float* p) {
         p[kQuality] = 1;
         p[kEnabled] = 0;
       }},
      {"q1 off+flat+no reverb", [](float* p) {
         p[kQuality] = 1;
         p[kEnabled] = 0;
         p[kReverbMix] = 0;
       }},
      {"q2 everything on", [](float* p) {
         p[kQuality] = 2;
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
         for (int b = 0; b < kEqBands; ++b) p[kEq0 + b] = float(b % 2 ? 3 : -2);
       }},
  };
  std::printf("us per 256-frame block (budget %.0f us)\n%-22s", 1e6 * kBlock / kFs, "config");
  for (const char* n : kStageNames) std::printf(" %7s", n);
  std::printf(" | Engine::process total\n");
  for (const Config& c : configs) runConfig(c, in);
  return 0;
}
