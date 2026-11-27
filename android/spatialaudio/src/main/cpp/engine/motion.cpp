#include "motion.h"

namespace sa {
namespace {

constexpr float kBlendSeconds = 0.3f;

float wrap180(float deg) {
  while (deg > 180.f) deg -= 360.f;
  while (deg < -180.f) deg += 360.f;
  return deg;
}

float smoothstep(float t) { return t * t * (3.f - 2.f * t); }

int patternOf(const float* p) { return int(clampf(std::floor(p[kPattern] + 0.5f), 0.f, float(kPatternCount - 1))); }

}  // namespace

void Motion::reset(const float* p) {
  baseAz_ = p[kAzimuth];
  baseEl_ = p[kElevation];
  dist_ = p[kDistance];
  rpm_ = p[kRpm];
  intensity_ = p[kMoveIntensity];
  phase_ = 0;
  pattern_ = fromPattern_ = patternOf(p);
  blend_ = 1;
  fromFrozen_ = false;
  rng_ = Lcg();
  randPrev_ = {0, 0};
  randNext_ = {rng_.next(), rng_.next()};
  last_ = pathDir(pattern_);
}

Motion::Offset Motion::offset(int pattern) const {
  const float ph = float(phase_);
  const float s = std::sin(kTwoPi * ph), c = std::cos(kTwoPi * ph);
  const float in = intensity_;
  switch (pattern) {
    // Circles always make the full turn; lower intensity lifts the orbit
    // toward the zenith so the lateral swing (cos el) shrinks without a jump.
    case kCircleCw: return {360.f * ph, (1.f - in) * (80.f - baseEl_)};
    case kCircleCcw: return {-360.f * ph, (1.f - in) * (80.f - baseEl_)};
    case kLeftToRight: return {-90.f * in * c, 0};
    case kRightToLeft: return {90.f * in * c, 0};
    // Front/back sweeps pass the right side with a small lift at the side.
    case kFrontToBack: return {90.f * in * (1.f - c), 15.f * in * s * s};
    case kBackToFront: return {180.f - 90.f * in * (1.f - c), 15.f * in * s * s};
    case kRandom3d: {
      const float t = smoothstep(ph);
      const float u = lerp(randPrev_.az, randNext_.az, t), v = lerp(randPrev_.el, randNext_.el, t);
      return {180.f * in * u, in * (10.f + 40.f * v)};
    }
    case kWave: return {120.f * in * s, 30.f * in * std::sin(3.f * kTwoPi * ph)};
    // Sweeps front-right-back-right-front-left-back-left: two lobes = an eight.
    case kFigureEight: return {180.f * in * s, 20.f * in * std::sin(2.f * kTwoPi * ph)};
    default: return {0, 0};
  }
}

Dir Motion::pathDir(int pattern) const {
  const Offset o = offset(pattern);
  return dirFromAngles(baseAz_ + o.az, clampf(baseEl_ + o.el, -45.f, 85.f));
}

Position Motion::advance(int n, const float* p) {
  const float kPos = blockCoef(0.15f, n, fs_);
  baseAz_ = wrap180(baseAz_ + kPos * wrap180(p[kAzimuth] - baseAz_));
  baseEl_ += kPos * (p[kElevation] - baseEl_);
  dist_ += kPos * (p[kDistance] - dist_);
  rpm_ += blockCoef(0.3f, n, fs_) * (p[kRpm] - rpm_);
  intensity_ += blockCoef(0.1f, n, fs_) * (p[kMoveIntensity] - intensity_);

  const int pattern = patternOf(p);
  if (pattern != pattern_) {
    // A change during a cross-fade glides from wherever the source is now.
    fromFrozen_ = blend_ < 1.f;
    frozen_ = last_;
    fromPattern_ = pattern_;
    pattern_ = pattern;
    blend_ = 0;
  }

  phase_ += double(rpm_) / 60.0 * double(n) / double(fs_);
  if (phase_ >= 1.0) {
    phase_ -= std::floor(phase_);
    randPrev_ = randNext_;
    randNext_ = {rng_.next(), rng_.next()};
  }

  Dir d = pathDir(pattern_);
  if (blend_ < 1.f) {
    blend_ = std::fmin(1.f, blend_ + float(n) / (kBlendSeconds * fs_));
    const float t = smoothstep(blend_);
    const Dir from = fromFrozen_ ? frozen_ : pathDir(fromPattern_);
    // Normalised lerp with an overhead bias so opposite directions never
    // pass through the zero vector.
    const float lift = 0.3f * std::sin(kPi * t);
    Dir m{lerp(from.x, d.x, t), lerp(from.y, d.y, t), lerp(from.z, d.z, t) + lift};
    const float len = std::sqrt(m.x * m.x + m.y * m.y + m.z * m.z);
    if (len > 1e-4f) d = {m.x / len, m.y / len, m.z / len};
  }
  last_ = d;
  return {azimuthDeg(d), elevationDeg(d), dist_, d};
}

}  // namespace sa
