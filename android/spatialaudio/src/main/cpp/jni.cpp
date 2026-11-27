// JNI bridge for com.rnboilerplate.spatialaudio.SpatialEngine. The handle is
// a pointer to sa::Engine owned by the Kotlin object.
#include <jni.h>

#include <new>

#include "spatial_engine.h"

namespace {

sa::Engine* engineOf(jlong handle) { return reinterpret_cast<sa::Engine*>(handle); }

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_com_rnboilerplate_spatialaudio_SpatialEngine_nativeCreate(JNIEnv*, jobject, jint sampleRate) {
  return reinterpret_cast<jlong>(new (std::nothrow) sa::Engine(sampleRate));
}

JNIEXPORT void JNICALL Java_com_rnboilerplate_spatialaudio_SpatialEngine_nativeDestroy(JNIEnv*, jobject, jlong handle) {
  delete engineOf(handle);
}

JNIEXPORT void JNICALL Java_com_rnboilerplate_spatialaudio_SpatialEngine_nativeSetParams(JNIEnv* env, jobject, jlong handle,
                                                                                         jfloatArray params) {
  sa::Engine* e = engineOf(handle);
  if (!e || !params) return;
  jsize n = env->GetArrayLength(params);
  if (n > sa::kParamCount) n = sa::kParamCount;
  float p[sa::kParamCount];
  env->GetFloatArrayRegion(params, 0, n, p);
  e->setParams(p, n);
}

JNIEXPORT void JNICALL Java_com_rnboilerplate_spatialaudio_SpatialEngine_nativeProcess(JNIEnv* env, jobject, jlong handle, jobject in,
                                                                                       jint inChannels, jobject out, jint frames,
                                                                                       jboolean isFloat) {
  sa::Engine* e = engineOf(handle);
  if (!e || !in || !out || frames <= 0 || (inChannels != 1 && inChannels != 2)) return;
  void* src = env->GetDirectBufferAddress(in);
  void* dst = env->GetDirectBufferAddress(out);
  if (!src || !dst) return;
  // Refuse undersized buffers instead of reading or writing past them.
  const jlong bytes = isFloat ? 4 : 2;
  if (env->GetDirectBufferCapacity(in) < jlong(frames) * inChannels * bytes) return;
  if (env->GetDirectBufferCapacity(out) < jlong(frames) * 2 * bytes) return;
  e->process(src, inChannels, dst, frames, isFloat == JNI_TRUE);
}

JNIEXPORT void JNICALL Java_com_rnboilerplate_spatialaudio_SpatialEngine_nativeReset(JNIEnv*, jobject, jlong handle) {
  if (sa::Engine* e = engineOf(handle)) e->reset();
}

JNIEXPORT void JNICALL Java_com_rnboilerplate_spatialaudio_SpatialEngine_nativeState(JNIEnv* env, jobject, jlong handle,
                                                                                     jfloatArray out) {
  sa::Engine* e = engineOf(handle);
  if (!e || !out) return;
  float s[sa::kStateCount];
  e->state(s, sa::kStateCount);
  jsize n = env->GetArrayLength(out);
  if (n > sa::kStateCount) n = sa::kStateCount;
  env->SetFloatArrayRegion(out, 0, n, s);
}

}  // extern "C"
