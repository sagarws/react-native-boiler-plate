#include "room.h"

namespace sa {
namespace {

constexpr float kWallReflection = 0.7f;
constexpr float kMaxItd = 0.00066f;  // s, Woodworth at 90 degrees

}  // namespace

void EarlyReflections::prepare(float fs) {
  fs_ = fs;
  lpCoef_ = onePoleCoef(6000.f, fs);  // wall absorption
  line_.allocate(int(0.12f * fs) + 2 * kChunk);
  reset();
}

void EarlyReflections::reset() {
  line_.clear();
  lp_[0].reset();
  lp_[1].reset();
  for (int i = 0; i < kTaps; ++i) cur_[i] = tgt_[i] = Tap{};
}

bool EarlyReflections::active() const {
  for (int i = 0; i < kTaps; ++i)
    if (cur_[i].gain[0] != 0.f || tgt_[i].gain[0] != 0.f) return true;
  return false;
}

void EarlyReflections::setTarget(const Dir& d, float srcMeters, float roomSize, float amount) {
  const float hx = 2.5f + 5.f * roomSize, hy = 2.f + 4.f * roomSize;
  const float floorZ = -1.4f, ceilZ = 1.2f + 2.f * roomSize;
  // Keep the source inside the room for the image geometry.
  const float sx = clampf(d.x * srcMeters, -0.9f * hx, 0.9f * hx);
  const float sy = clampf(d.y * srcMeters, -0.9f * hy, 0.9f * hy);
  const float sz = clampf(d.z * srcMeters, 0.9f * floorZ, 0.9f * ceilZ);
  const float direct = std::sqrt(sx * sx + sy * sy + sz * sz);
  const float img[kTaps][3] = {
      {2.f * hx - sx, sy, sz},     {-2.f * hx - sx, sy, sz},     // front / back wall
      {sx, 2.f * hy - sy, sz},     {sx, -2.f * hy - sy, sz},     // right / left wall
      {sx, sy, 2.f * floorZ - sz}, {sx, sy, 2.f * ceilZ - sz},  // floor / ceiling
  };
  const int maxDelay = line_.capacity() - 2 * kChunk;
  for (int i = 0; i < kTaps; ++i) {
    const float dist = std::sqrt(img[i][0] * img[i][0] + img[i][1] * img[i][1] + img[i][2] * img[i][2]);
    const float lat = img[i][1] / dist;
    const float base = (dist - direct) / kSpeedOfSound * fs_;
    // Rear images lose a little more (head and pinna shadow).
    const float g = amount * kWallReflection / std::fmax(dist, 0.5f) * (img[i][0] < 0.f ? 0.8f : 1.f);
    Tap& t = tgt_[i];
    t.delay[0] = clampf(base + kMaxItd * fs_ * std::fmax(lat, 0.f), 1.f, float(maxDelay));
    t.delay[1] = clampf(base + kMaxItd * fs_ * std::fmax(-lat, 0.f), 1.f, float(maxDelay));
    t.gain[0] = g * std::sqrt(0.5f * (1.f - lat));
    t.gain[1] = g * std::sqrt(0.5f * (1.f + lat));
    if (cur_[i].delay[0] == 0.f) {  // first use: no ramp from an empty tap
      cur_[i].delay[0] = t.delay[0];
      cur_[i].delay[1] = t.delay[1];
    }
  }
}

void EarlyReflections::feed(const float* in, int n) {
  for (int i = 0; i < n; ++i) line_.write(in[i]);
}

void EarlyReflections::process(const float* in, float* outL, float* outR, int n) {
  feed(in, n);
  const float invN = 1.f / float(n);
  for (int e = 0; e < 2; ++e) {
    float* out = e == 0 ? outL : outR;
    for (int i = 0; i < n; ++i) {
      const float t = float(i + 1) * invN;
      const float age = float(n - 1 - i);
      float acc = 0;
      for (int k = 0; k < kTaps; ++k)
        acc += lerp(cur_[k].gain[e], tgt_[k].gain[e], t) * line_.readLinear(age + lerp(cur_[k].delay[e], tgt_[k].delay[e], t));
      out[i] += lp_[e].lp(acc, lpCoef_);
    }
  }
  for (int k = 0; k < kTaps; ++k) cur_[k] = tgt_[k];
}

}  // namespace sa
