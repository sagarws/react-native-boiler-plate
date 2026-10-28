package com.rnboilerplate.followup

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.common.DocumentSaver
import com.rnboilerplate.common.FileShare
import com.rnboilerplate.screenocr.NativeFollowUpSpec
import java.util.concurrent.Executors

/**
 * Follow Up's TurboModule: reminder alarms, "Save to…" for exports and
 * opening private attachments. Contact data passed in is never logged.
 */
class FollowUpModule(context: ReactApplicationContext) : NativeFollowUpSpec(context) {
  private val saver = DocumentSaver(context, REQUEST_SAVE)
  private val io = Executors.newSingleThreadExecutor()

  override fun initialize() {
    super.initialize()
    saver.attach()
  }

  override fun invalidate() {
    saver.detach()
    io.shutdown()
    super.invalidate()
  }

  override fun syncReminders(remindersJson: String, promise: Promise) {
    io.execute {
      try {
        val list = Reminder.parseAll(remindersJson)
        if (list.isNotEmpty() && !ReminderScheduler.notificationsAllowed(reactApplicationContext)) {
          ReminderScheduler.sync(reactApplicationContext, emptyList())
          promise.resolve(-1.0)
        } else {
          promise.resolve(ReminderScheduler.sync(reactApplicationContext, list).toDouble())
        }
      } catch (e: Exception) {
        promise.reject("sync_failed", e.message ?: "Reminder sync failed", e)
      }
    }
  }

  override fun saveTextDocument(fileName: String, mimeType: String, content: String, promise: Promise) {
    saver.save(fileName.take(120), mimeType, promise) { it.write(content.toByteArray(Charsets.UTF_8)) }
  }

  override fun openAttachment(uri: String, mimeType: String, promise: Promise) {
    val file = FileShare.privateFile(reactApplicationContext, uri)
    promise.resolve(file != null && FileShare.open(reactApplicationContext, file, mimeType))
  }

  companion object {
    const val NAME = NativeFollowUpSpec.NAME
    private const val REQUEST_SAVE = 0x4655
  }
}

/** Registers [FollowUpModule] as a TurboModule (added in MainApplication). */
class FollowUpPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == FollowUpModule.NAME) FollowUpModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      FollowUpModule.NAME to ReactModuleInfo(FollowUpModule.NAME, FollowUpModule.NAME, false, false, false, true),
    )
  }
}
