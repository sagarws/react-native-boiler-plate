package com.rnboilerplate.screenocr

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers [ScreenOcrModule] as a TurboModule (added in MainApplication). */
class ScreenOcrPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == ScreenOcrModule.NAME) ScreenOcrModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      ScreenOcrModule.NAME to
        // name, className, canOverrideExistingModule, needsEagerInit,
        // isCxxModule, isTurboModule
        ReactModuleInfo(ScreenOcrModule.NAME, ScreenOcrModule.NAME, false, false, false, true),
    )
  }
}
