#include "spatial_engine.h"

#include <cstring>

#if defined(__x86_64__) || defined(__i386__)
#include <xmmintrin.h>
#endif

namespace sa {
namespace {

// Flush-to-zero for the duration of process(): reverb and filter tails
// decaying into denormals would otherwise cost 10-100x CPU on some cores.
// The caller's mode is restored because the audio thread is shared.
class DenormalGuard {
 public:
  DenormalGuard() {
#if defined(__aarch64__)
    asm volatile("mrs %0, fpcr" : "=r"(saved_));
    asm volatile("msr fpcr, %0" : : "r"(saved_ | (uint64_t(1) << 24)));
#elif defined(__arm__)
    asm volatile("vmrs %0, fpscr" : "=r"(saved_));
    asm volatile("vmsr fpscr, %0" : : "r"(saved_ | (1u << 24)));
#elif defined(__x86_64__) || defined(__i386__)
    saved_ = _mm_getcsr();
    _mm_setcsr(saved_ | 0x8040);  // FTZ | DAZ
#endif
  }
  ~DenormalGuard() {
#if defined(__aarch64__)
    asm volatile("msr fpcr, %0" : : "r"(saved_));
#elif defined(__arm__)
    asm volatile("vmsr fpscr, %0" : : "r"(saved_));
#elif defined(__x86_64__) || defined(__i386__)
    _mm_setcsr(saved_);
#endif
  }
  DenormalGuard(const DenormalGuard&) = delete;
  DenormalGuard& operator=(const DenormalGuard&) = delete;

