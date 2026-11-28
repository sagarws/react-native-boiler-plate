package com.rnboilerplate

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions
import com.rnboilerplate.expense.ExpensePackage
import com.rnboilerplate.followup.FollowUpPackage
import com.rnboilerplate.livecamera.LiveCameraPackage
import com.rnboilerplate.netinspector.NetInspectorPackage
import com.rnboilerplate.recorder.RecorderPackage
import com.rnboilerplate.remote.RemoteControlPackage
import com.rnboilerplate.screenocr.ScreenOcrPackage
import com.rnboilerplate.utility.UtilityPackage
import com.rnboilerplate.ytdownload.YouTubeDownloaderPackage

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
          add(com.rnboilerplate.alarms.AlarmsPackage())
          add(com.rnboilerplate.photowidget.PhotoWidgetPackage())
          add(RecorderPackage())
          add(ExpensePackage())
          add(NetInspectorPackage())
          add(RemoteControlPackage())
          add(YouTubeDownloaderPackage())
          add(LiveCameraPackage())
          add(com.rnboilerplate.audiostudio.AudioStudioPackage())
          add(com.rnboilerplate.systemaudio.SystemAudioPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Remote Access host: getDisplayMedia runs the library's own
    // mediaProjection foreground service (required on Android 10+).
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    loadReactNative(this)
    // A fresh process means no capture is running: give back a media volume
    // left muted by "Hear only the 8D sound" if the app was killed mid-way.
    com.rnboilerplate.systemaudio.HearOnly8D.init(this)
  }
}
