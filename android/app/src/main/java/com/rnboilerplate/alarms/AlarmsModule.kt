package com.rnboilerplate.alarms

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.screenocr.NativeAlarmsSpec
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The shared alarm engine's TurboModule (used by Reminders and Utility's
 * timers through `src/services/alarms`). Alarm texts are never logged.
 */
class AlarmsModule(context: ReactApplicationContext) : NativeAlarmsSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private var pendingRingtone: Promise? = null

  private val results = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_RINGTONE) return
      val promise = pendingRingtone ?: return
      pendingRingtone = null
      if (resultCode != Activity.RESULT_OK) {
        promise.resolve("")
        return
      }
      val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) {
        data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri::class.java)
      } else {
        @Suppress("DEPRECATION") data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
      }
      // "Default" (or nothing) = the phone's default alarm sound.
      val chosen = uri?.takeUnless { RingtoneManager.isDefault(it) }?.toString().orEmpty()
      promise.resolve(
        JSONObject().put("uri", chosen).put("title", AlarmSounds.title(reactApplicationContext, chosen)).toString(),
      )
    }
  }

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addActivityEventListener(results)
    AlarmScheduler.onFired = { key ->
      if (reactApplicationContext.hasActiveReactInstance()) {
        reactApplicationContext.emitDeviceEvent(EVENT_FIRED, Arguments.createMap().apply { putString("key", key) })
      }
    }
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(results)
    AlarmScheduler.onFired = null
    UiThreadUtil.runOnUiThread { AlarmSounds.stopPreview() }
    io.shutdown()
    super.invalidate()
  }

  override fun sync(group: String, entriesJson: String, promise: Promise) {
    if (group != "reminder" && group != "timer") {
      promise.reject("bad_group", "Unknown alarm group")
      return
    }
    io.execute {
      try {
        val r = AlarmScheduler.sync(reactApplicationContext, group, AlarmEntry.parseAll(entriesJson))
        promise.resolve(JSONObject().put("armed", r.armed).put("exact", r.exact).toString())
      } catch (e: Exception) {
        promise.reject("sync_failed", e.message ?: "Could not schedule alarms", e)
      }
    }
  }

  override fun dismiss(key: String) = AlarmRingService.stop(reactApplicationContext, key)

  override fun getRinging(promise: Promise) = promise.resolve(AlarmRingService.ringingKey().orEmpty())

  override fun getArmed(promise: Promise) = promise.resolve(AlarmScheduler.armedJson(reactApplicationContext))

  override fun pickRingtone(currentUri: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app must be in the foreground")
      return
    }
    pendingRingtone?.resolve("")
    pendingRingtone = promise
    val existing = currentUri.takeIf { it.isNotBlank() }?.let(Uri::parse)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
      .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
      .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
      .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
      .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existing)
    try {
      @Suppress("DEPRECATION") activity.startActivityForResult(intent, REQUEST_RINGTONE)
    } catch (e: ActivityNotFoundException) {
      pendingRingtone = null
      promise.reject("no_picker", "No ringtone picker on this phone", e)
    }
  }

  override fun ringtoneTitle(uri: String, promise: Promise) {
    io.execute { promise.resolve(AlarmSounds.title(reactApplicationContext, uri)) }
  }

  override fun previewRingtone(uri: String, volume: Double, promise: Promise) {
    UiThreadUtil.runOnUiThread { promise.resolve(AlarmSounds.preview(reactApplicationContext, uri, volume.toInt())) }
  }

  override fun stopPreview() {
    UiThreadUtil.runOnUiThread { AlarmSounds.stopPreview() }
  }

  override fun hasVibrator(promise: Promise) = promise.resolve(AlarmSounds.vibrator(reactApplicationContext) != null)

  override fun canScheduleExactAlarms(promise: Promise) =
    promise.resolve(AlarmScheduler.canScheduleExact(reactApplicationContext))

  override fun openExactAlarmSettings() {
    if (Build.VERSION.SDK_INT < 31) return
    open(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
  }

  override fun canUseFullScreenIntent(promise: Promise) =
    promise.resolve(AlarmActivity.canFullScreen(reactApplicationContext))

  override fun openFullScreenIntentSettings() {
    if (Build.VERSION.SDK_INT < 34) return
    open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT))
  }

  private fun open(intent: Intent) {
    try {
      reactApplicationContext.startActivity(
        intent.setData(Uri.parse("package:${reactApplicationContext.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (_: ActivityNotFoundException) {
      // Not on this Android version / OEM: nothing to open.
    }
  }

  companion object {
    const val NAME = NativeAlarmsSpec.NAME
    const val EVENT_FIRED = "AlarmFired"
    private const val REQUEST_RINGTONE = 0x7501
  }
}

/** Registers [AlarmsModule] as a TurboModule (added in MainApplication). */
class AlarmsPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == AlarmsModule.NAME) AlarmsModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(AlarmsModule.NAME to ReactModuleInfo(AlarmsModule.NAME, AlarmsModule.NAME, false, false, false, true))
  }
}
