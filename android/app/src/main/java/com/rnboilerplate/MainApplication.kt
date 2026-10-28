package com.rnboilerplate

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.rnboilerplate.followup.FollowUpPackage
import com.rnboilerplate.screenocr.ScreenOcrPackage
import com.rnboilerplate.utility.UtilityPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // App-local native modules are not autolinked; register them here.
          add(ScreenOcrPackage())
          add(FollowUpPackage())
          add(UtilityPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