 private:
#if defined(__aarch64__)
  uint64_t saved_ = 0;
#else
  uint32_t saved_ = 0;
#endif
};

// Non-finite or absurd input must not poison the feedback networks; the bit
// test survives -ffast-math, unlike std::isfinite.
float sanitize(float x) {
  uint32_t bits;
  std::memcpy(&bits, &x, sizeof bits);
  if ((bits & 0x7f800000u) == 0x7f800000u) return 0.f;
  return clampf(x, -16.f, 16.f);
}

int16_t toPcm16(float x) { return int16_t(std::lrintf(clampf(x, -1.f, 1.f) * 32767.f)); }

}  // namespace

ParamHandoff::ParamHandoff() {
  defaultParams(latest_);
  for (auto& slot : slots_) std::memcpy(slot, latest_, sizeof latest_);
}

void ParamHandoff::write(const float* p, int n) {
  while (writerBusy_.test_and_set(std::memory_order_acquire)) {
  }
  const int count = n < kParamCount ? n : kParamCount;
  for (int i = 0; i < count; ++i) latest_[i] = clampParam(i, p[i]);
  std::memcpy(slots_[back_], latest_, sizeof latest_);
  back_ = middle_.exchange(back_ | kDirty, std::memory_order_acq_rel) & 3;
  writerBusy_.clear(std::memory_order_release);
}

bool ParamHandoff::read(float* dst) {
  if (!(middle_.load(std::memory_order_acquire) & kDirty)) return false;
  front_ = middle_.exchange(front_, std::memory_order_acq_rel) & 3;
  std::memcpy(dst, slots_[front_], sizeof slots_[front_]);
  return true;
}

Engine::Engine(int sampleRate) : fs_(clampf(float(sampleRate), 8000.f, 192000.f)) {
  defaultParams(p_);
  eq_.prepare(fs_);
  spatial_.prepare(fs_);
  reverb_.prepare(fs_);
  tone_.prepare(fs_);
  limiter_.prepare(fs_);
  for (auto& s : state_) s.store(0.f, std::memory_order_relaxed);
  doReset();
}

void Engine::setParams(const float* p, int n) { handoff_.write(p, n); }

void Engine::doReset() {
  eq_.reset(p_);
  spatial_.reset(p_);
  reverb_.reset(p_);
  tone_.reset(p_);
  limiter_.reset();
  peakL_ = peakR_ = grDb_ = 0;
  fresh_ = true;
}

void Engine::render(int n) {
  eq_.process(L_, R_, n, p_);
  spatial_.process(L_, R_, send_, n, p_);

  // Width via mid/side after spatialisation (1 = unchanged).
  widthS_ += (fresh_ ? 1.f : blockCoef(0.05f, n, fs_)) * (p_[kWidth] - widthS_);
  if (std::fabs(widthS_ - p_[kWidth]) < 1e-5f) widthS_ = p_[kWidth];
  width_.to(widthS_, n, fresh_);
  if (!width_.unity())
    for (int i = 0; i < n; ++i) {
      const float m = 0.5f * (L_[i] + R_[i]), s = 0.5f * (L_[i] - R_[i]) * width_.at(i);
      L_[i] = m + s;
      R_[i] = m - s;
    }

  reverb_.process(L_, R_, send_, n, p_);
  tone_.process(L_, R_, n, p_);
  limiter_.process(L_, R_, n, p_[kLimiter] > 0.5f);
  fresh_ = false;
}

void Engine::process(const void* in, int inChannels, void* out, int frames, bool isFloat) {
  if (frames <= 0 || (inChannels != 1 && inChannels != 2)) return;
  DenormalGuard ftz;
  if (resetPending_.exchange(false, std::memory_order_acq_rel)) {
    handoff_.read(p_);
    doReset();
  } else if (handoff_.read(p_) && fresh_) {
    doReset();  // first parameters after create: start at them, no ramps
  }

  float blockPeakL = 0, blockPeakR = 0, gr = 0;
  for (int off = 0; off < frames; off += kChunk) {
    const int n = frames - off < kChunk ? frames - off : kChunk;
    // Whole chunk is read before any of it is written, so in == out is safe for stereo.
    if (isFloat) {
      const float* src = static_cast<const float*>(in) + size_t(off) * size_t(inChannels);
      for (int i = 0; i < n; ++i) {
        L_[i] = sanitize(src[i * inChannels]);
        R_[i] = inChannels == 2 ? sanitize(src[i * 2 + 1]) : L_[i];
      }
    } else {
      const int16_t* src = static_cast<const int16_t*>(in) + size_t(off) * size_t(inChannels);
      for (int i = 0; i < n; ++i) {
        L_[i] = float(src[i * inChannels]) * (1.f / 32768.f);
        R_[i] = inChannels == 2 ? float(src[i * 2 + 1]) * (1.f / 32768.f) : L_[i];
      }
    }
    render(n);
    for (int i = 0; i < n; ++i) {
      blockPeakL = std::fmax(blockPeakL, std::fabs(L_[i]));
      blockPeakR = std::fmax(blockPeakR, std::fabs(R_[i]));
    }
    gr = std::fmax(gr, limiter_.gainReductionDb());
    if (isFloat) {
      float* dst = static_cast<float*>(out) + size_t(off) * 2;
      for (int i = 0; i < n; ++i) {
        dst[2 * i] = L_[i];
        dst[2 * i + 1] = R_[i];
      }
    } else {
      int16_t* dst = static_cast<int16_t*>(out) + size_t(off) * 2;
      for (int i = 0; i < n; ++i) {
        dst[2 * i] = toPcm16(L_[i]);
        dst[2 * i + 1] = toPcm16(R_[i]);
      }
    }
  }

  // Meters hold peaks and fall back over ~300 ms so a slow UI poll sees them.
  const float fall = std::exp(-float(frames) / (0.3f * fs_));
  peakL_ = std::fmax(peakL_ * fall, blockPeakL);
  peakR_ = std::fmax(peakR_ * fall, blockPeakR);
  grDb_ = std::fmax(grDb_ * fall, gr);
  const Position& pos = spatial_.position();
  state_[0].store(pos.az, std::memory_order_relaxed);
  state_[1].store(pos.el, std::memory_order_relaxed);
  state_[2].store(pos.dist, std::memory_order_relaxed);
  state_[3].store(peakL_, std::memory_order_relaxed);
  state_[4].store(peakR_, std::memory_order_relaxed);
  state_[5].store(grDb_, std::memory_order_relaxed);
}

void Engine::state(float* out, int n) const {
  const int count = n < kStateCount ? n : kStateCount;
  for (int i = 0; i < count; ++i) out[i] = state_[i].load(std::memory_order_relaxed);
}

}  // namespace sa
