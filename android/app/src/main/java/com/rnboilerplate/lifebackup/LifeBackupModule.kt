package com.rnboilerplate.lifebackup

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.common.DocumentSaver
import com.rnboilerplate.common.FileShare
import com.rnboilerplate.screenocr.NativeLifeBackupSpec
import java.util.concurrent.Executors

/**
 * Manage Life backup: writes the sheets JS prepares into an .xlsx file
 * where the user chooses ("Save to…", no storage permission), and reads a
 * picked .xlsx back into sheets. The data mapping and validation live in JS
 * (life/services/backup.ts); this module only handles the file format.
 */
class LifeBackupModule(context: ReactApplicationContext) : NativeLifeBackupSpec(context) {
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

  override fun saveWorkbook(fileName: String, sheetsJson: String, promise: Promise) {
    val sheets =
      try {
        Xlsx.sheetsFromJson(sheetsJson)
      } catch (e: Exception) {
        promise.reject("bad_sheets", "Invalid sheet data", e)
        return
      }
    saver.save(fileName.take(120), Xlsx.MIME, promise) { out -> Xlsx.write(sheets, out) }
  }

  override fun readWorkbook(uri: String, promise: Promise) {
    io.execute {
      val file = FileShare.privateFile(reactApplicationContext, uri)
      if (file == null) {
        promise.reject("not_found", "File not found")
        return@execute
      }
      try {
        val sheets = file.inputStream().use { Xlsx.read(it) }
        promise.resolve(Xlsx.sheetsToJson(sheets))
      } catch (e: XlsxException) {
        promise.reject(e.message ?: "not_xlsx", e.message ?: "not_xlsx")
      } catch (e: Exception) {
        promise.reject("read_failed", "read_failed")
      } finally {
        // The picker made a private copy just for this import.
        file.delete()
      }
    }
  }

  companion object {
    const val NAME = NativeLifeBackupSpec.NAME
    private const val REQUEST_SAVE = 0x4C42
  }
}

class LifeBackupPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == LifeBackupModule.NAME) LifeBackupModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      // name, className, canOverrideExistingModule, needsEagerInit, isCxxModule, isTurboModule
      LifeBackupModule.NAME to ReactModuleInfo(LifeBackupModule.NAME, LifeBackupModule.NAME, false, false, false, true),
    )
  }
}
